// PLC de línea: armario eléctrico con baliza de tres colores y seta de emergencia.
// La baliza muestra el estado de la línea: verde produciendo, ámbar en parada corta, rojo en avería.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { clase, partes, zonaClic } from "./svg.js";

const W = 70, H = 170;
const BALIZA = {
  PRODUCCION: "verde", ARRANQUE: "verde", MICROPARADA: "ambar", CAMBIO_FORMATO: "ambar",
  MANTENIMIENTO: "ambar", AVERIA: "rojo",
};

export default {
  caja: [W, H],
  icono() {
    return `<g class="plc">${zonaClic(W, H)}
      <rect class="os" x="33" y="0" width="4" height="12"/>
      <rect class="baliza rojo" data-p="rojo" x="27" y="4" width="16" height="10" rx="2"/>
      <rect class="baliza ambar" data-p="ambar" x="27" y="14" width="16" height="10" rx="2"/>
      <rect class="baliza verde" data-p="verde" x="27" y="24" width="16" height="10" rx="2"/>
      <rect class="m" x="4" y="36" width="62" height="${H - 40}" rx="4"/>
      <rect class="m2" x="10" y="44" width="50" height="58" rx="2"/>
      <g class="leds" data-p="leds">${[0, 1, 2, 3, 4].map((i) =>
        `<rect class="led l${i}" x="${15 + i * 8}" y="52" width="5" height="5" rx="1"/>`).join("")}
        ${[0, 1, 2, 3, 4].map((i) => `<rect class="led l${(i + 2) % 5}" x="${15 + i * 8}" y="64" width="5" height="5" rx="1"/>`).join("")}</g>
      <rect class="os" x="14" y="80" width="42" height="14" rx="1"/>
      <circle class="seta-base" cx="35" cy="122" r="11"/>
      <circle class="seta" data-p="seta" cx="35" cy="122" r="7"/>
      <rect class="os" x="10" y="${H - 8}" width="50" height="8" rx="2"/>
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const color = BALIZA[d.estado];
    for (const c of ["rojo", "ambar", "verde"]) clase(p[c], "encendida", c === color);
    clase(p.leds, "activos", d.estado !== "PARADA" && d.estado !== "MANTENIMIENTO");
    clase(p.seta, "pulsada", !!d.valores.paro_emergencia);
  },
  clave: (d) => (d.valores.velocidad_cinta_m_min !== undefined
    ? `${t("dest.cinta")} ${num(d.valores.velocidad_cinta_m_min, 1)} m/min` : ""),
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.piezas_ok"), valor: num(v.piezas_ok_total, 0) },
      { titulo: t("dest.piezas_nok"), valor: num(v.piezas_nok_total, 0) },
      { titulo: t("dest.cinta"), valor: num(v.velocidad_cinta_m_min, 1), unidad: "m/min" },
      { titulo: t("dest.presion_neumatica"), valor: num(v.presion_neumatica_bar, 2), unidad: "bar" },
      { titulo: t("dest.temp_armario"), valor: num(v.temp_armario_c, 1), unidad: "°C" },
      { titulo: "codigo_alarma", valor: v.codigo_alarma || "–", clase: v.codigo_alarma ? "mal" : "" },
    ];
  },
  tendencia: ["velocidad_cinta_m_min", "presion_neumatica_bar"],
};
