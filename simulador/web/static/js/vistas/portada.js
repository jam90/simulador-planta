// Portada: indicadores del turno, sinóptico animado de la planta, incidencias activas y últimos avisos.
import { api } from "../api.js";
import { t } from "../i18n.js";
import { $, duracion, esc, hora, horaIso, insignia, nombreTurno, num, pct, poner } from "../util.js";
import { Sinoptico } from "../componentes/sinoptico.js";
import { htmlIncidencias, actualizarIncidencias, escucharIncidencias } from "../componentes/incidencias.js";

let raiz = null, sinoptico = null, temporizador = null;

function montar(el, ctx) {
  raiz = el;
  el.innerHTML = `
    <div class="kpis" id="kpis"></div>
    <section class="tarjeta tarjeta-sinoptico">
      <header><h2 data-i18n="portada.planta_vivo"></h2>
        <span class="nota" id="portada-modo"></span>
        <div class="leyenda">${["PRODUCCION", "ARRANQUE", "ESPERA", "MICROPARADA", "AVERIA", "MANTENIMIENTO", "CAMBIO_FORMATO", "PARADA"]
          .map((e) => insignia(e)).join("")}</div></header>
      <div id="sinoptico" class="contenedor-sinoptico"></div>
      <p class="nota" data-i18n="portada.ayuda_sinoptico"></p>
    </section>
    <div class="rejilla portada-bajo">
      <section class="tarjeta"><header><h2 data-i18n="portada.incidencias"></h2></header>
        <div id="portada-incidencias"></div></section>
      <section class="tarjeta"><header><h2 data-i18n="portada.avisos"></h2></header>
        <p class="nota" data-i18n="portada.avisos_ayuda"></p>
        <ul class="eventos" id="portada-avisos"></ul></section>
    </div>`;
  sinoptico = new Sinoptico($("#sinoptico", el), ctx.plano);
  escucharIncidencias(el);
  pedirAvisos();
  temporizador = setInterval(pedirAvisos, 3000);
}

function desmontar() {
  sinoptico?.destruir();
  sinoptico = null;
  clearInterval(temporizador);
  raiz = null;
}

function tarjeta(titulo, valor, pie = "", extra = "", clase = "") {
  return `<div class="kpi ${clase}"><small>${esc(titulo)}</small><b>${valor}</b>${extra}${pie ? `<em>${pie}</em>` : ""}</div>`;
}

function barraOee(nombre, x) {
  const v = x === null || x === undefined ? 0 : Math.max(0, Math.min(1, x));
  return `<div class="factor"><span>${esc(nombre)}</span><i><b style="width:${(100 * v).toFixed(1)}%"></b></i><span class="num">${pct(x, 0)}</span></div>`;
}

function pintarKpis(ctx) {
  const k = ctx.kpis;
  if (!k) return;
  const partes = [];
  for (const l of ctx.vista.lineas) {
    const kl = k.lineas[l.id];
    const turno = kl ? `${nombreTurno(kl.turno)}${kl.en_curso ? "" : ` · ${t("portada.terminado")}`}` : "–";
    const desde = kl && !kl.completo ? `${t("portada.desde")} ${hora(kl.desde, false)}` : "";
    partes.push(tarjeta(`${t("portada.piezas_turno")} · ${l.id}`, kl ? num(kl.piezas, 0) : "–",
      `${esc(turno)}${desde ? " · " + esc(desde) : ""}`,
      kl ? `<span class="okno"><span class="ok">OK ${num(kl.piezas_ok, 0)}</span> <span class="nok">NOK ${num(kl.piezas_nok, 0)}</span>
        <span class="tenue">(${kl.pct_nok === null ? "–" : num(kl.pct_nok, 1) + " %"})</span></span>` : ""));
    const o = l.orden;
    const k2 = o ? Math.min(1, (o.ok + o.nok) / o.cantidad) : 0;
    partes.push(tarjeta(t("portada.orden"), o ? `<span class="mono">${esc(o.orden_id)}</span>` : "–",
      esc(t("dest.calculado_web")),
      o ? `<span>${esc(o.referencia)} · ${num(o.ok + o.nok, 0)} / ${num(o.cantidad, 0)}</span>
        <i class="avance"><b style="width:${(100 * k2).toFixed(1)}%"></b></i>` : ""));
    const oee = kl?.oee;
    partes.push(tarjeta(t("portada.oee"), oee?.oee === null || oee?.oee === undefined ? "–" : pct(oee.oee, 0),
      esc(t("portada.oee_pie")),
      `<div class="factores">${barraOee(t("oee.disponibilidad"), oee?.disponibilidad)}${barraOee(t("oee.rendimiento"), oee?.rendimiento)}${barraOee(t("oee.calidad"), oee?.calidad)}</div>`,
      "kpi-oee"));
  }
  // Potencias del mismo instante que el sinóptico (vista); periodo y coste, de los indicadores
  const en = k.energia;
  const vals = (tipo) => ctx.plano.equipos.filter((e) => e.tipo === tipo).map((e) => ctx.vista.equipos[e.id]?.valores || {});
  const consumo = vals("analizador_red").reduce((a, v) => a + (v.potencia_activa_kw ?? 0), 0);
  const generacion = vals("fotovoltaica").reduce((a, v) => a + (v.potencia_generada_kw ?? 0), 0);
  const neto = vals("contador_general")[0]?.potencia_activa_kw ?? en.neto_kw;
  partes.push(tarjeta(t("portada.energia"), consumo ? `${num(consumo, 1)} <span>kW</span>` : "–",
    esc(t("portada.energia_pie")),
    `<span class="energia-lineas"><span>☀ ${num(generacion, 1)} kW</span>
      <span class="${neto < 0 ? "ok" : ""}">${esc(t(neto < 0 ? "dest.vende" : "dest.compra"))} ${num(Math.abs(neto ?? 0), 1)} kW</span></span>`));
  partes.push(tarjeta(t("portada.tarifa"), en.periodo ? `${esc(en.periodo)} <span>${num(en.precio_eur_kwh, 2)} €/kWh</span>` : "–",
    esc(t("portada.tarifa_pie")),
    en.turno ? `<span>${esc(t("portada.coste_turno"))}: <strong>${num(en.turno.coste_eur, 2)} €</strong> · ${num(en.turno.importada_kwh, 1)} kWh</span>` : ""));
  poner($("#kpis", raiz), partes.join(""));
}

