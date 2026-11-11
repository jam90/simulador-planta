// Cinta de una línea con sus piezas.
//
// Es una ilustración del flujo, no una medida: el simulador no da la posición de las piezas.
// Cada pieza aparece en la cinta a la hora a la que llegó de verdad (en el modo normal), avanza
// solo mientras la línea produce, toma el color de su resultado al pasar por la estación de
// calidad y termina en la caja de piezas buenas o en el contenedor de rechazo.
import { esc, num } from "../util.js";

const VUELTAS = 3.4;          // intervalos de pieza que tarda una pieza en recorrer la cinta
const ANCHO_PIEZA = 26;
const REAL_RAPIDO_S = 3.5;    // en modo rápido, segundos de reloj que tarda una pieza en recorrerla
const CAIDA_S = 0.45;

/** Tramos de la cinta: [[x0, x1], ...] (por defecto, uno de x0 a x1). */
export const tramos = (c) => c.tramos || [[c.x0, c.x1]];

export function htmlCinta(c, suelo) {
  const ts = tramos(c);
  const fin = ts[ts.length - 1][1];
  const id = `clip-cinta-${esc(c.linea)}`;
  const banda = ([a, b]) => {
    const patas = [];
    for (let x = a + 24; x < b - 10; x += 140) patas.push(x);
    return `${patas.map((x) => `<rect class="m2" x="${x}" y="${c.y + 12}" width="8" height="${suelo - c.y - 12}"/>`).join("")}
      <rect class="banda" x="${a}" y="${c.y}" width="${b - a}" height="12" rx="6"/>`;
  };
  const rodillos = ([a, b]) => `<circle class="rodillo" cx="${a + 6}" cy="${c.y + 6}" r="6"/>
    <circle class="rodillo" cx="${b - 6}" cy="${c.y + 6}" r="6"/>`;
  const x0 = ts[0][0];
  return `<g class="cinta" data-linea="${esc(c.linea)}">
    <rect class="rechazo" x="${c.rechazo - 24}" y="${suelo - 46}" width="48" height="46" rx="3"/>
    <text class="txt-mini cont-txt" data-p="nok" x="${c.rechazo}" y="${suelo - 18}" text-anchor="middle"></text>
    <rect class="caja-ok" x="${fin + 6}" y="${suelo - 50}" width="58" height="50" rx="3"/>
    <text class="txt-mini cont-txt" data-p="ok" x="${fin + 35}" y="${suelo - 20}" text-anchor="middle"></text>
    ${ts.map(banda).join("")}
    <clipPath id="${id}">${ts.map(([a, b]) => `<rect x="${a + 6}" y="${c.y}" width="${b - a - 12}" height="12"/>`).join("")}</clipPath>
    <g clip-path="url(#${id})"><g class="estrias-cinta" data-p="estrias">
      ${Array.from({ length: Math.ceil((fin - x0) / 20) + 2 }, (_, i) => `<path d="M${x0 + i * 20} ${c.y + 2} l-6 8"/>`).join("")}</g></g>
    ${ts.map(rodillos).join("")}
    <g data-p="piezas"></g>
  </g>`;
}

export class Cinta {
  constructor(nodo, conf) {
    this.c = conf;
    this.nodo = nodo;
    this.grupo = nodo.querySelector('[data-p="piezas"]');
    this.estrias = nodo.querySelector('[data-p="estrias"]');
    this.piezas = [];               // {clave, s, ok, caida, el}
    this.vistas = new Set();        // claves de piezas ya puestas en la cinta
    this.desplazamiento = 0;        // lo que ha avanzado la banda (para las estrías)
    this.ultimo = null;             // resultado de la última pieza que ha pasado por calidad
    this.tmPrevio = null;
    this.rapidoIdx = 0;
    this.rapidoProxima = 0;
  }

  get largo() { return this.c.x1 - this.c.x0 - ANCHO_PIEZA; }

