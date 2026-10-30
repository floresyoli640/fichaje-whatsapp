import test from "node:test";
import assert from "node:assert/strict";
import { fechaHoraMadrid, registrarFichajesAutomaticos, ORIGEN_AUTOMATICO, variacionMinutos } from "../fichajes-automaticos.js";
import { prepararConfirmacion } from "../jornadas-admin.js";

const empleados = Array.from({ length: 6 }, (_, i) => ({
  id: "e" + (i + 1),
  get: campo => ({
    nombre: "Empleado " + (i + 1),
    telefono: "60000000" + (i + 1),
    dni: "DNI" + (i + 1),
    activo: true,
    exentoFichaje: false
  })[campo]
}));

function back4appFalso(real = [], ausentes = []) {
  const filas = [...real];
  class Registro {
    constructor() { this.valores = new Map(); }
    get(k) { return this.valores.get(k); }
    set(k, v) { this.valores.set(k, v); }
    async save() { if (!filas.includes(this)) filas.push(this); }
  }
  class Query {
    constructor(clase) { this.clase = typeof clase === "string" ? clase : "TimeEntries"; }
    equalTo(k, v) { this[k] = v; }
    notEqualTo() {}
    greaterThanOrEqualTo() {}
    lessThan() {}
    limit() {}
    async find() {
      if (this.clase === "Employees") return empleados;
      if (this.clase === "AusenciasJornada") return ausentes.map(id => ({ get: k => k === "empleadoId" ? id : null }));
      if (this.clase === "TimeEntries") return filas;
      throw new Error("Clase inesperada: " + this.clase);
    }
  }
  return { cliente: { Query, Object: { extend: () => Registro } }, filas };
}

async function conFestivos(fechas, fn) {
  const antes = process.env.FESTIVOS_UBEDA_2026;
  process.env.FESTIVOS_UBEDA_2026 = fechas;
  try { await fn(); }
  finally {
    if (antes === undefined) delete process.env.FESTIVOS_UBEDA_2026;
    else process.env.FESTIVOS_UBEDA_2026 = antes;
  }
}

test("Madrid usa CET en octubre y CEST en junio, sin depender de UTC del servidor", () => {
  assert.equal(fechaHoraMadrid("2026-10-30", "08:00").toISOString(), "2026-10-30T07:00:00.000Z");
  assert.equal(fechaHoraMadrid("2026-10-30", "15:00").toISOString(), "2026-10-30T14:00:00.000Z");
  assert.equal(fechaHoraMadrid("2026-06-01", "08:00").toISOString(), "2026-06-01T06:00:00.000Z");
});

test("Crea 6 entradas a las 08, 6 salidas a las 15 y no duplica al reintentar", async () => {
  await conFestivos("2026-11-02,2026-12-07", async () => {
    const { cliente, filas } = back4appFalso();
    const fecha = "2026-10-30";
    const manana = await registrarFichajesAutomaticos({
      fecha, ahora: new Date("2026-10-30T07:05:00Z"), cliente
    });
    assert.equal(manana.entradasNuevas, 6);
    assert.equal(manana.salidasNuevas, 0);
    assert.equal(filas.length, 6);
    for (const registro of filas) {
      assert.equal(registro.get("origen"), ORIGEN_AUTOMATICO);
      assert.ok(Math.abs(registro.get("fecha").getTime() - fechaHoraMadrid(fecha, "08:00").getTime()) <= 300000);
      assert.equal(registro.get("estado"), "AUTOMATICO_PENDIENTE_VERIFICACION");
      assert.equal(registro.get("provisional"), true);
      assert.equal(registro.get("ubicacion"), undefined);
    }
    const repetido = await registrarFichajesAutomaticos({
      fecha, ahora: new Date("2026-10-30T08:00:00Z"), cliente
    });
    assert.equal(repetido.entradasNuevas, 0);
    assert.equal(filas.length, 6);
    const tarde = await registrarFichajesAutomaticos({
      fecha, ahora: new Date("2026-10-30T14:05:00Z"), cliente
    });
    assert.equal(tarde.salidasNuevas, 6);
    assert.equal(filas.length, 12);
    const repetidoTarde = await registrarFichajesAutomaticos({
      fecha, ahora: new Date("2026-10-30T14:05:00Z"), cliente
    });
    assert.equal(repetidoTarde.salidasNuevas, 0);
    assert.equal(new Set(filas.map(r => r.get("claveAutomatica"))).size, 12);
  });
});

test("Respeta fichajes reales, ausencias y no adelanta salidas", async () => {
  await conFestivos("2026-11-02", async () => {
    const real = {
      get: k => ({
        fecha: new Date("2026-10-30T07:07:00Z"),
        accion: "ENTRADA",
        numero: "34600000001",
        origen: "whatsapp_ubicacion"
      })[k]
    };
    const { cliente, filas } = back4appFalso([real], ["e6"]);
    const res = await registrarFichajesAutomaticos({
      fecha: "2026-10-30", ahora: new Date("2026-10-30T08:45:00Z"), cliente
    });
    assert.equal(res.entradasNuevas, 4);
    assert.equal(res.ausentes, 1);
    assert.equal(res.marcasExistentes, 1);
    assert.equal(res.salidasNuevas, 0);
    assert.equal(filas.length, 5);
    const auto = filas.find(x => x.get("origen") === ORIGEN_AUTOMATICO);
    const datos = prepararConfirmacion({
      marcas: { entrada: auto.get("fecha"), entradaAutomatica: true }
    });
    assert.equal(datos.fuenteEntrada, "horario_previsto");
    assert.equal(datos.pendiente, true);
  });
});

test("No genera marcajes en festivos ni fines de semana", async () => {
  await conFestivos("2026-11-02", async () => {
    const { cliente, filas } = back4appFalso();
    const festivo = await registrarFichajesAutomaticos({
      fecha: "2026-11-02", ahora: new Date("2026-11-02T14:30:00Z"), cliente
    });
    assert.equal(festivo.causa, "dia_no_laborable");
    const sabado = await registrarFichajesAutomaticos({
      fecha: "2026-10-31", ahora: new Date("2026-10-31T14:30:00Z"), cliente
    });
    assert.equal(sabado.causa, "dia_no_laborable");
    assert.equal(filas.length, 0);
  });
});

test("Los seis empleados tienen un desfase estable entre menos cinco y más cinco minutos", () => {
  const desfases = empleados.map(e => variacionMinutos(e.id, "2026-10-30", "ENTRADA"));
  for (let i = 0; i < empleados.length; i++) {
    assert.ok(desfases[i] >= -5 && desfases[i] <= 5);
    assert.equal(desfases[i], variacionMinutos(empleados[i].id, "2026-10-30", "ENTRADA"));
  }
  assert.ok(new Set(desfases).size > 1);
});

test("Nunca registra un horario programado antes del minuto asignado", async () => {
  await conFestivos("2026-11-02", async () => {
    const { cliente, filas } = back4appFalso();
    const sinHora = await registrarFichajesAutomaticos({
      fecha: "2026-10-30", ahora: new Date("2026-10-30T06:54:00Z"), cliente
    });
    assert.equal(sinHora.entradasNuevas, 0);
    assert.equal(filas.length, 0);
    const total = await registrarFichajesAutomaticos({
      fecha: "2026-10-30", ahora: new Date("2026-10-30T07:05:00Z"), cliente
    });
    assert.equal(total.entradasNuevas, 6);
    assert.equal(total.salidasNuevas, 0);
  });
});
