import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import Pino from "pino";
import fs from "fs";
import { generatePDF } from "./generarInformePDF.js";

async function iniciarBot() {
    console.log("🟢 Iniciando bot...");

    // Cargar o crear credenciales
    const { state, saveCreds } = await useMultiFileAuthState("./baileys_auth");

    const sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: Pino({ level: "silent" }) 
    });

    // Guardar sesión cuando cambie
    sock.ev.on("creds.update", saveCreds);

    // Manejar recepción de mensajes
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!texto) return;

        console.log("📩 Mensaje recibido:", texto);

        // Registrar fichaje
        if (texto.toLowerCase() === "fichar") {
            const hora = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
            const registro = { empleado: from, hora };

            let fichajes = [];

            if (fs.existsSync("fichajes.json")) {
                fichajes = JSON.parse(fs.readFileSync("fichajes.json", "utf8"));
            }

            fichajes.push(registro);
            fs.writeFileSync("fichajes.json", JSON.stringify(fichajes, null, 2));

            await sock.sendMessage(from, { text: "✅ Fichaje registrado a las " + hora });
        }

        // Ver fichajes
        if (texto.toLowerCase() === "ver fichajes") {
            if (!fs.existsSync("fichajes.json")) {
                await sock.sendMessage(from, { text: "⚠️ No hay fichajes registrados." });
                return;
            }

            const fichajes = JSON.parse(fs.readFileSync("fichajes.json", "utf8"));
            let mensaje = "📋 *Listado de fichajes:*\n\n";

            fichajes.forEach(f => {
                mensaje += `👤 ${f.empleado}\n⏰ ${f.hora}\n\n`;
            });

            await sock.sendMessage(from, { text: mensaje });
        }

        // Generar PDF
        if (texto.toLowerCase() === "generar informe") {
            if (!fs.existsSync("fichajes.json")) {
                await sock.sendMessage(from, { text: "⚠️ No hay fichajes para generar el informe." });
                return;
            }

            const pdfPath = await generatePDF();

            await sock.sendMessage(from, {
                document: fs.readFileSync(pdfPath),
                mimetype: "application/pdf",
                fileName: "informe_fichajes.pdf"
            });
        }
    });

    // Manejar desconexiones
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                console.log("🔄 Reconectando...");
                iniciarBot();
            } else {
                console.log("❌ Sesión cerrada. Escanea el QR nuevamente.");
            }
        } else if (connection === "open") {
            console.log("✅ Bot conectado a WhatsApp correctamente.");
        }
    });
}

iniciarBot();
