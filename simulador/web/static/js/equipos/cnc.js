// Centro de mecanizado CNC de doble palé: el robot deja la pieza en bruto en el palé de carga (a la
// izquierda, fuera de la zona de trabajo) mientras la máquina mecaniza la anterior en el otro palé.
// Al acabar el mecanizado se intercambian los palés. El husillo baja y gira durante el mecanizado
// real (mec_ini/mec_fin), con refrigerante. En el panel, el avance del ciclo, el desgaste de la
// herramienta y el nivel de refrigerante.
import { t } from "../i18n.js";
import { num } from "../util.js";
import { marcarEstado } from "./generico.js";
import { attr, clase, fase, faseRapida, partes, piloto, zonaClic } from "./svg.js";

const W = 230, H = 250;
const M = 50;                 // la máquina empieza aquí; a su izquierda, el palé de carga

export default {
  caja: [W, H],
  icono() {
    return `<g class="cnc">${zonaClic(W, H)}
      <rect class="m2" x="18" y="100" width="10" height="${H - 100}"/>
      <rect class="os" x="8" y="${H - 8}" width="30" height="8" rx="2"/>
      <rect class="pale" x="0" y="96" width="46" height="6" rx="2"/>
      <g transform="translate(${M} 0)">
      <rect class="m" x="0" y="0" width="180" height="${H}" rx="8"/>
      <rect class="m2" x="0" y="0" width="180" height="30" rx="8"/>
      <rect class="vidrio" x="14" y="44" width="104" height="112" rx="4"/>
      <g data-p="cabezal">
        <rect class="os" x="48" y="44" width="36" height="34" rx="3"/>
        <rect class="m" x="58" y="78" width="16" height="10"/>
        <g class="herramienta" data-p="herramienta"><rect class="acero" x="62" y="88" width="8" height="18" rx="1"/>
          <path class="estrias" d="M62 92 L70 89 M62 97 L70 94 M62 102 L70 99"/></g>
      </g>
      <g class="refrigerante" data-p="refrig"><path class="gota" d="M52 112 q2 5 0 8 q-2 -3 0 -8z"/>
        <path class="gota g2" d="M80 108 q2 5 0 8 q-2 -3 0 -8z"/></g>
      <rect class="pale" x="40" y="132" width="52" height="4" rx="1"/>
      <rect class="os" x="22" y="136" width="88" height="12" rx="2"/>
      <rect class="pieza pieza-int" x="56" y="120" width="20" height="12" rx="2"/>
      <rect class="m2" x="126" y="44" width="44" height="112" rx="4"/>
      <rect class="pantalla" x="131" y="50" width="34" height="26" rx="2"/>
      <rect class="barra-fondo" x="134" y="66" width="28" height="5" rx="1"/>
      <rect class="barra-ac" data-p="avance" x="134" y="66" width="0" height="5" rx="1"/>
      <text class="txt-mini" x="148" y="62" text-anchor="middle" data-p="rpm">0</text>
      <rect class="barra-fondo" x="134" y="86" width="6" height="60" rx="1"/>
      <rect class="barra-ac" data-p="desgaste" x="134" y="146" width="6" height="0" rx="1"/>
      <rect class="barra-fondo" x="148" y="86" width="6" height="60" rx="1"/>
      <rect class="barra-az" data-p="nivel" x="148" y="146" width="6" height="0" rx="1"/>
      <rect class="os" x="10" y="${H - 22}" width="160" height="14" rx="3"/>
      <rect class="m2" x="174" y="108" width="6" height="24" rx="1"/>
      ${piloto(160, 15, 6)}
      </g>
    </g>`;
  },
  actualizar(nodo, d) {
    marcarEstado(nodo, d.estado);
    const p = partes(nodo);
    const v = d.valores;
    const desgaste = Math.min(100, v.desgaste_herramienta_pct ?? 0), nivel = Math.min(100, v.nivel_refrigerante_pct ?? 0);
    attr(p.desgaste, "y", 146 - 0.6 * desgaste); attr(p.desgaste, "height", 0.6 * desgaste);
    attr(p.nivel, "y", 146 - 0.6 * nivel); attr(p.nivel, "height", 0.6 * nivel);
    clase(p.desgaste, "alerta", desgaste > 80);
  },
  animar(nodo, d, tm, rapido) {
    const p = partes(nodo);
    const f = rapido ? (d.produce ? faseRapida(1.8, 0.1) : null) : fase(d.ciclos, tm);
    const bajada = f === null ? 0 : Math.min(1, f / 0.1, (1 - f) / 0.1);
    attr(p.cabezal, "transform", `translate(0 ${(14 * bajada).toFixed(1)})`);
    clase(p.herramienta, "girando", f !== null);
    clase(p.refrig, "activas", f !== null && f > 0.1 && f < 0.9);
    attr(p.avance, "width", f === null ? 0 : 28 * f);
    const rpm = f === null ? "0" : String(Math.round(d.valores.rpm_husillo || 8000));
    if (p.rpm.textContent !== rpm) p.rpm.textContent = rpm;
  },
  clave: (d) => `${t("dest.desgaste")} ${num(d.valores.desgaste_herramienta_pct, 0)} %`,
  destacados(d) {
    const v = d.valores;
    return [
      { titulo: t("dest.rpm"), valor: num(v.rpm_husillo, 0), unidad: "rpm", pie: "rpm_husillo" },
      { titulo: t("dest.desgaste"), valor: num(v.desgaste_herramienta_pct, 1), unidad: "%",
        pie: v.herramienta_id, clase: v.desgaste_herramienta_pct > 80 ? "alerta" : "" },
      { titulo: t("dest.refrigerante"), valor: num(v.nivel_refrigerante_pct, 1), unidad: "%" },
      { titulo: t("dest.vibracion"), valor: num(v.vibracion_mm_s, 2), unidad: "mm/s" },
      { titulo: t("dest.temp_husillo"), valor: num(v.temp_husillo_c, 1), unidad: "°C" },
      { titulo: t("dest.potencia"), valor: num(v.potencia_kw, 2), unidad: "kW" },
    ];
  },
  tendencia: ["vibracion_mm_s", "temp_husillo_c"],
};
