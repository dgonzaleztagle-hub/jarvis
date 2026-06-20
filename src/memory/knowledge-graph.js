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
    let raw;
    try {
      raw = fs.readFileSync(this.graphPath, 'utf-8');
    } catch (_) {
      // No existe / no se puede leer: grafo vacío legítimo, sin drama.
      return { entities: [], facts: [], relationships: [], commitments: [] };
    }
    try {
      const data = JSON.parse(raw);
      return {
        entities: data.entities || [],
        facts: data.facts || [],
        relationships: data.relationships || [],
        commitments: data.commitments || []
      };
    } catch (err) {
      // El archivo EXISTE pero está corrupto. Devolver vacío en silencio es una
      // bomba: el próximo write() lo sobrescribe atómicamente y se pierde todo el
      // grafo sin una sola línea de log. Antes de seguir, respaldamos el archivo
      // ilegible a disco y avisamos fuerte — los datos quedan recuperables.
      if (raw && raw.trim()) {
        try {
          const backup = `${this.graphPath}.corrupt-${Date.now()}.json`;
          fs.writeFileSync(backup, raw, 'utf-8');
          console.error(`[jarvis-codex] grafo CORRUPTO: ${err.message}. Respaldado en ${backup} antes de reiniciarlo.`);
        } catch (backupErr) {
          console.error(`[jarvis-codex] grafo CORRUPTO e irrespaldable: ${err.message} / ${backupErr.message}`);
        }
      }
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

    // Tipos que suelen describir la MISMA cosa del mundo real (un negocio es a
    // la vez org/proyecto/lugar/herramienta-de-dashboard). Colapsan entre sí por
    // nombre para no fragmentar "Rishtedar" en 4 entidades. Las personas NO
    // entran a este cluster: dos cosas con el mismo nombre pero una persona y
    // otra empresa son distintas.
    const THING_CLUSTER = new Set(['org', 'project', 'place', 'tool', 'concept']);

    const graph = this.read();
    const existing = graph.entities.find((e) => {
      if (e.type === cleanType && e.normalizedName === normalizedName) return true;
      // Mismo nombre, distinto tipo, ambos dentro del cluster de "cosas":
      // es la misma entidad vista desde otro ángulo — reusar, no duplicar.
      if (e.normalizedName === normalizedName && THING_CLUSTER.has(cleanType) && THING_CLUSTER.has(e.type)) return true;
      if (e.type !== cleanType) return false;
      // Personas referidas primero por apodo/relación ("hijito", "mi hijo") y
      // luego por su nombre real ("Baltasar") no deben fragmentarse en
      // entidades separadas: si el nombre nuevo es apodo/contact_name de una
      // existente (o viceversa), o uno contiene literalmente al otro, es la
      // misma persona.
      if (cleanType !== 'person') return false;
      const existingAlias = normalizeText(e.properties?.apodo || e.properties?.contact_name || '');
      const newAlias = normalizeText(properties?.apodo || properties?.contact_name || '');
      if (existingAlias && existingAlias === normalizedName) return true;
      if (newAlias && newAlias === e.normalizedName) return true;
      if (existingAlias && newAlias && existingAlias === newAlias) return true;
      return e.normalizedName.includes(normalizedName) || normalizedName.includes(e.normalizedName);
    });

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

  // Corrige o descarta un hecho existente (el usuario dijo "eso está mal").
  // No borra el registro: lo deja en 'rejected'/'obsolete' para que getEntityProfile
  // y getKnowledgeForMessage dejen de mostrarlo, igual que memoryStore.updateState.
  setFactState(factId, state, patch = {}) {
    if (!FACT_STATES.includes(state)) return null;
    const graph = this.read();
    const fact = graph.facts.find((f) => f.id === factId);
    if (!fact) return null;
    Object.assign(fact, patch, { state, updatedAt: new Date().toISOString() });
    this.write(graph);
    return fact;
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

  // Poda de basura acumulada. El grafo crece sin techo y se contamina con:
  // hechos descartados/obsoletos viejos, candidatos de baja confianza que se
  // vieron una sola vez hace tiempo (ruido del extractor), y entidades huérfanas
  // sin hechos ni relaciones. Conservadora a propósito: nunca toca 'verified',
  // ni compromisos, ni nada reciente. Pensada para correr al arranque.
  prune({ maxAgeDays = 30, minCandidateConfidence = 0.7 } = {}) {
    const graph = this.read();
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const isOld = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t > 0 && t < cutoff;
    };

    const before = {
      entities: graph.entities.length,
      facts: graph.facts.length
    };

    graph.facts = graph.facts.filter((f) => {
      // Descartados/obsoletos viejos: ya no se muestran, solo pesan.
      if ((f.state === 'rejected' || f.state === 'obsolete') && isOld(f.updatedAt)) return false;
      // Candidatos débiles, vistos una sola vez, viejos: ruido del extractor que
      // nunca se reforzó ni el usuario confirmó.
      if (
        f.state === 'candidate' &&
        (f.observations || 1) <= 1 &&
        (f.confidence || 0) < minCandidateConfidence &&
        isOld(f.updatedAt)
      ) return false;
      return true;
    });

    // Entidades huérfanas (sin hechos vivos ni relaciones) y viejas: sobras de
    // extracciones que no aportan nada al contexto.
    const subjectsWithFacts = new Set(graph.facts.map((f) => f.subjectId));
    const inRelationships = new Set(graph.relationships.flatMap((r) => [r.fromId, r.toId]));
    graph.entities = graph.entities.filter((e) => {
      if (subjectsWithFacts.has(e.id) || inRelationships.has(e.id)) return true;
      if (e.source === 'user_explicit' || e.source === 'user_profile') return true; // nunca podar lo que el usuario declaró
      return !isOld(e.updatedAt);
    });

    // Relaciones que quedaron colgando de una entidad podada.
    const liveIds = new Set(graph.entities.map((e) => e.id));
    graph.relationships = graph.relationships.filter((r) => liveIds.has(r.fromId) && liveIds.has(r.toId));

    this.write(graph);
    return {
      removedFacts: before.facts - graph.facts.length,
      removedEntities: before.entities - graph.entities.length
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
