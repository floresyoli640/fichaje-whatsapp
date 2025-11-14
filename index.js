import pkg from '@whiskeysockets/baileys';
const { default: WAConnection, useMultiFileAuthState, makeInMemoryStore, Browsers } = pkg;

import fs from 'fs';
import { generatePDF } from './generarInformePDF.js';

async function iniciarBot() {
    console.log("🚀 Iniciando bot...");

    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
    const store = makeInMemoryStore({});

    const sock = WAConnection({
        auth: state,
        printQRInTerminal: true,
        browser: Browsers.ubuntu("Chrome"),
    });

    store.bind(sock.ev);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (msg) => {
        const m = msg.messages[0];
        if (!m.message) return;

        const texto = m.message.conversation || "";

        if (texto === "!pdf") {
            const pdf = await generatePDF();
            await sock.sendMessage(m.key.remoteJid, { document: { url: pdf }, mimetype: "application/pdf", fileName: "informe_fichajes.pdf" });
        }

        if (texto.startsWith("!fichar")) {
            const empleado = texto.replace("!fichar ", "").trim();

            const registro = {
                empleado,
                hora: new Date().toLocaleString("es-ES")
            };

            const datos = JSON.parse(fs.readFileSync("fichajes.json", "utf8"));
            datos.push(registro);
            fs.writeFileSync("fichajes.json", JSON.stringify(datos, null, 2));

            await sock.sendMessage(m.key.remoteJid, { text: `Fichaje registrado para ${empleado}` });
        }
    });
}

iniciarBot();
