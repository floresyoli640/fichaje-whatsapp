// Texto breve para la administración, sin confundir horas programadas con fichajes comunicados.
export function prepararEstadoResumen({ fecha, jornadas, ausentes = new Set(), confirmadas = new Set() }) {
  if (!fecha || !Array.isArray(jornadas)) throw new Error("Resumen sin fecha o jornadas");
  const filas = jornadas.map(j => ({
    id: j.id, nombre: j.nombre,
    ausente: ausentes.has(j.id),
    entrada: j.marcas?.entrada || null,
    salida: j.marcas?.salida || null,
    entradaAutomatica: Boolean(j.marcas?.entrada && j.marcas.entradaAutomatica),
    salidaAutomatica: Boolean(j.marcas?.salida && j.marcas.salidaAutomatica),
    confirmada: confirmadas.has(j.id)
  }));
  const activas = filas.filter(f => !f.ausente);
  const contar = predicado => activas.filter(predicado).length;
  return {
    fecha, filas,
    total: filas.length, ausentes: filas.length - activas.length, esperadas: activas.length,
    entradas: contar(f => Boolean(f.entrada)),
    entradasEnviadas: contar(f => Boolean(f.entrada) && !f.entradaAutomatica),
    entradasAutomaticas: contar(f => f.entradaAutomatica),
    salidas: contar(f => Boolean(f.salida)),
    salidasEnviadas: contar(f => Boolean(f.salida) && !f.salidaAutomatica),
    salidasAutomaticas: contar(f => f.salidaAutomatica),
    confirmadas: contar(f => f.confirmada)
  };
}

export function textoResumenCorto(datos) {
  const {
    fecha, total, ausentes, esperadas, entradas, entradasEnviadas, entradasAutomaticas,
    salidas, salidasEnviadas, salidasAutomaticas, confirmadas
  } = datos;
  return [
    `📋 *RESUMEN ${fecha}*`,
    `👥 Trabajadores: ${total} · Ausentes: ${ausentes}`,
    `🟢 Entradas: ${entradas}/${esperadas} (${entradasEnviadas} por WhatsApp · ${entradasAutomaticas} auto)`,
    `🔴 Salidas: ${salidas}/${esperadas} (${salidasEnviadas} por WhatsApp · ${salidasAutomaticas} auto)`,
    `✅ Aprobación admin: ${confirmadas}/${esperadas}`,
    "",
    "ℹ️ Auto = horario provisional, sin verificar.",
    "Para ver nombres: *DETALLE* · Para aprobar: *CONFIRMAR TODOS*"
  ].join("\n");
}

export function textoDetalleJornadas(datos, horaLocal) {
  const lineas = datos.filas.map(f => {
    if (f.ausente) return `• ${f.nombre}: AUSENTE`;
    const mostrar = (valor, auto) => !valor ? "—" :
      `${horaLocal(valor)} ${auto ? "(auto, sin verificar)" : "(WhatsApp)"}`;
    const aprobada = f.confirmada ? " ✅ Aprobada" : "";
    return `• ${f.nombre}: ${mostrar(f.entrada, f.entradaAutomatica)} / ${mostrar(f.salida, f.salidaAutomatica)}${aprobada}`;
  });
  return [
    `📄 *DETALLE ${datos.fecha}*`,
    "Entrada / salida",
    ...lineas,
    "",
    "Auto = horario provisional, no presencia verificada.",
    "Volver: *RESUMEN*"
  ].join("\n");
}
