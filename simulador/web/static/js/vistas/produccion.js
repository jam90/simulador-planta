// Producción y calidad: estado de cada línea, orden en curso, cronología de estados, OEE del turno
// explicado con sus cifras, calidad por cota, últimas inspecciones y órdenes cerradas.
import { api } from "../api.js";
import { idioma, t } from "../i18n.js";
import { $, duracionCorta, esc, hora, insignia, nombreTurno, num, pct, poner } from "../util.js";
import { htmlCronologia } from "../componentes/cronologia.js";
import { htmlInspecciones, htmlOrdenes } from "../componentes/registros.js";

let raiz = null, temporizador = null, recientes = {};
const VENTANA_S = 3600;
const PASO_CRONO_S = 60;       // la cronología se rehace como mucho una vez por minuto simulado

function montar(el, ctx) {
  raiz = el;
  recientes = {};
  el.innerHTML = `
    <div class="titulo-vista cabecera-seccion">
      <div><h1 data-i18n="prod.titulo"></h1><p data-i18n="prod.subtitulo"></p></div>
      <img src="/static/img/escenas/cabecera-produccion.webp" alt="" onerror="this.remove()">
    </div>
    ${ctx.vista.lineas.map((l) => `<div class="bloque-linea" data-linea="${esc(l.id)}">
      <h2 class="titulo-linea">${esc(l.id)} · ${esc(ctx.plano.zonas_desc?.[l.id] || "")}</h2>
      <div class="rejilla">
        <section class="tarjeta"><header><h2 data-i18n="prod.estado"></h2></header><div data-p="estado"></div></section>
        <section class="tarjeta"><header><h2 data-i18n="portada.orden"></h2></header><div data-p="orden"></div></section>
        <section class="tarjeta"><header><h2 data-i18n="portada.oee"></h2></header><div data-p="oee"></div></section>
      </div>
      <section class="tarjeta"><header><h2 data-i18n="prod.cronologia"></h2><span class="nota" data-i18n="prod.cronologia_ayuda"></span></header>
        <div data-p="crono" class="contenedor-crono"></div></section>
      <div class="rejilla">
        <section class="tarjeta"><header><h2 data-i18n="prod.oee_detalle"></h2></header><div data-p="oee-detalle"></div></section>
        <section class="tarjeta"><header><h2 data-i18n="prod.calidad"></h2></header><div data-p="calidad"></div></section>
      </div>
      <section class="tarjeta"><header><h2 data-i18n="prod.ordenes"></h2></header>
        <p class="nota" data-i18n="prod.ordenes_ayuda"></p><div data-p="ordenes"></div></section>
    </div>`).join("")}`;
  pedir(ctx);
  temporizador = setInterval(() => pedir(ctx), 4000);
}

function desmontar() {
  clearInterval(temporizador);
  raiz = null;
}

async function pedir(ctx) {
  for (const l of ctx.vista?.lineas || []) {
    try {
      recientes[l.id] = await api(`/api/recientes?linea=${encodeURIComponent(l.id)}&n=60`, undefined, { silencioso: true });
    } catch { /* se reintenta */ }
  }
  if (raiz) pintarRegistros();
}

function bloque(id) { return raiz.querySelector(`.bloque-linea[data-linea="${CSS.escape(id)}"]`); }
const parte = (b, p) => b.querySelector(`[data-p="${p}"]`);

function fila(titulo, valor) {
  return `<div class="fila-dato"><span>${esc(titulo)}</span><b>${valor}</b></div>`;
}

