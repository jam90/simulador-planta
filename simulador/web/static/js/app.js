// Arranque de la interfaz: enrutado por #, refresco periódico, cabecera, tema e idioma.
import { api, avisar } from "./api.js";
import { alRefrescar } from "./bus.js";
import { cargarIdioma, idioma, t, traducir } from "./i18n.js";
import { $, $$, duracion, esc, fijarZona, insignia, nombreTurno, poner, texto } from "./util.js";
import portada from "./vistas/portada.js";
import equipo from "./vistas/equipo.js";
import energia from "./vistas/energia.js";
import produccion from "./vistas/produccion.js";
import configuracion from "./vistas/configuracion.js";

const VISTAS = { portada, equipo, energia, produccion, configuracion };

/** Lo último que ha llegado del simulador. Las vistas lo leen en actualizar(ctx). */
const ctx = { estado: null, vista: null, kpis: null, plano: null, recibido: 0 };

let actual = null;          // { nombre, modulo, params }

// --- Preferencias del usuario (solo en este navegador) -------------------------------
const guardado = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

function temaActual() {
  return document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function pintarBotonTema() {
  const oscuro = temaActual() === "dark";
  $("#tema").innerHTML = oscuro
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/></svg>';
}

// --- Enrutado ------------------------------------------------------------------------
function leerRuta() {
  const partes = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean).map(decodeURIComponent);
  const nombre = VISTAS[partes[0]] ? partes[0] : "portada";
  return { nombre, params: partes.slice(1) };
}

