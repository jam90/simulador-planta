"""Línea de producción: máquina de estados gobernada por el PLC.

La simulación es "por eventos": en vez de avanzar segundo a segundo, se calcula
cuándo ocurre el siguiente suceso (fin de turno, llegada de una pieza, avería...)
y se salta directamente a él. Así un mes de datos se genera en segundos y el
resultado no depende del intervalo de muestreo.

Los sucesos aleatorios (microparadas, averías, cambios de formato) se cuentan en
tiempo de producción: una máquina parada no se avería.
"""
import math
import random
from collections import defaultdict

from . import catalogo
from .equipos.base import (ARRANQUE, AVERIA, CAMBIO_FORMATO, ESPERA, MANTENIMIENTO,
                           MICROPARADA, PARADA, PRODUCCION)
from .tiempo import a_iso

CON_DURACION = {ARRANQUE, MICROPARADA, AVERIA, CAMBIO_FORMATO}


class Linea:
    def __init__(self, cfg: dict, equipos: list, planta):
        self.id = cfg["id"]
        self.descripcion = cfg.get("descripcion", "")
        self.planta = planta
        self.cal = planta.calendario
        p = cfg.get("parametros", {}) or {}
        self.intervalo_pieza = 3600 / p.get("cadencia_piezas_h", 60)
        self.tasa_nok = p.get("tasa_nok", 0.02)
        self.formato_h = p.get("cambios_formato_por_turno", 1) / 8
        # El MES va primero: asigna la orden a cada pieza antes de que otros equipos la usen
        self.equipos = sorted(equipos, key=lambda e: e.tipo != "mes")
        self.plc = next(e for e in equipos if e.tipo == "plc_linea")
        self.rng = random.Random(f"{planta.semilla}-linea-{self.id}")
        self.referencias = planta.referencias
        self.ref_idx = 0
        self.estado = PARADA
        self.causa = None          # equipo que provoca la parada (si la hay)
        self.codigo = None
        self.motivo = None
        self.t = None
        self.t_fin_estado = math.inf
        self.t_cal = math.inf
        self.parada_desde = None
        self.averia_actual = None
        self.ultima_pieza_ok = True
        self.restante = {}         # segundos de producción hasta cada suceso aleatorio
        self.tiempo_estados = defaultdict(float)   # segundos en cada estado en el último paso
        self.forzados = []         # incidencias pedidas desde fuera (web)

    @property
    def referencia(self):
        return self.referencias[self.ref_idx]

    # --- Aleatoriedad ----------------------------------------------------------
    def _exp(self, por_hora):
        """Segundos hasta el próximo suceso de una tasa dada (distribución exponencial)."""
        return self.rng.expovariate(por_hora / 3600) if por_hora > 0 else math.inf

    def _uniforme_min(self, rango):
        return self.rng.uniform(*rango) * 60

    def _intervalo(self):
        return self.intervalo_pieza * self.rng.uniform(0.97, 1.06)

    # --- Arranque de la simulación ---------------------------------------------
    def iniciar(self, t: float):
        self.t = t
        modo = self.cal.modo(t)
        self.estado = {"produccion": PRODUCCION, "mantenimiento": MANTENIMIENTO}.get(modo, PARADA)
        self.parada_desde = t if self.estado == PARADA else None
        self.t_cal = self.cal.siguiente_cambio(t)
        self.restante = {"pieza": self._intervalo(), "formato": self._exp(self.formato_h)}
        for eq in self.equipos:
            self.restante[("micro", eq.id)] = self._exp(eq.microparadas_h)
            mtbf = eq.horas_entre_averias
            self.restante[("averia", eq.id)] = self._exp(1 / mtbf) if mtbf else math.inf
            eq.iniciar(t)
            eq.estado = self._estado_equipo(eq)

    # --- Bucle de eventos ------------------------------------------------------
    def avanzar(self, t_fin: float):
        self.tiempo_estados = defaultdict(float)
        while True:
            t_ev, accion = self._proximo()
            if t_ev > t_fin:
                self._segmento(self.t, t_fin)
                self.t = t_fin
                return
            self._segmento(self.t, t_ev)
            self.t = t_ev
            accion()

    def _proximo(self):
        cands = [(self.t_cal, self._on_calendario)]
        if self.forzados:
            cands.append((self.t, self._on_forzado))
        if self.estado in CON_DURACION:
            cands.append((self.t_fin_estado, self._on_fin_estado))
        if self.estado == PRODUCCION:
            for clave, r in self.restante.items():
                cands.append((self.t + max(0.0, r), lambda c=clave: self._on_contador(c)))
            for eq in self.equipos:
                td = eq.instante_averia_degradacion()
                if td < math.inf:
                    cands.append((max(self.t, td), lambda e=eq: self._on_degradacion(e)))
        return min(cands, key=lambda c: c[0])

    def _segmento(self, a, b):
        dt = b - a
        if dt <= 0:
            return
        self.tiempo_estados[self.estado] += dt
        if self.estado == PRODUCCION:
            for clave in self.restante:
                self.restante[clave] -= dt
        for eq in self.equipos:
            eq.segmento(a, b, self._estado_equipo(eq))

    def _estado_equipo(self, eq):
        """El PLC muestra el estado de la línea; el resto, ESPERA si la parada no es suya."""
        if eq is self.plc:
            return self.estado
        if self.estado in (AVERIA, MICROPARADA) and self.causa is not eq:
            return ESPERA
        return self.estado

    def _cambiar(self, nuevo, duracion_s=None, causa=None, codigo=None, motivo=None):
        anterior = self.estado
        self.estado = nuevo
        self.causa, self.codigo, self.motivo = causa, codigo, motivo
        self.t_fin_estado = self.t + duracion_s if duracion_s else math.inf
        if nuevo == PARADA:
            self.parada_desde = self.t
        for eq in self.equipos:
            eq.estado = self._estado_equipo(eq)
        datos = {"anterior": anterior, "nuevo": nuevo}
        if causa:
            datos["causa"] = causa.id
        if duracion_s:
            datos["duracion_prevista_s"] = round(duracion_s)
        self.plc.evento(self.t, "cambio_estado", "info", codigo,
                        f"{self.id}: {anterior} -> {nuevo}" + (f" ({motivo})" if motivo else ""), **datos)

    def _arrancar(self, motivo_largo="Arranque de turno"):
        """Arranque largo si la línea lleva más de 1 h parada (o averiada); corto si no."""
        larga = self.parada_desde is not None and self.t - self.parada_desde > 3600
        self._cambiar(ARRANQUE, self._uniforme_min([8, 15] if larga else [1, 3]),
                      motivo=motivo_largo if larga else "Rearranque")

    # --- Manejadores de sucesos ------------------------------------------------
    def _on_calendario(self):
        modo = self.cal.modo(self.t)
        self.t_cal = self.cal.siguiente_cambio(self.t)
        if self.estado == AVERIA:
            return                               # la reparación sigue su curso
        if modo == "parada" and self.estado != PARADA:
            self._cambiar(PARADA, motivo="Fin de turno o descanso")
        elif modo == "mantenimiento" and self.estado != MANTENIMIENTO:
            self._cambiar(MANTENIMIENTO, motivo="Mantenimiento preventivo planificado")
            for eq in self.equipos:
                eq.mantenimiento_preventivo(self.t)
        elif modo == "produccion" and self.estado in (PARADA, MANTENIMIENTO):
            self._arrancar()

    def _on_fin_estado(self):
        if self.estado in (ARRANQUE, MICROPARADA, CAMBIO_FORMATO):
            # Normalmente se vuelve a producir; si la parada se provocó fuera de turno, no
            modo = self.cal.modo(self.t)
            if modo == "produccion":
                self._cambiar(PRODUCCION)
            elif modo == "mantenimiento":
                self._cambiar(MANTENIMIENTO, motivo="Mantenimiento preventivo planificado")
            else:
                self._cambiar(PARADA, motivo="Fuera de turno")
        elif self.estado == AVERIA:
            av = self.averia_actual
            eq = self.causa
            eq.reparar(self.t, av["codigo"])
            eq.evento(self.t, "averia_fin", "info", av["codigo"], f"{eq.id}: reparado - {av['accion']}",
                      descripcion=av["descripcion"], accion=av["accion"], inicio=a_iso(av["inicio"]),
                      duracion_min=round((self.t - av["inicio"]) / 60, 1))
            self.averia_actual = None
            modo = self.cal.modo(self.t)
            if modo == "produccion":
                # Tras una reparación de más de 1 h hay pruebas y ajustes: arranque largo
                self.parada_desde = av["inicio"]
                self._arrancar("Arranque tras avería larga")
            elif modo == "mantenimiento":
                self._cambiar(MANTENIMIENTO, motivo="Mantenimiento preventivo planificado")
            else:
                self._cambiar(PARADA, motivo="Fuera de turno tras reparación")

    def _on_contador(self, clave):
        if clave == "pieza":
            self.restante["pieza"] = self._intervalo()
            self._pieza()
        elif clave == "formato":
            self.restante["formato"] = self._exp(self.formato_h)
            anterior = self.referencia
            self.ref_idx = (self.ref_idx + 1) % len(self.referencias)
            for eq in self.equipos:
                eq.cambio_referencia(self.t, anterior, self.referencia)
            self.plc.evento(self.t, "cambio_referencia", "info", None,
                            f"{self.id}: cambio de {anterior} a {self.referencia}",
                            anterior=anterior, nueva=self.referencia)
            self._cambiar(CAMBIO_FORMATO, self._uniforme_min([15, 40]),
                          motivo=f"Cambio a {self.referencia}")
        else:
            tipo, eq_id = clave
            eq = next(e for e in self.equipos if e.id == eq_id)
            if tipo == "micro":
                self.restante[clave] = self._exp(eq.microparadas_h)
                codigo, mensaje = self.rng.choice(eq.microparadas())
                self._microparada(eq, codigo, mensaje, self.rng.uniform(30, 240))
            else:
                self.restante[clave] = self._exp(1 / eq.horas_entre_averias)
                codigo, desc, accion = self.rng.choice(eq.averias())
                self._averia(eq, codigo, desc, accion, self._uniforme_min(eq.minutos_reparacion))

    def _on_degradacion(self, eq):
        codigo, desc, accion, duracion_s = eq.averia_degradacion()
        self._averia(eq, codigo, desc, accion, duracion_s)

    def _on_forzado(self):
        f = self.forzados.pop(0)
        if f["tipo"] == "reparar":
            if self.estado == AVERIA:
                self.t_fin_estado = self.t        # la reparación termina ya (mismo camino que si acabara sola)
            return
        eq = next((e for e in self.equipos if e.id == f["equipo"]), self.plc)
        if self.estado == AVERIA:
            return
        if f["tipo"] == "microparada":
            codigo, mensaje = self.rng.choice(eq.microparadas())
            self._microparada(eq, codigo, mensaje, f.get("minutos", 2) * 60)
        else:
            codigo, desc, accion = self.rng.choice(eq.averias())
            self._averia(eq, codigo, desc, accion, f.get("minutos", 30) * 60)

    def _microparada(self, eq, codigo, mensaje, duracion_s):
        eq.evento(self.t, "alarma", "aviso", codigo, f"{eq.id}: {mensaje}",
                  descripcion=mensaje, duracion_prevista_s=round(duracion_s))
        self._cambiar(MICROPARADA, duracion_s, causa=eq, codigo=codigo, motivo=mensaje)

    def _averia(self, eq, codigo, desc, accion, duracion_s):
        self.averia_actual = {"inicio": self.t, "codigo": codigo, "descripcion": desc,
                              "accion": accion, "equipo": eq.id}
        eq.evento(self.t, "averia_inicio", "error", codigo, f"{eq.id}: {desc}",
                  descripcion=desc, referencia=self.referencia)
        self._cambiar(AVERIA, duracion_s, causa=eq, codigo=codigo, motivo=desc)

    def _pieza(self):
        p_nok = self.tasa_nok + sum(eq.contribucion_nok() for eq in self.equipos)
        self.ultima_pieza_ok = self.rng.random() >= p_nok
        peticion = None
        for eq in self.equipos:
            r = eq.nueva_pieza(self.t, self)
            if r and peticion is None:
                peticion = (eq, r)
        if peticion:
            eq, r = peticion
            if r["estado"] == MICROPARADA:
                self._microparada(eq, r["codigo"], r["mensaje"], r["duracion_s"])
            else:
                self._averia(eq, r["codigo"], r["mensaje"], r["accion"], r["duracion_s"])

    # --- Para otros equipos ----------------------------------------------------
    def fraccion(self, *estados) -> float:
        """Fracción del último paso que la línea ha pasado en esos estados."""
        total = sum(self.tiempo_estados.values())
        if total <= 0:
            return 1.0 if self.estado in estados else 0.0
        return sum(self.tiempo_estados[e] for e in estados) / total

    def forzar(self, equipo_id: str, tipo: str, minutos: float):
        self.forzados.append({"equipo": equipo_id, "tipo": tipo, "minutos": minutos})
