// Preferencias de planificación, NO observaciones de presencia.
// Nunca se infiere la hora real a partir de la posición de un trabajador.
import { createHash } from "node:crypto";

export const PRIMERA_HABITUAL = "MARIA DE LA O ENRIQUETA CHICHARRO LOPEZ";
export const SEGUNDA_HABITUAL = "MARIA YOLANDA FLORES FRIAS";

export function normalizarNombre(nombre) {
  return String(nombre || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

function indiceAleatorioEstable(texto) {
  return createHash("sha256").update(texto).digest().readUInt32BE(0);
}

function nombreDe(empleado) {
  return normalizarNombre(empleado.get("nombre"));
}

// Orden de PRESENTACIÓN habitual: no cambia los datos de fichaje.
export function ordenarPorOrdenHabitual(empleados) {
  const prioridad = nombre =>
    nombre === PRIMERA_HABITUAL ? 0 :
    nombre === SEGUNDA_HABITUAL ? 1 : 2;
  return [...empleados].sort((a, b) =>
    prioridad(nombreDe(a)) - prioridad(nombreDe(b)) ||
    nombreDe(a).localeCompare(nombreDe(b), "es")
  );
}

// Orden ORIENTATIVO diario de horas programadas.
// María de la O va primero; Yolanda, segunda en ~80 % de los días (tercera el resto).
// Esto no constituye evidencia de cuál fue el orden real de llegada.
export function ordenPrevistoParaFecha(empleados, fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Fecha de planificación inválida");
  const primera = empleados.find(e => nombreDe(e) === PRIMERA_HABITUAL);
  const yolanda = empleados.find(e => nombreDe(e) === SEGUNDA_HABITUAL);
  const otros = empleados.filter(e => e !== primera && e !== yolanda)
    .sort((a, b) => {
      const ha = indiceAleatorioEstable(`${fecha}:orden:${a.id}`);
      const hb = indiceAleatorioEstable(`${fecha}:orden:${b.id}`);
      return ha - hb || String(a.id).localeCompare(String(b.id));
    });
  const salida = [];
  if (primera) salida.push(primera);
  const yolandaSegunda = indiceAleatorioEstable(fecha + ":yolanda-posicion") % 10 < 8;
  if (yolanda && (yolandaSegunda || !otros.length)) salida.push(yolanda);
  if (yolanda && !yolandaSegunda && otros.length) {
    salida.push(otros.shift(), yolanda);
  }
  salida.push(...otros);
  return salida;
}

export function desfasesProgramadosEntrada(empleados, fecha) {
  if (empleados.length > 11) throw new Error("No caben más de 11 minutos distintos en el margen ±5");
  const orden = ordenPrevistoParaFecha(empleados, fecha);
  const disponibles = Array.from({length: 11}, (_, i) => i - 5);
  const elegidos = disponibles.sort((a, b) => {
    const ha = indiceAleatorioEstable(`${fecha}:minuto:${a}`);
    const hb = indiceAleatorioEstable(`${fecha}:minuto:${b}`);
    return ha - hb || a - b;
  }).slice(0, orden.length).sort((a, b) => a - b);
  return new Map(orden.map((empleado, i) => [empleado.id, elegidos[i]]));
}
