const fs = require('fs');
const path = require('path');
const { normalizeText } = require('./memory-store');

// Grafo de conocimiento: modela el MUNDO del usuario como entidades (persona,
// proyecto, herramienta, lugar, concepto, evento) conectadas por hechos y
// relaciones, más compromisos con vencimiento. Vive al lado del MemoryStore
// (que aporta estados/curaduría); acá vive la estructura de grafo que el store
// plano no tiene. Persistencia en un único graph.json atómico — el volumen
// esperado (cientos de nodos, no millones) no justifica SQLite todavía.

const ENTITY_TYPES = ['person', 'project', 'tool', 'place', 'concept', 'event', 'org'];
const COMMITMENT_STATUSES = ['pending', 'active', 'completed', 'failed', 'cancelled'];

// Estados de hecho: reusan la semántica del MemoryStore. Un hecho extraído por
// el LLM nace 'candidate' y solo asciende a 'verified' por confirmación o
// refuerzo — no se confía ciego en la extracción.
const FACT_STATES = ['candidate', 'verified', 'conflicting', 'obsolete', 'rejected'];

// Stopwords en español (+ algunas en inglés) para no buscar por muletillas.
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a',
  'y', 'o', 'u', 'e', 'que', 'qué', 'como', 'cómo', 'cuando', 'cuándo', 'donde',
  'dónde', 'quien', 'quién', 'cual', 'cuál', 'es', 'son', 'soy', 'eres', 'fue',
  'ser', 'estar', 'esta', 'está', 'estoy', 'este', 'esta', 'esto', 'ese', 'esa',
  'eso', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'me', 'te', 'se', 'le', 'lo',
  'nos', 'con', 'sin', 'por', 'para', 'pero', 'mas', 'más', 'muy', 'ya', 'no',
  'si', 'sí', 'en', 'sobre', 'entre', 'hasta', 'desde', 'hay', 'he', 'ha', 'han',
  'tengo', 'tiene', 'tienes', 'quiero', 'puede', 'puedes', 'hola', 'gracias',
  'porque', 'cosa', 'cosas', 'algo', 'todo', 'todos', 'nada', 'bien', 'the',
  'and', 'for', 'with', 'this', 'that', 'recuerda', 'recordar', 'sabes', 'dime'
]);

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempPath, serialized, 'utf-8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      fs.writeFileSync(filePath, serialized, 'utf-8');
      fs.rmSync(tempPath, { force: true });
      return;
    }
    throw error;
  }
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function extractTerms(text) {
  return [...new Set(
    normalizeText(text)
      .split(' ')
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  )];
}

function looksLikeSelfQuery(text) {
  return /\b(yo|mi|mis|m[ií]o|m[ií]a|conmigo|mi nombre|sobre m[ií])\b/i.test(String(text || ''));
}

