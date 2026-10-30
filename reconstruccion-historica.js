// Reconstruye exclusivamente HORARIOS TEÓRICOS históricos y preserva todos los fichajes auténticos.
// Los asientos creados no demuestran que la persona estuviera presente.
import Parse from "parse/node.js";
import { fechaLocal, numeroNormalizado, HORARIO } from "./jornadas-admin.js";
import { fechaHoraMadrid, variacionMinutos } from "./fichajes-automaticos.js";
import { esDiaLaborableConfigurado } from "./comandos-admin.js";

export const ORIGEN_HISTORICO = "horario_programado_reconstruccion_historica";
export const DESDE_RECONSTRUCCION = "2026-09-01";
export const HASTA_RECONSTRUCCION = "2026-10-29";

function variantesNumero(empleado) {
  const bases = [empleado.get("telefono"), empleado.get("waId")]
    .map(numeroNormalizado).filter(n => n.length >= 9);
  return [...new Set(bases.flatMap(n => [n, n.slice(-9), n.slice(-9).length === 9 ? "34" + n.slice(-9) : n]))];
}

function identifica(registro, empleado, numeros) {
  if (registro.get("empleadoId") && registro.get("empleadoId") === empleado.id) return true;
  if (empleado.get("dni") && registro.get("dni") && empleado.get("dni") === registro.get("dni")) return true;
  const numero = numeroNormalizado(registro.get("numero"));
  return numero.length >= 9 && numeros.some(n => n.slice(-9) === numero.slice(-9));
}

export function crearListaFechas(desde, hasta) {
  const validar = f => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f + "T00:00:00Z"));
  if (!validar(desde) || !validar(hasta) || hasta < desde) throw new Error("Intervalo histórico inválido");
  const inicio = Date.parse(desde + "T00:00:00Z");
  const final = Date.parse(hasta + "T00:00:00Z");
  if ((final - inicio) / 86400000 > 90) throw new Error("Intervalo superior a 90 días: dividir la reconstrucción");
  const fechas = [];
  for (let tiempo = inicio; tiempo <= final; tiempo += 86400000) {
    fechas.push(new Date(tiempo).toISOString().slice(0, 10));
  }
  return fechas;
}

function construirCandidato(empleado, fecha, accion) {
  const base = fechaHoraMadrid(fecha, accion === "ENTRADA" ? HORARIO.entrada : HORARIO.salida);
  const variacion = variacionMinutos(empleado.id, fecha, accion);
  return {
    empleado, fecha, accion,
    hora: new Date(base.getTime() + variacion * 60000),
    variacion,
    clave: empleado.id + ":" + fecha + ":" + accion
  };
}

export function planificarRegistrosHistoricos({ fecha, empleados, entradasExistentes, ausencias, primeraMarca }) {
  const delDia = entradasExistentes.filter(r =>
    r.get("fecha") instanceof Date && fechaLocal(r.get("fecha")) === fecha
  );
  // No se inventan jornadas completas en fechas sin ningún fichaje documentado.
  if (!delDia.length) return { candidatos: [], omitidosSinDatos: true, omitidosPreviosAlta: 0, ausentes: 0 };
  const candidatos = [];
  let omitidosPreviosAlta = 0;
  let ausentes = 0;
  for (const empleado of empleados) {
    if (ausencias.has(empleado.id)) { ausentes++; continue; }
    const primerDia = primeraMarca.get(empleado.id);
    if (!primerDia || primerDia > fecha) { omitidosPreviosAlta++; continue; }
    const numeros = variantesNumero(empleado);
    if (!numeros.length && !empleado.get("dni")) { omitidosPreviosAlta++; continue; }
    for (const accion of ["ENTRADA", "SALIDA"]) {
      if (delDia.some(r => r.get("accion") === accion && identifica(r, empleado, numeros))) continue;
      candidatos.push(construirCandidato(empleado, fecha, accion));
    }
  }
  return { candidatos, omitidosSinDatos: false, omitidosPreviosAlta, ausentes };
}

async function primerDiaConFichaje(empleado, cliente) {
  const numeros = variantesNumero(empleado);
  const q = new cliente.Query("TimeEntries");
  const condiciones = [];
  if (numeros.length) {
    const porNumero = new cliente.Query("TimeEntries");
    porNumero.containedIn("numero", numeros);
    condiciones.push(porNumero);
  }
  if (empleado.get("dni")) {
    const porDni = new cliente.Query("TimeEntries");
    porDni.equalTo("dni", empleado.get("dni"));
    condiciones.push(porDni);
  }
  if (!condiciones.length) return null;
  // La búsqueda utiliza el identificador del trabajador; los nombres no son claves únicas.
  const consulta = condiciones.length === 1 ? condiciones[0] : cliente.Query.or(...condiciones);
  consulta.ascending("fecha");
  consulta.limit(1);
  const primero = await consulta.first();
  return primero?.get("fecha") instanceof Date ? fechaLocal(primero.get("fecha")) : null;
}

