const path = require('path');
const { createEdgeTTSProvider } = require('./edge-tts-provider');

function createVoiceTools({ dataDir, providerOptions = {} }) {
  const provider = providerOptions.provider || createEdgeTTSProvider({ dataDir, ...providerOptions });
  const outputDir = path.join(dataDir, 'audio');

  return [
    {
      name: 'voice.speak',
      description: 'Generar audio con voz a partir de texto usando el proveedor TTS configurado.',
      risk: 'medium',
      permissions: ['voice:generate', 'model:external_tts'],
      execute: async (input) => provider.synthesize({
        text: input.text,
        outputDir,
        voiceProfile: input.voiceProfile,
        voice: input.voice,
        rate: input.rate,
        volume: input.volume,
        pitch: input.pitch
      })
    }
  ];
}

module.exports = {
  createVoiceTools
};
