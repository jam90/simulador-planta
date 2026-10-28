"""Línea de comandos del simulador.

  python -m simulador historico --desde 2026-09-01 --dias 30
  python -m simulador vivo [--acelerar 10] [--historico-dias 7]
"""
import argparse
import logging
import shutil
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml

from .motor import Motor
from .salidas import crear_salidas

log = logging.getLogger("simulador")

# Carpetas que genera el simulador dentro de la carpeta de datos (además de una por línea)
CARPETAS_GENERADAS = ("telemetria", "eventos", "textos", "inspecciones", "ordenes", "energia", "logs")


def cargar_config(ruta):
    with open(ruta, encoding="utf-8") as f:
        return yaml.safe_load(f)


def preparar_datos(ruta: Path, sobrescribir: bool, config: dict):
    """Evita mezclar un histórico nuevo con datos de una ejecución anterior."""
    carpetas = CARPETAS_GENERADAS + tuple(l["id"] for l in config["lineas"])
    existentes = [ruta / c for c in carpetas if (ruta / c).exists() and any((ruta / c).iterdir())]
    if not existentes:
        return
    if not sobrescribir:
        sys.exit(f"La carpeta {ruta} ya tiene datos ({', '.join(p.name for p in existentes)}). "
                 "Usa --sobrescribir para borrarlos o elige otra carpeta con --salida.")
    for carpeta in existentes:
        shutil.rmtree(carpeta)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m simulador", description="Simulador de planta industrial")
    ap.add_argument("--config", default="config/planta.yaml", help="fichero de configuración")
    ap.add_argument("--salida", help="carpeta de datos (por defecto, la de planta.yaml)")
    sub = ap.add_subparsers(dest="modo", required=True)

    h = sub.add_parser("historico", help="genera datos pasados de golpe (sin MQTT)")
    h.add_argument("--desde", type=date.fromisoformat, help="fecha inicial AAAA-MM-DD (por defecto, hace --dias días)")
    h.add_argument("--dias", type=float, default=30, help="número de días (30 por defecto)")
    h.add_argument("--intervalo", type=float, help="segundos entre muestras (por defecto, intervalo_historico_s)")
    h.add_argument("--sobrescribir", action="store_true", help="borra los datos generados anteriormente")

    v = sub.add_parser("vivo", help="genera datos en tiempo real (o acelerado)")
    v.add_argument("--acelerar", type=float, default=1.0, help="factor de aceleración del tiempo (1 = real)")
    v.add_argument("--intervalo", type=float, help="segundos entre muestras (por defecto, intervalo_vivo_s)")
    v.add_argument("--historico-dias", type=float, default=0,
                   help="antes de empezar, genera N días de histórico que enlazan con el presente")
    v.add_argument("--sobrescribir", action="store_true", help="borra los datos generados anteriormente")
    v.add_argument("--sin-web", action="store_true", help="no arranca la interfaz web")
    v.add_argument("--puerto", type=int, default=8000, help="puerto de la interfaz web")

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = cargar_config(args.config)
    if args.salida:
        config["salidas"]["jsonl"]["ruta"] = args.salida
        config["salidas"]["curva_csv"]["ruta"] = str(Path(args.salida) / "energia")
        if "logs" in config["salidas"]:
            config["salidas"]["logs"]["ruta"] = str(Path(args.salida) / "logs")
    p = config["planta"]

    if args.modo == "historico":
        preparar_datos(Path(config["salidas"]["jsonl"]["ruta"]), args.sobrescribir, config)
        motor = Motor(config, crear_salidas(config))
        tz = motor.planta.tz
        desde = args.desde or (date.today() - timedelta(days=args.dias))
        t0 = datetime.combine(desde, datetime.min.time(), tzinfo=tz).timestamp()
        t1 = t0 + args.dias * 86400
        intervalo = args.intervalo or p.get("intervalo_historico_s", 60)
        inicio = time.time()
        log.info("Generando histórico: %s, %s días, cada %s s", desde, args.dias, intervalo)
        motor.historico(t0, t1, intervalo)
        motor.cerrar()
        c = motor.contadores
        log.info("Hecho en %.1f s: %d mensajes de telemetría, %d eventos, %d textos, %d inspecciones "
                 "y %d órdenes", time.time() - inicio, c["telemetria"], c["eventos"], c["textos"],
                 c["inspecciones"], c["ordenes"])
        return

    # Modo vivo
    if args.historico_dias:
        preparar_datos(Path(config["salidas"]["jsonl"]["ruta"]), args.sobrescribir, config)
    motor = Motor(config, crear_salidas(config))
    motor.acelerar = args.acelerar
    intervalo = args.intervalo or p.get("intervalo_vivo_s", 5)
    if args.historico_dias:
        ahora = time.time()
        t0 = (ahora - args.historico_dias * 86400) // 60 * 60
        log.info("Generando %s días de histórico antes de empezar en vivo...", args.historico_dias)
        motor.historico(t0, ahora // intervalo * intervalo, p.get("intervalo_historico_s", 60))
    if args.sin_web:
        try:
            motor.vivo(intervalo)
        except KeyboardInterrupt:
            pass
        finally:
            motor.cerrar()
    else:
        from .web.api import servir
        servir(motor, intervalo, args.puerto)


if __name__ == "__main__":
    main()
