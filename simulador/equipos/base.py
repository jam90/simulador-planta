"""Clase base de todos los equipos."""
import random

from .. import catalogo

# Estados de la línea (los decide el PLC)
PARADA = "PARADA"
ARRANQUE = "ARRANQUE"
PRODUCCION = "PRODUCCION"
MICROPARADA = "MICROPARADA"
AVERIA = "AVERIA"
MANTENIMIENTO = "MANTENIMIENTO"
CAMBIO_FORMATO = "CAMBIO_FORMATO"
# Estado de un equipo cuando la línea está parada por culpa de otro equipo
ESPERA = "ESPERA"

# Estados en los que los equipos de la línea están "con tensión" (servos activos)
ACTIVOS = {ARRANQUE, PRODUCCION, MICROPARADA, CAMBIO_FORMATO, ESPERA}


class Equipo:
    tipo = "generico"
    fp = 0.95                 # factor de potencia típico de la carga
    canales = ("telemetria",)  # qué publica (topics y carpetas); los eventos, solo si los genera

    def __init__(self, cfg: dict, linea_id: str, planta):
        self.id = cfg["id"]
        self.cfg = cfg
        self.descripcion = cfg.get("descripcion", "")
        self.linea_id = linea_id
        self.p = cfg.get("parametros", {}) or {}
        self.planta = planta
        self.rng = random.Random(f"{planta.semilla}-{self.id}")
        self.estado = PARADA
        self.energia_kwh = 0.0     # contador de energía activa consumida
        self.potencia_kw = 0.0     # potencia instantánea (en el último muestreo)
        self.incidencias = {}      # incidencias activas provocadas desde fuera

    # --- Ciclo de vida -------------------------------------------------------
    def iniciar(self, t: float):
        """Estado inicial coherente con el instante t."""

    def paso(self, t0: float, t1: float):
        """Avanza el equipo de t0 a t1 (equipos que no dependen de una línea)."""

    def muestrear(self, t: float) -> dict:
        """Valores a publicar en el instante t."""
        return {}

    # --- Utilidades ----------------------------------------------------------
    def ruido(self, sigma: float) -> float:
        return self.rng.gauss(0, sigma)

    def consumir(self, potencia_kw: float, dt_s: float):
        self.energia_kwh += potencia_kw * dt_s / 3600

    def evento(self, t, tipo_evento, severidad="info", codigo=None, mensaje="", **datos):
        self.planta.evento(t, self, tipo_evento, severidad, codigo, mensaje, datos)


class EquipoLinea(Equipo):
    """Equipo que depende del estado de una línea de producción (PLC, robot, CNC)."""
    canales = ("telemetria", "eventos")

    def __init__(self, cfg, linea_id, planta):
        super().__init__(cfg, linea_id, planta)
        f = cfg.get("fiabilidad", {}) or {}
        self.microparadas_h = f.get("microparadas_por_hora", 0)
        self.horas_entre_averias = f.get("horas_entre_averias", 0)
        self.minutos_reparacion = f.get("minutos_reparacion", [20, 60])

    def segmento(self, a: float, b: float, estado: str):
        """La línea informa de que entre a y b el equipo ha estado en `estado`."""

    def nueva_pieza(self, t: float, linea):
        """Llega una pieza al equipo. Puede devolver una petición de parada:
        {"estado": MICROPARADA | AVERIA, "codigo", "mensaje", "duracion_s", "accion"}"""
        return None

    def instante_averia_degradacion(self) -> float:
        """Instante (epoch) en que la degradación provoca una avería, o inf."""
        return float("inf")

    def averia_degradacion(self):
        return None

    def reparar(self, t: float, codigo: str):
        """Fin de una avería de este equipo."""

    def mantenimiento_preventivo(self, t: float):
        """Comienza una parada de mantenimiento planificada."""

    def microparadas(self) -> list:
        """(código, mensaje) de las microparadas que puede provocar este equipo."""
        return catalogo.MICROPARADAS.get(self.tipo, [])

    def averias(self) -> list:
        """(código, descripción, acción) de las averías que puede tener este equipo."""
        return catalogo.AVERIAS.get(self.tipo, [])

    def cambio_referencia(self, t: float, anterior: str, nueva: str):
        """La línea pasa a fabricar otra referencia."""

    def contribucion_nok(self) -> float:
        """Probabilidad extra de pieza defectuosa debida al estado del equipo."""
        return 0.0
