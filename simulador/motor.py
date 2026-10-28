"""Motor: hace avanzar la planta (histórico o tiempo real) y reparte los mensajes a las salidas."""
import logging
import threading
import time
from collections import deque

from .dato_sucio import DatoSucio
from .planta import Planta
from .textos.generador import GeneradorTextos

log = logging.getLogger("simulador")


class Motor:
    def __init__(self, config: dict, salidas: list):
        self.config = config
        self.planta = Planta(config)
        self.salidas = salidas
        self.sucio = DatoSucio(config.get("dato_sucio", {}) or {}, self.planta.semilla, self.planta.tz)
        self.publicar = {eq_id: True for eq_id in self.planta.equipos}   # qué equipos se envían
        self.salida_activa = {s.nombre: True for s in salidas}            # qué salidas se usan
        cfg_textos = (config.get("salidas", {}) or {}).get("textos", {}) or {}
        self.textos = None
        if cfg_textos.get("activa"):
            if cfg_textos.get("generador", "plantillas") != "plantillas":
                raise ValueError(f"Generador de textos no disponible: {cfg_textos['generador']}")
            self.textos = GeneradorTextos(self.planta)
        # Últimos mensajes publicados y último valor de cada equipo (para la web)
        self.ultimos = {"telemetria": deque(maxlen=300), "eventos": deque(maxlen=200),
                        "textos": deque(maxlen=50), "inspecciones": deque(maxlen=100), "ordenes": deque(maxlen=50)}
        self.ultimo_por_equipo = {}
        self.lock = threading.RLock()
        self.parar = threading.Event()
        self.acelerar = 1.0
        self.pausado = False
        self.contadores = {"telemetria": 0, "eventos": 0, "textos": 0, "inspecciones": 0, "ordenes": 0}

    # --- Reparto de mensajes ------------------------------------------------------
    def _emitir(self, t, historico=False):
        telem = self.planta.muestrear(t)
        for m in telem:
            self.ultimo_por_equipo[m["equipo"]] = m
        eventos, registros = self.planta.recoger()
        textos = self.textos.observar(t, eventos) if self.textos else []
        telem = [m for m in telem if self.publicar.get(m["equipo"], True)]
        eventos = [e for e in eventos if self.publicar.get(e["equipo"], True)]
        registros = {canal: [m for m in mensajes if self.publicar.get(m.get("equipo"), True)]
                     for canal, mensajes in registros.items()}
        lotes = {"telemetria": self.sucio.telemetria(telem),
                 "eventos": self.sucio.eventos(eventos), "textos": textos, **registros}
        for salida in self.salidas:
            if (historico and not salida.en_historico) or not self.salida_activa[salida.nombre]:
                continue
            for canal, mensajes in lotes.items():
                if mensajes and canal in salida.canales:
                    try:
                        salida.escribir(canal, mensajes)
                    except Exception as exc:          # una salida caída no para la simulación
                        log.warning("Error en la salida %s: %s", salida.nombre, exc)
        self.contadores["telemetria"] += len(lotes["telemetria"])
        self.contadores["eventos"] += len(lotes["eventos"])
        self.contadores["textos"] += len(textos)
        for canal in ("inspecciones", "ordenes"):
            self.contadores[canal] += len(lotes.get(canal, []))
        if not historico:
            for canal, cola in self.ultimos.items():
                cola.extend({"canal": canal, **m} for m in lotes.get(canal, []))

    def _vaciar(self):
        for salida in self.salidas:
            salida.vaciar()

    # --- Modos de ejecución -------------------------------------------------------
    def historico(self, desde: float, hasta: float, intervalo: float):
        """Genera datos de [desde, hasta] tan rápido como se pueda."""
        with self.lock:
            if self.planta.t is None:
                self.planta.iniciar(desde)
            t, ultimo_aviso = self.planta.t, self.planta.t
            while t < hasta:
                t = min(t + intervalo, hasta)
                self.planta.avanzar(t)
                self._emitir(t, historico=True)
                if t - ultimo_aviso >= 86400:
                    ultimo_aviso = t
                    log.info("Histórico: %.0f %% (%d mensajes)",
                             100 * (t - desde) / (hasta - desde), self.contadores["telemetria"])
            self._vaciar()

    def vivo(self, intervalo: float):
        """Avanza al ritmo del reloj (multiplicado por `acelerar`) hasta que se pida parar."""
        with self.lock:
            if self.planta.t is None:
                self.planta.iniciar(time.time() // intervalo * intervalo)
        ancla_real, ancla_sim, ritmo = time.monotonic(), self.planta.t, self.acelerar
        while not self.parar.is_set():
            with self.lock:
                if self.acelerar != ritmo or self.pausado:
                    ancla_real, ancla_sim, ritmo = time.monotonic(), self.planta.t, self.acelerar
                if not self.pausado:
                    objetivo = ancla_sim + (time.monotonic() - ancla_real) * ritmo
                    pasos = 0
                    while self.planta.t + intervalo <= objetivo and pasos < 100:
                        t = self.planta.t + intervalo
                        self.planta.avanzar(t)
                        self._emitir(t)
                        pasos += 1
                    if pasos:
                        self._vaciar()
            self.parar.wait(min(1.0, intervalo / max(ritmo, 1e-6) / 2))

    def cerrar(self):
        self.parar.set()
        for salida in self.salidas:
            salida.cerrar()
