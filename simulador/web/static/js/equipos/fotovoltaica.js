// Instalación fotovoltaica en la cubierta. El sol brilla según la irradiancia; los paneles se iluminan
// según la potencia generada. Con el inversor en fallo, los paneles se apagan y el inversor se pone rojo.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, clase, partes, piloto, zonaClic } from "./svg.js";

const W = 720, H = 70;
const PANELES = 10;

export default {
  caja: [W, H],
  icono() {
    const paneles = Array.from({ length: PANELES }, (_, i) => {
      const x = 110 + i * 60;
      return `<g transform="translate(${x} 0)">
        <path class="panel" d="M6 56 L18 14 H58 L46 56 Z"/>
        <path class="celdas" d="M12 35 H52 M30 14 L18 56 M44 14 L32 56"/>
        <rect class="os" x="24" y="56" width="4" height="10"/></g>`;
    }).join("");
    return `<g class="fv">${zonaClic(W, H)}
      <g data-p="sol" class="sol"><circle cx="34" cy="30" r="15"/>
        <path d="M34 6 v-6 M34 54 v6 M10 30 h-6 M58 30 h6 M17 13 l-4 -4 M51 47 l4 4 M17 47 l-4 4 M51 13 l4 -4"/></g>
      <g data-p="paneles" class="paneles">${paneles}</g>
      <rect class="m" data-p="inversor" x="${W - 10}" y="40" width="20" height="26" rx="3"/>
      ${piloto(W, 48, 4)}
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const v = d.valores;
    const irr = Math.min(1, (v.irradiancia_w_m2 ?? 0) / 900);
    const fallo = v.estado_inversor === "FALLO" || d.estado === "FALLO";
    attr(p.sol, "opacity", 0.15 + 0.85 * irr);
    attr(p.paneles, "style", `--brillo:${fallo ? 0 : Math.min(1, (v.potencia_generada_kw ?? 0) / 80).toFixed(2)}`);
    clase(p.paneles, "fallo", fallo);
    clase(p.inversor, "alarma", fallo);
  },
  clave: (d) => (d.valores.potencia_generada_kw !== undefined ? `${num(d.valores.potencia_generada_kw, 1)} kW` : ""),
  problema(d) {
    return d.valores.estado_inversor === "FALLO" ? { texto: t("prob.inversor"), nivel: "error" } : null;
  },
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.generacion"), valor: num(v.potencia_generada_kw, 1), unidad: "kW" },
      { titulo: t("dest.irradiancia"), valor: num(v.irradiancia_w_m2, 0), unidad: "W/m²" },
      { titulo: t("dest.temp_panel"), valor: num(v.temp_panel_c, 1), unidad: "°C" },
      { titulo: "estado_inversor", valor: v.estado_inversor ?? "–", clase: v.estado_inversor === "FALLO" ? "mal" : "" },
      { titulo: t("dest.energia_generada"), valor: num(v.energia_generada_kwh, 0), unidad: "kWh" },
    ];
  },
  tendencia: ["potencia_generada_kw", "irradiancia_w_m2"],
};
