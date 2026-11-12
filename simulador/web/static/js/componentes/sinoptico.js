// Sinóptico de la planta: la nave, sus zonas y todos los equipos, animados.
//
// La posición de cada equipo sale de static/plano.json; el dibujo, del módulo de su tipo
// (js/equipos/). Un equipo que no esté en el plano se coloca solo, en su zona. Todo lo que se mueve
// usa la hora dibujada (reloj.js), que va unos segundos por detrás de la simulación.
import { t } from "../i18n.js";
import { esc, insignia } from "../util.js";
import { modulo } from "../equipos/index.js";
import { DEFS, PRODUCE } from "../equipos/svg.js";
import * as reloj from "../reloj.js";
import { estadoEn } from "../reloj.js";
import { Cinta, htmlCinta, tramos } from "./cinta.js";
import { Celda } from "./celda.js";

export { estadoEn };

const RITMO = { PRODUCCION: 1, ARRANQUE: 0.5 };

/** Motivo del estado de la línea en tm ([t, estado, motivo] guardados por el observador). */
function motivoEn(serie, tm, porDefecto) {
  if (!serie?.length || tm === null) return porDefecto;
  let m = serie[0][2];
  for (const [t0, , mot] of serie) { if (t0 <= tm) m = mot; else break; }
  return m ?? porDefecto;
}

/** Coloca los equipos que no tienen posición en el plano, en fila al fondo de su zona. */
function autocolocar(plano) {
  const libres = {};
  for (const e of plano.equipos) {
    if (e.posicion) continue;
    const zona = plano.zonas?.find((z) => z.id === e.linea) || { x0: 40, x1: plano.lienzo[0] - 40 };
    libres[zona.id] = libres[zona.id] || { x: zona.x0 + 20, zona };
    const [w, h] = modulo(e.tipo).caja;
    const l = libres[zona.id];
    e.posicion = { x: l.x, y: plano.suelo - h, capa: "fondo", auto: true };
    l.x += w + 30;
  }
}

/** Dibujo de un equipo. Se pulsa con el ratón; para el teclado y los lectores, el enlace es su nombre. */
function htmlEquipo(e, pos, i = 0) {
  const mod = modulo(e.tipo);
  return `<a href="#/equipo/${esc(e.id)}" class="eq-enlace" tabindex="-1" aria-hidden="true">
    <g class="eq-sin tipo-${esc(e.tipo)}" data-id="${esc(e.id)}" data-copia="${i}" transform="translate(${pos.x} ${pos.y})">
      ${mod.icono(e)}</g></a>`;
}

/** Nombre y valor corto de un equipo: es el enlace que recibe el foco del teclado. */
function htmlEtiqueta(e) {
  const pos = e.posicion;
  const [w, h] = modulo(e.tipo).caja;
  const etiqueta = pos.etiqueta || [pos.x + w / 2, pos.y + h + 16];
  const ancla = pos.ancla || "middle";
  return `<a href="#/equipo/${esc(e.id)}" class="etiqueta-foco" data-foco="${esc(e.id)}" aria-label="${esc(`${e.id}: ${e.descripcion}`)}">
    <g class="etiqueta"><text class="nombre-eq" x="${etiqueta[0]}" y="${etiqueta[1]}" text-anchor="${ancla}">${esc(e.id)}</text>
      <text class="clave-eq" data-clave="${esc(e.id)}" x="${etiqueta[0]}" y="${etiqueta[1] + 15}" text-anchor="${ancla}"></text></g></a>`;
}

/** Orden de lectura (y del tabulador): por zonas y, dentro de cada una, de izquierda a derecha. */
function ordenLectura(plano) {
  const zona = (e) => { const k = (plano.zonas || []).findIndex((z) => z.id === e.linea); return k < 0 ? 99 : k; };
  return [...plano.equipos].sort((a, b) => zona(a) - zona(b) || a.posicion.x - b.posicion.x);
}

