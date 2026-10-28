"""Ficheros JSON Lines (un objeto JSON por línea), uno por origen, canal y día local.

agrupar: equipo (por defecto). Las carpetas copian los topics MQTT:
  datos/L1/plc-l1/telemetria/2026-10-08.jsonl
  datos/L1/plc-l1/eventos/2026-10-08.jsonl
  datos/L1/calidad-01/inspecciones/2026-10-08.jsonl
  datos/L1/mes/ordenes/2026-10-08.jsonl
  datos/L1/textos/2026-10-08.jsonl            (los textos son de la línea)

agrupar: canal. Todos los equipos juntos:
  datos/telemetria/2026-10-08.jsonl
  datos/eventos/2026-10-08.jsonl
"""
import json
from pathlib import Path

from .base import FechaLocal, Salida


class SalidaJsonl(Salida):
    nombre = "jsonl"
    canales = ("telemetria", "eventos", "textos", "inspecciones", "ordenes")

    def __init__(self, ruta, tz, agrupar="equipo"):
        if agrupar not in ("equipo", "canal"):
            raise ValueError(f"salidas.jsonl.agrupar debe ser 'equipo' o 'canal', no {agrupar!r}")
        self.ruta = Path(ruta)
        self.agrupar = agrupar
        self.fecha = FechaLocal(tz)
        self._ficheros = {}          # clave del origen -> (día, fichero abierto)

    @property
    def descripcion(self):
        donde = (f"{self.ruta}/<línea>/<equipo>/<canal>/" if self.agrupar == "equipo"
                 else f"{self.ruta}/<canal>/")
        return (f"Ficheros JSON Lines, uno por día, en {donde}: telemetría, eventos, "
                "inspecciones, órdenes y textos. Es lo que leen Logstash o Python desde fichero.")

    def _clave(self, canal, m):
        """Partes de la ruta de la carpeta (tupla de textos: es mucho más rápida que Path)."""
        if self.agrupar == "canal":
            return (canal,)
        if canal == "textos":
            return (m["linea"], canal)
        return (m["linea"], m["equipo"], canal)

    def carpeta(self, canal, linea, equipo=None) -> str:
        """Carpeta donde se guarda un canal de un equipo (para mostrarla en la web)."""
        return "/".join((str(self.ruta),) + self._clave(canal, {"linea": linea, "equipo": equipo})) + "/"

    def _fichero(self, clave, dia):
        abierto = self._ficheros.get(clave)
        if abierto and abierto[0] == dia:
            return abierto[1]
        if abierto:                  # cambio de día: se cierra el anterior (se abre en modo "a")
            abierto[1].close()
        carpeta = self.ruta.joinpath(*clave)
        carpeta.mkdir(parents=True, exist_ok=True)
        f = open(carpeta / f"{dia}.jsonl", "a", encoding="utf-8")
        self._ficheros[clave] = (dia, f)
        return f

    def escribir(self, canal, mensajes):
        for m in mensajes:
            ts = m.get("ts") or m.get("ts_inicio", "")
            fichero = self._fichero(self._clave(canal, m), self.fecha(ts))
            fichero.write(json.dumps(m, ensure_ascii=False) + "\n")

    def vaciar(self):
        for _, f in self._ficheros.values():
            f.flush()

    def cerrar(self):
        for _, f in self._ficheros.values():
            f.close()
        self._ficheros = {}
