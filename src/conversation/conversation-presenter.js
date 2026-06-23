// Capa de presentación: cómo se formatea, compacta y entrega lo que Jarvis
// dice. Sin estado ni `this`. Incluye el contrato de voz (enforced en código,
// no solo en prompt). Extraído de conversation-runtime.js.

const { endsComplete, isInventoryIntent, hasScannableStructure, looksPromissory, isActionRequest, claimsActionDone } = require('./conversation-intents');

function redactValue(key, value) {
  if (/token|secret|api.?key|authorization|password|credential/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item)).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, inner]) => inner !== undefined && inner !== null && String(inner).trim() !== '')
      .map(([innerKey, innerValue]) => `${innerKey}=${redactValue(innerKey, innerValue)}`)
      .join(' | ');
  }
  return String(value || '');
}

function formatConfirmationInput(input = {}) {
  return Object.entries(input)
    .filter(([key, value]) => !key.startsWith('_') && value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `- ${key}: ${redactValue(key, value)}`)
    .join('\n');
}

function formatConfirmationRequest(waiting) {
  const inputText = formatConfirmationInput(waiting.input || {});
  const label = waiting.toolName === 'google.gmail.send_email'
    ? 'Enviar correo'
    : waiting.toolName;
  return {
    speak: 'Necesito tu confirmación antes de ejecutar esta acción.',
    visual: [
      `Acción pendiente: ${label}`,
      '',
      inputText || 'No hay detalles disponibles para mostrar.',
      '',
      'Confirma solo si estos datos son correctos.'
    ].join('\n')
  };
}

function buildToolSummary(tools) {
  return tools
    .filter((tool) => !tool.name.startsWith('model.'))
    .map((tool) => `- ${tool.name}: ${tool.description} | risk=${tool.risk} | permissions=${tool.permissions.join(',')}`)
    .join('\n');
}

// Texto plano de lo que Jarvis dijo, SIN etiquetas ("Respuesta:", "Visual:")
// ni cortes a mitad de palabra. Esto se retroalimenta al modelo como su propio
// historial en el próximo turno — si lleva etiquetas o queda mutilado, el
// modelo lo imita o razona sobre una versión corrupta de lo que dijo.
function summarizeConversationResult(result = {}) {
  return String(result.speak || result.visual || '').trim();
}

