// Energía: de dónde viene y adónde va (diagrama de flujo animado a partir de la jerarquía de
// medidores de la configuración), tarifa del día, costes, reparto del consumo, evolución en vivo
// y de dónde sacar los datos de energía.
import { api } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, num, poner } from "../util.js";
import { htmlAcceso } from "../componentes/acceso.js";
import { Tendencia } from "../componentes/tendencia.js";
import { modulo } from "../equipos/index.js";

let raiz = null, temporizador = null, tendencia = null, plano = null, nodosFlujo = null, claveAcceso = "";

function montar(el, ctx) {
  raiz = el;
  plano = ctx.plano;
  el.innerHTML = `
    <div class="titulo-vista cabecera-seccion">
      <div><h1 data-i18n="ener.titulo"></h1><p data-i18n="ener.subtitulo"></p></div>
      <img src="/static/img/escenas/cabecera-energia.webp" alt="" onerror="this.remove()">
    </div>
    <div class="kpis" id="ener-kpis"></div>
    <section class="tarjeta"><header><h2 data-i18n="ener.flujo"></h2></header>
      <div id="ener-flujo" class="contenedor-flujo"></div>
      <p class="nota" data-i18n="ener.flujo_ayuda"></p></section>
    <div class="rejilla" style="margin-top:14px">
      <section class="tarjeta"><header><h2 data-i18n="ener.tarifa"></h2></header><div id="ener-tarifa"></div>
        <p class="nota" data-i18n="ener.tarifa_ayuda"></p></section>
      <section class="tarjeta"><header><h2 data-i18n="ener.reparto"></h2></header><div id="ener-reparto"></div>
        <p class="nota" data-i18n="ener.reparto_ayuda"></p></section>
    </div>
    <section class="tarjeta" style="margin-top:14px"><header><h2 data-i18n="ficha.tendencia"></h2></header>
      <div id="ener-tendencia" class="tendencia"></div><p class="nota" data-i18n="ener.tendencia_ayuda"></p></section>
    <section class="tarjeta" style="margin-top:14px"><header><h2 data-i18n="ener.datos"></h2></header>
      <div id="ener-datos"></div></section>`;
  dibujarFlujo();
  tendencia = new Tendencia($("#ener-tendencia", el));
  claveAcceso = "";
  pedirTarifa();
  pedirTendencia();
  temporizador = setInterval(() => { pedirTendencia(); pedirTarifa(); }, 5000);
}

function desmontar() {
  clearInterval(temporizador);
  tendencia?.destruir();
  tendencia = null;
  raiz = null;
}

// --- Diagrama de flujo -----------------------------------------------------------------
const W = 1000;
const FILA = 62;
const MEDIO = 92;            // medio ancho de cada caja del diagrama

/** Coloca red, contador, generadores, cuadros y consumidores según la jerarquía (mide / generacion). */
function disposicion() {
  const eqs = Object.fromEntries(plano.equipos.map((e) => [e.id, e]));
  const contador = plano.equipos.find((e) => e.tipo === "contador_general");
  if (!contador) return null;
  const cuadros = contador.mide.map((id) => eqs[id]).filter(Boolean);
  const grupos = cuadros.map((c) => ({ cuadro: c, hijos: c.mide.map((id) => eqs[id]).filter(Boolean) }));
  const filas = Math.max(3, grupos.reduce((a, g) => a + Math.max(1, g.hijos.length), 0));
  const H = 70 + filas * FILA;
  const nodos = {};
  let fila = 0;
  for (const g of grupos) {
    const n = Math.max(1, g.hijos.length);
    const yCentro = 70 + (fila + n / 2) * FILA;
    nodos[g.cuadro.id] = { e: g.cuadro, x: 585, y: yCentro };
    g.hijos.forEach((h, i) => { nodos[h.id] = { e: h, x: 890, y: 70 + (fila + i + 0.5) * FILA }; });
    fila += n;
  }
  const yC = (Math.min(...cuadros.map((c) => nodos[c.id].y)) + Math.max(...cuadros.map((c) => nodos[c.id].y))) / 2;
  nodos[contador.id] = { e: contador, x: 330, y: yC };
  nodos.__red = { e: { id: "__red", tipo: "red" }, x: 95, y: yC };
  contador.generacion.forEach((id, i) => { if (eqs[id]) nodos[id] = { e: eqs[id], x: 330, y: 40 + i * FILA }; });
  const enlaces = [["__red", contador.id, "red"]];
  for (const id of contador.generacion) if (eqs[id]) enlaces.push([id, contador.id, "gen"]);
  for (const g of grupos) {
    enlaces.push([contador.id, g.cuadro.id, "cuadro"]);
    for (const h of g.hijos) enlaces.push([g.cuadro.id, h.id, "consumo"]);
  }
  return { nodos, enlaces, H, contador: contador.id };
}

