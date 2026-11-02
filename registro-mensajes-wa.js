// Reintentos de mensajes salientes de Baileys.
// Las claves y mensajes se mantienen solo en memoria, nunca en logs ni en disco.
// 'getMessage' permite que WhatsApp solicite un reenvío tras fallos de descifrado.
export function crearAlmacenMensajesSalientes({ maximo = 700, duracionMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!Number.isInteger(maximo) || maximo < 1 || duracionMs <= 0) {
    throw new Error("Configuración de caché inválida");
  }
  const mensajes = new Map();

  function guardar(mensaje, ahora = Date.now()) {
    const id = mensaje?.key?.id;
    const contenido = mensaje?.message;
    if (!id || !contenido) return false;
    mensajes.delete(id);
    mensajes.set(id, { contenido, vence: ahora + duracionMs });
    while (mensajes.size > maximo) mensajes.delete(mensajes.keys().next().value);
    return true;
  }

  async function obtener(clave, ahora = Date.now()) {
    const id = clave?.id;
    if (!id) return undefined;
    const registro = mensajes.get(id);
    if (!registro) return undefined;
    if (registro.vence <= ahora) {
      mensajes.delete(id);
      return undefined;
    }
    return registro.contenido;
  }

  return { guardar, obtener, cantidad: () => mensajes.size };
}

export function habilitarRegistroSalientes(sock, almacen) {
  if (!sock?.sendMessage || !almacen?.guardar) {
    throw new Error("Socket o caché de mensajes salientes no disponible");
  }
  const enviar = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const enviado = await enviar(...args);
    almacen.guardar(enviado);
    return enviado;
  };
  return sock;
}
