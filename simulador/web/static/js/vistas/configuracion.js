// Datos y salidas: qué equipos envían datos, qué salidas se usan, dato sucio y lo que se está enviando.
import { api, avisar } from "../api.js";
import { refrescarYa } from "../bus.js";
import { hay, idioma, t } from "../i18n.js";
import { $, $$, esc, insignia, num, poner } from "../util.js";
import { botonCopiar } from "../componentes/copiar.js";

const CANALES = ["telemetria", "eventos", "textos", "inspecciones", "ordenes"];
let raiz = null;
let congelado = false;
let temporizador = null;
let guardados = null;                // respuesta de /api/datos
let mensajes = [];                 // los últimos recibidos (JSON de cada uno, sin el canal)
const abiertos = new Set();        // los que se ven con formato

function montar(el) {
  raiz = el;
  el.innerHTML = `
    <div class="titulo-vista"><h1 data-i18n="conf.titulo"></h1><p data-i18n="conf.subtitulo"></p></div>
    <div class="rejilla rejilla-conf">
      <section class="tarjeta">
        <header><h2 data-i18n="conf.equipos"></h2>
          <button data-todos="1" data-i18n="conf.marcar_todos"></button>
          <button data-todos="0" data-i18n="conf.desmarcar_todos"></button></header>
        <p class="nota" data-i18n="conf.equipos_ayuda"></p>
        <div class="tabla-desliza"><table>
          <thead><tr><th data-i18n="conf.enviar"></th><th data-i18n="conf.equipo"></th>
            <th data-i18n="conf.tipo"></th><th data-i18n="conf.estado"></th></tr></thead>
          <tbody id="conf-equipos"></tbody></table></div>
      </section>
      <div class="columna">
        <section class="tarjeta">
          <header><h2 data-i18n="conf.salidas"></h2></header>
          <p class="nota" data-i18n="conf.salidas_ayuda"></p>
          <div id="conf-salidas" class="opciones"></div>
        </section>
        <section class="tarjeta">
          <header><h2 data-i18n="conf.dato_sucio"></h2></header>
          <label class="interruptor"><input type="checkbox" id="conf-sucio"><b data-i18n="conf.dato_sucio_activar"></b></label>
          <p class="nota" data-i18n="conf.dato_sucio_ayuda"></p>
        </section>
        <section class="tarjeta">
          <header><h2 data-i18n="conf.enviados"></h2></header>
          <p class="nota" data-i18n="conf.enviados_ayuda"></p>
          <div id="conf-contadores" class="contadores"></div>
        </section>
        <section class="tarjeta">
          <header><h2 data-i18n="conf.borrar_titulo"></h2></header>
          <p class="nota" id="conf-borrar-ayuda"></p>
          <p id="conf-borrar-cuanto"></p>
          <button class="peligro" id="conf-borrar" data-i18n="conf.borrar_boton" disabled></button>
          <dialog id="conf-borrar-dialogo" class="dialogo">
            <p id="conf-borrar-pregunta"></p>
            <div class="botones"><button value="no" data-i18n="conf.cancelar" autofocus></button>
              <button class="peligro" value="si" data-i18n="conf.borrar_si"></button></div>
          </dialog>
        </section>
      </div>
    </div>
    <section class="tarjeta" style="margin-top:14px">
      <header><h2 data-i18n="conf.mensajes"></h2>
        <select id="conf-canal"><option value="" data-i18n="conf.todos_canales"></option>
          ${CANALES.map((c) => `<option value="${c}" data-i18n="canal.${c}"></option>`).join("")}</select>
        <label class="interruptor"><input type="checkbox" id="conf-congelar"><span data-i18n="conf.congelar"></span></label></header>
      <p class="nota" data-i18n="conf.mensajes_ayuda"></p>
      <p class="nota" data-i18n="conf.mensaje_pista"></p>
      <div id="conf-mensajes" class="mensajes"></div>
    </section>`;
  el.addEventListener("change", alCambiar);
  el.addEventListener("click", alPulsar);
  congelado = false;
  mensajes = [];
  abiertos.clear();
  const lista = $("#conf-mensajes", el);
  const alternar = (ev) => {
    const m = ev.target.closest(".mensaje");
    if (!m || ev.target.closest("button") || String(getSelection())) return;
    if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    const json = mensajes[Number(m.dataset.i)]?.json;
    if (!json) return;
    if (abiertos.has(json)) abiertos.delete(json);
    else {
      // Al abrir uno se congela la lista: si no, los mensajes nuevos lo empujarían fuera en segundos
      abiertos.add(json);
      congelado = true;
      $("#conf-congelar", el).checked = true;
    }
    pintarMensajes();
  };
  lista.addEventListener("click", alternar);
  lista.addEventListener("keydown", alternar);
  pedirMensajes();
  pedirDatos();
  let n = 0;
  temporizador = setInterval(() => { pedirMensajes(); if (++n % 3 === 0) pedirDatos(); }, 2000);
  // Borrar los datos guardados: siempre con confirmación, y solo lo que ha escrito este simulador
  const dialogo = $("#conf-borrar-dialogo", el);
  $("#conf-borrar", el).addEventListener("click", () => {
    if (!guardados?.borrable) return;
    $("#conf-borrar-pregunta", el).textContent = t("conf.borrar_confirmar", { n: num(guardados.ficheros, 0), carpeta: guardados.carpeta });
    dialogo.showModal();
  });
  dialogo.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    dialogo.close();
    if (b.value !== "si") return;
    try {
      const r = await api("/api/datos/borrar", { confirmar: true });
      avisar(t("conf.borrar_hecho", { n: num(r.ficheros, 0) }), "ok");
    } catch { /* aviso mostrado */ }
    pedirDatos();
  });
}

