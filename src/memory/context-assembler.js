// Assembles the minimum sufficient context for each prompt.
// The context available grows over time; what gets SENT stays lean.
//
// Tier 0 (~700 chars)  — always: datetime, identity, active behavior rules
// Tier 1 (~1400 chars) — always if space: preferences, recent corrections
// Tier 2 (~2800 chars) — selective: domain knowledge matching current intent
// Working             — last 2 turns from working memory

const CHAR_BUDGET = { tier0: 1100, tier1: 1400, tier2: 2800, total: 5300 };

const { formatForUser } = require('../utils/time');

const DOMAIN_PATTERNS = {
  calendar: /agenda|reuni[oó]n|evento|cita|horario|calendario|disponible|programar|semana/i,
  gmail:    /correo|email|mensaje|bandeja|asunto|inbox|enviar|responder|borrador/i,
  sheets:   /hoja|planilla|tabla|datos|spreadsheet|excel|celda|rango/i,
  tasks:    /tarea|pendiente|lista|completar|to.?do/i,
  contacts: /contacto|tel[eé]fono|llamar|cliente|proveedor/i,
  docs:     /documento|\bdoc\b|informe|reporte|redactar/i,
  business: /negocio|empresa|rubro|factura|precio|producto|servicio|venta/i
};

function detectDomains(text) {
  const active = new Set();
  const t = String(text || '');
  for (const [domain, pattern] of Object.entries(DOMAIN_PATTERNS)) {
    if (pattern.test(t)) active.add(domain);
  }
  return active;
}

