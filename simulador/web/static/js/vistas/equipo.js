// Ficha de un equipo: dibujo animado, indicadores, valores, tendencia, eventos, cómo leerlo e incidencias.
import { api } from "../api.js";
import { refrescarYa } from "../bus.js";
import { t } from "../i18n.js";
import { $, esc, horaIso, insignia, num, poner, valor } from "../util.js";
import { htmlAcceso } from "../componentes/acceso.js";
import { actualizarIncidencias, escucharIncidencias, htmlIncidencias } from "../componentes/incidencias.js";
import { modulo } from "../equipos/index.js";

let raiz = null, id = null, meta = null, mod = null, nodoDibujo = null;
let temporizador = null, claveSalidas = "";

function montar(el, ctx, params) {
  raiz = el;
  id = params[0];
  meta = ctx.plano.equipos.find((e) => e.id === id);
  if (!meta) {
    el.innerHTML = `<div class="tarjeta"><p>${esc(t("ficha.no_existe", { id }))}</p><a href="#/">${esc(t("ficha.volver"))}</a></div>`;
    raiz = null;
    return;
  }
  mod = modulo(meta.tipo);
  el.innerHTML = `
    <div class="titulo-vista titulo-ficha">
      <a href="#/" class="volver" data-i18n="ficha.volver"></a>
      <img class="ilustracion" alt="" src="/static/img/equipos/${esc(mod.imagen(meta))}.webp" onerror="this.remove()">
      <div class="nombre">
        <h1>${esc(id)} <span id="ficha-estado"></span></h1>
        <p>${esc(meta.descripcion)}</p>
        <p class="nota"><span data-i18n="ficha.tipo"></span> <span class="mono">${esc(meta.tipo)}</span>
          · <span data-i18n="ficha.linea"></span> <span class="mono">${esc(meta.linea)}</span>
          · ${esc(t(`tipo.${meta.tipo}`))}</p>
      </div>
      <label class="interruptor enviar"><input type="checkbox" id="ficha-publicar"><span data-i18n="ficha.enviar"></span></label>
    </div>
    <div class="ficha">
      <div class="ficha-principal">
        <section class="tarjeta tarjeta-dibujo"><div id="ficha-dibujo" class="dibujo"></div>
          <p class="nota" data-i18n="ficha.dibujo_ayuda"></p></section>
        <div id="ficha-destacados" class="destacados"></div>
        <section class="tarjeta" id="ficha-tendencia-tarjeta" hidden>
          <header><h2 data-i18n="ficha.tendencia"></h2><div id="ficha-campos" class="campos"></div></header>
          <div id="ficha-tendencia"></div>
          <p class="nota" data-i18n="ficha.tendencia_ayuda"></p>
        </section>
        <section class="tarjeta">
          <header><h2 data-i18n="ficha.recientes"></h2></header>
          <div id="ficha-recientes" class="recientes"></div>
        </section>
      </div>
      <div class="ficha-lateral">
        <section class="tarjeta" id="ficha-inc-tarjeta" hidden>
          <header><h2 data-i18n="ficha.incidencias"></h2></header><div id="ficha-inc"></div></section>
        <section class="tarjeta">
          <header><h2 data-i18n="ficha.valores"></h2></header>
          <p class="nota" data-i18n="ficha.valores_ayuda"></p>
          <table class="valores"><tbody id="ficha-valores"></tbody></table>
        </section>
        <section class="tarjeta">
          <header><h2 data-i18n="ficha.como_leerlo"></h2></header>
          <div id="ficha-acceso"></div>
        </section>
      </div>
    </div>`;
  nodoDibujo = null;
  claveSalidas = "";
  escucharIncidencias(el);
  el.addEventListener("change", async (ev) => {
    if (ev.target.id !== "ficha-publicar") return;
    try { await api(`/api/equipos/${encodeURIComponent(id)}`, { publicar: ev.target.checked }); } catch { /* aviso */ }
    refrescarYa();
  });
  mod.montarFicha?.(el, meta, ctx);
  pedirRecientes();
  temporizador = setInterval(pedirRecientes, 3000);
}

function desmontar() {
  clearInterval(temporizador);
  mod?.desmontarFicha?.();
  raiz = null;
}

