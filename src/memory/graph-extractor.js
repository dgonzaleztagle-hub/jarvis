const { ENTITY_TYPES } = require('./knowledge-graph');

// Extracción de conocimiento estructurado desde un turno de conversación.
// Tras cada respuesta, un LLM saca entidades/hechos/relaciones/compromisos y
// los deposita en el grafo. Todo entra como 'candidate': el grafo modela lo
// que se DIJO, no verdades absolutas — la curaduría/refuerzo decide qué asciende.

function buildExtractionPrompt(userText, assistantText) {
  return `Eres un extractor de conocimiento. Analiza el siguiente turno de conversación entre el usuario (Daniel) y su asistente, y extrae SOLO información concreta y verificable sobre el mundo del usuario.

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
- Extrae solo hechos concretos. Nada de inferencias vagas ni cortesías.
- Entidades: personas, proyectos, herramientas, lugares, conceptos, eventos, organizaciones reales mencionadas.
- Hechos: atributos de una entidad (ej: "rol", "email", "ubicacion", "fecha_de"). predicate en snake_case.
- Relaciones: conexiones entre dos entidades nombradas (ej: "trabaja_en", "cliente_de", "parte_de").
- Compromisos: promesas o tareas con o sin fecha que el usuario asumió o pidió.
- confidence más bajo (0.5-0.7) si la información es implícita o incierta.
- Si no hay nada que extraer, devuelve arrays vacíos.
- Responde SOLO el objeto JSON.`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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
    const type = ENTITY_TYPES.includes(e.type) ? e.type : 'concept';
    const entity = graph.upsertEntity(type, e.name, e.properties || {}, source);
    if (entity) { nameToId.set(String(e.name).trim().toLowerCase(), entity.id); result.entities += 1; }
  }

  for (const f of safeArray(extraction.facts)) {
    if (!f || !f.subject || !f.predicate || f.object === undefined) continue;
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
    const prompt = buildExtractionPrompt(userText, assistantText);
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
