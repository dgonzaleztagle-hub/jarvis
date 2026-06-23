// Contrato compartido de los módulos-agente (departamentos built-in: Diseño,
// Marketing, SEO, ...). Se extrae recién con el 3er módulo (regla del
// proyecto: generalizar al segundo caso real, no antes) — antes de esto cada
// index.js repetía la misma forma sin nada que la garantizara.
//
// No es un framework pesado: solo valida que el contrato no se desvíe
// (campos requeridos, tools es array) y devuelve el objeto tal cual.
function defineModule({ name, displayName, specialistName, expertise, tools, voiceProfile, tone }) {
  if (!name) throw new Error('defineModule requiere "name"');
  if (!displayName) throw new Error('defineModule requiere "displayName"');
  if (!specialistName) throw new Error('defineModule requiere "specialistName"');
  if (!Array.isArray(tools)) throw new Error('defineModule requiere "tools" como array');

  // Perfil de voz del especialista (uno de VOICE_PROFILES en edge-tts-provider.js).
  // Opcional: sin esto el turno habla con la voz default de Jarvis — así un
  // módulo nuevo no rompe nada si todavía no le asignaron una voz propia.
  //
  // tone: cómo HABLA el especialista (registro/personalidad), distinto de
  // "expertise" (qué sabe/qué tools usa). Jarvis base es seco/estructurado a
  // propósito (Vader); los especialistas deben sonar fluidos, como personas
  // normales con personalidad propia — esto es lo que lo logra, inyectado
  // como override de registro cuando el modelo declara este especialista
  // activo (ver buildVoiceSwitchBlock en conversation-runtime.js).
  //
  // No hay "isRelevant": qué especialista aplica cada turno lo decide el
  // propio modelo en su JSON de respuesta (campo "specialist"), no un regex de
  // palabras clave por módulo — ver buildModuleRoster en conversation-prompts.js.
  return { name, displayName, specialistName, expertise: expertise || '', tools, voiceProfile: voiceProfile || null, tone: tone || '' };
}

module.exports = { defineModule };
