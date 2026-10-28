"""Clima exterior: temperatura, humedad, sol y nubes.

No pretende ser un modelo meteorológico: busca curvas creíbles (día/noche,
invierno/verano, días despejados y cubiertos) y reproducibles con la semilla.
"""
import math
import random
from datetime import date, timedelta

from .tiempo import a_local

TIPOS_DIA = ("despejado", "nuboso", "cubierto")


class Clima:
    def __init__(self, cfg: dict, latitud: float, longitud: float, tz, semilla):
        self.media = cfg.get("temp_media_anual_c", 14.5)
        self.amp_anual = cfg.get("amplitud_anual_c", 5.5)
        self.amp_diaria = cfg.get("amplitud_diaria_c", 4.0)
        self.lat = math.radians(latitud)
        self.lon = longitud
        self.tz = tz
        self.semilla = semilla
        self.rng = random.Random(f"{semilla}-clima")
        self._dias = {}
        self._nube = 0.0          # variable latente de las nubes (proceso aleatorio suave)
        self.t = None

    def _dia(self, d: date):
        """Tipo de día y desviación de temperatura; fijos para cada fecha."""
        if d not in self._dias:
            r = random.Random(f"{self.semilla}-clima-{d.isoformat()}")
            invierno = math.cos(2 * math.pi * (d.timetuple().tm_yday - 15) / 365)  # 1 en enero
            p_cubierto = 0.30 + 0.15 * invierno
            p_despejado = 0.30 - 0.12 * invierno
            x = r.random()
            tipo = "cubierto" if x < p_cubierto else "despejado" if x < p_cubierto + p_despejado else "nuboso"
            self._dias[d] = (tipo, r.gauss(0, 1.5))
        return self._dias[d]

    def tipo_dia(self, t: float) -> str:
        return self._dia(a_local(t, self.tz).date())[0]

    def actualizar(self, t: float):
        """Avanza el proceso de nubes hasta t (Ornstein-Uhlenbeck, tau = 15 min)."""
        if self.t is not None:
            dt = max(0.0, t - self.t)
            a = math.exp(-dt / 900)
            self._nube = self._nube * a + math.sqrt(1 - a * a) * self.rng.gauss(0, 1)
        self.t = t

    # --- Temperatura y humedad -------------------------------------------------
    def temp_exterior(self, t: float) -> float:
        loc = a_local(t, self.tz)
        doy = loc.timetuple().tm_yday
        hora = loc.hour + loc.minute / 60
        base = self.media - self.amp_anual * math.cos(2 * math.pi * (doy - 25) / 365)
        # La desviación del día se interpola entre mediodías para evitar saltos a medianoche
        d = loc.date()
        if hora < 12:
            d0, d1, f = d - timedelta(days=1), d, (hora + 12) / 24
        else:
            d0, d1, f = d, d + timedelta(days=1), (hora - 12) / 24
        desv = (1 - f) * self._dia(d0)[1] + f * self._dia(d1)[1]
        factor = {"despejado": 1.2, "nuboso": 0.9, "cubierto": 0.5}[self._dia(d)[0]]
        diaria = self.amp_diaria * factor * math.cos(2 * math.pi * (hora - 15) / 24)
        return base + desv + diaria

    def humedad_exterior(self, t: float) -> float:
        loc = a_local(t, self.tz)
        hora = loc.hour + loc.minute / 60
        extra = {"despejado": -8, "nuboso": 0, "cubierto": 10}[self.tipo_dia(t)]
        h = 75 + extra - 10 * math.cos(2 * math.pi * (hora - 15) / 24)
        return max(30.0, min(98.0, h))

    # --- Sol -------------------------------------------------------------------
    def elevacion_solar(self, t: float) -> float:
        """Seno de la elevación del sol (<= 0 de noche). Fórmula simplificada."""
        loc = a_local(t, self.tz)
        doy = loc.timetuple().tm_yday
        decl = math.radians(23.44) * math.sin(2 * math.pi * (284 + doy) / 365)
        horas_utc = (t % 86400) / 3600
        hora_solar = horas_utc + self.lon / 15
        angulo = math.radians(15 * (hora_solar - 12))
        return (math.sin(self.lat) * math.sin(decl)
                + math.cos(self.lat) * math.cos(decl) * math.cos(angulo))

    def transmision_nubes(self, t: float) -> float:
        tipo = self.tipo_dia(t)
        s = 1 / (1 + math.exp(-3 * self._nube))       # 0..1
        if tipo == "despejado":
            return 0.92 + 0.08 * s
        if tipo == "cubierto":
            return 0.15 + 0.20 * s
        return 0.25 + 0.70 * s

    def irradiancia(self, t: float) -> float:
        """Irradiancia global horizontal en W/m² (cielo despejado x nubes)."""
        s = self.elevacion_solar(t)
        if s <= 0.01:
            return 0.0
        despejado = 1353 * 0.7 ** ((1 / s) ** 0.678) * s
        return despejado * self.transmision_nubes(t)
