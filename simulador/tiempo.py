"""Utilidades de tiempo.

Internamente el simulador trabaja con segundos desde 1970 en UTC (float, "epoch").
Así se evitan los problemas del cambio de hora. Solo se pasa a hora local para
decidir turnos, tarifas o el nombre de los ficheros.
"""
import math
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


def a_iso(t: float) -> str:
    """Epoch -> '2026-10-08T10:15:02.123Z' (UTC, milisegundos)."""
    return (datetime.fromtimestamp(t, timezone.utc)
            .isoformat(timespec="milliseconds").replace("+00:00", "Z"))


def a_local(t: float, tz: ZoneInfo) -> datetime:
    return datetime.fromtimestamp(t, tz)


def epoch_local(d: date, hora: time, tz: ZoneInfo) -> float:
    """Fecha + hora locales -> epoch."""
    return datetime.combine(d, hora, tzinfo=tz).timestamp()


def parse_hora(texto: str) -> time:
    h, m = texto.split(":")
    return time(int(h), int(m))


def dias(d: date, n: int) -> date:
    return d + timedelta(days=n)


def primer_orden(x: float, objetivo: float, dt: float, tau: float) -> float:
    """Sistema de primer orden (inercia): x se acerca al objetivo con constante tau."""
    if tau <= 0:
        return objetivo
    return objetivo + (x - objetivo) * math.exp(-dt / tau)