function dibujarFlujo() {
  const d = disposicion();
  const cont = $("#ener-flujo", raiz);
  if (!d) { cont.innerHTML = `<p class="nota">–</p>`; nodosFlujo = null; return; }
  const camino = ([a, b]) => {
    const p = d.nodos[a], q = d.nodos[b];
    const x1 = p.x + MEDIO, x2 = q.x - MEDIO;
    if (a !== "__red" && d.nodos[b] && p.x === q.x) return `M${p.x} ${p.y + 22} L${q.x} ${q.y - 26}`;   // generador encima
    return `M${x1} ${p.y} C ${(x1 + x2) / 2} ${p.y}, ${(x1 + x2) / 2} ${q.y}, ${x2} ${q.y}`;
  };
  const nodo = ({ e, x, y }) => {
    const img = e.tipo === "red" ? "" : `<image href="/static/img/equipos/${esc(modulo(e.tipo).imagen(e))}.webp" x="${x - MEDIO + 6}" y="${y - 20}" width="40" height="40"/>`;
    const nombre = e.tipo === "red" ? t("ener.red") : e.id;
    const xt = e.tipo === "red" ? x - MEDIO + 14 : x - MEDIO + 52;
    const cuerpo = `<rect class="nodo" x="${x - MEDIO}" y="${y - 24}" width="${2 * MEDIO}" height="48" rx="10"/>${img}
      <text class="nodo-nombre" x="${xt}" y="${y - 4}">${esc(nombre)}</text>
      <text class="nodo-valor" data-valor="${esc(e.id)}" x="${xt}" y="${y + 13}">–</text>`;
    return e.tipo === "red" ? `<g class="nodo-flujo red">${cuerpo}</g>`
      : `<a href="#/equipo/${esc(e.id)}" class="nodo-flujo"><title>${esc(`${e.id} · ${e.descripcion}`)}</title>${cuerpo}</a>`;
  };
  cont.innerHTML = `<svg class="flujo" viewBox="0 0 ${W} ${d.H}" role="img" aria-label="${esc(t("ener.flujo"))}">
    ${d.enlaces.map((en) => `<path class="enlace-fondo" d="${camino(en)}"/>
      <path class="enlace ${en[2]}" data-enlace="${esc(en[0])}>${esc(en[1])}" d="${camino(en)}"/>`).join("")}
    ${Object.values(d.nodos).map(nodo).join("")}
  </svg>`;
  nodosFlujo = d;
}

function potencia(ctx, id) {
  const v = ctx.vista.equipos[id]?.valores || {};
  return v.potencia_activa_kw ?? v.potencia_generada_kw ?? v.potencia_kw ?? null;
}

function actualizarFlujo(ctx) {
  const d = nodosFlujo;
  if (!d) return;
  const max = 60;
  const neto = potencia(ctx, d.contador) ?? 0;
  for (const el of raiz.querySelectorAll("[data-valor]")) {
    const id = el.dataset.valor;
    const kw = id === "__red" ? neto : potencia(ctx, id);
    const s = kw === null ? "–" : id === "__red" ? `${t(neto < 0 ? "dest.vende" : "dest.compra")} ${num(Math.abs(kw), 1)} kW` : `${num(kw, 1)} kW`;
    if (el.textContent !== s) el.textContent = s;
  }
  for (const el of raiz.querySelectorAll("[data-enlace]")) {
    const [a, b] = el.dataset.enlace.split(">");
    let kw;
    if (a === "__red") kw = neto;
    else if (el.classList.contains("gen")) kw = potencia(ctx, a);
    else kw = potencia(ctx, b);
    kw = kw ?? 0;
    const k = Math.min(1, Math.abs(kw) / max);
    el.style.strokeWidth = `${(2 + 12 * k).toFixed(1)}px`;
    el.style.animationDuration = `${Math.max(0.5, 4 - 3.5 * k).toFixed(2)}s`;
    el.classList.toggle("parado", Math.abs(kw) < 0.05 || ctx.vista.pausado);
    el.classList.toggle("inverso", a === "__red" && kw < 0);       // vende: la energía sale hacia la red
  }
}

