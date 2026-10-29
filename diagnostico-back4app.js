// Verificación de registros realmente persistidos en Back4App.
// Solo consultas de lectura: nunca crea ni modifica fichajes o confirmaciones.
import Parse from "parse/node.js";
import { fechaLocal } from "./jornadas-admin.js";

export async function comprobarRegistrosBack4App(fecha = fechaLocal(), cliente = Parse) {
  const previstasQuery = new cliente.Query("JornadasPrevistas");
  previstasQuery.equalTo("fechaLaboral", fecha);
  previstasQuery.limit(1000);

  const confirmacionesQuery = new cliente.Query("ConfirmacionesJornada");
  confirmacionesQuery.equalTo("fechaLaboral", fecha);
  confirmacionesQuery.limit(1000);

  const marcasQuery = new cliente.Query("TimeEntries");
  const baseUtc = new Date(fecha + "T00:00:00Z").getTime();
  marcasQuery.greaterThanOrEqualTo("fecha", new Date(baseUtc - 86400000));
  marcasQuery.lessThan("fecha", new Date(baseUtc + 172800000));
  marcasQuery.limit(1000);

  const [previstas, confirmaciones, marcasBrutas] = await Promise.all([
    previstasQuery.find(), confirmacionesQuery.find(), marcasQuery.find()
  ]);

  const marcas = marcasBrutas.filter(m =>
    m.get("fecha") instanceof Date && fechaLocal(m.get("fecha")) === fecha
  );
  const unicos = new Set(confirmaciones.map(c => c.get("empleadoId")).filter(Boolean));
  const estados = confirmaciones.reduce((acumulado, registro) => {
    const estado = registro.get("estado") || "SIN_ESTADO";
    acumulado[estado] = (acumulado[estado] || 0) + 1;
    return acumulado;
  }, {});

  return {
    fecha,
    tablas: {
      JornadasPrevistas: previstas.length,
      ConfirmacionesJornada: confirmaciones.length,
      TimeEntries: marcas.length
    },
    empleadosConConfirmacion: unicos.size,
    estadosConfirmacion: estados,
    fichajesReales: {
      entradas: marcas.filter(m => m.get("accion") === "ENTRADA").length,
      salidas: marcas.filter(m => m.get("accion") === "SALIDA").length
    },
    // No representar las confirmaciones pendientes como fichajes realizados.
    aviso: "Las confirmaciones administrativas y las horas previstas no son marcas GPS."
  };
}
