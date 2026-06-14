const path = require('path');
const { createEdgeTTSProvider } = require('./edge-tts-provider');

function createVoiceTools({ dataDir, providerOptions = {} }) {
  const provider = providerOptions.provider || createEdgeTTSProvider({ dataDir, ...providerOptions });
  const outputDir = path.join(dataDir, 'audio');

  return [
    {
      name: 'voice.speak',
      description: 'Generate a local voice artifact using the configured TTS provider.',
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
