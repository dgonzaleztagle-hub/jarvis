function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s@.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value = '', maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((term) => term.length > 1);
}

function buildEmailArtifacts(toolResult) {
  const emails = Array.isArray(toolResult?.result?.emails) ? toolResult.result.emails : [];
  return emails.slice(0, 10).map((email, index) => ({
    kind: 'email_digest_item',
    title: compactText(email.subject || `Correo ${index + 1}`, 120),
    summary: compactText([
      email.from ? `de ${email.from}` : '',
      email.category ? `tipo ${email.category}` : '',
      email.attention ? `atencion ${email.attention}` : '',
      // Índice, no payload: preferir el preview/snippet corto antes que el
      // summary completo — el contenido íntegro no debe vivir en working memory.
      email.preview || email.snippet || email.summary || ''
    ].filter(Boolean).join(' | '), 200),
    keywords: [
      ...(tokenize(email.subject) || []),
      ...(tokenize(email.from) || []),
      ...(tokenize(email.category) || []),
      ...(tokenize(email.attention) || []),
      ...(tokenize(email.why) || [])
    ],
    reference: {
      toolName: toolResult.toolName,
      emailId: email.id || null,
      threadId: email.threadId || null,
      index,
      from: email.from || '',
      date: email.date || null
    }
  }));
}

function buildCalendarArtifacts(toolResult) {
  const events = Array.isArray(toolResult?.result?.events) ? toolResult.result.events : [];
  return events.slice(0, 10).map((event, index) => ({
    kind: 'calendar_event_item',
    title: compactText(event.summary || `Evento ${index + 1}`, 120),
    summary: compactText([event.location, event.description].filter(Boolean).join(' | '), 220),
    keywords: [
      ...tokenize(event.summary),
      ...tokenize(event.location),
      ...tokenize(event.description)
    ],
    reference: {
      toolName: toolResult.toolName,
      eventId: event.id || null,
      index,
      start: event.start || null,
      end: event.end || null
    }
  }));
}

function buildContactArtifacts(toolResult) {
  const matches = Array.isArray(toolResult?.result?.matches) ? toolResult.result.matches : [];
  return matches.slice(0, 10).map((contact, index) => ({
    kind: 'contact_search_item',
    title: compactText(contact.name || `Contacto ${index + 1}`, 120),
    summary: compactText([
      Array.isArray(contact.emails) ? contact.emails[0] : '',
      Array.isArray(contact.phones) ? contact.phones[0] : ''
    ].filter(Boolean).join(' | '), 180),
    keywords: [
      ...tokenize(contact.name),
      ...((Array.isArray(contact.emails) ? contact.emails : []).flatMap((item) => tokenize(item))),
      ...((Array.isArray(contact.phones) ? contact.phones : []).flatMap((item) => tokenize(item)))
    ],
    reference: {
      toolName: toolResult.toolName,
      index
    }
  }));
}

function buildGenericArtifact(toolResult) {
  const result = toolResult?.result;
  if (!result || typeof result !== 'object') return [];
  const title = compactText(result.name || result.summary || result.title || toolResult.toolName, 120);
  const summary = compactText(
    [
      result.webViewLink,
      result.htmlLink,
      result.resolvedRecipient,
      result.echo ? JSON.stringify(result.echo) : ''
    ].filter(Boolean).join(' | '),
    220
  );
  return [{
    kind: 'tool_result',
    title,
    summary,
    keywords: [...tokenize(title), ...tokenize(summary)],
    reference: {
      toolName: toolResult.toolName
    }
  }];
}

function buildArtifactsFromToolResult(toolResult) {
  switch (toolResult?.toolName) {
    case 'google.gmail.list_emails':
      return buildEmailArtifacts(toolResult);
    case 'google.calendar.list_events':
      return buildCalendarArtifacts(toolResult);
    case 'google.contacts.search':
      return buildContactArtifacts(toolResult);
    default:
      return buildGenericArtifact(toolResult);
  }
}

class WorkingMemoryStore {
  constructor() {
    this.sessions = [];
    this.maxSessions = 24;
  }

  recordTurn({ userText = '', channel = 'hud', toolResults = [], assistantResult = {} }) {
    const artifacts = (toolResults || [])
      .filter((item) => item && item.status === 'completed')
      .flatMap((item) => buildArtifactsFromToolResult(item))
      .slice(0, 12);

    const session = {
      id: `wm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      channel,
      userText: compactText(userText, 220),
      assistantSpeak: compactText(assistantResult?.speak || '', 180),
      assistantVisual: compactText(assistantResult?.visual || '', 220),
      toolNames: (toolResults || []).map((item) => item.toolName).filter(Boolean),
      artifacts,
      createdAt: new Date().toISOString()
    };

    this.sessions.push(session);
    if (this.sessions.length > this.maxSessions) {
      this.sessions = this.sessions.slice(-this.maxSessions);
    }
    return session;
  }

  search(query, options = {}) {
    const terms = tokenize(query);
    const limit = Math.max(1, Math.min(Number(options.limit) || 4, 8));
    if (terms.length === 0) return [];

    const scored = this.sessions
      .map((session) => {
        let score = 0;
        const sessionText = normalizeText([
          session.userText,
          session.assistantSpeak,
          ...session.toolNames
        ].join(' '));

        for (const term of terms) {
          if (sessionText.includes(term)) score += 2;
          for (const artifact of session.artifacts) {
            if (normalizeText(artifact.title).includes(term)) score += 6;
            if (normalizeText(artifact.summary).includes(term)) score += 4;
            if ((artifact.keywords || []).some((keyword) => normalizeText(keyword).includes(term))) score += 5;
          }
        }

        return { session, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((item) => item.session);
  }

  buildPromptContext(query, options = {}) {
    const sessions = this.search(query, options);
    if (sessions.length === 0) return '';

    const lines = ['Contexto de trabajo reciente:'];
    for (const session of sessions) {
      lines.push(`- Turno reciente: ${session.userText}`);
      for (const artifact of session.artifacts.slice(0, 4)) {
        const refParts = [];
        if (artifact.reference?.toolName) refParts.push(`tool=${artifact.reference.toolName}`);
        if (artifact.reference?.emailId) refParts.push(`emailId=${artifact.reference.emailId}`);
        if (artifact.reference?.threadId) refParts.push(`threadId=${artifact.reference.threadId}`);
        if (artifact.reference?.eventId) refParts.push(`eventId=${artifact.reference.eventId}`);
        lines.push(`  - ${artifact.title}: ${artifact.summary || 'sin resumen'}${refParts.length ? ` [${refParts.join(', ')}]` : ''}`);
      }
    }
    return lines.join('\n');
  }
}

module.exports = {
  WorkingMemoryStore
};
