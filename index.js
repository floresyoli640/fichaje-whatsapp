// 🔇 Quitar logs pesados de Baileys
process.env.LOG_LEVEL = 'error';

// ----------------------------
//   CONFIG BACK4APP
// ----------------------------
const Parse = require('parse/node');
Parse.initialize("Yo7aFmDqSDkWaUhdG4INURZzRQ0qIYNJohfBFajJ", "Sqmmtd0qegDYFAEyPW0phkHYw3aMFlAMCKDrEiQP");
Parse.serverURL = "https://parseapi.back4app.com/";


// ----------------------------
//   DEPENDENCIAS BAILEYS
// ----------------------------
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');


// ----------------------------
//   VARIABLES
// ----------------------------
const waitingForLocation = new Map();


// ----------------------------
//   FUNCIONES BACK4APP
// ----------------------------
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

  if (empresa && typeof empresa.get === "function") {
    entry.set("empresa", empresa);
  }

  if (latitud !== undefined && longitud !== undefined) {
    entry.set("ubicacion", new Parse.GeoPoint({ latitude: latitud, longitude: longitud }));
  }

  try {
    await entry.save();
  } catch (err) {
    console.error("❌ Error guardando en Back4App:", err);
  }
}


// ----------------------------
//   INICIAR BOT
// ----------------------------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // -----------------------------
  //   QR AL INICIAR
  // -----------------------------
  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) {
      console.log("📲 Escanea este QR para conectar el bot:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') console.log("✅ Bot conectado con Baileys.");
    if (connection === 'close') {
      console.log("⚠️ Conexión cerrada. Intentando reconectar…");
      setTimeout(startBot, 2000);
    }
  });


  // -----------------------------
  //   EVENTO MENSAJES
  // -----------------------------
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const numero = jid.split('@')[0];

    const body =
      msg.message.conversation ||
      msg.message?.extendedTextMessage?.text ||
      null;

    const location = msg.message.locationMessage || null;


    // -----------------------------
    //   RECIBIENDO UBICACIÓN
    // -----------------------------
    if (waitingForLocation.has(numero) && location) {
      const { accion, empleado } = waitingForLocation.get(numero);
      waitingForLocation.delete(numero);

      await guardarFichajeEnBack4app({
        nombre: empleado.get("nombre"),
        dni: empleado.get("dni"),
        numero,
        empresa: empleado.get("empresa"),
        accion,
        latitud: location.degreesLatitude,
        longitud: location.degreesLongitude,
      });

      return sock.sendMessage(jid, { text: "📍 Ubicación recibida.\n✔ Fichaje registrado correctamente." });
    }

    if (!body) return;

    const texto = body.trim().toUpperCase();


    // -----------------------------
    //   COMANDOS ENTRADA/SALIDA
    // -----------------------------
    if (["ENTRADA", "SALIDA"].includes(texto)) {
      const empleado = await buscarEmpleadoPorNumero(numero);

      if (!empleado) {
        return sock.sendMessage(jid, {
          text: "❌ No estás autorizado para fichar."
        });
      }

      waitingForLocation.set(numero, { accion: texto, empleado });

      return sock.sendMessage(jid, {
        text: "📍 Envíame tu ubicación para completar el fichaje."
      });
    }


    // -----------------------------
    //   ESPERANDO UBICACIÓN
    // -----------------------------
    if (waitingForLocation.has(numero)) {
      return sock.sendMessage(jid, {
        text: "⏳ Aún espero tu ubicación…\nToca el clip 📎 ➜ Ubicación ➜ Enviar."
      });
    }


    // -----------------------------
    //   MENSAJE POR DEFECTO
    // -----------------------------
    sock.sendMessage(jid, {
      text: "Hola 👋\nEnvía:\n• ENTRADA\n• SALIDA"
    });
  });
}

startBot();



