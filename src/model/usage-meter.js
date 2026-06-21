const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../core/atomic-json');
const { dayKey } = require('../utils/time');

class UsageMeter {
  constructor({ dataDir }) {
    this.usagePath = path.join(dataDir, 'model-usage.json');
    fs.mkdirSync(path.dirname(this.usagePath), { recursive: true });
  }

  read() {
    if (!fs.existsSync(this.usagePath)) {
      return { entries: [], totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    }
    return JSON.parse(fs.readFileSync(this.usagePath, 'utf-8'));
  }

  write(data) {
    writeJsonAtomic(this.usagePath, data);
  }

  record(entry) {
    const data = this.read();
    const normalized = {
      provider: entry.provider,
      model: entry.model,
      inputTokens: Number(entry.inputTokens || 0),
      outputTokens: Number(entry.outputTokens || 0),
      cacheWriteTokens: Number(entry.cacheWriteTokens || 0),
      cacheReadTokens: Number(entry.cacheReadTokens || 0),
      costUsd: Number(entry.costUsd || 0),
      durationMs: Number(entry.durationMs || 0),
      purpose: entry.purpose || 'generate_json',
      createdAt: new Date().toISOString()
    };
    data.entries.push(normalized);
    if (data.entries.length > 1000) data.entries = data.entries.slice(-1000);
    data.totals = data.entries.reduce(
      (totals, item) => ({
        inputTokens: totals.inputTokens + item.inputTokens,
        outputTokens: totals.outputTokens + item.outputTokens,
        costUsd: totals.costUsd + item.costUsd
      }),
      { inputTokens: 0, outputTokens: 0, costUsd: 0 }
    );
    this.write(data);
    return normalized;
  }

  // Gasto total (todos los propósitos/agentes) en un día de Chile (default
  // hoy). Para el tope diario GLOBAL — el tope por-agente ya existe aparte
  // (agent-store.js) y no necesita esto, porque su delta es por corrida.
  getCostForDate(dateKeyValue = dayKey()) {
    const data = this.read();
    return data.entries
      .filter((e) => dayKey(new Date(e.createdAt)) === dateKeyValue)
      .reduce((sum, e) => sum + (Number(e.costUsd) || 0), 0);
  }

  summary() {
    const data = this.read();
    return {
      totals: {
        inputTokens: data.totals.inputTokens,
        outputTokens: data.totals.outputTokens,
        costUsd: Number(data.totals.costUsd.toFixed(6))
      },
      latency: this.latencyByPurpose(data.entries),
      recent: data.entries.slice(-50).reverse()
    };
  }

  // Latencia por propósito sobre las últimas 200 llamadas medidas.
  // count/avg/p95 son lo mínimo para saber dónde duele de verdad.
  latencyByPurpose(entries = []) {
    const measured = entries.filter((e) => e.durationMs > 0).slice(-200);
    const byPurpose = {};
    for (const e of measured) {
      (byPurpose[e.purpose] = byPurpose[e.purpose] || []).push(e.durationMs);
    }
    const stats = {};
    for (const [purpose, list] of Object.entries(byPurpose)) {
      const sorted = [...list].sort((a, b) => a - b);
      stats[purpose] = {
        count: sorted.length,
        avgMs: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
        p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      };
    }
    return stats;
  }
}

module.exports = {
  UsageMeter
};
