"""Pruebas del simulador:  .venv/bin/python -m pytest -q"""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import yaml

from simulador.motor import Motor
from simulador.planta import Planta
from simulador.salidas import crear_salidas

RAIZ = Path(__file__).resolve().parents[1]
TZ = ZoneInfo("Europe/Madrid")


def config(tmp_path=None, **cambios):
    cfg = yaml.safe_load(open(RAIZ / "config" / "planta.yaml", encoding="utf-8"))
    cfg["salidas"]["mqtt"]["activa"] = False
    if tmp_path:
        cfg["salidas"]["jsonl"]["ruta"] = str(tmp_path)
        cfg["salidas"]["curva_csv"]["ruta"] = str(tmp_path / "energia")
        cfg["salidas"]["logs"]["ruta"] = str(tmp_path / "logs")
    for clave, valor in cambios.items():
        cfg[clave].update(valor)
    return cfg


def n_telemetria(motor):
    """Equipos que publican telemetría (el MES no)."""
    return sum("telemetria" in e.canales for e in motor.planta.equipos.values())


def epoch(*args):
    return datetime(*args, tzinfo=TZ).timestamp()


def simular(planta, desde, horas, paso=60):
    planta.iniciar(desde)
    t, mensajes, eventos = desde, [], []
    for _ in range(int(horas * 3600 / paso)):
        t += paso
        planta.avanzar(t)
        mensajes += planta.muestrear(t)
        eventos += planta.recoger()[0]
    return mensajes, eventos


def test_calendario():
    cal = Planta(config()).calendario
    assert cal.modo(epoch(2026, 9, 1, 9, 0)) == "produccion"        # martes
    assert cal.modo(epoch(2026, 9, 1, 10, 5)) == "parada"           # descanso 10:00-10:15
    assert cal.modo(epoch(2026, 9, 1, 23, 0)) == "parada"           # turno de noche inactivo
    assert cal.modo(epoch(2026, 9, 5, 9, 0)) == "parada"            # sábado
    assert cal.modo(epoch(2026, 10, 12, 9, 0)) == "parada"          # festivo
    assert cal.modo(epoch(2026, 9, 4, 12, 30)) == "mantenimiento"   # viernes 12:00-13:00
    assert cal.turno(epoch(2026, 9, 1, 15, 0)) == "tarde"
    assert cal.siguiente_cambio(epoch(2026, 9, 5, 9, 0)) == epoch(2026, 9, 7, 6, 0)


def test_reproducible():
    a, _ = simular(Planta(config()), epoch(2026, 9, 1), 6)
    b, _ = simular(Planta(config()), epoch(2026, 9, 1), 6)
    assert a == b


def test_sin_produccion_en_fin_de_semana():
    mensajes, _ = simular(Planta(config()), epoch(2026, 9, 5), 48)
    plc = [m for m in mensajes if m["equipo"] == "plc-l1"]
    assert {m["estado"] for m in plc} == {"PARADA"}
    assert plc[0]["valores"]["piezas_ok_total"] == plc[-1]["valores"]["piezas_ok_total"]


def test_contadores_no_bajan_y_balance_energetico():
    planta = Planta(config())
    mensajes, _ = simular(planta, epoch(2026, 9, 1), 72)
    por_eq = {}
    for m in mensajes:
        por_eq.setdefault(m["equipo"], []).append(m["valores"])
    for eq, serie in por_eq.items():
        for k in serie[0]:
            if k.endswith(("_total", "_kwh", "_kvarh", "_eur")) and not k.startswith("precio"):
                valores = [v[k] for v in serie]
                assert valores == sorted(valores), f"{eq}.{k} baja"
    # Contador general = cuadros - fotovoltaica (en incrementos)
    d = lambda eq, k: por_eq[eq][-1][k] - por_eq[eq][0][k]
    neto = d("contador-general", "energia_importada_kwh") - d("contador-general", "energia_exportada_kwh")
    cuadros = d("red-l1", "energia_activa_kwh") + d("red-sg", "energia_activa_kwh")
    assert neto == pytest.approx(cuadros - d("fv-01", "energia_generada_kwh"), rel=0.01)


def test_degradacion_provoca_averia():
    planta = Planta(config())
    _, eventos = simular(planta, epoch(2026, 9, 1), 24 * 30)
    averias = [e for e in eventos if e["tipo_evento"] == "averia_inicio" and e["codigo"] == "E-260"]
    assert averias and all(e["equipo"] == "robot-02" for e in averias)


def test_pinza_cambia_a_menudo():
    _, eventos = simular(Planta(config()), epoch(2026, 9, 1, 6), 8)
    cambios = [e for e in eventos if e["tipo_evento"] == "cambio_senal"]
    assert len(cambios) > 500                    # un turno de 8 h


