"""Los datos generados no deben cambiar sin querer.

Fija el resultado del histórico de referencia: recuentos y una huella (SHA-256)
de todos los ficheros generados. Si un cambio altera los datos, estos tests
fallan; si el cambio es intencionado, hay que recalcular los valores y
actualizar las cifras del README.

El de 30 días tarda unos 20-40 s: se excluye con  pytest -m "not lento".
"""
import hashlib
import json

import pytest

from simulador.motor import Motor
from simulador.salidas import crear_salidas
from test_simulador import config, epoch


def generar(tmp_path, dias):
    cfg = config(tmp_path)
    motor = Motor(cfg, crear_salidas(cfg))
    t0 = epoch(2026, 9, 1)
    motor.historico(t0, t0 + dias * 86400, 60)
    motor.cerrar()
    h = hashlib.sha256()
    for f in sorted(p for p in tmp_path.rglob("*") if p.is_file()):
        h.update(str(f.relative_to(tmp_path)).encode())
        h.update(f.read_bytes())
    leer = lambda patron: [json.loads(l) for f in tmp_path.glob(patron) for l in f.open()]
    inspecciones = leer("L1/calidad-01/inspecciones/*.jsonl")
    ordenes = leer("L1/mes/ordenes/*.jsonl")
    textos = leer("L1/textos/*.jsonl")
    return {
        **motor.contadores,
        "nok": sum(i["resultado"] == "NOK" for i in inspecciones),
        "completadas": sum(o["motivo_cierre"] == "completada" for o in ordenes),
        "notas": sum(t["tipo_texto"] == "nota_turno" for t in textos),
        "partes": sum(t["tipo_texto"] == "parte_mantenimiento" for t in textos),
        "sha256": h.hexdigest(),
    }


def test_historico_2_dias(tmp_path):
    assert generar(tmp_path, 2) == {
        "telemetria": 37440, "eventos": 4323, "textos": 6, "inspecciones": 2051, "ordenes": 7,
        "nok": 55, "completadas": 6, "notas": 4, "partes": 2,
        "sha256": "92b246dcc55e7f42cb8cb999d398e28a040ab9d232805648ec4677daa1eab30e",
    }


@pytest.mark.lento
def test_historico_de_referencia_30_dias(tmp_path):
    """Las cifras del README: historico --desde 2026-09-01 --dias 30."""
    assert generar(tmp_path, 30) == {
        "telemetria": 561600, "eventos": 47453, "textos": 59, "inspecciones": 22533, "ordenes": 63,
        "nok": 724, "completadas": 49, "notas": 44, "partes": 15,
        "sha256": "6b94359d15354292ed0756f8c597af6ba9a05249b422421a1b282f4138cae6c5",
    }
