const fs = require('fs');
const path = require('path');

const VALID_STATES = ['candidate', 'verified', 'conflicting', 'low_confidence', 'rejected', 'sensitive', 'obsolete'];
const CAPABILITY_INTENT_PATTERN = /\b(capacidades?|que puedes hacer|qué puedes hacer|que sabes hacer|qué sabes hacer|superpoderes|funciones?|habilidades?|disponible|disponibles)\b/i;
const CONTACT_INTENT_PATTERN = /\b(correo|email|mail|contacto|telefono|tel[eé]fono|esposa|cliente|destinatario|numero|n[uú]mero)\b/i;
const PREFERENCE_INTENT_PATTERN = /\b(prefiero|preferencia|te pedi|te ped[ií]|no quiero|no me gusta|me gusta|como respondes|cómo respondes|formato|tono|lista|legible)\b/i;
const FOLLOWUP_INTENT_PATTERN = /\b(eso|lo mismo|antes|anterior|seguimos|retoma|continua|continúa|retomar|continuar)\b/i;

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s@.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return normalizeText(value).replace(/[^a-z0-9@.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function flattenContent(value, bucket = []) {
  if (value === null || value === undefined) return bucket;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    bucket.push(String(value));
    return bucket;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenContent(item, bucket));
    return bucket;
  }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      bucket.push(String(key));
      flattenContent(inner, bucket);
    }
  }
  return bucket;
}

function compactText(value = '', maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function compactValue(value, options = {}) {
  const maxLength = options.maxLength || 160;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return compactText(String(value), maxLength);
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 4)
      .map((item) => compactValue(item, { maxLength: Math.max(40, Math.floor(maxLength / 2)) }))
      .filter(Boolean);
    return compactText(items.join('; '), maxLength);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, inner]) => inner !== null && inner !== undefined && String(inner).trim?.() !== '')
      .slice(0, 5)
      .map(([key, inner]) => `${key}: ${compactValue(inner, { maxLength: 80 })}`)
      .filter(Boolean);
    return compactText(entries.join(' | '), maxLength);
  }
  return compactText(String(value), maxLength);
}

function inferMemoryIntent(query = '') {
  const text = String(query || '');
  if (CAPABILITY_INTENT_PATTERN.test(text)) return 'capability';
  if (CONTACT_INTENT_PATTERN.test(text)) return 'contact';
  if (PREFERENCE_INTENT_PATTERN.test(text)) return 'preference';
  if (FOLLOWUP_INTENT_PATTERN.test(text)) return 'followup';
  return 'general';
}

function inferTypesForIntent(intent) {
  switch (intent) {
    case 'capability':
      return ['assistant_self_knowledge'];
    case 'contact':
      return ['contact', 'relationship', 'behavior_lesson'];
    case 'preference':
      return ['preference', 'behavior_lesson'];
    case 'followup':
      return ['task_pattern', 'business_context', 'knowledge', 'relationship', 'contact', 'preference', 'behavior_lesson'];
    default:
      return null;
  }
}

function inferStatesForIntent(intent) {
  switch (intent) {
    case 'capability':
    case 'preference':
      return ['verified'];
    case 'contact':
      return ['verified', 'candidate'];
    default:
      return ['verified', 'candidate', 'low_confidence'];
  }
}

function formatAssistantSelfKnowledge(record) {
  const groups = Array.isArray(record.content?.capabilityGroups) ? record.content.capabilityGroups : [];
  const lines = [];
  for (const group of groups.slice(0, 4)) {
    const actions = Array.isArray(group.actions) ? group.actions.slice(0, 4).join('; ') : '';
    if (actions) lines.push(`${group.name}: ${actions}`);
  }
  const confirmation = Array.isArray(record.content?.confirmationRequiredFor)
    ? record.content.confirmationRequiredFor.slice(0, 4).join('; ')
    : '';
  if (confirmation) lines.push(`Requiere confirmacion: ${confirmation}`);
  return compactText(lines.join(' | '), 320);
}

