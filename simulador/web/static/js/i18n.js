// Textos de la interfaz en varios idiomas (static/i18n/<idioma>.json).
// Lo que son DATOS del simulador (estados literales, nombres de campos, descripciones
// de equipos, mensajes de los eventos) no se traduce: es lo que se encuentra en los ficheros.
export const IDIOMAS = { es: "es-ES", eu: "eu", en: "en-GB" };

let base = {};      // español: si falta una clave en otro idioma, se usa esta
let dic = {};
let actual = "es";

async function leer(cod) {
  const r = await fetch(`/static/i18n/${cod}.json`);
  return r.ok ? r.json() : {};
}

export async function cargarIdioma(cod) {
  if (!IDIOMAS[cod]) cod = "es";
  if (!Object.keys(base).length) base = await leer("es");
  dic = cod === "es" ? base : await leer(cod);
  actual = cod;
  document.documentElement.lang = cod;
}

export const idioma = () => actual;
export const locale = () => IDIOMAS[actual];

/** Texto traducido. {nombre} se sustituye por params.nombre. Sin traducción: la clave sin prefijo. */
export function t(clave, params) {
  let s = dic[clave] ?? base[clave];
  if (s === undefined) {
    const i = clave.indexOf(".");
    s = i >= 0 ? clave.slice(i + 1) : clave;
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ""));
  return s;
}

/** Existe una traducción para la clave (en el idioma actual o en español). */
export const hay = (clave) => clave in dic || clave in base;

/** Traduce los elementos con data-i18n (texto), data-i18n-html, data-i18n-title y data-i18n-aria. */
export function traducir(raiz = document) {
  for (const el of raiz.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of raiz.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of raiz.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of raiz.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}
