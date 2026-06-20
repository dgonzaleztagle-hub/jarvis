const { ENTITY_TYPES } = require('./knowledge-graph');

// Extracción de conocimiento estructurado desde un turno de conversación.
// Tras cada respuesta, un LLM saca entidades/hechos/relaciones/compromisos y
// los deposita en el grafo. Todo entra como 'candidate': el grafo modela lo
// que se DIJO, no verdades absolutas — la curaduría/refuerzo decide qué asciende.

function buildExtractionPrompt(userText, assistantText, existingNames = []) {
  const known = existingNames.length
    ? `\nENTIDADES YA CONOCIDAS (reusa el nombre EXACTO si el turno se refiere a una de estas; no crees una variante nueva):\n${existingNames.slice(0, 40).join(', ')}\n`
    : '';
  return `Eres un extractor de conocimiento. Analiza el siguiente turno de conversación entre el usuario (Daniel) y su asistente, y extrae SOLO información concreta y verificable sobre el mundo del usuario.
${known}
MENSAJE DEL USUARIO:
${userText}

RESPUESTA DEL ASISTENTE:
${assistantText || '(sin respuesta)'}

Devuelve ÚNICAMENTE un objeto JSON con esta forma (sin markdown, sin explicación):
{
  "entities": [{ "name": "Nombre", "type": "person|project|tool|place|concept|event|org", "properties": {} }],
  "facts": [{ "subject": "Nombre de entidad", "predicate": "atributo_en_snake_case", "object": "valor", "confidence": 0.0-1.0 }],
  "relationships": [{ "from": "Entidad A", "to": "Entidad B", "type": "tipo_en_snake_case" }],
  "commitments": [{ "what": "Descripción", "when_due": "ISO date opcional", "priority": "low|normal|high|critical" }]
}

REGLAS:
- Extrae solo hechos concretos y DURADEROS. Nada de inferencias vagas ni cortesías.
- Entidades: personas, proyectos, herramientas, lugares, conceptos, eventos, organizaciones reales del mundo del usuario.
- NO extraigas como entidad al propio asistente (Jarvis), su interfaz (HUD), su núcleo (Core) ni canales (Telegram): no son parte del mundo del usuario.
- NO extraigas estado operacional efímero: resultados de corridas, "última ejecución", estados de conexión/vinculación, errores transitorios, conteos del momento ("33 acciones hoy"). Eso caduca; no es conocimiento.
- NO extraigas afirmaciones sobre lo que el asistente puede/no puede hacer o sus errores: la fuente de verdad de las capacidades es el runtime, no la conversación. Si el asistente dijo "no tengo acceso" o "hay un error", NO lo guardes.
- Prioriza lo que dijo el USUARIO. Lo que afirmó el asistente vale poco: puede equivocarse, y guardar su error lo vuelve "hecho".
- Hechos: atributos DURADEROS de una entidad (ej: "rol", "email", "ubicacion", "relacion_con"). predicate en snake_case.
- Relaciones: conexiones entre dos entidades nombradas (ej: "trabaja_en", "cliente_de", "hijo_de").
- Compromisos: promesas o tareas con o sin fecha que el usuario asumió o pidió.
- Para nombrar una entidad usa su nombre PROPIO y canónico si lo conoces (ej: "Baltasar", no "hijo de Daniel" ni "hijito"). Si solo se mencionó por apodo o relación, ponlo en properties (apodo, relacion).
- confidence más bajo (0.5-0.7) si la información es implícita o incierta.
- Si no hay nada que extraer, devuelve arrays vacíos.
- Responde SOLO el objeto JSON.`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(text = '') {
  return String(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
}

// Predicados que describen ESTADO OPERACIONAL EFÍMERO (no hechos duraderos del
// mundo del usuario): resultados de corridas, estados de conexión, errores
// transitorios, conteos del momento. El grafo modela el mundo del usuario, no
// la telemetría del runtime — esto último vive en logs/self-knowledge y caduca.
const EPHEMERAL_PREDICATE = /(^|_)(last_execution|execution_|ejecucion|estado_conexion|conexion|vinculacion|tiene_error|error_type|causa_error|estado_acceso|acciones_ejecutadas|ultimas_horas|is_active|is_saved|status|nombre_desconocido|numero_telefonico_desconocido|compromisos_pendientes|agentes_automaticos|_activos|_pendientes)/i;

// Predicados que afirman CAPACIDADES/LÍMITES DEL ASISTENTE. Igual que en
// memory-learning (invariante de autoridad): lo que Jarvis puede o no puede
// hacer lo define el runtime, NUNCA la conversación. Memorizarlo desde el habla
// del asistente convierte una alucinación en "hecho" que se refuerza solo.
const ASSISTANT_CLAIM_PREDICATE = /(^|_)(puede_|capabilit|can_do|cannot_do|no_access|tiene_acceso|tiene_error|limitacion|conexion_requerida)/i;

// El propio asistente y sus subsistemas de UI no son entidades del mundo del
// usuario. Modelarlos llena el grafo de "Jarvis", "HUD", "Core" con telemetría.
const SELF_ENTITY = /^(jarvis|jarvis codex|hud|core|asistente|el asistente|telegram)$/i;

function isEphemeralFact(predicate) {
  const p = normalize(predicate);
  return EPHEMERAL_PREDICATE.test(p) || ASSISTANT_CLAIM_PREDICATE.test(p);
}

function parseDate(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Procesa el resultado del modelo y lo deposita en el grafo. Separado del
// llamado al LLM para poder testear el almacenamiento sin red.
function storeExtraction(graph, extraction, source = 'llm_extraction') {
  const result = { entities: 0, facts: 0, relationships: 0, commitments: 0 };
  const nameToId = new Map();

  for (const e of safeArray(extraction.entities)) {
    if (!e || !e.name) continue;
    // El asistente y su UI no son entidades del mundo del usuario.
    if (SELF_ENTITY.test(String(e.name).trim())) continue;
    const type = ENTITY_TYPES.includes(e.type) ? e.type : 'concept';
    const entity = graph.upsertEntity(type, e.name, e.properties || {}, source);
    if (entity) { nameToId.set(String(e.name).trim().toLowerCase(), entity.id); result.entities += 1; }
  }

  for (const f of safeArray(extraction.facts)) {
    if (!f || !f.subject || !f.predicate || f.object === undefined) continue;
    // No fosilizar estado efímero ni auto-afirmaciones de capacidad del asistente.
    if (isEphemeralFact(f.predicate)) continue;
    const subjectId = nameToId.get(String(f.subject).trim().toLowerCase());
    if (!subjectId) continue;
    const fact = graph.addFact(subjectId, f.predicate, f.object, {
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.6,
      source,
      state: 'candidate'
    });
    if (fact) result.facts += 1;
  }

  for (const r of safeArray(extraction.relationships)) {
    if (!r || !r.from || !r.to || !r.type) continue;
    const fromId = nameToId.get(String(r.from).trim().toLowerCase());
    const toId = nameToId.get(String(r.to).trim().toLowerCase());
    if (!fromId || !toId) continue;
    const rel = graph.addRelationship(fromId, toId, r.type);
    if (rel) result.relationships += 1;
  }

  for (const c of safeArray(extraction.commitments)) {
    if (!c || !c.what) continue;
    const commitment = graph.addCommitment(c.what, {
      whenDue: parseDate(c.when_due),
      priority: c.priority,
      source
    });
    if (commitment) result.commitments += 1;
  }

  return result;
}

// Entrypoint: extrae del turno y almacena. Nunca lanza — el aprendizaje en
// background jamás debe romper el camino en vivo.
async function extractGraphFromTurn({ userText, assistantText, modelProvider, graph }) {
  if (!modelProvider || !graph || !userText) {
    return { entities: 0, facts: 0, relationships: 0, commitments: 0 };
  }
  try {
    // Catálogo de entidades existentes para que el modelo reuse nombres
    // canónicos en vez de inventar variantes ("hijito" vs "Baltasar").
    let existingNames = [];
    try {
      existingNames = (graph.read().entities || []).map((e) => e.name).filter(Boolean);
    } catch (_) { existingNames = []; }
    const prompt = buildExtractionPrompt(userText, assistantText, existingNames);
    const out = await modelProvider.generateJson({
      system: 'Devuelve únicamente JSON válido. Sin markdown.',
      messages: [{ role: 'user', parts: [{ text: prompt }] }],
      temperature: 0.1,
      maxTokens: 900,
      purpose: 'graph_extraction'
    });
    const data = out?.data || {};
    return storeExtraction(graph, data, 'llm_extraction');
  } catch (_) {
    return { entities: 0, facts: 0, relationships: 0, commitments: 0 };
  }
}

module.exports = {
  buildExtractionPrompt,
  storeExtraction,
  extractGraphFromTurn
};