function compact(value, max = 200) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 3).trim()}...` : s;
}

function formatRecord(record) {
  if (!record) return '';
  const content = record.content || {};
  const title = compact(record.title || record.type, 80);

  if (record.type === 'behavior_lesson') {
    const rule = compact(content.principle || content.rule || title, 200);
    const scope = Array.isArray(content.appliesTo) ? content.appliesTo.slice(0, 3).join(', ') : '';
    const how = compact(content.preferredBehavior || '', 120);
    return `[regla] ${rule}${scope ? ` | aplica: ${scope}` : ''}${how ? ` | hacer: ${how}` : ''}`;
  }

  if (record.type === 'preference') {
    const val = compact(content.value || content.preference || JSON.stringify(content), 180);
    return `[preferencia] ${title}: ${val}`;
  }

  if (record.type === 'contact') {
    const parts = [content.name || title];
    if (content.email) parts.push(`email:${content.email}`);
    if (content.phone || content.telephone) parts.push(`tel:${content.phone || content.telephone}`);
    if (content.role || content.empresa) parts.push(content.role || content.empresa);
    return `[contacto] ${parts.join(' | ')}`;
  }

  if (record.type === 'business_context') {
    const entries = typeof content === 'object'
      ? Object.entries(content).slice(0, 5).map(([k, v]) => `${k}:${compact(String(v), 80)}`).join(' | ')
      : compact(String(content), 200);
    return `[negocio] ${title}: ${entries}`;
  }

  if (record.type === 'knowledge') {
    const body = typeof content === 'object'
      ? Object.values(content).slice(0, 4).map((v) => compact(String(v), 80)).join(' | ')
      : compact(String(content), 200);
    return `[conocimiento] ${title}: ${body}`;
  }

  const body = typeof content === 'object'
    ? Object.entries(content).slice(0, 4).map(([k, v]) => `${k}:${compact(String(v), 60)}`).join(' | ')
    : compact(String(content), 160);
  return `[${record.type}] ${title}: ${body}`;
}

function buildTier0Lines(store) {
  const lines = [];

  // Self-knowledge: assistant capabilities — always included so the model knows what it can do
  const selfKnowledge = store.list({ type: 'assistant_self_knowledge' })
    .filter((r) => r.state === 'verified')
    .slice(0, 1)
    .map((r) => store.get(r.id))
    .filter(Boolean);
  for (const r of selfKnowledge) {
    const groups = (r.content?.capabilityGroups || [])
      .map((g) => `${g.name}: ${g.actions.slice(0, 4).join('; ')}`)
      .join('\n');
    if (groups) lines.push(`[capacidades]\n${groups}`);
  }

  // Identity: high-confidence business_context + user identity
  const identity = store.list({ type: 'business_context' })
    .filter((r) => ['verified'].includes(r.state))
    .slice(0, 2)
    .map((r) => store.get(r.id))
    .filter(Boolean)
    .map(formatRecord)
    .filter(Boolean);
  lines.push(...identity);

  // Global behavior rules: verified behavior_lessons. Ordenadas por confianza
  // y recencia ANTES de cortar: con el catálogo creciendo, el orden de
  // inserción dejaría fuera justamente las lecciones nuevas.
  const rules = store.list({ type: 'behavior_lesson' })
    .filter((r) => r.state === 'verified')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0)
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 4)
    .map((r) => store.get(r.id))
    .filter(Boolean)
    .map(formatRecord)
    .filter(Boolean);
  lines.push(...rules);

  return lines;
}

function buildTier1Lines(store) {
  const lines = [];
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // 14 days

  // Preferences
  const prefs = store.list({ type: 'preference' })
    .filter((r) => r.state === 'verified')
    .slice(0, 5)
    .map((r) => store.get(r.id))
    .filter(Boolean)
    .map(formatRecord)
    .filter(Boolean);
  lines.push(...prefs);

  // Recent behavior lessons (any non-rejected state)
  const recentLessons = store.list({ type: 'behavior_lesson' })
    .filter((r) => !['rejected', 'obsolete'].includes(r.state))
    .filter((r) => r.state !== 'verified') // verified already in tier0
    .filter((r) => r.updatedAt && new Date(r.updatedAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 3)
    .map((r) => store.get(r.id))
    .filter(Boolean)
    .map(formatRecord)
    .filter(Boolean);
  lines.push(...recentLessons);

  return lines;
}

function buildTier2Lines(store, domains, query) {
  if (domains.size === 0 && !query) return [];

  // Build a domain-enriched query
  const domainTerms = [...domains].join(' ');
  const searchQuery = `${query} ${domainTerms}`.trim();

  const records = store.search(searchQuery, {
    limit: 8,
    types: ['knowledge', 'business_context', 'contact', 'relationship', 'task_pattern'],
    states: ['verified', 'candidate', 'low_confidence']
  });

  return records
    .filter((r) => !['assistant_self_knowledge'].includes(r.type))
    .map(formatRecord)
    .filter(Boolean);
}

class ContextAssembler {
  constructor({ memoryStore, workingMemoryStore, knowledgeGraph } = {}) {
    this.store = memoryStore;
    this.workingStore = workingMemoryStore;
    this.graph = knowledgeGraph || null;
  }

  assemble({ userText = '', recentHistory = '' } = {}) {
    if (!this.store) return '';

    const fullQuery = `${userText} ${recentHistory}`.slice(0, 400).trim();
    const domains = detectDomains(fullQuery);
    const now = new Date();
    const dateHeader = `Fecha actual: ${formatForUser(now, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${formatForUser(now, { hour: '2-digit', minute: '2-digit' })} (hora de Chile).`;

    const sections = [`[contexto]\n${dateHeader}`];
    let budget = CHAR_BUDGET.total - dateHeader.length;

    // Tier 0
    const tier0Lines = buildTier0Lines(this.store);
    if (tier0Lines.length > 0) {
      const block = tier0Lines.join('\n');
      const allowed = block.slice(0, CHAR_BUDGET.tier0);
      sections.push(allowed);
      budget -= allowed.length;
    }

    // Tier 1
    if (budget > 400) {
      const tier1Lines = buildTier1Lines(this.store);
      if (tier1Lines.length > 0) {
        const block = tier1Lines.join('\n');
        const allowed = block.slice(0, Math.min(CHAR_BUDGET.tier1, budget - 200));
        if (allowed.trim()) {
          sections.push(allowed);
          budget -= allowed.length;
        }
      }
    }

    // Tier 2
    if (budget > 600 && (domains.size > 0 || fullQuery)) {
      const tier2Lines = buildTier2Lines(this.store, domains, userText.slice(0, 200));
      if (tier2Lines.length > 0) {
        const block = tier2Lines.join('\n');
        const allowed = block.slice(0, Math.min(CHAR_BUDGET.tier2, budget - 200));
        if (allowed.trim()) {
          sections.push(allowed);
          budget -= allowed.length;
        }
      }
    }

    // Grafo de conocimiento: entidades del mundo del usuario relevantes al
    // mensaje + compromisos abiertos. Lo que el store plano no modela.
    if (this.graph && budget > 400) {
      const graphLines = [];
      try {
        const knowledge = this.graph.getKnowledgeForMessage(userText, { limit: 4 });
        if (knowledge) graphLines.push(knowledge);
        const commitments = this.graph.getOpenCommitmentsSummary({ limit: 4 });
        if (commitments) graphLines.push(`Compromisos abiertos:\n${commitments}`);
      } catch (_) {
        // El grafo nunca debe romper el ensamblado de contexto.
      }
      if (graphLines.length > 0) {
        const block = `[grafo de conocimiento]\n${graphLines.join('\n')}`;
        const allowed = block.slice(0, Math.min(1200, budget - 200));
        if (allowed.trim()) {
          sections.push(allowed);
          budget -= allowed.length;
        }
      }
    }

    // Working memory (recent turns)
    if (this.workingStore && budget > 200) {
      const working = this.workingStore.buildPromptContext(userText, { limit: 2 }) || '';
      if (working) sections.push(working.slice(0, Math.min(600, budget)));
    }

    return sections.filter(Boolean).join('\n');
  }
}

module.exports = { ContextAssembler, detectDomains };
