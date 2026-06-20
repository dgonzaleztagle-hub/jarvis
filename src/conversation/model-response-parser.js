// Recuperación de la salida del modelo cuando NO viene como JSON limpio:
// JSON truncado por maxTokens, texto plano con etiquetas, o errores del
// proveedor. Convierte lo que sea que llegó en un objeto de respuesta usable,
// en vez de volcarle al usuario llaves crudas o cortar a media frase.
// Extraído de conversation-runtime.js.

const { hasScannableStructure } = require('./conversation-intents');
const { compactText } = require('./conversation-presenter');

function buildModelFailureMessage(error) {
  const message = error?.message || 'MODEL_ERROR';
  if (/MODEL_JSON_PARSE_FAILED|not valid JSON|Unexpected token/i.test(message)) {
    return {
      speak: 'El modelo respondió de forma inconsistente y no pude cerrar bien la tarea.',
      visual: 'Voy a necesitar reintentar esa solicitud o endurecer mejor el formato interno para que Jarvis no se corte al responder.'
    };
  }

  if (/429|rate.?limit|quota/i.test(message)) {
    return {
      speak: 'El modelo externo está limitado en este momento.',
      visual: 'Parece un límite temporal de uso o cuota. Conviene reintentar en unos segundos o ajustar el proveedor/modelo.'
    };
  }

  if (/401|403|api[_ ]?key|missing/i.test(message)) {
    return {
      speak: 'No pude autenticar correctamente el modelo externo.',
      visual: 'Revisa la credencial o la configuración activa del proveedor.'
    };
  }

  return {
    speak: 'No pude contactar el modelo en este momento.',
    visual: ''
  };
}

function unescapeJsonString(value = '') {
  try { return JSON.parse(`"${value}"`); } catch (_) {
    return String(value).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t');
  }
}

// El modelo a veces devuelve el JSON cortado por maxTokens (string sin cerrar,
// llave sin cerrar). Acá rescatamos el "speak" (que casi siempre quedó completo)
// en vez de mostrarle al usuario el JSON crudo con \n literales.
function salvageTruncatedJson(text = '') {
  if (!/"speak"\s*:/.test(text)) return null;
  const speakMatch = text.match(/"speak"\s*:\s*"((?:[^"\\]|\\.)*)/);
  const speak = speakMatch ? unescapeJsonString(speakMatch[1]).trim() : '';
  if (!speak) return null;
  // visual solo si su string quedó completo (cierra comillas); cortado no sirve
  const visualMatch = text.match(/"visual"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const visual = visualMatch ? unescapeJsonString(visualMatch[1]).trim() : '';
  return { speak, visual };
}

function coercePlainModelText(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const salvaged = salvageTruncatedJson(text);
  if (salvaged) {
    return {
      speak: salvaged.speak,
      visual: salvaged.visual,
      format: hasScannableStructure(salvaged.visual) ? 'list' : 'brief',
      outputValue: {
        mode: 'response',
        requiresTransformation: false,
        rule: 'When the model returns truncated JSON, salvage the spoken synthesis instead of showing raw JSON.'
      },
      toolCalls: []
    };
  }
  // Si parece JSON pero no se pudo rescatar nada legible, mejor el mensaje de
  // falla limpio que volcar llaves y escapes al feed.
  if (/^[{\[]/.test(text)) return null;
  const labeledMatch = text.match(/respuesta:\s*([\s\S]*?)(?:\n+visual:\s*|visual:\s*)([\s\S]*)/i);
  if (labeledMatch) {
    const speak = String(labeledMatch[1] || '').trim();
    const visual = String(labeledMatch[2] || '').trim();
    return {
      speak: compactText(speak, 180),
      visual: visual || speak,
      format: /\n[-*]\s|\n\d+\.\s/.test(visual) ? 'list' : 'brief',
      outputValue: {
        mode: 'response',
        requiresTransformation: false,
        rule: 'When the model returns labeled plain text, strip internal labels before showing it.'
      },
      toolCalls: []
    };
  }
  const compact = text.replace(/\s+/g, ' ').trim();
  const [firstParagraph, ...rest] = text.split(/\n{2,}/).filter(Boolean);
  return {
    speak: compact.length > 180 ? `${compact.slice(0, 177).trim()}...` : compact,
    visual: rest.length > 0 ? [firstParagraph, ...rest].join('\n\n') : firstParagraph,
    format: /\n-|^\d+\./m.test(text) ? 'list' : 'brief',
    outputValue: {
      mode: 'response',
      requiresTransformation: false,
      rule: 'When the model misses JSON but returns useful plain language, preserve the value instead of failing hard.'
    },
    toolCalls: []
  };
}

module.exports = {
  buildModelFailureMessage,
  unescapeJsonString,
  salvageTruncatedJson,
  coercePlainModelText
};
