// ==========================
// 🔹 IMPORTACIONES
// ==========================
const Parse = require('parse/node');
const express = require('express');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useSingleFileAuthState,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

// ==========================
// 🔹 CONFIG BACK4APP
// ==========================
Parse.initialize(
    "Yo7aFmDqSDkWaUhdG4INURZzRQ0qIYNJohfBFajJ",
    "Sqmmtd0qegDYFAEyPW0phkHYw3aMFlAMCKDrEiQP"
);
Parse.serverURL = "https://parseapi.back4app.com/";

// ==========================
// 🔹 EXPRESS SERVER
// ==========================
const app = express();
let ultimoQR = null;
let conectado = false;

// Ruta QR
app.get('/qr', (req, res) => {
    if (!ultimoQR) {
        return res.send("<h2>QR aún no generado. Espera 3 segundos y recarga.</h2>");
    }

    // Mostrar QR en HTML
    const QRCode = require('qrcode');
    QRCode.toDataURL(ultimoQR, (err, url) => {
        if (err) return res.send("Error generando QR");

        res.send(`
            <html>
            <body style="text-align:center;font-family:sans-serif;">
                <h2>Escanea este QR para vincular WhatsApp</h2>
                <img src="${url}" style="width:320px;"/>
            </body>
            </html>
        `);
    });
});

// Mantener vivo
app.get('/keepalive', (req, res) => {
    res.send("OK");
});

// Puerto Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🌍 Servidor Express en puerto " + PORT));

// ==========================
// 🔹 AUTH de BAILEYS
// ==========================
const { state, saveState } = useSingleFileAuthState('./baileys_auth/session.json');

let sock;

// ==========================
// 🔹 Iniciar WhatsApp
// ==========================
async function iniciarBot() {
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state
    });

    // Guardar sesión
    sock.ev.on('creds.update', saveState);

    // ======================
    // 📌 EVENTO QR
    // ======================
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
            ultimoQR = qr;
            conectado = false;
            console.log("📲 Nuevo QR generado (cópialo en logs si lo necesitas):");
            console.log(qr);
        }

        if (connection === 'open') {
            conectado = true;
            console.log("✅ WhatsApp conectado correctamente");
        }

        if (connection === 'close') {
            console.log("❌ Conexión cerrada, reintentando...", update);
            setTimeout(() => iniciarBot(), 2000);
        }
    });

    // ======================
    // 📌 MENSAJE RECIBIDO
    // ======================
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid.endsWith("@s.whatsapp.net")) return;

        const numero = msg.key.remoteJid.replace("@s.whatsapp.net", "");
        let texto = "";

        // Extraer mensaje
        if (msg.message.conversation) {
            texto = msg.message.conversation;
        } else if (msg.message.extendedTextMessage) {
            texto = msg.message.extendedTextMessage.text;
        }

        texto = texto.trim().toUpperCase();

        console.log("📩 Mensaje recibido:", texto, "de", numero);

        // Ubicación
        if (waitingForLocation.has(numero) && msg.message.locationMessage) {
            const { accion, empleado } = waitingForLocation.get(numero);
            waitingForLocation.delete(numero);

            const lat = msg.message.locationMessage.degreesLatitude;
            const lon = msg.message.locationMessage.degreesLongitude;

            const nombre = empleado.get("nombre");
            const dni = empleado.get("dni");
            const empresa = empleado.get("empresa");

            await guardarFichaje({
                nombre,
                dni,
                numero,
                empresa,
                accion,
                latitud: lat,
                longitud: lon
            });

            sock.sendMessage(msg.key.remoteJid, {
                text: `✅ Fichaje de ${accion} registrado correctamente.\n📍 Ubicación guardada.`
            });

            return;
        }

        // Entrada o salida
        if (texto === "ENTRADA" || texto === "SALIDA") {
            const empleado = await buscarEmpleado(numero);

            if (!empleado) {
                sock.sendMessage(msg.key.remoteJid, { text: "❌ No estás autorizado para fichar." });
                return;
            }

            waitingForLocation.set(numero, { accion: texto, empleado });

            sock.sendMessage(msg.key.remoteJid, {
                text: "📍 Por favor, envía tu *ubicación actual* para completar el fichaje."
            });

            return;
        }

        // Otros mensajes
        sock.sendMessage(msg.key.remoteJid, {
            text: "Envía *ENTRADA* o *SALIDA* para fichar."
        });
    });
}

// ==========================
// 🔹 ESTADOS TEMPORALES
// ==========================
const waitingForLocation = new Map();

// ==========================
// 🔹 FUNCIONES BACK4APP
// ==========================
async function buscarEmpleado(telefono) {
    const Employees = Parse.Object.extend("Employees");
    const query = new Parse.Query(Employees);
    query.equalTo("telefono", telefono);
    query.include("empresa");

    return await query.first();
}

async function guardarFichaje({ nombre, dni, numero, empresa, accion, latitud, longitud }) {
    const TimeEntry = Parse.Object.extend("TimeEntries");
    const entry = new TimeEntry();

    entry.set("nombre", nombre);
    entry.set("dni", dni);
    entry.set("numero", numero);
    entry.set("accion", accion);
    entry.set("fecha", new Date());

    // Pointer empresa
    if (empresa) entry.set("empresa", empresa);

    // Ubicación
    if (latitud && longitud) {
        const point = new Parse.GeoPoint({ latitude: latitud, longitude: longitud });
        entry.set("ubicacion", point);
    }

    try {
        await entry.save();
        console.log("💾 Fichaje guardado en Back4App");
    } catch (err) {
        console.error("❌ Error guardando fichaje:", err);
    }
}

// ==========================
// 🔹 INICIAR BOT
// ==========================
iniciarBot();