function actualizar(ctx) {
  if (!raiz) return;
  const v = ctx.vista;
  for (const l of v.lineas) {
    const b = bloque(l.id);
    if (!b) continue;
    const k = ctx.kpis?.lineas?.[l.id];
    const resta = l.fin_estado ? Math.max(0, l.fin_estado - v.t) : null;
    poner(parte(b, "estado"), `
      <p class="estado-grande">${insignia(l.estado, { literal: true })}</p>
      ${l.motivo ? `<p>${esc(l.motivo)}${l.codigo ? ` <span class="mono">${esc(l.codigo)}</span>` : ""}</p>` : ""}
      ${l.causa ? fila(t("prod.causa"), `<a href="#/equipo/${esc(l.causa)}">${esc(l.causa)}</a>`) : ""}
      ${resta !== null ? `<p class="nota">${esc(t("prod.fin_estado", { s: duracionCorta(resta) }))}</p>` : ""}
      ${fila(t("prod.referencia"), esc(l.referencia))}
      ${fila(t("cab.turno"), esc(nombreTurno(v.turno)))}
      ${fila(t("prod.cadencia"), esc(t("prod.una_cada", { s: num(l.intervalo_pieza, 0) })))}`);

    const o = l.orden;
    const avance = o ? Math.min(1, (o.ok + o.nok) / o.cantidad) : 0;
    poner(parte(b, "orden"), o ? `
      <p class="estado-grande mono">${esc(o.orden_id)}</p>
      ${fila(t("prod.referencia"), esc(o.referencia))}
      ${fila(t("dest.avance_orden"), `${num(o.ok + o.nok, 0)} / ${num(o.cantidad, 0)} (${pct(avance, 0)})`)}
      <i class="avance"><b style="width:${(100 * avance).toFixed(1)}%"></b></i>
      ${fila("OK / NOK", `${num(o.ok, 0)} / ${num(o.nok, 0)}`)}
      ${fila(t("prod.desde"), esc(hora(o.inicio, false)))}
      <p class="nota">${esc(t("prod.orden_ayuda"))}</p>` : `<p class="nota">${esc(t("prod.sin_orden"))}</p>`);

    const oee = k?.oee;
    poner(parte(b, "oee"), k ? `
      <p class="kpi-grande">${oee.oee === null ? "–" : pct(oee.oee, 0)}</p>
      <div class="factores">${barra(t("oee.disponibilidad"), oee.disponibilidad)}${barra(t("oee.rendimiento"), oee.rendimiento)}${barra(t("oee.calidad"), oee.calidad)}</div>
      <p class="nota">${esc(t("prod.oee_turno", { turno: nombreTurno(k.turno) }))}${k.completo ? "" : " " + esc(t("prod.oee_desde", { h: hora(k.desde, false) }))}</p>`
      : `<p class="nota">${esc(t("prod.sin_turno"))}</p>`);

    const crono = parte(b, "crono");
    const ancho = Math.max(300, crono.clientWidth || 900);
    const t1 = Math.ceil(v.t / PASO_CRONO_S) * PASO_CRONO_S, t0 = t1 - VENTANA_S;
    const ultimo = l.estados[l.estados.length - 1];
    const claveC = `${l.estados.length}|${ultimo?.[0]}|${t1}|${ancho}|${idioma()}`;
    if (crono.dataset.clave !== claveC) { crono.innerHTML = htmlCronologia(l.estados, t0, t1, ancho, v.t); crono.dataset.clave = claveC; }

    poner(parte(b, "oee-detalle"), k ? detalleOee(k, l) : `<p class="nota">${esc(t("prod.sin_turno"))}</p>`);
  }
}

function barra(nombre, x) {
  const v = x === null || x === undefined ? 0 : Math.max(0, Math.min(1, x));
  return `<div class="factor"><span>${esc(nombre)}</span><i><b style="width:${(100 * v).toFixed(1)}%"></b></i><span class="num">${pct(x, 0)}</span></div>`;
}

