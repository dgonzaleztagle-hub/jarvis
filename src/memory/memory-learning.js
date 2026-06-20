const { inferMemoryIntent, slugify } = require('./memory-store');

/* ── Invariantes del aprendiz ──────────────────────────────────────────────────
   1. AUTORIDAD: lo que Jarvis puede o no puede hacer lo define el runtime
      (tool registry / runtime-self-knowledge), nunca la conversación. Si el
      modelo alucina "no tengo acceso a X" y el aprendiz lo guarda, esa
      alucinación se inyecta como contexto en el turno siguiente y se refuerza
      sola — cada vez más seguro de algo falso. Por eso el dominio completo
      "capacidades/límites del asistente" está vetado para la memoria
      conversacional, sin importar el tipo, el intent ni la redacción.
   2. PROCEDENCIA: solo las palabras del usuario sustentan un 'verified'. Lo
      que el asistente dijo o concluyó no es evidencia de nada — a lo más
      produce un 'candidate' que el usuario puede confirmar después.
   ──────────────────────────────────────────────────────────────────────────── */

const ASSISTANT_SELF_CLAIM = new RegExp(
  [
    // sujeto asistente + predicado de capacidad/acceso/límite
    '\\b(jarvis|el asistente|asistente)\\b[^.]{0,60}\\b(no\\s+)?(pued[eoa]n?|puedo|tien[en]+\\s+acceso|tengo\\s+acceso|acced(er|o)|capacidad(es)?|limitaci[oó]n(es)?|capaz|incapaz)\\b',
    // primera persona del asistente sobre acceso/capacidad
    '\\b(no\\s+)?(tengo|puedo)\\s+(acceso|acceder)\\b',
    '\\bno\\s+puedo\\b',
    // claves/tags en inglés que denotan el mismo dominio
    '\\b(capabilit(y|ies)|limitation|cannot_do|can_do|no_access)\\b'
  ].join('|'),
  'i'
);

function isAssistantSelfClaim(item) {
  const haystack = [
    item.key,
    item.title,
    (item.tags || []).join(' '),
    (item.aliases || []).join(' '),
    JSON.stringify(item.content || {})
  ].join(' ');
  return ASSISTANT_SELF_CLAIM.test(haystack);
}

function normalizeForMatch(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ¿La evidencia citada por el extractor está realmente en las palabras del
// usuario? Comparación laxa (sin tildes, espacios colapsados) sobre un
// fragmento inicial, para tolerar cortes.
function evidenceGroundedInUser(item, userText) {
  const evidence = normalizeForMatch(item.evidence || '');
  if (evidence.length < 8) return false;
  return normalizeForMatch(userText).includes(evidence.slice(0, 60));
}

// Nombres propios / identificadores (clientes, proyectos, dominios) que
// aparecen en el `content` extraído. El extractor trabaja con contexto
// limitado y puede "completar" un nombre plausible desde su conocimiento
// general (ej: un cliente conocido de Daniel) en vez del que realmente
// está activo en esta conversación.
function extractProperNouns(value, out = new Set()) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/g)) out.add(m[0]);
    for (const m of value.matchAll(/\b[a-z0-9-]+\.(?:cl|com|net|org|io|app)\b/gi)) out.add(m[0]);
  } else if (Array.isArray(value)) {
    for (const v of value) extractProperNouns(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) extractProperNouns(v, out);
  }
  return out;
}

// Invariante de procedencia para entidades: cualquier nombre propio/dominio
// que el item introduzca en su `content` debe poder rastrearse al contexto
// real de la conversación (lo que dijo el usuario en este turno o en los
// turnos recientes), no solo a "conocimiento general" del modelo. Si el
// extractor etiqueta el contenido con un cliente/proyecto que no aparece en
// ningún lado del contexto, no hay forma de saber si es el correcto.
function contentGroundedInContext(item, contextText) {
  const nouns = extractProperNouns(item.content);
  if (nouns.size === 0) return true;
  const haystack = normalizeForMatch(contextText);
  for (const noun of nouns) {
    if (!haystack.includes(normalizeForMatch(noun))) return false;
  }
  return true;
}

function hasMeaningfulContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulContent(item));
  if (typeof value === 'object') {
    return Object.values(value).some((item) => hasMeaningfulContent(item));
  }
  return false;
}

function inferPreferenceHeuristics(text = '') {
  const lower = String(text).toLowerCase();
  const items = [];

  if (
    (lower.includes('no quiero') || lower.includes('no me gusta') || lower.includes('no seas optimista')) &&
    (lower.includes('optimista') || lower.includes('crítico') || lower.includes('critico'))
  ) {
    items.push({
      key: 'user_preference_critical_feedback',
      title: 'Preferencia de feedback crítico',
      type: 'preference',
      state: 'verified',
      confidence: 0.96,
      tags: ['feedback', 'critical_thinking'],
      aliases: ['critico', 'critico y no optimista', 'feedback real'],
      content: {
        preference: 'critical_feedback',
        value: 'El usuario prefiere crítica real y no optimismo automático.'
      }
    });
  }

  if (lower.includes('generalista') || lower.includes('no especifico') || lower.includes('no específico')) {
    items.push({
      key: 'user_preference_generalize_fixes',
      title: 'Preferencia por soluciones generalistas',
      type: 'preference',
      state: 'verified',
      confidence: 0.97,
      tags: ['reasoning', 'bug_fixing'],
      aliases: ['generalista', 'forma de pensar general'],
      content: {
        preference: 'generalize_fixes',
        value: 'El usuario quiere arreglos que corrijan el patrón general y no solo el ejemplo puntual.'
      }
    });
  }

  if (
    lower.includes('lista') ||
    lower.includes('legible') ||
    lower.includes('resumen real') ||
    lower.includes('accion sugerida') ||
    lower.includes('acción sugerida')
  ) {
    items.push({
      key: 'user_preference_structured_outputs',
      title: 'Preferencia por salidas estructuradas',
      type: 'preference',
      state: 'verified',
      confidence: 0.94,
      tags: ['presentation', 'format'],
      aliases: ['listas', 'salidas legibles', 'accion sugerida'],
      content: {
        preference: 'structured_outputs',
        value: 'El usuario prefiere listas legibles, resúmenes reales y acción sugerida.'
      }
    });
  }

  return items;
}

function inferBehaviorLessonHeuristics(text = '') {
  const lower = String(text || '').toLowerCase();
  const items = [];

  if (
    (lower.includes('no tienes por qué') || lower.includes('no teni por que') || lower.includes('no hace falta')) &&
    (lower.includes('tarjeta') || lower.includes('contacto') || lower.includes('mostrar') || lower.includes('colocar'))
  ) {
    items.push({
      key: 'lesson_hide_internal_explanations_when_result_is_clean',
      title: 'No exponer explicaciones internas innecesarias',
      type: 'behavior_lesson',
      state: 'verified',
      confidence: 0.95,
      tags: ['presentation', 'judgment', 'abstraction'],
      aliases: ['no ser literal al presentar', 'mostrar resultado limpio', 'no explicar mecanica interna'],
      content: {
        principle: 'Cuando la corrección ya quedó aplicada al resultado final, muestra el resultado limpio y evita explicar la mecánica interna salvo que el usuario lo pida.',
        preferredBehavior: 'Presentar el dato corregido sin aclaraciones redundantes.',
        appliesTo: ['contacts', 'lists', 'summaries', 'artifacts'],
        whenUnsure: 'Si la aclaración puede cambiar el significado, preguntar antes de mostrar.'
      }
    });
  }

  if (
    lower.includes('no seas tan literal') ||
    lower.includes('usa mas criterio') ||
    lower.includes('usa más criterio') ||
    lower.includes('deberia ser de esta manera') ||
    lower.includes('debería ser de esta manera')
  ) {
    items.push({
      key: 'lesson_prefer_judgment_over_literalism',
      title: 'Usar criterio por encima de literalidad torpe',
      type: 'behavior_lesson',
      state: 'verified',
      confidence: 0.94,
      tags: ['judgment', 'presentation', 'reasoning'],
      aliases: ['no ser literal', 'criterio general', 'presentacion inteligente'],
      content: {
        principle: 'Si el usuario corrige una salida por torpe o demasiado literal, prioriza el criterio de presentación y la intención real por encima de repetir la formulación exacta.',
        preferredBehavior: 'Entender qué quiso lograr el usuario con la corrección y aplicar esa regla en casos parecidos.',
        appliesTo: ['presentation', 'contacts', 'email_summaries', 'workspace_artifacts'],
        whenUnsure: 'Si no está claro cómo generalizar la corrección, preguntar una sola vez y aprender de la respuesta.'
      }
    });
  }

  return items;
}

