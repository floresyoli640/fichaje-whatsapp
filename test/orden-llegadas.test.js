import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizarNombre, ordenarPorOrdenHabitual, ordenPrevistoParaFecha,
  desfasesProgramadosEntrada, PRIMERA_HABITUAL, SEGUNDA_HABITUAL
} from "../orden-llegadas.js";
import { obtenerJornadasPrevistas } from "../jornadas-admin.js";

function trabajador(id, nombre) {
  return {
    id,
    get: campo => ({ nombre, activo: true, exentoFichaje: false })[campo]
  };
}

const plantilla = [
  trabajador("jose", "JOSE MANUEL MORENO GARRIDO"),
  trabajador("yolanda", "MARÍA YOLANDA FLORES FRÍAS"),
  trabajador("alca", "ALCAZAR MARIN RUIZ"),
  trabajador("enriqueta", "MARÍA DE LA O ENRIQUETA CHICHARRO LÓPEZ"),
  trabajador("maria", "MARIA MUÑOZ SANCHEZ"),
  trabajador("amine", "AMINE LATIF")
];

test("Identifica nombres con y sin tildes y ordena el RESUMEN habitual", async () => {
  assert.equal(normalizarNombre("María de la O Enriqueta Chicharro López"), PRIMERA_HABITUAL);
  assert.equal(normalizarNombre("Maria Yolanda Flores Frias"), SEGUNDA_HABITUAL);
  const orden = ordenarPorOrdenHabitual(plantilla);
  assert.equal(orden[0].id, "enriqueta");
  assert.equal(orden[1].id, "yolanda");
  assert.deepEqual(plantilla.map(e => e.id), ["jose","yolanda","alca","enriqueta","maria","amine"]);
  const previsto = await obtenerJornadasPrevistas("2026-11-03", plantilla);
  assert.equal(previsto[0].empleadoId, "enriqueta");
  assert.equal(previsto[1].empleadoId, "yolanda");
});

test("La primera referencia de entrada es siempre Enriqueta; Yolanda casi siempre segunda", () => {
  let vecesSegunda = 0;
  let vecesTercera = 0;
  for (let i = 0; i < 120; i++) {
    const fecha = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const orden = ordenPrevistoParaFecha(plantilla, fecha);
    assert.equal(orden[0].id, "enriqueta");
    const puestoYolanda = orden.findIndex(e => e.id === "yolanda");
    if (puestoYolanda === 1) vecesSegunda++;
    else if (puestoYolanda === 2) vecesTercera++;
    else assert.fail("Yolanda debe ser segunda o tercera en el orden orientativo");
    const desfases = desfasesProgramadosEntrada(plantilla, fecha);
    const ordenHoras = [...desfases.entries()].sort((a,b) => a[1] - b[1]);
    assert.equal(ordenHoras[0][0], "enriqueta");
    assert.equal(ordenHoras[puestoYolanda][0], "yolanda");
    assert.equal(new Set(desfases.values()).size, 6, "Sin horas duplicadas por día");
    for (const m of desfases.values()) assert.ok(m >= -5 && m <= 5);
    assert.deepEqual([...desfases], [...desfasesProgramadosEntrada(plantilla, fecha)]);
  }
  assert.ok(vecesSegunda >= 75, "Yolanda debe ser segunda la mayoría amplia de días");
  assert.ok(vecesTercera > 0, "No debe fijarse siempre como segunda");
});

test("Al faltar Enriqueta, el resto mantiene una planificación acotada", () => {
  const sinPrimera = plantilla.filter(e => e.id !== "enriqueta");
  const d = desfasesProgramadosEntrada(sinPrimera, "2026-11-03");
  assert.equal(d.size, 5);
  assert.ok([...d.values()].every(n => n >= -5 && n <= 5));
  assert.equal(new Set(d.values()).size, 5);
});

test("No se admiten más de once marcas únicas dentro de la ventana de once minutos", () => {
  const doce = Array.from({length: 12},(_,i) => trabajador(String(i), "Otro " + i));
  assert.throws(() => desfasesProgramadosEntrada(doce, "2026-11-03"), /11 minutos/);
});