function htmlFondo(plano) {
  const [W] = plano.lienzo;
  const { x0, x1, techo } = plano.edificio;
  const s = plano.suelo;
  const dientes = [];
  for (let x = x0; x < x1; x += 120) dientes.push(`M${x} ${techo} L${x + 90} ${techo - 26} L${x + 90} ${techo} Z`);
  return `<g class="fondo">
    <rect class="exterior" x="0" y="0" width="${W}" height="${s}"/>
    <rect class="terreno" x="0" y="${s}" width="${W}" height="${plano.lienzo[1] - s}"/>
    <rect class="nave" x="${x0}" y="${techo}" width="${x1 - x0}" height="${s - techo}"/>
    ${(plano.zonas || []).map((z, i) => `<rect class="zona z${i % 2}" x="${z.x0}" y="${techo + 4}" width="${z.x1 - z.x0}" height="${s - techo - 4}"/>`).join("")}
    <path class="cubierta-dientes" d="${dientes.join(" ")}"/>
    <rect class="cubierta" x="${x0 - 6}" y="${techo - 6}" width="${x1 - x0 + 12}" height="10" rx="2"/>
    <rect class="muro" x="${x0 - 6}" y="${techo}" width="8" height="${s - techo}"/>
    <rect class="muro" x="${x1 - 2}" y="${techo}" width="8" height="${s - techo}"/>
    ${(plano.tabiques || []).map((tb) => `<rect class="muro" x="${tb.x - 3}" y="${tb.y}" width="6" height="${s - tb.y}"/>`).join("")}
    <line class="linea-suelo" x1="0" y1="${s}" x2="${W}" y2="${s}"/>
    ${(plano.zonas || []).map((z) => `<text class="titulo-zona" data-zona="${esc(z.id)}" x="${z.x0 + 14}" y="${techo + 26}"></text>`).join("")}
  </g>`;
}

export class Sinoptico {
  constructor(contenedor, plano) {
    this.plano = structuredClone(plano);
    const p = this.plano;
    p.lienzo = p.lienzo || [1600, 760];
    p.suelo = p.suelo || 700;
    p.edificio = p.edificio || { x0: 20, x1: p.lienzo[0] - 20, techo: 150 };
    for (const e of p.equipos) if (e.posicion) e.posicion = { ...e.posicion };
    autocolocar(p);
    const delante = p.equipos.filter((e) => e.posicion.capa === "frente");
    // Detrás de todo, las luminarias (su luz no debe tapar a nadie)
    const detras = p.equipos.filter((e) => e.posicion.capa !== "frente")
      .sort((a, b) => (b.tipo === "iluminacion") - (a.tipo === "iluminacion"));
    const copias = (e) => [e.posicion, ...(e.posicion.repetir || []).map(([x, y]) => ({ ...e.posicion, x, y }))]
      .map((pos, i) => htmlEquipo(e, pos, i)).join("");
    contenedor.innerHTML = `<svg class="sv sinoptico" viewBox="0 0 ${p.lienzo[0]} ${p.lienzo[1]}" role="group"
        aria-label="${esc(t("portada.sinoptico_aria"))}">${DEFS}
      ${htmlFondo(p)}
      ${(p.tuberias || []).map((tb) => {
        // Tubería de aire: el tubo, su interior y, por dentro, el aire que fluye
        const puntos = tb.puntos.map((q) => q.join(",")).join(" ");
        return `<g class="tuberia" data-tuberia="${esc(tb.equipo)}"><polyline class="tubo-ext" points="${puntos}"/>
          <polyline class="tubo-int" points="${puntos}"/><polyline class="tubo-flujo" points="${puntos}"/>
          ${tb.rotulo ? `<text class="rotulo-tuberia" x="${tb.rotulo[0]}" y="${tb.rotulo[1]}">${esc(t("portada.aire"))}</text>` : ""}</g>`;
      }).join("")}
      ${(p.cables || []).map((c) => `<polyline class="cable-red" points="${c.puntos.map((q) => q.join(",")).join(" ")}"/>`).join("")}
      ${detras.map(copias).join("")}
      ${(p.cintas || []).map((c) => htmlCinta(c, p.suelo)).join("")}
      ${delante.map(copias).join("")}
      ${(p.cintas || []).flatMap((c) => (c.pasos || []).map((q) => `<g class="paso" transform="translate(${q.x} ${q.y})">
        <circle r="11"/><text y="4" text-anchor="middle">${q.n}</text></g>`)).join("")}
      <g class="avisos-linea">${(p.cintas || []).map((c) => `<g class="aviso-linea" data-aviso-linea="${esc(c.linea)}"
          transform="translate(${(tramos(c)[0][0] + tramos(c).at(-1)[1]) / 2} ${c.y - 190})"></g>`).join("")}</g>
      <g class="etiquetas">${ordenLectura(p).map(htmlEtiqueta).join("")}</g>
      <g class="bocadillos" data-p="bocadillos"></g>
    </svg>`;
    this.svg = contenedor.querySelector("svg");
    // Foco del teclado en un nombre: se resalta su equipo
    const marcar = (ev, si) => {
      const id = ev.target.closest?.("[data-foco]")?.dataset.foco;
      if (id) for (const n of this.nodos[id] || []) n.classList.toggle("enfocado", si);
    };
    // Al pasar el ratón por un equipo: su estado y sus valores principales, sin entrar en la ficha
    this.pista = document.createElement("div");
    this.pista.className = "pista-equipo";
    this.pista.hidden = true;
    contenedor.after(this.pista);
    this.pistaId = null;
    this.svg.addEventListener("pointermove", (ev) => {
      const id = ev.pointerType === "mouse" ? ev.target.closest?.(".eq-sin")?.dataset.id : null;
      if (id !== this.pistaId) { this.pistaId = id || null; this._pintarPista(); }
      if (!id) return;
      const { offsetWidth: w, offsetHeight: h } = this.pista;
      const x = Math.min(ev.clientX + 16, window.innerWidth - w - 8);
      const y = ev.clientY + 18 + h > window.innerHeight ? ev.clientY - h - 12 : ev.clientY + 18;
      this.pista.style.left = `${Math.max(8, x)}px`;
      this.pista.style.top = `${Math.max(8, y)}px`;
    });
    this.svg.addEventListener("pointerleave", () => { this.pistaId = null; this._pintarPista(); });
    this.svg.addEventListener("focusin", (ev) => marcar(ev, true));
    this.svg.addEventListener("focusout", (ev) => marcar(ev, false));
    this.nodos = {};
    for (const g of this.svg.querySelectorAll(".eq-sin")) (this.nodos[g.dataset.id] ||= []).push(g);
    // Con «proceso» en el plano, cada pieza sigue el recorrido de la célula; si no, un flujo genérico
    this.cintas = (p.cintas || []).map((c) => {
      const nodo = this.svg.querySelector(`.cinta[data-linea="${CSS.escape(c.linea)}"]`);
      const conf = { ...c, suelo: p.suelo };
      return { linea: c.linea, cinta: c.proceso ? new Celda(nodo, conf) : new Cinta(nodo, conf) };
    });
    this.datos = {};
    this.vista = null;
    this.ultimoFotograma = null;
    this.claveBocadillos = "";
    this._bucle = this._bucle.bind(this);
    this.marco = requestAnimationFrame(this._bucle);
  }

