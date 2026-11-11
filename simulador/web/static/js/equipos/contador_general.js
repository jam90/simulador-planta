// Contador general en la acometida: compra (flecha hacia la planta) o vende (hacia la red),
// periodo tarifario y media cuartohoraria frente a la potencia contratada (en rojo si la supera).
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, clase, partes, piloto, texto, zonaClic } from "./svg.js";

const W = 130, H = 230;

export default {
  caja: [W, H],
  icono() {
    return `<g class="contador">${zonaClic(W, H)}
      <rect class="os" x="100" y="0" width="7" height="${H}"/>
      <rect class="os" x="82" y="16" width="44" height="5" rx="2"/>
      <circle class="m2" cx="86" cy="14" r="3"/><circle class="m2" cx="122" cy="14" r="3"/>
      <path class="cable" d="M86 16 C 70 60, 50 80, 40 110"/>
      <rect class="m" x="0" y="108" width="80" height="${H - 108}" rx="4"/>
      <rect class="pantalla" x="8" y="118" width="64" height="40" rx="2"/>
      <text class="txt-pant grande" x="40" y="134" text-anchor="middle" data-p="kw">–</text>
      <text class="txt-pant" x="40" y="150" text-anchor="middle" data-p="periodo">–</text>
      <g data-p="flecha" class="flecha"><path d="M40 166 v24 m-8 -8 l8 8 l8 -8"/></g>
      <rect class="barra-fondo" x="10" y="200" width="60" height="7" rx="2"/>
      <rect class="barra-ac" data-p="media" x="10" y="200" width="0" height="7" rx="2"/>
      ${piloto(72, 220, 4)}
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const v = d.valores;
    const neto = v.potencia_activa_kw ?? 0;
    texto(p.kw, v.potencia_activa_kw === undefined ? "–" : `${num(neto, 1)} kW`);
    texto(p.periodo, v.periodo_tarifario ? `${v.periodo_tarifario} · ${num(v.precio_eur_kwh, 2)} €` : "–");
    clase(p.flecha, "exporta", neto < 0);
    const k = v.potencia_contratada_kw ? (v.potencia_media_15min_kw ?? 0) / v.potencia_contratada_kw : 0;
    attr(p.media, "width", 60 * Math.min(1, k));
    clase(p.media, "mal", k > 1);
  },
  clave: (d) => (d.valores.potencia_activa_kw !== undefined
    ? t(d.valores.potencia_activa_kw < 0 ? "dest.vende" : "dest.compra") : ""),
  problema(d) {
    const v = d.valores;
    return v.potencia_media_15min_kw > v.potencia_contratada_kw
      ? { codigo: "W-600", texto: t("prob.exceso_potencia"), nivel: "aviso" } : null;
  },
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.potencia_red"), valor: num(v.potencia_activa_kw, 1), unidad: "kW",
        pie: t((v.potencia_activa_kw ?? 0) < 0 ? "dest.vende" : "dest.compra") },
      { titulo: t("dest.periodo"), valor: v.periodo_tarifario ?? "–", pie: `${num(v.precio_eur_kwh, 2)} €/kWh` },
      { titulo: t("dest.media_15"), valor: num(v.potencia_media_15min_kw, 1), unidad: "kW",
        pie: `${t("dest.contratada")} ${num(v.potencia_contratada_kw, 0)} kW`,
        clase: v.potencia_media_15min_kw > v.potencia_contratada_kw ? "mal" : "" },
      { titulo: t("dest.maximetro"), valor: num(v.maximetro_kw, 1), unidad: "kW" },
      { titulo: t("dest.coste"), valor: num(v.coste_acumulado_eur, 2), unidad: "€" },
    ];
  },
  tendencia: ["potencia_activa_kw", "potencia_media_15min_kw"],
};
