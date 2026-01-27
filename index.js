// ===============================
//   NUEVO: DETECTAR UBICACIÓN REENVIADA (VERSIÓN ROBUSTA)
// ===============================
function esUbicacionReenviada(msg) {
  // Verificar en el mensaje original completo
  const m = msg?.message;
  if (!m) return false;

  // 1. Verificar si el mensaje completo tiene contextInfo de reenvío
  let ctx = m.contextInfo;
  if (ctx) {
    if (ctx.isForwarded) return true;
    if (ctx.forwardingScore > 0) return true;
    if (ctx.stanzaId) return true;
    if (ctx.participant) return true;
  }

  // 2. Verificar en ephemeralMessage
  if (m.ephemeralMessage?.message) {
    ctx = m.ephemeralMessage.message.contextInfo;
    if (ctx) {
      if (ctx.isForwarded) return true;
      if (ctx.forwardingScore > 0) return true;
      if (ctx.stanzaId) return true;
      if (ctx.participant) return true;
    }
  }

  // 3. Verificar en viewOnceMessage
  if (m.viewOnceMessage?.message) {
    ctx = m.viewOnceMessage.message.contextInfo;
    if (ctx) {
      if (ctx.isForwarded) return true;
      if (ctx.forwardingScore > 0) return true;
      if (ctx.stanzaId) return true;
      if (ctx.participant) return true;
    }
  }

  // 4. Verificar directamente en locationMessage
  const loc = m.locationMessage || 
              m.ephemeralMessage?.message?.locationMessage ||
              m.viewOnceMessage?.message?.locationMessage ||
              m.viewOnceMessageV2?.message?.locationMessage;

  if (loc?.contextInfo) {
    ctx = loc.contextInfo;
    if (ctx.isForwarded) return true;
    if (ctx.forwardingScore > 0) return true;
    if (ctx.stanzaId) return true;
    if (ctx.participant) return true;
    if (ctx.quotedMessage) return true;
  }

  return false;
}

// ===============================
//   WHATSAPP BOT (MODIFICADO)
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
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("❌ Conexión cerrada. ¿Reconectar?", shouldReconnect ? "Sí" : "No");
      if (shouldReconnect) iniciarBot();
    } else if (connection === "open") {
      ultimoQR = null;
      console.log("✅ Conectado a WhatsApp");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  const esperandoUbicacion = new Map();

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages?.[0];
      if (!msg) return;

      if (!msg.message) return;

      // Ignorar estados
      if (msg.key?.remoteJid === "status@broadcast") return;

      // ✅ VERIFICAR REENVÍO ANTES DE DESENVOLVER
      if (esUbicacionReenviada(msg)) {
        console.log("🚫 Ubicación reenviada detectada - BLOQUEADA");
        
        const rawJid = msg.key.remoteJid || "";
        const rawParticipant = msg.key.participant || "";
        const baseId = rawParticipant || rawJid;
        const numero = normalizarNumero((baseId.split("@")[0] || ""));
        
        if (esperandoUbicacion.has(numero)) {
          await sock.sendMessage(msg.key.remoteJid, { 
            text: "❌ **UBICACIÓN REENVIADA DETECTADA** ❌\n\n" +
                  "No se permiten ubicaciones reenviadas o guardadas.\n\n" +
                  "Debes enviar tu ubicación ACTUAL:\n" +
                  "1️⃣ Toca el icono del clip 📎\n" +
                  "2️⃣ Selecciona 'Ubicación'\n" +
                  "3️⃣ Toca 'Enviar tu ubicación actual'\n\n" +
                  "⚠️ NO uses 'Ubicación en tiempo real' ni reenvíes ubicaciones guardadas."
          });
        }
        return;
      }

      const mensajeReal = obtenerMensajeReal(msg);
      if (!mensajeReal) return;

      const rawJid = msg.key.remoteJid || "";
      const rawParticipant = msg.key.participant || "";

      console.log("🔍 JIDs -> remoteJid:", rawJid, "| participant:", rawParticipant);

      const baseId = rawParticipant || rawJid;
      const numero = normalizarNumero((baseId.split("@")[0] || ""));
      console.log("📞 Identificador normalizado:", numero);

      const texto = obtenerTextoDesdeMensaje(mensajeReal).trim().toUpperCase();
      console.log(`📩 Mensaje de ${numero}: ${texto}`);

      // ===========================
      //  FICHAJE: UBICACIÓN
      // ===========================
      if (esperandoUbicacion.has(numero) && mensajeReal.locationMessage) {
        const { accion, empleado } = esperandoUbicacion.get(numero);
        esperandoUbicacion.delete(numero);

        const nombre = empleado.get("nombre") || "-";
        const dni = empleado.get("dni") || "-";
        const empresa = empleado.get("empresa");

        const latitud = mensajeReal.locationMessage.degreesLatitude;
        const longitud = mensajeReal.locationMessage.degreesLongitude;

        console.log(`📍 Ubicación recibida de ${nombre} (${numero}): lat=${latitud}, lon=${longitud}`);

        const puntoFichaje = new Parse.GeoPoint({ latitude: latitud, longitude: longitud });
        const ubicacionEmpresa = empresa?.get("ubicacion");

        if (ubicacionEmpresa instanceof Parse.GeoPoint) {
          const distanciaKm = ubicacionEmpresa.kilometersTo(puntoFichaje);
          const distanciaMetros = distanciaKm * 1000;

          console.log(`📏 Distancia al centro de trabajo: ${distanciaMetros.toFixed(2)} m`);

          if (distanciaMetros > 40) {
            await sock.sendMessage(msg.key.remoteJid, {
              text:
                "🐦 Hay pájar@, no estás en la oficina 🤣.\n" +
                "Para fichar debes estar en la oficina 🔫😉"
            });
            return;
          }
        } else {
          console.log("⚠️ La empresa no tiene 'ubicacion' (GeoPoint). Se admite fichaje igualmente.");
        }

        const telefonoBD = empleado.get("telefono");
        const numeroParaRegistro = telefonoBD ? normalizarNumero(telefonoBD) : numero;

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
      if (esperandoUbicacion.has(numero) && !mensajeReal.locationMessage) {
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
            "usando el icono del clip 📎 → Ubicación.\n\n" +
            "⚠️ IMPORTANTE: NO reenvíes ubicaciones guardadas."
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
      if (esperandoUbicacion.has(numero) && !mensajeReal.locationMessage) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "⚠️ Aún estoy esperando tu ubicación para completar el fichaje."
        });
        return;
      }

      await sock.sendMessage(msg.key.remoteJid, {
        text: "Envía *ENTRADA* o *SALIDA* para fichar."
      });
    } catch (err) {
      console.error("❌ Error en messages.upsert:", err);
    }
  });
}

iniciarBot();
