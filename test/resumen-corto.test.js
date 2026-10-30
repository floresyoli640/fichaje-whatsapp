import test from "node:test";
import assert from "node:assert/strict";
import {
  prepararEstadoResumen, textoResumenCorto, textoDetalleJornadas
} from "../resumen-corto.js";

const h = n => new Date(`2026-10-30T${n}Z`);
const filas = [
  { id: "e1", nombre: "María de la O", marcas: {
    entrada: h("06:59:00"), salida: h("14:03:00"),
    entradaAutomatica: false, salidaAutomatica: true
  }},
  { id: "e2", nombre: "Yolanda", marcas: {
    entrada: h("07:02:00"), salida: h("14:04:00"),
    entradaAutomatica: true, salidaAutomatica: true
  }},
  { id: "e3", nombre: "Amina", marcas: {
    entrada: h("07:01:00"), salida: h("14:01:00"),
    entradaAutomatica: false, salidaAutomatica: false
  }},
  { id: "e4", nombre: "José", marcas: {
    entrada: h("07:03:00"), salida: null,
    entradaAutomatica: true, salidaAutomatica: false
  }},
  { id: "e5", nombre: "Alcázar", marcas: {
    entrada: h("07:04:00"), salida: h("14:05:00"),
    entradaAutomatica: true, salidaAutomatica: true
  }},
  { id: "e6", nombre: "María Muñoz", marcas: {} }
];

test("Resumen corto cuenta personas, no filas, y distingue WhatsApp de automático", () => {
  const estado = prepararEstadoResumen({
    fecha: "2026-10-30", jornadas: filas, ausentes: new Set(),
    confirmadas: new Set(["e1", "e2"])
  });
  assert.equal(estado.total, 6);
  assert.equal(estado.entradas, 5);
  assert.equal(estado.entradasEnviadas, 2);
  assert.equal(estado.entradasAutomaticas, 3);
  assert.equal(estado.salidas, 4);
  assert.equal(estado.salidasEnviadas, 1);
  assert.equal(estado.salidasAutomaticas, 3);
  assert.equal(estado.confirmadas, 2);
  const mensaje = textoResumenCorto(estado);
  assert.match(mensaje, /Entradas: 5\/6 \(2 por WhatsApp · 3 auto\)/);
  assert.match(mensaje, /Salidas: 4\/6 \(1 por WhatsApp · 3 auto\)/);
  assert.match(mensaje, /Aprobación admin: 2\/6/);
  assert.match(mensaje, /Auto = horario provisional/);
  assert.match(mensaje, /\*DETALLE\*/);
  assert.match(mensaje, /\*CONFIRMAR TODOS\*/);
  assert.ok(mensaje.length < 400);
  assert.doesNotMatch(mensaje, /María de la O|Yolanda|Alcázar/);
});

test("Las ausencias se excluyen del denominador, nunca cuentan como entrada", () => {
  const estado = prepararEstadoResumen({
    fecha: "2026-10-30", jornadas: filas,
    ausentes: new Set(["e6"]),
    confirmadas: new Set(["e1", "e2", "e6"])
  });
  assert.equal(estado.total, 6);
  assert.equal(estado.ausentes, 1);
  assert.equal(estado.esperadas, 5);
  assert.equal(estado.confirmadas, 2);
  assert.match(textoResumenCorto(estado), /Trabajadores: 6 · Ausentes: 1/);
  assert.match(textoResumenCorto(estado), /Entradas: 5\/5/);
});

test("DETALLE incluye nombres y distingue fichajes reales de horas provisionales", () => {
  const estado = prepararEstadoResumen({
    fecha: "2026-10-30", jornadas: filas,
    ausentes: new Set(["e6"]), confirmadas: new Set(["e1"])
  });
  const detalle = textoDetalleJornadas(estado, d => d.toISOString().slice(11,16));
  assert.match(detalle, /María de la O: 06:59 \(WhatsApp\) \/ 14:03 \(auto, sin verificar\)/);
  assert.match(detalle, /María Muñoz: AUSENTE/);
  assert.match(detalle, /Volver: \*RESUMEN\*/);
  assert.match(detalle, /✅ Aprobada/);
});

test("Sin trabajadores no divide entre cero ni declara registros inexistentes", () => {
  const estado = prepararEstadoResumen({
    fecha: "2026-10-30", jornadas: []
  });
  assert.match(textoResumenCorto(estado), /Entradas: 0\/0/);
  assert.match(textoResumenCorto(estado), /Salidas: 0\/0/);
});
