// Tools wa.* sobre el canal WhatsApp personal.
//
// Contrato de envío (procedencia del contenido, enforced en policy-engine):
// - Dictado literal — el texto del mensaje aparece en lo que el usuario dijo
//   ("dile a Rosie que diga te amo") → se envía directo, sin fricción.
// - Contenido compuesto — el texto lo redactó el modelo (resúmenes, borradores)
//   → confirmación obligatoria mostrando el borrador completo.
// La distinción la verifica isLiteralDictation en código; no depende de que
// el modelo se autodeclare.

function normalizeForDictation(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLiteralDictation(message, userText) {
  const m = normalizeForDictation(message);
  const u = normalizeForDictation(userText);
  return m.length > 0 && u.includes(m);
}

function createWhatsAppTools({ channel }) {
  return [
    {
      name: 'wa.status',
      description: 'Estado del canal WhatsApp personal: si está vinculado, conectado y cuántos mensajes sin revisar hay.',
      risk: 'low',
      permissions: [],
      execute: async () => channel.status()
    },
    {
      name: 'wa.link',
      description: 'Vincular WhatsApp personal: inicia la sesión y muestra el QR de vinculación en el HUD para escanearlo con el teléfono (WhatsApp > Dispositivos vinculados). Úsalo si wa.status dice que no está vinculado o conectado.',
      risk: 'medium',
      permissions: ['whatsapp:link'],
      execute: async () => {
        const status = channel.status();
        if (status.connected) return { ...status, note: 'Ya está vinculado y conectado.' };
        await channel.start();
        return { ...channel.status(), note: 'Si no estaba vinculado, el QR aparecerá en el HUD en unos segundos.' };
      }
    },
    {
      name: 'wa.check_messages',
      description: 'Revisar mensajes nuevos de WhatsApp recibidos mientras Jarvis está conectado. Input opcional: { limit (default 10), onlyUnread (default true; false para repasar los últimos aunque ya se revisaron) }. Devuelve quién escribió, qué dijo y cuándo.',
      risk: 'low',
      permissions: ['whatsapp:read'],
      execute: async (input = {}) => {
        const status = channel.status();
        if (!status.connected) {
          return { connected: false, messages: [], note: 'WhatsApp no está conectado. Usa wa.link para vincular.' };
        }
        const messages = channel.listRecent({
          limit: input.limit,
          onlyUnread: input.onlyUnread !== false
        });
        return { connected: true, count: messages.length, messages };
      }
    },
    {
      name: 'wa.send_message',
      description: 'Enviar un mensaje de WhatsApp desde la cuenta personal del usuario. Input: { to (nombre de contacto/chat reciente o número con código de país), message (texto EXACTO a enviar) }. Si el usuario dictó el texto literal, se envía directo; si el texto lo redactaste tú, el runtime pedirá confirmación mostrando el borrador.',
      risk: 'medium',
      outbound: true,
      permissions: ['whatsapp:send'],
      execute: async (input) => channel.sendMessage(input.to, input.message)
    }
  ];
}

module.exports = { createWhatsAppTools, isLiteralDictation, normalizeForDictation };
