// Config de voz compartida por todos los canales (HUD, Telegram, futuros).
// Una sola fuente de verdad en disco: lo que el usuario guarda en el panel
// del HUD es exactamente lo que suena en cualquier parte.

const fs = require('fs');
const path = require('path');

const ALLOWED_KEYS = ['profile', 'voice', 'rate', 'volume', 'pitch'];

function configPath(dataDir) {
  return path.join(dataDir, 'config', 'voice.json');
}

function sanitize(raw = {}) {
  const out = {};
  for (const key of ALLOWED_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

function loadVoiceConfig(dataDir) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(configPath(dataDir), 'utf8')));
  } catch (_) {
    return {};
  }
}

function saveVoiceConfig(dataDir, partial = {}) {
  const merged = { ...loadVoiceConfig(dataDir), ...sanitize(partial) };
  const file = configPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { loadVoiceConfig, saveVoiceConfig };