  destruir() {
    cancelAnimationFrame(this.marco);
    this.marco = null;
    this.pista.remove();
  }

  /** Contenido del cuadro que acompaña al ratón (los mismos indicadores que encabezan la ficha). */
  _pintarPista() {
    const d = this.pistaId ? this.datos[this.pistaId] : null;
    this.pista.hidden = !d;
    if (!d) return;
    let dest = [];
    try { dest = (modulo(d.meta.tipo).destacados?.({ ...d, estado: d.estadoActual }, this.ctx) || []).slice(0, 4); } catch { /* sin valores todavía */ }
    const h = `<div class="pista-cab"><b>${esc(d.id)}</b>${insignia(d.estadoActual)}</div>
      <div class="pista-desc">${esc(d.meta.descripcion || "")}</div>
      ${dest.length ? `<dl>${dest.map((x) => `<dt>${esc(x.titulo)}</dt>
        <dd>${x.html ?? esc(x.valor ?? "")}${x.unidad ? ` <span>${esc(x.unidad)}</span>` : ""}</dd>`).join("")}</dl>` : ""}`;
    if (this.pista.innerHTML !== h) this.pista.innerHTML = h;
  }

  /** Datos nuevos del simulador (cada segundo). */
  actualizar(ctx) {
    const v = ctx.vista;
    this.vista = v;
    this.ctx = ctx;
    reloj.sincronizar(v);
    for (const z of this.svg.querySelectorAll("[data-zona]")) {
      const l = ctx.plano.lineas.find((x) => x.id === z.dataset.zona);
      const desc = ctx.plano.zonas_desc?.[z.dataset.zona] || l?.descripcion || "";
      const s = `${z.dataset.zona}${desc ? " · " + desc : ""}`;
      if (z.textContent !== s) z.textContent = s;
    }
    for (const e of ctx.plano.equipos) {
      const ve = v.equipos[e.id];
      if (!ve) continue;
      this.datos[e.id] = {
        id: e.id, meta: e, estadoActual: ve.estado, estado: ve.estado, valores: ve.valores || {},
        ciclos: ve.ciclos, avisos: ve.avisos, estados: ve.estados,
        linea: v.lineas.find((l) => l.id === e.linea), produce: false,
      };
    }
    // Valor corto bajo el nombre
    for (const el of this.svg.querySelectorAll("text.clave-eq[data-clave]")) {
      const d = this.datos[el.dataset.clave];
      const s = d ? modulo(d.meta.tipo).clave(d) || "" : "";
      if (el.textContent !== s) el.textContent = s;
    }
    // Aire: fluye si hay consumo
    for (const tb of this.svg.querySelectorAll("[data-tuberia]")) {
      const d = this.datos[tb.dataset.tuberia];
      const caudal = d?.valores.caudal_m3_min ?? 0;
      tb.classList.toggle("fluye", caudal > 0.05 && !reloj.enPausa());
      tb.style.setProperty("--dur", `${Math.max(0.6, 3 / Math.max(caudal, 0.3)).toFixed(2)}s`);
      tb.classList.toggle("con-fuga", !!d?.avisos?.fuga_aire);
    }
    this._pintarEstados(true);
    if (this.pistaId) this._pintarPista();
    for (const { linea, cinta } of this.cintas) {
      const k = ctx.kpis?.lineas?.[linea];
      cinta.rotular(k ? k.piezas_ok : null, k ? k.piezas_nok : null);
    }
  }