function compactText(value = '', maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function compactToolResultPayload(toolName, result) {
  if (!result || typeof result !== 'object') return result;

  if (toolName === 'google.gmail.list_emails') {
    const emails = Array.isArray(result.emails) ? result.emails.slice(0, 6) : [];
    return {
      count: emails.length,
      emails: emails.map((email) => ({
        subject: compactText(email.subject, 120),
        from: compactText(email.from, 80),
        date: email.date,
        category: email.category,
        attention: email.attention,
        summary: compactText(email.summary, 180),
        why: compactText(email.why, 160),
        suggestedAction: compactText(email.suggestedAction, 120),
        preview: compactText(email.preview || email.snippet, 140)
      }))
    };
  }

  if (toolName === 'google.calendar.list_events') {
    const events = Array.isArray(result.events) ? result.events.slice(0, 8) : [];
    return {
      events: events.map((event) => ({
        summary: compactText(event.summary, 100),
        start: event.start,
        end: event.end,
        location: compactText(event.location, 100)
      }))
    };
  }

  if (toolName === 'google.contacts.search') {
    const matches = Array.isArray(result.matches) ? result.matches.slice(0, 8) : [];
    return {
      matches: matches.map((contact) => ({
        name: compactText(contact.name, 80),
        emails: Array.isArray(contact.emails) ? contact.emails.slice(0, 2) : [],
        phones: Array.isArray(contact.phones) ? contact.phones.slice(0, 2) : []
      }))
    };
  }

  if (toolName === 'google.docs.create_document') {
    return {
      name: compactText(result.name, 120),
      webViewLink: result.webViewLink
    };
  }

  if (toolName === 'google.gmail.send_email' || toolName === 'google.gmail.create_draft') {
    return {
      resolvedRecipient: compactText(result.resolvedRecipient, 120),
      id: result.id,
      threadId: result.threadId
    };
  }

  if (/google\.gmail\.(trash_email|archive_email|mark_read)/.test(toolName)) {
    return { done: true, emailId: result.emailId };
  }

  if (toolName === 'google.gmail.get_thread') {
    const messages = Array.isArray(result.messages) ? result.messages.slice(0, 5) : [];
    return {
      subject: compactText(result.subject, 120),
      messageCount: result.messageCount,
      participants: (result.participants || []).slice(0, 4),
      messages: messages.map((m) => ({
        from: compactText(m.from, 80),
        date: m.date,
        snippet: compactText(m.snippet || m.body, 200)
      }))
    };
  }

  if (toolName === 'google.gmail.search_emails') {
    const emails = Array.isArray(result.emails) ? result.emails.slice(0, 6) : [];
    return {
      query: result.query,
      count: emails.length,
      emails: emails.map((e) => ({
        subject: compactText(e.subject, 120),
        from: compactText(e.from, 80),
        date: e.date,
        summary: compactText(e.summary || e.snippet, 180)
      }))
    };
  }

  if (toolName === 'google.tasks.list_tasklists') {
    const lists = Array.isArray(result.tasklists) ? result.tasklists : [];
    return {
      count: lists.length,
      tasklists: lists.map((tl) => ({ title: compactText(tl.title, 80) }))
    };
  }

  if (toolName === 'google.tasks.list_tasks') {
    const tasks = Array.isArray(result.tasks) ? result.tasks.slice(0, 12) : [];
    return {
      count: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: compactText(t.title, 100),
        status: t.status,
        due: t.due,
        notes: compactText(t.notes, 120)
      }))
    };
  }

  if (/google\.tasks\.(create_task|complete_task)/.test(toolName)) {
    return {
      id: result.id,
      title: compactText(result.title, 100),
      status: result.status,
      due: result.due
    };
  }

  if (toolName === 'google.sheets.list_spreadsheets') {
    const sheets = Array.isArray(result.spreadsheets) ? result.spreadsheets.slice(0, 10) : [];
    return {
      count: sheets.length,
      spreadsheets: sheets.map((s) => ({ name: compactText(s.name, 100), url: s.url }))
    };
  }

  if (toolName === 'google.sheets.get_info') {
    return {
      title: compactText(result.title, 100),
      url: result.url,
      sheets: (result.sheets || []).map((s) => ({ title: s.title, rowCount: s.rowCount, columnCount: s.columnCount }))
    };
  }

  if (toolName === 'google.sheets.read_range') {
    const rows = Array.isArray(result.rows) ? result.rows.slice(0, 15) : [];
    return {
      range: result.range,
      totalRows: result.totalRows,
      headers: result.headers,
      rows
    };
  }

  if (toolName === 'google.sheets.write_range') {
    return {
      updatedRange: result.updatedRange,
      updatedRows: result.updatedRows,
      mode: result.mode
    };
  }

  if (toolName === 'google.calendar.create_event' || toolName === 'google.calendar.update_event') {
    return {
      summary: compactText(result.summary, 100),
      start: result.start,
      end: result.end,
      attendeeCount: (result.attendees || []).length,
      hasConference: !!(result.conferenceData)
    };
  }

  if (toolName === 'google.calendar.delete_event') {
    return { deleted: result.deleted, eventId: result.eventId };
  }

  if (toolName === 'google.calendar.find_free_slots') {
    const slots = Array.isArray(result.freeSlots) ? result.freeSlots.slice(0, 5) : [];
    return { durationMinutes: result.durationMinutes, freeSlots: slots };
  }

  // Generic fallback — strip any field that looks like an internal ID or implementation detail
  if (result && typeof result === 'object') {
    const safe = {};
    for (const [k, v] of Object.entries(result)) {
      if (/spreadsheetId|tasklistId|calendarId|selfLink|etag|kind/i.test(k)) continue;
      safe[k] = v;
    }
    return safe;
  }

  return result;
}

// El contrato dice "nunca dupliques visual y speak", pero a veces el modelo lo
// viola (escribe la misma respuesta en ambos campos, parafraseada). Acá se
// hace cumplir determinísticamente: si son casi-duplicados, queda uno solo.
// Caso especial: si speak quedó cortado (JSON trunco por maxTokens) y visual
// es la versión completa, la versión completa gana — nunca entregar texto
// cortado a media frase teniendo el completo al lado.
function collapseDuplicateSpeakVisual(response = {}) {
  const speak = String(response.speak || '').trim();
  const visual = String(response.visual || '').trim();
  if (!speak || !visual) return response;
  const ns = speak.replace(/\s+/g, ' ').toLowerCase();
  const nv = visual.replace(/\s+/g, ' ').toLowerCase();
  const probe = Math.min(100, ns.length, nv.length);
  const duplicated = nv.includes(ns) || ns.includes(nv)
    || (probe >= 40 && ns.slice(0, probe) === nv.slice(0, probe));
  if (!duplicated) return response;
  if (!endsComplete(speak) && endsComplete(visual)) {
    return { ...response, speak: visual, visual: '' };
  }
  return { ...response, visual: '' };
}

