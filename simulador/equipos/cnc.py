"""Centro de mecanizado CNC."""
from .. import catalogo
from ..tiempo import primer_orden
from .base import ACTIVOS, AVERIA, MICROPARADA, PRODUCCION, EquipoLinea

P_CORTE_KW = 14.0
P_VACIO_KW = 3.0           # máquina encendida sin mecanizar
P_REPOSO_KW = 1.2


class Cnc(EquipoLinea):
    tipo = "cnc"
    fp = 0.85

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.rpm_nominal = self.p.get("rpm_nominal", 8000)
        self.mecanizado_s = self.p.get("mecanizado_s", 40)
        self.vida = self.p.get("vida_herramienta_piezas", 400)
        self.desgaste = 0.0         # % de vida de la herramienta consumida
        self.herramienta_n = 1
        self.limite_cambio = 95.0
        self.refrigerante = 90.0
        self.mec_ini = self.mec_fin = 0.0
        self.temp_husillo = 25.0

    @property
    def herramienta_id(self):
        return f"H-{self.herramienta_n:04d}"

    def iniciar(self, t):
        self.temp_husillo = self.planta.temp_nave() + 3
        self.desgaste = self.rng.uniform(0, 60)
        self.refrigerante = self.rng.uniform(50, 95)
        self.limite_cambio = self.rng.uniform(92, 100)

    def _nueva_herramienta(self):
        self.herramienta_n += 1
        self.desgaste = 0.0
        self.limite_cambio = self.rng.uniform(92, 100)

    def nueva_pieza(self, t, linea):
        self.mec_ini = max(t, self.mec_fin)
        dur = self.mecanizado_s * self.rng.uniform(0.98, 1.03) * (1 + 0.1 * self.desgaste / 100)
        self.mec_fin = self.mec_ini + dur
        self.desgaste += 100 / self.vida * self.rng.uniform(0.8, 1.2)
        self.refrigerante -= 0.01
        if self.refrigerante < 20:
            self.refrigerante = 95.0
            self.evento(t, "reposicion_refrigerante", "info", None, f"{self.id}: reposición de refrigerante")
        if self.rng.random() < 0.0001:
            anterior = self.herramienta_id
            self._nueva_herramienta()
            codigo, desc, accion = catalogo.ROTURA_HERRAMIENTA
            return {"estado": AVERIA, "codigo": codigo, "mensaje": f"{desc} ({anterior})",
                    "accion": accion, "duracion_s": self.rng.uniform(10, 25) * 60}
        if self.desgaste >= self.limite_cambio:
            anterior = self.herramienta_id
            self._nueva_herramienta()
            codigo, mensaje = catalogo.CAMBIO_HERRAMIENTA
            self.evento(t, "cambio_herramienta", "info", codigo,
                        f"{self.id}: {mensaje} ({anterior} -> {self.herramienta_id})",
                        anterior=anterior, nueva=self.herramienta_id)
            return {"estado": MICROPARADA, "codigo": codigo, "mensaje": mensaje,
                    "duracion_s": self.rng.uniform(120, 240)}
        return None

    def mantenimiento_preventivo(self, t):
        self.refrigerante = 95.0

    def contribucion_nok(self):
        return 0.03 if self.desgaste > 80 else 0.0

    def segmento(self, a, b, estado):
        dt = b - a
        linea = self.planta.lineas[self.linea_id]
        d = self.desgaste / 100
        if estado == PRODUCCION:
            frac = min(1.0, self.mecanizado_s / linea.intervalo_pieza)
            p = P_VACIO_KW + (P_CORTE_KW - P_VACIO_KW) * frac * (1 + 0.3 * d)
            objetivo = self.planta.temp_nave() + 25 * (0.6 + 0.4 * d)
        elif estado in ACTIVOS:
            p, objetivo = P_VACIO_KW, self.planta.temp_nave() + 6
        else:
            p, objetivo = P_REPOSO_KW, self.planta.temp_nave() + 1
        self.consumir(p, dt)
        self.temp_husillo = primer_orden(self.temp_husillo, objetivo, dt, 900)

    def muestrear(self, t):
        d = self.desgaste / 100
        mecanizando = self.mec_ini <= t < self.mec_fin
        if mecanizando:
            rpm = self.rpm_nominal * (1 + self.ruido(0.003))
            carga = (45 + 25 * d) * (1 + self.ruido(0.05))
            vibracion = (1.2 + 2.0 * d) * (1 + self.ruido(0.08))
            self.potencia_kw = P_CORTE_KW * (1 + 0.3 * d) * (1 + self.ruido(0.05))
        else:
            rpm, carga = 0.0, 0.0
            vibracion = 0.15 + abs(self.ruido(0.05))
            self.potencia_kw = (P_VACIO_KW if self.estado in ACTIVOS else P_REPOSO_KW) * (1 + self.ruido(0.03))
        linea = self.planta.lineas[self.linea_id]
        return {
            "programa": "CNC-" + linea.referencia.split("-")[-1],
            "herramienta_id": self.herramienta_id,
            "rpm_husillo": rpm,
            "carga_husillo_pct": carga,
            "vibracion_mm_s": vibracion,
            "temp_husillo_c": self.temp_husillo + self.ruido(0.1),
            "desgaste_herramienta_pct": self.desgaste,
            "nivel_refrigerante_pct": self.refrigerante,
            "potencia_kw": self.potencia_kw,
        }