// --- Tarifa, reparto, indicadores ----------------------------------------------------------
async function pedirTarifa() {
  let tf;
  try { tf = await api("/api/tarifa", undefined, { silencioso: true }); } catch { return; }
  if (!raiz || !tf.horas.length) return;
  const precios = tf.horas.map((h) => h.precio_eur_kwh);
  const pmin = Math.min(...precios), pmax = Math.max(...precios);
  const periodos = [...new Set(tf.horas.map((h) => h.periodo))].sort();
  poner($("#ener-tarifa", raiz), `
    <p>${esc(t("ener.tarifa_dia", { fecha: tf.fecha }))}</p>
    <div class="franja-tarifa" role="img" aria-label="${esc(t("ener.tarifa"))}">${tf.horas.map((h) => {
      const k = pmax > pmin ? (h.precio_eur_kwh - pmin) / (pmax - pmin) : 0.5;
      return `<i class="${h.hora === tf.hora_actual ? "ahora" : ""}" style="--k:${k.toFixed(2)}"
        title="${esc(`${String(h.hora).padStart(2, "0")}:00 · ${h.periodo} · ${num(h.precio_eur_kwh, 2)} €/kWh · ${t("dest.contratada")} ${h.contratada_kw} kW`)}">
        <span>${h.periodo.slice(1)}</span></i>`;
    }).join("")}</div>
    <div class="eje-franja"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>24 h</span></div>
    <table class="valores"><thead><tr><th>${esc(t("dest.periodo"))}</th><th class="num">€/kWh</th></tr></thead>
      <tbody>${periodos.map((p) => `<tr><td><b>${esc(p)}</b></td><td class="num">${num(tf.horas.find((h) => h.periodo === p).precio_eur_kwh, 2)}</td></tr>`).join("")}
      <tr><td>${esc(t("ener.excedentes"))}</td><td class="num">${num(tf.precio_excedentes_eur_kwh, 2)}</td></tr></tbody></table>`);
}

function pintarKpis(ctx) {
  const en = ctx.kpis?.energia;
  if (!en) return;
  const cg = plano.equipos.find((e) => e.tipo === "contador_general");
  const v = cg ? ctx.vista.equipos[cg.id]?.valores || {} : {};
  const k = v.potencia_contratada_kw ? (v.potencia_media_15min_kw ?? 0) / v.potencia_contratada_kw : 0;
  const sinMedia = !v.potencia_media_15min_kw && !v.maximetro_kw;
  const tarjeta = (titulo, valor, pie = "", extra = "", clase = "") =>
    `<div class="kpi ${clase}"><small>${esc(titulo)}</small><b>${valor}</b>${extra}${pie ? `<em>${pie}</em>` : ""}</div>`;
  poner($("#ener-kpis", raiz), [
    tarjeta(t("ener.periodo_ahora"), v.periodo_tarifario ? `${esc(v.periodo_tarifario)} <span>${num(v.precio_eur_kwh, 2)} €/kWh</span>` : "–",
      esc(t("portada.tarifa_pie"))),
    // El contador calcula la media al cerrar cada cuarto de hora completo (el primero tras arrancar no cuenta)
    sinMedia
      ? tarjeta(t("dest.media_15"), "–", esc(t("ener.media_pendiente")))
      : tarjeta(t("dest.media_15"), `${num(v.potencia_media_15min_kw, 1)} <span>kW</span>`,
      esc(`${t("dest.contratada")} ${num(v.potencia_contratada_kw, 0)} kW · ${t("dest.maximetro")} ${num(v.maximetro_kw, 1)} kW`),
      `<i class="avance${k > 1 ? " mal" : ""}"><b style="width:${(100 * Math.min(1, k)).toFixed(1)}%"></b></i>`, k > 1 ? "kpi-mal" : ""),
    tarjeta(t("portada.coste_turno"), en.turno ? `${num(en.turno.coste_eur, 2)} <span>€</span>` : "–",
      en.turno ? esc(`${num(en.turno.importada_kwh, 1)} kWh ${t("ener.importados")}`) : ""),
    tarjeta(t("dest.coste"), `${num(v.coste_acumulado_eur, 2)} <span>€</span>`,
      esc(`${t("ener.ingresos")}: ${num(v.ingresos_excedentes_eur, 2)} €`)),
  ].join(""));
}

