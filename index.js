const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const P = require("pino");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');

    const sock = makeWASocket({
        printQRInTerminal: false, // <- NO MOSTRAR QR EN LOG
        auth: state,
        logger: P({ level: "silent" })
    });

    // Cuando Baileys genera el QR
    sock.ev.on("connection.update", async (update) => {
        const { qr, connection, lastDisconnect } = update;

        if (qr) {
            console.log("⚠️ Nuevo QR generado, abre este enlace para escanear:");
            
            const qrURL = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qr)}`;
            
            console.log("👉 QR URL: " + qrURL);
            console.log("\n(Ábrelo y escanéalo con tu móvil)");
        }

        if (connection === "open") {
            console.log("✅ Bot conectado correctamente a WhatsApp");
        }

        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("❌ Conexión cerrada");
            if (shouldReconnect) {
                console.log("⏳ Reintentando conexión...");
                startBot();
            } else {
                console.log("⚠️ Debes escanear un nuevo QR");
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);
}

startBot();
