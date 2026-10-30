import test from "node:test";
import assert from "node:assert/strict";
import { crearListaFechas, planificarRegistrosHistoricos } from "../reconstruccion-historica.js";
import { fechaLocal } from "../jornadas-admin.js";

const empleado = (id, numero, dni) => ({
  id, get: campo => ({ telefono: numero, waId: numero, dni,
    nombre: "Empleado de prueba", activo: true, exentoFichaje: false })[campo]
});
const marca = (accion, numero, fecha, extra = {}) => ({
  get: campo => ({ accion, numero, fecha: new Date(fecha), ...extra })[campo]
});

test("No reconstruye jornadas antiguas sin ningún dato documental en ese día", () => {
  const plan = planificarRegistrosHistoricos({
    fecha: "2026-10-23",
    empleados: [empleado("e1", "600000001", "N1")],
    entradasExistentes: [],
    ausencias: new Set(), primeraMarca: new Map([["e1", "2026-09-01"]])
  });
  assert.equal(plan.omitidosSinDatos, true);
  assert.equal(plan.candidatos.length, 0);
});

test("Completa solo la marca que falta y conserva la existente", () => {
  const e = empleado("e1", "600000001", "N1");
  const registros = [marca("ENTRADA", "34600000001", "2026-10-22T06:58:00Z")];
  const args = {
    fecha: "2026-10-22", empleados: [e], entradasExistentes: registros,
    ausencias: new Set(), primeraMarca: new Map([["e1", "2026-09-01"]])
  };
  const plan = planificarRegistrosHistoricos(args);
  assert.equal(plan.candidatos.length, 1);
  assert.equal(plan.candidatos[0].accion, "SALIDA");
  assert.ok(plan.candidatos[0].hora >= new Date("2026-10-22T13:00:00Z"));
  assert.ok(plan.candidatos[0].hora <= new Date("2026-10-22T13:05:00Z"));
  assert.deepEqual(planificarRegistrosHistoricos({
    ...args,
    entradasExistentes: [...registros, marca("SALIDA", "34600000001", plan.candidatos[0].hora.toISOString())]
  }).candidatos, []);
  assert.equal(fechaLocal(plan.candidatos[0].hora), "2026-10-22");
});

test("Respeta ausencias y la fecha de primera marca real de cada trabajador", () => {
  const a = empleado("e1", "600000001", "N1");
  const b = empleado("e2", "600000002", "N2");
  const c = empleado("e3", "600000003", "N3");
  const plan = planificarRegistrosHistoricos({
    fecha: "2026-10-20", empleados: [a, b, c],
    entradasExistentes: [marca("ENTRADA", "34600000001", "2026-10-20T06:59:00Z")],
    ausencias: new Set(["e2"]),
    primeraMarca: new Map([["e1", "2026-09-01"], ["e2", "2026-09-01"], ["e3", "2026-10-27"]])
  });
  assert.equal(plan.ausentes, 1);
  assert.equal(plan.omitidosPreviosAlta, 1);
  assert.deepEqual(plan.candidatos.map(c => c.accion), ["SALIDA"]);
});

test("Acota los intervalos y rechaza fechas al revés o demasiado amplias", () => {
  assert.deepEqual(crearListaFechas("2026-10-29", "2026-10-30"), ["2026-10-29", "2026-10-30"]);
  assert.throws(() => crearListaFechas("2026-10-30", "2026-10-29"));
  assert.throws(() => crearListaFechas("2026-01-01", "2026-06-01"));
});
