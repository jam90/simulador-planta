"""Servicios generales: climatización, iluminación, ambiente de la nave y fotovoltaica."""
import math

from .. import catalogo
from ..tiempo import a_iso, primer_orden
from .base import ACTIVOS, PRODUCCION, Equipo


def _ocupada(planta, t):
    """Hay gente en la nave (turno de producción o mantenimiento)."""
    return planta.calendario.modo(t) != "parada"


class Climatizacion(Equipo):
    tipo = "climatizacion"
    fp = 0.90

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.inv = self.p.get("consigna_invierno_c", 19)
        self.ver = self.p.get("consigna_verano_c", 26)
        self.p_max = self.p.get("potencia_maxima_kw", 30)
        self.objetivo_nave = 20.0
        self.consigna = self.inv
        self.p_actual = 0.0

    def _calcular(self, t):
        lineas = self.planta.lineas.values()
        actividad = sum(l.fraccion(PRODUCCION, *ACTIVOS) for l in lineas) / max(1, len(lineas))
        libre = self.planta.clima.temp_exterior(t) + 2 + 4 * actividad   # sin climatizar
        if _ocupada(self.planta, t):
            self.objetivo_nave = min(max(libre, self.inv), self.ver)
            self.consigna = self.inv if libre < self.inv else self.ver
            self.p_actual = min(self.p_max, 1.5 + 1.8 * abs(libre - self.objetivo_nave))
            self.estado = "CALOR" if libre < self.inv else "FRIO" if libre > self.ver else "VENTILACION"
        else:
            self.objetivo_nave, self.p_actual, self.estado = libre, 0.2, "APAGADO"

    def iniciar(self, t):
        self._calcular(t)

    def paso(self, t0, t1):
        self._calcular(t1)
        self.consumir(self.p_actual, t1 - t0)

    def muestrear(self, t):
        self.potencia_kw = self.p_actual * (1 + self.ruido(0.03))
        return {"consigna_c": self.consigna, "potencia_kw": self.potencia_kw}


class Ambiente(Equipo):
    tipo = "ambiente"

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.temp_nave = 20.0
        self.estado = "OK"

    def _humedad_nave(self, t):
        clima = self.planta.clima
        # Al calentar el aire, su humedad relativa baja (aprox. un 6 % por grado)
        dif = self.temp_nave - clima.temp_exterior(t)
        return min(90.0, max(25.0, clima.humedad_exterior(t) * math.exp(-0.06 * dif)))

    def iniciar(self, t):
        self.temp_nave = min(max(self.planta.clima.temp_exterior(t) + 3, 17), 26)

    def paso(self, t0, t1):
        clim = self.planta.equipo_de_tipo("climatizacion")
        objetivo = clim.objetivo_nave if clim else self.planta.clima.temp_exterior(t1) + 3
        self.temp_nave = primer_orden(self.temp_nave, objetivo, t1 - t0, 6 * 3600)

    def muestrear(self, t):
        clima = self.planta.clima
        return {
            "temp_nave_c": self.temp_nave + self.ruido(0.05),
            "humedad_nave_pct": self._humedad_nave(t) + self.ruido(0.3),
            "temp_exterior_c": clima.temp_exterior(t) + self.ruido(0.1),
            "humedad_exterior_pct": clima.humedad_exterior(t) + self.ruido(0.5),
        }


class Iluminacion(Equipo):
    tipo = "iluminacion"
    fp = 0.95

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.p_nom = self.p.get("potencia_kw", 9)
        self.p_emerg = self.p.get("potencia_emergencia_kw", 0.8)
        self.p_actual = self.p_emerg

    def _calcular(self, t):
        if _ocupada(self.planta, t):
            luz_natural = min(1.0, self.planta.clima.irradiancia(t) / 600)
            self.p_actual = self.p_nom * (1 - 0.4 * luz_natural)   # regulación por luz natural
            self.estado = "ENCENDIDA"
        else:
            self.p_actual, self.estado = self.p_emerg, "EMERGENCIA"

    def iniciar(self, t):
        self._calcular(t)

    def paso(self, t0, t1):
        self._calcular(t1)
        self.consumir(self.p_actual, t1 - t0)

    def muestrear(self, t):
        self.potencia_kw = self.p_actual * (1 + self.ruido(0.01))
        return {"nivel_pct": 100 * self.p_actual / self.p_nom, "potencia_kw": self.potencia_kw}


