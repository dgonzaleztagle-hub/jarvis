// Tools wa.* sobre el canal WhatsApp personal.
//
// Contrato de envío (procedencia del contenido, generalizado en policy-engine
// vía tool.outbound + classifyProvenance — ver src/core/provenance.js):
// - Dictado literal — el texto del mensaje aparece en lo que el usuario dijo
//   ("dile a Rosie que diga te amo") → se envía directo, sin fricción.
// - Contenido compuesto — el texto lo redactó el modelo (resúmenes, borradores)
//   → confirmación obligatoria mostrando el borrador completo.
// La decisión de confirmar vive en el policy-engine (no depende de que el
// modelo se autodeclare) — ver classifyProvenance en src/core/provenance.js.

const { stripDeviceSuffix } = require('./whatsapp-channel');

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
      name: 'wa.start_watching',
      description: 'Activar modo escucha reactiva: Jarvis procesará automáticamente los mensajes directos entrantes de WhatsApp y responderá al remitente. Input opcional: { filter: ["nombre1", "nombre2"] } para limitar a contactos específicos. Sin filter = todos los mensajes directos (grupos excluidos siempre).',
      risk: 'medium',
      permissions: ['whatsapp:read', 'whatsapp:send'],
      execute: async (input = {}) => {
        const status = channel.status();
        if (!status.connected) return { ok: false, error: 'WhatsApp no está conectado. Usa wa.link primero.' };
        return { ok: true, ...channel.startWatching(input.filter || null), note: 'Modo escucha activo. Jarvis responderá mensajes entrantes automáticamente.' };
      }
    },
    {
      name: 'wa.stop_watching',
      description: 'Desactivar modo escucha reactiva. Jarvis dejará de responder automáticamente a mensajes entrantes de WhatsApp.',
      risk: 'low',
      permissions: [],
      execute: async () => ({ ok: true, ...channel.stopWatching(), note: 'Modo escucha desactivado.' })
    },
    {
      name: 'wa.send_message',
      description: 'Enviar un mensaje de WhatsApp desde la cuenta personal del usuario. Input: { to (nombre de contacto, número con código de país, o "self"/"yo" para enviarte algo a ti mismo), message (texto EXACTO a enviar) }. Si el usuario dictó el texto literal, se envía directo; si el texto lo redactaste tú, el runtime pedirá confirmación mostrando el borrador.',
      risk: 'high',
      outbound: true,
      permissions: ['whatsapp:send'],
      required: ['to', 'message'],
      // Resuelve el destinatario ANTES de la confirmación: el usuario ve el nombre
      // y número real en el diálogo de confirmación, no el string crudo del modelo.
      prepare: async (input) => {
        const raw = String(input.to || '').trim();
        if (!raw) return {};
        // Si ya es un número/email directo, no hay nada que resolver.
        if (/^[\d+][\d\s+\-().]{5,}$/.test(raw)) return {};
        try {
          const resolved = await channel.resolveRecipient(raw);
          if (!resolved?.jid) return {};
          const digits = resolved.jid.split('@')[0];
          return { to: `${resolved.label} (+${digits})`, _jid: resolved.jid };
        } catch (_) { return {}; }
      },
      execute: async (input) => {
        if (input._jid) {
          if (!channel.connected || !channel.sock) throw new Error('WHATSAPP_NOT_CONNECTED: vincula la sesión primero (wa.link)');
          const text = String(input.message || '').trim();
          if (!text) throw new Error('WHATSAPP_EMPTY_MESSAGE');
          // Normalizar el jid (sacar sufijo de dispositivo) y no mentir el éxito:
          // exigir ack del servidor, igual que channel.sendMessage.
          const jid = stripDeviceSuffix(input._jid);
          const sent = await channel.sock.sendMessage(jid, { text });
          if (!sent?.key?.id) throw new Error('WHATSAPP_SEND_NO_ACK: el envío no devolvió confirmación del servidor');
          return { sent: true, to: input.to, chars: text.length, messageId: sent.key.id };
        }
        return channel.sendMessage(input.to, input.message);
      }
    }
  ];
}

module.exports = { createWhatsAppTools };
