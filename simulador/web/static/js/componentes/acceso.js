// «Cómo leer sus datos»: de dónde sacar los datos de un equipo. Por MQTT (Node-RED, terminal o
// Python) y desde los ficheros JSONL (terminal o Logstash), con ejemplos listos para copiar.
import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc } from "../util.js";
import { botonCopiar } from "./copiar.js";

const copiable = (s) => `<code>${esc(s)}</code>${botonCopiar(String(s))}`;
const bloque = (s) => `<div class="codigo"><pre>${esc(s)}</pre>${botonCopiar(s)}</div>`;

const desactivada = (x) => (x.activa ? "" : ` <small class="aviso-salida">(${esc(t("acceso.desactivada"))})</small>`);

// Pestaña elegida en cada grupo; se recuerda entre fichas (y entre visitas, si el navegador deja)
const elegida = {};
const recordar = (grupo, valor) => {
  elegida[grupo] = valor;
  try { localStorage.setItem(`acceso.${grupo}`, valor); } catch { /* sin almacenamiento */ }
};
const recordada = (grupo) => {
  if (elegida[grupo]) return elegida[grupo];
  try { return localStorage.getItem(`acceso.${grupo}`); } catch { return null; }
};

/** Grupo de pestañas: [[clave, rótulo, html], ...]. */
function pestanas(grupo, lista) {
  const actual = lista.some(([c]) => c === recordada(grupo)) ? recordada(grupo) : lista[0][0];
  return `<div class="pestanas" data-pestanas="${grupo}"><div class="pestanas-botones" role="tablist">${
    lista.map(([c, rotulo]) => `<button type="button" role="tab" data-pestana="${c}" aria-selected="${c === actual}">${esc(rotulo)}</button>`).join("")
  }</div>${
    lista.map(([c, , html]) => `<div role="tabpanel" data-panel="${c}"${c === actual ? "" : " hidden"}>${html}</div>`).join("")
  }</div>`;
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest?.("[data-pestanas] [data-pestana]");
  if (!b) return;
  const caja = b.closest("[data-pestanas]");
  recordar(caja.dataset.pestanas, b.dataset.pestana);
  for (const x of caja.querySelectorAll(":scope > .pestanas-botones > [data-pestana]")) x.setAttribute("aria-selected", x === b);
  for (const x of caja.querySelectorAll(":scope > [data-panel]")) x.hidden = x.dataset.panel !== b.dataset.pestana;
});

const python = (m) => `import json
import paho.mqtt.client as mqtt

def on_message(client, userdata, message):
    print(message.topic, json.loads(message.payload))

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_message = on_message
client.connect("${m.local.servidor}", ${m.local.puerto})
client.subscribe("${m.todos}")
client.loop_forever()`;

const logstash = (ruta) => `input {
  file {
    path => "${ruta}*.jsonl"
    start_position => "beginning"
    codec => "json"
  }
}`;

function htmlMqtt(m) {
  const nodered = `<ul class="lista-acceso">${
    m.servidores.map((s) => `<li>${s.clave ? `${esc(t(`acceso.desde_${s.clave}`))}: ` : ""}${esc(t("acceso.servidor"))} ${copiable(s.servidor)},
      ${esc(t("acceso.puerto"))} ${copiable(s.puerto)}</li>`).join("")
  }<li>${t("acceso.output")}</li></ul>`;
  const local = `mosquitto_sub -h ${m.local.servidor} -p ${m.local.puerto} -v -t '${m.todos}'`;
  const terminal = (m.docker
    ? `<p>${esc(t("acceso.sub_docker"))}</p>${bloque(`docker compose exec mosquitto mosquitto_sub -v -t '${m.todos}'`)}` : "")
    + `<p>${esc(t("acceso.sub_local"))}</p>${bloque(local)}<p class="nota">${t("acceso.sub_nota")}</p>`;
  const py = `${bloque(python(m))}<p class="nota">${t("acceso.python_nota")}</p>`;
  return `<h3>${esc(t("acceso.mqtt"))}${desactivada(m)}</h3><ul class="lista-acceso">${
    m.topics.map((x) => `<li>${esc(t(`canal.${x.clave}`))}: topic ${copiable(x.topic)}</li>`).join("")
  }<li>${esc(t("acceso.todo"))}: ${copiable(m.todos)}</li></ul>${
    pestanas("mqtt", [["nodered", "Node-RED", nodered], ["terminal", t("acceso.terminal"), terminal], ["python", "Python", py]])}`;
}

function htmlFicheros(f) {
  const carpeta = f.carpetas[0]?.carpeta;
  let h = `<h3>${esc(t("acceso.ficheros"))}${desactivada(f)}</h3><ul class="lista-acceso">${
    f.carpetas.map((x) => `<li>${esc(t(`canal.${x.clave}`))}: ${copiable(x.carpeta)}</li>`).join("")}</ul>`;
  if (!carpeta) return h;
  // Logstash necesita la ruta completa: si no se conoce (en Docker), se pone una de ejemplo
  const completa = carpeta.startsWith("/") ? carpeta : `${f.base ?? t("acceso.ruta_ejemplo")}/${carpeta}`;
  h += pestanas("ficheros", [
    ["terminal", t("acceso.terminal"), `${bloque(`tail -f ${carpeta}*.jsonl`)}<p class="nota">${esc(t("acceso.tail_nota"))}</p>`],
    ["logstash", "Logstash", `${bloque(logstash(completa))}<p class="nota">${t("acceso.logstash_nota")}</p>`],
  ]);
  return h;
}

export async function htmlAcceso(equipo) {
  let a;
  try { a = await api(`/api/acceso/${encodeURIComponent(equipo)}`, undefined, { silencioso: true }); }
  catch { return ""; }
  const h = (a.mqtt ? htmlMqtt(a.mqtt) : "") + (a.ficheros ? htmlFicheros(a.ficheros) : "");
  return h || `<p class="nota">${esc(t("acceso.ninguna"))}</p>`;
}
