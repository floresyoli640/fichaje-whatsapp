import express from "express"
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys"
import qrcode from "qrcode-terminal"
import fs from "fs"
import path from "path"

const app = express()
const PORT = process.env.PORT || 3000

let ultimoQR = null

// ---------- SERVIDOR WEB PARA MOSTRAR QR ----------
app.get("/qr", (req, res) => {
    if (!ultimoQR) return res.send("QR aún no generado, espera 5 segundos y recarga.")

    res.send(`
        <html>
            <body style="display:flex;justify-content:center;align-items:center;flex-direction:column;font-family:sans-serif;">
                <h2>Escanea el QR para vincular el bot</h2>
                <img src="https://api.qrserver.com/v1/create-qr-code/?data=${ultimoQR}&size=300x300" />
            </body>
        </html>
    `)
})

app.listen(PORT, () => {
    console.log(`Servidor QR listo en puerto ${PORT}`)
})

// ---------- INICIAR BAILEYS ----------
async function iniciarBot() {
    console.log("Iniciando bot de WhatsApp...")

    const authPath = path.resolve("./baileys_auth")
    if (!fs.existsSync(authPath)) fs.mkdirSync(authPath)

    const { state, saveCreds } = await useMultiFileAuthState(authPath)

    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false
    })

    // Evento QR
    sock.ev.on("connection.update", (u) => {
        const { qr, connection } = u

        if (qr) {
            ultimoQR = qr
            console.log("Nuevo QR generado")
            qrcode.generate(qr, { small: true })
        }

        if (connection === "open") {
            console.log("Bot conectado correctamente ✔")
        }

        if (connection === "close") {
            console.log("Conexión cerrada. Intentando reconectar...")
            iniciarBot()
        }
    })

    sock.ev.on("creds.update", saveCreds)
}

iniciarBot()
