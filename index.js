// ===============================
//   CONFIG PARSE / BACK4APP
// ===============================
import Parse from "parse/node.js";
Parse.initialize(
  "Yo7aFmDqSDkWaUhdG4INURZzRQ0qIYNJohfBFajJ",
  "Sqmmtd0qegDYFAEyPW0phkHYw3aMFlAMCKDrEiQP"
);
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
  res.send("Servidor funcionando. Ve a /qr para ver el QR.");
});

app.get("/qr", async (req, res) => {
  if (!ultimoQR) {
    return res.send("QR aún no generado o ya conectado. Recarga en 3 segundos.");
  }

  try {
    const qrImage = await QRCode.toDataURL(ultimoQR);
    res.send(`
      <html><body style="text-align:center;">
        <h2>Escanea el QR</h2>
        <img src="${qrImage}" style="width:300px;">
      </body></html>
    `);
  } catch (err) {
    res.send("Error generando QR");
  }
});

app.listen(PORT, () =>
  console.log(`📡 Servidor Express en puerto ${PORT}`)
);


// ===============================
//   BASE DE DATOS: BUSCAR EMPLEADO
// ===============================
async function buscarEmpleadoPorNumero(numero) {
  const Employees = Parse.Object.extend("Employees");
  const query = new Parse.Query(Employees);
  query.equalTo("telefono", numero);
  query.include("empresa");
  return await query.first();
}


// ===============================
//  GUARDAR FICHAJE EN BACK4APP
// ===============================
async function guardarFichajeEnBack4app({ nombre, dni, numero, empresa, accion, latitud, longitud }) {
  const TimeEntry = Parse.Object.extend("TimeEntries");
  const entry = new TimeEntry();

  entry.set("nombre", nombre);
  entry.set("dni", dni);
  entry.set("numero", numero);
  entry.set("accion", accion);
  entry.set("fecha", new Date());

  if (empresa && typeof empresa.get === "function") {
    entry.set("empresa", empresa);
  }

  if (latitud !== undefined && longitud !== undefined) {
    const point = new Parse.GeoPoint({ latitude: latitud, longitude: longitud });
    entry.set("ubicacion", point);
  }

  try {
    await entry.save();
    console.log("✔ Fichaje guardado en Back4app");
  } catch (error) {
    console.log("❌ Error guardando en Back4app:", error);
  }
}


// ===============================
//   MANEJO DE MENSAJES WHATSAPP
// ===============================
const esperandoUbicacion = new Map();

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_data");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ["FichajeBot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // ============= QR Y ESTADO DE CONEXIÓN =============
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

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
      const motivo = lastDisconnect?.error?.message || "Desconocido";
      console.log(`❌ Conexión cerrada (${motivo}) - Código: ${errorCode}`);

      const debeReconectar = errorCode !== DisconnectReason.loggedOut;
      if (debeReconectar) {
        console.log("🔄 Intentando reconectar...");
        iniciarBot();
      } else {
        console.log("🛑 Usuario deslogueado. Escanea el QR nuevamente.");
      }
    }
  });

  // ============= MENSAJES =============
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const numero = msg.key.remoteJid.replace("@s.whatsapp.net", "");
    const texto = msg.message.conversation
      ? msg.message.conversation.trim().toUpperCase()
      : "";

    if (esperandoUbicacion.has(numero) && msg.message.locationMessage) {
      const info = esperandoUbicacion.get(numero);
      esperandoUbicacion.delete(numero);

      const lat = msg.message.locationMessage.degreesLatitude;
      const lon = msg.message.locationMessage.degreesLongitude;

      await guardarFichajeEnBack4app({
        nombre: info.empleado.get("nombre"),
        dni: info.empleado.get("dni"),
        numero,
        empresa: info.empleado.get("empresa"),
        accion: info.accion,
        latitud: lat,
        longitud: lon
      });

      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ Fichaje de ${info.accion} registrado correctamente a las ${new Date().toLocaleTimeString()}.`
      });

      return;
    }

    if (texto === "ENTRADA" || texto === "SALIDA") {
      const empleado = await buscarEmpleadoPorNumero(numero);

      if (!empleado) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "❌ Tu número no está autorizado para fichar."
        });
        return;
      }

      esperandoUbicacion.set(numero, { accion: texto, empleado });

      await sock.sendMessage(msg.key.remoteJid, {
        text: "📍 Envía tu ubicación para completar el fichaje."
      });

      return;
    }

    if (esperandoUbicacion.has(numero)) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: "⚠️ Aún espero tu ubicación."
      });
      return;
    }

    await sock.sendMessage(msg.key.remoteJid, {
      text: 'Envía *ENTRADA* o *SALIDA* para fichar.'
    });
  });
}

iniciarBot();

