"""Ensucia los mensajes de salida para practicar la limpieza del dato.

Solo afecta a lo que se publica: la simulación interna no cambia.
"""
import random
from datetime import datetime

from .tiempo import a_iso

CONTADORES = ("_total", "_kwh", "_kvarh", "_eur", "horas_marcha")


class DatoSucio:
    def __init__(self, cfg: dict, semilla, tz):
        self.cfg = cfg
        self.activo = cfg.get("activo", False)
        self.rng = random.Random(f"{semilla}-dato-sucio")
        self.tz = tz
        self.desfases = {}         # (equipo, variable) -> valor restado tras un "reinicio"

    def _p(self, nombre):
        return self.rng.random() < self.cfg.get(nombre, 0)

    def _fecha_local(self, ts):
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(self.tz)
        return dt.strftime("%d/%m/%Y %H:%M:%S")

    def telemetria(self, mensajes):
        if not self.activo:
            return mensajes
        salida = []
        for m in mensajes:
            m = {**m, "valores": dict(m["valores"])}
            v = m["valores"]
            for k in v:
                if isinstance(v[k], (int, float)) and k.endswith(CONTADORES):
                    clave = (m["equipo"], k)
                    if self._p("prob_reinicio_contador"):
                        self.desfases[clave] = v[k]
                    if clave in self.desfases:
                        v[k] = round(v[k] - self.desfases[clave], 3)
            numericas = [k for k, x in v.items() if isinstance(x, (int, float)) and not isinstance(x, bool)]
            if numericas and self._p("prob_nulo"):
                v[self.rng.choice(numericas)] = None
            if numericas and self._p("prob_atipico"):
                k = self.rng.choice(numericas)
                if v[k] is not None:
                    v[k] = self.rng.choice([v[k] * 10, -abs(v[k]) - 1, 99999.0])
            if self._p("prob_formato_fecha"):
                m["ts"] = self._fecha_local(m["ts"])
            salida.append(m)
            if self._p("prob_duplicado"):
                salida.append(m)
        return salida

    def eventos(self, eventos):
        if not self.activo:
            return eventos
        salida = []
        for e in eventos:
            salida.append(e)
            if e["tipo_evento"] == "cambio_senal" and self._p("prob_rebote"):
                # Rebote: el contacto vuelve a su estado anterior unos milisegundos
                ts = datetime.fromisoformat(e["ts"].replace("Z", "+00:00")).timestamp()
                valor = e["datos"]["valor"]
                for retardo, val in ((0.004, not valor), (0.011, valor)):
                    texto = "cerrada" if val else "abierta"
                    salida.append({**e, "ts": a_iso(ts + retardo), "datos": {**e["datos"], "valor": val},
                                   "mensaje": f"{e['equipo']}: pinza {texto}"})
            elif self._p("prob_duplicado"):
                salida.append(e)
        return salida

