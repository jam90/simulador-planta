"""Tarifa eléctrica FICTICIA: periodo (P1..P6) y precio de cada instante."""
from .tiempo import a_local


class Tarifa:
    def __init__(self, cfg: dict, calendario, tz):
        self.precios = cfg["precios_eur_kwh"]
        self.precio_excedentes = cfg.get("precio_excedentes_eur_kwh", 0.0)
        self.contratada = cfg["potencia_contratada_kw"]
        self.mes_temporada = {m: tem for tem, meses in cfg["temporadas"].items() for m in meses}
        self.horas = cfg["horas_laborable"]
        self.calendario = calendario
        self.tz = tz

    def periodo(self, t: float) -> str:
        loc = a_local(t, self.tz)
        d = loc.date()
        if d.weekday() >= 5 or d in self.calendario.festivos:
            return "P6"
        return self.horas[self.mes_temporada[loc.month]][loc.hour]

    def precio(self, t: float) -> float:
        return self.precios[self.periodo(t)]
