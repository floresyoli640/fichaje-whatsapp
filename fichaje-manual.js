// Fichaje voluntario desde WhatsApp: solo el mensaje ENTRADA/SALIDA.
// No solicita, procesa, guarda ni valida ubicación; también sirve para teletrabajo.
import Parse from "parse/node.js";
import { fechaLocal, numeroNormalizado } from "./jornadas-admin.js";

function numerosDe(empleado, numero) {
  return [...new Set([numero, empleado.get("telefono"), empleado.get("waId")]
    .map(numeroNormalizado).filter(n => n.length >= 9).map(n => n.slice(-9)))];
}

function mismoEmpleado(registro, empleado, numeros) {
  if (registro.get("empleadoId") === empleado.id) return true;
  const dni = empleado.get("dni");
  if (dni && registro.get("dni") === dni) return true;
  const telefono = numeroNormalizado(registro.get("numero"));
  return telefono.length >= 9 && numeros.includes(telefono.slice(-9));
}

function marcaManual(registro) {
  return registro.get("provisional") !== true &&
    !String(registro.get("origen") || "").startsWith("horario_programado");
}

export async function registrarFichajeWhatsApp({
  empleado, accion, numero, ahora = new Date(), cliente = Parse
}) {
  if (!empleado?.id || !["ENTRADA", "SALIDA"].includes(accion)) {
    throw new Error("Empleado o acción de fichaje inválidos");
  }
  const numeros = numerosDe(empleado, numero);
  if (!numeros.length) throw new Error("No se pudo verificar el número del empleado");

  const fecha = fechaLocal(ahora);
  const inicio = new Date(fecha + "T00:00:00Z").getTime();
  const consulta = new cliente.Query("TimeEntries");
  consulta.equalTo("accion", accion);
  consulta.greaterThanOrEqualTo("fecha", new Date(inicio - 86400000));
  consulta.lessThan("fecha", new Date(inicio + 172800000));
  consulta.limit(1000);
  const registros = await consulta.find();
  if (registros.length >= 1000) {
    throw new Error("Hay demasiados registros diarios: se necesita revisión antes de fichar");
  }

  const anterior = registros.find(r => {
    const fechaMarca = r.get("fecha");
    return fechaMarca instanceof Date && fechaLocal(fechaMarca) === fecha &&
      mismoEmpleado(r, empleado, numeros) && marcaManual(r);
  });
  if (anterior) {
    return { creada: false, fecha: anterior.get("fecha"), id: anterior.id || null };
  }

  const telefono = numeroNormalizado(empleado.get("telefono")) ||
    numeroNormalizado(empleado.get("waId")) || numeroNormalizado(numero);
  const registro = new (cliente.Object.extend("TimeEntries"))();
  registro.set("empleadoId", empleado.id);
  registro.set("nombre", empleado.get("nombre") || "Sin nombre");
  if (empleado.get("dni")) registro.set("dni", empleado.get("dni"));
  registro.set("numero", telefono);
  if (empleado.get("empresa")) registro.set("empresa", empleado.get("empresa"));
  registro.set("accion", accion);
  registro.set("fecha", ahora);
  registro.set("origen", "whatsapp_sin_ubicacion");
  registro.set("estado", "FICHAJE_DECLARADO_POR_WHATSAPP");
  registro.set("provisional", false);
  registro.set("pendienteVerificacion", false);
  registro.set("sinGPS", true);
  registro.set("registradoEn", new Date());
  registro.set("observacion",
    "Fichaje comunicado por el trabajador en WhatsApp, sin ubicación ni verificación de presencia física.");
  await registro.save();
  return { creada: true, fecha: ahora, id: registro.id || null };
}
