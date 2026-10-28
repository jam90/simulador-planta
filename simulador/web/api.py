"""Interfaz web (FastAPI): controla el simulador en modo vivo.

Permite elegir qué equipos se publican, activar o desactivar salidas, cambiar
la velocidad, ensuciar los datos y provocar incidencias.
"""
import os
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..equipos import EquipoLinea
from ..tiempo import a_iso, a_local

ESTATICOS = Path(__file__).with_name("static")
NOMBRE_CANAL = {"telemetria": "Telemetría", "eventos": "Eventos (solo cuando ocurren)",
                "inspecciones": "Inspecciones (una por pieza)", "ordenes": "Órdenes de fabricación (al cerrarse)"}


def acceso(motor, eq) -> dict:
    """Cómo leer un equipo: topics MQTT, servidor para Node-RED y carpetas de ficheros."""
    salidas = {s.nombre: s for s in motor.salidas}
    mqtt, jsonl = salidas.get("mqtt"), salidas.get("jsonl")
    resultado = {"equipo": eq.id, "mqtt": None, "ficheros": None}
    if mqtt:
        externo = os.environ.get("MQTT_PUERTO_EXTERNO")     # lo pone docker-compose
        if externo:
            servidores = [{"desde": "Node-RED instalado en tu equipo", "servidor": "localhost", "puerto": int(externo)},
                          {"desde": "Node-RED en un contenedor de este docker-compose",
                           "servidor": mqtt.host, "puerto": mqtt.puerto}]
        else:
            servidores = [{"desde": "Node-RED", "servidor": mqtt.host, "puerto": mqtt.puerto}]
        resultado["mqtt"] = {
            "activa": motor.salida_activa["mqtt"], "servidores": servidores,
            "topics": [{"canal": NOMBRE_CANAL[c], "topic": mqtt.topic(c, eq.linea_id, eq.id)} for c in eq.canales],
            "todos": f"{mqtt.prefijo}/{eq.linea_id}/{eq.id}/#",
        }
    if jsonl:
        resultado["ficheros"] = {
            "activa": motor.salida_activa["jsonl"],
            "carpetas": [{"canal": NOMBRE_CANAL[c], "carpeta": jsonl.carpeta(c, eq.linea_id, eq.id)}
                         for c in eq.canales],
        }
    return resultado


class Publicar(BaseModel):
    publicar: bool


class Activa(BaseModel):
    activa: bool


class Control(BaseModel):
    acelerar: float | None = None
    pausado: bool | None = None


class Incidencia(BaseModel):
    incidencia: str                  # averia | microparada | reparar | fuga_aire | fin_fuga_aire | fallo_inversor
    equipo: str | None = None
    minutos: float = 30


