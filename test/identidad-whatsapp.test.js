import test from "node:test";
import assert from "node:assert/strict";
import { jidTelefonico, construirMapaLIDs } from "../identidad-whatsapp.js";

test("Convierte solo teléfonos plausibles a PN de WhatsApp", () => {
  assert.equal(jidTelefonico("612 345 678"), "34612345678@s.whatsapp.net");
  assert.equal(jidTelefonico("+34 612 345 678"), "34612345678@s.whatsapp.net");
  assert.equal(jidTelefonico("34612345678@s.whatsapp.net"), "34612345678@s.whatsapp.net");
  assert.equal(jidTelefonico(""), null);
  assert.equal(jidTelefonico("224275155964019@lid"), "224275155964019@s.whatsapp.net");
});

test("Solo acepta correspondencias LID verificadas de números consultados", async () => {
  const pedidos = [];
  const sock = { onWhatsApp: async (...jids) => {
    pedidos.push(jids);
    return [
      { jid: "34612345678@s.whatsapp.net", exists: true, lid: "111111111111@lid" },
      { jid: "34699999999@s.whatsapp.net", exists: true, lid: "999999999999@lid" },
      { jid: "34687654321@s.whatsapp.net", exists: false, lid: "222222222222@lid" },
      { jid: "34687654321@s.whatsapp.net", exists: true, lid: "222222222222@s.whatsapp.net" }
    ];
  } };
  const mapa = await construirMapaLIDs(sock, ["612345678", "612345678", "687654321"]);
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].length, 2);
  assert.equal(mapa.size, 1);
  assert.equal(mapa.get("111111111111@lid"), "34612345678@s.whatsapp.net");
  assert.equal(mapa.has("999999999999@lid"), false);
});

test("Continúa los lotes cuando WhatsApp falla en uno", async () => {
  let llamadas = 0;
  const sock = { onWhatsApp: async (...jids) => {
    llamadas++;
    if (llamadas === 1) throw new Error("Consulta temporalmente fallida");
    return [{ jid: jids[0], exists: true, lid: "333333333333@lid" }];
  } };
  const mapa = await construirMapaLIDs(sock, ["600000001", "600000002"], 1);
  assert.equal(llamadas, 2);
  assert.equal(mapa.get("333333333333@lid"), "34600000002@s.whatsapp.net");
});
