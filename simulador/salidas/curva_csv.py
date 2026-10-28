"""Curva de carga cuartohoraria en CSV, al estilo de la que facilita la distribuidora.

Formato "a la española" a propósito (para practicar la limpieza del dato):
separador ';', coma decimal, fecha dd/mm/aaaa y hora local.

datos/energia/curva-cuartohoraria-2026-10-08.csv
"""
from datetime import datetime
from pathlib import Path

from .base import FechaLocal, Salida

CABECERA = ["fecha", "hora_inicio", "hora_fin", "periodo", "energia_importada_kwh",
            "energia_exportada_kwh", "potencia_media_kw", "coste_eur"]


def _num(x):
    return f"{x}".replace(".", ",")


class SalidaCurvaCsv(Salida):
    nombre = "curva_csv"
    canales = ("curva",)

    @property
    def descripcion(self):
        return (f"Curva de carga cuartohoraria del contador general en {self.ruta}/, en CSV "
                "«a la española» (con ; y coma decimal), como la que facilita la distribuidora.")

    def __init__(self, ruta, tz):
        self.ruta = Path(ruta)
        self.tz = tz
        self.fecha = FechaLocal(tz)
        self._abierto = None          # (dia, fichero)

    def _fichero(self, dia):
        if not self._abierto or self._abierto[0] != dia:
            if self._abierto:
                self._abierto[1].close()
            self.ruta.mkdir(parents=True, exist_ok=True)
            ruta = self.ruta / f"curva-cuartohoraria-{dia}.csv"
            nuevo = not ruta.exists()
            f = open(ruta, "a", encoding="utf-8")
            if nuevo:
                f.write(";".join(CABECERA) + "\n")
            self._abierto = (dia, f)
        return self._abierto[1]

    def _local(self, ts):
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(self.tz)

    def escribir(self, canal, filas):
        for r in filas:
            ini, fin = self._local(r["ts_inicio"]), self._local(r["ts_fin"])
            linea = [ini.strftime("%d/%m/%Y"), ini.strftime("%H:%M"), fin.strftime("%H:%M"),
                     r["periodo"], _num(r["energia_importada_kwh"]), _num(r["energia_exportada_kwh"]),
                     _num(r["potencia_media_kw"]), _num(r["coste_eur"])]
            self._fichero(self.fecha(r["ts_inicio"])).write(";".join(linea) + "\n")

    def vaciar(self):
        if self._abierto:
            self._abierto[1].flush()

    def cerrar(self):
        if self._abierto:
            self._abierto[1].close()
            self._abierto = None