/** El OEE con sus cuentas, para que se entienda de dónde sale cada factor. */
function detalleOee(k, l) {
  const prod = k.segundos.PRODUCCION || 0;
  const teoricas = prod / l.intervalo_pieza;
  const min = (s) => `${num(s / 60, 1)} min`;
  const total = Object.values(k.segundos).reduce((a, b) => a + b, 0) || 1;
  const partes = Object.entries(k.segundos).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  return `
    <ol class="cuentas-oee">
      <li><b>${esc(t("oee.disponibilidad"))} = ${pct(k.oee.disponibilidad, 1)}</b>
        <span>${esc(t("prod.cuenta_disp", { prod: min(prod), plan: min(k.planificado_s) }))}</span></li>
      <li><b>${esc(t("oee.rendimiento"))} = ${pct(k.oee.rendimiento, 1)}</b>
        <span>${esc(t("prod.cuenta_rend", { piezas: num(k.piezas, 0), teoricas: num(teoricas, 1), s: num(l.intervalo_pieza, 0) }))}</span></li>
      <li><b>${esc(t("oee.calidad"))} = ${pct(k.oee.calidad, 1)}</b>
        <span>${esc(t("prod.cuenta_cal", { ok: num(k.piezas_ok, 0), total: num(k.piezas, 0) }))}</span></li>
      <li><b>OEE = ${pct(k.oee.oee, 1)}</b> <span>${esc(t("prod.cuenta_oee"))}</span></li>
    </ol>
    <h3>${esc(t("prod.tiempo_estados"))}</h3>
    <div class="segmentos" role="img" aria-label="${esc(t("prod.tiempo_estados"))}">${partes.map(([e, s]) =>
      `<i data-estado="${esc(e)}" style="flex:${s / total}" title="${esc(`${t(`estado.${e}`)}: ${duracionCorta(s)}`)}"></i>`).join("")}</div>
    <div class="leyenda-tiempos">${partes.map(([e, s]) => `<span>${insignia(e)} ${esc(duracionCorta(s))}</span>`).join("")}</div>
    <p class="nota">${esc(t("prod.oee_nota"))}</p>`;
}

function pintarRegistros() {
  for (const [id, r] of Object.entries(recientes)) {
    const b = bloque(id);
    if (!b) continue;
    // Calidad por cota en las últimas piezas inspeccionadas
    const ins = r.inspecciones || [];
    const porCota = {};
    for (const i of ins) for (const m of i.medidas) {
      porCota[m.cota] ||= { total: 0, nok: 0, unidad: m.unidad };
      porCota[m.cota].total++;
      if (m.resultado === "NOK") porCota[m.cota].nok++;
    }
    const nok = ins.filter((i) => i.resultado === "NOK").length;
    // Barra llena = el 10 % de las piezas fuera de tolerancia en esa cota (así 1 NOK no parece un desastre)
    const LLENA = 0.1;
    poner(parte(b, "calidad"), ins.length ? `
      <p>${esc(t("prod.ultimas_n", { n: ins.length, nok, pct: num(100 * nok / ins.length, 1) }))}</p>
      <h3>${esc(t("prod.nok_por_cota"))}</h3>
      <div class="barras-cota">${Object.entries(porCota).map(([c, x]) => `<div class="barra-cota">
        <span class="mono">${esc(c)}</span><i><b style="width:${(100 * Math.min(1, x.nok / x.total / LLENA)).toFixed(1)}%"></b></i>
        <span class="num">${num(x.nok, 0)} (${num(100 * x.nok / x.total, 1)} %)</span></div>`).join("")}</div>
      <p class="nota">${esc(t("prod.nok_ayuda"))}</p>
      ${htmlInspecciones(ins.slice(0, 3))}` : `<p class="nota">${esc(t("ficha.sin_inspecciones"))}</p>`);
    const ordenes = (r.ordenes || []).slice(0, 8);
    const cont = parte(b, "ordenes");
    const clave = ordenes.map((o) => o.orden_id).join(",") + idioma();
    if (cont.dataset.clave !== clave) {
      const abiertas = new Set([...cont.querySelectorAll("details[open]")].map((d) => d.dataset.orden));
      cont.innerHTML = htmlOrdenes(ordenes, { materiales: true, titulo: false, abiertas });
      cont.dataset.clave = clave;
    }
  }
}

export default { montar, actualizar, desmontar, titulo: () => "nav.produccion" };
