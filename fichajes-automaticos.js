// Crea marcajes de HORARIO TEÓRICO en TimeEntries, claramente sin verificación de presencia.
// Nunca afirma que un empleado estuviera físicamente presente ni inventa coordenadas GPS.
import Parse from "parse/node.js";
import { createHash } from "node:crypto";
import { fechaLocal, numeroNormalizado, HORARIO } from "./jornadas-admin.js";
import { esDiaLaborableConfigurado } from "./comandos-admin.js";

export const ORIGEN_AUTOMATICO = "horario_programado_sin_verificar";
export const VARIACION_MAXIMA_MINUTOS = 5;

// Variación pseudoaleatoria estable por persona, fecha y acción.
// En un reinicio, la hora asignada a esa persona no cambia.
export function variacionMinutos(empleadoId, fecha, accion) {
  if (!empleadoId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !["ENTRADA", "SALIDA"].includes(accion)) {
    throw new Error("Identidad, fecha o acción inválida para generar la variación");
  }
  const contenido = `${empleadoId}:${fecha}:${accion}`;
  const valor = createHash("sha256").update(contenido).digest().readUInt32BE(0);
  return valor % (2 * VARIACION_MAXIMA_MINUTOS + 1) - VARIACION_MAXIMA_MINUTOS;
}

export function esMarcajeAutomatico(registro) {
  return registro?.get("origen") === ORIGEN_AUTOMATICO;
}

export function fechaHoraMadrid(fecha, hora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
    throw new Error("Fecha u hora programada inválida");
  }
  const [ano, mes, dia] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  // El desfase se calcula en el día correspondiente (CET/CEST), no el del servidor Railway.
  const mediodia = new Date(Date.UTC(ano, mes - 1, dia, 12));
  const etiqueta = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid", timeZoneName: "shortOffset"
  }).formatToParts(mediodia).find(x => x.type === "timeZoneName")?.value || "";
  const desplazamiento = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(etiqueta);
  if (!desplazamiento) throw new Error("No se pudo obtener la zona horaria de Madrid: " + etiqueta);
  const minutos = (desplazamiento[1] === "+" ? 1 : -1) *
    (Number(desplazamiento[2]) * 60 + Number(desplazamiento[3] || 0));
  const resultado = new Date(Date.UTC(ano, mes - 1, dia, hh, mm) - minutos * 60000);
  if (fechaLocal(resultado) !== fecha) throw new Error("Conversión horaria fuera de fecha");
  return resultado;
}

function numerosDelEmpleado(empleado) {
  const numeros = [empleado.get("telefono"), empleado.get("waId")]
    .map(numeroNormalizado).filter(x => x.length >= 9);
  return [...new Set(numeros)];
}

function corresponde(registro, empleado, numeros) {
  if (registro.get("empleadoId") && registro.get("empleadoId") === empleado.id) return true;
  const n = numeroNormalizado(registro.get("numero"));
  return Boolean(n && numeros.some(x => n === x || (x.length >= 9 && n.length >= 9 && n.slice(-9) === x.slice(-9))));
}

