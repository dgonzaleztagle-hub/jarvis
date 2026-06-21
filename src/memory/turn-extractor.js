const { inferMemoryIntent } = require('./memory-store');
const { learnFromConversationTurn } = require('./memory-learning');
const { extractGraphFromTurn } = require('./graph-extractor');

// ── Extractor unificado del turno ──────────────────────────────────────────────
// Antes el aprendizaje post-turno hacía DOS llamadas al modelo, secuenciales:
// una para la memoria de perfil (memory-learning) y otra para el grafo de
// conocimiento (graph-extractor). Ambas reciben el mismo texto y repiten los
// mismos invariantes (procedencia, autoridad del runtime, nada efímero, nombres
// canónicos): pagábamos dos veces por decir lo mismo, y serializado.
//
// Este módulo hace UNA sola llamada que devuelve las dos formas en buckets
// separados, y reparte el resultado a los dos pipelines de SIEMPRE. La red de
// seguridad es que los guardas reales son CÓDIGO (procedencia/grounding/filtros
// en memory-learning; ephemeral/self/assistant-claim en storeExtraction), no el
// prompt — así que un prompt fusionado que siga peor las instrucciones queda
// atajado igual. Si la llamada unificada falla, degrada al camino viejo de dos
// llamadas (cada función hace la suya): cero regresión de capacidad.

function buildUnifiedPrompt({ userText, assistantText, intent, existingKeys, existingNames, recentHistory }) {
  const known = existingNames.length
    ? `\nENTIDADES YA CONOCIDAS (reusa el nombre EXACTO si el turno se refiere a una; no inventes variantes):\n${existingNames.slice(0, 40).join(', ')}\n`
    : '';
  const keys = existingKeys.length
    ? `\nCLAVES DE MEMORIA YA EXISTENTES (no las dupliques): ${existingKeys.slice(0, 30).join(', ')}\n`
    : '';

  return `Eres el módulo de memoria de Jarvis. Tras un turno de conversación decides qué vale la pena recordar permanentemente, en DOS formas complementarias:
(A) memory — perfil del usuario: contactos, preferencias, contexto de negocio, patrones de tarea y lecciones de comportamiento.
(B) graph — el mundo del usuario como grafo: entidades, hechos duraderos, relaciones y compromisos.

INVARIANTES (valen para AMBAS formas, son críticos):
- PROCEDENCIA: solo las palabras del USUARIO sustentan algo verificado. Lo que dijo el asistente puede estar mal; NO es evidencia. Si algo solo se apoya en lo que respondió el asistente, no lo guardes (a lo más queda como candidato).
- AUTORIDAD: lo que Jarvis puede/no puede hacer, sus accesos, límites, capacidades o errores los define el RUNTIME, nunca la conversación. NUNCA guardes esas afirmaciones en ninguna de las dos formas, aunque el propio asistente las haya dicho.
- EFÍMERO: nada de hora/fecha actual, timestamps, resultados de tools (emails, eventos, web), estados de conexión/vinculación, conteos del momento ("33 acciones hoy"). Eso caduca; no es conocimiento.
- NOMBRES CANÓNICOS: si un cliente/proyecto/persona ya es conocido, reusa su nombre exacto. NO completes nombres desde tu conocimiento general: si el turno dice "la página"/"eso" sin nombrarlo, usa claves/títulos genéricos en vez de adivinar.

Devuelve EXCLUSIVAMENTE JSON válido (sin markdown), con esta forma:
{
  "memory": {
    "items": [
      { "key": "snake_case_estable", "title": "titulo breve", "type": "contact|preference|business_context|task_pattern|knowledge|behavior_lesson", "state": "verified|candidate", "confidence": 0.0, "tags": ["tag"], "aliases": ["alias"], "content": {}, "evidence": "cita textual de las palabras del USUARIO" }
    ]
  },
  "graph": {
    "entities": [{ "name": "Nombre", "type": "person|project|tool|place|concept|event|org", "properties": {} }],
    "facts": [{ "subject": "Nombre de entidad", "predicate": "atributo_snake_case", "object": "valor", "confidence": 0.0 }],
    "relationships": [{ "from": "Entidad A", "to": "Entidad B", "type": "tipo_snake_case" }],
    "commitments": [{ "what": "Descripción", "when_due": "ISO opcional", "priority": "low|normal|high|critical" }]
  }
}

REGLAS memory:
- QUÉ SÍ: contactos declarados, preferencias explícitas, contexto de negocio estable, correcciones de comportamiento (behavior_lesson), patrones de tarea recurrentes.
- "evidence" debe ser cita literal del USUARIO en este turno. Si "content" nombra cliente/proyecto/dominio/persona, ese nombre debe aparecer textual en el mensaje del usuario o en el contexto reciente.
- Confianza: verified (0.85+) solo si el usuario lo declaró explícito; candidate (0.5-0.84) inferido con señales claras; nunca >0.85 para inferencias.
- Máximo 3 items. Si no hay nada, "items": [].${keys}

REGLAS graph:
- Solo hechos concretos y DURADEROS del mundo del usuario. NO al propio asistente/HUD/Core/canales como entidad.
- Hechos = atributos duraderos (rol, email, ubicacion, relacion_con), predicate en snake_case. Relaciones = conexión entre dos entidades nombradas. Compromisos = promesas/tareas con o sin fecha.
- Si no hay nada, arrays vacíos.${known}
CONTEXTO RECIENTE:
${(recentHistory || '').slice(0, 600) || '(sin contexto)'}

MENSAJE DEL USUARIO (intent: ${intent}):
${userText}

RESPUESTA DEL ASISTENTE:
${assistantText || '(sin respuesta)'}`;
}

