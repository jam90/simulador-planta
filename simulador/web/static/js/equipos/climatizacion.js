// Climatización: unidad de tratamiento de aire junto al techo. El aire sale rojo al calentar,
// azul al enfriar y gris al ventilar; fuera de turno, apagada.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { clase, partes, piloto, zonaClic } from "./svg.js";

const W = 170, H = 80;

export default {
  caja: [W, H],
  icono() {
    return `<g class="clima">${zonaClic(W, H)}
      <rect class="m" x="0" y="0" width="118" height="56" rx="6"/>
      ${[30, 74].map((cx) => `<circle class="m2" cx="${cx}" cy="28" r="17"/>
        <g class="ventilador" data-p="v${cx}"><path class="os" d="M${cx} 28 l0 -12 a4 4 0 0 1 4 4z M${cx} 28 l12 0 a4 4 0 0 1 -4 4z M${cx} 28 l0 12 a4 4 0 0 1 -4 -4z M${cx} 28 l-12 0 a4 4 0 0 1 4 -4z"/></g>`).join("")}
      <rect class="m2" x="118" y="14" width="52" height="22"/>
      <rect class="os" x="140" y="36" width="22" height="6" rx="1"/>
      <g class="aire" data-p="aire"><path d="M144 46 v14 M151 46 v18 M158 46 v14"/></g>
      ${piloto(106, 10, 5)}
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const marcha = d.estado !== "APAGADO";
    clase(p.v30, "gira", marcha); clase(p.v74, "gira", marcha);
    clase(p.aire, "activas", marcha);
    for (const e of ["CALOR", "FRIO", "VENTILACION"]) clase(p.aire, e.toLowerCase(), d.estado === e);
  },
  clave: (d) => (d.valores.potencia_kw !== undefined ? `${num(d.valores.potencia_kw, 1)} kW` : ""),
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.consigna"), valor: num(v.consigna_c, 0), unidad: "°C" },
      { titulo: t("dest.potencia"), valor: num(v.potencia_kw, 2), unidad: "kW" },
    ];
  },
  tendencia: ["potencia_kw"],
};
