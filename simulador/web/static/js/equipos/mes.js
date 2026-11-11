// MES: terminal de planta con la orden de fabricación en curso y su avance.
// El avance lo calcula la web a partir del estado del MES: las órdenes solo se publican al cerrarse.
import { t } from "../i18n.js";
import { esc, num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, partes, texto, zonaClic } from "./svg.js";

const W = 70, H = 170;

export default {
  caja: [W, H],
  icono() {
    return `<g class="mes">${zonaClic(W, H)}
      <rect class="m" x="6" y="10" width="58" height="72" rx="5"/>
      <rect class="pantalla" x="11" y="15" width="48" height="60" rx="2"/>
      <text class="txt-pant" x="35" y="30" text-anchor="middle" data-p="ref">–</text>
      <rect class="barra-fondo" x="16" y="38" width="38" height="7" rx="2"/>
      <rect class="barra-ac" data-p="avance" x="16" y="38" width="0" height="7" rx="2"/>
      <text class="txt-pant" x="35" y="60" text-anchor="middle" data-p="pct">–</text>
      <rect class="os" x="31" y="82" width="8" height="${H - 92}"/>
      <rect class="os" x="14" y="${H - 10}" width="42" height="10" rx="2"/>
      <rect class="m2" x="42" y="96" width="14" height="22" rx="3"/>
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const o = d.linea?.orden;
    const k = o ? Math.min(1, (o.ok + o.nok) / o.cantidad) : 0;
    attr(p.avance, "width", 38 * k);
    texto(p.ref, o ? o.referencia.replace(/^REF-/, "") : "–");
    texto(p.pct, o ? `${Math.round(100 * k)} %` : "–");
  },
  clave: (d) => d.linea?.orden?.orden_id || "",
  destacados(d) {
    const o = d.linea?.orden;
    if (!o) return [{ titulo: t("dest.orden"), valor: "–" }];
    return [
      { titulo: t("dest.orden"), html: `<span class="mono">${esc(o.orden_id)}</span>`, pie: o.referencia },
      { titulo: t("dest.avance_orden"), valor: `${num(o.ok + o.nok, 0)} / ${num(o.cantidad, 0)}`,
        pie: t("dest.calculado_web") },
      { titulo: t("dest.piezas_ok"), valor: num(o.ok, 0) },
      { titulo: t("dest.piezas_nok"), valor: num(o.nok, 0) },
    ];
  },
};