// Llama al modelo UNA vez y devuelve { memoryItems, graphData } o null si falla.
async function extractBoth({ userText, assistantText, modelProvider, memoryStore, knowledgeGraph, recentHistory }) {
  if (!modelProvider?.generateJson) return null;

  const intent = inferMemoryIntent(userText);
  const existingKeys = (memoryStore?.list?.() || []).map((m) => m.key).filter(Boolean);
  let existingNames = [];
  try {
    existingNames = (knowledgeGraph?.read?.().entities || []).map((e) => e.name).filter(Boolean);
  } catch (_) { existingNames = []; }

  const prompt = buildUnifiedPrompt({ userText, assistantText, intent, existingKeys, existingNames, recentHistory });
  const out = await modelProvider.generateJson({
    system: 'Devuelve únicamente JSON válido. Sin markdown.',
    messages: [{ role: 'user', parts: [{ text: prompt }] }],
    temperature: 0.1,
    // Cubre las dos formas en una sola respuesta (antes: 600 + 900 por separado).
    maxTokens: 1500,
    purpose: 'turn_extraction'
  });

  const data = out?.data || {};
  const memoryItems = Array.isArray(data.memory?.items) ? data.memory.items : [];
  const graphData = (data.graph && typeof data.graph === 'object') ? data.graph : {};
  return { memoryItems, graphData };
}

// Entrypoint del runtime: una llamada al modelo, repartida a los dos pipelines.
// Las dos persistencias se aíslan entre sí (un fallo no mata al otro), igual que
// cuando eran dos pasos separados. Nunca propaga: el aprendizaje en background
// jamás debe romper el camino en vivo.
async function extractTurnKnowledge({ userText, assistantResult, toolResults, modelProvider, memoryStore, knowledgeGraph, recentHistory = '', agentId = null }) {
  const assistantText = assistantResult?.speak || assistantResult?.visual || '';

  let extracted = null;
  try {
    extracted = await extractBoth({ userText, assistantText, modelProvider, memoryStore, knowledgeGraph, recentHistory });
  } catch (err) {
    // Falla de la llamada unificada → degradamos al camino viejo de dos llamadas
    // (cada función hará la suya). No se pierde capacidad, solo el ahorro de ese turno.
    console.warn(`[jarvis-codex] extracción unificada falló, degradando a dos llamadas: ${err.message}`);
    extracted = null;
  }

  // Las dos persistencias se aíslan entre sí: que una reviente no debe impedir
  // la otra (igual que cuando eran dos pasos con try/catch separados).

  // Memoria: si hubo extracción unificada, se le pasan los items y NO vuelve a
  // llamar al modelo; si no, corre standalone (su propia llamada). En ambos casos
  // pasa por heurísticas + guardas de procedencia + persistencia.
  let stored = [];
  try {
    stored = await learnFromConversationTurn({
      userText,
      assistantResult,
      toolResults,
      memoryStore,
      modelProvider,
      recentHistory,
      preExtractedItems: extracted ? extracted.memoryItems : null,
      agentId
    });
  } catch (err) {
    console.warn(`[jarvis-codex] aprendizaje de memoria falló: ${err.message}`);
  }

  // Grafo: mismo principio. preExtracted salta la llamada; null hace la propia.
  // extractGraphFromTurn ya es no-throw, pero lo envolvemos por simetría.
  let graphResult = { entities: 0, facts: 0, relationships: 0, commitments: 0 };
  if (knowledgeGraph) {
    try {
      graphResult = await extractGraphFromTurn({
        userText,
        assistantText,
        modelProvider,
        graph: knowledgeGraph,
        preExtracted: extracted ? extracted.graphData : null,
        agentId
      });
    } catch (err) {
      console.warn(`[jarvis-codex] extracción al grafo falló: ${err.message}`);
    }
  }

  return { stored, graphResult, unified: Boolean(extracted) };
}

module.exports = {
  buildUnifiedPrompt,
  extractTurnKnowledge
};
