// Provocar incidencias en un equipo: avería y microparada (equipos de línea con códigos de avería),
// fuga de aire (compresor) y fallo del inversor (fotovoltaica).
import { api, avisar } from "../api.js";
import { refrescarYa } from "../bus.js";
import { t } from "../i18n.js";
import { $, esc } from "../util.js";

/** Qué incidencias admite un equipo, según /api/estado. */
export function incidenciasDe(eq) {
  const lista = [];
  if (eq.admite_incidencias) lista.push("averia", "microparada");
  if (eq.tipo === "compresor") lista.push("fuga_aire");
  if (eq.tipo === "fotovoltaica") lista.push("fallo_inversor");
  return lista;
}

const DURACION = { averia: 30, microparada: 2, fallo_inversor: 60 };   // minutos propuestos

/** HTML del bloque de incidencias (vacío si el equipo no admite ninguna). Cada una con su duración. */
export function htmlIncidencias(eq) {
  const lista = incidenciasDe(eq);
  if (!lista.length) return "";
  return `<div class="incidencias" data-equipo-inc="${esc(eq.id)}">
    <p class="nota">${esc(t("inc.ayuda"))}</p>
    ${lista.map((i) => `<div class="incidencia">
      <div class="accion-inc"><button data-inc="${i}" ${i === "fuga_aire" ? 'data-fuga="1"' : ""}>${esc(t(`inc.${i}`))}</button>
        ${DURACION[i] ? `<label class="duracion-inc">${esc(t("inc.duracion"))}
          <input type="number" class="inc-min" value="${DURACION[i]}" min="1" max="1440"> min</label>` : ""}</div>
      <p class="nota">${esc(t(`inc.${i}_ayuda`))}</p></div>`).join("")}
  </div>`;
}

/** Refleja el estado (p. ej., la fuga activa) sin repintar el bloque. */
export function actualizarIncidencias(raiz, estado) {
  const b = raiz && $("[data-fuga]", raiz);
  if (b) {
    const activa = estado.incidencias.fuga_aire;
    b.textContent = t(activa ? "inc.fin_fuga_aire" : "inc.fuga_aire");
    b.classList.toggle("primario", activa);
    b.dataset.activa = activa ? "1" : "";
  }
}

/** Gestiona los clics en los botones de incidencias dentro de raiz. */
export function escucharIncidencias(raiz) {
  raiz.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-inc]");
    if (!b) return;
    const bloque = b.closest("[data-equipo-inc]");
    const equipo = bloque.dataset.equipoInc;
    const minutos = Number($(".inc-min", b.closest(".incidencia"))?.value || DURACION[b.dataset.inc] || 30);
    let incidencia = b.dataset.inc;
    if (incidencia === "fuga_aire" && b.dataset.activa) incidencia = "fin_fuga_aire";
    const cuerpo = { incidencia, minutos };
    if (incidencia === "averia" || incidencia === "microparada") cuerpo.equipo = equipo;
    try {
      await api("/api/incidencias", cuerpo);
      avisar(t("inc.enviada", { incidencia: t(`inc.${incidencia}`), equipo }), "ok");
    } catch { return; }
    refrescarYa();
  });
}
