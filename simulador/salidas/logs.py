"""Logs de texto plano, uno por equipo, como los que guardan los controladores.

Cada tipo de equipo usa un formato distinto y la hora local del equipo (sin
zona horaria), igual que en una planta real. Es material para practicar el
filtro grok de Logstash.

  plc-l1.log    2026-10-08 12:15:02.123 | WARN  | L1 | W-101 | Pieza mal posicionada en la cinta
  robot-01.log  08/10/2026 12:15:02 ROBOT-01 [ALARM] W-210: Pieza no detectada en la pinza
  cnc-01.log    [2026-10-08T12:15:02+02:00] CNC-01 WARNING code=W-310 msg="Puerta de la máquina abierta"
"""
from datetime import datetime
from pathlib import Path

from .base import Salida

NIVEL = {"info": "INFO", "aviso": "WARN", "error": "ERROR"}
NIVEL_ROBOT = {"info": "INFO", "aviso": "ALARM", "error": "FAULT"}
NIVEL_CNC = {"info": "INFO", "aviso": "WARNING", "error": "ERROR"}
SIN_LOG = {"cambio_senal"}          # demasiado frecuentes para un log


def _texto(e):
    """El mensaje sin el prefijo 'equipo: '."""
    m = e["mensaje"]
    return m.split(": ", 1)[1] if m.startswith(e["equipo"] + ": ") else m


class SalidaLogs(Salida):
    nombre = "logs"
    canales = ("eventos",)

    @property
    def descripcion(self):
        return (f"Un log de texto por equipo en {self.ruta}/, con un formato distinto según el tipo "
                "de equipo, como los de los controladores reales.")

    def __init__(self, ruta, tz):
        self.ruta = Path(ruta)
        self.tz = tz
        self._ficheros = {}

    def _fichero(self, equipo):
        if equipo not in self._ficheros:
            self.ruta.mkdir(parents=True, exist_ok=True)
            self._ficheros[equipo] = open(self.ruta / f"{equipo}.log", "a", encoding="utf-8")
        return self._ficheros[equipo]

    def _linea(self, e, dt):
        sev, cod, texto = e["severidad"], e["codigo"] or "-", _texto(e)
        if e["tipo"] == "robot":
            nombre = e["equipo"].upper()
            codigo = f"{e['codigo']}: " if e["codigo"] else ""
            return f"{dt:%d/%m/%Y %H:%M:%S} {nombre} [{NIVEL_ROBOT[sev]}] {codigo}{texto}"
        if e["tipo"] == "cnc":
            nombre = e["equipo"].upper()
            texto = texto.replace('"', "'")
            return f"[{dt.isoformat(timespec='seconds')}] {nombre} {NIVEL_CNC[sev]} code={cod} msg=\"{texto}\""
        return f"{dt:%Y-%m-%d %H:%M:%S}.{dt.microsecond // 1000:03d} | {NIVEL[sev]:<5} | {e['linea']} | {cod} | {texto}"

    def escribir(self, canal, eventos):
        for e in eventos:
            if e["tipo_evento"] in SIN_LOG:
                continue
            try:
                dt = datetime.fromisoformat(e["ts"].replace("Z", "+00:00")).astimezone(self.tz)
            except ValueError:
                continue
            self._fichero(e["equipo"]).write(self._linea(e, dt) + "\n")

    def vaciar(self):
        for f in self._ficheros.values():
            f.flush()

    def cerrar(self):
        for f in self._ficheros.values():
            f.close()
        self._ficheros = {}