function pintarReparto(ctx) {
  const consumidores = plano.equipos.filter((e) => !["analizador_red", "contador_general", "fotovoltaica", "ambiente", "mes", "inspeccion"].includes(e.tipo))
    .map((e) => ({ e, kw: ctx.vista.equipos[e.id]?.valores?.potencia_kw ?? null }))
    .filter((x) => x.kw !== null).sort((a, b) => b.kw - a.kw);
  const max = Math.max(1, ...consumidores.map((x) => x.kw));
  const total = consumidores.reduce((a, x) => a + x.kw, 0);
  poner($("#ener-reparto", raiz), `<div class="barras-reparto">${consumidores.map(({ e, kw }) => `
    <a class="barra-reparto" href="#/equipo/${esc(e.id)}"><span class="mono">${esc(e.id)}</span>
      <i><b style="width:${(100 * kw / max).toFixed(1)}%"></b></i>
      <span class="num">${num(kw, 1)} kW</span><span class="num tenue">${num(100 * kw / (total || 1), 0)} %</span></a>`).join("")}</div>`);
}

// --- Evolución y datos -------------------------------------------------------------------------
async function pedirTendencia() {
  if (!raiz) return;
  const cg = plano.equipos.find((e) => e.tipo === "contador_general");
  const fv = plano.equipos.find((e) => e.tipo === "fotovoltaica");
  const pedidos = [];
  if (cg) pedidos.push([cg.id, "potencia_activa_kw"], [cg.id, "potencia_media_15min_kw"]);
  if (fv) pedidos.push([fv.id, "potencia_generada_kw"]);
  try {
    const porEquipo = {};
    for (const [id, campo] of pedidos) (porEquipo[id] ||= []).push(campo);
    const respuestas = await Promise.all(Object.entries(porEquipo).map(async ([id, campos]) =>
      [id, await api(`/api/tendencia/${encodeURIComponent(id)}?campos=${campos.join(",")}&n=360`, undefined, { silencioso: true })]));
    // Mismas horas en todos los equipos (el observador los muestrea juntos): se alinean por la del contador
    const base = respuestas[0][1];
    const series = {};
    for (const [id, r] of respuestas) {
      const pos = new Map(r.t.map((tt, i) => [tt, i]));
      for (const [campo, vals] of Object.entries(r.series)) series[`${id}.${campo}`] = base.t.map((tt) => vals[pos.get(tt)] ?? null);
    }
    if (raiz && tendencia) tendencia.poner({ t: base.t, series }, Object.keys(series));
  } catch { /* se reintenta */ }
}

async function pintarDatos(ctx) {
  const clave = ctx.estado.salidas.map((s) => `${s.nombre}${s.activa}`).join();
  if (clave === claveAcceso) return;
  claveAcceso = clave;
  const cg = plano.equipos.find((e) => e.tipo === "contador_general");
  const curva = ctx.estado.salidas.find((s) => s.nombre === "curva_csv");
  const acceso = cg ? await htmlAcceso(cg.id) : "";
  if (!raiz) return;
  poner($("#ener-datos", raiz), `
    ${curva ? `<h3>${esc(t("ener.curva"))}</h3><p>${esc(t("ener.curva_ayuda"))}</p>
      <p><code>${esc(curva.parametros.ruta || "")}/curva-cuartohoraria-AAAA-MM-DD.csv</code>
      ${curva.activa ? "" : ` <small class="aviso-salida">(${esc(t("acceso.desactivada"))})</small>`}</p>` : ""}
    <h3>${esc(t("ener.contador_datos", { id: cg?.id || "" }))}</h3>${acceso}`);
}

function actualizar(ctx) {
  if (!raiz) return;
  actualizarFlujo(ctx);
  pintarKpis(ctx);
  pintarReparto(ctx);
  pintarDatos(ctx);
}

export default { montar, actualizar, desmontar, titulo: () => "nav.energia" };
