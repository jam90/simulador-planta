"""Medidores de energía: analizadores de red de cuadro y contador general (acometida).

Cada medidor suma lo que cuelga de él (más unas pequeñas pérdidas), de modo que
los datos son coherentes: contador general ≈ cuadros + pérdidas - fotovoltaica.
"""
import math

from .. import catalogo
from ..tiempo import a_iso, a_local
from .base import Equipo

TENSION_FASE_V = 230.0


def reactiva_kvar(eq) -> float:
    """Potencia reactiva instantánea de un equipo (los medidores la calculan ellos)."""
    if hasattr(eq, "q_kvar"):
        return eq.q_kvar
    return eq.potencia_kw * math.tan(math.acos(eq.fp))


def energia_reactiva(eq) -> float:
    if hasattr(eq, "energia_reactiva_kvarh"):
        return eq.energia_reactiva_kvarh
    return eq.energia_kwh * math.tan(math.acos(eq.fp))


class _Medidor(Equipo):
    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.ids_mide = cfg.get("mide", [])
        self.perdidas = self.p.get("perdidas_pct", 0.0) / 100
        self.q_kvar = 0.0
        self.estado = "OK"

    @property
    def hijos(self):
        return [self.planta.equipos[i] for i in self.ids_mide]

    def magnitudes(self, p_kw, q_kvar, carga_relativa):
        """Tensiones, corrientes, frecuencia y armónicos a partir de P y Q."""
        s_kva = math.hypot(p_kw, q_kvar)
        valores = {}
        for fase in (1, 2, 3):
            v = TENSION_FASE_V * (1 - 0.00004 * abs(p_kw)) + self.ruido(0.6)
            i = s_kva * 1000 / (3 * v) * (1 + self.ruido(0.03))
            valores[f"tension_l{fase}_v"] = v
            valores[f"corriente_l{fase}_a"] = max(0.0, i)
        valores["frecuencia_hz"] = 50 + self.ruido(0.015)
        valores["thd_tension_pct"] = max(0.5, 2.0 + 1.0 * carga_relativa + self.ruido(0.15))
        valores["thd_corriente_pct"] = max(2.0, 8 + 25 * (1 - min(1.0, carga_relativa)) + self.ruido(1.0))
        valores["factor_potencia"] = abs(p_kw) / s_kva if s_kva > 0 else 1.0
        return valores


class AnalizadorRed(_Medidor):
    tipo = "analizador_red"

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.energia_reactiva_kvarh = 0.0
        self.p_max_ref = 1.0

    def iniciar(self, t):
        self.energia_kwh = sum(h.energia_kwh for h in self.hijos) * (1 + self.perdidas)
        self.energia_reactiva_kvarh = sum(energia_reactiva(h) for h in self.hijos) * (1 + self.perdidas)

    def paso(self, t0, t1):
        # Los contadores siempre suben: se recalculan a partir de los de los equipos medidos
        self.energia_kwh = sum(h.energia_kwh for h in self.hijos) * (1 + self.perdidas)
        self.energia_reactiva_kvarh = sum(energia_reactiva(h) for h in self.hijos) * (1 + self.perdidas)

    def muestrear(self, t):
        p = sum(h.potencia_kw for h in self.hijos) * (1 + self.perdidas)
        q = sum(reactiva_kvar(h) for h in self.hijos) * (1 + self.perdidas)
        self.p_max_ref = max(self.p_max_ref, p)
        self.potencia_kw, self.q_kvar = p, q
        valores = self.magnitudes(p, q, p / self.p_max_ref)
        valores.update({
            "potencia_activa_kw": p,
            "potencia_reactiva_kvar": q,
            "potencia_aparente_kva": math.hypot(p, q),
            "energia_activa_kwh": self.energia_kwh,
            "energia_reactiva_kvarh": self.energia_reactiva_kvarh,
        })
        return valores