function desmontar() {
  clearInterval(temporizador);
  raiz = null;
}

async function alCambiar(ev) {
  const x = ev.target;
  try {
    if (x.dataset.pub) await api(`/api/equipos/${x.dataset.pub}`, { publicar: x.checked });
    else if (x.dataset.salida) await api(`/api/salidas/${x.dataset.salida}`, { activa: x.checked });
    else if (x.id === "conf-sucio") await api("/api/dato_sucio", { activa: x.checked });
    else if (x.id === "conf-congelar") { congelado = x.checked; return; }
    else if (x.id === "conf-canal") { pedirMensajes(); return; }
    else return;
  } catch { /* aviso mostrado */ }
  refrescarYa();
}

async function alPulsar(ev) {
  const b = ev.target.closest("button[data-todos]");
  if (!b) return;
  const publicar = b.dataset.todos === "1";
  for (const id of $$("[data-pub]", raiz).map((x) => x.dataset.pub)) {
    try { await api(`/api/equipos/${id}`, { publicar }); } catch { break; }
  }
  refrescarYa();
}

/** Marca un interruptor sin pisar al usuario si lo está tocando. */
function marcar(input, valor) {
  if (input && document.activeElement !== input) input.checked = valor;
}

function actualizar(ctx) {
  if (!raiz) return;
  const e = ctx.estado;
  const tbody = $("#conf-equipos", raiz);
  const clave = e.equipos.map((q) => q.id).join(",") + idioma();
  if (tbody.dataset.clave !== clave) {
    tbody.dataset.clave = clave;
    tbody.innerHTML = e.equipos.map((q) => `
      <tr><td><label class="interruptor"><input type="checkbox" data-pub="${esc(q.id)}"
            aria-label="${esc(t("conf.enviar"))} ${esc(q.id)}"></label></td>
        <td><a href="#/equipo/${esc(q.id)}" title="${esc(q.descripcion)}"><b>${esc(q.id)}</b></a><br>
          <small>${esc(q.descripcion)}</small></td>
        <td><span class="mono">${esc(q.tipo)}</span></td><td data-estado="${esc(q.id)}"></td></tr>`).join("");
  }
  for (const q of e.equipos) {
    marcar($(`[data-pub="${CSS.escape(q.id)}"]`, tbody), q.publicar);
    poner($(`[data-estado="${CSS.escape(q.id)}"]`, tbody), insignia(q.estado));
  }

  const salidas = $("#conf-salidas", raiz);
  const claveS = e.salidas.map((s) => s.nombre).join(",") + idioma();
  if (salidas.dataset.clave !== claveS) {
    salidas.dataset.clave = claveS;
    salidas.innerHTML = e.salidas.map((s) => {
      // En español, la del simulador; en otro idioma, la traducción (si la hay) con sus rutas
      const clave = `salida.${s.nombre}${s.parametros.agrupar ? "_" + s.parametros.agrupar : ""}`;
      const desc = idioma() !== "es" && hay(clave) ? t(clave, s.parametros) : s.descripcion;
      return `<div class="opcion">
        <label class="interruptor"><input type="checkbox" data-salida="${esc(s.nombre)}"><b class="mono">${esc(s.nombre)}</b>
          ${s.solo_vivo ? `<small>(${esc(t("conf.solo_vivo"))})</small>` : ""}</label>
        <p class="nota">${esc(desc)}</p></div>`;
    }).join("");
  }
  for (const s of e.salidas) marcar($(`[data-salida="${CSS.escape(s.nombre)}"]`, salidas), s.activa);
  marcar($("#conf-sucio", raiz), e.dato_sucio);

  poner($("#conf-contadores", raiz), CANALES.map((c) => `
    <div class="contador"><b>${num(e.contadores[c] ?? 0, 0)}</b><small>${esc(t(`canal.${c}`))}</small></div>`).join(""));
}

