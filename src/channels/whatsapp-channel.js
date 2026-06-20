// Canal WhatsApp personal vía Baileys (protocolo directo, sin navegador).
// Se vincula como un dispositivo más de la cuenta (multi-device), igual que
// WhatsApp Desktop: no interfiere con las sesiones web ya abiertas.
//
// Privacidad: el contenido de los mensajes vive SOLO en memoria (buffer
// acotado). Por el EventBus —que persiste a runtime.jsonl— van únicamente
// eventos de estado de conexión, nunca texto ni nombres de chats.

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const QR_FILE = 'whatsapp_qr.png';
const MAX_BUFFER = 100;

function extractText(message = {}) {
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage) return message.imageMessage.caption ? `[imagen] ${message.imageMessage.caption}` : '[imagen]';
  if (message.videoMessage) return message.videoMessage.caption ? `[video] ${message.videoMessage.caption}` : '[video]';
  if (message.audioMessage) return '[nota de voz]';
  if (message.documentMessage) return `[documento] ${message.documentMessage.fileName || ''}`.trim();
  if (message.stickerMessage) return '[sticker]';
  if (message.locationMessage) return '[ubicación]';
  if (message.contactMessage) return '[contacto compartido]';
  return null;
}

// Nombre coincide si es idéntico o si la query es una palabra completa del nombre.
// "daniel".includes("daniel") → ok, pero "daniela" NO contiene "daniel" como
// palabra completa — previene el falso match Daniela ↔ Daniel.
function matchesName(name, needle) {
  const n = name.toLowerCase();
  if (n === needle) return true;
  return n.split(/\s+/).includes(needle);
}

function toJid(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  // Celular chileno sin código de país (9 dígitos empezando en 9)
  if (digits.length === 9 && digits.startsWith('9')) digits = `56${digits}`;
  return `${digits}@s.whatsapp.net`;
}

class WhatsAppChannel {
  constructor({ dataDir, eventBus, contactResolver } = {}) {
    this.authDir = path.join(dataDir, 'whatsapp', 'auth');
    this.inboxDir = path.join(dataDir, 'inbox');
    this.eventBus = eventBus;
    this.contactResolver = contactResolver || (async () => null);
    this.sock = null;
    this.connected = false;
    this.starting = false;
    this.lastQrAt = null;
    this.lastError = null;
    // Buffer en memoria de mensajes entrantes: { jid, name, text, at, isGroup, seen }
    this.messages = [];
    // Libreta sincronizada por WhatsApp multi-device: jid -> nombre tal como
    // está guardado en el teléfono del usuario. Solo en memoria.
    this.contacts = new Map();
    this.debugFile = path.join(dataDir, 'whatsapp', 'debug.log');
    // Modo escucha reactiva: cuando está activo, cada mensaje entrante
    // emite whatsapp_incoming en el eventBus para que el runtime lo procese.
    this.watching = false;
    this.watchFilter = null; // null = todos los mensajes directos
  }

  hasSession() {
    return fs.existsSync(path.join(this.authDir, 'creds.json'));
  }

  status() {
    return {
      linked: this.hasSession(),
      connected: this.connected,
      pendingQr: Boolean(this.lastQrAt && !this.connected),
      unread: this.messages.filter((m) => !m.seen).length,
      contactsSynced: this.contacts.size,
      lastError: this.lastError
    };
  }

