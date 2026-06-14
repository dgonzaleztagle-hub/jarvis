// Lesson reinforcement — cierra el loop de aprendizaje.
//
// memory-learning.js CREA lecciones a partir de correcciones. Este módulo decide
// si una lección que ya estaba en juego FUNCIONÓ o no, mirando cómo reacciona
// Daniel en el turno siguiente, y ajusta su confianza/estado.
//
// Señal honesta, sin inventar emociones:
//   - El mensaje actual del usuario es la reacción al turno anterior.
//   - Si aprueba o sigue de largo sin corregir → las lecciones en juego funcionaron → sube confianza.
//   - Si corrige/reclama → la configuración de comportamiento de ese turno falló → baja confianza.
//
// El refuerzo es deliberadamente suave (nudges, no saltos): una lección buena
// se recupera con el uso; una que falla repetido se va degradando hasta que el
// ContextAssembler deja de inyectarla en Tier 0. Eso es el loop cerrándose:
// el resultado del refuerzo cambia lo que aparece en el prompt.

const STEP = {
  affirmation: 0.06,
  neutral: 0.02,
  correction: -0.08
};

const VERIFIED_FLOOR = 0.6;   // bajo esto, una lección verificada se degrada
const PROMOTE_AT = 0.85;      // sobre esto, una candidata se promueve a verificada
const LOW_AT = 0.35;          // bajo esto, marcar low_confidence

// Marcadores de aprobación explícita.
const AFFIRMATION = /\b(perfecto|genial|excelente|gracias|graci|buena|buen[ií]simo|exacto|correcto|eso es|as[ií] me gusta|me gusta|me encanta|bkn|filete|la lleva|justo|tal cual|impecable|de una)\b/i;

// Marcadores de corrección/reclamo. Conservador a propósito: es preferible
// perderse un refuerzo negativo que castigar injustamente una lección buena.
const CORRECTION = /\b(no,|no\s|mal\b|p[eé]simo|incorrecto|equivoc|te dije|otra vez|de nuevo|no as[ií]|no era|no quiero|no me gusta|no era eso|corrige|corr[ií]gelo|arregla|c[aá]mbialo|c[aá]mbia|qu[eé] hiciste|eso no|as[ií] no|nada que ver)\b/i;

function detectFeedbackPolarity(userText = '') {
  const text = String(userText || '').trim();
  if (!text) return 'neutral';
  // La corrección manda sobre la aprobación si ambas aparecen ("no, mejor así, gracias").
  if (CORRECTION.test(text)) return 'correction';
  if (AFFIRMATION.test(text)) return 'affirmation';
  return 'neutral';
}

// Tokens significativos para medir pertinencia (sin acentos, sin palabras
// cortas ni conectores comunes del español).
const STOPWORDS = new Set(['para', 'pero', 'porque', 'como', 'cuando', 'donde', 'esta', 'este', 'esto', 'esa', 'ese', 'eso', 'una', 'unos', 'unas', 'las', 'los', 'que', 'con', 'sin', 'por', 'sobre', 'desde', 'hasta', 'muy', 'mas', 'menos', 'solo', 'siempre', 'nunca', 'ahora', 'antes', 'despues', 'tambien', 'todo', 'toda', 'todos', 'todas', 'hacer', 'hace', 'tiene', 'tengo', 'quiero', 'puede', 'puedo', 'debe', 'debes', 'usuario', 'jarvis']);

function significantTokens(text = '') {
  return new Set(
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .split(/[^a-z0-9ñ]+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  );
}

function lessonMatchText(record) {
  const content = record?.content || {};
  return [
    record?.key,
    record?.title,
    content.principle,
    content.rule,
    content.preferredBehavior,
    Array.isArray(content.appliesTo) ? content.appliesTo.join(' ') : ''
  ].filter(Boolean).join(' ');
}

// Las lecciones que realmente influyeron el turno: las mismas que el
// ContextAssembler inyecta (verified en Tier 0 + recientes no rechazadas).
function selectLessonsInPlay(memoryStore) {
  if (!memoryStore?.list) return [];
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

  const verified = memoryStore.list({ type: 'behavior_lesson' })
    .filter((r) => r.state === 'verified')
    .slice(0, 4);

  const recent = memoryStore.list({ type: 'behavior_lesson' })
    .filter((r) => !['rejected', 'obsolete', 'verified'].includes(r.state))
    .filter((r) => r.updatedAt && new Date(r.updatedAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 3);

  return [...verified, ...recent].map((r) => {
    const full = memoryStore.get ? (memoryStore.get(r.id) || r) : r;
    return {
      id: r.id,
      key: r.key,
      confidence: typeof r.confidence === 'number' ? r.confidence : 0.6,
      state: r.state,
      matchText: lessonMatchText(full)
    };
  });
}

function nextState(currentState, confidence) {
  if (confidence >= PROMOTE_AT && currentState === 'candidate') return 'verified';
  if (currentState === 'verified' && confidence < VERIFIED_FLOOR) return 'low_confidence';
  if (confidence < LOW_AT && currentState !== 'verified') return 'low_confidence';
  return currentState;
}

function clampConfidence(value) {
  return Math.max(0, Math.min(0.99, Number(value) || 0));
}

// Ajusta las lecciones que estuvieron en juego el turno anterior según la
// reacción del usuario en el turno actual. No bloquea el camino en vivo.
//
// Invariante de pertinencia: una corrección es evidencia contra el
// comportamiento CORREGIDO, no contra todo lo que estaba en contexto.
// Sin este filtro, cada corrección genérica castigaba -0.08 a TODAS las
// lecciones en juego y aprendizajes buenos morían por fuego cruzado
// (caso real: rechazo_de_musica_matutina llegó a confianza 0 sin que
// ninguna corrección hablara de música). Las afirmaciones sí aplican
// amplio: subir suave lo que estaba en juego es de bajo riesgo.
function applyReinforcement({ memoryStore, previousLessons = [], polarity = 'neutral', userText = '' }) {
  if (!memoryStore?.updateState || !Array.isArray(previousLessons) || previousLessons.length === 0) {
    return [];
  }
  const step = STEP[polarity] ?? 0;
  if (step === 0) return [];

  let targets = previousLessons;
  if (polarity === 'correction') {
    const feedbackTokens = significantTokens(userText);
    targets = previousLessons.filter((lesson) => {
      const lessonTokens = significantTokens(lesson.matchText || lesson.key || '');
      for (const token of feedbackTokens) {
        if (lessonTokens.has(token)) return true;
      }
      return false;
    });
    // Sin lección pertinente no se castiga ninguna: la corrección igual
    // genera su propia lección nueva vía memory-learning.
    if (targets.length === 0) return [];
  }

  const adjusted = [];
  for (const lesson of targets) {
    if (!lesson?.id) continue;
    const newConfidence = clampConfidence((lesson.confidence ?? 0.6) + step);
    const newState = nextState(lesson.state, newConfidence);
    try {
      memoryStore.updateState(lesson.id, newState, { confidence: newConfidence });
      adjusted.push({ id: lesson.id, key: lesson.key, polarity, confidence: newConfidence, state: newState });
    } catch (_) {
      // Nunca romper el turno por un ajuste de memoria.
    }
  }
  return adjusted;
}

module.exports = {
  detectFeedbackPolarity,
  selectLessonsInPlay,
  applyReinforcement
};
