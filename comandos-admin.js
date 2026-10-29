import Parse from "parse/node.js";
import { fechaLocal, esLaborable, obtenerJornadasPrevistas, esAdministrador, confirmarJornada, HORARIO, numeroNormalizado } from "./jornadas-admin.js";

// Fechas ISO separadas por comas, incluidas las fiestas nacionales, andaluzas y locales.
// Configurar FESTIVOS_UBEDA_2026 en Railway tras contrastar el calendario oficial.
function festivos() {
  return new Set((process.env.FESTIVOS_UBEDA_2026 || "").split(",").map(x => x.trim()).filter(Boolean));
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
async function resumen(fecha, empleados, faltas) {
  const ids = new Set(faltas.map(a => a.get("empleadoId")));
  const previstos = await obtenerJornadasPrevistas(fecha, empleados, festivos());
  const lineas = previstos.map(p => `• ${p.nombre}: ${ids.has(p.empleadoId) ? "AUSENTE" : "Pendiente de confirmar"}`);
  return `📋 *Resumen ${fecha}*\nHorario previsto: 08:00–15:00\n\n${lineas.join("\n") || "No hay jornadas previstas"}\n\nComandos: AUSENTE Nombre Apellidos | CONFIRMAR TODOS | RESUMEN\nCONFIRMAR TODOS declara que has verificado la asistencia y el horario habitual de los presentes. Si hubo cambios de horario, no uses la confirmación en bloque hasta corregirlos.`;
}
export async function procesarComandoAdmin({ texto, numero, responder }) {
  const comando = texto.trim();
  if (!/^(RESUMEN|AUSENTE\s+|CONFIRMAR TODOS$)/i.test(comando)) return false;
  if (!esAdministrador(numero)) {
    await responder("⛔ Comando reservado a administración.");
    return true;
  }
  try {
    const fecha = fechaLocal();
    if (!esLaborable(fecha, festivos())) {
      await responder("Hoy no figura como día laborable. Comprueba que FESTIVOS_UBEDA_2026 contiene todos los festivos oficiales.");
      return true;
    }
    const empleados = await empleadosActivos();
    if (/^AUSENTE\s+/i.test(comando)) {
      const empleado = identificarEmpleado(empleados, comando.replace(/^AUSENTE\s+/i, ""));
      await marcarAusencia(fecha, empleado, numero);
      await responder(`Ausencia registrada para ${empleado.get("nombre")} el ${fecha}.`);
      return true;
    }
    const faltas = await ausencias(fecha);
    if (/^RESUMEN$/i.test(comando)) {
      await responder(await resumen(fecha, empleados, faltas));
      return true;
    }
    const excluidos = new Set(faltas.map(a => a.get("empleadoId")));
    const presentes = empleados.filter(e => !excluidos.has(e.id));
    // Confirmación administrativa explícita, NO fichajes de dispositivo ni GPS.
    let guardados = 0;
    for (const e of presentes) {
      await confirmarJornada({
        empleadoId: e.id, fecha, administrador: numero,
        entradaReal: HORARIO.entrada, salidaReal: HORARIO.salida
      });
      guardados++;
    }
    await responder(`✅ ${guardados} jornadas declaradas y confirmadas administrativamente (08:00–15:00). ${faltas.length} ausencias. No se han creado fichajes GPS ni marcas automáticas en TimeEntries.`);
    return true;
  } catch (error) {
    await responder(`⚠️ No se completó la operación: ${error.message}`);
    return true;
  }
}
export async function enviarResumenDiario(sock) {
  if (!process.env.ADMIN_WHATSAPP) return;
  const fecha = fechaLocal();
  if (!esLaborable(fecha, festivos())) return;
  const empleados = await empleadosActivos();
  const faltas = await ausencias(fecha);
  const jid = `${numeroNormalizado(process.env.ADMIN_WHATSAPP)}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: await resumen(fecha, empleados, faltas) });
}
