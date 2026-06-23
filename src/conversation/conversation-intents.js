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

// El usuario pidió una ACCIÓN (no una pregunta/charla) — vocabulario acotado
// de verbos imperativos que mapean a tools reales (enviar, guardar, crear...).
// Es léxico finito, no juicio de significado: por eso se hardcodea.
function isActionRequest(text = '') {
  return /\b(manda|mándale|env[ií]a|guarda|crea|cr[eé]ala|cr[eé]alo|agenda|public[ao]|elimina|borra|actualiz[ao]|reserva|programa|configura|sube|descarga|cancela|confirma|notifica|avisa)\b/i.test(String(text || ''));
}

// El modelo afirma que UNA ACCIÓN YA SE EJECUTÓ — vocabulario acotado de
// cierres de éxito en primera persona o pasiva ("lo envié", "quedó guardado",
// "funcionó correctamente"). Se combina con isActionRequest + cero toolCalls
// ejecutadas: si el usuario pidió una acción, no corrió NINGUNA tool, y el
// modelo de todas formas narra el cierre como si hubiera ocurrido, es una
// afirmación fabricada — no requiere entender el contenido, solo el patrón.
function claimsActionDone(text = '') {
  // Sin esto, \b después de una vocal acentuada (é, ó) no detecta el límite
  // de palabra en JS (\w no incluye acentos): "guardé " no matcheaba \bguard[ée]\b.
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return /\b(ya (lo |la )?(hice|envie|guarde|cree|agende|publique|elimine|actualice|reserve|programe|configure|confirme))\b/.test(t)
    || /\b(se|fue) (envio|guardo|creo|agendo|publico|elimino|actualizo|reservo|programo|configuro)\b/.test(t)
    || /\b(envi|guard|cre|agend|public|elimin|actualiz|reserv|program|configur)(ad[oa]) correctamente\b/.test(t)
    || /\bfunciono correctamente\b/.test(t)
    || /\bejecutad[oa] correctamente\b/.test(t)
    || /\bquedo (guardad[oa]|enviad[oa]|cread[oa]|agendad[oa]|publicad[oa]|actualizad[oa])\b/.test(t);
}

module.exports = {
  isAffirmativeConfirmation,
  isExplicitGoAhead,
  isCapabilitiesIntent,
  isInventoryIntent,
  hasScannableStructure,
  looksPromissory,
  endsComplete,
  isActionRequest,
  claimsActionDone
};
