// Planificación automática de jornadas: NO crea fichajes ficticios en TimeEntries.
import Parse from "parse/node.js";
import { fechaLocal, obtenerJornadasPrevistas } from "./jornadas-admin.js";
import { esDiaLaborableConfigurado } from "./comandos-admin.js";

export function resumenPlanificacion(previstas, existentes) {
  const porClave = new Map(existentes.map(r => [r.get("clave"), r]));
  return previstas.map(p => ({
    ...p,
    clave: `${p.empleadoId}:${p.fecha}`,
    existente: porClave.get(`${p.empleadoId}:${p.fecha}`) || null
  }));
}

export async function registrarJornadasPrevistas(fecha = fechaLocal(), cliente = Parse) {
  // Fallar de manera segura cuando falte el calendario de festivos.
  if (!esDiaLaborableConfigurado(fecha)) {
    return { fecha, laborable: false, previstas: 0, creadas: 0 };
  }

  const qEmpleados = new cliente.Query("Employees");
  qEmpleados.equalTo("activo", true);
  qEmpleados.notEqualTo("exentoFichaje", true);
  qEmpleados.limit(1000);
  const empleados = await qEmpleados.find();

  const previstas = await obtenerJornadasPrevistas(fecha, empleados);
  if (previstas.length === 0) {
    console.warn("⚠️ No hay empleados activos para planificar:", fecha);
    return { fecha, laborable: true, previstas: 0, creadas: 0 };
  }

  const qJornadas = new cliente.Query("JornadasPrevistas");
  qJornadas.equalTo("fechaLaboral", fecha);
  qJornadas.limit(1000);
  const existentes = await qJornadas.find();
  const candidatas = resumenPlanificacion(previstas, existentes).filter(x => !x.existente);

  // Solo se insertan jornadas esperadas. No se modifica ningún fichaje real.
  let creadas = 0;
  for (const p of candidatas) {
    const jornada = new (cliente.Object.extend("JornadasPrevistas"))();
    jornada.set("clave", p.clave);
    jornada.set("empleadoId", p.empleadoId);
    jornada.set("nombre", p.nombre);
    jornada.set("fechaLaboral", p.fecha);
    jornada.set("entradaPrevista", p.entradaPrevista);
    jornada.set("salidaPrevista", p.salidaPrevista);
    jornada.set("estado", "PENDIENTE_FICHAJE");
    jornada.set("origen", "planificacion_automatica");
    jornada.set("creadoEn", new Date());
    await jornada.save();
    creadas++;
  }

  console.log(`✅ Jornadas previstas ${fecha}: ${previstas.length}; nuevas: ${creadas}; ya existentes: ${previstas.length - creadas}. No se crearon fichajes GPS.`);
  return { fecha, laborable: true, previstas: previstas.length, creadas };
}
