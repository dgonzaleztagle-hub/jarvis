const fs = require('fs');
const path = require('path');
const { loadEnvFile, getConfigValue } = require('../utils/env-file');
const { transcribeAudio } = require('../voice/stt-gemini');
const { mp3ToVoiceOgg } = require('../voice/audio-convert');

const LEGACY_PROJECT_DIR = 'C:\\proyectos\\jarvis-companion';

class TelegramChannel {
  constructor({ conversationRuntime, fetchImpl = fetch, legacyEnvPath, vault, dataDir, ttsProvider } = {}) {
    this.conversationRuntime = conversationRuntime;
    this.fetch = fetchImpl;
    this.legacyEnvPath = legacyEnvPath || process.env.JARVIS_LEGACY_ENV_PATH || path.join(LEGACY_PROJECT_DIR, '.env');
    this.fallbackEnv = loadEnvFile(this.legacyEnvPath);
    this.vault = vault;
    this.token = (this.vault?.get('TELEGRAM_BOT_TOKEN') || getConfigValue('TELEGRAM_BOT_TOKEN', this.fallbackEnv)).trim();
    this.allowedUserId = (this.vault?.get('TELEGRAM_ALLOWED_USER_ID') || getConfigValue('TELEGRAM_ALLOWED_USER_ID', this.fallbackEnv)).trim();
    this.inboxDir = dataDir ? path.join(dataDir, 'inbox') : null;
    this.audioDir = dataDir ? path.join(dataDir, 'audio') : null;
    // TTS para responder con nota de voz (espejo: voz entra → voz sale)
    this.ttsProvider = ttsProvider || null;
    this.pollingActive = false;
    this.offset = 0;
    this.lastError = null;
  }

  status() {
    return {
      configured: Boolean(this.token),
      pollingActive: this.pollingActive,
      allowedUserConfigured: Boolean(this.allowedUserId),
      lastError: this.lastError
    };
  }

