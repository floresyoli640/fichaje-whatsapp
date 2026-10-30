import test from "node:test";
import assert from "node:assert/strict";
import { registrarFichajeWhatsApp } from "../fichaje-manual.js";

const empleado = {
  id: "empleado1",
  get: campo => ({
    nombre: "Empleada de prueba",
    dni: "12345678Z",
    telefono: "600000001",
    waId: "34600000001",
    activo: true,
    exentoFichaje: false,
    empresa: null
  })[campo]
};

function baseSimulada(filasIniciales = []) {
  const filas = [...filasIniciales];
  class Fila {
    constructor() { this.campos = {}; this.id = "id" + (filas.length + 1); }
    set(nombre, dato) { this.campos[nombre] = dato; }
    get(nombre) { return this.campos[nombre]; }
    async save() { filas.push(this); }
  }
  class Query {
    constructor(nombre) { assert.equal(nombre, "TimeEntries"); }
    equalTo() {}
    greaterThanOrEqualTo() {}
    lessThan() {}
    limit() {}
    async find() { return filas; }
  }
  return { filas, cliente: { Query, Object: { extend: () => Fila } } };
}

function marcaExistente({
  accion = "ENTRADA",
  fecha = new Date("2026-10-30T07:00:00Z"),
  numero = "34600000001",
  origen = "horario_programado_sin_verificar",
  provisional = true
} = {}) {
  return {
    id: "anterior",
    get: campo => ({ accion, fecha, numero, origen, provisional })[campo]
  };
}

test("ENTRADA y SALIDA se guardan al enviar el texto sin ubicación ni GeoPoint", async () => {
  const { filas, cliente } = baseSimulada();
  const fechaEntrada = new Date("2026-10-30T07:09:00Z");
  const fechaSalida = new Date("2026-10-30T14:03:00Z");
  const entrada = await registrarFichajeWhatsApp({
    empleado, accion: "ENTRADA", numero: "34600000001", ahora: fechaEntrada, cliente
  });
  const salida = await registrarFichajeWhatsApp({
    empleado, accion: "SALIDA", numero: "34600000001", ahora: fechaSalida, cliente
  });
  assert.equal(entrada.creada, true);
  assert.equal(salida.creada, true);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].get("fecha").toISOString(), "2026-10-30T07:09:00.000Z");
  assert.equal(filas[1].get("fecha").toISOString(), "2026-10-30T14:03:00.000Z");
  for (const fila of filas) {
    assert.equal(fila.get("origen"), "whatsapp_sin_ubicacion");
    assert.equal(fila.get("estado"), "FICHAJE_DECLARADO_POR_WHATSAPP");
    assert.equal(fila.get("provisional"), false);
    assert.equal(fila.get("sinGPS"), true);
    assert.equal(fila.get("pendienteVerificacion"), false);
    assert.equal(fila.get("ubicacion"), undefined);
    assert.equal(fila.get("latitud"), undefined);
    assert.equal(fila.get("longitud"), undefined);
    assert.equal(fila.get("empleadoId"), empleado.id);
  }
});

test("Un horario automático no impide un fichaje declarado después por el trabajador", async () => {
  const provisional = marcaExistente();
  const { filas, cliente } = baseSimulada([provisional]);
  const r = await registrarFichajeWhatsApp({
    empleado, accion: "ENTRADA", numero: "600000001",
    ahora: new Date("2026-10-30T07:10:00Z"), cliente
  });
  assert.equal(r.creada, true);
  assert.equal(filas.length, 2);
  assert.equal(filas[0], provisional);
  assert.equal(filas[1].get("provisional"), false);
});

test("No duplica el fichaje manual si llegan dos mensajes de WhatsApp el mismo día", async () => {
  const { filas, cliente } = baseSimulada();
  const args = {
    empleado, accion: "ENTRADA", numero: "600000001",
    ahora: new Date("2026-10-30T07:06:00Z"), cliente
  };
  assert.equal((await registrarFichajeWhatsApp(args)).creada, true);
  const segundo = await registrarFichajeWhatsApp({
    ...args, ahora: new Date("2026-10-30T07:07:00Z")
  });
  assert.equal(segundo.creada, false);
  assert.equal(filas.length, 1);
  assert.equal(segundo.fecha.toISOString(), args.ahora.toISOString());
});

test("Respeta fichajes anteriores con ubicación, pero no exige GPS para nuevas marcas", async () => {
  const previo = marcaExistente({ origen: "whatsapp_ubicacion", provisional: false });
  const { filas, cliente } = baseSimulada([previo]);
  const r = await registrarFichajeWhatsApp({
    empleado, accion: "ENTRADA", numero: "34600000001",
    ahora: new Date("2026-10-30T07:12:00Z"), cliente
  });
  assert.equal(r.creada, false);
  assert.equal(filas.length, 1);
});

test("No mezcla fichajes de días diferentes ni admite acciones inválidas", async () => {
  const anterior = marcaExistente({ fecha: new Date("2026-10-29T07:00:00Z"), origen: "whatsapp_ubicacion", provisional: false });
  const { filas, cliente } = baseSimulada([anterior]);
  const r = await registrarFichajeWhatsApp({
    empleado, accion: "ENTRADA", numero: "600000001",
    ahora: new Date("2026-10-30T07:00:00Z"), cliente
  });
  assert.equal(r.creada, true);
  assert.equal(filas.length, 2);
  await assert.rejects(() => registrarFichajeWhatsApp({
    empleado, accion: "DESCANSO", numero: "600000001", cliente
  }), /inválidos/);
});
