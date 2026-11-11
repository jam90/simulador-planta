// Cronología de estados de una línea: una franja con un tramo por estado, del color del estado,
// con su nombre escrito si cabe y, al pasar el ratón, el estado, las horas y el motivo.
// Debajo, la leyenda con el tiempo total en cada estado (para no depender solo del color).
import { t } from "../i18n.js";
import { duracionCorta, esc, hora, insignia } from "../util.js";

/** Tramos [ini, fin, estado, motivo] de la serie [[t, estado, motivo], ...] dentro de [t0, t1]. */
export function tramos(serie, t0, t1) {
  const lista = [];
  for (let i = 0; i < serie.length; i++) {
    const [ti, e, m] = serie[i];
    const tf = i + 1 < serie.length ? serie[i + 1][0] : t1;
    const a = Math.max(ti, t0), b = Math.min(tf, t1);
    if (b > a) lista.push([a, b, e, m]);
  }
  return lista;
}

/** W: ancho real en px (se dibuja a ese ancho para que el texto no se deforme). */
export function htmlCronologia(serie, t0, t1, W = 1000) {
  if (!serie?.length || t1 <= t0) return `<p class="nota">–</p>`;
  const ts = tramos(serie, t0, t1);
  const H = 38;
  const x = (tt) => (W * (tt - t0)) / (t1 - t0);
  const totales = {};
  for (const [a, b, e] of ts) totales[e] = (totales[e] || 0) + (b - a);
  return `<svg class="cronologia" width="${W}" height="${H + 18}" viewBox="0 0 ${W} ${H + 18}" role="img"
      aria-label="${esc(t("prod.cronologia"))}">
    ${ts.map(([a, b, e, m]) => {
      const xa = x(a), xb = x(b), w = Math.max(0.5, xb - xa - 2);
      const nombre = t(`estado.${e}`);
      return `<g data-estado="${esc(e)}"><rect class="tramo" x="${(xa + 1).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" rx="3">
        <title>${esc(`${nombre} (${e}) · ${hora(a, false)}–${hora(b, false)} · ${duracionCorta(b - a)}${m ? " · " + m : ""}`)}</title></rect>
        ${w > nombre.length * 7.5 ? `<text class="tramo-txt" x="${(xa + 8).toFixed(1)}" y="${H / 2 + 4}">${esc(nombre)}</text>` : ""}</g>`;
    }).join("")}
    ${[0, 0.25, 0.5, 0.75, 1].map((k) => `<text class="eje" x="${(k * W).toFixed(1)}" y="${H + 14}"
      text-anchor="${k === 0 ? "start" : k === 1 ? "end" : "middle"}">${esc(hora(t0 + k * (t1 - t0), false))}</text>`).join("")}
  </svg>
  <div class="leyenda-tiempos">${Object.entries(totales).sort((p, q) => q[1] - p[1])
    .map(([e, s]) => `<span>${insignia(e)} ${esc(duracionCorta(s))}</span>`).join("")}</div>`;
}
