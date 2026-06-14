const fs = require('fs');
const path = require('path');
const { Communicate } = require('edge-tts-universal');
const { loadVoiceConfig } = require('./voice-config');

const VOICE_PROFILES = {
  dark_lord: {
    id: 'dark_lord',
    label: 'Oscura',
    description: 'Más grave y dominante, la más cercana a una vibra tipo Vader.',
    voice: 'es-MX-JorgeNeural',
    rate: '-12%',
    volume: '+8%',
    pitch: '-18Hz'
  },
  commander: {
    id: 'commander',
    label: 'Comandante',
    description: 'Masculina firme y clara.',
    voice: 'es-ES-AlvaroNeural',
    rate: '-6%',
    volume: '+4%',
    pitch: '-6Hz'
  },
  chile_neural: {
    id: 'chile_neural',
    label: 'Chile',
    description: 'Voz chilena más natural y neutra.',
    voice: 'es-CL-CatalinaNeural',
    rate: '-2%',
    volume: '+0%',
    pitch: '+0Hz'
  }
};

function resolveVoiceProfile(input = {}, defaults = {}) {
  const requestedProfile = input.profile || input.voiceProfile || defaults.profile || 'dark_lord';
  const preset = VOICE_PROFILES[requestedProfile] || VOICE_PROFILES.dark_lord;
  return {
    profile: preset.id,
    voice: input.voice || defaults.voice || preset.voice,
    rate: input.rate || defaults.rate || preset.rate,
    volume: input.volume || defaults.volume || preset.volume,
    pitch: input.pitch || defaults.pitch || preset.pitch || '+0Hz'
  };
}

function createEdgeTTSProvider(options = {}) {
  return {
    async synthesize({ text, outputDir, voiceProfile, voice, rate, volume, pitch }) {
      if (!text || !String(text).trim()) {
        throw new Error('VOICE_TEXT_REQUIRED');
      }

      fs.mkdirSync(outputDir, { recursive: true });
      // Prioridad: input explícito > config guardada por el usuario (panel
      // del HUD, compartida entre canales) > defaults de opciones > preset.
      const saved = options.dataDir ? loadVoiceConfig(options.dataDir) : {};
      const resolved = resolveVoiceProfile({
        profile: voiceProfile,
        voice,
        rate,
        volume,
        pitch
      }, { ...options, ...saved });
      const comm = new Communicate(String(text), {
        voice: resolved.voice,
        rate: resolved.rate,
        volume: resolved.volume,
        pitch: resolved.pitch
      });
      const chunks = [];

      for await (const chunk of comm.stream()) {
        if (chunk.type === 'audio' && chunk.data) {
          chunks.push(chunk.data);
        }
      }

      const buffer = Buffer.concat(chunks);
      const fileName = `voice_${Date.now()}.mp3`;
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, buffer);

      return {
        provider: 'edge_tts',
        profile: resolved.profile,
        voice: resolved.voice,
        rate: resolved.rate,
        volume: resolved.volume,
        pitch: resolved.pitch,
        fileName,
        filePath,
        bytes: buffer.length
      };
    }
  };
}

module.exports = {
  createEdgeTTSProvider,
  VOICE_PROFILES,
  resolveVoiceProfile
};
