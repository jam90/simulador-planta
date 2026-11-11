// Compresor de tornillo con su calderín. El ventilador gira en carga (rápido) y en vacío (lento).
// El manómetro marca la presión real; se pone rojo por debajo de 5,5 bar (alarma W-410).
// Con la fuga de aire provocada se ve un soplido en la salida.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, clase, partes, piloto, zonaClic } from "./svg.js";

const W = 190, H = 160;
const MANOMETRO = [150, 62];

export default {
  caja: [W, H],
  icono() {
    const [mx, my] = MANOMETRO;
    return `<g class="compresor">${zonaClic(W, H)}
      <rect class="m" x="0" y="40" width="104" height="${H - 40}" rx="6"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect class="m2" x="12" y="${92 + i * 11}" width="46" height="5" rx="2"/>`).join("")}
      <circle class="m2" cx="80" cy="74" r="18"/>
      <g class="ventilador" data-p="ventilador"><path class="os" d="M80 74 l0 -15 a5 5 0 0 1 5 5z M80 74 l15 0 a5 5 0 0 1 -5 5z M80 74 l0 15 a5 5 0 0 1 -5 -5z M80 74 l-15 0 a5 5 0 0 1 5 -5z"/></g>
      <rect class="pantalla" x="66" y="104" width="28" height="18" rx="2"/>
      <path class="tubo" d="M104 130 H124"/>
      <rect class="m" x="124" y="12" width="52" height="${H - 12}" rx="24"/>
      <path class="tubo" d="M150 12 V0"/>
      <g class="fuga" data-p="fuga" transform="translate(150 0)">
        <path d="M0 0 q-10 -6 -18 -2 M0 0 q2 -12 10 -16 M0 0 q12 -4 18 4"/></g>
      <circle class="esfera" data-p="esfera" cx="${mx}" cy="${my}" r="16"/>
      <path class="escala" d="M${mx - 11} ${my + 8} A 14 14 0 1 1 ${mx + 11} ${my + 8}"/>
      <line class="aguja" data-p="aguja" x1="${mx}" y1="${my}" x2="${mx}" y2="${my - 12}"/>
      <circle class="os" cx="${mx}" cy="${my}" r="2.5"/>
      ${piloto(18, 54, 6)}
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const presion = d.valores.presion_bar ?? 0;
    const ang = -125 + 250 * Math.min(1, Math.max(0, presion / 10));
    attr(p.aguja, "transform", `rotate(${ang.toFixed(1)} ${MANOMETRO[0]} ${MANOMETRO[1]})`);
    clase(p.esfera, "alarma", d.avisos?.presion_baja || presion < 5.5);
    clase(p.fuga, "activas", d.avisos?.fuga_aire);
    clase(p.ventilador, "gira", d.estado === "CARGA");
    clase(p.ventilador, "gira-lento", d.estado === "VACIO");
  },
  clave: (d) => (d.valores.presion_bar !== undefined ? `${num(d.valores.presion_bar, 2)} bar` : ""),
  problema(d) {
    if (d.avisos?.presion_baja) return { codigo: "W-410", texto: t("prob.presion_baja"), nivel: "aviso" };
    if (d.avisos?.fuga_aire) return { texto: t("prob.fuga_aire"), nivel: "aviso" };
    return null;
  },
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.presion"), valor: num(v.presion_bar, 2), unidad: "bar", clase: v.presion_bar < 5.5 ? "mal" : "" },
      { titulo: t("dest.caudal"), valor: num(v.caudal_m3_min, 2), unidad: "m³/min" },
      { titulo: t("dest.temp_aceite"), valor: num(v.temp_aceite_c, 1), unidad: "°C" },
      { titulo: t("dest.horas_marcha"), valor: num(v.horas_marcha, 1), unidad: "h" },
      { titulo: t("dest.potencia"), valor: num(v.potencia_kw, 2), unidad: "kW" },
    ];
  },
  tendencia: ["presion_bar", "potencia_kw"],
};