  /** Estado de cada equipo a la hora dibujada; repinta lo que cambie. */
  _pintarEstados(forzar = false) {
    const tm = reloj.ahoraSim();
    for (const d of Object.values(this.datos)) {
      const estado = estadoEn(d.estados, tm, d.estadoActual);
      const lineaEst = d.linea ? estadoEn(d.linea.estados, tm, d.linea.estado) : null;
      d.produce = d.linea ? PRODUCE.has(lineaEst) : false;
      if (!forzar && estado === d.estado) continue;
      d.estado = estado;
      const mod = modulo(d.meta.tipo);
      for (const nodo of this.nodos[d.id] || []) mod.actualizar(nodo, d);
    }
    this._pintarAvisos(tm);
  }

  /** Bocadillos de problema sobre los equipos y aviso grande sobre la línea parada. */
  _pintarAvisos(tm) {
    const v = this.vista;
    if (!v) return;
    const lista = [];
    for (const l of v.lineas) {
      const est = estadoEn(l.estados, tm, l.estado);
      if ((est === "AVERIA" || est === "MICROPARADA") && l.causa && l.estado === est) {
        lista.push({ id: l.causa, codigo: l.codigo, texto: l.motivo, nivel: est === "AVERIA" ? "error" : "aviso" });
      }
      this._avisoLinea(l, est, motivoEn(l.estados, tm, l.motivo));
    }
    for (const d of Object.values(this.datos)) {
      const p = modulo(d.meta.tipo).problema(d);
      if (p && !lista.some((x) => x.id === d.id)) lista.push({ id: d.id, ...p });
    }
    const clave = lista.map((b) => `${b.id}${b.codigo}${b.texto}${b.nivel}`).join("|");
    if (clave === this.claveBocadillos) return;
    this.claveBocadillos = clave;
    for (const [id, nodos] of Object.entries(this.nodos)) {
      const b = lista.find((x) => x.id === id);
      for (const n of nodos) {
        n.classList.toggle("con-problema", !!b);
        n.classList.toggle("aviso", b?.nivel === "aviso");
      }
    }
    const capa = this.svg.querySelector('[data-p="bocadillos"]');
    capa.innerHTML = lista.map((b) => {
      const nodo = this.nodos[b.id]?.[0];
      const e = this.plano.equipos.find((x) => x.id === b.id);
      if (!nodo || !e) return "";
      const [w] = modulo(e.tipo).caja;
      const [bx, by] = e.posicion.bocadillo || [e.posicion.x + w / 2, e.posicion.y - 14];
      const x = Math.min(this.plano.lienzo[0] - 170, Math.max(170, bx));
      const y = Math.max(40, by);
      const texto = (b.texto || "").length > 42 ? `${b.texto.slice(0, 41)}…` : b.texto || "";
      const linea1 = b.codigo ? `${b.codigo} · ${b.id}` : b.id;
      return `<g class="bocadillo ${b.nivel}" transform="translate(${x} ${y})">
        <rect x="-160" y="-46" width="320" height="40" rx="8"/><path d="M-8 -6 L0 6 L8 -6 Z"/>
        <text class="b1" x="0" y="-30" text-anchor="middle">${esc(linea1)}</text>
        <text class="b2" x="0" y="-14" text-anchor="middle">${esc(texto)}</text></g>`;
    }).join("");
  }

