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
import cron from "node-cron";

// ===============================
//   EXPRESS PARA VER EL QR
// ===============================
const app = express();
const PORT = process.env.PORT || 3000;

let ultimoQR = null;
let estadoWA = "iniciando";
let ultimoErrorWA = null;

// Socket global
let sockWA = null;

// Evita iniciar los cron varias veces
let recordatoriosIniciados = false;

// Estado global de usuarios esperando ubicación
const esperandoUbicacion = new Map();

// Evita procesar el mismo mensaje dos veces
const mensajesProcesados = new Set();

// Evita reconexiones simultáneas
let reconectando = false;

// ===============================
//   MENSAJE PARA CLIENTES / NO FICHAJE
// ===============================
const mensajeNoAtencionCliente =
  "Hola 👋\n\n" +
  "Este número de WhatsApp no está disponible.\n\n" +
  "No prestamos atención al cliente mediante WhatsApp en este teléfono.\n\n" +
  "Puedes llamarnos o consultar las distintas formas de contacto en:\n" +
  "https://laprimera.net/";

// ===============================
//   RUTAS EXPRESS
// ===============================
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
//   HELPERS PARA MENSAJES WHATSAPP
// ===============================
function obtenerMensajeReal(message) {
  if (!message) return null;

  if (message.ephemeralMessage?.message) {
    return obtenerMensajeReal(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessage?.message) {
    return obtenerMensajeReal(message.viewOnceMessage.message);
  }

  if (message.viewOnceMessageV2?.message) {
    return obtenerMensajeReal(message.viewOnceMessageV2.message);
  }

  if (message.documentWithCaptionMessage?.message) {
    return obtenerMensajeReal(message.documentWithCaptionMessage.message);
  }

  return message;
}

function obtenerTexto(msg) {
  const message = obtenerMensajeReal(msg.message);

  if (message?.conversation) return message.conversation;
  if (message?.extendedTextMessage) return message.extendedTextMessage.text || "";
  if (message?.imageMessage?.caption) return message.imageMessage.caption;

  return "";
}

function obtenerUbicacion(msg) {
  const message = obtenerMensajeReal(msg.message);

  if (message?.locationMessage) {
    return {
      latitud: message.locationMessage.degreesLatitude,
      longitud: message.locationMessage.degreesLongitude,
      tipo: "ubicacion_actual"
    };
  }

  if (message?.liveLocationMessage) {
    return {
      latitud: message.liveLocationMessage.degreesLatitude,
      longitud: message.liveLocationMessage.degreesLongitude,
      tipo: "ubicacion_tiempo_real"
    };
  }

  return null;
}

// ===============================
//   BASE DE DATOS
// ===============================
async function buscarEmpleadoPorNumero(numeroRaw) {
  const Employees = Parse.Object.extend("Employees");

  const numLimpio = normalizarNumero(numeroRaw || "");
  const ultimos9 = numLimpio.slice(-9);

  console.log("======================================");
  console.log("🔎 BUSCANDO EMPLEADO");
  console.log("numeroRaw:", numeroRaw);
  console.log("numLimpio:", numLimpio);
  console.log("ultimos9:", ultimos9);
  console.log("======================================");

  const queries = [];

  if (numLimpio) {
    const q1 = new Parse.Query(Employees);
    q1.equalTo("waId", numLimpio);
    queries.push(q1);

    const q2 = new Parse.Query(Employees);
    q2.equalTo("telefono", numLimpio);
    queries.push(q2);

    const q3 = new Parse.Query(Employees);
    q3.contains("waId", numLimpio);
    queries.push(q3);

    const q4 = new Parse.Query(Employees);
    q4.contains("telefono", numLimpio);
    queries.push(q4);
  }

  if (ultimos9 && ultimos9.length === 9) {
    const q5 = new Parse.Query(Employees);
    q5.contains("telefono", ultimos9);
    queries.push(q5);

    const q6 = new Parse.Query(Employees);
    q6.contains("waId", ultimos9);
    queries.push(q6);

    const q7 = new Parse.Query(Employees);
    q7.equalTo("telefono", ultimos9);
    queries.push(q7);

    const q8 = new Parse.Query(Employees);
    q8.equalTo("waId", ultimos9);
    queries.push(q8);

    const q9 = new Parse.Query(Employees);
    q9.equalTo("telefono", "34" + ultimos9);
    queries.push(q9);

    const q10 = new Parse.Query(Employees);
    q10.equalTo("waId", "34" + ultimos9);
    queries.push(q10);

    const q11 = new Parse.Query(Employees);
    q11.contains("telefono", "34" + ultimos9);
    queries.push(q11);

    const q12 = new Parse.Query(Employees);
    q12.contains("waId", "34" + ultimos9);
    queries.push(q12);
  }

  if (queries.length === 0) {
    console.log("❌ No hay número válido para buscar empleado.");
    return null;
  }

  const query = Parse.Query.or(...queries);
  query.include("empresa");
  query.limit(10);

  const resultados = await query.find();

  console.log("📌 Resultados encontrados:", resultados.length);

  resultados.forEach((emp, index) => {
    console.log(
      `#${index + 1}`,
      "| objectId:", emp.id,
      "| nombre:", emp.get("nombre"),
      "| telefono:", emp.get("telefono"),
      "| waId:", emp.get("waId"),
      "| activo:", emp.get("activo"),
      "| exentoFichaje:", emp.get("exentoFichaje")
    );
  });

  const empleado = resultados[0] || null;

  if (!empleado) {
    console.log("❌ Ningún empleado encontrado para:", numLimpio);
    return null;
  }

  console.log("✅ EMPLEADO SELECCIONADO:", empleado.get("nombre"));

  return empleado;
}

async function guardarFichajeEnBack4app({
  nombre,
  dni,
  numero,
  empresa,
  accion,
  latitud,
  longitud
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

  if (Number.isFinite(latitud) && Number.isFinite(longitud)) {
    entry.set(
      "ubicacion",
      new Parse.GeoPoint({
        latitude: latitud,
        longitude: longitud
      })
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
//   RECORDATORIOS DE FICHAJE
// ===============================
function obtenerRangoDiaActual() {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);

  const fin = new Date();
  fin.setHours(23, 59, 59, 999);

  return { inicio, fin };
}

async function obtenerEmpleadosActivos() {
  const Employees = Parse.Object.extend("Employees");
  const query = new Parse.Query(Employees);

  query.equalTo("activo", true);
  query.notEqualTo("exentoFichaje", true);

  query.include("empresa");
  query.limit(1000);

  return await query.find();
}

function obtenerNumeroWhatsAppEmpleado(empleado) {
  const telefono = normalizarNumero(empleado.get("telefono"));
  const waId = normalizarNumero(empleado.get("waId"));

  // Para enviar recordatorios, es mejor usar teléfono real.
  // El waId tipo @lid puede servir para reconocer mensajes entrantes,
  // pero no siempre sirve para enviar mensajes como @s.whatsapp.net.
  let numero = telefono;

  if (!numero && waId) {
    numero = waId;
  }

  if (!numero) return null;

  if (numero.length === 9) {
    numero = "34" + numero;
  }

  return numero;
}

async function empleadoYaHaFichadoHoy(empleado, accion) {
  const TimeEntries = Parse.Object.extend("TimeEntries");
  const query = new Parse.Query(TimeEntries);

  const { inicio, fin } = obtenerRangoDiaActual();

  const telefono = normalizarNumero(empleado.get("telefono"));
  const waId = normalizarNumero(empleado.get("waId"));

  const numerosPosibles = [];

  if (telefono) {
    numerosPosibles.push(telefono);

    if (telefono.length === 9) {
      numerosPosibles.push("34" + telefono);
    }
  }

  if (waId) {
    numerosPosibles.push(waId);
  }

  if (numerosPosibles.length === 0) {
    return false;
  }

  query.containedIn("numero", numerosPosibles);
  query.equalTo("accion", accion);
  query.greaterThanOrEqualTo("fecha", inicio);
  query.lessThanOrEqualTo("fecha", fin);

  const fichaje = await query.first();

  return !!fichaje;
}

async function enviarRecordatorioFichaje(accion) {
  try {
    if (!sockWA || estadoWA !== "conectado") {
      console.log("⚠️ WhatsApp no está conectado. No se envían recordatorios.");
      return;
    }

    console.log(`⏰ Revisando recordatorios de ${accion}...`);

    const empleados = await obtenerEmpleadosActivos();

    for (const empleado of empleados) {
      const nombre = empleado.get("nombre") || "empleado/a";
      const numero = obtenerNumeroWhatsAppEmpleado(empleado);

      if (!numero) {
        console.log(`⚠️ ${nombre} no tiene teléfono ni waId.`);
        continue;
      }

      const yaHaFichado = await empleadoYaHaFichadoHoy(empleado, accion);

      if (yaHaFichado) {
        console.log(`✅ ${nombre} ya tiene ${accion} registrada hoy.`);
        continue;
      }

      const jid = `${numero}@s.whatsapp.net`;

      const texto =
        accion === "ENTRADA"
          ? `Buenos días, ${nombre} 👋\n\nTe recuerdo que todavía no has registrado tu *ENTRADA* de hoy.\n\nPara fichar, responde con la palabra *ENTRADA*.`
          : `Hola, ${nombre} 👋\n\nTe recuerdo que todavía no has registrado tu *SALIDA* de hoy.\n\nPara fichar, responde con la palabra *SALIDA*.`;

      await sockWA.sendMessage(jid, { text: texto });

      console.log(`📨 Recordatorio de ${accion} enviado a ${nombre} (${numero})`);
    }
  } catch (error) {
    console.error(`❌ Error enviando recordatorios de ${accion}:`, error);
  }
}

function iniciarRecordatorios() {
  if (recordatoriosIniciados) {
    console.log("⏰ Los recordatorios ya estaban iniciados. No se duplican.");
    return;
  }

  recordatoriosIniciados = true;

  cron.schedule(
    "5 8 * * 1-5",
    async () => {
      await enviarRecordatorioFichaje("ENTRADA");
    },
    {
      timezone: "Europe/Madrid"
    }
  );

  cron.schedule(
    "5 15 * * 1-5",
    async () => {
      await enviarRecordatorioFichaje("SALIDA");
    },
    {
      timezone: "Europe/Madrid"
    }
  );

  console.log("⏰ Recordatorios programados: 08:05 ENTRADA y 15:05 SALIDA.");
}

// ===============================
//   CERRAR SOCKET ANTERIOR
// ===============================
function cerrarSocketAnterior() {
  if (!sockWA) return;

  try {
    console.log("♻️ Cerrando socket anterior antes de crear uno nuevo...");

    if (sockWA.ev?.removeAllListeners) {
      sockWA.ev.removeAllListeners();
    }

    if (typeof sockWA.end === "function") {
      sockWA.end(new Error("Reiniciando socket"));
    } else if (sockWA.ws?.close) {
      sockWA.ws.close();
    }
  } catch (e) {
    console.log("⚠️ No se pudo cerrar el socket anterior:", e?.message || e);
  }
}

// ===============================
//   WHATSAPP BOT
// ===============================
async function iniciarBot() {
  try {
    estadoWA = "iniciando";
    ultimoErrorWA = null;

    cerrarSocketAnterior();

    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys_reset3");
    const { version } = await fetchLatestBaileysVersion();

    console.log("🚀 Iniciando Baileys con versión:", version);

    const sock = makeWASocket({
      version,
      auth: state
    });

    sockWA = sock;

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
          if (reconectando) {
            console.log("⚠️ Ya hay una reconexión en curso. No se lanza otra.");
            return;
          }

          reconectando = true;

          setTimeout(async () => {
            try {
              await iniciarBot();
            } finally {
              reconectando = false;
            }
          }, 3000);
        } else {
          console.log("⚠️ Sesión cerrada definitivamente. Habrá que regenerar QR.");
        }
      } else if (connection === "open") {
        ultimoQR = null;
        estadoWA = "conectado";
        ultimoErrorWA = null;
        sockWA = sock;

        console.log("✅ Conectado a WhatsApp");

        iniciarRecordatorios();
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

    sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        for (const msg of messages) {
          if (!msg?.message || msg.key?.fromMe) continue;

          const rawJid = msg.key.remoteJid || "";
          const rawParticipant = msg.key.participant || "";
          const messageId = `${rawJid}:${rawParticipant}:${msg.key.id}`;

          if (mensajesProcesados.has(messageId)) {
            console.log("⚠️ Mensaje duplicado ignorado:", messageId);
            continue;
          }

          mensajesProcesados.add(messageId);

          setTimeout(() => {
            mensajesProcesados.delete(messageId);
          }, 5 * 60 * 1000);

          console.log("🔍 JIDs -> remoteJid:", rawJid, "| participant:", rawParticipant);

          const baseId = rawParticipant || rawJid;
          const numero = normalizarNumero(baseId.split("@")[0]);

          console.log("📞 Identificador normalizado:", numero);

          const mensajeReal = obtenerMensajeReal(msg.message);
          console.log("🧪 Tipo de mensaje recibido:", Object.keys(mensajeReal || {}));

          const texto = obtenerTexto(msg).trim().toUpperCase();
          const ubicacionRecibida = obtenerUbicacion(msg);

          console.log(`📩 Mensaje de ${numero}: ${texto}`);

          if (ubicacionRecibida) {
            console.log(
              "📍 Ubicación detectada:",
              ubicacionRecibida.tipo,
              ubicacionRecibida.latitud,
              ubicacionRecibida.longitud
            );
          }

          // ===============================
          //   SI ESTÁ ESPERANDO UBICACIÓN
          // ===============================
          if (esperandoUbicacion.has(numero) && ubicacionRecibida) {
            const { accion, empleado } = esperandoUbicacion.get(numero);
            esperandoUbicacion.delete(numero);

            const nombre = empleado.get("nombre") || "-";
            const dni = empleado.get("dni") || "-";
            const empresa = empleado.get("empresa");

            const latitud = ubicacionRecibida.latitud;
            const longitud = ubicacionRecibida.longitud;

            if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
              await sock.sendMessage(msg.key.remoteJid, {
                text:
                  "⚠️ No he podido leer correctamente tu ubicación.\n\n" +
                  "Por favor envíala de nuevo desde el clip 📎 → Ubicación → Ubicación actual."
              });
              return;
            }

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
                "⚠️ La empresa no tiene 'ubicacion' GeoPoint configurada. Se admite fichaje igualmente."
              );
            }

            const telefonoBD = empleado.get("telefono");
            const waIdBD = empleado.get("waId");

            const numeroParaRegistro = telefonoBD
              ? normalizarNumero(telefonoBD)
              : waIdBD
                ? normalizarNumero(waIdBD)
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

          // Si ya ha escrito ENTRADA/SALIDA y ahora manda texto, se le sigue pidiendo ubicación.
          // Esto evita que a un trabajador se le envíe el mensaje de "no atención al cliente"
          // mientras está intentando completar el fichaje.
          if (esperandoUbicacion.has(numero) && !ubicacionRecibida) {
            await sock.sendMessage(msg.key.remoteJid, {
              text:
                "⚠️ Estaba esperando tu ubicación.\n\n" +
                "Por favor envíala desde el clip 📎 o botón + → Ubicación → Ubicación actual.\n\n" +
                "No envíes ubicación en tiempo real."
            });
            return;
          }

          // ===============================
          //   ENTRADA / SALIDA
          // ===============================
          if (texto === "ENTRADA" || texto === "SALIDA") {
            const accion = texto;

            console.log("🧪 Voy a buscar empleado con número:", numero);

            const empleado = await buscarEmpleadoPorNumero(numero);

            if (!empleado) {
              await sock.sendMessage(msg.key.remoteJid, {
                text:
                  "❌ No te encuentro en la base de datos.\n" +
                  "Este número se utiliza únicamente para el sistema de fichaje de trabajadores.\n\n" +
                  "Para atención al cliente, puedes llamarnos o ver las distintas formas de contacto en:\n" +
                  "https://laprimera.net/"
              });
              return;
            }

            if (
              empleado.get("activo") === false ||
              empleado.get("exentoFichaje") === true
            ) {
              await sock.sendMessage(msg.key.remoteJid, {
                text:
                  "⚠️ Tu usuario no está habilitado para fichar.\n" +
                  "Si crees que es un error, contacta con administración."
              });
              return;
            }

            const nombre = empleado.get("nombre") || "-";

            esperandoUbicacion.set(numero, { accion, empleado });

            await sock.sendMessage(msg.key.remoteJid, {
              text:
                `Hola, ${nombre}.\n\n` +
                `Para registrar tu *${accion}*, envíame ahora tu ubicación actual.\n\n` +
                `En iPhone: pulsa el botón + o el clip 📎 → Ubicación → *Enviar ubicación actual*.\n\n` +
                `No envíes ubicación en tiempo real.`
            });

            return;
          }

          // ===============================
          //   CUALQUIER OTRO MENSAJE
          // ===============================
          await sock.sendMessage(msg.key.remoteJid, {
            text: mensajeNoAtencionCliente
          });

          return;
        }
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
