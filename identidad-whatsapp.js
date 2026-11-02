// Asociar un LID de WhatsApp a un teléfono solo mediante una respuesta verificada de USync.
// No aceptar teléfonos declarados por el remitente sin prueba de asociación.
export function jidTelefonico(valor) {
  const n = String(valor || "").split("@")[0].replace(/\D/g, "");
  if (n.length === 9) return `34${n}@s.whatsapp.net`;
  if (n.length >= 10 && n.length <= 15) return `${n}@s.whatsapp.net`;
  return null;
}

export async function construirMapaLIDs(sock, numeros, tamanoLote = 25) {
  const jids = [...new Set(numeros.map(jidTelefonico).filter(Boolean))];
  const permitidos = new Set(jids);
  const mapa = new Map();

  for (let i = 0; i < jids.length; i += tamanoLote) {
    const lote = jids.slice(i, i + tamanoLote);
    try {
      const resultados = await sock.onWhatsApp(...lote);
      for (const registro of resultados || []) {
        const pn = jidTelefonico(registro?.jid);
        const lid = registro?.lid;
        if (registro?.exists && pn && permitidos.has(pn) && /^\d+@lid$/.test(lid || "")) {
          mapa.set(lid, pn);
        }
      }
    } catch (error) {
      console.warn("⚠️ No se pudo consultar el lote de identidades WhatsApp:", error?.message || error);
    }
  }
  return mapa;
}