  /** Cuenta de piezas buenas y malas del turno, rotuladas en los contenedores. */
  rotular(ok, nok) {
    const [a, b] = [this.nodo.querySelector('[data-p="ok"]'), this.nodo.querySelector('[data-p="nok"]')];
    const sa = ok === null ? "" : `OK ${num(ok, 0)}`, sb = nok === null ? "" : `NOK ${num(nok, 0)}`;
    if (a.textContent !== sa) a.textContent = sa;
    if (b.textContent !== sb) b.textContent = sb;
  }

  _nueva(clave, s, ok) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    el.setAttribute("class", "pieza");
    el.setAttribute("width", ANCHO_PIEZA);
    el.setAttribute("height", 12);
    el.setAttribute("rx", 2);
    this.grupo.append(el);
    this.piezas.push({ clave, s, ok, caida: null, el });
    this.vistas.add(clave);
  }

  /**
   * Un fotograma. tm: instante dibujado; corre: la línea produce a esa hora (y a qué ritmo);
   * piezas: [[t, ok], ...] recientes; intervalo: segundos entre piezas; rapido: modo rápido.
   */
  animar(tm, corre, piezas, intervalo, rapido, dtReal) {
    const dtSim = this.tmPrevio === null || tm === null ? 0 : Math.max(0, tm - this.tmPrevio);
    this.tmPrevio = tm;
    let avance;
    if (rapido) {
      avance = corre ? (this.largo / REAL_RAPIDO_S) * dtReal : 0;
      if (corre && piezas.length) {
        this.rapidoProxima -= dtReal;
        if (this.rapidoProxima <= 0) {
          this.rapidoProxima = REAL_RAPIDO_S / VUELTAS;
          const [, ok] = piezas[this.rapidoIdx++ % piezas.length];
          this._nueva(`r${performance.now()}`, 0, ok);
        }
      }
    } else {
      const v = this.largo / (VUELTAS * intervalo);          // px por segundo simulado
      avance = v * dtSim * corre;
      for (const [t, ok] of piezas) {
        const clave = String(t);
        if (tm !== null && t <= tm && !this.vistas.has(clave)) {
          const s = v * (tm - t);                             // al abrir la página, las ya empezadas
          if (s < this.largo) this._nueva(clave, s, ok);
          else this.vistas.add(clave);
        }
      }
      if (this.vistas.size > 400) this.vistas = new Set([...this.vistas].slice(-200));
    }
    this.desplazamiento = (this.desplazamiento + avance) % 20;
    this.estrias.setAttribute("transform", `translate(${this.desplazamiento.toFixed(1)} 0)`);

    const xCalidad = this.c.calidad - this.c.x0 - ANCHO_PIEZA / 2;
    const xRechazo = this.c.rechazo - this.c.x0 - ANCHO_PIEZA / 2;
    let bajo = null;
    for (const p of this.piezas) {
      if (p.caida === null) {
        const antes = p.s;
        p.s += avance;
        if (antes < xCalidad && p.s >= xCalidad) this.ultimo = p.ok;
        if (p.s >= xCalidad) p.el.classList.add(p.ok ? "ok" : "nok");
        if ((!p.ok && p.s >= xRechazo) || p.s >= this.largo) p.caida = 0;
        bajo = Math.min(bajo ?? 1, Math.abs(p.s - xCalidad) / 24);
      } else {
        p.caida += dtReal / CAIDA_S;
      }
      const x = this.c.x0 + Math.min(p.s, this.largo + (p.ok ? 18 : 0));
      const caida = p.caida === null ? 0 : Math.min(1, p.caida);
      const fondo = this.c.suelo - (p.ok ? 26 : 22);
      const y = this.c.y - 12 + (fondo - this.c.y + 12) * caida * caida;
      p.el.setAttribute("x", x.toFixed(1));
      p.el.setAttribute("y", y.toFixed(1));
    }
    // Las piezas que ya han caído desaparecen al cabo de un momento
    this.piezas = this.piezas.filter((p) => {
      if (p.caida !== null && p.caida > 3) { p.el.remove(); return false; }
      return true;
    });
    return { bajo, ultimo: this.ultimo };
  }
}
