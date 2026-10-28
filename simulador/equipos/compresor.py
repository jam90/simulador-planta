"""Compresor de tornillo con depósito de aire.

Regulación carga/vacío: carga hasta consigna + 0,5 bar, pasa a vacío y vuelve a
cargar al bajar de consigna - 0,5 bar. Si pasa mucho tiempo en vacío, se para.
La presión se calcula de forma exacta entre cambios (no depende del muestreo).
"""
import math

from .. import catalogo
from ..tiempo import primer_orden
from .base import (ARRANQUE, AVERIA, CAMBIO_FORMATO, MANTENIMIENTO, MICROPARADA, PARADA,
                   PRODUCCION, Equipo)

CARGA, VACIO, PARADO = "CARGA", "VACIO", "PARADO"

# Consumo de aire de una línea según su estado (m³/min)
AIRE_LINEA = [((PRODUCCION,), 1.6), ((ARRANQUE, CAMBIO_FORMATO), 0.8),
              ((MICROPARADA, AVERIA, MANTENIMIENTO), 0.3), ((PARADA,), 0.1)]


class Compresor(Equipo):
    tipo = "compresor"
    canales = ("telemetria", "eventos")
    fp = 0.86

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        self.consigna = self.p.get("presion_consigna_bar", 7)
        self.banda = 0.5
        self.q_max = self.p.get("caudal_maximo_m3_min", 3.6)
        self.p_carga = self.p.get("potencia_carga_kw", 22)
        self.p_vacio = 0.3 * self.p_carga
        self.fugas = self.p.get("fugas_base_m3_min", 0.25)
        self.volumen_m3 = self.p.get("volumen_deposito_m3", 2.0)
        self.vacio_max_s = 600
        self.presion = self.consigna
        self.estado = VACIO
        self.t_en_vacio = 0.0
        self.temp_aceite = 70.0
        self.horas_marcha = 0.0
        self.caudal = 0.0
        self.alarma_presion = False

    def iniciar(self, t):
        self.horas_marcha = self.rng.uniform(8000, 12000)
        self.temp_aceite = 72.0

    def demanda(self):
        q = self.fugas + self.incidencias.get("fuga_aire", 0.0)
        for linea in self.planta.lineas.values():
            q += sum(linea.fraccion(*estados) * caudal for estados, caudal in AIRE_LINEA)
        return q

    def _potencia(self):
        return {CARGA: self.p_carga, VACIO: self.p_vacio, PARADO: 0.0}[self.estado]

    def paso(self, t0, t1):
        qd = self.demanda()
        self.caudal = qd
        alto, bajo = self.consigna + self.banda, self.consigna - self.banda
        t = t0
        while t < t1:
            q_in = self.q_max if self.estado == CARGA else 0.0
            ritmo = (q_in - qd) / 60 / self.volumen_m3          # bar/s (aprox.)
            hasta, siguiente = math.inf, None
            if self.estado == CARGA and ritmo > 0:
                hasta, siguiente = (alto - self.presion) / ritmo, VACIO
            elif self.estado != CARGA and ritmo < 0:
                hasta, siguiente = (self.presion - bajo) / -ritmo, CARGA
                if self.estado == VACIO and self.vacio_max_s - self.t_en_vacio < hasta:
                    hasta, siguiente = self.vacio_max_s - self.t_en_vacio, PARADO
            dt = min(t1 - t, max(0.0, hasta))
            self.presion = max(0.0, self.presion + ritmo * dt)
            self.consumir(self._potencia(), dt)
            if self.estado != PARADO:
                self.horas_marcha += dt / 3600
            if self.estado == VACIO:
                self.t_en_vacio += dt
            objetivo = {CARGA: 85, VACIO: 75, PARADO: self.planta.temp_nave()}[self.estado]
            self.temp_aceite = primer_orden(self.temp_aceite, objetivo, dt, 600)
            t += dt
            if dt == max(0.0, hasta) and siguiente:
                self.estado = siguiente
                self.t_en_vacio = 0.0
        if self.presion < 5.5 and not self.alarma_presion:
            self.alarma_presion = True
            codigo, mensaje = catalogo.PRESION_BAJA
            self.evento(t1, "alarma", "aviso", codigo, f"{self.id}: {mensaje}",
                        presion_bar=round(self.presion, 2))
        elif self.presion > 6.0:
            self.alarma_presion = False

    def muestrear(self, t):
        self.potencia_kw = self._potencia() * (1 + self.ruido(0.02)) if self.estado != PARADO else 0.0
        return {
            "presion_bar": self.presion + self.ruido(0.02),
            "caudal_m3_min": max(0.0, self.caudal * (1 + self.ruido(0.04))),
            "temp_aceite_c": self.temp_aceite + self.ruido(0.2),
            "horas_marcha": self.horas_marcha,
            "potencia_kw": self.potencia_kw,
        }