// Contrato de salida hablada, enforced en código (no solo en prompt):
// 1) sin duplicados speak/visual, 2) speak tiene techo de voz — el excedente
// no se pierde: el texto completo pasa a visual, 3) speak nunca termina a
// media frase — si quedó cortado, se retrocede al último cierre de oración.
const SPEAK_MAX_CHARS = 420;
function enforceSpeakContract(response = {}) {
  let out = collapseDuplicateSpeakVisual(response);
  const original = String(out.speak || '').trim();
  if (!original) return out;
  let speak = original;

  if (speak.length > SPEAK_MAX_CHARS) {
    const cut = speak.slice(0, SPEAK_MAX_CHARS);
    const lastEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'));
    speak = lastEnd > SPEAK_MAX_CHARS * 0.4 ? cut.slice(0, lastEnd + 1).trim() : cut.trim();
    out = { ...out, speak, visual: String(out.visual || '').trim() || original };
  }

  if (!endsComplete(speak)) {
    const closed = speak.match(/^[\s\S]*[.!?…»")]/);
    if (closed && closed[0].trim().length >= speak.length * 0.5) {
      out = { ...out, speak: closed[0].trim() };
    }
  }

  return out;
}

function responseSeemsIncomplete({ userText = '', response = {}, toolResults = [] } = {}) {
  const combined = `${response.speak || ''}\n${response.visual || ''}`.trim();
  if (!combined) return true;

  const shortResponse = combined.replace(/\s+/g, ' ').trim().length < 110;
  const inventoryIntent = isInventoryIntent(userText);
  const askedSummary = /\b(resume|resumen|analiza|analisis|análisis|compara|comparativa|explica|detalla|describe|cuales son|cuáles son)\b/i.test(String(userText));

  if (inventoryIntent && (!hasScannableStructure(combined) || shortResponse)) return true;
  if ((askedSummary || inventoryIntent) && looksPromissory(combined) && shortResponse) return true;
  if (/\?$/.test(String(userText).trim()) && looksPromissory(combined) && shortResponse) return true;

  return false;
}

// El modelo (Haiku, vía Anthropic) a veces "narra" una llamada a herramienta
// imitando su propio formato nativo de tool-use (<function_calls><invoke...>)
// como TEXTO dentro de "speak", en vez de llenar el array "toolCalls" real que
// el runtime ejecuta. Resultado: toolCalls queda vacío (cero ejecución real)
// pero el texto suena a que la acción se hizo — una afirmación de éxito
// fabricada. Detectado con evidencia real: agente que decía "envió el mensaje
// por WhatsApp" con cero entradas de wa.send_message en el audit trail.
const TOOL_CALL_LEAK_RE = /<\s*\/?\s*(function_calls|invoke|antml:invoke|parameter)\b/i;

function containsToolCallLeak(text = '') {
  return TOOL_CALL_LEAK_RE.test(String(text || ''));
}

// No hay forma de saber si la acción narrada ocurrió de verdad — toolCalls
// estaba vacío, así que no ocurrió. Reemplaza por una frase honesta en vez de
// dejar pasar la afirmación fabricada al usuario o al historial.
function stripToolCallLeak(response = {}) {
  const speak = String(response.speak || '');
  const visual = String(response.visual || '');
  if (!containsToolCallLeak(speak) && !containsToolCallLeak(visual)) return response;
  return {
    ...response,
    speak: 'No alcancé a completar esa acción correctamente — intentémoslo de nuevo.',
    visual: '',
    toolCalls: [],
    _toolCallLeakDetected: true
  };
}

// Segundo patrón de "éxito fabricado", sin la sintaxis XML del primero: el
// usuario pidió una acción (verbo imperativo: manda, guarda, crea...), CERO
// tools corrieron en todo el turno, y el modelo de todas formas narra en
// prosa normal que la acción se hizo ("listo, lo envié", "quedó guardado").
// Encontrado real: brand.save/preview.render_html "confirmados" sin ninguna
// entrada en audit.jsonl. A diferencia de stripToolCallLeak (patrón fijo),
// acá el gatillo es 100% estructural — toolResults.length === 0 es un hecho
// verificable, no requiere interpretar qué dice el texto — el vocabulario de
// isActionRequest/claimsActionDone es finito y acotado, no NLU abierta.
function stripFabricatedActionClaim(response = {}, { userText = '', toolResultsCount = 0 } = {}) {
  if (toolResultsCount > 0) return response;
  if (!isActionRequest(userText)) return response;
  const speak = String(response.speak || '');
  const visual = String(response.visual || '');
  if (!claimsActionDone(speak) && !claimsActionDone(visual)) return response;
  return {
    ...response,
    speak: 'Antes de seguir: no llegué a ejecutar esa acción todavía. ¿Quieres que la intente ahora?',
    visual: '',
    _fabricatedActionClaimDetected: true
  };
}

function summarizeToolResults(toolResults = []) {
  return toolResults.map((item) => ({
    toolName: item.toolName,
    status: item.status,
    result: compactToolResultPayload(item.toolName, item.result),
    error: item.error
  }));
}

module.exports = {
  redactValue,
  formatConfirmationInput,
  formatConfirmationRequest,
  buildToolSummary,
  summarizeConversationResult,
  compactText,
  compactToolResultPayload,
  collapseDuplicateSpeakVisual,
  enforceSpeakContract,
  responseSeemsIncomplete,
  summarizeToolResults,
  containsToolCallLeak,
  stripToolCallLeak,
  stripFabricatedActionClaim,
  SPEAK_MAX_CHARS
};
