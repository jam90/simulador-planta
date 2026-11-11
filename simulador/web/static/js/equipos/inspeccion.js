// Estación de inspección: pórtico sobre la cinta con un palpador que baja cuando pasa una pieza.
// La torre de señales muestra el resultado de la última pieza (verde OK, rojo NOK).
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, clase, partes, piloto, zonaClic } from "./svg.js";

const W = 140, H = 300;

export default {
  caja: [W, H],
  icono() {
    return `<g class="inspeccion">${zonaClic(W, H)}
      <rect class="m" x="8" y="56" width="12" height="${H - 56}" rx="2"/>
      <rect class="m" x="96" y="56" width="12" height="${H - 56}" rx="2"/>
      <rect class="m2" x="2" y="46" width="112" height="16" rx="3"/>
      <g data-p="palpador">
        <rect class="os" x="48" y="62" width="20" height="20" rx="2"/>
        <rect class="acero" x="56" y="82" width="4" height="40"/>
        <circle class="punta" cx="58" cy="124" r="3.5"/>
      </g>
      <rect class="os" x="122" y="96" width="4" height="${H - 96}"/>
      <rect class="baliza verde" data-p="ok" x="116" y="70" width="16" height="12" rx="2"/>
      <rect class="baliza rojo" data-p="nok" x="116" y="84" width="16" height="12" rx="2"/>
      ${piloto(14, 36, 6)}
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
  },
  animar(nodo, d) {
    const p = partes(nodo);
    // d.bajo: distancia (0..1) de la pieza más cercana al palpador; d.ultimo: resultado de la última pieza
    const bajada = d.bajo === null || d.bajo === undefined ? 0 : Math.max(0, 1 - d.bajo);
    attr(p.palpador, "transform", `translate(0 ${(26 * bajada).toFixed(1)})`);
    clase(p.ok, "encendida", d.ultimo === true);
    clase(p.nok, "encendida", d.ultimo === false);
  },
  clave: (d) => (d.valores.piezas_inspeccionadas_total !== undefined
    ? t("dest.nok_total", { nok: num(d.valores.piezas_nok_total, 0), total: num(d.valores.piezas_inspeccionadas_total, 0) }) : ""),
  destacados(d) {
    const v = d.valores;
    const total = v.piezas_inspeccionadas_total, nok = v.piezas_nok_total;
    return [
      { titulo: t("dest.inspeccionadas"), valor: num(total, 0) },
      { titulo: t("dest.piezas_nok"), valor: num(nok, 0) },
      { titulo: t("dest.pct_nok"), valor: total ? num(100 * nok / total, 2) : "–", unidad: "%" },
    ];
  },
  tendencia: ["piezas_nok_total"],
};
