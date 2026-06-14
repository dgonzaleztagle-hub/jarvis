const fs = require('fs');

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};

  const parsed = {};
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function getConfigValue(name, fallbackEnv = {}) {
  return process.env[name] || fallbackEnv[name] || '';
}

module.exports = {
  loadEnvFile,
  getConfigValue
};
