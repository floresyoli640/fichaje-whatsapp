// Ajuste único de las 4 ENTRADAS programadas de 30-10-2026 que se guardaron a las 08:00.
// Solo modifica referencias PROVISIONALES: nunca marcas reales, coordenadas ni auditoría original.
import Parse from "parse/node.js";
import { fechaHoraMadrid, variacionMinutos, ORIGEN_AUTOMATICO } from "./fichajes-automaticos.js";
import { fechaLocal } from "./jornadas-admin.js";

export const FECHA_AJUSTE = "2026-10-30";
const NOMBRES = [
  "MARIA YOLANDA FLORES FRIAS",
  "JOSE MANUEL MORENO GARRIDO",
  "MARIA DE LA O ENRIQUETA CHICHARRO LOPEZ",
  "ALCAZAR MARIN RUIZ"
];

function nombreComparable(nombre) {
  return String(nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

export function planificarAjusteEntradas(registros) {
  const seleccionadas = new Map();
  const fechaBase = fechaHoraMadrid(FECHA_AJUSTE, "08:00");
  for (const r of registros) {
    const nombre = nombreComparable(r.get("nombre"));
    if (!NOMBRES.includes(nombre)) continue;
    if (seleccionadas.has(nombre)) throw new Error("Duplicada la marca automática de " + nombre);
    if (r.get("accion") !== "ENTRADA" ||
        r.get("origen") !== ORIGEN_AUTOMATICO ||
        r.get("provisional") !== true ||
        r.get("sinGPS") !== true ||
        r.get("ubicacion") != null ||
        r.get("estado") !== "AUTOMATICO_PENDIENTE_VERIFICACION") {
      throw new Error("La entrada no cumple las garantías de registro automático provisional: " + nombre);
    }
    const anterior = r.get("fecha");
    if (!(anterior instanceof Date) || fechaLocal(anterior) !== FECHA_AJUSTE) {
      throw new Error("La fecha del registro no corresponde al día solicitado: " + nombre);
    }
    if (Math.abs(anterior.getTime() - fechaBase.getTime()) > 5 * 60000) {
      throw new Error("La entrada está fuera del intervalo programado: " + nombre);
    }
    const id = r.get("empleadoId");
    if (!id) throw new Error("No se puede asociar la entrada a un empleado: " + nombre);
    // La petición es ajustar las cuatro marcas a las 08:00.
    // Si el desfase calculado da cero, escoger +1 minuto solo en esta migración.
    const elegido = variacionMinutos(id, FECHA_AJUSTE, "ENTRADA");
    const minutos = elegido === 0 ? 1 : elegido;
    const destino = new Date(fechaBase.getTime() + minutos * 60000);
    seleccionadas.set(nombre, {
      registro: r, nombre,
      anterior, destino,
      cambiar: anterior.getTime() === fechaBase.getTime()
    });
  }
  const noEncontradas = NOMBRES.filter(n => !seleccionadas.has(n));
  if (noEncontradas.length) throw new Error(
    "Se aborta el ajuste: no se encontraron las cuatro entradas provisionales; faltan " + noEncontradas.join(", ")
  );
  return NOMBRES.map(n => seleccionadas.get(n));
}

function horaMadrid(fecha) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(fecha);
}

export async function ajustarEntradasProvisionales30Oct({
  aplicar = false, cliente = Parse
} = {}) {
  const q = new cliente.Query("TimeEntries");
  q.equalTo("accion", "ENTRADA");
  q.equalTo("origen", ORIGEN_AUTOMATICO);
  q.equalTo("fechaLaboral", FECHA_AJUSTE);
  q.limit(100);
  const registros = await q.find();
  if (registros.length >= 100) throw new Error("Demasiados registros; abortar sin modificar datos");
  const plan = planificarAjusteEntradas(registros);

  const resultado = {
    fecha: FECHA_AJUSTE, modo: aplicar ? "aplicar" : "simulacion",
    encontrados: plan.length, modificados: 0, sinCambios: 0,
    marcas: plan.map(p => ({ nombre: p.nombre, antes: horaMadrid(p.anterior),
      objetivo: horaMadrid(p.destino), requiereCambio: p.cambiar }))
  };

  if (aplicar) {
    for (const p of plan) {
      if (!p.cambiar) { resultado.sinCambios++; continue; }
      // Se modifica solo la referencia horaria. createdAt y registradoEn
      // conservan cuándo fue creado realmente el asiento.
      p.registro.set("fecha", p.destino);
      p.registro.set("observacion",
        "AJUSTE POSTERIOR de referencia automática provisional (30/10/2026): " +
        "08:00 -> " + horaMadrid(p.destino) +
        ". NO es entrada presencial comprobada ni fichaje GPS. " +
        "Fecha de creación original conservada en createdAt/registradoEn.");
      await p.registro.save();
      resultado.modificados++;
    }
  }
  return resultado;
}