  _avisoLinea(l, est, motivo) {
    const g = this.svg.querySelector(`[data-aviso-linea="${CSS.escape(l.id)}"]`);
    if (!g) return;
    const mostrar = ["MANTENIMIENTO", "CAMBIO_FORMATO", "PARADA"].includes(est);
    const s = mostrar ? `${est}|${motivo}` : "";
    if (g.dataset.cartel === s) return;
    g.dataset.cartel = s;
    g.innerHTML = mostrar ? `<g class="cartel e-${esc(est)}">
      <rect x="-190" y="-26" width="380" height="52" rx="10"/>
      ${est === "MANTENIMIENTO" ? '<path class="icono-cartel" d="M-164 6 l14 -14 a8 8 0 0 1 10 -10 l-5 5 l3 3 l5 -5 a8 8 0 0 1 -10 10 l-14 14 z"/>'
        : est === "CAMBIO_FORMATO" ? '<path class="icono-cartel" d="M-170 -6 h22 l-6 -6 M-148 6 h-22 l6 6" fill="none"/>'
        : '<rect class="icono-cartel" x="-168" y="-10" width="7" height="20" rx="1"/><rect class="icono-cartel" x="-156" y="-10" width="7" height="20" rx="1"/>'}
      <text class="c1" x="-136" y="-3">${esc(t(`estado.${est}`))}</text>
      <text class="c2" x="-136" y="14">${esc(motivo || t("portada.fuera_turno"))}</text></g>` : "";
  }

  _bucle(ahora) {
    if (!this.marco) return;
    const dtReal = this.ultimoFotograma === null ? 0 : Math.min(0.25, (ahora - this.ultimoFotograma) / 1000);
    this.ultimoFotograma = ahora;
    const tm = reloj.avanzar(ahora);
    if (this.vista && tm !== null) {
      this._pintarEstados();
      const rapido = reloj.esRapido();
      const pausa = reloj.enPausa();
      const repres = {};
      for (const { linea, cinta } of this.cintas) {
        const l = this.vista.lineas.find((x) => x.id === linea);
        const est = estadoEn(l.estados, tm, l.estado);
        const corre = pausa ? 0 : RITMO[est] || 0;
        const r = cinta instanceof Celda ? cinta.animar(tm, l, this.vista, rapido, pausa ? 0 : dtReal, pausa)
          : cinta.animar(tm, corre, l.piezas, l.intervalo_pieza, rapido, pausa ? 0 : dtReal);
        for (const d of Object.values(this.datos)) {
          if (d.meta.linea === linea) { d.bajo = r.bajo; d.ultimo = r.ultimo; d.conPieza = r.conPieza; }
        }
        r.linea = linea;
        repres[linea] = r.ciclos ? r : null;
      }
      for (const d of Object.values(this.datos)) {
        const mod = modulo(d.meta.tipo);
        if (!mod.animar) continue;
        // En modo rápido, los equipos de la célula se mueven con los ciclos representativos
        const rep = repres[d.meta.linea];
        const ciclos = rep?.ciclos[d.id];
        for (const nodo of this.nodos[d.id] || []) {
          if (ciclos) mod.animar(nodo, { ...d, ciclos }, rep.tm, false);
          else mod.animar(nodo, d, tm, rapido && !pausa);
        }
      }
    }
    this.marco = requestAnimationFrame(this._bucle);
  }
}
