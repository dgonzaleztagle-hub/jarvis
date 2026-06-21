// Memoria de variaciones de diseño por cliente. El motor de variabilidad tira
// dados, pero "aleatorio" no es "diverso en el tiempo": sin memoria, dos
// landings del mismo cliente pueden caer en el mismo combo. Esto registra los
// combos usados por clave (marca/cliente) para que el próximo los EVITE.
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../core/atomic-json');

function storePath(dataDir) { return path.join(dataDir, 'design-variations.json'); }

function read(dataDir) {
  try { return JSON.parse(fs.readFileSync(storePath(dataDir), 'utf-8')); } catch (_) { return {}; }
}

function keyOf(raw) {
  return String(raw || 'default').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'default';
}

// Últimos N combos (firmas) usados para esa clave.
function recentCombos(dataDir, rawKey, n = 3) {
  const s = read(dataDir);
  return (s[keyOf(rawKey)] || []).slice(-n);
}

function recordCombo(dataDir, rawKey, comboSig) {
  if (!comboSig) return;
  const key = keyOf(rawKey);
  const s = read(dataDir);
  const list = s[key] || [];
  list.push(comboSig);
  s[key] = list.slice(-10); // historial acotado
  try { writeJsonAtomic(storePath(dataDir), s); } catch (_) { /* best-effort */ }
}

module.exports = { recentCombos, recordCombo, keyOf };
