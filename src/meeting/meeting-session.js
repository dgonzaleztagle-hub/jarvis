// Estado de una sesión de reunión. Singleton: una reunión activa a la vez.
// No se persiste al disco — si el servidor reinicia, la sesión se pierde
// (aceptable para Fase 1; la minuta final va a Docs).

let _active = null;

class MeetingSession {
  constructor({ title = 'Reunión' } = {}) {
    this.id = `mtg_${Date.now()}`;
    this.title = title;
    this.startedAt = new Date().toISOString();
    this.endedAt = null;
    this.chunks = []; // [{ index, text, timestamp }]
    this.chunkIndex = 0;
  }

  addChunk(text) {
    const entry = { index: this.chunkIndex++, text: text.trim(), timestamp: new Date().toISOString() };
    this.chunks.push(entry);
    return entry;
  }

  getTranscript() {
    return this.chunks.map((c) => c.text).filter(Boolean).join('\n');
  }

  stop() {
    this.endedAt = new Date().toISOString();
    return this;
  }

  get isActive() {
    return !this.endedAt;
  }

  toStatus() {
    const durationMs = this.endedAt
      ? new Date(this.endedAt) - new Date(this.startedAt)
      : Date.now() - new Date(this.startedAt);
    return {
      id: this.id,
      title: this.title,
      active: this.isActive,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      chunks: this.chunks.length,
      durationSeconds: Math.round(durationMs / 1000)
    };
  }
}

function startSession(opts) {
  if (_active?.isActive) throw new Error('MEETING_ALREADY_ACTIVE');
  _active = new MeetingSession(opts);
  return _active;
}

function getSession() { return _active; }

function clearSession() { _active = null; }

module.exports = { startSession, getSession, clearSession, MeetingSession };
