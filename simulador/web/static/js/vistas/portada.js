// Portada provisional: equipos agrupados por zona, con su estado. La sustituye el sinóptico (fase 2).
import { esc, insignia, poner } from "../util.js";

let raiz = null;

function montar(el, ctx) {
  raiz = el;
  const zonas = [...new Set(ctx.plano.equipos.map((e) => e.linea))];
  el.innerHTML = `<div class="titulo-vista"><h1 data-i18n="portada.titulo"></h1></div>
    ${zonas.map((z) => `<section class="tarjeta" style="margin-bottom:14px"><header><h2>${esc(z)}</h2></header>
      <div class="rejilla">${ctx.plano.equipos.filter((e) => e.linea === z).map((e) => `
        <a class="tarjeta" href="#/equipo/${esc(e.id)}"><b>${esc(e.id)}</b> <span data-est="${esc(e.id)}"></span><br>
        <small>${esc(e.descripcion)}</small></a>`).join("")}</div></section>`).join("")}`;
}

function actualizar(ctx) {
  if (!raiz) return;
  for (const [id, v] of Object.entries(ctx.vista.equipos)) {
    poner(raiz.querySelector(`[data-est="${CSS.escape(id)}"]`), insignia(v.estado));
  }
}

export default { montar, actualizar, desmontar() { raiz = null; }, titulo: () => "nav.planta" };