class ContadorGeneral(_Medidor):
    """Contador de la acometida: energía importada/exportada, tarifa y coste."""
    tipo = "contador_general"
    canales = ("telemetria", "eventos")

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.ids_generacion = cfg.get("generacion", [])
        self.importada = 0.0
        self.exportada = 0.0
        self.energia_reactiva_kvarh = 0.0
        self.coste = 0.0
        self.ingresos = 0.0
        self._prev_cons = self._prev_gen = 0.0
        self._cuarto = None            # índice del cuarto de hora en curso
        self._acum = {"imp": 0.0, "exp": 0.0, "coste": 0.0}
        self.media_15min = 0.0
        self.maximetro = 0.0
        self._mes = None
        self._reactiva0 = 0.0
        self._cuarto_parcial = False

    @property
    def generadores(self):
        return [self.planta.equipos[i] for i in self.ids_generacion]

    def _totales(self):
        cons = sum(h.energia_kwh for h in self.hijos)
        gen = sum(g.energia_generada_kwh for g in self.generadores)
        return cons, gen

    def iniciar(self, t):
        self._prev_cons, self._prev_gen = self._totales()
        # Lecturas de partida: el contador lleva tiempo instalado
        self.importada = self.rng.uniform(400000, 600000)
        self.exportada = self.rng.uniform(20000, 40000)
        self._reactiva0 = self.importada * 0.45
        self._cuarto = int(t // 900)
        self._cuarto_parcial = t % 900 != 0      # si se empieza a mitad de un cuarto, no se publica
        self._mes = a_local(t, self.planta.tz).month

    def _cerrar_cuarto(self):
        if self._cuarto_parcial:
            self._cuarto_parcial = False
            self._acum = {"imp": 0.0, "exp": 0.0, "coste": 0.0}
            return
        ini = self._cuarto * 900
        tarifa = self.planta.tarifa
        periodo = tarifa.periodo(ini)
        media = self._acum["imp"] * 4          # kWh en 15 min -> kW medios
        self.media_15min = media
        self.maximetro = max(self.maximetro, media)
        self.planta.registro("curva", {
            "ts_inicio": a_iso(ini), "ts_fin": a_iso(ini + 900), "periodo": periodo,
            "energia_importada_kwh": round(self._acum["imp"], 3),
            "energia_exportada_kwh": round(self._acum["exp"], 3),
            "potencia_media_kw": round(media, 2),
            "coste_eur": round(self._acum["coste"], 4),
        })
        contratada = tarifa.contratada[periodo]
        if media > contratada:
            codigo, mensaje = catalogo.EXCESO_POTENCIA
            self.evento(ini + 900, "exceso_potencia", "aviso", codigo,
                        f"{self.id}: {mensaje} ({media:.1f} kW > {contratada} kW, {periodo})",
                        potencia_media_kw=round(media, 2), contratada_kw=contratada, periodo=periodo)
        self._acum = {"imp": 0.0, "exp": 0.0, "coste": 0.0}

    def paso(self, t0, t1):
        cons, gen = self._totales()
        neto = (cons - self._prev_cons) * (1 + self.perdidas) - (gen - self._prev_gen)
        self._prev_cons, self._prev_gen = cons, gen
        imp, exp = max(0.0, neto), max(0.0, -neto)
        tarifa = self.planta.tarifa
        precio = tarifa.precio((t0 + t1) / 2)
        self.importada += imp
        self.exportada += exp
        self.coste += imp * precio
        self.ingresos += exp * tarifa.precio_excedentes
        self.energia_reactiva_kvarh = self._reactiva0 + sum(energia_reactiva(h) for h in self.hijos)
        cuarto = int((t1 - 1e-6) // 900)
        if cuarto != self._cuarto:
            self._cerrar_cuarto()
            self._cuarto = cuarto
        self._acum["imp"] += imp
        self._acum["exp"] += exp
        self._acum["coste"] += imp * precio
        mes = a_local(t1, self.planta.tz).month
        if mes != self._mes:
            self._mes, self.maximetro = mes, 0.0      # el maxímetro se reinicia cada mes

    def muestrear(self, t):
        cons = sum(h.potencia_kw for h in self.hijos) * (1 + self.perdidas)
        gen = sum(g.potencia_generada_kw for g in self.generadores)
        neto = cons - gen
        q = sum(reactiva_kvar(h) for h in self.hijos)
        self.potencia_kw, self.q_kvar = neto, q
        tarifa = self.planta.tarifa
        periodo = tarifa.periodo(t)
        valores = self.magnitudes(neto, q, abs(neto) / tarifa.contratada[periodo])
        valores.update({
            "potencia_activa_kw": neto,             # positiva: importa; negativa: exporta
            "potencia_importada_kw": max(0.0, neto),
            "potencia_exportada_kw": max(0.0, -neto),
            "potencia_reactiva_kvar": q,
            "energia_importada_kwh": self.importada,
            "energia_exportada_kwh": self.exportada,
            "energia_reactiva_kvarh": self.energia_reactiva_kvarh,
            "periodo_tarifario": periodo,
            "precio_eur_kwh": tarifa.precios[periodo],
            "coste_acumulado_eur": self.coste,
            "ingresos_excedentes_eur": self.ingresos,
            "potencia_media_15min_kw": self.media_15min,
            "maximetro_kw": self.maximetro,
            "potencia_contratada_kw": tarifa.contratada[periodo],
        })
        return valores
