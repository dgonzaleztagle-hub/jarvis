const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('../utils/env-file');

const LEGACY_PROJECT_DIR = 'C:\\proyectos\\jarvis-companion';

const SECRET_KEYS = [
  'GEMINI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_STABILITY',
  'ELEVENLABS_SIMILARITY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_USER_ID'
];

function importLegacyCredentials({ vault, legacyDir = LEGACY_PROJECT_DIR } = {}) {
  if (!vault) throw new Error('VAULT_REQUIRED');

  const imported = [];
  const envPath = path.join(legacyDir, '.env');
  const env = loadEnvFile(envPath);

  for (const key of SECRET_KEYS) {
    if (!env[key]) continue;
    vault.set(key, env[key], {
      source: 'legacy_env',
      legacyPath: envPath
    });
    imported.push({ name: key, source: 'legacy_env' });
  }

  const googleTokenPath = path.join(legacyDir, '.google-tokens.json');
  if (fs.existsSync(googleTokenPath)) {
    const tokens = JSON.parse(fs.readFileSync(googleTokenPath, 'utf-8'));
    vault.set('GOOGLE_OAUTH_TOKENS', tokens, {
      source: 'legacy_google_tokens',
      legacyPath: googleTokenPath
    });
    imported.push({ name: 'GOOGLE_OAUTH_TOKENS', source: 'legacy_google_tokens' });
  }

  return {
    imported,
    count: imported.length
  };
}

module.exports = {
  importLegacyCredentials,
  SECRET_KEYS
};
