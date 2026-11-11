// Equipo de un tipo sin dibujo propio: caja con su estado. Sirve también de base para los demás.
import { t } from "../i18n.js";
import { esc, num } from "../util.js";
import { DEFS } from "./svg.js";

/** Pone el estado en el SVG (data-estado) para que el CSS lo coloree y anime. */
export function marcarEstado(nodo, estado) {
  const svg = nodo.matches?.("svg, g") ? nodo : nodo.querySelector("svg");
  if (svg && svg.dataset.estado !== estado) svg.dataset.estado = estado;
}

export default {
  caja: [120, 90],
  imagen: (meta) => meta.tipo.replaceAll("_", "-"),
  icono: (meta) => `<g class="eq-generico">
      <rect class="zona-clic" x="-6" y="-6" width="132" height="102" rx="10"/>
      <rect class="m" x="10" y="14" width="100" height="62" rx="8"/>
      <circle class="piloto" cx="25" cy="29" r="6"/>
      <text x="60" y="56" text-anchor="middle" class="txt-mini">${esc(meta.tipo)}</text></g>`,
  /** Dibujo de la ficha: por defecto, el icono del sinóptico ampliado. */
  dibujo(meta) {
    const [w, h] = this.caja;
    return `<svg viewBox="-20 -20 ${w + 40} ${h + 40}" class="sv eq-ficha" role="img" aria-label="${esc(meta.id)}">${DEFS}
      <g class="eq-sin" data-id="${esc(meta.id)}">${this.icono(meta)}</g></svg>`;
  },
  clave: () => "",
  problema: () => null,
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
  },
  destacados(d) {
    const v = d.valores;
    return "potencia_kw" in v ? [{ titulo: t("dest.potencia"), valor: num(v.potencia_kw, 2), unidad: "kW" }] : [];
  },
  tendencia: [],
};
