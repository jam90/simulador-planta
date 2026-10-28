"""Textos en lenguaje natural generados a partir de los eventos simulados.

- Parte de mantenimiento: al terminar cada avería.
- Nota de turno: al terminar cada turno, por línea.

Los textos se construyen con plantillas (plantillas.yaml), así que siempre son
coherentes con la telemetría y los eventos: sirven para comprobar si un sistema
de preguntas y respuestas (RAG) acierta. Esta pieza es sustituible; por ejemplo,
por un generador basado en un LLM.
"""
import random
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

import yaml

from ..tiempo import a_iso, a_local

RUTA_PLANTILLAS = Path(__file__).with_name("plantillas.yaml")
NOMBRE_TURNO = {"manana": "mañana", "tarde": "tarde", "noche": "noche"}


def _min(texto):
    """Primera letra en minúscula (para insertar una frase dentro de otra)."""
    return texto[:1].lower() + texto[1:] if texto else texto


def _cap(texto):
    return texto[:1].upper() + texto[1:] if texto else texto


def _num(x, decimales=1):
    return f"{x:.{decimales}f}".replace(".", ",")


class GeneradorTextos:
    def __init__(self, planta, ruta_plantillas=RUTA_PLANTILLAS):
        self.planta = planta
        self.rng = random.Random(f"{planta.semilla}-textos")
        with open(ruta_plantillas, encoding="utf-8") as f:
            self.pl = yaml.safe_load(f)
        self.turno = None
        self.acum = {}
        self.n_parte = 0

    def _elige(self, *claves, **huecos):
        nodo = self.pl
        for c in claves:
            nodo = nodo[c]
        return self.rng.choice(nodo).format(**huecos)

    def _mensaje(self, t, linea, tipo_texto, texto, **extra):
        return {"ts": a_iso(t), "planta": self.planta.nombre, "linea": linea,
                "tipo_texto": tipo_texto, "texto": texto, **extra}

    # --- Bucle --------------------------------------------------------------------
    def observar(self, t, eventos) -> list:
        textos = []
        for e in eventos:
            # Cada línea guarda sus eventos y los de servicios comunes (aire, energía)
            for lid, a in self.acum.items():
                if e["linea"] == lid or e["linea"] not in self.planta.lineas:
                    a["eventos"].append(e)
            if e["tipo_evento"] == "averia_fin":
                textos.append(self._parte(e))
        turno = self.planta.calendario.turno(t)
        if turno != self.turno:
            if self.turno:
                textos.extend(self._nota(t, linea_id) for linea_id in self.acum)
            self.turno = turno
            self.acum = {lid: self._abrir(t, lid) for lid in self.planta.lineas} if turno else {}
        return textos

    def _contador_planta(self):
        cg = self.planta.equipo_de_tipo("contador_general")
        fv = self.planta.equipo_de_tipo("fotovoltaica")
        consumo = (cg.importada - cg.exportada) if cg else 0.0
        generada = fv.energia_generada_kwh if fv else 0.0
        return consumo + generada, generada

    def _abrir(self, t, linea_id):
        consumo, fv = self._contador_planta()
        linea = self.planta.lineas[linea_id]
        return {"inicio": t, "eventos": [], "consumo0": consumo, "fv0": fv,
                "plc0": (linea.plc.piezas_ok, linea.plc.piezas_nok), "ref0": linea.referencia}

    # --- Parte de mantenimiento ---------------------------------------------------
    def _parte(self, e):
        self.n_parte += 1
        d = e["datos"]
        eq = self.planta.equipos[e["equipo"]]
        fin = _ts(e["ts"])
        ini = _ts(d["inicio"])
        tz = self.planta.tz
        desc_eq = eq.descripcion or eq.tipo
        eje = re.search(r"eje (\d)", d["descripcion"])
        huecos = {
            "num": f"{self.n_parte:05d}", "fecha": f"{a_local(ini, tz):%d/%m/%Y}",
            "hora_inicio": f"{a_local(ini, tz):%H:%M}", "hora_fin": f"{a_local(fin, tz):%H:%M}",
            "equipo": eq.id, "equipo_desc": _min(desc_eq), "equipo_desc_cap": _cap(desc_eq),
            "descripcion": _min(d["descripcion"]), "codigo": e["codigo"],
            "accion": _min(d["accion"]), "accion_frase": _cap(d["accion"]),
            "duracion": round(d.get("duracion_min", 0)), "eje": eje.group(1) if eje else "",
        }
        texto = self._elige("parte", "cuerpo", **huecos)
        obs = self.pl["parte"]["observaciones"]
        extra = self.rng.choice(obs.get(e["codigo"], obs["general"])).format(**huecos)
        texto = f"Parte de mantenimiento {huecos['num']}. {texto} {extra}".strip()
        return self._mensaje(fin, e["linea"], "parte_mantenimiento", texto, equipo=eq.id,
                             codigo=e["codigo"], turno=self.planta.calendario.turno(ini),
                             datos={"inicio": a_iso(ini), "fin": a_iso(fin),
                                    "duracion_min": d.get("duracion_min"), "descripcion": d["descripcion"],
                                    "accion": d["accion"]})

    # --- Nota de turno -------------------------------------------------------------
    def _nota(self, t, linea_id):
        a = self.acum[linea_id]
        linea = self.planta.lineas[linea_id]
        evs = a["eventos"]
        tz = self.planta.tz
        plc = linea.plc
        # Piezas del turno: diferencia de contadores (se guardan al abrir el turno)
        ok0, nok0 = a["plc0"]
        ok, nok = plc.piezas_ok - ok0, plc.piezas_nok - nok0
        consumo, fv = self._contador_planta()
        kwh, kwh_fv = consumo - a["consumo0"], fv - a["fv0"]
        partes = [self._elige("nota_turno", "apertura", turno=NOMBRE_TURNO.get(self.turno, self.turno),
                              fecha=f"{a_local(a['inicio'], tz):%d/%m/%Y}", linea=linea_id)]
        if ok + nok:
            partes.append(self._elige("nota_turno", "produccion", ok=ok, nok=nok,
                                      pct_nok=_num(100 * nok / (ok + nok))))
            refs = [e["datos"]["nueva"] for e in evs if e["tipo_evento"] == "cambio_referencia"]
            refs = list(dict.fromkeys([a["ref0"]] + refs))
            clave = "referencias_una" if len(refs) == 1 else "referencias_varias"
            partes.append(self._elige("nota_turno", clave, refs=", ".join(refs)))
        else:
            partes.append(self._elige("nota_turno", "sin_produccion"))
        averias = [e for e in evs if e["tipo_evento"] == "averia_inicio"]
        if averias:
            fines = {(e["equipo"], e["codigo"]): e["datos"].get("duracion_min")
                     for e in evs if e["tipo_evento"] == "averia_fin"}
            lista = []
            for e in averias:
                dur = fines.get((e["equipo"], e["codigo"]))
                dur_txt = f", {round(dur)} min" if dur else ", sin terminar al cierre del turno"
                lista.append(f"{e['equipo']} ({e['codigo']}, {_min(e['datos']['descripcion'])}{dur_txt})")
            partes.append(self._elige("nota_turno", "averias", lista="; ".join(lista)))
        else:
            partes.append(self._elige("nota_turno", "sin_averias"))
        micro = [e for e in evs if e["tipo_evento"] == "alarma" and e["equipo"] in
                 {eq.id for eq in linea.equipos}]
        if micro:
            minutos = sum(e["datos"].get("duracion_prevista_s", 0) for e in micro) / 60
            top = Counter(e["datos"].get("descripcion", e["mensaje"]) for e in micro).most_common(1)[0][0]
            n_txt = "una microparada" if len(micro) == 1 else f"{len(micro)} microparadas"
            partes.append(self._elige("nota_turno", "microparadas", n=len(micro), n_txt=n_txt,
                                      minutos=round(minutos), top=top))
        else:
            partes.append(self._elige("nota_turno", "sin_microparadas"))
        herramientas = sum(1 for e in evs if e["tipo_evento"] == "cambio_herramienta")
        if herramientas:
            veces = "una vez" if herramientas == 1 else f"{herramientas} veces"
            partes.append(self._elige("nota_turno", "herramientas", n=herramientas, veces=veces))
        partes.append(self._elige("nota_turno", "energia", kwh=round(kwh), fv=round(kwh_fv),
                                  kwh_pieza=_num(kwh / ok, 2) if ok else "-"))
        if any(e["codigo"] == "W-410" for e in evs):
            partes.append(self._elige("nota_turno", "presion_baja"))
        excesos = sum(1 for e in evs if e["tipo_evento"] == "exceso_potencia")
        if excesos:
            cuartos = "un cuarto de hora" if excesos == 1 else f"{excesos} cuartos de hora"
            partes.append(self._elige("nota_turno", "exceso_potencia", n=excesos, cuartos=cuartos))
        partes.append(self._elige("nota_turno", "cierre"))
        texto = " ".join(p for p in partes if p)
        return self._mensaje(t, linea_id, "nota_turno", texto, turno=self.turno,
                             datos={"inicio": a_iso(a["inicio"]), "fin": a_iso(t), "piezas_ok": ok,
                                    "piezas_nok": nok, "averias": len(averias), "microparadas": len(micro),
                                    "consumo_kwh": round(kwh, 1), "fv_kwh": round(kwh_fv, 1)})


def _ts(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
