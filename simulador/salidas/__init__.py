"""Salidas del simulador. Cada una se activa en la sección `salidas` de planta.yaml."""
import os
from zoneinfo import ZoneInfo

from .curva_csv import SalidaCurvaCsv
from .jsonl import SalidaJsonl
from .logs import SalidaLogs


def crear_salidas(config: dict) -> list:
    tz = ZoneInfo(config["planta"].get("zona_horaria", "Europe/Madrid"))
    cfg = config.get("salidas", {}) or {}
    salidas = []
    if cfg.get("jsonl", {}).get("activa"):
        salidas.append(SalidaJsonl(cfg["jsonl"]["ruta"], tz, cfg["jsonl"].get("agrupar", "equipo")))
    if cfg.get("curva_csv", {}).get("activa"):
        salidas.append(SalidaCurvaCsv(cfg["curva_csv"]["ruta"], tz))
    if cfg.get("logs", {}).get("activa"):
        salidas.append(SalidaLogs(cfg["logs"]["ruta"], tz))
    if cfg.get("mqtt", {}).get("activa"):
        from .mqtt import SalidaMqtt
        m = cfg["mqtt"]
        # En Docker, MQTT_HOST apunta al contenedor del broker
        host = os.environ.get("MQTT_HOST", m.get("host", "localhost"))
        salidas.append(SalidaMqtt(host, m.get("puerto", 1883), m.get("prefijo", "fabrica")))
    return salidas