class KnowledgeGraph {
  constructor({ dataDir }) {
    this.memoryDir = path.join(dataDir, 'memory');
    this.graphPath = path.join(this.memoryDir, 'graph.json');
    fs.mkdirSync(this.memoryDir, { recursive: true });
    if (!fs.existsSync(this.graphPath)) {
      writeJsonAtomic(this.graphPath, { entities: [], facts: [], relationships: [], commitments: [] });
    }
  }

  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.graphPath, 'utf-8'));
      return {
        entities: data.entities || [],
        facts: data.facts || [],
        relationships: data.relationships || [],
        commitments: data.commitments || []
      };
    } catch (_) {
      return { entities: [], facts: [], relationships: [], commitments: [] };
    }
  }

  write(graph) {
    writeJsonAtomic(this.graphPath, graph);
  }

  // --- Entidades ---

  upsertEntity(type, name, properties = {}, source = 'manual') {
    const cleanType = ENTITY_TYPES.includes(type) ? type : 'concept';
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;
    const normalizedName = normalizeText(cleanName);
    const now = new Date().toISOString();

    const graph = this.read();
    const existing = graph.entities.find(
      (e) => e.type === cleanType && e.normalizedName === normalizedName
    );

    if (existing) {
      // Merge incremental de propiedades; no se pierde lo previo.
      existing.properties = { ...(existing.properties || {}), ...(properties || {}) };
      existing.updatedAt = now;
      this.write(graph);
      return existing;
    }

    const entity = {
      id: genId('ent'),
      type: cleanType,
      name: cleanName,
      normalizedName,
      properties: properties || {},
      source,
      createdAt: now,
      updatedAt: now
    };
    graph.entities.push(entity);
    this.write(graph);
    return entity;
  }

  // --- Hechos ---

  addFact(subjectId, predicate, object, options = {}) {
    const cleanPredicate = String(predicate || '').trim();
    const cleanObject = String(object || '').trim();
    if (!subjectId || !cleanPredicate || !cleanObject) return null;
    const now = new Date().toISOString();
    const state = FACT_STATES.includes(options.state) ? options.state : 'candidate';

    const graph = this.read();
    if (!graph.entities.some((e) => e.id === subjectId)) return null;

    const existing = graph.facts.find(
      (f) => f.subjectId === subjectId &&
        normalizeText(f.predicate) === normalizeText(cleanPredicate) &&
        normalizeText(f.object) === normalizeText(cleanObject)
    );

    if (existing) {
      // Reobservar un hecho lo refuerza: sube confianza y lo marca verificado
      // si ya se vio varias veces. La curaduría real vive en el reforzador.
      existing.observations = (existing.observations || 1) + 1;
      existing.confidence = Math.min(1, Math.max(existing.confidence || 0, options.confidence || 0));
      if (existing.observations >= 2 && existing.state === 'candidate') existing.state = 'verified';
      existing.updatedAt = now;
      this.write(graph);
      return existing;
    }

    const fact = {
      id: genId('fact'),
      subjectId,
      predicate: cleanPredicate,
      object: cleanObject,
      confidence: typeof options.confidence === 'number' ? options.confidence : 0.6,
      source: options.source || 'manual',
      state,
      observations: 1,
      createdAt: now,
      updatedAt: now
    };
    graph.facts.push(fact);
    this.write(graph);
    return fact;
  }

  // --- Relaciones ---

  addRelationship(fromId, toId, type) {
    const cleanType = String(type || '').trim();
    if (!fromId || !toId || !cleanType || fromId === toId) return null;
    const graph = this.read();
    const ok = graph.entities.some((e) => e.id === fromId) && graph.entities.some((e) => e.id === toId);
    if (!ok) return null;

    const existing = graph.relationships.find(
      (r) => r.fromId === fromId && r.toId === toId && normalizeText(r.type) === normalizeText(cleanType)
    );
    if (existing) return existing;

    const rel = { id: genId('rel'), fromId, toId, type: cleanType, createdAt: new Date().toISOString() };
    graph.relationships.push(rel);
    this.write(graph);
    return rel;
  }

  // --- Compromisos ---

  addCommitment(what, options = {}) {
    const cleanWhat = String(what || '').trim();
    if (!cleanWhat) return null;
    const now = new Date().toISOString();
    const graph = this.read();

    const existing = graph.commitments.find(
      (c) => normalizeText(c.what) === normalizeText(cleanWhat) && c.status !== 'completed' && c.status !== 'cancelled'
    );
    if (existing) return existing;

    const commitment = {
      id: genId('cmt'),
      what: cleanWhat,
      whenDue: options.whenDue || null,
      priority: ['low', 'normal', 'high', 'critical'].includes(options.priority) ? options.priority : 'normal',
      status: 'pending',
      source: options.source || 'manual',
      createdAt: now,
      updatedAt: now
    };
    graph.commitments.push(commitment);
    this.write(graph);
    return commitment;
  }

  setCommitmentStatus(id, status) {
    if (!COMMITMENT_STATUSES.includes(status)) return null;
    const graph = this.read();
    const commitment = graph.commitments.find((c) => c.id === id);
    if (!commitment) return null;
    commitment.status = status;
    commitment.updatedAt = new Date().toISOString();
    this.write(graph);
    return commitment;
  }

  // --- Consultas ---

  findEntities({ type, name } = {}) {
    const graph = this.read();
    const normName = name ? normalizeText(name) : null;
    return graph.entities.filter((e) => {
      if (type && e.type !== type) return false;
      if (normName && !e.normalizedName.includes(normName)) return false;
      return true;
    });
  }

  findCommitments({ status } = {}) {
    const graph = this.read();
    return graph.commitments
      .filter((c) => !status || c.status === status)
      .sort((a, b) => {
        const aDue = a.whenDue ? new Date(a.whenDue).getTime() : Infinity;
        const bDue = b.whenDue ? new Date(b.whenDue).getTime() : Infinity;
        return aDue - bDue;
      });
  }

  getEntityProfile(entityId, graph = null) {
    const g = graph || this.read();
    const entity = g.entities.find((e) => e.id === entityId);
    if (!entity) return null;
    const facts = g.facts.filter((f) => f.subjectId === entityId && f.state !== 'rejected' && f.state !== 'obsolete');
    const relationships = g.relationships
      .filter((r) => r.fromId === entityId || r.toId === entityId)
      .map((r) => {
        const other = g.entities.find((e) => e.id === (r.fromId === entityId ? r.toId : r.fromId));
        return {
          type: r.type,
          target: other ? other.name : '?',
          direction: r.fromId === entityId ? 'from' : 'to'
        };
      });
    return { entity, facts, relationships };
  }

  // Dado un mensaje, recupera los perfiles de entidad relevantes para inyectar
  // al prompt. Keyword matching sobre nombres y hechos (no embeddings — igual
  // que el resto de codex hoy).
  retrieveForMessage(text, { limit = 5 } = {}) {
    const terms = extractTerms(text);
    const graph = this.read();
    const matched = new Map();

    if (looksLikeSelfQuery(text)) {
      const self = graph.entities.find((e) => e.source === 'user_profile' || e.properties?.isUser);
      if (self) matched.set(self.id, self);
    }

    if (terms.length === 0 && matched.size === 0) return [];

    for (const entity of graph.entities) {
      if (matched.has(entity.id)) continue;
      const hitName = terms.some((t) => entity.normalizedName.includes(t));
      if (hitName) { matched.set(entity.id, entity); continue; }
    }

    // También por hechos: si el término aparece en el objeto/predicado de un
    // hecho, su entidad sujeto es relevante.
    for (const fact of graph.facts) {
      if (matched.size >= limit * 2) break;
      const corpus = normalizeText(`${fact.predicate} ${fact.object}`);
      if (terms.some((t) => corpus.includes(t))) {
        const entity = graph.entities.find((e) => e.id === fact.subjectId);
        if (entity && !matched.has(entity.id)) matched.set(entity.id, entity);
      }
    }

    return [...matched.values()]
      .slice(0, limit)
      .map((e) => this.getEntityProfile(e.id, graph))
      .filter(Boolean);
  }

  // Texto formateado para el system prompt. Vacío si no hay nada relevante.
  getKnowledgeForMessage(text, options = {}) {
    const profiles = this.retrieveForMessage(text, options);
    if (profiles.length === 0) return '';
    const lines = [];
    for (const { entity, facts, relationships } of profiles) {
      lines.push(`${entity.name} (${entity.type})`);
      for (const f of facts.slice(0, 6)) {
        const flag = f.state === 'verified' ? '' : ' ~';
        lines.push(`  - ${f.predicate}: ${f.object}${flag}`);
      }
      for (const r of relationships.slice(0, 5)) {
        lines.push(r.direction === 'from'
          ? `  - ${r.type} -> ${r.target}`
          : `  - ${r.target} -> ${r.type}`);
      }
    }
    return lines.join('\n');
  }

  // Resumen de compromisos abiertos para inyectar al prompt.
  getOpenCommitmentsSummary({ limit = 6 } = {}) {
    const open = this.findCommitments({}).filter((c) => c.status === 'pending' || c.status === 'active');
    if (open.length === 0) return '';
    const lines = [];
    for (const c of open.slice(0, limit)) {
      const due = c.whenDue ? ` (vence: ${new Date(c.whenDue).toLocaleDateString('es-CL')})` : '';
      const pri = c.priority !== 'normal' ? ` [${c.priority}]` : '';
      lines.push(`  - ${c.what}${due}${pri}`);
    }
    return lines.join('\n');
  }

  stats() {
    const g = this.read();
    return {
      entities: g.entities.length,
      facts: g.facts.length,
      relationships: g.relationships.length,
      commitments: g.commitments.length,
      openCommitments: g.commitments.filter((c) => c.status === 'pending' || c.status === 'active').length
    };
  }
}

module.exports = {
  KnowledgeGraph,
  ENTITY_TYPES,
  COMMITMENT_STATUSES,
  FACT_STATES,
  extractTerms
};
