// Sensores de ambiente: temperatura y humedad de la nave y del exterior.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { partes, texto, zonaClic } from "./svg.js";

const W = 86, H = 84;

export default {
  caja: [W, H],
  icono() {
    return `<g class="ambiente">${zonaClic(W, H)}
      <rect class="m" x="0" y="0" width="86" height="66" rx="6"/>
      <rect class="pantalla" x="6" y="6" width="74" height="40" rx="3"/>
      <text class="txt-pant grande" x="43" y="24" text-anchor="middle" data-p="tn">–</text>
      <text class="txt-pant" x="43" y="39" text-anchor="middle" data-p="hn">–</text>
      <path class="m2" d="M38 66 h10 v12 a5 5 0 0 1 -10 0z"/>
      <text class="txt-mini estrecho" x="43" y="58" text-anchor="middle" data-p="te">–</text>
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const v = d.valores;
    texto(p.tn, v.temp_nave_c === undefined ? "–" : `${num(v.temp_nave_c, 1)} °C`);
    texto(p.hn, v.humedad_nave_pct === undefined ? "–" : `${num(v.humedad_nave_pct, 0)} % HR`);
    texto(p.te, v.temp_exterior_c === undefined ? "–" : `${t("dest.fuera")} ${num(v.temp_exterior_c, 1)} °C`);
  },
  clave: () => "",
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.temp_nave"), valor: num(v.temp_nave_c, 1), unidad: "°C" },
      { titulo: t("dest.humedad_nave"), valor: num(v.humedad_nave_pct, 0), unidad: "%" },
      { titulo: t("dest.temp_exterior"), valor: num(v.temp_exterior_c, 1), unidad: "°C" },
      { titulo: t("dest.humedad_exterior"), valor: num(v.humedad_exterior_pct, 0), unidad: "%" },
    ];
  },
  tendencia: ["temp_nave_c", "temp_exterior_c"],
};
