const fs = require('fs');
const path = require('path');

class FileLogger {
  constructor({ dataDir }) {
    this.logDir = path.join(dataDir, 'logs');
    this.logPath = path.join(this.logDir, 'runtime.jsonl');
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  write(type, payload = {}) {
    const entry = {
      type,
      payload: this.redact(payload),
      createdAt: new Date().toISOString()
    };
    fs.appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
    return entry;
  }

  redact(value) {
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (!value || typeof value !== 'object') return value;

    const redacted = {};
    for (const [key, inner] of Object.entries(value)) {
      if (/token|secret|api.?key|authorization|password|credential/i.test(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = this.redact(inner);
      }
    }
    return redacted;
  }

  tail(limit = 200) {
    if (!fs.existsSync(this.logPath)) return [];
    const lines = fs.readFileSync(this.logPath, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return { type: 'log_parse_error', payload: { line }, createdAt: null };
      }
    });
  }
}

module.exports = {
  FileLogger
};