async function extractMemoriesWithModel({ userText, assistantResult, toolResults, modelProvider, existingKeys = [], recentHistory = '' }) {
  if (!modelProvider?.generateJson) return [];

  // Skip extraction for trivial inputs — confirmations, one-word replies, etc.
  const trimmed = String(userText || '').trim();
  if (trimmed.length < 12) return [];

  const intent = inferMemoryIntent(userText);

  const extraction = await modelProvider.generateJson({
    system: `Eres el módulo de memoria de Jarvis. Tu trabajo es decidir qué vale la pena recordar permanentemente después de un turno de conversación.

Devuelve exclusivamente JSON válido:
{
  "items": [
    {
      "key": "clave_snake_case_estable",
      "title": "titulo breve",
      "type": "contact | preference | business_context | task_pattern | knowledge | behavior_lesson",
      "state": "verified | candidate",
      "confidence": 0.0,
      "tags": ["tag"],
      "aliases": ["alias"],
      "content": {},
      "evidence": "cita textual de las palabras del USUARIO que sustenta este item"
    }
  ]
}

REGLA DE PROCEDENCIA (crítica): "evidence" debe ser una cita literal de lo que escribió el USUARIO en este turno. Lo que respondió el asistente NO es evidencia de nada: el asistente puede equivocarse, y memorizar sus propias afirmaciones convierte un error en "hecho". Si un item solo se sustenta en lo que dijo el asistente, NO lo incluyas.

REGLA DE ENTIDADES (crítica): si "content" nombra un cliente, proyecto, dominio o persona, ese nombre debe aparecer textualmente en "userText" o en "[contexto reciente]" de abajo. NO completes el nombre desde tu conocimiento general de los clientes/proyectos de Daniel — si el turno habla de "la página"/"el resultado"/"eso" sin nombrar el proyecto, usa una clave/título genéricos (sin nombre de cliente) en vez de adivinar a cuál de los proyectos de Daniel se refiere.

QUÉ SÍ guardar (conocimiento duradero y reutilizable):
- Datos de contacto declarados por el usuario (nombre, email, relación)
- Preferencias explícitas del usuario sobre comportamiento, formato, herramientas
- Contexto de negocio estable (clientes, dominios, proyectos activos)
- Correcciones del usuario sobre cómo debe comportarse Jarvis → behavior_lesson
- Patrones de tarea recurrentes

QUÉ NO guardar — NUNCA:
- La hora actual, la fecha actual, timestamps de la conversación
- CUALQUIER afirmación sobre lo que el asistente puede o no puede hacer, sus accesos, límites o capacidades — aunque el propio asistente lo haya dicho en su respuesta. La fuente de verdad de las capacidades es el runtime, no la conversación.
- Resultados de tools: datos de email, eventos de calendario, contenido web — son efímeros
- Frases del asistente ("Jarvis respondió que...", "Jarvis dijo...")
- Inferencias débiles sin evidencia directa del usuario
- Duplicados de lo que ya existe (claves existentes: ${existingKeys.slice(0, 30).join(', ')})

Reglas de confianza:
- verified (0.85+): el usuario lo declaró explícitamente
- candidate (0.5-0.84): inferido con señales claras
- Nunca uses confidence > 0.85 para inferencias

Máximo 3 items. Si no hay nada que valga la pena guardar, devuelve items: [].`,
    messages: [
      {
        role: 'user',
        parts: [{
          text: JSON.stringify({
            userText,
            intent,
            recentHistory: recentHistory.slice(0, 600),
            assistantSpeak: assistantResult?.speak?.slice(0, 200) || '',
            toolsUsed: (toolResults || []).map((item) => item.toolName)
          })
        }]
      }
    ],
    temperature: 0.1,
    maxTokens: 600,
    purpose: 'memory_learning'
  });

  return Array.isArray(extraction.data?.items) ? extraction.data.items : [];
}

