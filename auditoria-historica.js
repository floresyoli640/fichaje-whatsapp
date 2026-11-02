// Auditoría de solo lectura para decidir una reconstrucción histórica con trazabilidad.
import Parse from "parse/node.js";
import { fechaLocal } from "./jornadas-admin.js";

function summarizar(datos, campoFecha = "fecha") {
  const porDia = new Map();
  for (const fila of datos) {
    const f = fila.get(campoFecha);
    if (!(f instanceof Date)) continue;
    const fecha = fechaLocal(f);
    const dia = porDia.get(fecha) || { registros: 0, entradas: 0, salidas: 0, reales: 0, automaticos: 0 };
    dia.registros++;
    const accion = fila.get("accion");
    if (accion === "ENTRADA") dia.entradas++;
    if (accion === "SALIDA") dia.salidas++;
    if (fila.get("provisional") === true || /horario_programado/.test(fila.get("origen") || "")) dia.automaticos++;
    else dia.reales++;
    porDia.set(fecha, dia);
  }
  return Object.fromEntries([...porDia].sort((a,b) => a[0].localeCompare(b[0])));
}

export async function auditarHistoria({ cliente = Parse, desde = "2026-09-01", hasta = "2026-10-29" } = {}) {
  const qs = new cliente.Query("TimeEntries");
  qs.greaterThanOrEqualTo("fecha", new Date(desde + "T00:00:00Z"));
  qs.lessThan("fecha", new Date(new Date(hasta + "T00:00:00Z").getTime() + 172800000));
  qs.limit(1000);
  const registros = await qs.find();
  if (registros.length === 1000) {
    throw new Error("Auditoría incompleta: 1000 registros, paginar antes de modificar históricos");
  }
  const ea = new cliente.Query("Employees");
  ea.limit(1000);
  const empleados = await ea.find();
  const camposFecha = ["fechaAlta", "fechaIncorporacion", "fechaInicio", "fechaBaja"];
  const fechasEmpleados = Object.fromEntries(camposFecha.map(campo => [
    campo,
    empleados.filter(e => e.get(campo) != null).length
  ]));
  const earliest = new cliente.Query("TimeEntries");
  earliest.ascending("fecha");
  earliest.limit(1);
  const primerRegistro = await earliest.first();
  return {
    desde, hasta,
    primerRegistroDisponible: primerRegistro?.get("fecha") instanceof Date
      ? fechaLocal(primerRegistro.get("fecha")) : null,
    empleadosTotales: empleados.length,
    empleadosActivosNoExentos: empleados.filter(e =>
      e.get("activo") === true && e.get("exentoFichaje") !== true
    ).length,
    datosFechaEmpleados: fechasEmpleados,
    historico: summarizar(registros.filter(r =>
      r.get("fecha") instanceof Date && fechaLocal(r.get("fecha")) >= desde && fechaLocal(r.get("fecha")) <= hasta
    ))
  };
}
