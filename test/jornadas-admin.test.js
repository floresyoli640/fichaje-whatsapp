import test from "node:test";
import assert from "node:assert/strict";
import { fechaLocal, esLaborable, numeroNormalizado, esAdministrador, obtenerJornadasPrevistas } from "../jornadas-admin.js";

test("Normaliza teléfono español sin revelar la configuración", () => {
  assert.equal(numeroNormalizado("696 963 442"), "34696963442");
  assert.equal(numeroNormalizado("+34 696 963 442"), "34696963442");
  assert.equal(esAdministrador("696963442", "34696963442"), true);
  assert.equal(esAdministrador("696963443", "34696963442"), false);
  assert.equal(esAdministrador("696963442", ""), false);
});

test("Detecta laborables y excluye fines de semana y festivos", () => {
  const festivos = new Set(["2026-12-08"]);
  assert.equal(esLaborable("2026-12-07", festivos), true);
  assert.equal(esLaborable("2026-12-08", festivos), false);
  assert.equal(esLaborable("2026-12-12", festivos), false);
});

test("Solo planifica empleados activos no exentos", async () => {
  const empleado = (id, nombre, activo, exentoFichaje) => ({ id, get: key => ({ nombre, activo, exentoFichaje })[key] });
  const resultado = await obtenerJornadasPrevistas("2026-12-07", [
    empleado("1", "Ana", true, false),
    empleado("2", "Luis", false, false),
    empleado("3", "Eva", true, true)
  ]);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].nombre, "Ana");
  assert.equal(resultado[0].estado, "PENDIENTE_VALIDACION");
});

test("Fecha local usa formato ISO", () => {
  assert.match(fechaLocal(new Date("2026-10-29T12:00:00Z")), /^2026-10-29$/);
});
