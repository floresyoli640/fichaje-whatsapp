const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const fs = require("fs");

// === Función principal ===
async function iniciarBot() {
  // Cargar o crear carpeta de sesión
  const { state, saveCreds } = await useMultiFileAuthState("./baileys_auth");

  const sock = makeWASocket({
    printQRInTerminal: true, // Mostrar QR en Railway logs
    auth: state,
    syncFullHistory: false,
  });

  // Guardar credenciales cuando cambien
  sock.ev.on("creds.update", saveCreds);

  // Log de conexión
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("⚠️ Escanea este QR para conectar:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Bot conectado correctamente a WhatsApp");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ Conexión cerrada. Motivo:", reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log("⚠️ Sesión cerrada. Debes escanear un nuevo QR.");
        fs.rmSync("./baileys_auth", { recursive: true, force: true });
      }

      console.log("🔄 Reconectando...");
      iniciarBot();
    }
  });

  // === Listener de mensajes entrantes ===
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || !msg.key.remoteJid) return;

    const from = msg.key.remoteJid;
    const texto = msg.message.conversation || msg.message.extendedTextMessage?.text;

    console.log(`📩 Mensaje recibido de ${from}: ${texto}`);

    if (texto?.toLowerCase() === "hola") {
      await sock.sendMessage(from, { text: "¡Hola! Soy tu bot." });
    }
  });
}

iniciarBot();