def test_historico_genera_ficheros(tmp_path):
    cfg = config(tmp_path)
    motor = Motor(cfg, crear_salidas(cfg))
    t0 = epoch(2026, 9, 1)
    motor.historico(t0, t0 + 2 * 86400, 60)
    motor.cerrar()
    tel = [l for f in tmp_path.glob("*/*/telemetria/*.jsonl") for l in f.read_text().splitlines()]
    assert len(tel) == 2 * 1440 * n_telemetria(motor)      # una muestra por minuto y equipo
    assert json.loads((tmp_path / "L1" / "cnc-01" / "telemetria" / "2026-09-01.jsonl").open().readline())["equipo"] == "cnc-01"
    csv = (tmp_path / "energia" / "curva-cuartohoraria-2026-09-01.csv").read_text().splitlines()
    assert csv[0].startswith("fecha;hora_inicio") and len(csv) == 1 + 96
    assert csv[1].startswith("01/09/2026;00:00;00:15;P6;")
    assert (tmp_path / "logs" / "plc-l1.log").exists()
    textos = [json.loads(l) for f in (tmp_path / "L1" / "textos").glob("*.jsonl") for l in f.open()]
    assert sum(t["tipo_texto"] == "nota_turno" for t in textos) == 4   # 2 días x 2 turnos


def test_dato_sucio(tmp_path):
    sucio = {"activo": True, "prob_nulo": 0.5, "prob_duplicado": 0.5, "prob_formato_fecha": 0.5}
    cfg = config(tmp_path, dato_sucio=sucio)
    motor = Motor(cfg, crear_salidas(cfg))
    t0 = epoch(2026, 9, 1, 8)
    motor.historico(t0, t0 + 3600, 60)
    motor.cerrar()
    lineas = [json.loads(l) for f in tmp_path.glob("*/*/telemetria/*.jsonl") for l in f.open()]
    assert len(lineas) > 60 * n_telemetria(motor)                 # hay duplicados
    assert any(None in m["valores"].values() for m in lineas)            # hay nulos
    assert list(tmp_path.glob("*/*/telemetria/fecha-desconocida.jsonl"))  # fechas mal formadas


def test_agrupar_por_canal(tmp_path):
    cfg = config(tmp_path)
    cfg["salidas"]["jsonl"]["agrupar"] = "canal"
    motor = Motor(cfg, crear_salidas(cfg))
    t0 = epoch(2026, 9, 1, 8)
    motor.historico(t0, t0 + 3600, 60)
    motor.cerrar()
    assert sorted(p.name for p in tmp_path.iterdir() if p.name not in ("energia", "logs")) == \
        ["eventos", "inspecciones", "telemetria"]
    tel = (tmp_path / "telemetria" / "2026-09-01.jsonl").read_text().splitlines()
    assert len(tel) == 60 * n_telemetria(motor)


def test_inspecciones_coherentes_con_plc(tmp_path):
    cfg = config(tmp_path)
    motor = Motor(cfg, crear_salidas(cfg))
    t0 = epoch(2026, 9, 1)
    motor.historico(t0, t0 + 7 * 86400, 60)
    motor.cerrar()
    ins = [json.loads(l) for f in sorted((tmp_path / "L1" / "calidad-01" / "inspecciones").glob("*.jsonl"))
           for l in f.open()]
    plc = motor.planta.lineas["L1"].plc
    assert len(ins) == plc.piezas_ok + plc.piezas_nok == motor.contadores["inspecciones"]
    assert sum(i["resultado"] == "NOK" for i in ins) == plc.piezas_nok > 0
    assert len({i["pieza_id"] for i in ins}) == len(ins)
    for i in ins:
        # La pieza es NOK si y solo si alguna cota está fuera de tolerancia
        assert (i["resultado"] == "NOK") == any(m["resultado"] == "NOK" for m in i["medidas"])
        for m in i["medidas"]:
            assert (m["tol_min"] <= m["desviacion"] <= m["tol_max"]) == (m["resultado"] == "OK")
    # El caso que obliga a usar `nested` en Elasticsearch: pieza NOK con el diámetro OK
    assert any(i["resultado"] == "NOK" and any(m["cota"] == "diametro_agujero" and m["resultado"] == "OK"
                                               for m in i["medidas"]) for i in ins)


