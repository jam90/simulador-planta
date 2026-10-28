"""La planta: crea líneas y equipos a partir de la configuración y los hace avanzar."""
from collections import defaultdict
from zoneinfo import ZoneInfo

from . import catalogo
from .calendario import Calendario
from .clima import Clima
from .equipos import ORDEN, TIPOS, EquipoLinea
from .equipos.base import ARRANQUE, AVERIA, PRODUCCION
from .linea import Linea
from .tarifa import Tarifa
from .tiempo import a_iso


def _redondear(valores: dict) -> dict:
    return {k: round(v, 3) if isinstance(v, float) else v for k, v in valores.items()}


class Planta:
    def __init__(self, config: dict):
        p = config["planta"]
        self.nombre = p["nombre"]
        self.tz = ZoneInfo(p.get("zona_horaria", "Europe/Madrid"))
        self.semilla = p.get("semilla", 42)
        self.referencias = config.get("referencias", ["REF-A100"])
        self.calendario = Calendario(config.get("calendario", {}), self.tz)
        self.clima = Clima(config.get("clima", {}), p.get("latitud", 43.3),
                           p.get("longitud", -3.0), self.tz, self.semilla)
        self.tarifa = Tarifa(config["tarifa"], self.calendario, self.tz)
        self.equipos = {}            # id -> equipo (orden de la configuración)
        self.lineas = {}             # id -> Linea (solo las que tienen PLC)
        servicios = []
        for lcfg in config["lineas"]:
            de_linea = []
            for ecfg in lcfg["equipos"]:
                eq = TIPOS[ecfg["tipo"]](ecfg, lcfg["id"], self)
                if eq.id in self.equipos:
                    raise ValueError(f"Equipo repetido: {eq.id}")
                self.equipos[eq.id] = eq
                (de_linea if isinstance(eq, EquipoLinea) else servicios).append(eq)
            if de_linea:
                self.lineas[lcfg["id"]] = Linea(lcfg, de_linea, self)
        self.servicios = sorted(servicios, key=lambda e: ORDEN[e.tipo])
        self.t = None
        self._eventos = []
        self._registros = defaultdict(list)

    # --- Consultas que usan los equipos -----------------------------------------
    def equipo_de_tipo(self, tipo):
        return next((e for e in self.equipos.values() if e.tipo == tipo), None)

    def temp_nave(self) -> float:
        amb = self.equipo_de_tipo("ambiente")
        return amb.temp_nave if amb else 20.0

    # --- Simulación -------------------------------------------------------------
    def iniciar(self, t: float):
        self.t = t
        self.clima.actualizar(t)
        for eq in self.servicios:
            if eq.tipo not in ("analizador_red", "contador_general"):
                eq.iniciar(t)
        for linea in self.lineas.values():
            linea.iniciar(t)
        for eq in self.servicios:
            if eq.tipo in ("analizador_red", "contador_general"):
                eq.iniciar(t)

    def avanzar(self, t1: float):
        t0 = self.t
        self.clima.actualizar(t1)
        for linea in self.lineas.values():
            linea.avanzar(t1)
        for eq in self.servicios:
            eq.paso(t0, t1)
        self.t = t1

    def muestrear(self, t: float) -> list:
        """Un mensaje de telemetría por equipo. Los medidores van al final."""
        ts = a_iso(t)
        orden = [e for e in self.equipos.values() if e not in self.servicios] + self.servicios
        mensajes = []
        for eq in orden:
            if "telemetria" not in eq.canales:
                continue
            valores = eq.muestrear(t)
            mensajes.append({
                "ts": ts, "planta": self.nombre, "linea": eq.linea_id, "equipo": eq.id,
                "tipo": eq.tipo, "estado": eq.estado, "valores": _redondear(valores),
            })
        return mensajes

    # --- Eventos y registros ----------------------------------------------------
    def evento(self, t, equipo, tipo_evento, severidad, codigo, mensaje, datos):
        self._eventos.append({
            "ts": a_iso(t), "planta": self.nombre, "linea": equipo.linea_id,
            "equipo": equipo.id, "tipo": equipo.tipo, "tipo_evento": tipo_evento,
            "severidad": severidad, "codigo": codigo, "mensaje": mensaje, "datos": datos,
        })

    def registro(self, canal, datos):
        """Mensaje de un canal propio (curva, inspecciones). Si trae `ts`, va primero."""
        cabecera = {"ts": datos["ts"]} if "ts" in datos else {}
        self._registros[canal].append({**cabecera, "planta": self.nombre, **datos})

    def recoger(self):
        """Devuelve y vacía los eventos y registros acumulados (eventos ordenados por hora)."""
        eventos = sorted(self._eventos, key=lambda e: e["ts"])
        registros = dict(self._registros)
        self._eventos, self._registros = [], defaultdict(list)
        return eventos, registros

    # --- Incidencias provocadas desde fuera ------------------------------------
    @staticmethod
    def admite_incidencias(eq) -> bool:
        """Solo los equipos de línea con códigos de avería y microparada en el catálogo."""
        return isinstance(eq, EquipoLinea) and bool(eq.averias()) and bool(eq.microparadas())

    def averias_en_curso(self) -> list:
        """Averías de línea y fallos del inversor en curso, con su fin previsto (epoch)."""
        en_curso = []
        for linea in self.lineas.values():
            if linea.estado == AVERIA and linea.averia_actual:
                av = linea.averia_actual
                en_curso.append({"linea": linea.id, "equipo": av["equipo"], "codigo": av["codigo"],
                                 "descripcion": av["descripcion"], "inicio": av["inicio"],
                                 "fin_previsto": linea.t_fin_estado})
        fv = self.equipo_de_tipo("fotovoltaica")
        if fv and fv.fallo_hasta is not None:
            codigo, desc, _ = catalogo.AVERIAS["fotovoltaica"][0]
            en_curso.append({"linea": fv.linea_id, "equipo": fv.id, "codigo": codigo, "descripcion": desc,
                             "inicio": fv.fallo_desde, "fin_previsto": fv.fallo_hasta})
        return en_curso

    def provocar(self, incidencia: str, equipo_id: str = None, minutos: float = 30, **kw):
        """Incidencias: averia, microparada (equipos de línea), reparar, fuga_aire, fallo_inversor."""
        if incidencia in ("averia", "microparada"):
            eq = self.equipos[equipo_id]
            if not self.admite_incidencias(eq):
                raise ValueError(f"{equipo_id} no admite averías ni microparadas provocadas")
            linea = self.lineas[eq.linea_id]
            if incidencia == "microparada" and linea.estado not in (PRODUCCION, ARRANQUE):
                raise ValueError(f"La línea {linea.id} no está produciendo ({linea.estado}): "
                                 "la microparada no tendría efecto")
            linea.forzar(equipo_id, incidencia, minutos)
        elif incidencia == "reparar":
            av = next((a for a in self.averias_en_curso() if a["equipo"] == equipo_id), None)
            if av is None:
                raise ValueError(f"{equipo_id} no tiene ninguna avería en curso")
            eq = self.equipos[equipo_id]
            if eq.tipo == "fotovoltaica":
                eq.fallo_hasta = self.t           # termina en el próximo paso, con su evento de fin
            else:
                self.lineas[eq.linea_id].forzar(equipo_id, "reparar", 0)
        elif incidencia == "fuga_aire":
            self.equipo_de_tipo("compresor").incidencias["fuga_aire"] = kw.get("caudal_m3_min", 2.0)
        elif incidencia == "fin_fuga_aire":
            self.equipo_de_tipo("compresor").incidencias.pop("fuga_aire", None)
        elif incidencia == "fallo_inversor":
            self.equipo_de_tipo("fotovoltaica").averiar(self.t, minutos)
        else:
            raise ValueError(f"Incidencia desconocida: {incidencia}")
