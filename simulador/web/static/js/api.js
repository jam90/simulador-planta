// Llamadas a la API del simulador y avisos al usuario
let temporizador = null;

/** Aviso breve al pie. enlace: {href, texto} opcional (entonces dura algo más, para que dé tiempo a pulsarlo). */
export function avisar(texto, tipo = "", enlace = null) {
  const a = document.getElementById("aviso");
  a.textContent = texto;
  if (enlace) {
    const e = document.createElement("a");
    e.href = enlace.href;
    e.textContent = enlace.texto;
    e.addEventListener("click", () => (a.style.display = "none"));
    a.append(" ", e);
  }
  a.className = tipo;
  a.style.display = "block";
  clearTimeout(temporizador);
  temporizador = setTimeout(() => (a.style.display = "none"), enlace ? 8000 : 4000);
}

/** GET si no hay cuerpo; POST con JSON si lo hay. Muestra el error y lo relanza. */
export async function api(ruta, cuerpo, { silencioso = false } = {}) {
  const opciones = cuerpo === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) };
  const r = await fetch(ruta, opciones);
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const error = new Error(typeof d.detail === "string" ? d.detail : `Error ${r.status}`);
    error.status = r.status;
    if (!silencioso) avisar(error.message, "error");
    throw error;
  }
  return r.json();
}
