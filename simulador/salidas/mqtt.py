"""Publicación por MQTT (solo en modo vivo).

Topics:
  <prefijo>/<linea>/<equipo>/telemetria
  <prefijo>/<linea>/<equipo>/eventos
  <prefijo>/<linea>/<equipo>/inspecciones   (estación de calidad, una pieza por mensaje)
  <prefijo>/<linea>/mes/ordenes             (órdenes de fabricación, al cerrarse)
  <prefijo>/energia/curva            (un mensaje por cuarto de hora)
  <prefijo>/<linea>/textos           (partes y notas de turno)
"""
import json
import logging

import paho.mqtt.client as mqtt

from .base import Salida

log = logging.getLogger("simulador")


class SalidaMqtt(Salida):
    nombre = "mqtt"
    canales = ("telemetria", "eventos", "curva", "textos", "inspecciones", "ordenes")
    en_historico = False

    def __init__(self, host, puerto=1883, prefijo="fabrica", qos=0):
        self.prefijo = prefijo
        self.host, self.puerto = host, puerto
        self.qos = qos
        self.cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="simulador-planta")
        self.cliente.on_connect = lambda c, u, f, rc, p=None: log.info("MQTT conectado a %s:%s (%s)", host, puerto, rc)
        self.cliente.on_disconnect = lambda c, u, f, rc, p=None: log.warning("MQTT desconectado (%s)", rc)
        self.cliente.on_connect_fail = lambda c, u: self._aviso_fallo(host, puerto)
        self._avisado = False
        self.cliente.reconnect_delay_set(1, 30)
        self.cliente.connect_async(host, puerto)
        self.cliente.loop_start()

    @property
    def descripcion(self):
        return (f"Publica cada mensaje en el broker MQTT, en topics {self.prefijo}/<línea>/<equipo>/<canal> "
                f"(p. ej., {self.prefijo}/L1/cnc-01/telemetria). Es lo que leen Node-RED y Python en vivo.")

    def _aviso_fallo(self, host, puerto):
        if not self._avisado:          # se reintenta en segundo plano; avisamos una sola vez
            self._avisado = True
            log.warning("No se puede conectar al broker MQTT %s:%s. Se reintentará; "
                        "el resto de salidas siguen funcionando.", host, puerto)

    def topic(self, canal, linea=None, equipo=None) -> str:
        if canal == "curva":
            return f"{self.prefijo}/energia/curva"
        if canal == "textos":
            return f"{self.prefijo}/{linea}/textos"
        return f"{self.prefijo}/{linea}/{equipo}/{canal}"

    def escribir(self, canal, mensajes):
        if not self.cliente.is_connected():
            return
        for m in mensajes:
            self.cliente.publish(self.topic(canal, m.get("linea"), m.get("equipo")),
                                 json.dumps(m, ensure_ascii=False), qos=self.qos)

    def cerrar(self):
        self.cliente.loop_stop()
        self.cliente.disconnect()
