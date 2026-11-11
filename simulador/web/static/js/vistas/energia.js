// Sección energia: se completa en la fase 4 del plan.
let raiz = null;

function montar(el) {
  raiz = el;
  el.innerHTML = `<div class="titulo-vista"><h1 data-i18n="nav.energia"></h1></div>
    <section class="tarjeta"><p class="nota" data-i18n="app.en_preparacion"></p></section>`;
}

export default { montar, actualizar() {}, desmontar() { raiz = null; }, titulo: () => "nav.energia" };
