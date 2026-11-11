// Registros que se muestran en varias pantallas: inspecciones (con sus cotas) y órdenes de fabricación.
// Los nombres de los campos van tal como llegan en los datos.
import { t } from "../i18n.js";
import { esc, horaIso, num, valor } from "../util.js";

export function htmlInspecciones(lista) {
  if (!lista.length) return `<p class="nota">${esc(t("ficha.sin_inspecciones"))}</p>`;
  return `<h3>${esc(t("ficha.inspecciones"))}</h3>${lista.map((i) => `
    <div class="inspeccion ${i.resultado === "OK" ? "ok" : "nok"}">
      <div class="cab-insp"><b class="mono">${esc(i.pieza_id)}</b> <span class="res">${esc(i.resultado)}</span>
        <small>${esc(horaIso(i.ts))} · ${esc(i.referencia)} · <span class="mono">${esc(i.orden_id ?? "")}</span></small></div>
      <div class="cotas">${i.medidas.map((m) => htmlCota(m)).join("")}</div>
    </div>`).join("")}`;
}

/** Una cota: barra de tolerancia con la marca de la desviación medida. */
export function htmlCota(m) {
  const rango = m.tol_max - m.tol_min || 1;
  const pos = Math.max(-0.08, Math.min(1.08, (m.desviacion - m.tol_min) / rango)) * 100;
  return `<div class="cota ${m.resultado === "OK" ? "ok" : "nok"}" title="${esc(`${m.valor} ${m.unidad} (${m.nominal} ${m.tol_min}/+${m.tol_max})`)}">
    <span class="mono nombre-cota">${esc(m.cota)}</span>
    <span class="barra-tol"><i style="left:${pos.toFixed(1)}%"></i></span>
    <span class="mono num">${esc(valor(m.valor))} ${esc(m.unidad)}</span></div>`;
}

export function htmlOrdenes(lista, { materiales = false, titulo = true, abiertas = new Set() } = {}) {
  if (!lista.length) return `<p class="nota">${esc(t("ficha.sin_ordenes"))}</p>`;
  if (materiales) {
    return `${titulo ? `<h3>${esc(t("ficha.ordenes"))}</h3>` : ""}${lista.map((o) => `<details class="orden" data-orden="${esc(o.orden_id)}"${abiertas.has(o.orden_id) ? " open" : ""}>
      <summary><b class="mono">${esc(o.orden_id)}</b> ${esc(o.referencia)} · ${num(o.piezas_ok, 0)} OK / ${num(o.piezas_nok, 0)} NOK
        <span class="mono tenue">${esc(o.motivo_cierre)}</span> <small>${esc(horaIso(o.inicio, false))}–${esc(horaIso(o.fin, false))}</small></summary>
      <table class="valores"><thead><tr><th>material</th><th class="num">cantidad_prevista</th><th class="num">cantidad_real</th>
        <th>unidad</th><th>lotes</th></tr></thead><tbody>
        ${o.materiales.map((m) => `<tr><td class="mono">${esc(m.material)}</td><td class="num">${esc(valor(m.cantidad_prevista))}</td>
          <td class="num${m.cantidad_real > m.cantidad_prevista * 1.03 ? " exceso" : ""}">${esc(valor(m.cantidad_real))}</td>
          <td>${esc(m.unidad)}</td><td class="mono">${esc(m.lotes.join(", "))}</td></tr>`).join("")}</tbody></table>
    </details>`).join("")}`;
  }
  return `<h3>${esc(t("ficha.ordenes"))}</h3><div class="tabla-desliza"><table class="ordenes"><thead><tr>
    <th>orden_id</th><th>referencia</th><th class="num">ok / nok</th><th>motivo_cierre</th><th>fin</th></tr></thead><tbody>
    ${lista.map((o) => `<tr><td class="mono">${esc(o.orden_id)}</td><td>${esc(o.referencia)}</td>
      <td class="num">${num(o.piezas_ok, 0)} / ${num(o.piezas_nok, 0)}</td><td class="mono">${esc(o.motivo_cierre)}</td>
      <td>${esc(horaIso(o.fin, false))}</td></tr>`).join("")}</tbody></table></div>`;
}
