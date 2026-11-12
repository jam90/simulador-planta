"""Pruebas de la interfaz web: endpoints de solo lectura, ficheros estáticos e idiomas."""
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from simulador.motor import Motor
from simulador.salidas import crear_salidas
from simulador.web.api import crear_app
from test_simulador import config, epoch

ESTATICOS = Path(__file__).resolve().parents[1] / "simulador" / "web" / "static"


@pytest.fixture
def web(tmp_path):
    cfg = config(tmp_path)
    motor = Motor(cfg, crear_salidas(cfg))
    cliente = TestClient(crear_app(motor))
    t0 = epoch(2026, 9, 1, 8)          # martes, turno de mañana
    motor.historico(t0, t0 + 1800, 5)
    yield motor, cliente
    motor.cerrar()


def test_vista(web):
    motor, cliente = web
    v = cliente.get("/api/vista").json()
    assert v["t"] == motor.planta.t and v["intervalo"] == 5 and v["turno"] == "manana"
    linea = v["lineas"][0]
    assert linea["id"] == "L1" and linea["estado"] == "PRODUCCION" and linea["piezas"]
    assert linea["orden"]["orden_id"].startswith("OF-2026-")
    assert set(v["equipos"]) == set(motor.planta.equipos)
    assert v["equipos"]["robot-01"]["ciclos"] and v["equipos"]["cnc-01"]["ciclos"]
    ini, fin = v["equipos"]["robot-01"]["ciclos"][-1]
    assert 30 < fin - ini < 60
    assert v["equipos"]["mes"]["valores"] is None            # el MES no publica telemetría
    assert "presion_bar" in v["equipos"]["compresor-01"]["valores"]
    assert v["kpis"]["lineas"]["L1"]["piezas"] > 0          # indicadores del mismo instante que la vista
    assert all(len(e) == 3 for e in linea["estados"])        # (hora, estado, motivo)
    assert any(e[1] == "PRODUCCION" for e in linea["estados"])


def test_tendencia_y_recientes(web):
    _, cliente = web
    tend = cliente.get("/api/tendencia/cnc-01?campos=rpm_husillo,temp_husillo_c&n=100").json()
    assert len(tend["t"]) == 100 and set(tend["series"]) == {"rpm_husillo", "temp_husillo_c"}
    assert cliente.get("/api/tendencia/inventado").status_code == 404
    r = cliente.get("/api/recientes?equipo=calidad-01").json()
    assert r["inspecciones"] and all(i["equipo"] == "calidad-01" for i in r["inspecciones"])
    assert r["inspecciones"][0]["ts"] >= r["inspecciones"][-1]["ts"]      # lo más reciente primero


def test_kpis(web):
    motor, cliente = web
    k = cliente.get("/api/kpis").json()
    l1 = k["lineas"]["L1"]
    assert l1["turno"] == "manana" and l1["en_curso"] and l1["piezas"] > 0
    assert l1["piezas_ok"] + l1["piezas_nok"] == l1["piezas"]
    assert 0 < l1["oee"]["disponibilidad"] <= 1 and 0 < l1["oee"]["calidad"] <= 1
    assert k["energia"]["consumo_kw"] > 0 and k["energia"]["periodo"]


def test_plano_y_estaticos(web):
    _, cliente = web
    plano = cliente.get("/api/plano").json()
    assert {e["id"] for e in plano["equipos"]} >= {"robot-01", "cnc-01", "contador-general"}
    robots = {e["id"]: e["variante"] for e in plano["equipos"] if e["tipo"] == "robot"}
    assert robots == {"robot-01": "pinza", "robot-02": "soldadura"}
    assert cliente.get("/").status_code == 200
    assert cliente.get("/static/js/app.js").status_code == 200
    assert cliente.get("/static/i18n/eu.json").status_code == 200


def test_tarifa_y_jerarquia(web):
    _, cliente = web
    tf = cliente.get("/api/tarifa").json()
    assert len(tf["horas"]) == 24 and tf["horas"][9]["periodo"] == "P3"    # martes de septiembre: media
    eqs = {e["id"]: e for e in cliente.get("/api/plano").json()["equipos"]}
    assert eqs["contador-general"]["mide"] == ["red-l1", "red-sg"] and eqs["contador-general"]["generacion"] == ["fv-01"]


def test_idiomas_con_las_mismas_claves():
    claves = {cod: set(json.loads((ESTATICOS / "i18n" / f"{cod}.json").read_text(encoding="utf-8")))
              for cod in ("es", "eu", "en")}
    assert claves["eu"] == claves["es"], claves["es"] ^ claves["eu"]
    assert claves["en"] == claves["es"], claves["es"] ^ claves["en"]


def test_claves_usadas_existen():
    """Las claves fijas (t("…") y data-i18n="…") que usa la web existen en español."""
    es = set(json.loads((ESTATICOS / "i18n" / "es.json").read_text(encoding="utf-8")))
    usadas = set()
    for f in list(ESTATICOS.rglob("*.js")) + [ESTATICOS / "index.html"]:
        texto = f.read_text(encoding="utf-8")
        usadas |= set(re.findall(r'\bt\("([a-z_]+\.[a-z0-9_]+)"', texto))
        usadas |= set(re.findall(r'data-i18n(?:-html|-title|-aria)?="([a-z_]+\.[a-z0-9_]+)"', texto))
    assert usadas - es == set()


def test_borrar_datos(web, tmp_path):
    motor, cliente = web
    d = cliente.get("/api/datos").json()
    assert d["carpeta"] == str(tmp_path) and d["ficheros"] > 10 and d["bytes"] > 0 and d["borrable"]
    otro = tmp_path / "apuntes.txt"                     # lo que no es del simulador no se toca
    otro.write_text("mío")
    assert cliente.post("/api/datos/borrar", json={}).status_code == 400
    assert cliente.get("/api/datos").json()["ficheros"] == d["ficheros"]
    r = cliente.post("/api/datos/borrar", json={"confirmar": True}).json()
    assert r["ficheros"] == d["ficheros"]
    assert cliente.get("/api/datos").json()["ficheros"] == 0 and otro.exists()
    t = motor.planta.t                                  # la simulación sigue y vuelve a escribir
    motor.historico(t, t + 600, 5)
    assert cliente.get("/api/datos").json()["ficheros"] > 10


def test_no_borra_la_carpeta_del_historico(tmp_path):
    carpeta = tmp_path / "datos"
    cfg = config(carpeta)
    motor = Motor(cfg, crear_salidas(cfg))
    cliente = TestClient(crear_app(motor))
    t0 = epoch(2026, 9, 1, 8)
    motor.historico(t0, t0 + 600, 5)
    d = cliente.get("/api/datos").json()
    assert d["ficheros"] > 0 and not d["borrable"] and d["motivo"] == "historico"
    assert cliente.post("/api/datos/borrar", json={"confirmar": True}).status_code == 409
    assert cliente.get("/api/datos").json()["ficheros"] == d["ficheros"]
    motor.cerrar()
