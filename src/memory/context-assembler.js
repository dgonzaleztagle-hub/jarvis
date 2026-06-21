// Assembles the minimum sufficient context for each prompt.
// The context available grows over time; what gets SENT stays lean.
//
// Tier 0 (~700 chars)  — always: datetime, identity, active behavior rules
// Tier 1 (~1400 chars) — always if space: preferences, recent corrections
// Tier 2 (~2800 chars) — selective: domain knowledge matching current intent
// Working             — last 2 turns from working memory

const CHAR_BUDGET = { capabilities: 2200, tier0: 1100, tier1: 1400, tier2: 2800, total: 7000 };

const { formatForUser } = require('../utils/time');

const DOMAIN_PATTERNS = {
  calendar: /agenda|reuni[oó]n|evento|cita|horario|calendario|disponible|programar|semana/i,
  gmail:    /correo|email|mensaje|bandeja|asunto|inbox|enviar|responder|borrador/i,
  sheets:   /hoja|planilla|tabla|datos|spreadsheet|excel|celda|rango/i,
  tasks:    /tarea|pendiente|lista|completar|to.?do/i,
  contacts: /contacto|tel[eé]fono|llamar|cliente|proveedor/i,
  docs:     /documento|\bdoc\b|informe|reporte|redactar/i,
  business: /negocio|empresa|rubro|factura|precio|producto|servicio|venta/i,
  marketing: /marketing|campa[ñn]a|marca|brand|copy|contenido|publicar|post|reel|landing|anuncio|publicidad|redes sociales|instagram|tiktok|newsletter|seo|audiencia|p[uú]blico objetivo/i
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

function buildCapabilitiesBlock(store, agentId) {
  const record = store.list({ type: 'assistant_self_knowledge', agentId })
    .filter((r) => r.state === 'verified')
    .slice(0, 1)
    .map((r) => store.get(r.id))
    .filter(Boolean)[0];
  if (!record) return '';
  const groups = (record.content?.capabilityGroups || [])
    .map((g) => `${g.name}: ${g.actions.join('; ')}`)
    .join('\n');
  return groups ? `[capacidades]\n${groups}` : '';
}

function buildTier0Lines(store, agentId) {
  const lines = [];

  // Identity: high-confidence business_context + user identity
  const identity = store.list({ type: 'business_context', agentId })
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
  const rules = store.list({ type: 'behavior_lesson', agentId })
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

function buildTier1Lines(store, agentId) {
  const lines = [];
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // 14 days

  // Preferences
  const prefs = store.list({ type: 'preference', agentId })
    .filter((r) => r.state === 'verified')
    .slice(0, 5)
    .map((r) => store.get(r.id))
    .filter(Boolean)
    .map(formatRecord)
    .filter(Boolean);
  lines.push(...prefs);

  // Recent behavior lessons (any non-rejected state)
  const recentLessons = store.list({ type: 'behavior_lesson', agentId })
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

function buildTier2Lines(store, domains, query, agentId) {
  if (domains.size === 0 && !query) return [];

  // Build a domain-enriched query
  const domainTerms = [...domains].join(' ');
  const searchQuery = `${query} ${domainTerms}`.trim();

  const records = store.search(searchQuery, {
    limit: 8,
    types: ['knowledge', 'business_context', 'contact', 'relationship', 'task_pattern'],
    states: ['verified', 'candidate', 'low_confidence'],
    agentId
  });

  return records
    .filter((r) => !['assistant_self_knowledge'].includes(r.type))
    .map(formatRecord)
    .filter(Boolean);
}

class ContextAssembler {
  constructor({ memoryStore, workingMemoryStore, knowledgeGraph, getBrandProfile, formatBrandProfile } = {}) {
    this.store = memoryStore;
    this.workingStore = workingMemoryStore;
    this.graph = knowledgeGraph || null;
    // Proveedor de la marca activa (perfil + formateador). Solo se inyecta el
    // bloque de marca en turnos de marketing/contenido — no en cada turno.
    this.getBrandProfile = typeof getBrandProfile === 'function' ? getBrandProfile : null;
    this.formatBrandProfile = typeof formatBrandProfile === 'function' ? formatBrandProfile : null;
  }

  assemble({ userText = '', recentHistory = '', agentId = null } = {}) {
    if (!this.store) return '';

    const fullQuery = `${userText} ${recentHistory}`.slice(0, 400).trim();
    const domains = detectDomains(fullQuery);
    const now = new Date();
    const dateHeader = `Fecha actual: ${formatForUser(now, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${formatForUser(now, { hour: '2-digit', minute: '2-digit' })} (hora de Chile).`;

    const sections = [`[contexto]\n${dateHeader}`];
    let budget = CHAR_BUDGET.total - dateHeader.length;

    // Capacidades propias: sección dedicada, no compite con tier0
    const capBlock = buildCapabilitiesBlock(this.store, agentId);
    if (capBlock) {
      const allowed = capBlock.slice(0, CHAR_BUDGET.capabilities);
      sections.push(allowed);
      budget -= allowed.length;
    }

    // Marca activa: cimiento de toda tarea de marketing. Solo en turnos de
    // marketing/contenido — no infla el contexto en el resto. Va arriba para que
    // todo lo que Jarvis genere (copy, landing, campaña) herede la voz/pilares.
    if (domains.has('marketing') && this.getBrandProfile) {
      try {
        const profile = this.getBrandProfile();
        if (profile && this.formatBrandProfile) {
          const block = `[marca activa]\n${this.formatBrandProfile(profile)}`.slice(0, 1000);
          sections.push(block);
          budget -= block.length;
        }
      } catch (err) {
        // Nunca rompe el ensamblado, pero si la marca desaparece del contexto por
        // un bug latente, debe verse — es la misma forma del catch mudo que dejó
        // el aprendizaje muerto por commits.
        console.warn(`[jarvis-codex] inyección de marca al contexto falló: ${err.message}`);
      }
    }

    // Tier 0
    const tier0Lines = buildTier0Lines(this.store, agentId);
    if (tier0Lines.length > 0) {
      const block = tier0Lines.join('\n');
      const allowed = block.slice(0, CHAR_BUDGET.tier0);
      sections.push(allowed);
      budget -= allowed.length;
    }

    // Tier 1
    if (budget > 400) {
      const tier1Lines = buildTier1Lines(this.store, agentId);
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
      const tier2Lines = buildTier2Lines(this.store, domains, userText.slice(0, 200), agentId);
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
        const knowledge = this.graph.getKnowledgeForMessage(userText, { limit: 4, agentId });
        if (knowledge) graphLines.push(knowledge);
        const commitments = this.graph.getOpenCommitmentsSummary({ limit: 4, agentId });
        if (commitments) graphLines.push(`Compromisos abiertos:\n${commitments}`);
      } catch (err) {
        // No rompe el ensamblado, pero un grafo que se cae siempre en silencio es
        // un contexto degradado invisible. Se registra.
        console.warn(`[jarvis-codex] grafo al contexto falló: ${err.message}`);
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
