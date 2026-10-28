"""Interfaz común de las salidas."""
from datetime import datetime


class Salida:
    nombre = "salida"
    canales = ()          # canales que acepta: telemetria, eventos, curva, textos, inspecciones, ordenes
    en_historico = True   # False: no recibe el histórico generado de golpe (p. ej., MQTT)
    descripcion = ""      # frase para la interfaz web

    def escribir(self, canal: str, mensajes: list):
        raise NotImplementedError

    def vaciar(self):
        """Fuerza la escritura de lo pendiente (se llama al final de cada paso en vivo)."""

    def cerrar(self):
        pass


class FechaLocal:
    """Convierte el 'ts' ISO en UTC a fecha local (YYYY-MM-DD), con caché por hora."""

    def __init__(self, tz):
        self.tz = tz
        self._cache = {}

    def __call__(self, ts: str) -> str:
        clave = ts[:13]
        if clave not in self._cache:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                self._cache[clave] = dt.astimezone(self.tz).date().isoformat()
            except ValueError:                 # fecha "sucia": la dejamos en un fichero aparte
                return "fecha-desconocida"
        return self._cache[clave]
