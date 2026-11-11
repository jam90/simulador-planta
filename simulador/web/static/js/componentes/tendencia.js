// Evolución en vivo de varios campos de un equipo.
//
// Una gráfica pequeña por campo (cada uno con su escala: no se mezclan unidades en un mismo eje),
// apiladas y con el mismo eje de tiempo. Un cursor vertical, sincronizado en todas, muestra en un
// solo cuadro el valor de cada campo en ese instante. Hay también una vista en tabla.
// Los datos son los que la web ha visto desde que arrancó el simulador (/api/tendencia).
import { t } from "../i18n.js";
import { esc, hora, num, valor } from "../util.js";

const fijo = (v, d) => (typeof v === "number" ? num(v, d) : valor(v));

const ALTO = 92;                 // alto de cada gráfica (px)
const M = { izq: 52, der: 12, arr: 8, aba: 18 };
const NS = "http://www.w3.org/2000/svg";

/** Unidad de un campo a partir de su nombre (convención del simulador: sufijo con la unidad). */
export function unidad(campo) {
  const fin = [["_m3_min", "m³/min"], ["_w_m2", "W/m²"], ["_mm_s", "mm/s"], ["_m_min", "m/min"], ["_kvarh", "kvarh"],
    ["_kvar", "kvar"], ["_kva", "kVA"], ["_kwh", "kWh"], ["_kw", "kW"], ["_eur_kwh", "€/kWh"], ["_eur", "€"],
    ["_pct", "%"], ["_bar", "bar"], ["_hz", "Hz"], ["_c", "°C"], ["_a", "A"], ["_v", "V"], ["_s", "s"]];
  if (campo.startsWith("rpm")) return "rpm";
  const f = fin.find(([s]) => campo.endsWith(s));
  return f ? f[1] : "";
}

/** Marcas limpias del eje: 3 o 4 valores redondos que cubren [min, max]. */
function marcas(min, max) {
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const paso0 = (max - min) / 3;
  const pot = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p >= paso0) || 10 * pot;
  const a = Math.floor(min / paso) * paso, b = Math.ceil(max / paso) * paso;
  const lista = [];
  for (let v = a; v <= b + paso / 2; v += paso) lista.push(+v.toFixed(10));
  return { lista, a, b };
}

export class Tendencia {
  constructor(contenedor) {
    this.raiz = contenedor;
    this.datos = { t: [], series: {} };
    this.campos = [];
    this.tabla = false;
    contenedor.innerHTML = `<div class="tendencia-graficas"></div>
      <div class="tendencia-tooltip" role="status" hidden></div>
      <div class="tendencia-tabla tabla-desliza" hidden></div>`;
    this.graficas = contenedor.querySelector(".tendencia-graficas");
    this.tooltip = contenedor.querySelector(".tendencia-tooltip");
    this.tablaEl = contenedor.querySelector(".tendencia-tabla");
    this.graficas.addEventListener("pointermove", (e) => this._cursor(e));
    this.graficas.addEventListener("pointerleave", () => this._quitarCursor());
    this.observador = new ResizeObserver(() => this.pintar());
    this.observador.observe(contenedor);
  }

  destruir() { this.observador.disconnect(); }

  verTabla(si) {
    this.tabla = si;
    this.graficas.hidden = si;
    this.tablaEl.hidden = !si;
    this.pintar();
  }

  poner(datos, campos) {
    this.datos = datos;
    this.campos = campos;
    this.pintar();
  }

