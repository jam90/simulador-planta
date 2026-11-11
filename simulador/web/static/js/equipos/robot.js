// Robot industrial de seis ejes, visto de lado. Dos variantes según su herramienta (planta.yaml):
//   pinza:     coge la pieza en bruto de la cinta de entrada y la deja en el palé de carga de la CNC
//              (la pinza cierra al 15 % del ciclo y abre al 75 %, igual que la señal pinza_cerrada).
//   soldadura: baja la antorcha sobre la pieza mecanizada y la suelda (chispas) del 25 % al 82 % del ciclo.
// El brazo se mueve con la fase del ciclo real (ciclo_ini/ciclo_fin del simulador) a la hora dibujada.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { ACTIVOS, attr, brazo, clase, fase, faseRapida, interpolar, partes, piloto, zonaClic } from "./svg.js";

const W = 220, H = 290;
const HOMBRO = [100, 128];
const L1 = 76, L2 = 72;
const CASA = [92, 40];

// Recorridos (fase del ciclo, x, y) en coordenadas del dibujo
const RECORRIDO = {
  // Coge la pieza al final de la cinta de entrada y la deja en el palé de carga de la CNC
  pinza: [[0, ...CASA], [0.15, 40, 133], [0.3, 70, 92], [0.55, 193, 119], [0.75, 193, 119], [1, ...CASA]],
  // Baja la antorcha sobre la pieza de la cinta de salida y la recorre soldando
  soldadura: [[0, ...CASA], [0.18, 160, 92], [0.25, 160, 112], [0.82, 184, 112], [0.9, 172, 88], [1, ...CASA]],
};
const SOLDANDO = [0.25, 0.82];
const AVISO_DEGRADACION = 1.2;      // 20 % por encima del nominal (a partir de 1,25 aumentan las piezas NOK)

function herramienta(variante) {
  if (variante === "soldadura") {
    return `<g data-p="herr">
      <rect class="os" x="-6" y="-6" width="12" height="10" rx="2"/>
      <path class="ac-trazo" d="M0 3 L4 20" stroke-width="5" stroke-linecap="round"/>
      <path class="os-trazo" d="M4 20 L5 24" stroke-width="3" stroke-linecap="round"/>
      <g class="chispas" data-p="chispas" transform="translate(5 26)">
        <circle class="arco" r="7"/><circle class="arco-n" r="2.6"/>
        <path class="chispa" d="M0 0 L-9 -6 M0 0 L8 -8 M0 0 L11 1 M0 0 L-10 3 M0 0 L3 -11"/>
      </g></g>`;
  }
  return `<g data-p="herr">
    <rect class="os" x="-7" y="-6" width="14" height="10" rx="2"/>
    <rect class="m" data-p="dedo1" x="-14" y="3" width="4" height="15" rx="1"/>
    <rect class="m" data-p="dedo2" x="10" y="3" width="4" height="15" rx="1"/>
    <rect class="pieza" data-p="carga" x="-10" y="5" width="20" height="12" rx="2"/>
  </g>`;
}

export default {
  caja: [W, H],
  imagen: (meta) => (meta.variante === "soldadura" ? "robot-soldadura" : "robot-pinza"),
  icono(meta) {
    const [sx, sy] = HOMBRO;
    return `<g class="robot v-${meta.variante || "pinza"}">${zonaClic(W, H)}
      <rect class="m" x="80" y="140" width="40" height="${H - 150}" rx="3"/>
      <rect class="os" x="60" y="${H - 10}" width="80" height="10" rx="2"/>
      <rect class="m2" x="72" y="124" width="56" height="22" rx="6"/>
      <line class="seg seg1" data-p="b1" x1="${sx}" y1="${sy}" x2="${sx}" y2="${sy - L1}"/>
      <line class="seg seg2" data-p="b2" x1="${sx}" y1="${sy - L1}" x2="${sx + L2}" y2="${sy - L1}"/>
      <circle class="junta" cx="${sx}" cy="${sy}" r="9"/>
      <circle class="junta" data-p="codo" cx="${sx}" cy="${sy - L1}" r="7"/>
      <g data-p="munneca">${herramienta(meta.variante)}</g>
      ${piloto(100, 200, 6)}
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
  },
  animar(nodo, d, tm, rapido) {
    const p = partes(nodo);
    const variante = d.meta.variante === "soldadura" ? "soldadura" : "pinza";
    const activo = ACTIVOS.has(d.estado);
    let f = rapido ? (d.produce ? faseRapida(1.8, variante === "soldadura" ? 0.35 : 0) : null) : fase(d.ciclos, tm);
    if (!activo && !rapido) f = fase(d.ciclos, tm);       // un ciclo que ya había empezado termina
    const [tx, ty] = f === null ? CASA : interpolar(RECORRIDO[variante], f);
    const { ex, ey, px, py } = brazo(...HOMBRO, tx, ty, L1, L2);
    attr(p.b1, "x2", ex); attr(p.b1, "y2", ey);
    attr(p.b2, "x1", ex); attr(p.b2, "y1", ey); attr(p.b2, "x2", px); attr(p.b2, "y2", py);
    attr(p.codo, "cx", ex); attr(p.codo, "cy", ey);
    attr(p.munneca, "transform", `translate(${px.toFixed(1)} ${py.toFixed(1)})`);
    if (variante === "pinza") {
      const cerrada = f !== null && f >= 0.15 && f < 0.75;
      const g = cerrada ? 0 : 4;
      attr(p.dedo1, "x", -14 - g); attr(p.dedo2, "x", 10 + g);
      clase(p.carga, "oculto", !cerrada);
    } else {
      clase(p.chispas, "activas", f !== null && f >= SOLDANDO[0] && f < SOLDANDO[1]);
    }
  },
  clave: (d) => (d.valores.ciclo_s ? `${t("dest.ciclo")} ${num(d.valores.ciclo_s, 1)} s` : ""),
  /** Avería anunciada: avisa cuando la variable degradada pasa del 20 % sobre su nominal. */
  problema(d) {
    const g = d.avisos?.degradacion;
    if (!g || g.factor < AVISO_DEGRADACION) return null;
    return { texto: t("prob.degradacion", { variable: g.variable, pct: num(100 * (g.factor - 1), 0),
      limite: num(100 * (g.limite - 1), 0) }), nivel: "aviso" };
  },
  destacados(d) {
    const v = d.valores;
    const lista = [
      { titulo: t("dest.ciclo"), valor: num(v.ciclo_s, 1), unidad: "s" },
      { titulo: t("dest.ciclos_total"), valor: num(v.ciclos_total, 0) },
      { titulo: t("dest.potencia"), valor: num(v.potencia_kw, 2), unidad: "kW" },
    ];
    if ("pinza_cerrada" in v) lista.push({ titulo: "pinza_cerrada", valor: String(v.pinza_cerrada) });
    lista.push({ titulo: t("dest.temp_max_motor"), unidad: "°C",
      valor: num(Math.max(...[1, 2, 3, 4, 5, 6].map((i) => v[`temp_motor_eje${i}_c`] ?? -Infinity)), 1) });
    return lista;
  },
  tendencia: ["corriente_eje3_a", "temp_motor_eje3_c"],
};
