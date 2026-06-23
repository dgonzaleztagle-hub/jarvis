const test = require('node:test');
const assert = require('node:assert/strict');
const { VOICE_PROFILES, resolveVoiceProfile, shouldApplySavedTuning } = require('../src/voice/edge-tts-provider');

test('shouldApplySavedTuning: la afinacion guardada NO se hereda si se pide otro perfil explicito', () => {
  const saved = { profile: 'dark_lord', rate: '+20%', volume: '+8%', pitch: '-18Hz' };
  // Caso real: Daniel afino dark_lord, y luego Mara habla con su propio perfil.
  assert.equal(shouldApplySavedTuning('mara_voice', saved), false);
  // Sin pedir perfil explicito, o pidiendo el mismo que se guardo, SI aplica.
  assert.equal(shouldApplySavedTuning(undefined, saved), true);
  assert.equal(shouldApplySavedTuning('dark_lord', saved), true);
});

test('resolveVoiceProfile + tuning guardado: mara_voice conserva su propio rate/pitch, no el de dark_lord afinado', () => {
  const saved = { profile: 'dark_lord', rate: '+20%', volume: '+8%', pitch: '-18Hz' };

  // Mismo bug real reproducido: si se mezclara "saved" sin filtrar, esto
  // saldria con rate +20% (de Daniel) en vez del +4% propio de mara_voice.
  const tuningApplies = shouldApplySavedTuning('mara_voice', saved);
  const resolvedMara = resolveVoiceProfile(
    { profile: 'mara_voice' },
    tuningApplies ? saved : {}
  );
  assert.equal(resolvedMara.voice, VOICE_PROFILES.mara_voice.voice);
  assert.equal(resolvedMara.rate, VOICE_PROFILES.mara_voice.rate);
  assert.equal(resolvedMara.pitch, VOICE_PROFILES.mara_voice.pitch);

  // Dark_lord (el perfil de Daniel) SI debe sonar con su afinacion guardada.
  const tuningAppliesDark = shouldApplySavedTuning('dark_lord', saved);
  const resolvedDark = resolveVoiceProfile({ profile: 'dark_lord' }, tuningAppliesDark ? saved : {});
  assert.equal(resolvedDark.rate, '+20%');
  assert.equal(resolvedDark.pitch, '-18Hz');
});

test('los 3 perfiles de especialistas existen y usan voces distintas entre si y de dark_lord', () => {
  const voices = ['alex_voice', 'mara_voice', 'teo_voice'].map((id) => VOICE_PROFILES[id].voice);
  assert.equal(new Set([...voices, VOICE_PROFILES.dark_lord.voice]).size, 4, 'las 4 voces deben ser distintas entre si');
});
