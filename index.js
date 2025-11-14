// -------------------------------
//  CONFIGURACIÓN BACK4APP
// -------------------------------
const Parse = require("parse/node");
Parse.initialize(
  "Yo7aFmDqSDkWaUhdG4INURZzRQ0qIYNJohfBFajJ",
  "Sqmmtd0qegDYFAEyPW0phkHYw3aMFlAMCKDrEiQP"
);
Parse.serverURL = "https://parseapi.back4app.com/";

// -------------------------------
//  WHATSAPP (BAILEYS QR)
// -------------------------------
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason
} = require("@whiskeysockets/baileys");

let QR_GENERATED = ""; // se guarda el último QR recibido

// -------------------------------
//  EXPRESS PARA MOSTRAR EL QR
// -------------------------------
const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("Servidor funcionando. Ve a /qr para ver el código QR.");
});

app.get("/qr", (req, res) => {
  if (!QR_GENERATED) {
    return res.send("Esperando QR... recarga en unos segundos.");
  }

  res.send(`
    <html>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
          QR_GENERATED
        )}" />
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log("📡 Servidor Express en puerto " + PORT);
});

// -------------------------------
//  INICIAR WHATSAPP
// -------------------------------
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./baileys_auth");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: Browsers.chrome("YolandaBot")
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      QR_GENERATED = qr;
      console.log("📲 Nuevo QR generado (también visible en /qr)");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        console.log("❌ Sesión cerrada. Necesario volver a escanear el QR.");
        iniciarBot();
      } else {
        console.log("⚠️ Reconectando...");
        iniciarBot();
      }
    } else if (connection === "open") {
      console.log("✅ WhatsApp conectado y listo");
    }
  });

  // -------------------------------
  // MANEJO DE MENSAJES
  // -------------------------------
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || !msg.key.remoteJid.endsWith("@s.whatsapp.net")) return;

    const numero = msg.key.remoteJid.replace("@s.whatsapp.net", "");
    const texto = msg.message.conversation
      ? msg.message.conversation.trim().toUpperCase()
      : "";

    console.log("Mensaje recibido:", texto, "de", numero);

    // Ubicación
    if (waitingForLocation.has(numero) && msg.message.locationMessage) {
      const { accion, empleado } = waitingForLocation.get(numero);
      waitingForLocation.delete(numero);

      const nombre = empleado.get("nombre") || "-";
      const dni = empleado.get("dni") || "-";
      const empresa = empleado.get("empresa");

      const { degreesLatitude, degreesLongitude } =
        msg.message.locationMessage;

      await guardarFichaje({
        nombre,
        dni,
        numero,
        empresa,
        accion,
        latitud: degreesLatitude,
        longitud: degreesLongitude
      });

      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ Fichaje de *${accion}* registrado correctamente.\n📍 Gracias por enviar tu ubicación.`
      });

      return;
    }

    // Comandos ENTRADA / SALIDA
    if (texto === "ENTRADA" || texto === "SALIDA") {
      const empleado = await buscarEmpleado(numero);

      if (!empleado) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "❌ Tu número no está autorizado para fichar."
        });
        return;
      }

      waitingForLocation.set(numero, { accion: texto, empleado });

      await sock.sendMessage(msg.key.remoteJid, {
        text: "📍 Por favor, envía tu *ubicación actual* para completar el fichaje."
      });

      return;
    }

    // Si se manda algo mientras se espera ubicación
    if (waitingForLocation.has(numero)) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: "⚠️ Aún estoy esperando tu ubicación. Envíala desde el icono del clip."
      });
      return;
    }

    // Mensaje genérico
    await sock.sendMessage(msg.key.remoteJid, {
      text: 'Envía *"ENTRADA"* o *"SALIDA"* para fichar.'
    });
  });
}

// -------------------------------
//  LÓGICA BACK4APP
// -------------------------------
const waitingForLocation = new Map();

async function buscarEmpleado(numero) {
  const Employees = Parse.Object.extend("Employees");
  const query = new Parse.Query(Employees);
  query.equalTo("telefono", numero);
  query.include("empresa");
  return await query.first();
}

async function guardarFichaje({
  nombre,
  dni,
  numero,
  empresa,
  accion,
  latitud,
  longitud
}) {
  const TimeEntry = Parse.Object.extend("TimeEntries");
  const entry = new TimeEntry();

  entry.set("nombre", nombre);
  entry.set("dni", dni);
  entry.set("numero", numero);
  entry.set("accion", accion);
  entry.set("fecha", new Date());

  if (empresa) entry.set("empresa", empresa);

  const point = new Parse.GeoPoint({
    latitude: latitud,
    longitude: longitud
  });

  entry.set("ubicacion", point);

  try {
    await entry.save();
    console.log("💾 Fichaje guardado en Back4App");
  } catch (e) {
    console.log("❌ Error guardando en Back4App:", e);
  }
}

// -------------------------------
//  INICIAR TODO
// -------------------------------
iniciarBot();