export async function registrarFichajesAutomaticos({
  fecha = fechaLocal(), ahora = new Date(), cliente = Parse
} = {}) {
  const respuesta = {
    fecha, empleados: 0, entradasNuevas: 0, salidasNuevas: 0,
    marcasExistentes: 0, omitidosSinNumero: 0, ausentes: 0,
    causa: null
  };
  if (fechaLocal(ahora) !== fecha) { respuesta.causa = "fecha_distinta_de_hoy"; return respuesta; }
  if (!esDiaLaborableConfigurado(fecha)) { respuesta.causa = "dia_no_laborable"; return respuesta; }

  const pendientes = [
    { accion: "ENTRADA", horaBase: HORARIO.entrada, fechaBase: fechaHoraMadrid(fecha, HORARIO.entrada) },
    { accion: "SALIDA", horaBase: HORARIO.salida, fechaBase: fechaHoraMadrid(fecha, HORARIO.salida) }
  ].filter(m => ahora.getTime() >= m.fechaBase.getTime() - VARIACION_MAXIMA_MINUTOS * 60000);
  if (!pendientes.length) { respuesta.causa = "horario_todavia_no_iniciado"; return respuesta; }

  const qe = new cliente.Query("Employees");
  qe.equalTo("activo", true);
  qe.notEqualTo("exentoFichaje", true);
  qe.limit(1000);
  const empleados = await qe.find();
  respuesta.empleados = empleados.length;

  const qa = new cliente.Query("AusenciasJornada");
  qa.equalTo("fechaLaboral", fecha);
  qa.limit(1000);
  const ausencias = new Set((await qa.find()).map(a => a.get("empleadoId")));

  // Consultar también fichajes antiguos (sin empleadoId ni origen).
  const qt = new cliente.Query("TimeEntries");
  const t = Date.parse(fecha + "T00:00:00Z");
  qt.greaterThanOrEqualTo("fecha", new Date(t - 86400000));
  qt.lessThan("fecha", new Date(t + 172800000));
  qt.limit(1000);
  const existentes = (await qt.find()).filter(r =>
    r.get("fecha") instanceof Date && fechaLocal(r.get("fecha")) === fecha
  );

  for (const empleado of empleados) {
    if (ausencias.has(empleado.id)) { respuesta.ausentes++; continue; }
    const numeros = numerosDelEmpleado(empleado);
    if (!numeros.length) { respuesta.omitidosSinNumero++; continue; }
    for (const pendiente of pendientes) {
      const diferenciaMinutos = variacionMinutos(empleado.id, fecha, pendiente.accion);
      const fechaMarcaje = new Date(pendiente.fechaBase.getTime() + diferenciaMinutos * 60000);
      // La hora provisional se guarda cuando realmente llega su turno.
      if (ahora < fechaMarcaje) continue;
      const encontrado = existentes.some(r =>
        r.get("accion") === pendiente.accion && corresponde(r, empleado, numeros)
      );
      if (encontrado) { respuesta.marcasExistentes++; continue; }

      const registro = new (cliente.Object.extend("TimeEntries"))();
      registro.set("empleadoId", empleado.id);
      registro.set("nombre", empleado.get("nombre") || "Sin nombre");
      if (empleado.get("dni")) registro.set("dni", empleado.get("dni"));
      registro.set("numero", numeros[0]);
      if (empleado.get("empresa")) registro.set("empresa", empleado.get("empresa"));
      registro.set("accion", pendiente.accion);
      registro.set("fecha", fechaMarcaje);
      registro.set("horaProgramada", pendiente.horaBase);
      registro.set("variacionAleatoriaMinutos", diferenciaMinutos);
      registro.set("margenAleatorioMinutos", VARIACION_MAXIMA_MINUTOS);
      registro.set("horaReferenciaSinVerificar", true);
      registro.set("origen", ORIGEN_AUTOMATICO);
      registro.set("estado", "AUTOMATICO_PENDIENTE_VERIFICACION");
      registro.set("provisional", true);
      registro.set("pendienteVerificacion", true);
      registro.set("sinGPS", true);
      registro.set("fechaLaboral", fecha);
      registro.set("claveAutomatica", `${empleado.id}:${fecha}:${pendiente.accion}`);
      registro.set("registradoEn", new Date(ahora));
      registro.set("observacion", "Hora programada con variación aleatoria de hasta ±5 min: NO acredita presencia ni fichaje GPS.");
      await registro.save();
      existentes.push(registro);
      if (pendiente.accion === "ENTRADA") respuesta.entradasNuevas++;
      else respuesta.salidasNuevas++;
    }
  }
  console.log("🕒 FICHAJES AUTOMÁTICOS (SIN VERIFICAR):", JSON.stringify(respuesta));
  return respuesta;
}