class Fotovoltaica(Equipo):
    """Genera energía: no suma a energia_kwh (consumo), sino a energia_generada_kwh."""
    tipo = "fotovoltaica"
    canales = ("telemetria", "eventos")

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.p_pico = self.p.get("potencia_pico_kw", 100)
        f = cfg.get("fiabilidad", {}) or {}
        self.mtbf_h = f.get("horas_entre_averias", 0)
        self.minutos_reparacion = f.get("minutos_reparacion", [120, 1440])
        self.energia_generada_kwh = 0.0
        self.potencia_generada_kw = 0.0
        self.irradiancia = 0.0
        self.temp_panel = 15.0
        self.fallo_hasta = None
        self.restante_fallo = math.inf
        self.estado = "ESPERA"

    def iniciar(self, t):
        self.energia_generada_kwh = self.rng.uniform(150000, 250000)   # instalación con años
        self.restante_fallo = self.rng.expovariate(1 / (self.mtbf_h * 3600)) if self.mtbf_h else math.inf
        self._calcular(t)

    def _calcular(self, t):
        clima = self.planta.clima
        self.irradiancia = clima.irradiancia(t)
        self.temp_panel = clima.temp_exterior(t) + 0.03 * self.irradiancia
        if self.fallo_hasta is not None:
            p = 0.0
        else:
            p = self.p_pico * self.irradiancia / 1000 * (1 - 0.004 * (self.temp_panel - 25)) * 0.85
        self.potencia_generada_kw = max(0.0, p)

    def averiar(self, t, minutos):
        codigo, desc, accion = catalogo.AVERIAS["fotovoltaica"][0]
        self.fallo_desde = t
        self.fallo_hasta = t + minutos * 60
        self.estado = "FALLO"
        self.evento(t, "averia_inicio", "error", codigo, f"{self.id}: {desc}", descripcion=desc)

    def paso(self, t0, t1):
        if self.fallo_hasta is not None and t1 >= self.fallo_hasta:
            codigo, desc, accion = catalogo.AVERIAS["fotovoltaica"][0]
            self.evento(self.fallo_hasta, "averia_fin", "info", codigo, f"{self.id}: reparado - {accion}",
                        descripcion=desc, accion=accion, inicio=a_iso(self.fallo_desde),
                        duracion_min=round((self.fallo_hasta - self.fallo_desde) / 60, 1))
            self.fallo_hasta = None
            self.restante_fallo = self.rng.expovariate(1 / (self.mtbf_h * 3600)) if self.mtbf_h else math.inf
        p_antes = self.potencia_generada_kw
        self._calcular(t1)
        dt = t1 - t0
        self.energia_generada_kwh += (p_antes + self.potencia_generada_kw) / 2 * dt / 3600
        if self.fallo_hasta is None and self.potencia_generada_kw > 0:
            self.restante_fallo -= dt
            if self.restante_fallo <= 0:
                self.averiar(t1, self.rng.uniform(*self.minutos_reparacion))
        if self.fallo_hasta is None:
            self.estado = "PRODUCIENDO" if self.potencia_generada_kw > 0.1 else "ESPERA"

    def muestrear(self, t):
        ruido = (1 + self.ruido(0.01)) if self.potencia_generada_kw > 0 else 1
        return {
            "irradiancia_w_m2": self.irradiancia * ruido,
            "potencia_generada_kw": self.potencia_generada_kw * ruido,
            "energia_generada_kwh": self.energia_generada_kwh,
            "temp_panel_c": self.temp_panel + self.ruido(0.2),
            "estado_inversor": "FALLO" if self.fallo_hasta is not None else "OK",
        }
