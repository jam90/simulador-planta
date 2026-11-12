// Botón «Copiar» junto a un texto (un topic, una carpeta, un mensaje): copia al portapapeles y avisa.
import { avisar } from "../api.js";
import { t } from "../i18n.js";
import { esc } from "../util.js";

const ICONO = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
  <rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg>`;

/** HTML del botón que copia `texto`. */
export const botonCopiar = (texto) =>
  `<button type="button" class="copiar" data-copiar="${esc(texto)}" title="${esc(t("app.copiar"))}" aria-label="${esc(`${t("app.copiar")}: ${texto.slice(0, 80)}`)}">${ICONO}</button>`;

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sin permiso o página sin https */ }
  const a = document.createElement("textarea");
  a.value = texto;
  a.style.cssText = "position:fixed;opacity:0";
  document.body.append(a);
  a.select();
  let hecho = false;
  try { hecho = document.execCommand("copy"); } catch { /* no se puede */ }
  a.remove();
  return hecho;
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest?.("button[data-copiar]");
  if (!b) return;
  ev.preventDefault();
  if (await copiar(b.dataset.copiar)) avisar(t("app.copiado"), "ok");
});
