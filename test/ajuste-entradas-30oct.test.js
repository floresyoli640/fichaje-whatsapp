import test from "node:test";
import assert from "node:assert/strict";
import { planificarAjusteEntradas, ajustarEntradasProvisionales30Oct } from "../ajuste-entradas-30oct.js";
import { fechaHoraMadrid } from "../fichajes-automaticos.js";

const nombres = [
  "MARIA YOLANDA FLORES FRIAS",
  "JOSE MANUEL MORENO GARRIDO",
  "MARIA DE LA O ENRIQUETA CHICHARRO LOPEZ",
  "ALCAZAR MARIN RUIZ"
];

function entorno() {
  const filas = nombres.map((nombre, indice) => {
    const datos = {
      nombre, empleadoId: "e" + indice, accion: "ENTRADA",
      origen: "horario_programado_sin_verificar", provisional: true,
      sinGPS: true, estado: "AUTOMATICO_PENDIENTE_VERIFICACION",
      fechaLaboral: "2026-10-30", fecha: fechaHoraMadrid("2026-10-30", "08:00"),
      registradoEn: new Date("2026-10-30T08:26:00Z")
    };
    return {
      id: "registro" + indice,
      get: clave => datos[clave],
      set: (clave, valor) => { datos[clave] = valor; },
      async save() { this.guardados = (this.guardados || 0) + 1; }
    };
  });
  const cliente = {
    Query: class {
      equalTo() {}
      limit() {}
      async find() { return filas; }
    }
  };
  return { filas, cliente };
}

test("Las cuatro entradas a las 08:00 son reconocidas y reciben horas distintas de 08:00", () => {
  const { filas } = entorno();
  const plan = planificarAjusteEntradas(filas);
  assert.equal(plan.length, 4);
  for (const r of plan) {
    assert.equal(r.cambiar, true);
    const minutos = (r.destino - fechaHoraMadrid("2026-10-30", "08:00")) / 60000;
    assert.ok(minutos !== 0 && minutos >= -5 && minutos <= 5);
  }
});

test("La migración es de lectura en SIMULAR y de escritura idempotente en APLICAR", async () => {
  const { filas, cliente } = entorno();
  const antes = filas.map(r => r.get("fecha").getTime());
  const vista = await ajustarEntradasProvisionales30Oct({ aplicar: false, cliente });
  assert.equal(vista.encontrados, 4);
  assert.equal(vista.modificados, 0);
  assert.deepEqual(filas.map(r => r.get("fecha").getTime()), antes);

  const cambiado = await ajustarEntradasProvisionales30Oct({ aplicar: true, cliente });
  assert.equal(cambiado.modificados, 4);
  for (const fila of filas) {
    assert.equal(fila.guardados, 1);
    assert.equal(fila.get("registradoEn").toISOString(), "2026-10-30T08:26:00.000Z");
    assert.equal(fila.get("provisional"), true);
    assert.match(fila.get("observacion"), /NO es entrada presencial comprobada/);
  }
  const repetido = await ajustarEntradasProvisionales30Oct({ aplicar: true, cliente });
  assert.equal(repetido.modificados, 0);
  assert.equal(repetido.sinCambios, 4);
});

test("Rechaza alterar fichajes reales o un conjunto incompleto", () => {
  const { filas } = entorno();
  assert.throws(() => planificarAjusteEntradas(filas.slice(0, 3)), /faltan/i);
  filas[0].set("origen", "whatsapp_ubicacion");
  assert.throws(() => planificarAjusteEntradas(filas), /garantías/i);
});