function actualizar(ctx) {
  if (!raiz) return;
  const v = ctx.vista.equipos[id];
  const eq = ctx.estado.equipos.find((e) => e.id === id);
  if (!v || !eq) return;
  poner($("#ficha-estado", raiz), insignia(v.estado, { literal: true }));
  const pub = $("#ficha-publicar", raiz);
  if (document.activeElement !== pub) pub.checked = eq.publicar;

  // Dibujo animado (lo crea el módulo del tipo una vez; después solo se actualiza)
  if (!nodoDibujo) {
    nodoDibujo = $("#ficha-dibujo", raiz);
    nodoDibujo.innerHTML = mod.dibujo(meta);
  }
  mod.actualizar(nodoDibujo, datosEquipo(ctx), ctx);

  // Indicadores destacados del tipo
  poner($("#ficha-destacados", raiz), (mod.destacados?.(datosEquipo(ctx), ctx) || []).map((d) => `
    <div class="destacado${d.clase ? " " + d.clase : ""}"><small>${esc(d.titulo)}</small>
      <b>${d.html ?? esc(d.valor)}</b>${d.unidad ? `<span>${esc(d.unidad)}</span>` : ""}
      ${d.pie ? `<em>${esc(d.pie)}</em>` : ""}</div>`).join(""));

  // Todos los valores, con el nombre del campo tal cual llega en los datos
  poner($("#ficha-valores", raiz), v.valores
    ? Object.entries(v.valores).map(([k, x]) => `<tr><td class="mono">${esc(k)}</td><td class="num mono">${esc(valor(x))}</td></tr>`).join("")
    : `<tr><td class="nota">${esc(t(meta.tipo === "mes" ? "ficha.sin_telemetria_mes" : "ficha.sin_telemetria"))}</td></tr>`);

  // Incidencias
  const inc = htmlIncidencias(eq);
  const tarjetaInc = $("#ficha-inc-tarjeta", raiz);
  tarjetaInc.hidden = !inc;
  if (inc && !$("#ficha-inc", raiz).firstElementChild) $("#ficha-inc", raiz).innerHTML = inc;
  actualizarIncidencias(raiz, ctx.estado);

  // Cómo leerlo: se pide de nuevo si cambia alguna salida
  const clave = ctx.estado.salidas.map((s) => `${s.nombre}${s.activa}`).join();
  if (clave !== claveSalidas) {
    claveSalidas = clave;
    htmlAcceso(id).then((h) => raiz && poner($("#ficha-acceso", raiz), h));
  }
  mod.actualizarFicha?.(raiz, datosEquipo(ctx), ctx);
}

/** Lo que recibe el módulo de un tipo de equipo para dibujarse. */
function datosEquipo(ctx) {
  const v = ctx.vista.equipos[id];
  return { id, meta, estado: v.estado, valores: v.valores || {}, ciclos: v.ciclos,
    linea: ctx.vista.lineas.find((l) => l.id === meta.linea) };
}

async function pedirRecientes() {
  if (!raiz) return;
  const filtro = meta.tipo === "mes" ? `linea=${encodeURIComponent(meta.linea)}` : `equipo=${encodeURIComponent(id)}`;
  let r;
  try { r = await api(`/api/recientes?${filtro}&n=25`, undefined, { silencioso: true }); } catch { return; }
  if (!raiz) return;
  let h = "";
  if (meta.tipo === "inspeccion") h += htmlInspecciones(r.inspecciones.slice(0, 8));
  if (meta.tipo === "mes") h += htmlOrdenes(r.ordenes.slice(0, 6));
  const eventos = meta.tipo === "mes" ? [] : r.eventos;
  if (eventos.length) {
    h += `<h3>${esc(t("ficha.eventos"))}</h3><ul class="eventos">${eventos.map((e) => `
      <li class="sev-${esc(e.severidad)}"><span class="cuando">${esc(horaIso(e.ts))}</span>
        <span class="mono tipo-ev">${esc(e.tipo_evento)}</span>${e.codigo ? ` <span class="mono">${esc(e.codigo)}</span>` : ""}
        <span class="msg">${esc(e.mensaje)}</span></li>`).join("")}</ul>`;
  } else if (meta.tipo !== "mes" && meta.tipo !== "inspeccion") {
    h += `<p class="nota">${esc(t("ficha.sin_eventos"))}</p>`;
  }
  poner($("#ficha-recientes", raiz), h || `<p class="nota">${esc(t("ficha.sin_eventos"))}</p>`);
}

function htmlInspecciones(lista) {
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

function htmlOrdenes(lista) {
  if (!lista.length) return `<p class="nota">${esc(t("ficha.sin_ordenes"))}</p>`;
  return `<h3>${esc(t("ficha.ordenes"))}</h3><div class="tabla-desliza"><table class="ordenes"><thead><tr>
    <th>orden_id</th><th>referencia</th><th class="num">ok / nok</th><th>motivo_cierre</th><th>fin</th></tr></thead><tbody>
    ${lista.map((o) => `<tr><td class="mono">${esc(o.orden_id)}</td><td>${esc(o.referencia)}</td>
      <td class="num">${num(o.piezas_ok, 0)} / ${num(o.piezas_nok, 0)}</td><td class="mono">${esc(o.motivo_cierre)}</td>
      <td>${esc(horaIso(o.fin, false))}</td></tr>`).join("")}</tbody></table></div>`;
}

export default { montar, actualizar, desmontar, titulo: (p) => p[0] || "app.titulo" };
