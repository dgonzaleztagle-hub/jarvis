const fs = require('fs');
const path = require('path');
const { loadEnvFile, getConfigValue } = require('../utils/env-file');

const LEGACY_PROJECT_DIR = 'C:\\proyectos\\jarvis-companion';

function createElevenLabsProvider(options = {}) {
  const legacyEnvPath = options.legacyEnvPath || process.env.JARVIS_LEGACY_ENV_PATH || path.join(LEGACY_PROJECT_DIR, '.env');
  const fallbackEnv = loadEnvFile(legacyEnvPath);

  const apiKey = options.apiKey || options.vault?.get('ELEVENLABS_API_KEY') || getConfigValue('ELEVENLABS_API_KEY', fallbackEnv);
  const voiceId = options.voiceId || options.vault?.get('ELEVENLABS_VOICE_ID') || getConfigValue('ELEVENLABS_VOICE_ID', fallbackEnv) || 'ErXwobaYiN019PkySvjV';
  const fetchImpl = options.fetchImpl || fetch;

  return {
    async synthesize({ text, outputDir }) {
      if (!apiKey) throw new Error('ELEVENLABS_API_KEY_MISSING');
      if (!text || !text.trim()) throw new Error('VOICE_TEXT_REQUIRED');

      fs.mkdirSync(outputDir, { recursive: true });
      const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: Number(options.vault?.get('ELEVENLABS_STABILITY') || getConfigValue('ELEVENLABS_STABILITY', fallbackEnv) || 0.75),
            similarity_boost: Number(options.vault?.get('ELEVENLABS_SIMILARITY') || getConfigValue('ELEVENLABS_SIMILARITY', fallbackEnv) || 0.85),
            style: 0
          }
        })
      });

      if (!response.ok) {
        throw new Error(`ELEVENLABS_HTTP_${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const fileName = `voice_${Date.now()}.mp3`;
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, buffer);
      return {
        fileName,
        filePath,
        bytes: buffer.length
      };
    }
  };
}

module.exports = {
  createElevenLabsProvider
};