  async start() {
    if (this.starting || this.connected) return this.status();
    this.starting = true;
    try {
      const baileys = require('@whiskeysockets/baileys');
      const makeWASocket = baileys.default;
      const { useMultiFileAuthState, DisconnectReason } = baileys;
      const pino = require('pino');

      fs.mkdirSync(this.authDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Jarvis', 'Chrome', '1.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Diagnóstico: registrar QUÉ eventos llegan (solo nombres y conteos,
      // sin contenido) para entender por dónde viene la libreta.
      this.sock.ev.process((events) => {
        for (const [name, payload] of Object.entries(events)) {
          if (name === 'creds.update' || name === 'messages.upsert') continue;
          const size = Array.isArray(payload) ? payload.length
            : payload && typeof payload === 'object' ? Object.keys(payload).join('|')
            : typeof payload;
          this.debugLog(`event ${name} ${size}`);
        }
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          this.lastQrAt = new Date().toISOString();
          await this.publishQr(qr).catch((e) => { this.lastError = `QR_RENDER: ${e.message}`; });
        }
        if (connection === 'open') {
          this.connected = true;
          this.starting = false;
          this.lastError = null;
          this.cleanupQr();
          this.eventBus?.emit('whatsapp_status', { connected: true });
          // La libreta completa solo viaja en el pairing inicial; en
          // reconexiones hay que pedirla explícito (app-state sync).
          this.sock.resyncAppState?.(['critical_unblock_low'], true)
            .catch((e) => this.debugLog(`resyncAppState error: ${e.message}`));
        }
        if (connection === 'close') {
          this.connected = false;
          this.starting = false;
          const code = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
          this.eventBus?.emit('whatsapp_status', { connected: false, loggedOut: Boolean(loggedOut) });
          if (loggedOut) {
            // Sesión revocada desde el teléfono: limpiar credenciales para
            // que el próximo wa.link genere un QR nuevo en limpio.
            this.lastError = 'SESSION_LOGGED_OUT';
            try { fs.rmSync(this.authDir, { recursive: true, force: true }); } catch (_) {}
          } else {
            this.lastError = `DISCONNECTED_${code || 'unknown'}`;
            setTimeout(() => this.start().catch(() => {}), 5000);
          }
        }
      });

      this.sock.ev.on('contacts.upsert', (list) => this.captureContacts(list, 'upsert'));
      this.sock.ev.on('contacts.update', (list) => this.captureContacts(list, 'update'));
      this.sock.ev.on('messaging-history.set', (history) => {
        this.debugLog(`history.set keys=${Object.keys(history || {}).join(',')} contacts=${(history?.contacts || []).length} chats=${(history?.chats || []).length}`);
        this.captureContacts(history?.contacts, 'history');
        // Los chats individuales también traen nombre (el de la libreta)
        this.captureContacts(history?.chats, 'history-chats');
      });
      this.sock.ev.on('chats.upsert', (list) => this.captureContacts(list, 'chats-upsert'));

      this.sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages || []) {
          this.captureIncoming(msg);
        }
      });
    } catch (error) {
      this.starting = false;
      this.lastError = error.message;
      throw error;
    }
    return this.status();
  }

  // Diagnóstico local (nombres/jids NO van al log compartido del runtime)
  debugLog(line) {
    try {
      fs.mkdirSync(path.dirname(this.debugFile), { recursive: true });
      fs.appendFileSync(this.debugFile, `${new Date().toISOString()} ${line}\n`);
    } catch (_) {}
  }

  captureContacts(list, source = '?') {
    const items = list || [];
    if (items.length > 0) {
      this.debugLog(`captureContacts source=${source} count=${items.length} sample=${JSON.stringify(items.slice(0, 2))}`);
    }
    for (const contact of items) {
      const jid = contact.id || contact.jid;
      // WhatsApp migró a LIDs: los contactos llegan como ...@lid (y Baileys
      // acepta enviar a esos jids). Aceptar ambos formatos individuales.
      if (!jid || (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid'))) continue;
      // name = nombre de la libreta del usuario (autoridad); notify = nombre
      // de perfil que eligió el contacto. La libreta nunca se pisa con notify.
      const bookName = contact.name || contact.verifiedName;
      if (bookName) {
        this.contacts.set(jid, { name: String(bookName), fromBook: true });
      } else if (contact.notify && !this.contacts.get(jid)?.fromBook) {
        this.contacts.set(jid, { name: String(contact.notify), fromBook: false });
      }
    }
  }

  captureIncoming(msg) {
    const jid = msg.key?.remoteJid || '';
    if (!jid || jid === 'status@broadcast') return;
    if (msg.key?.fromMe) return;
    const text = extractText(msg.message || {});
    if (!text) return;
    const entry = {
      jid,
      name: msg.pushName || jid.split('@')[0],
      text: String(text).slice(0, 500),
      at: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
      isGroup: jid.endsWith('@g.us'),
      seen: false
    };
    this.messages.push(entry);
    if (this.messages.length > MAX_BUFFER) this.messages.splice(0, this.messages.length - MAX_BUFFER);

    if (this.watching && !entry.isGroup) {
      const nameLow = entry.name.toLowerCase();
      const passesFilter = !this.watchFilter
        || this.watchFilter.has(nameLow)
        || this.watchFilter.has(entry.jid.split('@')[0]);
      if (passesFilter) {
        this.eventBus?.emit('whatsapp_incoming', { jid: entry.jid, name: entry.name, text: entry.text, at: entry.at });
      }
    }
  }

  startWatching(filter = null) {
    this.watching = true;
    if (Array.isArray(filter) && filter.length > 0) {
      this.watchFilter = new Set(filter.map((f) => String(f).toLowerCase()));
    } else {
      this.watchFilter = null;
    }
    return this.watchStatus();
  }

  stopWatching() {
    this.watching = false;
    this.watchFilter = null;
    return this.watchStatus();
  }

  watchStatus() {
    return { watching: this.watching, filter: this.watchFilter ? [...this.watchFilter] : null };
  }

  // El QR va al HUD por el mismo camino que cualquier imagen del inbox.
  // Rota cada ~30s: cada rotación pisa el archivo y re-emite el evento.
  async publishQr(qr) {
    fs.mkdirSync(this.inboxDir, { recursive: true });
    const filePath = path.join(this.inboxDir, QR_FILE);
    await QRCode.toFile(filePath, qr, { width: 512, margin: 2 });
    this.eventBus?.emit('hud_show_file', {
      name: QR_FILE,
      url: `/inbox/${QR_FILE}`,
      kind: 'image'
    });
  }

  cleanupQr() {
    this.lastQrAt = null;
    try { fs.rmSync(path.join(this.inboxDir, QR_FILE), { force: true }); } catch (_) {}
  }

  listRecent({ limit = 10, onlyUnread = true } = {}) {
    const source = onlyUnread ? this.messages.filter((m) => !m.seen) : this.messages;
    const slice = source.slice(-Math.max(1, Math.min(limit, 30)));
    for (const m of slice) m.seen = true;
    return slice.map(({ name, text, at, isGroup }) => ({ name, text, at, isGroup }));
  }

  async resolveRecipient(to) {
    const raw = String(to || '').trim();
    if (!raw) return null;

    // 1. Número explícito
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length === raw.replace(/[\s+\-().]/g, '').length) {
      return { jid: toJid(digits), label: raw };
    }

    const needle = raw.toLowerCase();

    // 0. Auto-referencial: el usuario pide enviarse algo a sí mismo.
    // Baileys expone el JID de la cuenta vinculada en this.sock.user.id.
    if (['self', 'yo', 'mi numero', 'a mi', 'a mí'].includes(needle)) {
      const ownJid = this.sock?.user?.id;
      if (ownJid) return { jid: ownJid, label: 'tú (cuenta vinculada)' };
    }

    // 2. Chats recientes por nombre — word-boundary (no substring).
    // Evita que "Daniel" matchee a "Daniela" o cualquier nombre que lo contenga.
    const recent = [...this.messages].reverse()
      .find((m) => !m.isGroup && matchesName(m.name, needle));
    if (recent) return { jid: recent.jid, label: recent.name };

    // 3. Libreta sincronizada (nombres tal como están en el teléfono primero,
    // nombres de perfil después) — misma lógica word-boundary.
    let profileMatch = null;
    for (const [jid, entry] of this.contacts) {
      if (!matchesName(entry.name, needle)) continue;
      if (entry.fromBook) return { jid, label: entry.name };
      if (!profileMatch) profileMatch = { jid, label: entry.name };
    }
    if (profileMatch) return profileMatch;

    // 4. Contactos en memoria de Jarvis (teléfono guardado)
    const contact = await this.contactResolver(raw);
    const phone = contact?.phone || contact?.telephone;
    if (phone) {
      const jid = toJid(phone);
      if (jid) return { jid, label: contact.name || raw };
    }

    return null;
  }

  async sendMessage(to, message) {
    if (!this.connected || !this.sock) throw new Error('WHATSAPP_NOT_CONNECTED: vincula la sesión primero (wa.link)');
    const recipient = await this.resolveRecipient(to);
    if (!recipient?.jid) {
      throw new Error(`WHATSAPP_RECIPIENT_NOT_FOUND: "${to}" no aparece en chats recientes ni en contactos con teléfono. Puedes dar el número directo.`);
    }
    const text = String(message || '').trim();
    if (!text) throw new Error('WHATSAPP_EMPTY_MESSAGE');
    await this.sock.sendMessage(recipient.jid, { text });
    return { sent: true, to: recipient.label, chars: text.length };
  }

  stop() {
    try { this.sock?.end?.(); } catch (_) {}
    this.sock = null;
    this.connected = false;
    return this.status();
  }
}

module.exports = { WhatsAppChannel, toJid, extractText };
