// Recorrido de las piezas por una célula con CNC de doble palé (la línea L1).
//
// El simulador trabaja por ciclos: cada vez que entra una pieza en la línea, cada estación hace su
// ciclo, en paralelo y sobre una pieza distinta, como en una línea real con tiempo de ciclo. Aquí se
// sigue a cada pieza física por las estaciones, y cada movimiento ocurre a la hora de un dato real:
//
//   ciclo k     entra en la línea (hora real de la pieza k); el robot de carga la coge de la cinta
//               (su pinza cierra al 15 % de su ciclo real) y la deja en el palé de carga (abre al 75 %)
//               mientras la CNC mecaniza la pieza anterior en el otro palé
//   fin de mecanizado: se cambian los palés; la pieza k entra en la máquina
//   ciclo k+1   la CNC la mecaniza (su ciclo real); al terminar, sale a la cinta de salida
//   ciclo k+2   el robot de soldadura la suelda (del 25 % al 82 % de su ciclo real)
//   ciclo k+3   la estación de calidad la mide; su resultado (OK/NOK) es el que registró la estación
//               en ese ciclo; después va a la caja de piezas buenas o al contenedor de rechazo
//
// Si el ciclo siguiente no llega (la línea está parada), cada pieza espera en su estación. Las
// piezas solo avanzan por la cinta mientras la línea produce.
//
// Modo rápido (velocidad alta): un ciclo real dura menos de un segundo y no se podría seguir. Se
// muestra el mismo recorrido con ciclos representativos de unos segundos (CICLO_RAPIDO_S), con
// el resultado OK/NOK de las piezas reales recientes. Solo avanza mientras la línea produce de verdad.
import { num } from "../util.js";
import { estadoEn } from "../reloj.js";

const RITMO = { PRODUCCION: 1, ARRANQUE: 0.5 };   // velocidad de la cinta (arranque: la mitad)
// Duraciones dibujadas, en fracción del intervalo entre piezas (con 45 s: 3 s, 4 s...)
const CAMBIO_PALE = 3 / 45, MEDIDA = 4 / 45, A_CAJA = 3 / 45, A_RECHAZO = 1.2 / 45, CAIDA = 0.6 / 45, QUEDA = 2.5 / 45;
const CICLO_RAPIDO_S = 2.6;      // segundos de reloj por pieza en el modo rápido
// Duración de cada ciclo representativo, en fracción del intervalo entre piezas (como los reales)
const CICLOS_REP = { carga: 0.93, cnc: 0.89, soldadura: 0.85 };
const ANCHO = 20, ALTO = 12;
const NS = "http://www.w3.org/2000/svg";

const suave = (k) => k * k * (3 - 2 * k);
const acotar = (x) => Math.max(0, Math.min(1, x));

export class Celda {
  constructor(nodo, conf) {
    this.c = conf;
    this.p = conf.proceso;
    this.eq = conf.equipos;
    this.nodo = nodo;
    this.grupo = nodo.querySelector('[data-p="piezas"]');
    this.estrias = nodo.querySelector('[data-p="estrias"]');
    this.els = new Map();          // clave de la pieza -> rect
    this.desplazamiento = 0;
    this.tmPrevio = null;
    this.yCinta = conf.y - ALTO;
  }

  rotular(ok, nok) {
    const [a, b] = [this.nodo.querySelector('[data-p="ok"]'), this.nodo.querySelector('[data-p="nok"]')];
    const sa = ok === null ? "" : `OK ${num(ok, 0)}`, sb = nok === null ? "" : `NOK ${num(nok, 0)}`;
    if (a.textContent !== sa) a.textContent = sa;
    if (b.textContent !== sb) b.textContent = sb;
  }

  /** Segundos de cinta en marcha hasta t (ponderados por su velocidad), según los estados de la línea. */
  _marcha(l, t) {
    const serie = l.estados;
    if (!serie?.length) return RITMO[l.estado] ? t : 0;
    let total = 0;
    for (let i = 0; i < serie.length; i++) {
      const [ti, ei] = serie[i];
      const tf = i + 1 < serie.length ? serie[i + 1][0] : Infinity;
      if (ti >= t) break;
      total += (Math.min(tf, t) - ti) * (RITMO[ei] || 0);
    }
    return total;
  }

