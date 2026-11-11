// Iluminación: luminarias colgadas del techo. El cono de luz depende del nivel (nivel_pct):
// se regula con la luz natural y, fuera de turno, queda solo el alumbrado de emergencia.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, clase, partes, zonaClic } from "./svg.js";

const W = 60, H = 30;

export default {
  caja: [W, H],
  icono() {
    return `<g class="luz">
      <path class="cono" data-p="cono" d="M14 24 L46 24 L96 380 L-36 380 Z"/>
      ${zonaClic(W, H)}
      <rect class="os" x="29" y="0" width="2" height="10"/>
      <path class="m" d="M10 24 L18 10 H42 L50 24 Z"/>
      <rect class="lampara" data-p="lampara" x="14" y="22" width="32" height="4" rx="2"/>
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const nivel = Math.max(0, Math.min(100, d.valores.nivel_pct ?? 0)) / 100;
    attr(p.cono, "opacity", d.estado === "EMERGENCIA" ? 0.06 : 0.12 + 0.33 * nivel);
    clase(p.lampara, "apagada", d.estado === "EMERGENCIA");
  },
  clave: (d) => (d.valores.nivel_pct !== undefined ? `${num(d.valores.nivel_pct, 0)} %` : ""),
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.nivel"), valor: num(v.nivel_pct, 0), unidad: "%" },
      { titulo: t("dest.potencia"), valor: num(v.potencia_kw, 2), unidad: "kW" },
    ];
  },
  tendencia: ["nivel_pct"],
};
