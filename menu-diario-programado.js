// Envío diario del menú a las 15:30, hora de Madrid.
// Reintenta cada minuto hasta las 15:59 si el bot estaba desconectado.
// La marca de envío se guarda en el volumen persistente de Railway para evitar repetidos.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fechaLocal, numeroNormalizado } from "./jornadas-admin.js";
import { enviarMenuAdmin } from "./menu-admin.js";

export const CRON_MENU_DIARIO = "30-59 15 * * *";
export const ZONA_MENU_DIARIO = "Europe/Madrid";
export const ARCHIVO_ENVIO_MENU = "/app/data/ultimo_menu_admin_1530.json";

let envioEnCurso = false;
let ultimaFechaEnviadaEnMemoria = null;

export function enVentanaMenuDiario(ahora = new Date()) {
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) return false;
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA_MENU_DIARIO,
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(ahora);
  const partesPorNombre = Object.fromEntries(partes.map(p => [p.type, p.value]));
  return Number(partesPorNombre.hour) === 15 &&
    Number(partesPorNombre.minute) >= 30;
}

async function leerUltimoEnvio(ruta) {
  try {
    const texto = await readFile(ruta, "utf8");
    const dato = JSON.parse(texto);
    if (!dato || typeof dato.fecha !== "string" || typeof dato.numero !== "string") {
      throw new Error("El registro del último menú está mal formado");
    }
    return dato;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function enviarMenuDiarioProgramado({
  sock,
  conectado = false,
  numeroAdmin = process.env.ADMIN_WHATSAPP,
  ahora = new Date(),
  rutaEstado = ARCHIVO_ENVIO_MENU,
  enviarMenu = enviarMenuAdmin
} = {}) {
  if (!enVentanaMenuDiario(ahora)) return { estado: "fuera_de_horario" };
  const numero = numeroNormalizado(numeroAdmin);
  if (!/^\d{11,15}$/.test(numero)) return { estado: "sin_administrador" };
  const fecha = fechaLocal(ahora);
  const clave = fecha + ":" + numero;
  if (ultimaFechaEnviadaEnMemoria === clave) return { estado: "ya_enviado" };
  if (envioEnCurso) return { estado: "envio_en_curso" };
  if (!conectado || !sock) return { estado: "whatsapp_desconectado" };

  envioEnCurso = true;
  try {
    const anterior = await leerUltimoEnvio(rutaEstado);
    if (anterior?.fecha === fecha && anterior?.numero === numero) {
      ultimaFechaEnviadaEnMemoria = clave;
      return { estado: "ya_enviado" };
    }

    const jid = `${numero}@s.whatsapp.net`;
    // Como mínimo llega la versión por texto: los botones de Baileys son opcionales.
    const envio = await enviarMenu(sock, jid);
    if (!envio?.fallbackTexto) {
      throw new Error("El menú no confirmó el envío de la alternativa por texto");
    }

    ultimaFechaEnviadaEnMemoria = clave;
    const estado = {
      fecha, numero,
      enviadoEn: ahora.toISOString(),
      botonesEnviados: Boolean(envio.enviado)
    };
    try {
      await mkdir(dirname(rutaEstado), { recursive: true });
      const temporal = rutaEstado + ".tmp";
      await writeFile(temporal, JSON.stringify(estado), "utf8");
      await rename(temporal, rutaEstado);
    } catch (error) {
      // No reenviar repetidamente si el WhatsApp ha aceptado el mensaje
      // pero Railway tiene un fallo de escritura en su volumen.
      console.error("⚠️ Menú enviado pero no pudo persistirse la marca de envío:", error?.message || error);
    }
    console.log(`📱 Menú diario 15:30 enviado a administración para ${fecha}: ${envio.enviado ? "botones y texto" : "solo texto"}`);
    return { estado: "enviado", fecha, botonesEnviados: Boolean(envio.enviado) };
  } finally {
    envioEnCurso = false;
  }
}
