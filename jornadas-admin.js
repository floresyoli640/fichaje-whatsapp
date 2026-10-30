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

// Datos de una confirmación: las horas previstas son referencias, NO fichajes reales.
export function prepararConfirmacion({ marcas = {}, correccion = null, horario = HORARIO }) {
  const entradaCorregida = correccion?.get("entradaCorregida");
  const salidaCorregida = correccion?.get("salidaCorregida");
  const convertirHora = fecha => new Intl.DateTimeFormat("es-ES", {
    timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(fecha);
  const entradaReal = marcas.entrada instanceof Date && !marcas.entradaAutomatica
    ? convertirHora(marcas.entrada) : null;
  const salidaReal = marcas.salida instanceof Date && !marcas.salidaAutomatica
    ? convertirHora(marcas.salida) : null;

  const entrada = entradaCorregida || entradaReal || horario.entrada;
  const salida = salidaCorregida || salidaReal || horario.salida;
  const fuenteEntrada = entradaCorregida ? "correccion_documentada" : entradaReal ? "fichaje_real" : "horario_previsto";
  const fuenteSalida = salidaCorregida ? "correccion_documentada" : salidaReal ? "fichaje_real" : "horario_previsto";
  const pendiente = fuenteEntrada === "horario_previsto" || fuenteSalida === "horario_previsto";
  return {
    entrada, salida, fuenteEntrada, fuenteSalida,
    estado: pendiente ? "CONFIRMADA_ADMIN_PENDIENTE_VERIFICACION" : "CONFIRMADA_ADMIN_CON_EVIDENCIA",
    pendiente
  };
}

// Guarda la confirmación de administración en una tabla separada de TimeEntries.
// Repetir el comando no crea registros duplicados ni sobrescribe las marcas GPS.
export async function confirmarJornada({
  empleadoId, fecha, administrador, entrada, salida, fuenteEntrada, fuenteSalida,
  canalConfirmacion = "whatsapp", cliente = Parse
}) {
  if (!empleadoId || !fecha || !administrador || !entrada || !salida ||
      !fuenteEntrada || !fuenteSalida) {
    throw new Error("Faltan datos para la confirmación administrativa");
  }
  const fuentesValidas = new Set(["fichaje_real", "correccion_documentada", "horario_previsto"]);
  if (!fuentesValidas.has(fuenteEntrada) || !fuentesValidas.has(fuenteSalida)) {
    throw new Error("Origen de horas no reconocido");
  }
  const confirmado = fuenteEntrada !== "horario_previsto" && fuenteSalida !== "horario_previsto";
  const estado = confirmado ? "CONFIRMADA_ADMIN_CON_EVIDENCIA" : "CONFIRMADA_ADMIN_PENDIENTE_VERIFICACION";
  const Confirmaciones = cliente.Object.extend("ConfirmacionesJornada");
  const query = new cliente.Query(Confirmaciones);
  const clave = `${empleadoId}:${fecha}`;
  query.equalTo("clave", clave);
  let registro = await query.first();
  const yaExistia = Boolean(registro);
  if (!registro) registro = new Confirmaciones();

  const campos = {
    clave, empleadoId, fechaLaboral: fecha,
    entradaReferencia: entrada, salidaReferencia: salida,
    fuenteEntrada, fuenteSalida, estado,
    administrador: numeroNormalizado(administrador),
    origen: "confirmacion_administrativa",
    canalConfirmacion
  };
  const sinCambios = yaExistia && Object.entries(campos).every(([k, v]) => registro.get(k) === v);
  if (sinCambios) return { id: registro.id, creada: false, actualizada: false, estado };

  for (const [claveCampo, valor] of Object.entries(campos)) registro.set(claveCampo, valor);
  // Compatibilidad: únicamente usar campos 'Verificada' si existen evidencias o corrección.
  if (confirmado) {
    registro.set("entradaVerificada", entrada);
    registro.set("salidaVerificada", salida);
    registro.set("validadoEn", new Date());
  } else {
    registro.unset("entradaVerificada");
    registro.unset("salidaVerificada");
    registro.unset("validadoEn");
  }
  if (!yaExistia) registro.set("confirmadoEn", new Date());
  registro.set("actualizadoEn", new Date());
  await registro.save();
  return { id: registro.id, creada: !yaExistia, actualizada: yaExistia, estado };
}
