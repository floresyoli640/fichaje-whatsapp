// Menú interactivo de administración: 4 acciones en bloques de hasta 3 botones.
// Baileys utiliza WhatsApp Web (no la API oficial); el cliente puede no mostrar botones.
import { generateWAMessageFromContent, proto } from "@whiskeysockets/baileys";

export const OPCIONES_ADMIN = Object.freeze([
  { id: "adm_resumen", comando: "RESUMEN", etiqueta: "📋 Resumen" },
  { id: "adm_confirmar", comando: "CONFIRMAR TODOS", etiqueta: "✅ Confirmar todos" },
  { id: "adm_detalle", comando: "DETALLE", etiqueta: "📄 Detalle" },
  { id: "adm_verificar", comando: "VERIFICAR BD", etiqueta: "🔎 Verificar BD" }
]);

export const TEXTO_MENU_ADMIN = [
  "📱 *Menú de administración*",
  "1️⃣ RESUMEN — cifras del día",
  "2️⃣ CONFIRMAR TODOS — aprobar jornadas",
  "3️⃣ DETALLE — horarios por trabajador",
  "4️⃣ VERIFICAR BD — comprobar registros guardados",
  "",
  "Pulsa un botón o responde con 1, 2, 3 o 4.",
  "Si los botones no aparecen, los comandos por escrito siguen funcionando."
].join("\n");

function desenvuelve(mensaje) {
  if (!mensaje) return null;
  for (const contenedor of [
    "ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2",
    "viewOnceMessageV2Extension", "documentWithCaptionMessage"
  ]) {
    if (mensaje[contenedor]?.message) return desenvuelve(mensaje[contenedor].message);
  }
  return mensaje;
}

export function interpretarSeleccionAdmin(mensaje) {
  const m = desenvuelve(mensaje);
  if (!m) return null;
  let id = m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null;
  const json = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (!id && typeof json === "string") {
    try {
      const datos = JSON.parse(json);
      id = datos.id || datos.selectedId || datos.selected_id || datos.button_id || null;
    } catch {
      return null;
    }
  }
  return OPCIONES_ADMIN.find(x => x.id === id)?.comando || null;
}

export function interpretarNumeroAdmin(texto) {
  const normalizado = String(texto || "").trim();
  const indices = { "1": "RESUMEN", "2": "CONFIRMAR TODOS", "3": "DETALLE", "4": "VERIFICAR BD" };
  return indices[normalizado] || null;
}

// Una única burbuja de WhatsApp muestra, como máximo, tres botones rápidos fiables.
// La cuarta acción se envía como segundo bloque de un botón.
export function construirMensajeBotonesAdmin(opciones = OPCIONES_ADMIN.slice(0, 3)) {
  if (!Array.isArray(opciones) || !opciones.length || opciones.length > 3) {
    throw new Error("Cada mensaje permite entre uno y tres botones rápidos");
  }
  return {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          header: { title: "Control de fichajes", hasMediaAttachment: false },
          body: { text: "Selecciona una opción de administración:" },
          footer: { text: "Solo administración · Los fichajes automáticos son provisionales" },
          nativeFlowMessage: {
            buttons: opciones.map(opcion => ({
              name: "quick_reply",
              buttonParamsJson: JSON.stringify({
                display_text: opcion.etiqueta,
                id: opcion.id
              })
            }))
          }
        })
      }
    }
  };
}

export function nodosBotonesAdmin() {
  return [
    {
      tag: "biz",
      attrs: {},
      content: [
        {
          tag: "interactive",
          attrs: { type: "native_flow", v: "1" },
          content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }]
        }
      ]
    },
    { tag: "bot", attrs: { biz_bot: "1" } }
  ];
}

// Enviar primero la alternativa de texto para que el admin siempre tenga los
// comandos si su WhatsApp (especialmente iOS) ignora los botones nativos.
export async function enviarMenuAdmin(sock, jid) {
  if (!sock || !jid?.endsWith("@s.whatsapp.net") && !jid?.endsWith("@lid")) {
    throw new Error("WhatsApp o chat de administración no disponible");
  }
  await sock.sendMessage(jid, { text: TEXTO_MENU_ADMIN });
  try {
    if (!sock.user?.id || typeof sock.relayMessage !== "function") {
      throw new Error("Baileys no dispone de envío de mensajes interactivos");
    }
    for (let desde = 0; desde < OPCIONES_ADMIN.length; desde += 3) {
      const generado = generateWAMessageFromContent(
        jid,
        construirMensajeBotonesAdmin(OPCIONES_ADMIN.slice(desde, desde + 3)),
        { userJid: sock.user.id }
      );
      await sock.relayMessage(jid, generado.message, {
        messageId: generado.key.id,
        additionalNodes: nodosBotonesAdmin()
      });
    }
    console.log("✅ Menú de cuatro acciones enviado a administración en dos bloques (renderizado dependiente del móvil)");
    return { enviado: true, fallbackTexto: true };
  } catch (error) {
    console.warn("⚠️ Botones nativos no disponibles; menú de texto enviado:", error?.message || error);
    return { enviado: false, fallbackTexto: true };
  }
}