function navegar() {
  const { nombre, params } = leerRuta();
  if (actual?.modulo.desmontar) actual.modulo.desmontar();
  const el = $("#vista");
  el.innerHTML = "";
  actual = { nombre, modulo: VISTAS[nombre], params };
  actual.modulo.montar(el, ctx, params);
  traducir(el);
  for (const a of $$(".navegacion a")) {
    const activa = a.dataset.ruta === nombre || (nombre === "equipo" && a.dataset.ruta === "portada");
    if (activa) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.title = `${t(actual.modulo.titulo?.(params) ?? "app.titulo")} · ${t("app.titulo")}`;
  if (ctx.vista) actual.modulo.actualizar?.(ctx);
  window.scrollTo(0, 0);
}

/** Vuelve a montar la vista actual (al cambiar de idioma). */
function remontar() {
  traducir(document);
  navegar();
  pintarCabecera();
}

// --- Refresco ------------------------------------------------------------------------
let fallos = 0;

async function refrescar(que) {
  try {
    if (que.includes("vista")) {
      ctx.vista = await api("/api/vista", undefined, { silencioso: true });
      ctx.kpis = ctx.vista.kpis;          // los indicadores vienen con la vista: mismo instante
      ctx.recibido = performance.now();
    }
    if (que.includes("estado")) ctx.estado = await api("/api/estado", undefined, { silencioso: true });
    fallos = 0;
    $("#sin-conexion").hidden = true;
  } catch (e) {
    if (++fallos >= 3) $("#sin-conexion").hidden = false;
    return;
  }
  pintarCabecera();
  if (actual && ctx.vista && ctx.estado) actual.modulo.actualizar?.(ctx);
}

/** Pide ya los datos nuevos (tras pulsar un botón), sin esperar al siguiente ciclo. */
const refrescarYa = () => refrescar(["vista", "estado"]);
alRefrescar(refrescarYa);

// --- Cabecera y averías en curso -----------------------------------------------------
let finesReales = {};       // equipo -> instante (ms del navegador) en que se reparará solo

function pintarCabecera() {
  const v = ctx.vista, e = ctx.estado;
  if (!v || !e) return;
  texto($("#cab-hora"), v.hora_local || "–");
  $("#cab-pausa").hidden = !v.pausado;
  texto($("#cab-turno"), nombreTurno(v.turno));
  poner($("#cab-lineas"), v.lineas.map((l) =>
    `<div class="dato-cab"><small>${esc(l.id)} · ${esc(l.referencia)}</small><b>${insignia(l.estado)}</b></div>`).join(""));
  const sel = $("#acelerar");
  if (document.activeElement !== sel) {
    if (![...sel.options].some((o) => Number(o.value) === e.acelerar)) {
      sel.append(new Option(`×${e.acelerar}`, String(e.acelerar)));
    }
    sel.value = String(e.acelerar);
  }
  const p = $("#pausa");
  p.innerHTML = e.pausado
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>${esc(t("cab.reanudar"))}`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>${esc(t("cab.pausar"))}`;
  p.classList.toggle("primario", e.pausado);
  pintarAverias(e);
}

function pintarAverias(e) {
  finesReales = {};
  const contenido = e.averias.map((a) => {
    if (a.restante_real_s !== null) finesReales[a.equipo] = Date.now() + a.restante_real_s * 1000;
    return `<div class="averia-curso">
      <div class="texto">
        <b>${esc(t("averia.en_curso"))}</b>
        <a href="#/equipo/${esc(a.equipo)}">${esc(a.equipo)}</a> · <span class="mono">${esc(a.codigo)}</span> ${esc(a.descripcion)}<br>
        <small>${esc(t("averia.detalle", { inicio: a.inicio_local, fin: a.fin_local, acelerar: e.acelerar }))}</small>
      </div>
      <div><small>${esc(t("averia.quedan"))}</small><br>
        <span class="cuenta" data-fin="${esc(a.equipo)}">${a.restante_real_s === null ? esc(t("averia.en_pausa")) : duracion(a.restante_real_s)}</span></div>
      <button class="primario" data-reparar="${esc(a.equipo)}" title="${esc(t("averia.reparar_ayuda"))}">${esc(t("averia.reparar"))}</button>
    </div>`;
  }).join("");
  // Clave estable: solo se repinta si cambia la lista (la cuenta atrás va aparte)
  const clave = e.averias.map((a) => `${a.equipo}${a.codigo}${a.restante_real_s === null}`).join("|") + idioma();
  const banda = $("#banda-averias");
  if (banda.dataset.clave !== clave) { banda.innerHTML = contenido; banda.dataset.clave = clave; }
}

setInterval(() => {
  for (const el of $$("[data-fin]")) {
    const fin = finesReales[el.dataset.fin];
    if (fin !== undefined) texto(el, duracion((fin - Date.now()) / 1000));
  }
}, 1000);

// --- Acciones comunes ----------------------------------------------------------------
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.reparar) {
      await api("/api/incidencias", { incidencia: "reparar", equipo: b.dataset.reparar });
      avisar(t("averia.reparando", { equipo: b.dataset.reparar }), "ok");
    } else if (b.id === "pausa") {
      await api("/api/control", { pausado: !ctx.estado.pausado });
    } else if (b.id === "tema") {
      const nuevo = temaActual() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = nuevo;
      guardar("tema", nuevo);
      pintarBotonTema();
      actual?.modulo.tema?.();
      return;
    } else return;
  } catch { return; }
  refrescarYa();
});

$("#acelerar").addEventListener("change", async (ev) => {
  try { await api("/api/control", { acelerar: Number(ev.target.value) }); } catch { /* aviso mostrado */ }
  refrescarYa();
});

$("#idioma").addEventListener("change", async (ev) => {
  await cargarIdioma(ev.target.value);
  guardar("idioma", ev.target.value);
  remontar();
});

// --- Inicio --------------------------------------------------------------------------
async function iniciar() {
  const cod = guardado("idioma") || "es";
  await cargarIdioma(cod);
  $("#idioma").value = idioma();
  traducir(document);
  pintarBotonTema();
  try {
    ctx.plano = await api("/api/plano");
    fijarZona(ctx.plano.zona_horaria);
  } catch { ctx.plano = { equipos: [], lineas: [] }; }
  await refrescar(["vista", "estado"]);
  navegar();
  window.addEventListener("hashchange", navegar);
  let n = 0;
  setInterval(() => {
    n++;
    const que = ["vista"];
    if (n % 2 === 0) que.push("estado");
    refrescar(que);
  }, 1000);
}

iniciar();
