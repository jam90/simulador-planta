// Equipo de un tipo sin dibujo propio: caja con su estado. Sirve también de base para los demás.
import { t } from "../i18n.js";
import { esc, num } from "../util.js";

/** Pone el estado en el SVG (data-estado) para que el CSS lo coloree y anime. */
export function marcarEstado(nodo, estado) {
  const svg = nodo.matches?.("svg, g") ? nodo : nodo.querySelector("svg");
  if (svg && svg.dataset.estado !== estado) svg.dataset.estado = estado;
}

export default {
  imagen: (meta) => meta.tipo.replaceAll("_", "-"),
  icono: (meta) => `<g class="eq-generico">
      <rect class="cuerpo" x="10" y="14" width="100" height="62" rx="8"/>
      <rect class="baliza-estado" x="18" y="22" width="14" height="14" rx="3"/>
      <text x="60" y="56" text-anchor="middle" class="rotulo-tipo">${esc(meta.tipo)}</text></g>`,
  dibujo(meta) {
    return `<svg viewBox="0 0 120 90" class="eq eq-ficha" role="img" aria-label="${esc(meta.id)}">${this.icono(meta)}</svg>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
  },
  destacados(d) {
    const v = d.valores;
    return "potencia_kw" in v ? [{ titulo: t("dest.potencia"), valor: num(v.potencia_kw, 2), unidad: "kW" }] : [];
  },
  tendencia: [],
};