def test_web(tmp_path):
    from fastapi.testclient import TestClient
    from simulador.web.api import crear_app
    cfg = config(tmp_path)
    motor = Motor(cfg, crear_salidas(cfg))
    t0 = epoch(2026, 9, 1, 9)
    motor.historico(t0, t0 + 600, 5)
    cliente = TestClient(crear_app(motor))
    estado = cliente.get("/api/estado").json()
    assert estado["lineas"][0]["id"] == "L1"
    assert cliente.post("/api/equipos/robot-01", json={"publicar": False}).status_code == 200
    assert motor.publicar["robot-01"] is False
    assert cliente.post("/api/incidencias", json={"incidencia": "averia", "equipo": "cnc-01",
                                                  "minutos": 10}).status_code == 200
    motor.historico(motor.planta.t, motor.planta.t + 60, 5)
    assert motor.planta.lineas["L1"].estado == "AVERIA"
    averias = cliente.get("/api/estado").json()["averias"]
    assert [a["equipo"] for a in averias] == ["cnc-01"] and 0 < averias[0]["restante_sim_s"] <= 600
    assert cliente.post("/api/incidencias", json={"incidencia": "inventada"}).status_code == 400
    # Equipos sin códigos de avería, y microparada con la línea sin producir
    assert cliente.post("/api/incidencias", json={"incidencia": "averia", "equipo": "calidad-01",
                                                  "minutos": 5}).status_code == 400
    assert cliente.post("/api/incidencias", json={"incidencia": "microparada", "equipo": "robot-01",
                                                  "minutos": 5}).status_code == 400   # está en AVERIA
    estado = cliente.get("/api/estado").json()
    assert all(s["descripcion"] for s in estado["salidas"])
    assert {e["id"] for e in estado["equipos"] if e["admite_incidencias"]} == \
        {"plc-l1", "robot-01", "robot-02", "cnc-01"}
    assert cliente.get("/api/valores/compresor-01").json()["equipo"] == "compresor-01"
    # Reparar ahora: la avería termina en el siguiente paso, con su evento de fin y su parte
    assert cliente.post("/api/incidencias", json={"incidencia": "reparar", "equipo": "robot-01"}).status_code == 400
    assert cliente.post("/api/incidencias", json={"incidencia": "reparar", "equipo": "cnc-01"}).status_code == 200
    motor.historico(motor.planta.t, motor.planta.t + 5, 5)
    assert motor.planta.lineas["L1"].estado != "AVERIA"
    assert cliente.get("/api/estado").json()["averias"] == []
    motor._vaciar()
    eventos = [json.loads(l) for f in (tmp_path / "L1" / "cnc-01" / "eventos").glob("*.jsonl") for l in f.open()]
    assert eventos[-1]["tipo_evento"] == "averia_fin"
    textos = [json.loads(l) for f in (tmp_path / "L1" / "textos").glob("*.jsonl") for l in f.open()]
    assert textos[-1]["tipo_texto"] == "parte_mantenimiento" and textos[-1]["equipo"] == "cnc-01"
    acceso = cliente.get("/api/acceso/calidad-01").json()       # sin salida MQTT en las pruebas
    assert acceso["mqtt"] is None
    assert [c["carpeta"] for c in acceso["ficheros"]["carpetas"]] == \
        [f"{tmp_path}/L1/calidad-01/telemetria/", f"{tmp_path}/L1/calidad-01/inspecciones/"]
    assert cliente.get("/api/acceso/inventado").status_code == 404
    motor.cerrar()


def test_ordenes_de_fabricacion(tmp_path):
    cfg = config(tmp_path)
    motor = Motor(cfg, crear_salidas(cfg))
    t0 = epoch(2026, 9, 1)
    motor.historico(t0, t0 + 7 * 86400, 60)
    motor.cerrar()
    leer = lambda ruta: [json.loads(l) for f in sorted(ruta.glob("*.jsonl")) for l in f.open()]
    ordenes = leer(tmp_path / "L1" / "mes" / "ordenes")
    ins = leer(tmp_path / "L1" / "calidad-01" / "inspecciones")
    assert ordenes and not (tmp_path / "L1" / "mes" / "telemetria").exists()   # el MES no da telemetría
    assert len({o["orden_id"] for o in ordenes}) == len(ordenes)
    for o in ordenes:
        piezas = [i for i in ins if i["orden_id"] == o["orden_id"]]
        assert sum(i["resultado"] == "OK" for i in piezas) == o["piezas_ok"]
        assert sum(i["resultado"] == "NOK" for i in piezas) == o["piezas_nok"]
        assert {i["referencia"] for i in piezas} == {o["referencia"]}
        if o["motivo_cierre"] == "completada":
            assert o["piezas_ok"] + o["piezas_nok"] == o["cantidad_planificada"]
        for m in o["materiales"]:
            assert m["cantidad_real"] >= m["cantidad_prevista"] > 0 and m["lotes"]
    # Caso para `nested` en Elasticsearch: el hilo se mide en kg (< 100), pero otro material supera 100
    assert any(any(m["cantidad_real"] > 100 for m in o["materiales"]) for o in ordenes)
    assert all(m["cantidad_real"] < 100 for o in ordenes for m in o["materiales"] if m["material"] == "hilo_soldadura")
