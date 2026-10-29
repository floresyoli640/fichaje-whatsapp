import Parse from "parse/node.js";
import { fechaLocal, esLaborable, obtenerJornadasPrevistas, esAdministrador, confirmarJornada, numeroNormalizado } from "./jornadas-admin.js";

// Fechas ISO separadas por comas, incluidas las fiestas nacionales, andaluzas y locales.
// Configurar FESTIVOS_UBEDA_2026 en Railway tras contrastar el calendario oficial.
function festivos(fecha = fechaLocal()) {
  const clave = "FESTIVOS_UBEDA_" + fecha.slice(0, 4);
  const valor = process.env[clave];
  if (!valor?.trim()) throw new Error("Falta configurar el calendario oficial " + clave);
  const fechas = valor.split(",").map(x => x.trim()).filter(Boolean);
  if (fechas.some(x => !/^\d{4}-\d{2}-\d{2}$/.test(x))) throw new Error("Formato inválido en " + clave);
  return new Set(fechas);
}
export function esDiaLaborableConfigurado(fecha = fechaLocal()) {
  return esLaborable(fecha, festivos(fecha));
}
async function empleadosActivos() {
  const q = new Parse.Query("Employees");
  q.equalTo("activo", true);
  q.notEqualTo("exentoFichaje", true);
  q.limit(1000);
  return q.find();
}
async function ausencias(fecha) {
  const q = new Parse.Query("AusenciasJornada");
  q.equalTo("fechaLaboral", fecha);
  q.limit(1000);
  return q.find();
}
function identificarEmpleado(empleados, nombre) {
  const coincidencias = empleados.filter(e => (e.get("nombre") || "").toLocaleLowerCase("es").trim() === nombre.toLocaleLowerCase("es").trim());
  if (coincidencias.length !== 1) throw new Error("Indica el nombre completo exacto de un único empleado.");
  return coincidencias[0];
}
async function marcarAusencia(fecha, empleado, administrador) {
  const q = new Parse.Query("AusenciasJornada");
  const clave = `${empleado.id}:${fecha}`;
  q.equalTo("clave", clave);
  let obj = await q.first();
  if (!obj) obj = new (Parse.Object.extend("AusenciasJornada"))();
  obj.set("clave", clave);
  obj.set("empleadoId", empleado.id);
  obj.set("nombre", empleado.get("nombre"));
  obj.set("fechaLaboral", fecha);
  obj.set("administrador", numeroNormalizado(administrador));
  obj.set("registradoEn", new Date());
  await obj.save();
}
function horaLocal(fecha) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fecha);
}
async function fichajesDelDia(empleado, fecha) {
  const numeros = [empleado.get("telefono"), empleado.get("waId")].filter(Boolean).map(numeroNormalizado);
  const alternativas = [...new Set(numeros.flatMap(n => [n, n.slice(-9), n.length === 9 ? `34${n}` : n]))];
  if (!alternativas.length) return {};
  const q = new Parse.Query("TimeEntries");
  q.containedIn("numero", alternativas);
  const d = new Date(fecha + "T00:00:00Z");
  q.greaterThanOrEqualTo("fecha", new Date(d.getTime() - 86400000));
  q.lessThan("fecha", new Date(d.getTime() + 172800000));
  q.ascending("fecha");
  q.limit(1000);
  const marcas = (await q.find()).filter(x => x.get("fecha") instanceof Date && fechaLocal(x.get("fecha")) === fecha);
  const entrada = marcas.find(x => x.get("accion") === "ENTRADA");
  const salida = [...marcas].reverse().find(x => x.get("accion") === "SALIDA");
  return { entrada: entrada?.get("fecha"), salida: salida?.get("fecha") };
}
async function resumen(fecha, empleados, faltas) {
  const ids = new Set(faltas.map(a => a.get("empleadoId")));
  const previstos = await obtenerJornadasPrevistas(fecha, empleados, festivos(fecha));
  const lineas = await Promise.all(previstos.map(async p => {
    if (ids.has(p.empleadoId)) return `• ${p.nombre}: AUSENTE`;
    const empleado = empleados.find(e => e.id === p.empleadoId);
    const marcas = await fichajesDelDia(empleado, fecha);
    return `• ${p.nombre}: ${marcas.entrada ? horaLocal(marcas.entrada) : "sin entrada"} / ${marcas.salida ? horaLocal(marcas.salida) : "sin salida"}`;
  }));
  return `📋 *Resumen ${fecha}*\nHorario previsto: 08:00–15:00\n\n${lineas.join("\n") || "No hay jornadas previstas"}\n\nComandos: AUSENTE Nombre Apellidos | CORREGIR Nombre Apellidos HH:MM HH:MM motivo | CONFIRMAR TODOS | RESUMEN\nCONFIRMAR TODOS valida jornadas con fichajes completos o correcciones documentadas; las demás quedan pendientes.`;
}
export async function procesarComandoAdmin({ texto, numero, responder }) {
  const comando = texto.trim();
  if (!/^(?:RESUMEN|AUSENTE\s+.+|CORREGIR\s+.+|CONFIRMAR TODOS)$/i.test(comando)) return false;
  if (!esAdministrador(numero)) {
    await responder("⛔ Comando reservado a administración.");
    return true;
  }
  try {
    const fecha = fechaLocal();
    const calendario = festivos(fecha);
    if (!esLaborable(fecha, calendario)) {
      await responder("Hoy no figura como día laborable. Comprueba el calendario de festivos configurado para este año.");
      return true;
    }
    const empleados = await empleadosActivos();
    if (/^AUSENTE\s+/i.test(comando)) {
      const empleado = identificarEmpleado(empleados, comando.replace(/^AUSENTE\s+/i, ""));
      await marcarAusencia(fecha, empleado, numero);
      await responder(`Ausencia registrada para ${empleado.get("nombre")} el ${fecha}.`);
      return true;
    }
    if (/^CORREGIR\s+/i.test(comando)) {
      const datos = comando.match(/^CORREGIR\s+(.+?)\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(.+)$/i);
      if (!datos) throw new Error("Formato: CORREGIR Nombre Apellidos HH:MM HH:MM motivo");
      const [, nombre, entrada, salida, motivo] = datos;
      if (![entrada, salida].every(h => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)) || salida <= entrada) throw new Error("Horas inválidas o salida anterior a entrada");
      const empleado = identificarEmpleado(empleados, nombre);
      const Correcciones = Parse.Object.extend("CorreccionesJornada");
      const registro = new Correcciones();
      registro.set("empleadoId", empleado.id);
      registro.set("nombre", empleado.get("nombre"));
      registro.set("fechaLaboral", fecha);
      registro.set("entradaCorregida", entrada);
      registro.set("salidaCorregida", salida);
      registro.set("motivo", motivo);
      registro.set("administrador", numeroNormalizado(numero));
      registro.set("registradoEn", new Date());
      await registro.save();
      await responder(`📝 Corrección registrada para ${empleado.get("nombre")}: ${entrada}–${salida}. Queda en el historial de auditoría; no modifica fichajes GPS.`);
      return true;
    }
    const faltas = await ausencias(fecha);
    if (/^RESUMEN$/i.test(comando)) {
      await responder(await resumen(fecha, empleados, faltas));
      return true;
    }
    const excluidos = new Set(faltas.map(a => a.get("empleadoId")));
    const presentes = empleados.filter(e => !excluidos.has(e.id));
    const correccionesQuery = new Parse.Query("CorreccionesJornada");
    correccionesQuery.equalTo("fechaLaboral", fecha);
    correccionesQuery.descending("registradoEn");
    correccionesQuery.limit(1000);
    const correcciones = await correccionesQuery.find();
    const ultimasCorrecciones = new Map();
    for (const c of correcciones) if (!ultimasCorrecciones.has(c.get("empleadoId"))) ultimasCorrecciones.set(c.get("empleadoId"), c);
    // Confirmación administrativa explícita, NO fichajes de dispositivo ni GPS.
    let guardados = 0;
    const pendientes = [];
    for (const e of presentes) {
      const marcas = await fichajesDelDia(e, fecha);
      const correccion = ultimasCorrecciones.get(e.id);
      if (!correccion && (!marcas.entrada || !marcas.salida || marcas.salida <= marcas.entrada)) {
        pendientes.push(e.get("nombre") || e.id);
        continue;
      }
      await confirmarJornada({
        empleadoId: e.id, fecha, administrador: numero,
        entradaReal: correccion ? correccion.get("entradaCorregida") : horaLocal(marcas.entrada),
        salidaReal: correccion ? correccion.get("salidaCorregida") : horaLocal(marcas.salida)
      });
      guardados++;
    }
    await responder(`✅ ${guardados} jornadas confirmadas con fichajes o correcciones documentadas. ${faltas.length} ausencias. ${pendientes.length} pendientes: ${pendientes.join(", ") || "ninguna"}. No se han creado fichajes en TimeEntries.`);
    return true;
  } catch (error) {
    await responder(`⚠️ No se completó la operación: ${error.message}`);
    return true;
  }
}
export async function enviarResumenDiario(sock) {
  if (!process.env.ADMIN_WHATSAPP) return;
  const fecha = fechaLocal();
  if (!esLaborable(fecha, festivos(fecha))) return;
  const empleados = await empleadosActivos();
  const faltas = await ausencias(fecha);
  const jid = `${numeroNormalizado(process.env.ADMIN_WHATSAPP)}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: await resumen(fecha, empleados, faltas) });
}
