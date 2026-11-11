"""Observador de la web: recuerda lo que necesita la interfaz y no está en un solo mensaje.

El motor lo llama al final de cada paso con la telemetría, los eventos y los
registros de ese paso, antes del dato sucio y de los filtros de publicación.

Guarda tendencias (últimos minutos), ciclos de robots y CNC, piezas recientes,
cambios de estado de cada línea y acumulados del turno (para los indicadores).

IMPORTANTE: solo lee. No llama a nada que consuma números aleatorios
(muestrear, ruido, rng...): si lo hiciera, cambiarían los datos generados.
"""
import math
from collections import deque
from datetime import datetime

from ..equipos.base import MANTENIMIENTO, PARADA, PRODUCCION

N_TENDENCIA = 720          # muestras por equipo (1 h con muestreo de 5 s)
N_CICLOS = 20
N_PIEZAS = 40
N_ESTADOS = 200
N_EVENTOS = 300
N_INSPECCIONES = 60
N_ORDENES = 30

# Atributos (inicio, fin) del ciclo en curso o del último, según el tipo de equipo
ATRIBUTOS_CICLO = (("ciclo_ini", "ciclo_fin"), ("mec_ini", "mec_fin"))


def epoch(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def finito(x):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else x


class Observador:
    def __init__(self, planta):
        self.planta = planta
        self.t = None
        self.intervalo = None
        self.tendencias = {}       # equipo -> deque[(t, {campo: valor})]
        self.ciclos = {}           # equipo -> deque[(inicio, fin)]
        self.piezas = {}           # linea -> deque[(t, ok)]
        self.estados = {}          # linea -> deque[(t, estado)]
        self.eventos = deque(maxlen=N_EVENTOS)
        self.inspecciones = deque(maxlen=N_INSPECCIONES)
        self.ordenes = deque(maxlen=N_ORDENES)
        self.turnos = {}           # linea -> acumulados del turno
        self._piezas_plc = {}      # linea -> piezas contadas por el PLC en el paso anterior

    # --- Entrada -------------------------------------------------------------------
    def observar(self, t, telemetria, eventos, registros):
        if self.t is not None and t > self.t:
            self.intervalo = t - self.t
        dt = t - self.t if self.t is not None else 0.0
        self.t = t
        for m in telemetria:
            valores = {k: v for k, v in m["valores"].items() if isinstance(v, (int, float))}   # incluye bool
            self.tendencias.setdefault(m["equipo"], deque(maxlen=N_TENDENCIA)).append((t, valores))
        for eq in self.planta.equipos.values():
            for ini, fin in ATRIBUTOS_CICLO:
                if hasattr(eq, ini):
                    cola = self.ciclos.setdefault(eq.id, deque(maxlen=N_CICLOS))
                    ciclo = (getattr(eq, ini), getattr(eq, fin))
                    if ciclo[1] > ciclo[0] and (not cola or cola[-1] != ciclo):
                        cola.append(ciclo)
        self.eventos.extend(eventos)
        self.inspecciones.extend(registros.get("inspecciones", []))
        self.ordenes.extend(registros.get("ordenes", []))
        for linea in self.planta.lineas.values():
            self._linea(t, dt, linea, eventos, registros.get("inspecciones", []))

    def _linea(self, t, dt, linea, eventos, inspecciones):
        estados = self.estados.setdefault(linea.id, deque(maxlen=N_ESTADOS))
        if not estados:
            estados.append((t - dt, linea.estado))
        for e in eventos:
            if e["equipo"] == linea.plc.id and e["tipo_evento"] == "cambio_estado":
                estados.append((epoch(e["ts"]), e["datos"]["nuevo"]))
        # Piezas: la estación de calidad da la hora y el resultado exactos; si no hay, el PLC
        piezas = self.piezas.setdefault(linea.id, deque(maxlen=N_PIEZAS))
        total = linea.plc.piezas_ok + linea.plc.piezas_nok
        propias = [i for i in inspecciones if i.get("linea") == linea.id]
        if propias:
            piezas.extend((epoch(i["ts"]), i["resultado"] == "OK") for i in propias)
        elif linea.id in self._piezas_plc:
            for _ in range(max(0, total - self._piezas_plc[linea.id])):
                piezas.append((t, linea.ultima_pieza_ok))
        self._piezas_plc[linea.id] = total
        self._turno(t, dt, linea)

    def _turno(self, t, dt, linea):
        """Acumulados del turno en curso. Fuera de turno se conservan los del último."""
        cal = self.planta.calendario
        turno = cal.turno(t)
        acum = self.turnos.get(linea.id)
        if turno is None:
            if acum:
                acum["en_curso"] = False
            return
        # Turno nuevo: otro nombre, o el mismo turno de otro día (hay un hueco sin turno entre ambos)
        if acum is None or acum["turno"] != turno or t - acum["ultimo"] > 3600:
            inicio = self._inicio_turno(t, turno)
            contador = self.planta.equipo_de_tipo("contador_general")
            self.turnos[linea.id] = {
                "turno": turno, "en_curso": True, "desde": t, "inicio_turno": inicio,
                # Completo si se empezó a observar al principio del turno (no a mitad)
                "completo": inicio is not None and t - inicio <= 2 * (self.intervalo or 5),
                "ok0": linea.plc.piezas_ok, "nok0": linea.plc.piezas_nok,
                "segundos": {}, "planificado_s": 0.0,
                "importada0": getattr(contador, "importada", 0.0), "coste0": getattr(contador, "coste", 0.0),
                "ultimo": t,
            }
            return
        acum["en_curso"] = True
        acum["ultimo"] = t
        for estado, s in linea.tiempo_estados.items():
            acum["segundos"][estado] = acum["segundos"].get(estado, 0.0) + s
        if dt and cal.modo(t - dt / 2) == "produccion":
            acum["planificado_s"] += dt

    def _inicio_turno(self, t, turno):
        """Instante en que empezó el turno en curso (buscando hacia atrás, minuto a minuto)."""
        cal = self.planta.calendario
        for minutos in range(1, 24 * 60):
            if cal.turno(t - minutos * 60) != turno:
                return (t - minutos * 60) // 60 * 60 + 60
        return None

    # --- Salida para la API ------------------------------------------------------------
    def tendencia(self, equipo, campos=None, n=N_TENDENCIA):
        muestras = list(self.tendencias.get(equipo, ()))[-n:]
        if not muestras:
            return {"t": [], "series": {}}
        nombres = campos or [k for k, v in muestras[-1][1].items() if not isinstance(v, bool)]
        return {"t": [t for t, _ in muestras],
                "series": {c: [v.get(c) for _, v in muestras] for c in nombres}}

    def kpis_linea(self, linea):
        acum = self.turnos.get(linea.id)
        if not acum:
            return None
        ok = linea.plc.piezas_ok - acum["ok0"]
        nok = linea.plc.piezas_nok - acum["nok0"]
        total = ok + nok
        seg = acum["segundos"]
        produccion_s = seg.get(PRODUCCION, 0.0)
        planificado = acum["planificado_s"]
        teoricas = produccion_s / linea.intervalo_pieza
        disponibilidad = produccion_s / planificado if planificado > 0 else None
        rendimiento = min(1.0, total / teoricas) if teoricas >= 1 else None
        calidad = ok / total if total else None
        factores = (disponibilidad, rendimiento, calidad)
        return {
            "turno": acum["turno"], "en_curso": acum["en_curso"], "completo": acum["completo"],
            "desde": acum["desde"], "inicio_turno": acum["inicio_turno"],
            "piezas_ok": ok, "piezas_nok": nok, "piezas": total,
            "pct_nok": 100 * nok / total if total else None,
            "segundos": {k: v for k, v in seg.items() if k not in (PARADA, MANTENIMIENTO) or v},
            "planificado_s": planificado,
            "oee": {
                "disponibilidad": disponibilidad, "rendimiento": rendimiento, "calidad": calidad,
                "oee": math.prod(factores) if None not in factores else None,
            },
        }

    def energia_turno(self):
        """Energía importada y coste desde el inicio del turno (del primer turno que se lleve)."""
        contador = self.planta.equipo_de_tipo("contador_general")
        acum = next(iter(self.turnos.values()), None)
        if not contador or not acum:
            return None
        return {"importada_kwh": contador.importada - acum["importada0"],
                "coste_eur": contador.coste - acum["coste0"]}
