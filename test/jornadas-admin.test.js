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
  assert.equal(esLaborable("2026-12-09", festivos), true);
  assert.equal(esLaborable("2026-12-08", festivos), false);
  assert.equal(esLaborable("2026-12-12", festivos), false);
});

test("Solo planifica empleados activos no exentos", async () => {
  const empleado = (id, nombre, activo, exentoFichaje) => ({ id, get: key => ({ nombre, activo, exentoFichaje })[key] });
  const resultado = await obtenerJornadasPrevistas("2026-12-09", [
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

test("Rechaza festivos locales y traslados oficiales configurados", async () => {
  const { esDiaLaborableConfigurado } = await import("../comandos-admin.js");
  const previo = process.env.FESTIVOS_UBEDA_2026;
  process.env.FESTIVOS_UBEDA_2026 = "2026-09-08,2026-09-29,2026-11-02,2026-12-07";
  try {
    for (const fecha of ["2026-09-08", "2026-09-29", "2026-11-02", "2026-12-07"]) {
      assert.equal(esDiaLaborableConfigurado(fecha), false, fecha);
    }
    assert.equal(esDiaLaborableConfigurado("2026-09-30"), true);
  } finally {
    if (previo === undefined) delete process.env.FESTIVOS_UBEDA_2026;
    else process.env.FESTIVOS_UBEDA_2026 = previo;
  }
});

test("No permite ejecutar comandos de administración a un número ajeno", async () => {
  const { procesarComandoAdmin } = await import("../comandos-admin.js");
  const anterior = process.env.ADMIN_WHATSAPP;
  process.env.ADMIN_WHATSAPP = "34600000000";
  const respuestas = [];
  try {
    const procesado = await procesarComandoAdmin({
      texto: "CONFIRMAR TODOS",
      numero: "34611111111",
      responder: async texto => respuestas.push(texto)
    });
    assert.equal(procesado, true);
    assert.match(respuestas[0], /reservado a administración/i);
  } finally {
    if (anterior === undefined) delete process.env.ADMIN_WHATSAPP;
    else process.env.ADMIN_WHATSAPP = anterior;
  }
});

test("Bloquea comandos si no hay calendario configurado", async () => {
  const { procesarComandoAdmin } = await import("../comandos-admin.js");
  const adminPrevio = process.env.ADMIN_WHATSAPP;
  const festivosPrevio = process.env.FESTIVOS_UBEDA_2026;
  process.env.ADMIN_WHATSAPP = "34600000000";
  delete process.env.FESTIVOS_UBEDA_2026;
  const respuestas = [];
  try {
    const procesado = await procesarComandoAdmin({
      texto: "RESUMEN", numero: "34600000000",
      responder: async texto => respuestas.push(texto)
    });
    assert.equal(procesado, true);
    assert.match(respuestas[0], /Falta configurar el calendario oficial/);
  } finally {
    if (adminPrevio === undefined) delete process.env.ADMIN_WHATSAPP;
    else process.env.ADMIN_WHATSAPP = adminPrevio;
    if (festivosPrevio === undefined) delete process.env.FESTIVOS_UBEDA_2026;
    else process.env.FESTIVOS_UBEDA_2026 = festivosPrevio;
  }
});