  /** Ciclo (inicio, fin) de un equipo que empieza con la pieza que entró en t. */
  _ciclo(vista, id, t, intervalo) {
    const ciclos = vista.equipos[id]?.ciclos || [];
    return ciclos.find(([ini]) => ini >= t - 0.05 && ini < t + 0.9 * intervalo) || null;
  }

  /** Posición de la pieza k en el instante tm: {x, y, ok, oculta, midiendo, fin}. */
  _posicion(k, A, tm, l, vista) {
    const P = this.p, I = l.intervalo_pieza, y = this.yCinta;
    const CAMBIO_PALE_S = CAMBIO_PALE * I;
    const tk = A[k][0];
    if (tm < tk) return null;
    const avance = (desde, duracion) => duracion <= 0 ? 1
      : acotar((this._marcha(l, tm) - this._marcha(l, desde)) / duracion);
    const entre = (a, b, k2) => a + (b - a) * suave(acotar(k2));
    const viaje = (desde, hasta) => (Number.isFinite(hasta) ? Math.max(0.5, Math.min(0.3 * I, 0.85 * (hasta - desde))) : 0.3 * I);

    // 1. Entra por la cinta de entrada y espera al robot de carga
    const r = this._ciclo(vista, this.eq.carga, tk, I) || [tk, tk + 0.93 * I];
    const coge = r[0] + 0.15 * (r[1] - r[0]), deja = r[0] + 0.75 * (r[1] - r[0]);
    if (tm < coge) return { x: entre(P.entrada, P.recoge, avance(tk, Math.min(0.12 * I, coge - tk))), y };
    // 2. El robot la lleva (la dibuja el robot, en su pinza)
    if (tm < deja) return { oculta: true };
    // 3. En el palé de carga, hasta que la CNC termina de mecanizar la anterior
    const c = this._ciclo(vista, this.eq.cnc, tk, I);
    const entra = c ? Math.max(c[1], deja + 0.5) : tk + 0.97 * I;
    const [mx, my] = P.mecanizado;
    if (tm < entra) return { x: P.pale[0], y: P.pale[1] };
    if (tm < entra + CAMBIO_PALE_S) {
      const f = (tm - entra) / CAMBIO_PALE_S;
      return { x: entre(P.pale[0], mx, f), y: entre(P.pale[1], my, f) - 18 * Math.sin(Math.PI * f) };
    }
    // 4. Dentro de la máquina: la mecaniza en el ciclo siguiente
    const k1 = A[k + 1];
    const c1 = k1 && this._ciclo(vista, this.eq.cnc, k1[0], I);
    const sale = c1 ? c1[1] : k1 ? k1[0] + 0.97 * I : Infinity;
    if (tm < sale) return { x: mx, y: my };
    if (tm < sale + CAMBIO_PALE_S) {
      const f = (tm - sale) / CAMBIO_PALE_S;
      return { x: entre(mx, P.salida, f), y: entre(my, y, f) - 14 * Math.sin(Math.PI * f) };
    }
    // 5. Por la cinta de salida hasta el robot de soldadura, que la suelda en el ciclo siguiente
    const t0 = sale + CAMBIO_PALE_S;
    const k2 = A[k + 2];
    const s = k2 && this._ciclo(vista, this.eq.soldadura, k2[0], I);
    const sIni = s ? s[0] + 0.25 * (s[1] - s[0]) : k2 ? k2[0] + 0.25 * I : Infinity;
    const sFin = s ? s[0] + 0.82 * (s[1] - s[0]) : k2 ? k2[0] + 0.82 * I : Infinity;
    if (tm < sIni) return { x: entre(P.salida, P.soldadura, avance(t0, viaje(t0, sIni))), y };
    if (tm < sFin) return { x: P.soldadura, y };
    // 6. A la estación de calidad, que la mide en el ciclo siguiente
    const k3 = A[k + 3];
    const mide = k3 ? k3[0] : Infinity;
    if (tm < mide) return { x: entre(P.soldadura, P.calidad, avance(sFin, viaje(sFin, mide))), y };
    const ok = k3[1];
    const medida = tm - mide;
    if (medida < MEDIDA * I) return { x: P.calidad, y, ok: medida >= 0.4 * MEDIDA * I ? ok : null, midiendo: medida / (MEDIDA * I) };
    // 7. A su contenedor
    const tt = medida - MEDIDA * I;
    const destino = ok ? P.fin : P.rechazo;
    const ida = (ok ? A_CAJA : A_RECHAZO) * I;
    const caida = acotar((tt - ida) / (CAIDA * I));
    const suelo = this.c.suelo - (ok ? 26 : 22);
    return { x: entre(P.calidad, destino, tt / ida), y: y + (suelo - y) * caida * caida, ok,
      fin: tt > ida + QUEDA * I };
  }

