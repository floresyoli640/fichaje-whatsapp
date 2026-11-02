import test from "node:test";
import assert from "node:assert/strict";
import { crearAlmacenMensajesSalientes, habilitarRegistroSalientes } from "../registro-mensajes-wa.js";

test("Conserva temporalmente el mensaje original para que Baileys pueda reintentarlo", async () => {
  const almacen = crearAlmacenMensajesSalientes({ maximo: 2, duracionMs: 5000 });
  const original = { key: { id: "id_1", remoteJid: "123@s.whatsapp.net" }, message: { conversation: "RESUMEN" } };
  assert.equal(almacen.guardar(original, 1000), true);
  assert.deepEqual(await almacen.obtener({ id: "id_1" }, 2000), { conversation: "RESUMEN" });
  assert.equal(await almacen.obtener({ id: "id_1" }, 6000), undefined);
  assert.equal(almacen.cantidad(), 0);
});

test("La caché limita el almacenamiento en memoria y no conserva mensajes fallidos", async () => {
  const almacen = crearAlmacenMensajesSalientes({ maximo: 2 });
  assert.equal(almacen.guardar({}), false);
  for (let i = 1; i <= 3; i++) {
    almacen.guardar({ key: { id: String(i) }, message: { conversation: String(i) } });
  }
  assert.equal(almacen.cantidad(), 2);
  assert.equal(await almacen.obtener({ id: "1" }), undefined);
  assert.deepEqual(await almacen.obtener({ id: "3" }), { conversation: "3" });
});

test("El envoltorio registra respuestas reales de envío, sin cambiar el contenido enviado", async () => {
  const almacen = crearAlmacenMensajesSalientes();
  const llamadas = [];
  const socket = {
    sendMessage: async (jid, contenido, opciones) => {
      llamadas.push([jid, contenido, opciones]);
      return {
        key: { remoteJid: jid, id: "mensaje-test" },
        message: { extendedTextMessage: { text: contenido.text } }
      };
    }
  };
  habilitarRegistroSalientes(socket, almacen);
  const result = await socket.sendMessage("123@s.whatsapp.net", { text: "Hola" }, { extra: true });
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0][1], { text: "Hola" });
  assert.deepEqual(llamadas[0][2], { extra: true });
  assert.equal(result.key.id, "mensaje-test");
  assert.deepEqual(await almacen.obtener({ id: "mensaje-test" }), result.message);
});