function pintarIncidencias(ctx) {
  const e = ctx.estado;
  const v = ctx.vista;
  const items = [];
  for (const a of e.averias) {
    items.push(`<li class="sev-error"><b>${esc(t("estado.AVERIA"))}</b> <a href="#/equipo/${esc(a.equipo)}">${esc(a.equipo)}</a>
      <span class="mono">${esc(a.codigo)}</span><span class="msg">${esc(a.descripcion)} · ${esc(t("portada.hasta"))} ${esc(a.fin_local)}</span></li>`);
  }
  for (const l of v.lineas) {
    if (l.estado === "MICROPARADA") {
      const resta = l.fin_estado ? l.fin_estado - v.t : null;
      items.push(`<li class="sev-aviso"><b>${esc(t("estado.MICROPARADA"))}</b> <a href="#/equipo/${esc(l.causa)}">${esc(l.causa)}</a>
        <span class="mono">${esc(l.codigo || "")}</span><span class="msg">${esc(l.motivo || "")}${resta !== null ? ` · ${esc(t("portada.quedan_sim", { s: duracion(resta) }))}` : ""}</span></li>`);
    }
  }
  if (v.incidencias.fuga_aire) items.push(`<li class="sev-aviso"><b>${esc(t("prob.fuga_aire"))}</b> <a href="#/equipo/compresor-01">compresor-01</a></li>`);
  for (const [id, d] of Object.entries(v.equipos)) {
    const g = d.avisos?.degradacion;
    if (g && g.factor >= 1.2) {
      items.push(`<li class="sev-aviso"><b>${esc(t("portada.averia_anunciada"))}</b> <a href="#/equipo/${esc(id)}">${esc(id)}</a>
        <span class="msg">${esc(t("prob.degradacion", { variable: g.variable, pct: num(100 * (g.factor - 1), 0), limite: num(100 * (g.limite - 1), 0) }))}</span></li>`);
    }
  }
  poner($("#portada-incidencias", raiz), items.length ? `<ul class="eventos">${items.join("")}</ul>`
    : `<p class="nota">${esc(t("portada.sin_incidencias"))}</p>`);
}

async function pedirAvisos() {
  if (!raiz) return;
  let r;
  try { r = await api("/api/recientes?n=200", undefined, { silencioso: true }); } catch { return; }
  if (!raiz) return;
  const ev = r.eventos.filter((e) => e.severidad !== "info" || ["averia_fin", "cambio_herramienta", "cambio_referencia"].includes(e.tipo_evento)).slice(0, 12);
  poner($("#portada-avisos", raiz), ev.length ? ev.map((e) => `
    <li class="sev-${esc(e.severidad)}"><span class="cuando">${esc(horaIso(e.ts))}</span>
      <a href="#/equipo/${esc(e.equipo)}">${esc(e.equipo)}</a> <span class="mono tipo-ev">${esc(e.tipo_evento)}</span>
      ${e.codigo ? `<span class="mono">${esc(e.codigo)}</span>` : ""}<span class="msg">${esc(e.mensaje)}</span></li>`).join("")
    : `<li class="nota">${esc(t("portada.sin_avisos"))}</li>`);
}

function actualizar(ctx) {
  if (!raiz) return;
  sinoptico?.actualizar(ctx);
  pintarKpis(ctx);
  pintarIncidencias(ctx);
  poner($("#portada-modo", raiz), ctx.vista.acelerar >= 30 ? esc(t("portada.modo_rapido", { x: ctx.vista.acelerar })) : "");
}

export default { montar, actualizar, desmontar, titulo: () => "nav.planta" };
