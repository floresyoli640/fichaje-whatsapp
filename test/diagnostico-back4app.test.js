import test from "node:test";
import assert from "node:assert/strict";
import { comprobarRegistrosBack4App } from "../diagnostico-back4app.js";

test("Verifica en las tres clases sin confundir confirmaciones con entradas reales", async () => {
  const hacer = campos => ({ get: clave => campos[clave] });
  const datos = {
    JornadasPrevistas: Array.from({ length: 6 }, (_, i) => hacer({ empleadoId: "" + (i + 1) })),
    ConfirmacionesJornada: Array.from({ length: 6 }, (_, i) =>
      hacer({ empleadoId: "" + (i + 1), estado: "CONFIRMADA_ADMIN_PENDIENTE_VERIFICACION" })),
    TimeEntries: [
      hacer({ fecha: new Date("2026-10-29T07:00:00.000Z"), accion: "ENTRADA" }),
      hacer({ fecha: new Date("2026-10-29T07:08:00.000Z"), accion: "ENTRADA" }),
      hacer({ fecha: new Date("2026-10-28T07:00:00.000Z"), accion: "ENTRADA" })
    ]
  };
  const consultados = [];
  class Query {
    constructor(clase) { this.clase = clase; consultados.push(clase); }
    equalTo() {}
    greaterThanOrEqualTo() {}
    lessThan() {}
    limit() {}
    async find() { return datos[this.clase]; }
  }
  const resultado = await comprobarRegistrosBack4App("2026-10-29", { Query });
  assert.deepEqual(resultado.tablas, {
    JornadasPrevistas: 6,
    ConfirmacionesJornada: 6,
    TimeEntries: 2
  });
  assert.equal(resultado.empleadosConConfirmacion, 6);
  assert.equal(resultado.fichajesReales.entradas, 2);
  assert.equal(resultado.fichajesReales.salidas, 0);
  assert.equal(resultado.estadosConfirmacion.CONFIRMADA_ADMIN_PENDIENTE_VERIFICACION, 6);
  assert.deepEqual(consultados, ["JornadasPrevistas", "ConfirmacionesJornada", "TimeEntries"]);
});