const tamano = (b) => (b >= 1048576 ? `${num(b / 1048576, 1)} MB` : `${num(b / 1024, 0)} kB`);

/** Cuánto hay guardado en la carpeta de salida y si se puede borrar desde aquí. */
async function pedirDatos() {
  if (!raiz) return;
  try { guardados = await api("/api/datos", undefined, { silencioso: true }); } catch { return; }
  if (!raiz) return;
  const g = guardados;
  $("#conf-borrar-ayuda", raiz).textContent = !g.carpeta ? t("acceso.ninguna")
    : t(g.borrable ? "conf.borrar_ayuda" : "conf.borrar_protegida", { carpeta: g.carpeta });
  $("#conf-borrar-cuanto", raiz).textContent = g.carpeta ? t("conf.borrar_cuanto", { n: num(g.ficheros, 0), tam: tamano(g.bytes) }) : "";
  $("#conf-borrar", raiz).disabled = !g.borrable || !g.ficheros;
}

async function pedirMensajes() {
  if (!raiz || congelado) return;
  const canal = $("#conf-canal", raiz).value;
  const p = new URLSearchParams({ n: 60 });
  if (canal) p.set("canal", canal);
  try {
    const ms = await api(`/api/ultimos?${p}`, undefined, { silencioso: true });
    if (!raiz) return;
    mensajes = ms.map(({ canal, ...resto }) => ({ canal, resto, json: JSON.stringify(resto) }));
    for (const j of abiertos) if (!mensajes.some((m) => m.json === j)) abiertos.delete(j);
    pintarMensajes();
  } catch { /* se reintenta */ }
}

function pintarMensajes() {
  poner($("#conf-mensajes", raiz), mensajes.length ? mensajes.map((m, i) => {
    const abierto = abiertos.has(m.json);
    return `<div class="mensaje c-${esc(m.canal)}${abierto ? " abierto" : ""}" data-i="${i}" tabindex="0" role="button" aria-expanded="${abierto}">
      <span class="etiqueta-canal">${esc(t(`canal.${m.canal}`))}</span>${abierto
        ? `${botonCopiar(m.json)}<pre>${esc(JSON.stringify(m.resto, null, 2))}</pre>` : esc(m.json)}</div>`;
  }).join("") : `<p class="nota">${esc(t("conf.sin_mensajes"))}</p>`);
}

export default { montar, actualizar, desmontar, titulo: () => "nav.configuracion" };
