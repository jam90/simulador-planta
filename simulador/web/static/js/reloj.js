// Reloj de la animación.
//
// El simulador avanza a pasos (5 s simulados) y lo que pasa dentro de un paso solo se sabe al
// terminarlo. Por eso la animación se dibuja un poco por detrás de la simulación: así todo lo que
// se ve ya ha ocurrido de verdad (un ciclo de robot, una pieza nueva) y no hay que adivinar.
// El reloj corre a la velocidad del simulador y se corrige con suavidad para mantener ese retraso.

let tm = null;              // instante simulado que se está dibujando (epoch, s)
let ultimo = null;          // performance.now() del último fotograma
let datos = { t: null, intervalo: 5, acelerar: 1, pausado: false };

const SONDEO_S = 1.0;       // cada cuánto se pide /api/vista (s de reloj)

/** Retraso deseado respecto al último instante simulado conocido, en segundos simulados. */
function retraso() {
  return (datos.intervalo || 5) + 1.3 * SONDEO_S * datos.acelerar;
}

/** Llamar al recibir /api/vista. */
export function sincronizar(vista) {
  datos = { t: vista.t, intervalo: vista.intervalo || 5, acelerar: vista.acelerar, pausado: vista.pausado };
  if (tm === null || datos.t === null) tm = datos.t === null ? null : datos.t - retraso();
}

/** Avanza el reloj al fotograma actual y devuelve el instante simulado que hay que dibujar. */
export function avanzar(ahora = performance.now()) {
  const dt = ultimo === null ? 0 : Math.min(0.5, (ahora - ultimo) / 1000);
  ultimo = ahora;
  if (tm === null || datos.t === null) return null;
  if (!datos.pausado) {
    const desfase = datos.t - tm - retraso();      // >0: vamos atrasados; <0: adelantados
    const escala = Math.max(retraso(), 1);
    const ritmo = Math.min(1.6, Math.max(0.4, 1 + desfase / escala));
    tm += dt * datos.acelerar * ritmo;
    if (Math.abs(desfase) > 6 * escala) tm = datos.t - retraso();     // salto grande: se recoloca
  }
  tm = Math.min(tm, datos.t);
  return tm;
}

export const ahoraSim = () => tm;
export const velocidad = () => datos.acelerar;
export const enPausa = () => datos.pausado;

/** Por encima de esta velocidad un ciclo dura menos de un segundo real: se anima en modo rápido. */
export const RAPIDO = 30;
export const esRapido = () => datos.acelerar >= RAPIDO;

/** Estado de una serie [[t, estado], ...] en el instante tm (el del último cambio anterior). */
export function estadoEn(serie, tm, porDefecto) {
  if (!serie?.length || tm === null) return porDefecto;
  let e = serie[0][1];
  for (const [t0, est] of serie) { if (t0 <= tm) e = est; else break; }
  return e;
}
