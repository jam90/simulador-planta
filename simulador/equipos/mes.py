"""MES de la línea: órdenes de fabricación con su consumo de materiales.

No es una máquina: no publica telemetría. Publica un mensaje por orden en el
canal `ordenes` al cerrarla, con un array de materiales (material, cantidades,
unidad, lotes). Cada orden fabrica una cantidad fija de una referencia y se
cierra al completarla o si hay antes un cambio de referencia.

Las órdenes se abren con la primera pieza: una orden abierta siempre tiene
piezas. Al final de la simulación la orden en curso queda abierta y no se publica.
"""
from ..tiempo import a_iso, a_local
from .base import EquipoLinea


class Mes(EquipoLinea):
    tipo = "mes"
    canales = ("ordenes",)            # sin telemetría

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.cantidades = self.p.get("cantidad_orden", [200, 600])
        self.materiales = self.p.get("materiales", {})
        self.n_orden = 0
        self.orden = None                 # orden abierta
        self.orden_ultima_pieza = None    # orden a la que pertenece la última pieza
        self.lotes = {}                   # material -> [lote actual, unidades de pieza que le quedan]
        self.n_lote = {m: 0 for m in self.materiales}

    # --- Lotes de material -------------------------------------------------------
    def _nuevo_lote(self, material, t):
        cfg = self.materiales[material]
        self.n_lote[material] += 1
        lote = f"{cfg['lote']['prefijo']}-{a_local(t, self.planta.tz):%y%m}-{self.n_lote[material]:02d}"
        self.lotes[material] = [lote, self.rng.randint(*cfg["lote"]["piezas"])]

    def _lote(self, material, t):
        """Lote del que sale el material de esta pieza (cambia al agotarse)."""
        if material not in self.lotes or self.lotes[material][1] <= 0:
            self._nuevo_lote(material, t)
        self.lotes[material][1] -= 1
        return self.lotes[material][0]

    # --- Órdenes ---------------------------------------------------------------------
    def _abrir(self, t, linea):
        self.n_orden += 1
        paso = 50
        cantidad = self.rng.randrange(self.cantidades[0], self.cantidades[1] + 1, paso)
        self.orden = {
            "orden_id": f"OF-{a_local(t, self.planta.tz):%Y}-{self.n_orden:04d}",
            "referencia": linea.referencia, "inicio": t, "cantidad": cantidad,
            "ok": 0, "nok": 0,
            "materiales": {m: {"prevista": 0.0, "real": 0.0, "lotes": []} for m in self.materiales},
        }

    def _cerrar(self, t, motivo):
        o = self.orden
        materiales = []
        for m, acum in o["materiales"].items():
            cfg = self.materiales[m]
            dec = cfg.get("decimales", 1)
            redondeo = (lambda x: int(round(x))) if dec == 0 else (lambda x, d=dec: round(x, d))
            materiales.append({"material": m, "cantidad_prevista": redondeo(acum["prevista"]),
                               "cantidad_real": redondeo(acum["real"]), "unidad": cfg["unidad"],
                               "lotes": acum["lotes"]})
        self.planta.registro("ordenes", {
            "ts": a_iso(t), "linea": self.linea_id, "equipo": self.id, "tipo": "orden_fabricacion",
            "orden_id": o["orden_id"], "referencia": o["referencia"], "estado": "CERRADA",
            "motivo_cierre": motivo, "inicio": a_iso(o["inicio"]), "fin": a_iso(t),
            "cantidad_planificada": o["cantidad"], "piezas_ok": o["ok"], "piezas_nok": o["nok"],
            "materiales": materiales,
        })
        self.orden = None

    def _consumo(self, material, cfg, referencia):
        """Consumo real de una pieza: el estándar más mermas (y más, si el equipo de origen va mal)."""
        base = cfg["por_pieza"][referencia] if isinstance(cfg["por_pieza"], dict) else cfg["por_pieza"]
        if cfg["unidad"] == "ud":
            # Piezas sueltas: a veces se cae o se estropea alguna
            return base, base + (1 if self.rng.random() < cfg.get("merma_pct", 0) / 100 * base else 0)
        real = base * (1 + self.rng.uniform(0, 2 * cfg.get("merma_pct", 0) / 100))
        origen = self.planta.equipos.get(cfg.get("origen"))
        if origen is not None and getattr(origen, "deg", None):
            real *= origen.factor_deg(self.planta.t)      # el robot degradado gasta más hilo y gas
        return base, real

    def nueva_pieza(self, t, linea):
        if self.orden is None:
            self._abrir(t, linea)
        o = self.orden
        o["ok" if linea.ultima_pieza_ok else "nok"] += 1
        for m, cfg in self.materiales.items():
            prevista, real = self._consumo(m, cfg, o["referencia"])
            acum = o["materiales"][m]
            acum["prevista"] += prevista
            acum["real"] += real
            lote = self._lote(m, t)
            if lote not in acum["lotes"]:
                acum["lotes"].append(lote)
        self.orden_ultima_pieza = o["orden_id"]
        if o["ok"] + o["nok"] >= o["cantidad"]:
            self._cerrar(t, "completada")
        return None

    def cambio_referencia(self, t, anterior, nueva):
        if self.orden is not None:
            self._cerrar(t, "cambio_referencia")
