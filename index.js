// -----------------------------
// IMPORTS
// -----------------------------
import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import Parse from "parse/node.js";

// -----------------------------
// BACK4APP CONFIG
// -----------------------------
Parse.initialize(
  "Yo7aFmDqSDkWaUhdG4INURZzRQ0qIYNJohfBFajJ", // Application ID
  "Sqmmtd0qegDYFAEyPW0phkHYw3aMFlAMCKDrEiQP"  // JavaScript key
);
Parse.serverURL = "https://parseapi.back4app.com/";

const Employees = Parse.Object.extend("Employees");
const TimeEntries = Parse.Object.extend("TimeEntries");
const Companies = Parse.Object.extend("Companies");

// ----------------------------------
// VARIABLES
// ----------------------------------
let sock = null;
let ultimoQR = null;
let conectado = false;
const waitingForLocation = new Map();

// ----------------------------------
// EXPRESS SERVER PARA MOSTRAR EL QR
// ----------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`
    <h2>Servidor funcionando correctamente</h2>
    <p>Ve a <a href="/qr">/qr</a> para escanear el código QR de WhatsApp.</p>
  `);
});

app.get("/qr", async (req, res) => {
  if (conectado) {
    return res.send("✅ WhatsApp ya está conectado.");
  }

  if (!ultimoQR) {
    return res.send("Q🕓 QR aún no generado. Recarga en 5 segundos.");
  }

  const dataURL = await qrcode.toDataURL(ultimoQR);
  res.send(`
    <html>
    <body style="text-align:center;font-family:sans-serif;">
      <h2>Escanea el QR con WhatsApp</h2>
      <img src="${dataURL}" width="300" />
    </body>
    </html>
  `);
});

app.listen(PORT, () => console.log("🌍 Servidor Express en puerto", PORT));

// ----------------------------------
// FUNCIONES BACK4APP
// ----------------------------------
async function buscarEmpleadoPorNumero(numero) {
  const query = new Parse.Query(Employees);
  query.equalTo("telefono", numero);
  query.include("empresa");
  return await query.first();
}

async function guardarFichaje({ nombre, dni, numero, empresa, accion, latitud, longitud }) {
  const entry = new TimeEntries();

  entry.set("nombre", nombre);
  entry.set("dni", dni);
  entry.set("numero", numero);
  entry.set("accion", accion);
  entry.set("fecha", new Date());

  // Pointer empresa
  if (empresa) {
    const empresaPointer = new Companies();
    empresaPointer.id = empresa.id;
    entry.set("empresa", empresaPointer);
  }

  // Geopoint
  if (latitud && longitud) {
    entry.set("ubicacion", new Parse.GeoPoint({ latitude: latitud, longitude: longitud }));
  }

  await entry.save();
}

// ----------------------------------
// INICIAR WHATSAPP BAILEYS
// ----------------------------------
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./baileys_auth");

  sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    browser: ["YolandaBot", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  // ----------------------
  // EVENTO: QR
  // ----------------------
  sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {

    if (qr) {
      ultimoQR = qr;
      conectado = false;
      console.log("📲 Nuevo QR listo.");
    }

    if (connection === "open") {
      conectado = true;
      ultimoQR = null;
      console.log("✅ WhatsApp conectado.");
    }

    if (connection === "close") {
      conectado = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Conexión cerrada:", code);

      if (code !== DisconnectReason.loggedOut) {
        console.log("🔁 Reintentando...");
        iniciarBot();
      }
    }
  });

  // ----------------------
  // EVENTO: MENSAJES
  // ----------------------
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const numero = msg.key.remoteJid.replace("@s.whatsapp.net", "");
    let texto = "";

    if (msg.message.conversation) texto = msg.message.conversation;
    if (msg.message.extendedTextMessage) texto = msg.message.extendedTextMessage.text;
    texto = texto.trim().toUpperCase();

    // -----------------------------------
    // RECIBIENDO UBICACIÓN
    // -----------------------------------
    if (msg.message.locationMessage && waitingForLocation.has(numero)) {
      const { accion, empleado } = waitingForLocation.get(numero);
      waitingForLocation.delete(numero);

      const nombre = empleado.get("nombre");
      const dni = empleado.get("dni");
      const empresa = empleado.get("empresa");

      const latitud = msg.message.locationMessage.degreesLatitude;
      const longitud = msg.message.locationMessage.degreesLongitude;

      await guardarFichaje({ nombre, dni, numero, empresa, accion, latitud, longitud });

      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ Fichaje de ${accion} registrado correctamente para ${nombre}.`
      });

      return;
    }

    // -----------------------------------
    // COMANDOS ENTRADA / SALIDA
    // -----------------------------------
    if (texto === "ENTRADA" || texto === "SALIDA") {
      const empleado = await buscarEmpleadoPorNumero(numero);

      if (!empleado) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "❌ Tu número no está autorizado para fichar."
        });
        return;
      }

      waitingForLocation.set(numero, { accion: texto, empleado });

      await sock.sendMessage(msg.key.remoteJid, {
        text: "📍 Por favor envía tu ubicación actual para registrar el fichaje."
      });

      return;
    }

    // -----------------------------------
    // Esperando ubicación y envía texto en vez de ubicación
    // -----------------------------------
    if (waitingForLocation.has(numero)) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: "⚠️ Falta tu ubicación. Por favor envíala usando el icono de clip."
      });
      return;
    }

    // -----------------------------------
    // Respuesta por defecto
    // -----------------------------------
    await sock.sendMessage(msg.key.remoteJid, {
      text: 'Envía "ENTRADA" o "SALIDA" para fichar.'
    });
  });
}

iniciarBot();
