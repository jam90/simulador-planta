// Ayudas para dibujar y animar los equipos en SVG.
import { esc } from "../util.js";

/** Fase (0..1) del ciclo en curso en el instante tm, o null si el equipo no está en un ciclo. */
export function fase(ciclos, tm) {
  if (!ciclos || tm === null) return null;
  for (let i = ciclos.length - 1; i >= 0; i--) {
    const [ini, fin] = ciclos[i];
    if (tm >= ini && tm < fin) return (tm - ini) / (fin - ini);
    if (tm >= fin) return null;
  }
  return null;
}

/** Fase de un ciclo ficticio en tiempo real (modo rápido): bucle de `periodo` segundos. */
export const faseRapida = (periodo = 1.6, desfase = 0) => ((performance.now() / 1000 / periodo) + desfase) % 1;

const suave = (k) => k * k * (3 - 2 * k);

/** Interpola entre claves [[f, x, y], ...] ordenadas por f (0..1), con aceleración suave. */
export function interpolar(claves, f) {
  if (f <= claves[0][0]) return claves[0].slice(1);
  for (let i = 1; i < claves.length; i++) {
    const [f0, x0, y0] = claves[i - 1], [f1, x1, y1] = claves[i];
    if (f <= f1) {
      const k = f1 > f0 ? suave((f - f0) / (f1 - f0)) : 1;
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    }
  }
  return claves[claves.length - 1].slice(1);
}

/** Brazo de dos tramos (cinemática inversa, codo hacia arriba). Devuelve codo y punta. */
export function brazo(sx, sy, tx, ty, l1, l2) {
  const d = Math.min(Math.hypot(tx - sx, ty - sy), l1 + l2 - 0.01);
  const base = Math.atan2(ty - sy, tx - sx);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const codos = [1, -1].map((s) => [sx + l1 * Math.cos(base + s * a), sy + l1 * Math.sin(base + s * a)]);
  const [ex, ey] = codos[0][1] < codos[1][1] ? codos[0] : codos[1];
  return { ex, ey, px: sx + d * Math.cos(base), py: sy + d * Math.sin(base) };
}

/** Cambia un atributo solo si cambia (los navegadores lo agradecen a 60 fps). */
export function attr(el, nombre, valor) {
  if (!el) return;
  const v = typeof valor === "number" ? valor.toFixed(2) : String(valor);
  if (el.getAttribute(nombre) !== v) el.setAttribute(nombre, v);
}

export function clase(el, nombre, si) {
  if (el && el.classList.contains(nombre) !== !!si) el.classList.toggle(nombre, !!si);
}

export function texto(el, s) {
  if (el && el.textContent !== s) el.textContent = s;
}

/** Definiciones comunes (degradados) que usan los dibujos. Van una vez en cada SVG. */
export const DEFS = `<defs>
  <linearGradient id="grad-luz" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" style="stop-color: var(--s-luz); stop-opacity: 1"/><stop offset="1" style="stop-color: var(--s-luz); stop-opacity: 0"/>
  </linearGradient></defs>`;

/** Piloto de estado (círculo con el color del estado del equipo). */
export const piloto = (x, y, r = 5) => `<circle class="piloto" cx="${x}" cy="${y}" r="${r}"/>`;

/** Rectángulo transparente que marca la zona en la que se puede pulsar el equipo. */
export const zonaClic = (w, h) => `<rect class="zona-clic" x="-6" y="-6" width="${w + 12}" height="${h + 12}" rx="10"/>`;

/** Referencias a los elementos con data-p de un nodo, guardadas para no buscarlas en cada fotograma. */
const cache = new WeakMap();
export function partes(nodo) {
  let p = cache.get(nodo);
  if (!p) {
    p = {};
    for (const el of nodo.querySelectorAll("[data-p]")) p[el.dataset.p] = el;
    cache.set(nodo, p);
  }
  return p;
}

export const etiquetaSvg = (s) => esc(s);

/** Estados en los que un equipo de línea tiene tensión y se mueve. */
export const ACTIVOS = new Set(["ARRANQUE", "PRODUCCION", "MICROPARADA", "CAMBIO_FORMATO", "ESPERA"]);
export const PRODUCE = new Set(["PRODUCCION", "ARRANQUE"]);
