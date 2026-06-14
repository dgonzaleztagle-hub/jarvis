// Motor de procedencia: ¿el contenido que una acción va a ejecutar lo definió
// el USUARIO (lo dictó literal) o lo COMPUSO el LLM?
//
// Generaliza el contrato de procedencia que ya regía solo para WhatsApp
// (isLiteralDictation) a cualquier acción. La idea de producto (Daniel,
// 2026-06-14): la confirmación no debería dispararse por el riesgo abstracto de
// la herramienta, sino por la AUTORÍA — "envía 'voy llegando' a Rosie" lo
// definió el usuario (ejecutar directo); "resume esto y envíaselo al cliente"
// lo redacta el LLM (confirmar). Este módulo SOLO clasifica; no decide la
// confirmación (eso es del policy-engine, cuando se decida activarlo).

// Campos cuyo nombre indica "texto destinado a salir" (a un tercero o a un
// archivo): es el contenido cuya autoría importa. Lecturas/listados no tienen.
const CONTENT_FIELD = /^(message|body|text|content|summary|caption|comment|description|reply|note|mensaje|cuerpo|texto|resumen|contenido|nota)$/i;

// Longitud mínima para considerar un match como "dictado literal" real y no una
// coincidencia trivial ("ok", "si"). Frases cortas se tratan como no decisivas.
const MIN_LITERAL_LEN = 12;

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ¿El texto aparece literalmente en lo que dijo el usuario?
function isLiterallyFromUser(value, userText) {
  const v = normalizeForMatch(value);
  const u = normalizeForMatch(userText);
  if (!v || !u) return false;
  if (v.length < MIN_LITERAL_LEN) {
    // Frases muy cortas: solo cuentan como literales si son palabra-por-palabra
    // un subconjunto exacto (evita falsos positivos pero no penaliza "voy ya").
    return u.includes(v);
  }
  return u.includes(v);
}

// Recorre el input (hasta 2 niveles) y junta los valores string de campos cuyo
// nombre sugiere contenido destinado a salir.
function collectContentFields(input, depth = 0, bucket = []) {
  if (!input || typeof input !== 'object' || depth > 2) return bucket;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && CONTENT_FIELD.test(key) && value.trim()) {
      bucket.push({ field: key, value });
    } else if (value && typeof value === 'object') {
      collectContentFields(value, depth + 1, bucket);
    }
  }
  return bucket;
}

// Clasifica la procedencia del CONTENIDO de una acción.
// → { provenance: 'user_defined' | 'llm_composed' | 'no_content', composedFields, contentFields }
//   - no_content: la acción no lleva contenido destinado a salir (lecturas,
//     listados, toggles). La dimensión de procedencia no aplica.
//   - user_defined: todo el contenido aparece literal en lo que dijo el usuario.
//   - llm_composed: al menos un campo de contenido lo compuso el LLM.
function classifyProvenance({ input = {}, userText = '' } = {}) {
  const fields = collectContentFields(input);
  if (fields.length === 0) {
    return { provenance: 'no_content', composedFields: [], contentFields: 0 };
  }
  const composedFields = fields
    .filter((f) => !isLiterallyFromUser(f.value, userText))
    .map((f) => f.field);

  return {
    provenance: composedFields.length === 0 ? 'user_defined' : 'llm_composed',
    composedFields,
    contentFields: fields.length
  };
}

module.exports = {
  classifyProvenance,
  isLiterallyFromUser,
  normalizeForMatch,
  collectContentFields
};