async function learnFromConversationTurn({ userText, assistantResult, toolResults, memoryStore, modelProvider, recentHistory = '' }) {
  const intent = inferMemoryIntent(userText);

  // Heuristics still fire for explicit correction patterns — they're fast and precise
  const heuristicItems = inferPreferenceHeuristics(userText);
  const heuristicLessons = inferBehaviorLessonHeuristics(userText);

  // Pass existing keys so the model avoids extracting duplicates
  const existingKeys = (memoryStore?.list?.() || []).map((m) => m.key).filter(Boolean);

  let modelItems = [];
  try {
    modelItems = await extractMemoriesWithModel({
      userText,
      assistantResult,
      toolResults,
      modelProvider,
      existingKeys,
      recentHistory
    });
  } catch (_) {
    modelItems = [];
  }

  // Las heurísticas son regex sobre las palabras del usuario: nacen grounded.
  // Lo extraído por modelo debe demostrar procedencia (invariante 2) y, si
  // nombra entidades (cliente/proyecto/dominio), procedencia de entidad
  // (invariante 3: el nombre debe rastrearse al contexto real, no inventarse).
  const groundedHeuristics = [...heuristicItems, ...heuristicLessons];
  const contextText = `${userText} ${recentHistory} ${assistantResult?.speak || ''}`;
  const provenanceChecked = modelItems.map((item) => {
    if (evidenceGroundedInUser(item, userText) && contentGroundedInContext(item, contextText)) return item;
    // Sin evidencia en las palabras del usuario, o con una entidad inventada:
    // nunca 'verified'. Queda como candidato de baja confianza que el usuario
    // puede confirmar después.
    return {
      ...item,
      state: 'candidate',
      confidence: Math.min(Number(item.confidence) || 0.6, 0.6)
    };
  });

  const merged = [...groundedHeuristics, ...provenanceChecked]
    .filter((item) => item && item.title && item.type)
    .filter((item) => hasMeaningfulContent(item.content))
    .filter((item) => {
      if (item.type === 'assistant_self_knowledge') return false;
      // Invariante 1: el dominio "qué puede/no puede hacer el asistente" está
      // vetado para la memoria conversacional, sin importar tipo ni redacción.
      if (isAssistantSelfClaim(item)) return false;
      // Hard block: never store ephemeral/time data regardless of what the model says
      if (/hora.?actual|tiempo.?actual|current.?time|fecha.?actual/i.test(item.title || '')) return false;
      if (intent === 'capability' && item.type === 'knowledge') return false;
      if (intent === 'capability' && item.content && (item.content.can_do || item.content.cannot_do)) return false;
      // Confidence floor — don't store noise
      if ((item.confidence || 0) < 0.5 && item.state !== 'verified') return false;
      return true;
    })
    .slice(0, 4);

  const stored = [];
  for (const item of merged) {
    const record = memoryStore.upsert({
      key: item.key || slugify(item.title),
      title: item.title,
      type: item.type,
      state: item.state || 'candidate',
      confidence: item.confidence || 0.6,
      sensitivity: item.sensitivity || 'normal',
      tags: item.tags || [],
      aliases: item.aliases || [],
      sourceRefs: [{
        kind: 'conversation_turn',
        capturedAt: new Date().toISOString(),
        excerpt: userText.slice(0, 240)
      }],
      content: item.content || {}
    });
    stored.push(record);
  }

  return stored;
}

module.exports = {
  learnFromConversationTurn
};
