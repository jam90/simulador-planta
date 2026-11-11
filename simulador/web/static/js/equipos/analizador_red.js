// Analizador de red de un cuadro eléctrico: potencia activa y corriente de cada fase.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, partes, piloto, texto, zonaClic } from "./svg.js";

const W = 70, H = 100;

export default {
  caja: [W, H],
  icono() {
    return `<g class="analizador">${zonaClic(W, H)}
      <rect class="m" x="0" y="0" width="70" height="100" rx="4"/>
      <rect class="pantalla" x="8" y="8" width="54" height="42" rx="2"/>
      <text class="txt-pant grande" x="35" y="26" text-anchor="middle" data-p="kw">–</text>
      ${[0, 1, 2].map((i) => `<rect class="barra-fondo" x="${14 + i * 15}" y="31" width="9" height="14"/>
        <rect class="barra-az" data-p="f${i}" x="${14 + i * 15}" y="45" width="9" height="0"/>`).join("")}
      ${[0, 1, 2].map((i) => `<rect class="m2" x="${10 + i * 18}" y="60" width="14" height="30" rx="2"/>`).join("")}
      ${piloto(62, 94, 3.5)}
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const v = d.valores;
    texto(p.kw, v.potencia_activa_kw === undefined ? "–" : `${num(v.potencia_activa_kw, 1)} kW`);
    const fases = [1, 2, 3].map((i) => v[`corriente_l${i}_a`] ?? 0);
    const max = Math.max(60, ...fases);
    fases.forEach((c, i) => { const h = 14 * c / max; attr(p[`f${i}`], "y", 45 - h); attr(p[`f${i}`], "height", h); });
  },
  clave: (d) => (d.valores.potencia_activa_kw !== undefined ? `${num(d.valores.potencia_activa_kw, 1)} kW` : ""),
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.potencia_activa"), valor: num(v.potencia_activa_kw, 2), unidad: "kW" },
      { titulo: t("dest.potencia_reactiva"), valor: num(v.potencia_reactiva_kvar, 2), unidad: "kvar" },
      { titulo: "factor_potencia", valor: num(v.factor_potencia, 3) },
      { titulo: t("dest.tension_l1"), valor: num(v.tension_l1_v, 1), unidad: "V" },
      { titulo: t("dest.thd_corriente"), valor: num(v.thd_corriente_pct, 1), unidad: "%" },
      { titulo: t("dest.energia_activa"), valor: num(v.energia_activa_kwh, 0), unidad: "kWh" },
    ];
  },
  tendencia: ["potencia_activa_kw", "factor_potencia"],
};
