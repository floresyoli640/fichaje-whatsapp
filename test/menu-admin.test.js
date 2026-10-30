import test from "node:test";
import assert from "node:assert/strict";
import {
  OPCIONES_ADMIN, TEXTO_MENU_ADMIN, interpretarSeleccionAdmin,
  interpretarNumeroAdmin, construirMensajeBotonesAdmin,
  nodosBotonesAdmin, enviarMenuAdmin
} from "../menu-admin.js";

const JID = "34600000000@s.whatsapp.net";

test("Hay exactamente tres botones y solo remiten a comandos administrativos permitidos", () => {
  assert.deepEqual(OPCIONES_ADMIN.map(x => x.comando),
    ["RESUMEN", "CONFIRMAR TODOS", "DETALLE"]);
  assert.equal(new Set(OPCIONES_ADMIN.map(x => x.id)).size, 3);
  const msg = construirMensajeBotonesAdmin();
  const interactivo = msg.viewOnceMessage.message.interactiveMessage;
  assert.equal(interactivo.nativeFlowMessage.buttons.length, 3);
  for (const [i, b] of interactivo.nativeFlowMessage.buttons.entries()) {
    assert.equal(b.name, "quick_reply");
    const args = JSON.parse(b.buttonParamsJson);
    assert.equal(args.id, OPCIONES_ADMIN[i].id);
    assert.equal(args.display_text, OPCIONES_ADMIN[i].etiqueta);
    assert.ok(args.display_text.length <= 20);
  }
  assert.equal(msg.viewOnceMessage.message.messageContextInfo.deviceListMetadataVersion, 2);
  assert.ok(nodosBotonesAdmin().some(n => n.tag === "biz"));
  assert.ok(nodosBotonesAdmin().some(n => n.tag === "bot"));
});

test("Reconoce respuestas desde botones iOS, Android, list, template y native_flow", () => {
  assert.equal(interpretarSeleccionAdmin({
    buttonsResponseMessage: { selectedButtonId: "adm_resumen" }
  }), "RESUMEN");
  assert.equal(interpretarSeleccionAdmin({
    templateButtonReplyMessage: { selectedId: "adm_confirmar" }
  }), "CONFIRMAR TODOS");
  assert.equal(interpretarSeleccionAdmin({
    listResponseMessage: { singleSelectReply: { selectedRowId: "adm_detalle" } }
  }), "DETALLE");
  assert.equal(interpretarSeleccionAdmin({
    viewOnceMessage: { message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: "adm_detalle" }) }
      }
    }}
  }), "DETALLE");
  assert.equal(interpretarSeleccionAdmin({
    interactiveResponseMessage: {
      nativeFlowResponseMessage: { paramsJson: "{mal formado" }
    }
  }), null);
  assert.equal(interpretarSeleccionAdmin({
    buttonsResponseMessage: { selectedButtonId: "accion_no_autorizada" }
  }), null);
  assert.equal(interpretarNumeroAdmin(" 2 "), "CONFIRMAR TODOS");
  assert.equal(interpretarNumeroAdmin("7"), null);
});

test("Envía primero texto utilizable, después botones, y conserva el fallback en caso de error", async () => {
  const orden = [];
  const sock = {
    user: { id: "34610000000:1@s.whatsapp.net" },
    sendMessage: async (jid, payload) => {
      orden.push({ tipo: "texto", jid, payload });
    },
    relayMessage: async (jid, payload, options) => {
      orden.push({ tipo: "botones", jid, payload, options });
    }
  };
  const ok = await enviarMenuAdmin(sock, JID);
  assert.deepEqual(ok, { enviado: true, fallbackTexto: true });
  assert.equal(orden[0].tipo, "texto");
  assert.equal(orden[1].tipo, "botones");
  assert.equal(orden[1].jid, JID);
  assert.equal(orden[1].options.additionalNodes.length, 2);
  assert.match(orden[0].payload.text, /CONFIRMAR TODOS/);
  assert.equal(orden[0].payload.text, TEXTO_MENU_ADMIN);

  const soloTexto = {
    user: { id: "34610000000:1@s.whatsapp.net" },
    sendMessage: async (jid, payload) => { orden.push({ tipo: "fallback", jid, payload }); },
    relayMessage: async () => { throw new Error("Error simulado de botones"); }
  };
  const resultado = await enviarMenuAdmin(soloTexto, JID);
  assert.deepEqual(resultado, { enviado: false, fallbackTexto: true });
  assert.equal(orden.at(-1).tipo, "fallback");
});

test("El menú está reservado a administración, sin leer Back4App en fin de semana", async () => {
  const { procesarComandoAdmin } = await import("../comandos-admin.js");
  const previo = process.env.ADMIN_WHATSAPP;
  const prevFestivos = process.env.FESTIVOS_UBEDA_2026;
  process.env.ADMIN_WHATSAPP = "34600000000";
  delete process.env.FESTIVOS_UBEDA_2026;
  const respuestas = [];
  let botones = 0;
  try {
    assert.equal(await procesarComandoAdmin({
      texto: "MENU", numero: "34600000000",
      responder: async x => respuestas.push(x),
      enviarMenu: async () => { botones++; }
    }), true);
    assert.equal(botones, 1);
    assert.equal(respuestas.length, 0);
    assert.equal(await procesarComandoAdmin({
      texto: "MENÚ", numero: "34600000000",
      responder: async x => respuestas.push(x),
      enviarMenu: async () => { botones++; }
    }), true);
    assert.equal(botones, 2);
    assert.equal(await procesarComandoAdmin({
      texto: "MENU", numero: "34699999999",
      responder: async x => respuestas.push(x),
      enviarMenu: async () => { botones++; }
    }), true);
    assert.equal(botones, 2);
    assert.match(respuestas.at(-1), /reservado a administración/i);
  } finally {
    if (previo === undefined) delete process.env.ADMIN_WHATSAPP;
    else process.env.ADMIN_WHATSAPP = previo;
    if (prevFestivos === undefined) delete process.env.FESTIVOS_UBEDA_2026;
    else process.env.FESTIVOS_UBEDA_2026 = prevFestivos;
  }
});
