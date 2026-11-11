"""Interfaz web (FastAPI): controla el simulador en modo vivo.

Permite elegir qué equipos se publican, activar o desactivar salidas, cambiar
la velocidad, ensuciar los datos y provocar incidencias. Además ofrece, solo
para leer, lo que necesita la vista animada de la planta (/api/vista,
/api/tendencia, /api/kpis, /api/plano, /api/recientes).
"""
import json
import os
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..equipos import EquipoLinea
from ..tiempo import a_iso, a_local
from .observador import Observador, finito

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
            "topics": [{"clave": c, "canal": NOMBRE_CANAL[c], "topic": mqtt.topic(c, eq.linea_id, eq.id)} for c in eq.canales],
            "todos": f"{mqtt.prefijo}/{eq.linea_id}/{eq.id}/#",
        }
    if jsonl:
        resultado["ficheros"] = {
            "activa": motor.salida_activa["jsonl"],
            "carpetas": [{"clave": c, "canal": NOMBRE_CANAL[c], "carpeta": jsonl.carpeta(c, eq.linea_id, eq.id)}
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


def variante(eq):
    """Variante de dibujo de un equipo (p. ej., la herramienta de un robot)."""
    return (eq.cfg.get("parametros") or {}).get("herramienta")


def cargar_plano(motor) -> dict:
    """Plano del sinóptico (static/plano.json) cruzado con los equipos reales.

    Un equipo sin posición en el plano aparece igualmente: la web lo coloca sola."""
    planta = motor.planta
    try:
        plano = json.loads((ESTATICOS / "plano.json").read_text(encoding="utf-8"))
        plano.pop("_ayuda", None)
    except (OSError, ValueError):
        plano = {}
    posiciones = plano.pop("equipos", {}) or {}
    plano["equipos"] = [{"id": e.id, "tipo": e.tipo, "variante": variante(e), "linea": e.linea_id,
                         "descripcion": e.descripcion, "posicion": posiciones.get(e.id)}
                        for e in planta.equipos.values()]
    plano["lineas"] = [{"id": l.id, "descripcion": l.descripcion} for l in planta.lineas.values()]
    plano["zonas_desc"] = {l["id"]: l.get("descripcion", "") for l in motor.config.get("lineas", [])}
    plano["zona_horaria"] = str(planta.tz)
    return plano


def avisos(eq, t) -> dict:
    """Señales de problemas que la animación muestra (cálculos puros: no consumen aleatorios)."""
    r = {}
    if getattr(eq, "deg", None) and t:
        # Avería anunciada: cuánto ha crecido la variable respecto a su valor nominal
        r["degradacion"] = {"factor": round(eq.factor_deg(t), 3), "limite": eq.deg["limite"],
                            "variable": eq.cfg["degradacion"]["variable"]}
    if eq.tipo == "compresor":
        r["presion_baja"] = bool(eq.alarma_presion)
        r["fuga_aire"] = "fuga_aire" in eq.incidencias
    return r


def crear_app(motor) -> FastAPI:
    app = FastAPI(title="Simulador de planta")
    planta = motor.planta
    obs = motor.observador = Observador(planta)
    plano = cargar_plano(motor)

    @app.middleware("http")
    async def sin_cache(request: Request, call_next):
        # Que el navegador pregunte siempre por la versión nueva (sigue usando ETag: es barato)
        respuesta = await call_next(request)
        respuesta.headers["Cache-Control"] = "no-cache"
        return respuesta

    app.mount("/static", StaticFiles(directory=ESTATICOS), name="static")

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
                             "solo_vivo": not s.en_historico, "descripcion": s.descripcion,
                             # Para que la web pueda traducir la descripción
                             "parametros": {k: str(getattr(s, k)) for k in ("ruta", "prefijo", "agrupar")
                                            if hasattr(s, k)}}
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

    # --- Solo lectura, para la vista animada ------------------------------------------
    @app.get("/api/plano")
    def plano_planta():
        return plano

    @app.get("/api/vista")
    def vista():
        """Estado de todos los equipos y lo necesario para animar (ciclos, piezas, estados)."""
        with motor.lock:
            t = planta.t
            lineas = []
            for l in planta.lineas.values():
                mes = next((e for e in l.equipos if e.tipo == "mes"), None)
                o = mes.orden if mes else None
                lineas.append({
                    "id": l.id, "estado": l.estado, "causa": l.causa.id if l.causa else None,
                    "codigo": l.codigo, "motivo": l.motivo, "referencia": l.referencia,
                    "fin_estado": finito(l.t_fin_estado), "intervalo_pieza": l.intervalo_pieza,
                    "piezas": list(obs.piezas.get(l.id, ())),
                    "estados": list(obs.estados.get(l.id, ()))[-40:],
                    "orden": {"orden_id": o["orden_id"], "referencia": o["referencia"],
                              "cantidad": o["cantidad"], "ok": o["ok"], "nok": o["nok"],
                              "inicio": o["inicio"]} if o else None,
                })
            equipos = {}
            for e in planta.equipos.values():
                m = motor.ultimo_por_equipo.get(e.id)
                equipos[e.id] = {"estado": e.estado, "valores": m["valores"] if m else None,
                                 "ciclos": list(obs.ciclos.get(e.id, ())), "avisos": avisos(e, t),
                                 "estados": list(obs.estados_eq.get(e.id, ()))[-6:]}
            compresor = planta.equipo_de_tipo("compresor")
            fv = planta.equipo_de_tipo("fotovoltaica")
            return {
                "t": t, "intervalo": obs.intervalo, "acelerar": motor.acelerar, "pausado": motor.pausado,
                "hora_local": f"{a_local(t, planta.tz):%d/%m/%Y %H:%M:%S}" if t else None,
                "turno": planta.calendario.turno(t) if t else None,
                "modo": planta.calendario.modo(t) if t else None,
                "lineas": lineas, "equipos": equipos,
                "kpis": calcular_kpis(),          # en la misma respuesta: todas las cifras del mismo instante
                "incidencias": {
                    "fuga_aire": bool(compresor and "fuga_aire" in compresor.incidencias),
                    "fallo_inversor": bool(fv and fv.fallo_hasta is not None),
                },
            }

    @app.get("/api/tendencia/{equipo_id}")
    def tendencia(equipo_id: str, campos: str | None = None, n: int = 720):
        if equipo_id not in planta.equipos:
            raise HTTPException(404, f"No existe el equipo {equipo_id}")
        with motor.lock:
            return obs.tendencia(equipo_id, campos.split(",") if campos else None, max(1, min(n, 720)))

    def calcular_kpis():
        """Indicadores calculados por la web (no están en los datos que publica el simulador)."""
        contador = planta.equipo_de_tipo("contador_general")
        fv = planta.equipo_de_tipo("fotovoltaica")
        cg = (motor.ultimo_por_equipo.get(contador.id) or {}).get("valores", {}) if contador else {}
        vfv = (motor.ultimo_por_equipo.get(fv.id) or {}).get("valores", {}) if fv else {}
        consumo = sum((motor.ultimo_por_equipo.get(e.id) or {}).get("valores", {}).get("potencia_activa_kw", 0)
                      for e in planta.equipos.values() if e.tipo == "analizador_red")
        return {
            "lineas": {l.id: obs.kpis_linea(l) for l in planta.lineas.values()},
            "energia": {
                "consumo_kw": consumo if consumo else None,
                "generacion_kw": vfv.get("potencia_generada_kw"),
                "neto_kw": cg.get("potencia_activa_kw"),
                "periodo": cg.get("periodo_tarifario"), "precio_eur_kwh": cg.get("precio_eur_kwh"),
                "contratada_kw": cg.get("potencia_contratada_kw"),
                "media_15min_kw": cg.get("potencia_media_15min_kw"), "maximetro_kw": cg.get("maximetro_kw"),
                "coste_acumulado_eur": cg.get("coste_acumulado_eur"),
                "turno": obs.energia_turno(),
            },
        }

    @app.get("/api/kpis")
    def kpis():
        with motor.lock:
            return calcular_kpis()

    @app.get("/api/recientes")
    def recientes(equipo: str | None = None, linea: str | None = None, n: int = 30):
        """Eventos, inspecciones y órdenes recientes tal como ocurren (sin dato sucio ni filtros)."""
        with motor.lock:
            filtra = lambda ms: [m for m in ms if (not equipo or m.get("equipo") == equipo)
                                 and (not linea or m.get("linea") == linea)][-n:][::-1]
            return {"eventos": filtra(obs.eventos), "inspecciones": filtra(obs.inspecciones),
                    "ordenes": filtra(obs.ordenes)}

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
