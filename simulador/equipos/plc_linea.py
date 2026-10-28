"""PLC de línea: estado de la línea, contadores de piezas, cinta y neumática."""
from ..tiempo import primer_orden
from .base import (ARRANQUE, AVERIA, MANTENIMIENTO, MICROPARADA, PARADA, PRODUCCION,
                   EquipoLinea)

POTENCIA_KW = {PRODUCCION: 4.0, ARRANQUE: 3.0, PARADA: 0.8, MANTENIMIENTO: 0.8}
POTENCIA_OTROS_KW = 1.5      # cinta parada pero auxiliares encendidos


class PlcLinea(EquipoLinea):
    tipo = "plc_linea"
    fp = 0.90

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.piezas_ok = 0
        self.piezas_nok = 0
        self.temp_armario = 25.0

    def iniciar(self, t):
        self.temp_armario = self.planta.temp_nave() + 6

    def segmento(self, a, b, estado):
        self.consumir(POTENCIA_KW.get(estado, POTENCIA_OTROS_KW), b - a)
        objetivo = self.planta.temp_nave() + (3 if estado == PARADA else 9)
        self.temp_armario = primer_orden(self.temp_armario, objetivo, b - a, 3600)

    def nueva_pieza(self, t, linea):
        if linea.ultima_pieza_ok:
            self.piezas_ok += 1
        else:
            self.piezas_nok += 1
        return None

    def muestrear(self, t):
        linea = self.planta.lineas[self.linea_id]
        estado = self.estado
        self.potencia_kw = POTENCIA_KW.get(estado, POTENCIA_OTROS_KW) * (1 + self.ruido(0.03))
        if estado == PRODUCCION:
            velocidad = 12 + self.ruido(0.15)
        elif estado == ARRANQUE:
            velocidad = 6 + self.ruido(0.1)
        else:
            velocidad = 0.0
        valores = {
            "modo": "MANUAL" if estado in (AVERIA, MANTENIMIENTO) else "AUTO",
            "turno": self.planta.calendario.turno(t) or "sin_turno",
            "referencia": linea.referencia,
            "piezas_ok_total": self.piezas_ok,
            "piezas_nok_total": self.piezas_nok,
            "velocidad_cinta_m_min": velocidad,
            "temp_armario_c": self.temp_armario + self.ruido(0.1),
            "paro_emergencia": estado == MICROPARADA and linea.codigo == "W-100",
            "potencia_kw": self.potencia_kw,
        }
        compresor = self.planta.equipo_de_tipo("compresor")
        if compresor:
            valores["presion_neumatica_bar"] = max(0.0, compresor.presion - 0.35 + self.ruido(0.03))
        if estado in (MICROPARADA, AVERIA) and linea.codigo:
            valores["codigo_alarma"] = linea.codigo
        return valores