def crear_app(motor) -> FastAPI:
    app = FastAPI(title="Simulador de planta")
    planta = motor.planta

    @app.get("/")
    def inicio():
        return FileResponse(ESTATICOS / "index.html")

    @app.get("/api/estado")
    def estado():
        with motor.lock:
            t = planta.t
            compresor = planta.equipo_de_tipo("compresor")
            fv = planta.equipo_de_tipo("fotovoltaica")
            return {
                "hora_simulada": a_iso(t) if t else None,
                "hora_local": f"{a_local(t, planta.tz):%d/%m/%Y %H:%M:%S}" if t else None,
                "turno": planta.calendario.turno(t) if t else None,
                "acelerar": motor.acelerar,
                "pausado": motor.pausado,
                "contadores": motor.contadores,
                "dato_sucio": motor.sucio.activo,
                "lineas": [{"id": l.id, "descripcion": l.descripcion, "estado": l.estado,
                            "referencia": l.referencia, "motivo": l.motivo,
                            "causa": l.causa.id if l.causa else None} for l in planta.lineas.values()],
                "equipos": [{"id": e.id, "tipo": e.tipo, "linea": e.linea_id, "descripcion": e.descripcion,
                             "estado": e.estado, "publicar": motor.publicar[e.id],
                             "de_linea": isinstance(e, EquipoLinea),
                             "admite_incidencias": planta.admite_incidencias(e)}
                            for e in planta.equipos.values()],
                "salidas": [{"nombre": s.nombre, "activa": motor.salida_activa[s.nombre],
                             "solo_vivo": not s.en_historico, "descripcion": s.descripcion}
                            for s in motor.salidas],
                "incidencias": {
                    "fuga_aire": bool(compresor and "fuga_aire" in compresor.incidencias),
                    "fallo_inversor": bool(fv and fv.fallo_hasta is not None),
                },
                # Averías en curso. restante_real_s: segundos de reloj hasta que se reparen solas
                # a la velocidad actual (None si está en pausa)
                "averias": [{
                    "linea": a["linea"], "equipo": a["equipo"], "codigo": a["codigo"],
                    "descripcion": a["descripcion"],
                    "inicio_local": f"{a_local(a['inicio'], planta.tz):%H:%M:%S}",
                    "fin_local": f"{a_local(a['fin_previsto'], planta.tz):%d/%m %H:%M:%S}",
                    "restante_sim_s": max(0.0, a["fin_previsto"] - t),
                    "restante_real_s": None if motor.pausado
                    else max(0.0, a["fin_previsto"] - t) / motor.acelerar,
                } for a in planta.averias_en_curso()] if t else [],
            }

    @app.post("/api/equipos/{equipo_id}")
    def publicar(equipo_id: str, datos: Publicar):
        if equipo_id not in motor.publicar:
            raise HTTPException(404, f"No existe el equipo {equipo_id}")
        motor.publicar[equipo_id] = datos.publicar
        return {"ok": True}

    @app.post("/api/salidas/{nombre}")
    def salida(nombre: str, datos: Activa):
        if nombre not in motor.salida_activa:
            raise HTTPException(404, f"No existe la salida {nombre}")
        motor.salida_activa[nombre] = datos.activa
        return {"ok": True}

    @app.post("/api/dato_sucio")
    def dato_sucio(datos: Activa):
        motor.sucio.activo = datos.activa
        return {"ok": True}

    @app.post("/api/control")
    def control(datos: Control):
        with motor.lock:
            if datos.acelerar is not None:
                if not 0.1 <= datos.acelerar <= 3600:
                    raise HTTPException(400, "La aceleración debe estar entre 0,1 y 3600")
                motor.acelerar = datos.acelerar
            if datos.pausado is not None:
                motor.pausado = datos.pausado
        return {"ok": True}

    @app.post("/api/incidencias")
    def incidencia(datos: Incidencia):
        with motor.lock:
            try:
                planta.provocar(datos.incidencia, datos.equipo, datos.minutos)
            except (KeyError, ValueError, AttributeError) as exc:
                raise HTTPException(400, str(exc))
        return {"ok": True}

    @app.get("/api/ultimos")
    def ultimos(canal: str | None = None, equipo: str | None = None, n: int = 50):
        with motor.lock:
            if canal:
                mensajes = list(motor.ultimos.get(canal, []))
            else:
                mensajes = [m for cola in motor.ultimos.values() for m in cola]
        if equipo:
            mensajes = [m for m in mensajes if m.get("equipo") == equipo]
        mensajes.sort(key=lambda m: m["ts"], reverse=True)
        return mensajes[:n]

    @app.get("/api/acceso/{equipo_id}")
    def acceso_equipo(equipo_id: str):
        if equipo_id not in planta.equipos:
            raise HTTPException(404, f"No existe el equipo {equipo_id}")
        return acceso(motor, planta.equipos[equipo_id])

    @app.get("/api/valores/{equipo_id}")
    def valores(equipo_id: str):
        with motor.lock:
            m = motor.ultimo_por_equipo.get(equipo_id)
        if not m:
            raise HTTPException(404, "Todavía no hay datos de ese equipo")
        return m

    return app


def servir(motor, intervalo: float, puerto: int = 8000):
    hilo = threading.Thread(target=motor.vivo, args=(intervalo,), daemon=True, name="simulacion")
    hilo.start()
    try:
        uvicorn.run(crear_app(motor), host="0.0.0.0", port=puerto, log_level="warning")
    finally:
        motor.cerrar()