function formatRecordForPrompt(record) {
  const aliases = (record.aliases || []).slice(0, 3).join(', ');

  if (record.type === 'assistant_self_knowledge') {
    return `Autoconocimiento activo: ${formatAssistantSelfKnowledge(record)}`;
  }

  if (record.type === 'contact') {
    const content = record.content || {};
    const parts = [
      content.name || record.title,
      content.email ? `email ${content.email}` : '',
      content.phone || content.telephone ? `telefono ${content.phone || content.telephone}` : '',
      aliases ? `aliases ${aliases}` : ''
    ].filter(Boolean);
    return `Contacto relevante: ${parts.join(' | ')}`;
  }

  if (record.type === 'preference') {
    const value = record.content?.value || record.content?.preference || compactValue(record.content, { maxLength: 180 });
    return `Preferencia confirmada: ${record.title} -> ${compactText(value, 220)}`;
  }

  if (record.type === 'behavior_lesson') {
    const principle = compactText(record.content?.principle || record.content?.rule || record.title, 220);
    const appliesTo = Array.isArray(record.content?.appliesTo) ? record.content.appliesTo.slice(0, 5).join(', ') : '';
    const behavior = compactText(record.content?.preferredBehavior || '', 140);
    return `Leccion de comportamiento: ${principle}${appliesTo ? ` | Aplica a: ${appliesTo}` : ''}${behavior ? ` | Haz esto: ${behavior}` : ''}`;
  }

  const summary = compactValue(record.content, { maxLength: 240 }) || compactText(record.title, 120);
  return `${record.title} (${record.type}, ${record.state}) -> ${summary}`;
}

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

class MemoryStore {
  constructor({ dataDir }) {
    this.memoryDir = path.join(dataDir, 'memory');
    this.indexPath = path.join(this.memoryDir, 'index.json');
    fs.mkdirSync(this.memoryDir, { recursive: true });
    if (!fs.existsSync(this.indexPath)) {
      fs.writeFileSync(this.indexPath, JSON.stringify({ records: [] }, null, 2), 'utf-8');
    }
  }

