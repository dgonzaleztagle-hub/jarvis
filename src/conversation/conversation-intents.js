// Clasificadores de intención sobre el texto del usuario o de la respuesta.
// Puros (sin estado, sin `this`): regex acotadas que el runtime consulta para
// decidir formato, confirmación o si una respuesta quedó a medias. Extraído de
// conversation-runtime.js para mantener el runtime enfocado en orquestación.

function isAffirmativeConfirmation(text = '') {
  return /^(si|sí|confirmo|confirmar|dale|ok|okay|acepto|envialo|envíalo|procede|hazlo|adelante)$/i.test(String(text).trim());
}

// Visto bueno explícito DENTRO del mensaje que dispara la acción ("me gusta
// la idea, vamos con ello"). Cuenta como confirmación para tools de riesgo
// high en este mismo turno: el usuario ya dijo que sí, no se le pregunta de
// nuevo. No aplica a critical ni anula reglas de procedencia (policy-engine).
function isExplicitGoAhead(text = '') {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return /\b(vamos con (ello|eso|esa|todo)|dale(?: no mas)?|hazlo|hagamoslo|procede|adelante|apruebo|confirmo|crealo|creala|ejecutalo|manos a la obra|si,? (hazlo|dale|procede|crealo))\b/.test(t);
}

function isCapabilitiesIntent(text = '') {
  return /\b(capacidades?|que puedes hacer|qué puedes hacer|que sabes hacer|qué sabes hacer|superpoderes|funciones?|habilidades?)\b/i.test(String(text));
}

function isInventoryIntent(text = '') {
  return /\b(capacidades?|que puedes hacer|qué puedes hacer|que sabes hacer|qué sabes hacer|superpoderes|funciones?|habilidades?|lista|listar|opciones|qué hay disponible|que hay disponible)\b/i.test(String(text));
}

function hasScannableStructure(text = '') {
  return /\n[-*]\s|\n\d+\.\s|:\n/.test(String(text || ''));
}

function looksPromissory(text = '') {
  return /\b(te cuento|te explico|te detallo|te muestro|te lo resumo|ahora te digo|claro[,.\s]+señor)\b/i.test(String(text || ''));
}

function endsComplete(text = '') {
  return /[.!?…)"»]\s*$/.test(String(text || '').trim());
}

module.exports = {
  isAffirmativeConfirmation,
  isExplicitGoAhead,
  isCapabilitiesIntent,
  isInventoryIntent,
  hasScannableStructure,
  looksPromissory,
  endsComplete
};
