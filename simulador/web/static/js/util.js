// Utilidades comunes de la interfaz
import { t, locale } from "./i18n.js";

export const $ = (s, raiz = document) => raiz.querySelector(s);
export const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Número con el formato del idioma; «–» si no hay dato. */
export function num(x, decimales = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(x);
}

export const pct = (x, decimales = 1) => (x === null || x === undefined ? "–" : `${num(100 * x, decimales)} %`);

/** Valor de telemetría tal cual, con formato legible (los nombres de campo no se traducen). */
export function valor(x) {
  if (x === null || x === undefined) return "–";
  if (typeof x === "boolean") return x ? "true" : "false";
  if (typeof x === "number") {
    const d = Number.isInteger(x) ? 0 : Math.abs(x) >= 100 ? 1 : Math.abs(x) >= 10 ? 2 : 3;
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: d, useGrouping: false }).format(x);
  }
  return String(x);
}

/** Segundos -> «mm:ss» o «h:mm:ss». */
export function duracion(s) {
  s = Math.max(0, Math.round(s));
  if (s >= 86400) return t("tiempo.mas_de_un_dia");
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  const dos = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${dos(m)}:${dos(seg)}` : `${dos(m)}:${dos(seg)}`;
}

/** Duración en palabras cortas: «3 h 20 min», «45 s». */
export function duracionCorta(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

let zona = "Europe/Madrid";          // la de la planta (la fija app.js al leer el plano)
export const fijarZona = (z) => { if (z) zona = z; };

/** Hora local de la planta de un instante epoch (s). */
export function hora(epoch, conSegundos = true) {
  if (!epoch) return "–";
  return new Date(epoch * 1000).toLocaleTimeString(locale(), {
    hour: "2-digit", minute: "2-digit", second: conSegundos ? "2-digit" : undefined, timeZone: zona });
}

export const horaIso = (iso, s = true) => hora(Date.parse(iso) / 1000, s);

/** Nombre traducido de un estado, con el valor literal del dato como pista. */
export function insignia(estado, { literal = false } = {}) {
  if (!estado) return "";
  const nombre = t(`estado.${estado}`);
  const pista = nombre === estado ? "" : ` title="${esc(estado)}"`;
  return `<span class="estado e-${esc(estado)}"${pista}>${esc(nombre)}${literal && nombre !== estado
    ? ` <span class="literal">${esc(estado)}</span>` : ""}</span>`;
}

export const nombreTurno = (turno) => (turno ? t(`turno.${turno}`) : t("turno.sin_turno"));

/** Crea un elemento a partir de HTML. */
export function html(texto) {
  const tpl = document.createElement("template");
  tpl.innerHTML = texto.trim();
  return tpl.content.firstElementChild;
}

/** Cambia el contenido solo si es distinto (evita parpadeos y no pierde la selección). */
export function poner(el, contenido) {
  if (el && el.innerHTML !== contenido) el.innerHTML = contenido;
}
export function texto(el, contenido) {
  if (el && el.textContent !== contenido) el.textContent = contenido;
}