  _rect(clave) {
    let el = this.els.get(clave);
    if (!el) {
      el = document.createElementNS(NS, "rect");
      el.setAttribute("class", "pieza");
      el.setAttribute("width", ANCHO);
      el.setAttribute("height", ALTO);
      el.setAttribute("rx", 2);
      this.grupo.append(el);
      this.els.set(clave, el);
    }
    return el;
  }

  _pintar(el, pos) {
    el.style.display = pos.oculta ? "none" : "";
    if (pos.oculta) return;
    el.setAttribute("x", pos.x.toFixed(1));
    el.setAttribute("y", pos.y.toFixed(1));
    el.classList.toggle("ok", pos.ok === true);
    el.classList.toggle("nok", pos.ok === false);
  }

  /**
   * Un fotograma. Devuelve {bajo, ultimo} para la estación de calidad y, en modo rápido, también
   * {tm, ciclos}: la hora y los ciclos representativos con los que deben moverse robots y CNC.
   */
  animar(tm, l, vista, rapido, dtReal, pausa) {
    const corre = pausa ? 0 : RITMO[estadoEn(l.estados, tm, l.estado)] || 0;
    const I = l.intervalo_pieza;
    let t = tm, linea = l, datos = vista, extra = {};
    if (rapido) {
      this.tv ??= 12 * I;
      this.tv += dtReal * (I / CICLO_RAPIDO_S) * corre;
      ({ linea, datos } = this._representativo(l, this.tv));
      t = this.tv;
      extra = { tm: t, ciclos: Object.fromEntries(Object.entries(this.eq).map(([papel, id]) => [id, datos.equipos[id]?.ciclos])) };
    }
    const dt = this.tmPrevio === null || t === null || t < this.tmPrevio ? 0 : t - this.tmPrevio;
    this.tmPrevio = t;
    const largo = this.c.tramos[0][1] - this.c.tramos[0][0];
    this.desplazamiento = (this.desplazamiento + (largo / (0.3 * I)) * dt * (rapido ? 1 : corre)) % 20;
    this.estrias.setAttribute("transform", `translate(${this.desplazamiento.toFixed(1)} 0)`);
    return { ...this._normal(t, linea, datos), ...extra };
  }

  /** Línea y ciclos representativos para el modo rápido: una pieza cada intervalo nominal. */
  _representativo(l, tv) {
    const I = l.intervalo_pieza;
    const reales = l.piezas.length ? l.piezas : [[0, true]];
    const k0 = Math.floor(tv / I);
    const piezas = [];
    for (let k = k0 - 10; k <= k0 + 3; k++) {
      const n = reales.length;
      piezas.push([k * I, reales[((k % n) + n) % n][1]]);
    }
    const equipos = {};
    for (const [papel, id] of Object.entries(this.eq)) {
      const f = CICLOS_REP[papel];
      if (f) equipos[id] = { ciclos: piezas.map(([t]) => [t, t + f * I]) };
    }
    return { linea: { ...l, piezas, estados: [[-1e9, "PRODUCCION"]], estado: "PRODUCCION" }, datos: { equipos } };
  }

  _normal(tm, l, vista) {
    const A = l.piezas;
    const vivas = new Set();
    let bajo = null, ultimo = null, ultimaMedida = -Infinity;
    for (let k = 0; k < A.length; k++) {
      if (A[k][0] < tm - 12 * l.intervalo_pieza) continue;
      const pos = this._posicion(k, A, tm, l, vista);
      if (!pos || pos.fin) continue;
      const clave = String(A[k][0]);
      vivas.add(clave);
      this._pintar(this._rect(clave), pos);
      if (pos.midiendo !== undefined) bajo = Math.min(bajo ?? 1, Math.abs(pos.midiendo - 0.5) * 2.5);
      if (pos.ok !== undefined && pos.ok !== null && A[k][0] > ultimaMedida) { ultimaMedida = A[k][0]; ultimo = pos.ok; }
    }
    for (const [clave, el] of this.els) if (!vivas.has(clave)) { el.remove(); this.els.delete(clave); }
    if (ultimo !== null) this.ultimo = ultimo;
    return { bajo, ultimo: this.ultimo ?? null };
  }
}