  pintar() {
    const { t: ts, series } = this.datos;
    if (this.tabla) return this._pintarTabla();
    const ancho = Math.max(240, this.graficas.clientWidth || 600);
    if (!ts.length) {
      this.graficas.innerHTML = `<p class="nota">${esc(t("ficha.tendencia_vacia"))}</p>`;
      return;
    }
    this.geo = { ancho, x0: M.izq, x1: ancho - M.der, t0: ts[0], t1: ts[ts.length - 1] };
    const x = (tt) => this.geo.x0 + (this.geo.x1 - this.geo.x0) * (this.geo.t1 > this.geo.t0 ? (tt - this.geo.t0) / (this.geo.t1 - this.geo.t0) : 1);
    this.graficas.innerHTML = this.campos.map((campo, i) => {
      const ys = (series[campo] || []).map((v) => (typeof v === "boolean" ? +v : v));
      const validos = ys.filter((v) => v !== null && v !== undefined);
      const ultimo = validos.length ? (series[campo].filter((v) => v !== null).at(-1)) : null;
      const cab = `<div class="tend-cab"><span class="mono">${esc(campo)}</span>
        <b>${esc(valor(ultimo))}</b> <span class="tenue">${esc(unidad(campo))}</span>
        <span class="tenue tend-hora">${esc(t("ficha.a_las", { h: hora(ts[ts.length - 1]) }))}</span></div>`;
      if (!validos.length) return `<div class="tend">${cab}<p class="nota">–</p></div>`;
      const { lista, a, b } = marcas(Math.min(...validos), Math.max(...validos));
      const y = (v) => M.arr + (ALTO - M.arr - M.aba) * (1 - (v - a) / (b - a || 1));
      const booleano = (series[campo] || []).some((v) => typeof v === "boolean");
      // Línea (escalonada si es un booleano), con huecos donde falta el dato
      let d = "", previo = null;
      ys.forEach((v, j) => {
        if (v === null || v === undefined) { previo = null; return; }
        const px = x(ts[j]).toFixed(1), py = y(v).toFixed(1);
        if (previo === null) d += `M${px} ${py}`;
        else d += booleano ? ` H${px} V${py}` : ` L${px} ${py}`;
        previo = v;
      });
      const ejeX = i === this.campos.length - 1
        ? [0, 0.5, 1].map((k) => {
          const tt = this.geo.t0 + k * (this.geo.t1 - this.geo.t0);
          const anc = k === 0 ? "start" : k === 1 ? "end" : "middle";
          return `<text class="eje" x="${x(tt).toFixed(1)}" y="${ALTO - 3}" text-anchor="${anc}">${esc(hora(tt, false))}</text>`;
        }).join("") : "";
      const etiquetas = booleano ? [[0, "false"], [1, "true"]] : lista.map((v) => [v, valor(v)]);
      return `<div class="tend">${cab}
        <svg class="tend-svg" width="${ancho}" height="${ALTO}" viewBox="0 0 ${ancho} ${ALTO}" role="img"
          aria-label="${esc(`${campo}: ${t("ficha.tendencia")}`)}">
          ${(booleano ? [0, 1] : lista).map((v) => `<line class="rejilla" x1="${M.izq}" x2="${ancho - M.der}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join("")}
          ${etiquetas.map(([v, s]) => `<text class="eje" x="${M.izq - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(s)}</text>`).join("")}
          <path class="serie" d="${d}"/>
          ${ejeX}
          <line class="cursor" x1="0" x2="0" y1="${M.arr}" y2="${ALTO - M.aba}" visibility="hidden"/>
          <circle class="punto" r="4" visibility="hidden"/>
        </svg></div>`;
    }).join("");
    this._escalas = this.campos.map((campo) => {
      const ys = (series[campo] || []).map((v) => (typeof v === "boolean" ? +v : v)).filter((v) => v !== null && v !== undefined);
      if (!ys.length) return null;
      const { a, b } = marcas(Math.min(...ys), Math.max(...ys));
      return (v) => M.arr + (ALTO - M.arr - M.aba) * (1 - (v - a) / (b - a || 1));
    });
    // El refresco rehace las gráficas: si el puntero seguía encima, se recoloca el cursor con los datos nuevos
    if (!this.tooltip.hidden && this.puntero) this._cursor(this.puntero);
  }

  _cursor(ev) {
    this.puntero = { clientX: ev.clientX, clientY: ev.clientY };
    const { t: ts, series } = this.datos;
    if (!ts.length || !this.geo) return;
    const svg = this.graficas.querySelector(".tend-svg");
    const caja = svg.getBoundingClientRect();
    const px = ev.clientX - caja.left;
    const k = Math.max(0, Math.min(1, (px - this.geo.x0) / (this.geo.x1 - this.geo.x0)));
    const objetivo = this.geo.t0 + k * (this.geo.t1 - this.geo.t0);
    let j = 0;
    for (let i = 0; i < ts.length; i++) if (Math.abs(ts[i] - objetivo) < Math.abs(ts[j] - objetivo)) j = i;
    const xj = this.geo.x0 + (this.geo.x1 - this.geo.x0) * (this.geo.t1 > this.geo.t0 ? (ts[j] - this.geo.t0) / (this.geo.t1 - this.geo.t0) : 1);
    this.graficas.querySelectorAll(".tend-svg").forEach((s, i) => {
      const c = s.querySelector(".cursor"), p = s.querySelector(".punto");
      c.setAttribute("x1", xj); c.setAttribute("x2", xj); c.setAttribute("visibility", "visible");
      const v = series[this.campos[i]]?.[j];
      if (v === null || v === undefined || !this._escalas[i]) { p.setAttribute("visibility", "hidden"); return; }
      p.setAttribute("cx", xj); p.setAttribute("cy", this._escalas[i](typeof v === "boolean" ? +v : v));
      p.setAttribute("visibility", "visible");
    });
    // Un solo cuadro con todos los campos: el valor delante, el nombre detrás
    this.tooltip.replaceChildren();
    const cab = document.createElement("div");
    cab.className = "tt-hora";
    cab.textContent = hora(ts[j]);
    this.tooltip.append(cab);
    for (const campo of this.campos) {
      const fila = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = `${valor(series[campo]?.[j])} ${unidad(campo)}`;
      const s = document.createElement("span");
      s.className = "mono";
      s.textContent = campo;
      fila.append(b, " ", s);
      this.tooltip.append(fila);
    }
    this.tooltip.hidden = false;
    const zona = this.raiz.getBoundingClientRect();
    const anchoT = this.tooltip.offsetWidth;
    const xCursor = caja.left - zona.left + xj;
    if (zona.width < 520) {
      // Pantalla estrecha: el cuadro va arriba, para no tapar las líneas
      this.tooltip.style.left = `${Math.max(0, Math.min(zona.width - anchoT, xCursor - anchoT / 2))}px`;
      this.tooltip.style.top = `${-this.tooltip.offsetHeight - 6}px`;
    } else {
      const derecha = xCursor + 14;
      const izq = derecha + anchoT <= zona.width ? derecha : Math.max(0, xCursor - anchoT - 14);
      this.tooltip.style.left = `${izq}px`;
      this.tooltip.style.top = `${Math.max(0, ev.clientY - zona.top - 20)}px`;
    }
  }

  _quitarCursor() {
    this.puntero = null;
    this.tooltip.hidden = true;
    this.graficas.querySelectorAll(".cursor, .punto").forEach((el) => el.setAttribute("visibility", "hidden"));
  }

  _pintarTabla() {
    const { t: ts, series } = this.datos;
    const filas = ts.map((tt, j) => ({ tt, j })).slice(-30).reverse();
    // Mismos decimales en toda la columna, para que las cifras queden alineadas
    const decimales = Object.fromEntries(this.campos.map((c) => [c, Math.min(3, Math.max(0, ...filas.map(({ j }) => {
      const v = series[c]?.[j];
      return typeof v === "number" && !Number.isInteger(v) ? (String(v).split(".")[1] || "").length : 0;
    })))]));
    this.tablaEl.innerHTML = `<table class="valores"><thead><tr><th>${esc(t("ficha.hora"))}</th>
      ${this.campos.map((c) => `<th class="num mono">${esc(c)}${unidad(c) ? ` (${esc(unidad(c))})` : ""}</th>`).join("")}</tr></thead>
      <tbody>${filas.map(({ tt, j }) => `<tr><td class="mono">${esc(hora(tt))}</td>
        ${this.campos.map((c) => `<td class="num mono">${esc(fijo(series[c]?.[j], decimales[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <p class="nota">${esc(t("ficha.tabla_ayuda"))}</p>`;
  }
}
