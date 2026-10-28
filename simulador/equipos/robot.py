"""Robot industrial de 6 ejes."""
import re

from .. import catalogo
from ..tiempo import primer_orden
from .base import ACTIVOS, ARRANQUE, AVERIA, MANTENIMIENTO, PRODUCCION, EquipoLinea

CORRIENTE_NOMINAL_A = [3.0, 5.5, 4.2, 1.6, 1.2, 0.8]   # por eje, en movimiento
P_MOVIMIENTO_KW = 2.6
P_SERVO_KW = 0.6          # servos activos, robot quieto
P_REPOSO_KW = 0.25        # servos apagados (solo el controlador)


class Robot(EquipoLinea):
    tipo = "robot"
    fp = 0.88

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.ciclo_nominal = self.p.get("ciclo_nominal_s", 40)
        self.herramienta = self.p.get("herramienta")          # pinza | soldadura
        self.tiene_pinza = self.herramienta == "pinza"
        self.ciclos_total = 0
        self.ultimo_ciclo_s = self.ciclo_nominal
        self.ciclo_ini = self.ciclo_fin = 0.0
        self.temps = [25.0] * 6
        self.pinza_cerrada = False
        self._pendientes = []           # cambios de pinza programados: (t, valor)
        deg = cfg.get("degradacion")
        self.deg = None
        if deg:
            eje = int(re.search(r"eje(\d)", deg["variable"]).group(1))
            self.deg = {"eje": eje - 1, "deriva": deg["deriva_por_dia"],
                        "limite": deg["averia_al_superar"],
                        "minutos": deg.get("minutos_reparacion", [120, 240])}
            self.deg_t0 = 0.0           # instante en que el factor de degradación valía 1

    def microparadas(self):
        return catalogo.MICROPARADAS["robot"] + catalogo.MICROPARADAS_HERRAMIENTA.get(self.herramienta, [])

    def averias(self):
        return catalogo.AVERIAS["robot"] + catalogo.AVERIAS_HERRAMIENTA.get(self.herramienta, [])

    # --- Degradación -----------------------------------------------------------
    def factor_deg(self, t):
        if not self.deg:
            return 1.0
        return 1 + self.deg["deriva"] * (t - self.deg_t0) / 86400

    def instante_averia_degradacion(self):
        if not self.deg:
            return float("inf")
        return self.deg_t0 + (self.deg["limite"] - 1) / self.deg["deriva"] * 86400

    def averia_degradacion(self):
        codigo, desc, accion = catalogo.DEGRADACION["corriente_eje"]
        eje = self.deg["eje"] + 1
        return (codigo, desc.format(eje=eje), accion.format(eje=eje),
                self.rng.uniform(*self.deg["minutos"]) * 60)

    def reparar(self, t, codigo):
        if self.deg and codigo == catalogo.DEGRADACION["corriente_eje"][0]:
            self.deg_t0 = t

    def contribucion_nok(self):
        return 0.02 if self.factor_deg(self.planta.t) > 1.25 else 0.0

    # --- Simulación ------------------------------------------------------------
    def iniciar(self, t):
        self.temps = [self.planta.temp_nave() + 5] * 6
        if self.deg:
            # Arranca con algo de desgaste acumulado para que la avería no tarde demasiado
            dias_hasta_limite = (self.deg["limite"] - 1) / self.deg["deriva"]
            self.deg_t0 = t - self.rng.uniform(0.2, 0.5) * dias_hasta_limite * 86400

    def nueva_pieza(self, t, linea):
        f = self.factor_deg(t)
        inicio = max(t, self.ciclo_fin)
        dur = self.ciclo_nominal * (1 + 0.25 * (f - 1)) * self.rng.uniform(0.98, 1.04)
        self.ciclo_ini, self.ciclo_fin = inicio, inicio + dur
        self.ultimo_ciclo_s = dur
        self.ciclos_total += 1
        if self.tiene_pinza:
            self._pendientes += [(inicio + 0.15 * dur, True), (inicio + 0.75 * dur, False)]
        return None

    def segmento(self, a, b, estado):
        while self._pendientes and self._pendientes[0][0] <= b:
            ts, valor = self._pendientes.pop(0)
            if valor != self.pinza_cerrada:
                self.pinza_cerrada = valor
                self.evento(ts, "cambio_senal", "info", None,
                            f"{self.id}: pinza {'cerrada' if valor else 'abierta'}",
                            senal="pinza_cerrada", valor=valor)
        dt = b - a
        f = self.factor_deg(b)
        linea = self.planta.lineas[self.linea_id]
        if estado == PRODUCCION:
            ocupacion = min(1.0, self.ultimo_ciclo_s / linea.intervalo_pieza)
            p = P_SERVO_KW + (P_MOVIMIENTO_KW - P_SERVO_KW) * ocupacion * (1 + 0.2 * (f - 1))
            carga = ocupacion
        elif estado in ACTIVOS:
            p, carga = P_SERVO_KW, 0.2
        else:
            p, carga = P_REPOSO_KW, 0.0
        self.consumir(p, dt)
        maximo = max(CORRIENTE_NOMINAL_A)
        for i, inom in enumerate(CORRIENTE_NOMINAL_A):
            extra = f if self.deg and i == self.deg["eje"] else 1.0
            objetivo = self.planta.temp_nave() + 3 + 30 * carga * (inom / maximo) * extra ** 2
            self.temps[i] = primer_orden(self.temps[i], objetivo, dt, 1200)

    def muestrear(self, t):
        estado = self.estado
        f = self.factor_deg(t)
        en_movimiento = self.ciclo_ini <= t < self.ciclo_fin
        corrientes = []
        for i, inom in enumerate(CORRIENTE_NOMINAL_A):
            extra = f if self.deg and i == self.deg["eje"] else 1.0
            if en_movimiento:
                c = inom * extra * self.rng.uniform(0.8, 1.15)
            elif estado in ACTIVOS:
                c = inom * 0.3 * extra * (1 + self.ruido(0.05))
            else:
                c = 0.0
            corrientes.append(c)
        if en_movimiento:
            self.potencia_kw = P_MOVIMIENTO_KW * (1 + 0.2 * (f - 1)) * (1 + self.ruido(0.08))
        elif estado in ACTIVOS:
            self.potencia_kw = P_SERVO_KW * (1 + self.ruido(0.05))
        else:
            self.potencia_kw = P_REPOSO_KW * (1 + self.ruido(0.03))
        linea = self.planta.lineas[self.linea_id]
        valores = {
            "programa": "PRG-" + linea.referencia.split("-")[-1],
            "modo": "MANUAL" if estado in (AVERIA, MANTENIMIENTO) else "AUTO",
            "servo_activo": estado in ACTIVOS or en_movimiento,
            "override_pct": 50 if estado == ARRANQUE else 100,
            "ciclo_s": self.ultimo_ciclo_s,
            "ciclos_total": self.ciclos_total,
        }
        for i, c in enumerate(corrientes):
            valores[f"corriente_eje{i + 1}_a"] = c
        for i, temp in enumerate(self.temps):
            valores[f"temp_motor_eje{i + 1}_c"] = temp + self.ruido(0.1)
        if self.tiene_pinza:
            valores["pinza_cerrada"] = self.pinza_cerrada
        valores["potencia_kw"] = self.potencia_kw
        return valores
