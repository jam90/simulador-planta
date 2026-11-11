// Un módulo por TIPO de equipo. Para añadir un tipo nuevo basta con crear su fichero y registrarlo aquí;
// si un tipo no tiene módulo, se usa el genérico (una caja con su estado y sus valores).
//
// Cada módulo puede exportar:
//   imagen(meta)              nombre de la ilustración en static/img/equipos/ (sin extensión)
//   caja                      [ancho, alto] del icono (origen arriba a la izquierda)
//   icono(meta)               SVG (cadena) del equipo en el sinóptico, dentro de su caja
//   dibujo(meta)              SVG (cadena) grande y animado para la ficha
//   actualizar(nodo, d, ctx)  aplica el estado al SVG ya pintado (icono o dibujo), sin regenerarlo (cada segundo)
//   animar(nodo, d, tm, rapido)  movimiento en cada fotograma; tm = instante simulado que se dibuja
//   clave(d)                  valor corto bajo el nombre en el sinóptico
//   problema(d)               {codigo, texto, nivel} si el equipo tiene un problema propio que mostrar
//   destacados(d, ctx)        [{titulo, valor | html, unidad, pie, clase}] indicadores grandes de la ficha
//   tendencia                 campos que se muestran por defecto en la gráfica de la ficha
//   montarFicha / actualizarFicha / desmontarFicha   extras propios de la ficha (opcionales)
// d = {id, meta, estado, valores, ciclos, avisos, linea, produce}
import generico from "./generico.js";
import ambiente from "./ambiente.js";
import analizador_red from "./analizador_red.js";
import climatizacion from "./climatizacion.js";
import cnc from "./cnc.js";
import compresor from "./compresor.js";
import contador_general from "./contador_general.js";
import fotovoltaica from "./fotovoltaica.js";
import iluminacion from "./iluminacion.js";
import inspeccion from "./inspeccion.js";
import mes from "./mes.js";
import plc_linea from "./plc_linea.js";
import robot from "./robot.js";

const TIPOS = {
  ambiente, analizador_red, climatizacion, cnc, compresor, contador_general,
  fotovoltaica, iluminacion, inspeccion, mes, plc_linea, robot,
};

export function registrar(tipo, mod) {
  TIPOS[tipo] = mod;
}

/** Módulo de un tipo, completado con el genérico en lo que no defina. */
export function modulo(tipo) {
  return { ...generico, ...(TIPOS[tipo] || {}) };
}
