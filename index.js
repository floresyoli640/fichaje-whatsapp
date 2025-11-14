// ===============================
//   CONFIG PARSE / BACK4APP
// ===============================
import Parse from "parse/node.js";
Parse.initialize("Yo7aFmDqSDkWaUhdG4INURZzRQ0qIYNJohfBFajJ", "Sqmmtd0qegDYFAEyPW0phkHYw3aMFlAMCKDrEiQP");
Parse.serverURL = "https://parseapi.back4app.com/";


// ===============================
//   IMPORTS WHATSAPP / BAILEYS
// ===============================
import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";


// ===============================
//   SERVIDOR EXPRESS PARA EL QR
// ===============================
const app = express();
const PORT = process.env.PORT || 8080;

let ultimoQR = null;

app.get("/", (req, res) => {
  res.send("Servidor funcionando. Ve a /qr para escanear el código.");
});

app.get("/qr", async (req, res) => {
  if (!ultimoQR) return res.send("QR aún no generado o ya conectado.");
  const qrImage = await QRCode.toDataURL(ultimoQR);
  res.send(`<html><body style="text-align:center;"><h2>Escanea el QR</h2><img src="${qrImage}" style="width:300px;"></body></html>`);
});

app.listen(PORT, () => console.log(`📡 Servidor Express en puerto ${PORT}`));


// ===============================
//   BASE DE DATOS
// ===============================
async function buscarEmpleadoPorNumero(numero) {
  const Employees = Parse.Object.extend("Employees");
  const query = new Parse.Query(Employees);
  query.equalTo("telefono", numero);
  query.include("empresa");
  return await query.first();
}

async function guardarFichajeEnBack4app({ nombre, dni, numero, empresa, accion, latitud, longitud }) {
  const TimeEntry = Parse.Object.extend("TimeEntries");
  const entry = new TimeEntry();
  entry.set("nombre", nombre);
  entry.set("dni", dni);
  entry.set("numero", numero);
  entry.set("accion", accion);
  entry.set("fecha", new Date());

  if (empresa && typeof empresa.get === 'function') {
    entry.set("empresa", empresa);
  }

  if (latitud && longitud) {
    entry.set("ubicacion", new Parse.GeoPoint({ latitude: latitud, longitude: longitud }));
  }

  try {
    await entry.save();
    console.log("✔ Fichaje guardado en Back4app");
  } catch (e) {
    console.error("❌ Error guardando fichaje:", e);
  }
}


// ===============================
//   BOT DE WHATSAPP
// ===============================
const esperandoUbicacion = new Map();

function obtenerTexto(msg) {
  if (!msg.message) return "";
  if (msg.message.conversation) return msg.message.conversation;
  if (msg.message.extendedTextMessage) return msg.message.extendedTextMessage.text;
  if (msg.message.buttonsResponseMessage) return msg.message.buttonsResponseMessage.selectedDisplayText;
  if (msg.message.listResponseMessage) return msg.message.listResponseMessage.title;
  return "";
}

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_data");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ["FichajeBot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      ultimoQR = qr;
      console.log("📲 Nuevo QR generado para vincular WhatsApp");
    }

    if (connection === "open") {
      console.log("✅ Conexión a WhatsApp establecida");
      ultimoQR = null;
    }

    if (connection === "close") {
      const errorCode = lastDisconnect?.error?.output?.statusCode;
      const debeReconectar = errorCode !== DisconnectReason.loggedOut;
      console.log(`❌ Desconectado. Código: ${errorCode}. Reconectar: ${debeReconectar}`);
      if (debeReconectar) iniciarBot();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const numero = msg.key.remoteJid.replace("@s.whatsapp.net", "");
    const texto = obtenerTexto(msg).trim().toUpperCase();

    console.log(`📩 Mensaje de ${numero}: ${texto}`);

    // Fichaje: ubicación
    if (esperandoUbicacion.has(numero) && msg.message.locationMessage) {
      const { accion, empleado } = esperandoUbicacion.get(numero);
      esperandoUbicacion.delete(numero);

      const nombre = empleado.get("nombre") || "-";
      const dni = empleado.get("dni") || "-";
      const empresa = empleado.get("empresa");
      const lat = msg.message.locationMessage.degreesLatitude;
      const lon = msg.message.locationMessage.degreesLongitude;

      await guardarFichajeEnBack4app({ nombre, dni, numero, empresa, accion, latitud: lat, longitud: lon });

      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ Fichaje de ${accion} registrado para ${nombre} a las ${new Date().toLocaleTimeString()}.`
      });
      return;
    }

    // Fichaje: ENTRADA/SALIDA
    if (texto === "ENTRADA" || texto === "SALIDA") {
      const empleado = await buscarEmpleadoPorNumero(numero);
      if (!empleado) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "❌ Tu número no está autorizado para fichar. Consulta al administrador."
        });
        return;
      }

      esperandoUbicacion.set(numero, { accion: texto, empleado });

      await sock.sendMessage(msg.key.remoteJid, {
        text: "📍 Por favor, comparte tu ubicación para registrar el fichaje. (Usa el icono de clip y selecciona 'Ubicación')."
      });
      return;
    }

    // Aún esperando ubicación
    if (esperandoUbicacion.has(numero)) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: "⚠️ Aún estoy esperando tu ubicación para completar el fichaje."
      });
      return;
    }

    // Respuesta genérica
    await sock.sendMessage(msg.key.remoteJid, {
      text: 'Envía *ENTRADA* o *SALIDA* para fichar.'
    });
  });
}

iniciarBot();