export async function reconstruirHistorico({
  desde = DESDE_RECONSTRUCCION,
  hasta = HASTA_RECONSTRUCCION,
  aplicar = false,
  cliente = Parse
} = {}) {
  const fechas = crearListaFechas(desde, hasta);
  if (hasta >= fechaLocal()) throw new Error("La reconstrucción requiere fechas cerradas anteriores a hoy");
  const laborables = fechas.filter(esDiaLaborableConfigurado);
  const qe = new cliente.Query("Employees");
  qe.equalTo("activo", true);
  qe.notEqualTo("exentoFichaje", true);
  qe.limit(1000);
  const empleados = await qe.find();
  const qa = new cliente.Query("AusenciasJornada");
  qa.containedIn("fechaLaboral", laborables);
  qa.limit(1000);
  const ausencias = await qa.find();
  if (ausencias.length >= 1000) throw new Error("Demasiadas ausencias; no es seguro continuar sin paginar");
  const ausenciasPorDia = new Map();
  for (const a of ausencias) {
    const fecha = a.get("fechaLaboral");
    if (!ausenciasPorDia.has(fecha)) ausenciasPorDia.set(fecha, new Set());
    ausenciasPorDia.get(fecha).add(a.get("empleadoId"));
  }

  const qm = new cliente.Query("TimeEntries");
  const primerDia = new Date(desde + "T00:00:00Z").getTime();
  const ultimoDia = new Date(hasta + "T00:00:00Z").getTime();
  qm.greaterThanOrEqualTo("fecha", new Date(primerDia - 86400000));
  qm.lessThan("fecha", new Date(ultimoDia + 172800000));
  qm.limit(1000);
  const marcas = await qm.find();
  if (marcas.length >= 1000) throw new Error("Demasiadas marcas históricas; no reconstruir sin paginación");

  const firsts = await Promise.all(empleados.map(e => primerDiaConFichaje(e, cliente)));
  const primerasMarcas = new Map(empleados.map((e, i) => [e.id, firsts[i]]));
  const resumen = {
    desde, hasta, modo: aplicar ? "aplicar" : "simulacion",
    empleados: empleados.length, laborables: laborables.length,
    diasConDatos: 0, diasSinDatos: 0, ausenciasRespetadas: 0,
    empleadosSinHistoriaAnterior: empleados.filter(e => !primerasMarcas.get(e.id)).length,
    casosFueraDePeriodoConocido: 0, faltantesDetectados: 0,
    creados: 0, entradasCreadas: 0, salidasCreadas: 0,
    fechasConFaltantes: [], porDia: {}
  };
  for (const fecha of laborables) {
    const plan = planificarRegistrosHistoricos({
      fecha, empleados, entradasExistentes: marcas,
      ausencias: ausenciasPorDia.get(fecha) || new Set(),
      primeraMarca: primerasMarcas
    });
    if (plan.omitidosSinDatos) { resumen.diasSinDatos++; continue; }
    resumen.diasConDatos++;
    resumen.ausenciasRespetadas += plan.ausentes;
    resumen.casosFueraDePeriodoConocido += plan.omitidosPreviosAlta;
    if (!plan.candidatos.length) continue;
    resumen.faltantesDetectados += plan.candidatos.length;
    resumen.fechasConFaltantes.push(fecha);
    const dia = { faltantes: plan.candidatos.length, creados: 0, entradas: 0, salidas: 0 };
    resumen.porDia[fecha] = dia;
    if (aplicar) {
      for (const candidato of plan.candidatos) {
        const empleado = candidato.empleado;
        const registro = new (cliente.Object.extend("TimeEntries"))();
        registro.set("claveAutomatica", candidato.clave);
        registro.set("empleadoId", empleado.id);
        registro.set("nombre", empleado.get("nombre") || "Sin nombre");
        if (empleado.get("dni")) registro.set("dni", empleado.get("dni"));
        const numeros = variantesNumero(empleado);
        if (numeros.length) registro.set("numero", numeros[0]);
        if (empleado.get("empresa")) registro.set("empresa", empleado.get("empresa"));
        registro.set("accion", candidato.accion);
        registro.set("fecha", candidato.hora);
        registro.set("fechaLaboral", fecha);
        registro.set("origen", ORIGEN_HISTORICO);
        registro.set("estado", "RECONSTRUCCION_HISTORICA_PENDIENTE_VERIFICACION");
        registro.set("provisional", true);
        registro.set("pendienteVerificacion", true);
        registro.set("sinGPS", true);
        registro.set("horaProgramada", candidato.accion === "ENTRADA" ? HORARIO.entrada : HORARIO.salida);
        registro.set("variacionAleatoriaMinutos", candidato.variacion);
        registro.set("registradoEn", new Date());
        registro.set("margenAleatorioMinutos", 5);
        registro.set("horaReferenciaSinVerificar", true);
        registro.set("observacion", "REGISTRO RETROSPECTIVO de horario teórico: NO acredita presencia, horas trabajadas ni fichaje GPS.");
        await registro.save();
        // Evitar duplicados durante esta ejecución y conservar los anteriores.
        marcas.push(registro);
        resumen.creados++;
        dia.creados++;
        if (candidato.accion === "ENTRADA") { resumen.entradasCreadas++; dia.entradas++; }
        else { resumen.salidasCreadas++; dia.salidas++; }
      }
    }
  }
  return resumen;
}
