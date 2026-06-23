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
  },
  // Voces de los especialistas (Alex/Mara/Teo) — distintas entre sí y de la
  // voz default de Jarvis, para que "pásame a Mara" se sienta un agente
  // distinto hablando, no Jarvis leyendo el mismo texto con otro acento.
  alex_voice: {
    id: 'alex_voice',
    label: 'Alex (Diseño)',
    description: 'Voz del especialista de Diseño.',
    voice: 'es-AR-TomasNeural',
    rate: '+2%',
    volume: '+0%',
    pitch: '+0Hz'
  },
  mara_voice: {
    id: 'mara_voice',
    label: 'Mara (Marketing)',
    description: 'Voz de la especialista de Marketing.',
    voice: 'es-MX-DaliaNeural',
    rate: '+4%',
    volume: '+2%',
    pitch: '+2Hz'
  },
  teo_voice: {
    id: 'teo_voice',
    label: 'Teo (SEO/AEO)',
    description: 'Voz del especialista de SEO/AEO/GEO.',
    voice: 'es-CO-GonzaloNeural',
    rate: '-4%',
    volume: '+0%',
    pitch: '-2Hz'
  }
};

// La afinación guardada (voice.json) es la personalización de Daniel para SU
// perfil elegido — solo debe aplicarse cuando el perfil pedido coincide con
// el que guardó (o no se pidió ninguno, y se usa el guardado como default).
// Pedir explícitamente OTRO perfil (un especialista) no debe heredarla.
function shouldApplySavedTuning(requestedProfile, saved = {}) {
  return (requestedProfile || saved.profile) === saved.profile;
}

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
      //
      // OJO: la config guardada es la afinación de Daniel para SU perfil
      // elegido (voice.json guarda {profile, rate, volume, pitch} juntos, como
      // un combo). Si se pide explícitamente OTRO perfil (ej: un especialista
      // como Mara hablando con su propia voz), esa afinación NO debe heredarse
      // — encontrado en vivo: mara_voice salía con el mismo rate/pitch de
      // dark_lord, perdiendo el carácter propio que el preset le daba.
      const saved = options.dataDir ? loadVoiceConfig(options.dataDir) : {};
      const tuningApplies = shouldApplySavedTuning(voiceProfile, saved);
      const resolved = resolveVoiceProfile({
        profile: voiceProfile,
        voice,
        rate,
        volume,
        pitch
      }, { ...options, ...(tuningApplies ? saved : {}) });
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
  resolveVoiceProfile,
  shouldApplySavedTuning
};