  async sendMessage(chatId, text) {
    if (!this.token) throw new Error('TELEGRAM_TOKEN_MISSING');
    const chunks = [];
    let remaining = String(text || '');
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, 4000));
      remaining = remaining.slice(4000);
    }
    if (chunks.length === 0) chunks.push('');

    for (const chunk of chunks) {
      const response = await this.fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk
        })
      });
      if (!response.ok) throw new Error(`TELEGRAM_SEND_${response.status}`);
    }
  }

  // Envía una nota de voz nativa (burbuja con waveform). Telegram exige
  // OGG/Opus para eso — la conversión la hace audio-convert antes de llamar.
  async sendVoice(chatId, oggPath) {
    if (!this.token) throw new Error('TELEGRAM_TOKEN_MISSING');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', new Blob([fs.readFileSync(oggPath)], { type: 'audio/ogg' }), 'voice.ogg');
    const response = await this.fetch(`https://api.telegram.org/bot${this.token}/sendVoice`, {
      method: 'POST',
      body: form
    });
    if (!response.ok) throw new Error(`TELEGRAM_SENDVOICE_${response.status}`);
  }

  // Espejo de voz: sintetiza el speak (edge-tts → MP3), convierte a OGG/Opus
  // y lo manda como nota de voz. Si algo falla, cae a texto — nunca silencio.
  async replyWithVoice(chatId, speak, fallbackText) {
    const text = String(speak || '').trim();
    if (!text || !this.ttsProvider || !this.audioDir) {
      await this.sendMessage(chatId, fallbackText || text || 'Tarea procesada.');
      return { voice: false };
    }
    try {
      const synth = await this.ttsProvider.synthesize({ text, outputDir: this.audioDir });
      const oggPath = synth.filePath.replace(/\.mp3$/i, '.ogg');
      await mp3ToVoiceOgg(synth.filePath, oggPath);
      await this.sendVoice(chatId, oggPath);
      try { fs.rmSync(synth.filePath); fs.rmSync(oggPath); } catch (_) {}
      return { voice: true };
    } catch (error) {
      await this.sendMessage(chatId, fallbackText || text);
      return { voice: false, error: error.message };
    }
  }

  // Descarga un archivo de Telegram a la bandeja local (local_data/inbox/).
  async downloadToInbox(fileId, suggestedName) {
    if (!this.inboxDir) throw new Error('TELEGRAM_INBOX_NOT_CONFIGURED');
    const metaRes = await this.fetch(`https://api.telegram.org/bot${this.token}/getFile?file_id=${fileId}`);
    if (!metaRes.ok) throw new Error(`TELEGRAM_GETFILE_${metaRes.status}`);
    const meta = await metaRes.json();
    const remotePath = meta.result?.file_path;
    if (!remotePath) throw new Error('TELEGRAM_FILE_PATH_MISSING');

    const fileRes = await this.fetch(`https://api.telegram.org/file/bot${this.token}/${remotePath}`);
    if (!fileRes.ok) throw new Error(`TELEGRAM_DOWNLOAD_${fileRes.status}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    fs.mkdirSync(this.inboxDir, { recursive: true });
    const safeName = `${Date.now()}_${String(suggestedName || path.basename(remotePath)).replace(/[^\w.\-]+/g, '_')}`;
    const filePath = path.join(this.inboxDir, safeName);
    fs.writeFileSync(filePath, buffer);
    return { name: safeName, path: filePath, bytes: buffer.length };
  }

  async handleUpdate(update) {
    const msg = update?.message;
    if (!msg) return { ignored: true, reason: 'no_message' };

    const userId = String(msg.from?.id || '');
    const chatId = msg.chat?.id;
    if (this.allowedUserId && userId !== this.allowedUserId) {
      await this.sendMessage(chatId, 'Acceso no autorizado. Jarvis ha bloqueado esta solicitud.');
      return { ignored: true, reason: 'unauthorized' };
    }

    // Nota de voz entrante → espejo completo: transcribir (Gemini STT),
    // procesar como conversación normal, y responder con nota de voz.
    if (msg.voice || msg.audio) {
      const audioMeta = msg.voice || msg.audio;
      try {
        const saved = await this.downloadToInbox(audioMeta.file_id, `voz_${msg.message_id}.oga`);
        const geminiKey = (this.vault?.get('GEMINI_API_KEY') || getConfigValue('GEMINI_API_KEY', this.fallbackEnv) || '').trim();
        const transcript = await transcribeAudio({ filePath: saved.path, apiKey: geminiKey, fetchImpl: this.fetch });
        try { fs.rmSync(saved.path); } catch (_) {}

        const task = await this.conversationRuntime.handleMessage({
          text: transcript,
          channel: 'telegram',
          context: { telegram: { chatId, userId }, inputMode: 'voice' }
        });

        const speak = task.result?.speak || '';
        const visual = String(task.result?.visual || '').trim();
        const sent = await this.replyWithVoice(chatId, speak, visual || speak);
        // El detalle estructurado no se lee en voz alta: va como texto aparte
        if (sent.voice && visual && visual !== speak) {
          await this.sendMessage(chatId, visual);
        }
        return { ignored: false, taskId: task.id, transcript, voiceReply: sent.voice };
      } catch (error) {
        await this.sendMessage(chatId, `No pude procesar tu nota de voz: ${error.message}`);
        return { ignored: true, reason: 'voice_processing_failed' };
      }
    }

    // Fotos y documentos van a la bandeja local. Si traen caption, el caption
    // sigue el flujo conversacional con el archivo como contexto.
    const media = msg.photo?.length
      ? { fileId: msg.photo[msg.photo.length - 1].file_id, name: `foto_${msg.message_id}.jpg` }
      : msg.document
        ? { fileId: msg.document.file_id, name: msg.document.file_name || `doc_${msg.message_id}` }
        : null;

    if (media) {
      try {
        const saved = await this.downloadToInbox(media.fileId, media.name);
        const caption = String(msg.caption || '').trim();
        if (!caption) {
          await this.sendMessage(chatId, `Recibido: ${saved.name} quedó guardado en tu bandeja local.`);
          return { ignored: false, savedFile: saved.name };
        }
        const task = await this.conversationRuntime.handleMessage({
          text: `[El usuario envió un archivo por Telegram que quedó guardado en la bandeja local como "${saved.name}"] ${caption}`,
          channel: 'telegram',
          context: { telegram: { chatId, userId }, inboxFile: saved }
        });
        await this.sendMessage(chatId, task.result?.speak || task.result?.visual || `Recibido: ${saved.name}.`);
        return { ignored: false, savedFile: saved.name, taskId: task.id };
      } catch (error) {
        await this.sendMessage(chatId, `No pude guardar el archivo: ${error.message}`);
        return { ignored: true, reason: 'media_download_failed' };
      }
    }

    const text = msg.text || '';
    if (!text.trim()) return { ignored: true, reason: 'empty_text' };

    const task = await this.conversationRuntime.handleMessage({
      text,
      channel: 'telegram',
      context: {
        telegram: {
          chatId,
          userId
        }
      }
    });

    const reply = [
      task.result?.visual,
      task.result?.speak && task.result?.visual !== task.result?.speak ? task.result.speak : ''
    ].filter(Boolean).join('\n\n') || 'Tarea procesada.';

    await this.sendMessage(chatId, reply);
    return { ignored: false, taskId: task.id, status: task.status };
  }

  async pollOnce() {
    if (!this.token) throw new Error('TELEGRAM_TOKEN_MISSING');
    const response = await this.fetch(`https://api.telegram.org/bot${this.token}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset: this.offset,
        timeout: 30,
        allowed_updates: ['message']
      })
    });

    if (!response.ok) throw new Error(`TELEGRAM_UPDATES_${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(`TELEGRAM_UPDATES_NOT_OK`);

    for (const update of data.result || []) {
      this.offset = update.update_id + 1;
      await this.handleUpdate(update);
    }

    return { count: (data.result || []).length, offset: this.offset };
  }

  start() {
    if (!this.token) throw new Error('TELEGRAM_TOKEN_MISSING');
    if (this.pollingActive) return this.status();
    this.pollingActive = true;

    const loop = async () => {
      while (this.pollingActive) {
        try {
          await this.pollOnce();
          this.lastError = null;
        } catch (error) {
          this.lastError = error.message;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    };

    loop();
    return this.status();
  }

  stop() {
    this.pollingActive = false;
    return this.status();
  }
}

module.exports = {
  TelegramChannel
};
