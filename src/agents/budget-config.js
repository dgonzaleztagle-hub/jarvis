// Tope diario GLOBAL de gasto (todos los agentes combinados) — distinto del
// tope por-agente que ya existe (agent-store.js: maxCostPerDayUsd/costToday).
// Vive en su propio archivo, NO en el directorio de agentes (agent-store.list()
// parsea cualquier .json de esa carpeta como receta de agente).
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../core/atomic-json');

class BudgetConfig {
  constructor({ dataDir }) {
    this.filePath = path.join(dataDir, 'agents-budget.json');
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); }
    catch (_) { return { globalDailyCapUsd: null }; }
  }

  getGlobalDailyCap() {
    const cap = this.read().globalDailyCapUsd;
    return typeof cap === 'number' ? cap : null;
  }

  setGlobalDailyCap(usd) {
    const cap = usd === null || usd === undefined ? null : Math.max(0, Number(usd));
    writeJsonAtomic(this.filePath, { globalDailyCapUsd: cap });
    return cap;
  }
}

module.exports = { BudgetConfig };
