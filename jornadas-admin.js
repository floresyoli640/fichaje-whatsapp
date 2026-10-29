// Gestión de jornadas previstas y confirmación administrativa.
// Este módulo NO crea fichajes de entrada/salida ficticios.
import Parse from "parse/node.js";

export const ZONA = "Europe/Madrid";
export const HORARIO = Object.freeze({ entrada: "08:00", salida: "15:00" });

export function fechaLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}

export function esLaborable(fechaISO, festivos = new Set()) {
  const dia = new Date(`${fechaISO}T12:00:00Z`).getUTCDay();
  return dia >= 1 && dia <= 5 && !festivos.has(fechaISO);
}

export function numeroNormalizado(valor) {
  const n = String(valor || "").replace(/\D/g, "");
  return n.length === 9 ? `34${n}` : n;
}

export function esAdministrador(numero, adminConfigurado = process.env.ADMIN_WHATSAPP) {
  return Boolean(adminConfigurado) &&
    numeroNormalizado(numero) === numeroNormalizado(adminConfigurado);
}

export async function obtenerJornadasPrevistas(fechaISO, empleados, festivos = new Set()) {
  if (!esLaborable(fechaISO, festivos)) return [];
  return empleados.filter(e => e.get("activo") === true && e.get("exentoFichaje") !== true)
    .map(e => ({
      empleadoId: e.id,
      nombre: e.get("nombre") || "Sin nombre",
      fecha: fechaISO,
      entradaPrevista: HORARIO.entrada,
      salidaPrevista: HORARIO.salida,
      estado: "PENDIENTE_VALIDACION"
    }));
}

// Confirmación administrativa explícita: almacena una validación separada de TimeEntries.
// No afirma que los horarios previstos sean marcas de entrada o salida.
export async function confirmarJornada({ empleadoId, fecha, administrador, entradaReal, salidaReal }) {
  if (!empleadoId || !fecha || !administrador || !entradaReal || !salidaReal) {
    throw new Error("Se requieren empleado, fecha, administrador y horas reales verificadas");
  }
  const Confirmaciones = Parse.Object.extend("ConfirmacionesJornada");
  const query = new Parse.Query(Confirmaciones);
  query.equalTo("clave", `${empleadoId}:${fecha}`);
  let registro = await query.first();
  if (!registro) registro = new Confirmaciones();
  registro.set("clave", `${empleadoId}:${fecha}`);
  registro.set("empleadoId", empleadoId);
  registro.set("fechaLaboral", fecha);
  registro.set("entradaVerificada", entradaReal);
  registro.set("salidaVerificada", salidaReal);
  registro.set("administrador", numeroNormalizado(administrador));
  registro.set("origen", "confirmacion_administrativa");
  registro.set("validadoEn", new Date());
  await registro.save();
  return registro.id;
}
