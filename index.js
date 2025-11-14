import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import P from "pino";
import express from "express";
import qrcode from "qrcode";

// Servidor Express para mostrar el QR como imagen
const app = express();
let qrImage = null; // Aquí guardamos el último QR generado

app.get("/qr", (req, res) => {
    if (!qrImage) {
        return res.send("QR aún no generado, espera 5 segundos y recarga.");
    }

    res.setHeader("Content-Type", "image/png");
    res.send(Buffer.from(qrImage.split(",")[1], "base64"));
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Servidor QR listo");
});

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./baileys_auth");

    const sock = makeWASocket({
        logger: P({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
    });

    sock.ev.on("creds.update", saveCreds);

    // Capturamos y convertimos el QR en PNG
    sock.ev.on("connection.update", async (update) => {
        const { qr } = update;
        if (qr) {
            console.log("📌 Nuevo QR generado. Puedes verlo en:");
            console.log("👉 https://TU-PROYECTO-RAILWAY.app/qr");

            // Generar PNG en Base64
            qrImage = await qrcode.toDataURL(qr);
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        console.log("Mensaje recibido:", msg.key.remoteJid);
    });
}

iniciarBot();
