// ===============================
//   CONFIG PARSE / BACK4APP
// ===============================
import Parse from "parse/node.js";

// ⚠️ Recomendado: mover estas claves a variables de entorno (process.env)
// (Dejo tu código tal cual para no romper nada)
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
//   EXPRESS PARA VER EL QR
// ===============================
const app = express();
const PORT = process.env.PORT || 3000;

let ultimoQR = null;

app.get("/", (req, res) => {
  res.send("Servidor funcionando. Ve a /qr para escanear el código.");
});

app.get("/qr", async (req, res) => {
  if (!ultimoQR) return res.send("QR aún no generado o ya conectado.");
  const qrImage = await QRCode.toDataURL(ultimoQR);
  res.send(`
    <html>
      <body style="text-align:center;">
        <h2>Escanea el QR</h2>
        <img src="${qrImage}" style="width:300px;">
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(`📡 Servidor Express en puerto ${PORT}`));

// ===============================
//   HELPERS PARA NÚMEROS
// ===============================
function normalizarNumero(num) {
  // Deja solo dígitos
  return (num || "").toString().replace(/[^\d]/g, "");
}

// ===============================
//   NUEVO: DETECTAR UBICACIÓN REENVIADA
// ===============================
function esUbicacionReenviada(msg) {
  const loc = msg?.message?.locationMessage;
  if (!loc) return false;

  const ctx = loc.contextInfo || {};

  // Marcadores típicos de "forward"
  if (ctx.isForwarded) return true;
  if (typeof ctx.forwardingScore === "number" && ctx.forwardingScore > 0) return true;

  // Si viene citada (a veces se usa para reenviar o “pasar” ubicación)
  if (ctx.quotedMessage) return true;

  return false;
}

// ===============================
//   BASE DE DATOS
// ===============================
async function buscarEmpleadoPorNumero(numeroRaw) {
  const Employees = Parse.Object.extend("Employees");

  const numLimpio = normalizarNumero(numeroRaw || "");
  const ultimos9 = numLimpio.slice(-9); // últimos 9 dígitos del número

  console.log(
    "🔎 Buscando empleado.",
    "numeroRaw =", numeroRaw,
    "numLimpio =", numLimpio,
    "ultimos9 =", ultimos9
  );

  // Detectamos si parece un teléfono español normal (34 + 9 dígitos)
  const esTelefonoEspanol =
    numLimpio.startsWith("34") && numLimpio.length >= 11 && numLimpio.length <= 13;

  let query = new Parse.Query(Employees);

  if (esTelefonoEspanol) {
    // Buscamos por teléfono (como antes, usando los últimos 9 dígitos por seguridad)
    query.contains("telefono", ultimos9);
  } else {
    // Si no parece un teléfono, asumimos que es un waId interno de WhatsApp
    // Necesitas tener una columna "waId" (String) en Employees para que esto funcione
    query.equalTo("waId", numLimpio);
  }

  query.include("empresa");

  const empleado = await query.first();

  if (!empleado) {
    console.log("❌ Ningún empleado encontrado para", numLimpio);
  } else {
    console.log(
      "✅ Empleado encontrado:",
      empleado.get("nombre"),
      "| teléfono BD =",
      empleado.get("telefono"),
      "| waId BD =",
      empleado.get("waId")
    );
  }

  return empleado;
}

async function guardarFichajeEnBack4app({
  nombre,
  dni,
  numero,
  empresa,
  accion,
  latitud,
  longitud,
}) {
  // 👇 IMPORTANTE: aquí va el nombre de la clase en Back4App
  const TimeEntries = Parse.Object.extend("TimeEntries");
  const entry = new TimeEntries();

  entry.set("nombre", nombre);
  entry.set("dni", dni);
  entry.set("numero", numero);
  entry.set("accion", accion);
  entry.set("fecha", new Date());

  if (empresa && typeof empresa.get === "function") {
    entry.set("empresa", empresa);
  }

  if (latitud && longitud) {
    entry.set(
      "ubicacion",
      new Parse.GeoPoint({ latitude: latitud, longitude: longitud })
    );
  }

  try {
    await entry.save();
    console.log("✔ Fichaje guardado en TimeEntries (Back4App)");
  } catch (e) {
    console.error("❌ Error guardando fichaje:", e);
  }
}

// ===============================
//   OBTENER TEXTO DEL MENSAJE
// ===============================
function obtenerTexto(msg) {
  const message = msg.message;

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage)
    return message.extendedTextMessage.text || "";
  if (message.imageMessage && message.imageMessage.caption)
    return message.imageMessage.caption;

  return "";
}

// ===============================
//   WHATSAPP BOT
// ===============================
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      ultimoQR = qr;
      console.log("⚠️ QR recibido. Ve a /qr para escanearlo.");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log(
        "❌ Conexión cerrada. ¿Reconectar?",
        shouldReconnect ? "Sí" : "No"
      );
      if (shouldReconnect) iniciarBot();
    } else if (connection === "open") {
      ultimoQR = null;
      console.log("✅ Conectado a WhatsApp");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // Mapa para almacenar quién ha pedido fichaje y está enviando ubicación
  const esperandoUbicacion = new Map();

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const rawJid = msg.key.remoteJid || "";
    const rawParticipant = msg.key.participant || "";

    console.log("🔍 JIDs -> remoteJid:", rawJid, "| participant:", rawParticipant);

    const baseId = rawParticipant || rawJid;
    const numero = normalizarNumero(baseId.split("@")[0]);
    console.log("📞 Identificador normalizado:", numero);

    const texto = obtenerTexto(msg).trim().toUpperCase();
    console.log(`📩 Mensaje de ${numero}: ${texto}`);

    // ===========================
    //  FICHAJE: UBICACIÓN
    // ===========================
    if (esperandoUbicacion.has(numero) && msg.message.locationMessage) {
      // ✅ MEJORA: NO ADMITIR UBICACIONES REENVIADAS
      if (esUbicacionReenviada(msg)) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "❌ Error. Intenta de nuevo."
        });
        return;
      }

      const { accion, empleado } = esperandoUbicacion.get(numero);
      esperandoUbicacion.delete(numero);

      const nombre = empleado.get("nombre") || "-";
      const dni = empleado.get("dni") || "-";
      const empresa = empleado.get("empresa");

      const latitud = msg.message.locationMessage.degreesLatitude;
      const longitud = msg.message.locationMessage.degreesLongitude;

      console.log(
        `📍 Ubicación recibida de ${nombre} (${numero}): lat=${latitud}, lon=${longitud}`
      );

      // 🧭 Punto de fichaje
      const puntoFichaje = new Parse.GeoPoint({
        latitude: latitud,
        longitude: longitud
      });

      // 🏢 Ubicación de la empresa (GeoPoint en campo "ubicacion")
      const ubicacionEmpresa = empresa?.get("ubicacion");

      if (ubicacionEmpresa instanceof Parse.GeoPoint) {
        const distanciaKm = ubicacionEmpresa.kilometersTo(puntoFichaje);
        const distanciaMetros = distanciaKm * 1000;

        console.log(
          `📏 Distancia al centro de trabajo: ${distanciaMetros.toFixed(2)} m`
        );

        if (distanciaMetros > 40) {
          // ❌ Fuera de radio permitido
          await sock.sendMessage(msg.key.remoteJid, {
            text:
              "🐦 Hay pájar@, no estás en la oficina 🤣.\n" +
              "Para fichar debes estar en la oficina 🔫😉"
          });
          return;
        }
      } else {
        console.log(
          "⚠️ La empresa no tiene 'ubicacion' (GeoPoint) configurada. Se admite fichaje igualmente."
        );
      }

      // 👉 Aquí decidimos qué guardar en TimeEntries.numero:
      //    - Si el empleado tiene 'telefono' en la BD, usamos eso (normalizado).
      //    - Si no, usamos el identificador normalizado (numero) como respaldo.
      const telefonoBD = empleado.get("telefono");
      const numeroParaRegistro = telefonoBD
        ? normalizarNumero(telefonoBD)
        : numero;

      // ✅ Dentro del radio permitido (o sin ubicación de empresa): se guarda
      await guardarFichajeEnBack4app({
        nombre,
        dni,
        numero: numeroParaRegistro,
        empresa,
        accion,
        latitud,
        longitud
      });

      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ ${accion} registrada con ubicación.\nGracias, ${nombre}.`
      });

      return;
    }

    // Si no es ubicación y estábamos esperando ubicación
    if (esperandoUbicacion.has(numero) && !msg.message.locationMessage) {
      await sock.sendMessage(msg.key.remoteJid, {
        text:
          "⚠️ Estaba esperando tu ubicación. Por favor envíala desde el icono del clip 📎 → Ubicación ACTUAL (NO TIEMPO REAL)."
      });
      return;
    }

    // ===========================
    //  FICHAJE: ENTRADA / SALIDA
    // ===========================
    if (texto === "ENTRADA" || texto === "SALIDA") {
      const accion = texto;

      const empleado = await buscarEmpleadoPorNumero(numero);

      if (!empleado) {
        await sock.sendMessage(msg.key.remoteJid, {
          text:
            "❌ No te encuentro en la base de datos.\n" +
            "Por favor, contacta con administración."
        });
        return;
      }

      const nombre = empleado.get("nombre") || "-";
      const dni = empleado.get("dni") || "-";
      const empresa = empleado.get("empresa");

      // Guardamos en el mapa que esperamos la ubicación de este número
      esperandoUbicacion.set(numero, { accion, empleado });

      await sock.sendMessage(msg.key.remoteJid, {
        text:
          `Hola, ${nombre}.\n` +
          `Para registrar tu *${accion}*, envíame ahora tu ubicación ACTUAL ` +
          "usando el icono del clip 📎 → Ubicación."
      });

      return;
    }

    // Si llega un mensaje de texto normal y no está en flujo de fichaje
    if (!esperandoUbicacion.has(numero)) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: "Hola 👋. Escribe *ENTRADA* o *SALIDA* para fichar."
      });
      return;
    }

    // Si está en flujo de fichaje pero manda otra cosa
    if (esperandoUbicacion.has(numero) && !msg.message.locationMessage) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: "⚠️ Aún estoy esperando tu ubicación para completar el fichaje."
      });
      return;
    }

    // Respuesta genérica (por si acaso)
    await sock.sendMessage(msg.key.remoteJid, {
      text: "Envía *ENTRADA* o *SALIDA* para fichar."
    });
  });
}

iniciarBot();


