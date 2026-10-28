"""Estación de inspección de calidad al final de la línea.

Mide todas las piezas y publica, por cada una, un mensaje en el canal
`inspecciones` con un array de medidas (cota, valor, tolerancias, unidad,
resultado). El resultado coincide con los contadores del PLC: si la línea ha
dado la pieza por defectuosa, al menos una cota sale fuera de tolerancia.

La cota que falla depende de la causa: la herramienta gastada de la CNC
estropea las cotas de mecanizado y el robot de soldadura degradado, las de
soldadura. Por eso los NOK se concentran donde hay un problema real.
"""
from ..tiempo import a_iso, a_local
from .base import EquipoLinea


class Inspeccion(EquipoLinea):
    tipo = "inspeccion"
    canales = ("telemetria", "inspecciones")

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.cotas = self.p.get("cotas", {})
        self.inspeccionadas = 0
        self.nok = 0
        self.dia = None              # día local de la última pieza (para numerarlas)
        self.n_dia = 0
        self.ultima_pieza_id = None

    # --- Medida de una pieza ---------------------------------------------------
    def _causa(self, linea):
        """Elige qué provoca el defecto, con el mismo peso que tiene en la tasa de NOK."""
        pesos = [(None, linea.tasa_nok)] + [(eq.id, eq.contribucion_nok()) for eq in linea.equipos]
        pesos = [(c, p) for c, p in pesos if p > 0]
        x = self.rng.random() * sum(p for _, p in pesos)
        for causa, p in pesos:
            x -= p
            if x < 0:
                return causa
        return pesos[-1][0]

    def _sesgo(self, cota, cfg):
        """Desplazamiento de la media (en fracción de la tolerancia) según el estado de la línea."""
        origen = self.planta.equipos.get(cfg.get("origen"))
        if origen is None:
            return 0.0
        if origen.tipo == "cnc":
            return -0.5 * origen.desgaste / 100           # la herramienta gastada corta menos
        if origen.tipo == "robot" and origen.deg:
            return 0.8 * (origen.factor_deg(self.planta.t) - 1)
        return 0.0

    def _medir(self, cota, cfg, referencia, falla):
        nominal = cfg["nominal"][referencia] if isinstance(cfg["nominal"], dict) else cfg["nominal"]
        tol = cfg["tolerancia"]
        if falla:
            # Fuera de tolerancia, hacia el lado al que empuja el problema (o al azar)
            sesgo = self._sesgo(cota, cfg)
            signo = (1 if sesgo > 0 else -1) if abs(sesgo) > 0.05 else self.rng.choice([-1, 1])
            desv = signo * tol * self.rng.uniform(1.05, 1.8)
        else:
            desv = tol * (self._sesgo(cota, cfg) + self.rng.gauss(0, 0.25))
            desv = max(-0.95 * tol, min(0.95 * tol, desv))
        dec = cfg.get("decimales", 3)
        return {"cota": cota, "valor": round(nominal + desv, dec), "nominal": nominal,
                "tol_min": -tol, "tol_max": tol, "desviacion": round(desv, dec),
                "unidad": cfg["unidad"], "resultado": "NOK" if falla else "OK"}

    def nueva_pieza(self, t, linea):
        ok = linea.ultima_pieza_ok
        fallan = set()
        if not ok:
            causa = self._causa(linea)
            candidatas = [c for c, cfg in self.cotas.items() if causa is None or cfg.get("origen") == causa]
            candidatas = candidatas or list(self.cotas)
            fallan.add(self.rng.choice(candidatas))
            if len(candidatas) > 1 and self.rng.random() < 0.15:     # a veces fallan dos
                fallan.add(self.rng.choice(candidatas))
        medidas = [self._medir(c, cfg, linea.referencia, c in fallan) for c, cfg in self.cotas.items()]
        dia = f"{a_local(t, self.planta.tz):%Y%m%d}"
        if dia != self.dia:
            self.dia, self.n_dia = dia, 0
        self.n_dia += 1
        self.ultima_pieza_id = f"{self.linea_id}-{dia}-{self.n_dia:05d}"
        self.inspeccionadas += 1
        self.nok += 0 if ok else 1
        self.planta.registro("inspecciones", {
            "ts": a_iso(t), "linea": self.linea_id, "equipo": self.id, "tipo": self.tipo,
            "pieza_id": self.ultima_pieza_id, "orden_id": self._orden(linea), "referencia": linea.referencia,
            "turno": self.planta.calendario.turno(t) or "sin_turno",
            "resultado": "OK" if ok else "NOK", "medidas": medidas,
        })
        return None

    def _orden(self, linea):
        mes = next((e for e in linea.equipos if e.tipo == "mes"), None)
        return mes.orden_ultima_pieza if mes else None

    def muestrear(self, t):
        return {
            "piezas_inspeccionadas_total": self.inspeccionadas,
            "piezas_nok_total": self.nok,
        }
