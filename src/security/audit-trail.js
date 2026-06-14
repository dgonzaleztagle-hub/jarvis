const fs = require('fs');
const path = require('path');

// Registro auditable de TODA ejecución de herramienta: qué se intentó, con qué
// riesgo, qué decidió la política (permitir / pedir confirmación / denegar) y
// cómo terminó (ok / error). Separado del runtime.jsonl crudo (que mezcla todos
// los eventos): este es el rastro de gobernanza consultable — la base para
// responder "¿qué hizo Jarvis en mi nombre?" y para aprender auto-aprobaciones.

const SENSITIVE_KEY = /token|secret|api.?key|authorization|password|credential|cookie/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(inner);
  }
  return out;
}

function compactInput(input) {
  // El audit guarda forma, no payloads enormes: trunca strings largas para que
  // el rastro sea legible y no se llene con cuerpos de correo o documentos.
  const serialized = JSON.stringify(redact(input ?? {}));
  return serialized.length > 600 ? `${serialized.slice(0, 597)}...` : serialized;
}

class AuditTrail {
  constructor({ dataDir }) {
    this.logDir = path.join(dataDir, 'logs');
    this.auditPath = path.join(this.logDir, 'audit.jsonl');
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  // outcome: 'ok' | 'error' | 'denied' | 'confirmation_required' | 'invalid_input'
  record({ tool, risk, outcome, channel, input, error, requiresConfirmation } = {}) {
    const entry = {
      tool: tool || 'unknown',
      risk: risk || 'low',
      outcome: outcome || 'ok',
      channel: channel || 'unknown',
      requiresConfirmation: !!requiresConfirmation,
      input: input === undefined ? null : compactInput(input),
      error: error || null,
      at: new Date().toISOString()
    };
    try {
      fs.appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf-8');
    } catch (_) {
      // El audit nunca debe romper la ejecución de la herramienta.
    }
    return entry;
  }

  readAll() {
    if (!fs.existsSync(this.auditPath)) return [];
    return fs.readFileSync(this.auditPath, 'utf-8')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);
  }

  query({ tool, outcome, channel, since, limit = 50 } = {}) {
    const sinceMs = since ? new Date(since).getTime() : null;
    const rows = this.readAll().filter((e) => {
      if (tool && e.tool !== tool) return false;
      if (outcome && e.outcome !== outcome) return false;
      if (channel && e.channel !== channel) return false;
      if (sinceMs && new Date(e.at).getTime() < sinceMs) return false;
      return true;
    });
    return rows.slice(-Math.max(1, Math.min(limit, 500))).reverse();
  }

  stats() {
    const rows = this.readAll();
    const byOutcome = {};
    const byTool = {};
    for (const e of rows) {
      byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
      byTool[e.tool] = (byTool[e.tool] || 0) + 1;
    }
    return { total: rows.length, byOutcome, byTool };
  }

  // Cuántas veces seguidas se ejecutó OK una tool sin denegaciones intermedias.
  // Semilla para el futuro aprendizaje de auto-aprobación (Fase C+): si el
  // usuario aprueba lo mismo N veces, sugerir una regla de auto-aprobado.
  consecutiveApprovals(toolName) {
    const rows = this.readAll().filter((e) => e.tool === toolName);
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].outcome === 'ok') count += 1;
      else break;
    }
    return count;
  }
}

module.exports = { AuditTrail, redact };
