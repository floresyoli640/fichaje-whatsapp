import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHIVO_ENVIO_MENU, CRON_MENU_DIARIO, ZONA_MENU_DIARIO,
  enVentanaMenuDiario, enviarMenuDiarioProgramado
} from "../menu-diario-programado.js";

const sock = { user: { id: "34610000000@s.whatsapp.net" } };
const aMadrid = iso => new Date(iso);

test("Solo funciona en laborables de Úbeda a las 15:30-15:59, nunca fines de semana o festivos", () => {
  assert.equal(CRON_MENU_DIARIO, "30-59 15 * * 1-5");
  assert.equal(ZONA_MENU_DIARIO, "Europe/Madrid");
  assert.match(ARCHIVO_ENVIO_MENU, /app\/data/);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-10-30T14:29:59Z")), false);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-10-30T14:30:00Z")), true);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-10-30T14:59:59Z")), true);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-10-30T15:00:00Z")), false);
  // 31/10 sábado, 01/11 domingo, 02/11 lunes festivo de Todos los Santos.
  assert.equal(enVentanaMenuDiario(aMadrid("2026-10-31T14:30:00Z")), false);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-11-01T14:30:00Z")), false);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-11-02T14:30:00Z")), false);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-11-03T14:30:00Z")), true);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-09-08T13:30:00Z")), false);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-12-07T14:30:00Z")), false);
  // En junio la hora de Madrid cambia a CEST.
  assert.equal(enVentanaMenuDiario(aMadrid("2026-06-01T13:30:00Z")), true);
  assert.equal(enVentanaMenuDiario(aMadrid("2026-06-01T14:30:00Z")), false);
});

test("El menú diario se envía una sola vez, registra su envío y no se repite al reconectar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "menu-admin-"));
  const rutaEstado = join(dir, "ultimo.json");
  const envios = [];
  const enviarMenu = async (_, jid) => {
    envios.push(jid);
    return { enviado: true, fallbackTexto: true };
  };
  const base = {
    sock, conectado: true, numeroAdmin: "696 963 442", rutaEstado, enviarMenu
  };
  const primero = await enviarMenuDiarioProgramado({
    ...base, ahora: aMadrid("2026-10-30T14:30:00Z")
  });
  assert.deepEqual(primero, {
    estado: "enviado", fecha: "2026-10-30", botonesEnviados: true
  });
  assert.deepEqual(envios, ["34696963442@s.whatsapp.net"]);
  const guardado = JSON.parse(await readFile(rutaEstado, "utf8"));
  assert.equal(guardado.fecha, "2026-10-30");
  assert.equal(guardado.numero, "34696963442");
  assert.equal(guardado.botonesEnviados, true);
  const repetido = await enviarMenuDiarioProgramado({
    ...base, ahora: aMadrid("2026-10-30T14:39:00Z")
  });
  assert.equal(repetido.estado, "ya_enviado");
  assert.equal(envios.length, 1);
});

test("Reintenta si WhatsApp estaba desconectado a las 15:30", async () => {
  const dir = await mkdtemp(join(tmpdir(), "menu-desconexion-"));
  const rutaEstado = join(dir, "ultimo.json");
  let envios = 0;
  const args = {
    sock, numeroAdmin: "34600000001", rutaEstado,
    enviarMenu: async () => { envios++; return { enviado: false, fallbackTexto: true }; }
  };
  const desconectado = await enviarMenuDiarioProgramado({
    ...args, conectado: false, ahora: aMadrid("2026-11-03T14:30:00Z")
  });
  assert.equal(desconectado.estado, "whatsapp_desconectado");
  assert.equal(envios, 0);
  const recuperado = await enviarMenuDiarioProgramado({
    ...args, conectado: true, ahora: aMadrid("2026-11-03T14:42:00Z")
  });
  assert.equal(recuperado.estado, "enviado");
  assert.equal(recuperado.botonesEnviados, false);
  assert.equal(envios, 1);
  const anterior = JSON.parse(await readFile(rutaEstado, "utf8"));
  assert.equal(anterior.fecha, "2026-11-03");
  assert.equal(anterior.botonesEnviados, false);
});

test("Un fallo de envío no se registra como entregado y puede reintentarse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "menu-reintento-"));
  const rutaEstado = join(dir, "ultimo.json");
  let intentos = 0;
  const args = {
    sock, conectado: true, numeroAdmin: "34600000002", rutaEstado,
    enviarMenu: async () => {
      intentos++;
      if (intentos === 1) throw new Error("error de conexión de WhatsApp");
      return { enviado: true, fallbackTexto: true };
    }
  };
  await assert.rejects(() => enviarMenuDiarioProgramado({
    ...args, ahora: aMadrid("2026-11-04T14:30:00Z")
  }), /conexión/);
  const nuevo = await enviarMenuDiarioProgramado({
    ...args, ahora: aMadrid("2026-11-04T14:31:00Z")
  });
  assert.equal(nuevo.estado, "enviado");
  assert.equal(intentos, 2);
});

test("Respeta una marca de envío persistida tras reiniciar el proceso", async () => {
  const dir = await mkdtemp(join(tmpdir(), "menu-persistido-"));
  const rutaEstado = join(dir, "ultimo.json");
  await writeFile(rutaEstado, JSON.stringify({
    fecha: "2026-11-05", numero: "34600000003", botonesEnviados: true
  }));
  let envios = 0;
  const r = await enviarMenuDiarioProgramado({
    sock, conectado: true, numeroAdmin: "34600000003",
    ahora: aMadrid("2026-11-05T14:30:00Z"), rutaEstado,
    enviarMenu: async () => { envios++; return { enviado: true, fallbackTexto: true }; }
  });
  assert.equal(r.estado, "ya_enviado");
  assert.equal(envios, 0);
});


test("En festivos o fines de semana no envía menús ni siquiera tras reconectar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "menu-festivo-"));
  let enviados = 0;
  for (const fechaUtc of [
    "2026-10-31T14:30:00Z",
    "2026-11-01T14:45:00Z",
    "2026-11-02T14:30:00Z",
    "2026-11-02T14:55:00Z",
    "2026-12-07T14:30:00Z",
    "2026-09-08T13:30:00Z"
  ]) {
    const resultado = await enviarMenuDiarioProgramado({
      sock, conectado: true, numeroAdmin: "34600000004",
      rutaEstado: join(dir, "estado.json"),
      ahora: aMadrid(fechaUtc),
      enviarMenu: async () => {
        enviados++;
        return { enviado: true, fallbackTexto: true };
      }
    });
    assert.equal(resultado.estado, "dia_no_laborable", fechaUtc);
  }
  assert.equal(enviados, 0);
});