  readIndex() {
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
    } catch (error) {
      const raw = fs.existsSync(this.indexPath) ? fs.readFileSync(this.indexPath, 'utf-8') : '';
      if (!raw.trim()) {
        return { records: [] };
      }
      throw error;
    }
  }

  writeIndex(index) {
    writeJsonAtomic(this.indexPath, index);
  }

  upsert(record) {
    const state = record.state || 'candidate';
    if (!VALID_STATES.includes(state)) {
      throw new Error(`Invalid memory state: ${state}`);
    }

    const key = record.key || slugify(record.title || record.type || `memory_${Date.now()}`);
    const existingByKey = !record.id ? this.readIndex().records.find((item) => item.key === key) : null;
    const id = record.id || existingByKey?.id || `mem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const now = new Date().toISOString();
    const current = this.get(id);
    const normalized = {
      id,
      key,
      title: record.title || 'Untitled memory',
      type: record.type || 'knowledge',
      state,
      confidence: record.confidence || 0,
      sensitivity: record.sensitivity || 'normal',
      tags: record.tags || current?.tags || [],
      aliases: record.aliases || current?.aliases || [],
      sourceRefs: record.sourceRefs || [],
      content: record.content || '',
      createdAt: record.createdAt || now,
      updatedAt: now,
      expiresAt: record.expiresAt || null,
      reviewAfter: record.reviewAfter || null
    };

    const fileName = `${id}.json`;
    writeJsonAtomic(path.join(this.memoryDir, fileName), normalized);

    const index = this.readIndex();
    const summary = {
      id,
      key,
      title: normalized.title,
      type: normalized.type,
      state: normalized.state,
      confidence: normalized.confidence,
      sensitivity: normalized.sensitivity,
      tags: normalized.tags,
      aliases: normalized.aliases,
      file: fileName,
      updatedAt: normalized.updatedAt
    };
    const existing = index.records.findIndex((item) => item.id === id);
    if (existing >= 0) index.records[existing] = summary;
    else index.records.push(summary);
    this.writeIndex(index);

    return normalized;
  }

  list(filter = {}) {
    const records = this.readIndex().records;
    return records.filter((record) => {
      if (filter.state && record.state !== filter.state) return false;
      if (filter.type && record.type !== filter.type) return false;
      return true;
    });
  }

  get(id) {
    const entry = this.readIndex().records.find((record) => record.id === id);
    if (!entry) return null;
    const filePath = path.join(this.memoryDir, entry.file);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  getByKey(key) {
    const entry = this.readIndex().records.find((record) => record.key === key);
    if (!entry) return null;
    return this.get(entry.id);
  }

  updateState(id, state, patch = {}) {
    if (!VALID_STATES.includes(state)) {
      throw new Error(`Invalid memory state: ${state}`);
    }

    const current = this.get(id);
    if (!current) throw new Error(`Memory not found: ${id}`);

    return this.upsert({
      ...current,
      ...patch,
      id,
      state
    });
  }

  buildSearchCorpus(record) {
    return normalizeText([
      record.key,
      record.title,
      record.type,
      record.state,
      record.sensitivity,
      ...(record.tags || []),
      ...(record.aliases || []),
      ...flattenContent(record.content || {})
    ].filter(Boolean).join(' '));
  }

  searchScored(query, options = {}) {
    const intent = options.intent || inferMemoryIntent(query);
    const terms = normalizeText(query)
      .split(' ')
      .filter((term) => term.length > 1);
    if (terms.length === 0 && !options.types && intent !== 'capability') return [];

    const limit = Math.max(1, Math.min(Number(options.limit) || 5, 10));
    const allowedStates = options.states || inferStatesForIntent(intent);
    const allowedTypes = options.types || inferTypesForIntent(intent);

    return this.readIndex().records
      .filter((summary) => allowedStates.includes(summary.state))
      .map((summary) => this.get(summary.id))
      .filter(Boolean)
      .filter((record) => !allowedTypes || allowedTypes.includes(record.type))
      .map((record) => {
        const corpus = this.buildSearchCorpus(record);
        let score = 0;
        for (const term of terms) {
          if (normalizeText(record.title).includes(term)) score += 4;
          if ((record.aliases || []).some((alias) => normalizeText(alias).includes(term))) score += 5;
          if ((record.tags || []).some((tag) => normalizeText(tag).includes(term))) score += 3;
          if (corpus.includes(term)) score += 2;
        }
        if (intent === 'capability' && record.type === 'assistant_self_knowledge') score += 24;
        if (intent === 'contact' && record.type === 'contact') score += 10;
        if (intent === 'preference' && record.type === 'preference') score += 8;
        if (intent === 'followup' && ['task_pattern', 'business_context', 'knowledge'].includes(record.type)) score += 5;
        if (record.state === 'verified') score += 2;
        if (record.type === 'contact') score += 1;
        return { record, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  search(query, options = {}) {
    return this.searchScored(query, options).map((item) => item.record);
  }

  buildPromptContext(query, options = {}) {
    const intent = options.intent || inferMemoryIntent(query);
    const records = this.search(query, { ...options, intent });
    if (records.length === 0) return '';

    const lines = ['Contexto de memoria relevante:'];
    lines.push(`- Intencion inferida: ${intent}`);
    for (const record of records) {
      lines.push(`- ${formatRecordForPrompt(record)}`);
    }
    return lines.join('\n');
  }

  findContact(query) {
    return this.search(query, {
      limit: 3,
      types: ['contact'],
      states: ['verified', 'candidate']
    })[0] || null;
  }

  // Para herramientas outbound (wa.send_message, gmail.send_email): además del
  // mejor match, dice si hay AMBIGÜEDAD (2+ contactos empatados en el puntaje
  // más alto) — el policy-engine usa esto para exigir confirmación aunque el
  // contenido haya sido dictado literal, evitando enviar a quien no es.
  resolveRecipient(query) {
    const scored = this.searchScored(query, {
      limit: 5,
      types: ['contact'],
      states: ['verified', 'candidate']
    });
    if (scored.length === 0) return { record: null, ambiguous: false, candidates: [] };
    const topScore = scored[0].score;
    const tied = scored.filter((item) => item.score === topScore);
    return {
      record: scored[0].record,
      ambiguous: tied.length > 1,
      candidates: scored.map((item) => item.record)
    };
  }

  getAssistantSelfKnowledge() {
    return this.search('capacidades activas disponibles', {
      intent: 'capability',
      limit: 1,
      states: ['verified'],
      types: ['assistant_self_knowledge']
    })[0] || null;
  }
}

module.exports = {
  MemoryStore,
  VALID_STATES,
  inferMemoryIntent,
  normalizeText,
  slugify
};
