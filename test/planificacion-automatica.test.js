import test from "node:test";
import assert from "node:assert/strict";
import { registrarJornadasPrevistas, resumenPlanificacion } from "../planificacion-automatica.js";

function entornoSimulado(empleados) {
  const registros = [];
  class Registro {
    constructor() { this.campos = new Map(); }
    set(nombre, valor) { this.campos.set(nombre, valor); }
    get(nombre) { return this.campos.get(nombre); }
    async save() { registros.push(this); }
  }
  class Query {
    constructor(clase) { this.clase = clase; this.criterios = {}; }
    equalTo(nombre, valor) { this.criterios[nombre] = valor; }
    notEqualTo(nombre, valor) { this.criterios["!" + nombre] = valor; }
    limit() {}
    async find() {
      if (this.clase === "Employees") {
        return empleados.filter(e => e.get("activo") === true && e.get("exentoFichaje") !== true);
      }
      if (this.clase === "JornadasPrevistas") {
        return registros.filter(r => r.get("fechaLaboral") === this.criterios.fechaLaboral);
      }
      throw new Error("Clase no prevista: " + this.clase);
    }
  }
  return { cliente: { Query, Object: { extend: () => Registro } }, registros };
}

const empleado = i => ({
  id: String(i),
  get: campo => ({ activo: true, exentoFichaje: false, nombre: `Empleado ${i}` })[campo]
});

test("Registra automáticamente seis turnos previstos sin inventar fichajes", async () => {
  const antes = process.env.FESTIVOS_UBEDA_2026;
  process.env.FESTIVOS_UBEDA_2026 = "2026-11-02,2026-12-07";
  try {
    const { cliente, registros } = entornoSimulado([1, 2, 3, 4, 5, 6].map(empleado));
    const resultado = await registrarJornadasPrevistas("2026-10-29", cliente);
    assert.deepEqual(resultado, { fecha: "2026-10-29", laborable: true, previstas: 6, creadas: 6 });
    assert.equal(registros.length, 6);
    assert.equal(new Set(registros.map(r => r.get("clave"))).size, 6);
    for (const r of registros) {
      assert.equal(r.get("entradaPrevista"), "08:00");
      assert.equal(r.get("salidaPrevista"), "15:00");
      assert.equal(r.get("estado"), "PENDIENTE_FICHAJE");
      assert.equal(r.get("origen"), "planificacion_automatica");
      assert.equal(r.get("entradaReal"), undefined);
      assert.equal(r.get("salidaReal"), undefined);
    }
    const segunda = await registrarJornadasPrevistas("2026-10-29", cliente);
    assert.equal(segunda.creadas, 0);
    assert.equal(registros.length, 6);
  } finally {
    if (antes === undefined) delete process.env.FESTIVOS_UBEDA_2026;
    else process.env.FESTIVOS_UBEDA_2026 = antes;
  }
});

test("No registra turnos previstos en festivos ni sábados", async () => {
  const antes = process.env.FESTIVOS_UBEDA_2026;
  process.env.FESTIVOS_UBEDA_2026 = "2026-11-02";
  try {
    const { cliente, registros } = entornoSimulado([1, 2, 3, 4, 5, 6].map(empleado));
    assert.equal((await registrarJornadasPrevistas("2026-11-02", cliente)).creadas, 0);
    assert.equal((await registrarJornadasPrevistas("2026-10-31", cliente)).creadas, 0);
    assert.equal(registros.length, 0);
  } finally {
    if (antes === undefined) delete process.env.FESTIVOS_UBEDA_2026;
    else process.env.FESTIVOS_UBEDA_2026 = antes;
  }
});

test("Solo genera candidatas sin ficha previa y conserva las existentes", () => {
  const anterior = { get: campo => ({ clave: "1:2026-10-29", estado: "CONFIRMADA" })[campo] };
  const previstas = [
    { empleadoId: "1", fecha: "2026-10-29" },
    { empleadoId: "2", fecha: "2026-10-29" }
  ];
  const resultado = resumenPlanificacion(previstas, [anterior]);
  assert.equal(resultado[0].existente, anterior);
  assert.equal(resultado[1].existente, null);
  assert.equal(resultado[0].clave, "1:2026-10-29");
});
