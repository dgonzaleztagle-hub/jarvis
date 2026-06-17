const fs = require('fs');
const path = require('path');

// this.history en ConversationRuntime vive solo en memoria (tope 12 entradas)
// y se pierde al reiniciar el proceso. Este store persiste cada turno en un
// JSONL append-only para poder restaurar el contexto reciente al arrancar.
class HistoryStore {
  constructor({ dataDir }) {
    this.logDir = path.join(dataDir, 'logs');
    this.logPath = path.join(this.logDir, 'conversation-history.jsonl');
    this.statePath = path.join(this.logDir, 'conversation-state.json');
    this.evictedPath = path.join(this.logDir, 'conversation-evicted.jsonl');
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  append({ role, text }) {
    const entry = { role, text, at: new Date().toISOString() };
    fs.appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
    return entry;
  }

  loadRecent(limit = 12) {
    if (!fs.existsSync(this.logPath)) return [];
    const lines = fs.readFileSync(this.logPath, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        const { role, text } = JSON.parse(line);
        return { role, parts: [{ text }] };
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }

  // Para "¿qué te dije hace un rato?": busca en TODO el log persistido, no
  // solo en this.history (que se recorta a 6 turnos). Filtra por ventana de
  // tiempo y/o substring de texto, sin distinción de mayúsculas/acentos.
  search({ query = '', sinceMinutes, limit = 10 } = {}) {
    if (!fs.existsSync(this.logPath)) return [];
    const lines = fs.readFileSync(this.logPath, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
    const cutoff = sinceMinutes ? Date.now() - sinceMinutes * 60 * 1000 : null;
    const term = String(query || '').trim().toLowerCase();

    const entries = lines.map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);

    return entries
      .filter((entry) => !cutoff || new Date(entry.at).getTime() >= cutoff)
      .filter((entry) => !term || String(entry.text || '').toLowerCase().includes(term))
      .slice(-limit);
  }

  // Estado persistente de sesión: resumen rolling + pendingIntent.
  // Sobrevive reinicios del proceso.
  saveState({ summary = null, pendingIntent = null } = {}) {
    const state = { summary, pendingIntent, updatedAt: new Date().toISOString() };
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  loadState() {
    if (!fs.existsSync(this.statePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
    } catch (_) {
      return {};
    }
  }

  // Buffer de turnos eviccionados esperando ser incorporados al resumen rolling.
  // Cada entrada es { role, text } igual que el JSONL principal.
  appendEvicted(turns) {
    for (const turn of turns) {
      const text = turn.parts?.[0]?.text || '';
      if (!text) continue;
      const entry = { role: turn.role, text };
      fs.appendFileSync(this.evictedPath, `${JSON.stringify(entry)}\n`, 'utf-8');
    }
  }

  loadEvicted() {
    if (!fs.existsSync(this.evictedPath)) return [];
    const lines = fs.readFileSync(this.evictedPath, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
    return lines.map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  }

  clearEvicted() {
    if (fs.existsSync(this.evictedPath)) fs.writeFileSync(this.evictedPath, '', 'utf-8');
  }
}

module.exports = { HistoryStore };
