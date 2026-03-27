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
//   EXPRESS PARA VER EL QR
// ===============================
const app = express();
const PORT = process.env.PORT || 3000;

let ultimoQR = null;
let estadoWA = "iniciando";
let ultimoErrorWA = null;

app.get("/", (req, res) => {
  res.send("Servidor funcionando. Ve a /qr para escanear el código.");
});

app.get("/estado", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");

  res.json({
    estadoWA,
    hayQR: !!ultimoQR,
    ultimoErrorWA
  });
});

app.get("/qr", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    if (!ultimoQR) {
      return res.send("QR aún no generado o ya conectado.");
    }

    const qrImage = await QRCode.toDataURL(ultimoQR);

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
          <meta http-equiv="Pragma" content="no-cache" />
          <meta http-equiv="Expires" content="0" />
          <title>QR WhatsApp</title>
        </head>
        <body style="text-align:center;font-family:Arial;padding-top:30px;">
          <h2>Escanea el QR</h2>
          <img src="${qrImage}" style="width:300px;">
          <p>Estado: ${estadoWA}</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ Error mostrando QR:", error);
    res.status(500).send("Error generando el QR.");
  }
});

app.listen(PORT, () => console.log(`📡 Servidor Express en puerto ${PORT}`));

// ===============================
//   HELPERS PARA NÚMEROS
// ===============================
function normalizarNumero(num) {
  return (num || "").toString().replace(/[^\d]/g, "");
}

// ===============================
//   BASE DE DATOS
// ===============================
async function buscarEmpleadoPorNumero(numeroRaw) {
  const Employees = Parse.Object.extend("Employees");

  const numLimpio = normalizarNumero(numeroRaw || "");
  const ultimos9 = numLimpio.slice(-9);

  console.log(
    "🔎 Buscando empleado.",
    "numeroRaw =", numeroRaw,
    "numLimpio =", numLimpio,
    "ultimos9 =", ultimos9
  );

  const esTelefonoEspanol =
    numLimpio.startsWith("34") && numLimpio.length >= 11 && numLimpio.length <= 13;

  let query = new Parse.Query(Employees);

  if (esTelefonoEspanol) {
    query.contains("telefono", ultimos9);
  } else {
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

  if (message?.conversation) return message.conversation;
  if (message?.extendedTextMessage) return message.extendedTextMessage.text || "";
  if (message?.imageMessage?.caption) return message.imageMessage.caption;

  return "";
}

// ===============================
//   WHATSAPP BOT
// ===============================
async function iniciarBot() {
  try {
    estadoWA = "iniciando";
    ultimoErrorWA = null;

    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys_reset2");
    const { version } = await fetchLatestBaileysVersion();

    console.log("🚀 Iniciando Baileys con versión:", version);

    const sock = makeWASocket({
      version,
      auth: state
    });

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      console.log(
        "connection.update:",
        JSON.stringify(
          {
            connection,
            hasQr: !!qr,
            lastDisconnect:
              lastDisconnect?.error?.message ||
              lastDisconnect?.error?.output?.payload ||
              null
          },
          null,
          2
        )
      );

      if (qr) {
        ultimoQR = qr;
        estadoWA = "qr_generado";
        console.log("📲 Código QR generado. Ve a /qr para escanearlo.");
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        estadoWA = "cerrado";
        ultimoErrorWA =
          lastDisconnect?.error?.message ||
          JSON.stringify(lastDisconnect?.error?.output?.payload || null);

        console.log("❌ Conexión cerrada. Código:", statusCode);
        console.log("❌ ¿Reconectar?", shouldReconnect ? "Sí" : "No");

        if (shouldReconnect) {
          setTimeout(() => {
            iniciarBot();
          }, 3000);
        } else {
          console.log("⚠️ Sesión cerrada definitivamente. Habrá que regenerar QR.");
        }
      } else if (connection === "open") {
        ultimoQR = null;
        estadoWA = "conectado";
        ultimoErrorWA = null;
        console.log("✅ Conectado a WhatsApp");
      }
    });

    sock.ev.on("creds.update", async () => {
      try {
        await saveCreds();
        console.log("💾 Credenciales guardadas");
      } catch (error) {
        console.error("❌ Error guardando credenciales:", error);
      }
    });

    const esperandoUbicacion = new Map();

    sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const msg = messages[0];
        if (!msg?.message || msg.key?.fromMe) return;

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

          const puntoFichaje = new Parse.GeoPoint({
            latitude: latitud,
            longitude: longitud
          });

          const ubicacionEmpresa = empresa?.get("ubicacion");

          if (ubicacionEmpresa instanceof Parse.GeoPoint) {
            const distanciaKm = ubicacionEmpresa.kilometersTo(puntoFichaje);
            const distanciaMetros = distanciaKm * 1000;

            console.log(
              `📏 Distancia al centro de trabajo: ${distanciaMetros.toFixed(2)} m`
            );

            if (distanciaMetros > 40) {
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

          const telefonoBD = empleado.get("telefono");
          const numeroParaRegistro = telefonoBD
            ? normalizarNumero(telefonoBD)
            : numero;

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

          esperandoUbicacion.set(numero, { accion, empleado });

          await sock.sendMessage(msg.key.remoteJid, {
            text:
              `Hola, ${nombre}.\n` +
              `Para registrar tu *${accion}*, envíame ahora tu ubicación ACTUAL ` +
              "usando el icono del clip 📎 → Ubicación."
          });

          return;
        }

        if (!esperandoUbicacion.has(numero)) {
          await sock.sendMessage(msg.key.remoteJid, {
            text: "Hola 👋. Escribe *ENTRADA* o *SALIDA* para fichar."
          });
          return;
        }

        if (esperandoUbicacion.has(numero) && !msg.message.locationMessage) {
          await sock.sendMessage(msg.key.remoteJid, {
            text: "⚠️ Aún estoy esperando tu ubicación para completar el fichaje."
          });
          return;
        }

        await sock.sendMessage(msg.key.remoteJid, {
          text: "Envía *ENTRADA* o *SALIDA* para fichar."
        });
      } catch (error) {
        console.error("❌ Error procesando mensaje:", error);
      }
    });
  } catch (error) {
    estadoWA = "error_inicio";
    ultimoErrorWA = error?.message || String(error);
    console.error("❌ Error iniciando el bot:", error);
  }
}

iniciarBot();
