"""Calendario de la planta: turnos, descansos, festivos y mantenimiento preventivo.

Para cada instante responde si la planta debe estar produciendo ("produccion"),
en mantenimiento planificado ("mantenimiento") o parada ("parada").
"""
import math
from datetime import date, timedelta

from .tiempo import a_local, epoch_local, parse_hora

DIAS = {"lun": 0, "mar": 1, "mie": 2, "jue": 3, "vie": 4, "sab": 5, "dom": 6}


def _restar(tramos, ini, fin):
    """Quita el intervalo [ini, fin) de una lista de tramos [(a, b), ...]."""
    res = []
    for a, b in tramos:
        if fin <= a or ini >= b:
            res.append((a, b))
            continue
        if a < ini:
            res.append((a, ini))
        if fin < b:
            res.append((fin, b))
    return res


class Calendario:
    def __init__(self, cfg: dict, tz):
        self.tz = tz
        self.turnos = []
        for t in cfg.get("turnos", []):
            if t.get("activo", True):
                self.turnos.append((t["nombre"], parse_hora(t["inicio"]), parse_hora(t["fin"])))
        self.descansos = [(parse_hora(d["inicio"]), d["minutos"]) for d in cfg.get("descansos", [])]
        self.dias_laborables = {DIAS[d] for d in cfg.get("dias_laborables", [])}
        self.festivos = {date.fromisoformat(str(f)) for f in cfg.get("festivos", [])}
        self.mantenimiento = [(DIAS[m["dia"]], parse_hora(m["inicio"]), m["minutos"])
                              for m in cfg.get("mantenimiento_preventivo", [])]
        self._cache = {}

    def es_laborable(self, d: date) -> bool:
        return d.weekday() in self.dias_laborables and d not in self.festivos

    def _intervalos(self, d: date):
        """Intervalos [(ini, fin, modo, turno)] de los turnos que empiezan el día d."""
        if d in self._cache:
            return self._cache[d]
        res = []
        if self.es_laborable(d):
            for nombre, hi, hf in self.turnos:
                ini = epoch_local(d, hi, self.tz)
                fin = epoch_local(d + timedelta(days=1) if hf <= hi else d, hf, self.tz)
                tramos = [(ini, fin)]
                for dd in (d, d + timedelta(days=1)):
                    for hd, minutos in self.descansos:
                        a = epoch_local(dd, hd, self.tz)
                        tramos = _restar(tramos, a, a + minutos * 60)
                # Las ventanas de mantenimiento se marcan dentro de los tramos
                ventanas = [(epoch_local(d, hm, self.tz), epoch_local(d, hm, self.tz) + minutos * 60)
                            for dia, hm, minutos in self.mantenimiento if dia == d.weekday()]
                for a, b in tramos:
                    piezas = [(a, b)]
                    for va, vb in ventanas:
                        piezas = _restar(piezas, va, vb)
                        if va < b and vb > a:
                            res.append((max(a, va), min(b, vb), "mantenimiento", nombre))
                    res.extend((pa, pb, "produccion", nombre) for pa, pb in piezas)
        res.sort()
        self._cache[d] = res
        return res

    def _alrededor(self, t: float, antes=1, despues=1):
        d = a_local(t, self.tz).date()
        for i in range(-antes, despues + 1):
            yield from self._intervalos(d + timedelta(days=i))

    def modo(self, t: float) -> str:
        for ini, fin, modo, _ in self._alrededor(t):
            if ini <= t < fin:
                return modo
        return "parada"

    def turno(self, t: float):
        """Nombre del turno en curso (aunque sea un descanso) o None."""
        d = a_local(t, self.tz).date()
        for dd in (d - timedelta(days=1), d):
            if not self.es_laborable(dd):
                continue
            for nombre, hi, hf in self.turnos:
                ini = epoch_local(dd, hi, self.tz)
                fin = epoch_local(dd + timedelta(days=1) if hf <= hi else dd, hf, self.tz)
                if ini <= t < fin:
                    return nombre
        return None

    def siguiente_cambio(self, t: float) -> float:
        """Primer instante > t en el que puede cambiar el modo."""
        mejor = math.inf
        for ini, fin, _, _ in self._alrededor(t, antes=1, despues=10):
            for b in (ini, fin):
                if t < b < mejor:
                    mejor = b
        return mejor
