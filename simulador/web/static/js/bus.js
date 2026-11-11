// Enlace entre las vistas y el bucle de refresco de app.js (evita importaciones circulares)
let accion = () => {};
export const alRefrescar = (f) => { accion = f; };
/** Pide al simulador los datos nuevos ya, sin esperar al siguiente ciclo (tras pulsar un botón). */
export const refrescarYa = () => accion();
