// «Cómo leerlo»: de dónde sacar los datos de un equipo (MQTT para Node-RED y ficheros JSONL).
import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc } from "../util.js";

const desactivada = (x) => (x.activa ? "" : ` <small class="aviso-salida">(${esc(t("acceso.desactivada"))})</small>`);

export async function htmlAcceso(equipo) {
  let a;
  try { a = await api(`/api/acceso/${encodeURIComponent(equipo)}`, undefined, { silencioso: true }); }
  catch { return ""; }
  let h = "";
  if (a.mqtt) {
    h += `<h3>${esc(t("acceso.mqtt"))}${desactivada(a.mqtt)}</h3><ul class="lista-acceso">`;
    h += a.mqtt.servidores.map((s) => `<li>${esc(s.desde)}: ${esc(t("acceso.servidor"))} <code>${esc(s.servidor)}</code>,
      ${esc(t("acceso.puerto"))} <code>${s.puerto}</code></li>`).join("");
    h += a.mqtt.topics.map((x) => `<li>${esc(t(`canal.${x.clave}`))}: topic <code>${esc(x.topic)}</code></li>`).join("");
    h += `<li>${esc(t("acceso.todo"))}: <code>${esc(a.mqtt.todos)}</code></li>`;
    h += `<li>${t("acceso.output")}</li></ul>`;
  }
  if (a.ficheros) {
    h += `<h3>${esc(t("acceso.ficheros"))}${desactivada(a.ficheros)}</h3><ul class="lista-acceso">`;
    h += a.ficheros.carpetas.map((x) => `<li>${esc(t(`canal.${x.clave}`))}: <code>${esc(x.carpeta)}</code></li>`).join("");
    h += "</ul>";
  }
  return h || `<p class="nota">${esc(t("acceso.ninguna"))}</p>`;
}
