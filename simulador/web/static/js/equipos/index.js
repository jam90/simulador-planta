// Un módulo por TIPO de equipo. Para añadir un tipo nuevo basta con crear su fichero y registrarlo aquí;
// si un tipo no tiene módulo, se usa el genérico (una caja con su estado y sus valores).
//
// Cada módulo puede exportar:
//   imagen(meta)              nombre de la ilustración en static/img/equipos/ (sin extensión)
//   icono(meta)               SVG (cadena) del equipo en el sinóptico; caja de unos 120 x 90 con origen en (0, 0)
//   dibujo(meta)              SVG (cadena) grande y animado para la ficha
//   actualizar(nodo, d, ctx)  aplica el estado al SVG ya pintado (icono o dibujo), sin regenerarlo
//   destacados(d, ctx)        [{titulo, valor | html, unidad, pie, clase}] indicadores grandes de la ficha
//   tendencia                 campos que se muestran por defecto en la gráfica de la ficha
//   montarFicha / actualizarFicha / desmontarFicha   extras propios de la ficha (opcionales)
// d = {id, meta, estado, valores, ciclos, linea}
import generico from "./generico.js";

const TIPOS = {};

export function registrar(tipo, mod) {
  TIPOS[tipo] = mod;
}

/** Módulo de un tipo, completado con el genérico en lo que no defina. */
export function modulo(tipo) {
  return { ...generico, ...(TIPOS[tipo] || {}) };
}
