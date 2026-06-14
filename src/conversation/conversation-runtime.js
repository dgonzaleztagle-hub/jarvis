const { formatHumanReadable } = require('../presenters/human-readable-format');
const { applyOutputValueContract, inferOutputValue } = require('../presenters/output-value-contract');
const { learnFromConversationTurn } = require('../memory/memory-learning');
const { extractGraphFromTurn } = require('../memory/graph-extractor');
const { renderPersonaPrompt } = require('./persona-core');
const { detectFeedbackPolarity, selectLessonsInPlay, applyReinforcement } = require('../memory/lesson-reinforcement');
const { buildQuickAck } = require('./quick-ack');

function isAffirmativeConfirmation(text = '') {
  return /^(si|sí|confirmo|confirmar|dale|ok|okay|acepto|envialo|envíalo|procede|hazlo|adelante)$/i.test(String(text).trim());
}

// Visto bueno explícito DENTRO del mensaje que dispara la acción ("me gusta
// la idea, vamos con ello"). Cuenta como confirmación para tools de riesgo
// high en este mismo turno: el usuario ya dijo que sí, no se le pregunta de
// nuevo. No aplica a critical ni anula reglas de procedencia (policy-engine).
function isExplicitGoAhead(text = '') {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return /\b(vamos con (ello|eso|esa|todo)|dale(?: no mas)?|hazlo|hagamoslo|procede|adelante|apruebo|confirmo|crealo|creala|ejecutalo|manos a la obra|si,? (hazlo|dale|procede|crealo))\b/.test(t);
}

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
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
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

function summarizeConversationResult(result = {}) {
  const fragments = [];
  if (result.speak) fragments.push(`Respuesta: ${result.speak}`);
  if (result.visual) fragments.push(`Visual: ${String(result.visual).replace(/\s+/g, ' ').slice(0, 320)}`);
  if (Array.isArray(result.toolResults) && result.toolResults.length > 0) {
    fragments.push(`Herramientas: ${result.toolResults.map((item) => `${item.toolName}:${item.status}`).join(', ')}`);
  }
  return fragments.join('\n');
}

function compactText(value = '', maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function userMentionsExplicitDate(text = '') {
  return /\b(hoy|today|mañana|manana|tomorrow|ayer|yesterday|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/i.test(String(text || ''));
}

function extractMentionedTime(text = '') {
  const match = String(text || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] ? match[3].toLowerCase() : '';
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function setDateKeepingTime(baseDate, sourceDate) {
  const next = new Date(baseDate);
  next.setHours(sourceDate.getHours(), sourceDate.getMinutes(), 0, 0);
  return next;
}

function isEmailLike(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function sanitizeAttendees(value) {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const normalized = list
    .map((entry) => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        return isEmailLike(trimmed) ? trimmed : null;
      }
      if (entry && typeof entry === 'object') {
        const email = entry.email || entry.address || '';
        return isEmailLike(email) ? String(email).trim() : null;
      }
      return null;
    })
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function sanitizeCalendarCreateEventInput(userText, input = {}) {
  const sanitized = { ...input };
  const rawText = String(userText || '');
  const lower = rawText.toLowerCase();

  const mentionsExplicitDate = userMentionsExplicitDate(rawText);
  const mentionsMeetLink = /\bhttps?:\/\/\S+/.test(rawText);
  const mentionsMeetPlatform = /\b(meet|google meet)\b/i.test(rawText);
  const mentionsDescription = /\b(descripcion|descripción|detalle|nota|agenda|motivo)\b/i.test(rawText);
  const mentionedTime = extractMentionedTime(rawText);

  if (!mentionsDescription) {
    delete sanitized.description;
  }

  if (!mentionsMeetLink && !mentionsMeetPlatform) {
    delete sanitized.conferenceData;
    delete sanitized.meetingUrl;
    delete sanitized.meetUrl;
    delete sanitized.zoomUrl;
  }

  if (!mentionsExplicitDate && mentionedTime) {
    const today = new Date();
    today.setSeconds(0, 0);
    const startSource = sanitized.startTime ? new Date(sanitized.startTime) : null;
    const endSource = sanitized.endTime ? new Date(sanitized.endTime) : null;

    const safeStart = startSource && !Number.isNaN(startSource.getTime())
      ? setDateKeepingTime(today, startSource)
      : new Date(today.getFullYear(), today.getMonth(), today.getDate(), mentionedTime.hour, mentionedTime.minute, 0, 0);

    let safeEnd;
    if (endSource && !Number.isNaN(endSource.getTime())) {
      safeEnd = setDateKeepingTime(today, endSource);
    } else {
      safeEnd = new Date(safeStart.getTime() + 60 * 60 * 1000);
    }

    if (safeEnd.getTime() <= safeStart.getTime()) {
      safeEnd = new Date(safeStart.getTime() + 60 * 60 * 1000);
    }

    sanitized.startTime = safeStart.toISOString();
    sanitized.endTime = safeEnd.toISOString();
  }

  if (!sanitized.summary && sanitized.title) {
    sanitized.summary = sanitized.title;
  }

  const safeGuests = sanitizeAttendees(sanitized.guests);
  const safeAttendees = sanitizeAttendees(sanitized.attendees);
  if (safeGuests) {
    sanitized.guests = safeGuests;
  } else {
    delete sanitized.guests;
  }
  if (safeAttendees) {
    sanitized.attendees = safeAttendees;
  } else {
    delete sanitized.attendees;
  }

  return sanitized;
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

function buildModelFailureMessage(error) {
  const message = error?.message || 'MODEL_ERROR';
  if (/MODEL_JSON_PARSE_FAILED|not valid JSON|Unexpected token/i.test(message)) {
    return {
      speak: 'El modelo respondió de forma inconsistente y no pude cerrar bien la tarea.',
      visual: 'Voy a necesitar reintentar esa solicitud o endurecer mejor el formato interno para que Jarvis no se corte al responder.'
    };
  }

  if (/429|rate.?limit|quota/i.test(message)) {
    return {
      speak: 'El modelo externo está limitado en este momento.',
      visual: 'Parece un límite temporal de uso o cuota. Conviene reintentar en unos segundos o ajustar el proveedor/modelo.'
    };
  }

  if (/401|403|api[_ ]?key|missing/i.test(message)) {
    return {
      speak: 'No pude autenticar correctamente el modelo externo.',
      visual: 'Revisa la credencial o la configuración activa del proveedor.'
    };
  }

  return {
    speak: 'No pude contactar el modelo en este momento.',
    visual: ''
  };
}

function unescapeJsonString(value = '') {
  try { return JSON.parse(`"${value}"`); } catch (_) {
    return String(value).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t');
  }
}

// El modelo a veces devuelve el JSON cortado por maxTokens (string sin cerrar,
// llave sin cerrar). Acá rescatamos el "speak" (que casi siempre quedó completo)
// en vez de mostrarle al usuario el JSON crudo con \n literales.
function salvageTruncatedJson(text = '') {
  if (!/"speak"\s*:/.test(text)) return null;
  const speakMatch = text.match(/"speak"\s*:\s*"((?:[^"\\]|\\.)*)/);
  const speak = speakMatch ? unescapeJsonString(speakMatch[1]).trim() : '';
  if (!speak) return null;
  // visual solo si su string quedó completo (cierra comillas); cortado no sirve
  const visualMatch = text.match(/"visual"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const visual = visualMatch ? unescapeJsonString(visualMatch[1]).trim() : '';
  return { speak, visual };
}

function coercePlainModelText(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const salvaged = salvageTruncatedJson(text);
  if (salvaged) {
    return {
      speak: salvaged.speak,
      visual: salvaged.visual,
      format: hasScannableStructure(salvaged.visual) ? 'list' : 'brief',
      outputValue: {
        mode: 'response',
        requiresTransformation: false,
        rule: 'When the model returns truncated JSON, salvage the spoken synthesis instead of showing raw JSON.'
      },
      toolCalls: []
    };
  }
  // Si parece JSON pero no se pudo rescatar nada legible, mejor el mensaje de
  // falla limpio que volcar llaves y escapes al feed.
  if (/^[{\[]/.test(text)) return null;
  const labeledMatch = text.match(/respuesta:\s*([\s\S]*?)(?:\n+visual:\s*|visual:\s*)([\s\S]*)/i);
  if (labeledMatch) {
    const speak = String(labeledMatch[1] || '').trim();
    const visual = String(labeledMatch[2] || '').trim();
    return {
      speak: compactText(speak, 180),
      visual: visual || speak,
      format: /\n[-*]\s|\n\d+\.\s/.test(visual) ? 'list' : 'brief',
      outputValue: {
        mode: 'response',
        requiresTransformation: false,
        rule: 'When the model returns labeled plain text, strip internal labels before showing it.'
      },
      toolCalls: []
    };
  }
  const compact = text.replace(/\s+/g, ' ').trim();
  const [firstParagraph, ...rest] = text.split(/\n{2,}/).filter(Boolean);
  return {
    speak: compact.length > 180 ? `${compact.slice(0, 177).trim()}...` : compact,
    visual: rest.length > 0 ? [firstParagraph, ...rest].join('\n\n') : firstParagraph,
    format: /\n-|^\d+\./m.test(text) ? 'list' : 'brief',
    outputValue: {
      mode: 'response',
      requiresTransformation: false,
      rule: 'When the model misses JSON but returns useful plain language, preserve the value instead of failing hard.'
    },
    toolCalls: []
  };
}

function isCapabilitiesIntent(text = '') {
  return /\b(capacidades?|que puedes hacer|qué puedes hacer|que sabes hacer|qué sabes hacer|superpoderes|funciones?|habilidades?)\b/i.test(String(text));
}

function isInventoryIntent(text = '') {
  return /\b(capacidades?|que puedes hacer|qué puedes hacer|que sabes hacer|qué sabes hacer|superpoderes|funciones?|habilidades?|lista|listar|opciones|qué hay disponible|que hay disponible)\b/i.test(String(text));
}

function hasScannableStructure(text = '') {
  return /\n[-*]\s|\n\d+\.\s|:\n/.test(String(text || ''));
}

function looksPromissory(text = '') {
  return /\b(te cuento|te explico|te detallo|te muestro|te lo resumo|ahora te digo|claro[,.\s]+señor)\b/i.test(String(text || ''));
}

function endsComplete(text = '') {
  return /[.!?…)"»]\s*$/.test(String(text || '').trim());
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
  if (toolResults.length > 0) return false;

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

function summarizeToolResults(toolResults = []) {
  return toolResults.map((item) => ({
    toolName: item.toolName,
    status: item.status,
    result: compactToolResultPayload(item.toolName, item.result),
    error: item.error
  }));
}

function buildResponseRepairPrompt({ memoryContext = '', toolSummary = '' } = {}) {
  return `Eres Jarvis Codex revisando si tu propia respuesta quedo a medias.

Tu trabajo:
- detectar cuando la respuesta inicial prometio valor pero no lo entrego
- completar la respuesta de forma natural y util
- contestar directamente la intencion del usuario
- decidir si el chat necesita un cierre breve o una salida estructurada
- no pedir disculpas vacias ni repetir que "puedes ayudar"
- no solicitar herramientas nuevas

${memoryContext ? `${memoryContext}\n` : ''}
${toolSummary ? `Capacidades disponibles:\n${toolSummary}\n` : ''}

Responde siempre JSON valido:
{
  "speak": "respuesta final breve y completa",
  "visual": "detalle util y suficiente para pantalla",
  "format": "brief | list | table | sections | artifact",
  "outputValue": { "mode": "response | inspection | summary | analysis | comparison", "requiresTransformation": true/false }
}

Reglas:
- Si el usuario pidio panorama, capacidades, opciones o cosas disponibles, entrega grupos o lista real.
- Si la respuesta inicial ya estaba bien, mejorala solo si hace falta claridad.
- Nunca dejes una promesa del tipo "te cuento" sin contar nada.
- Si no puedes contestar completamente, di exactamente que falta y entrega lo que si sabes ahora.`;
}

function buildCapabilitiesResponse(toolRegistry, memoryStore) {
  const selfKnowledge = memoryStore?.getAssistantSelfKnowledge?.();
  if (selfKnowledge?.content?.capabilityGroups?.length) {
    const sections = selfKnowledge.content.capabilityGroups
      .map((group) => [
        `${group.name}:`,
        ...(group.actions || []).map((action) => `- ${action}`)
      ].join('\n'))
      .filter(Boolean);

    if (Array.isArray(selfKnowledge.content.confirmationRequiredFor) && selfKnowledge.content.confirmationRequiredFor.length > 0) {
      sections.push([
        'Acciones que suelen requerir confirmación:',
        ...selfKnowledge.content.confirmationRequiredFor.slice(0, 6).map((action) => `- ${action}`)
      ].join('\n'));
    }

    return {
      speak: 'Ya revisé mis capacidades activas y puedo ayudarte con varias tareas reales.',
      visual: [
        'Capacidades activas de Jarvis Codex',
        '',
        ...sections
      ].join('\n\n'),
      format: 'sections',
      outputValue: {
        mode: 'inspection',
        requiresTransformation: false,
        rule: 'Capability overviews must reflect the active runtime, not a guessed answer.'
      },
      toolCalls: []
    };
  }

  const tools = toolRegistry.list().filter((tool) => !tool.name.startsWith('model.') && !tool.name.startsWith('memory.'));
  const groups = [
    {
      title: 'Comunicación y organización',
      match: (name) => /^google\.(gmail|calendar|contacts)\./.test(name)
    },
    {
      title: 'Documentos e informes',
      match: (name) => /^google\.docs\./.test(name)
    },
    {
      title: 'Voz y canales',
      match: (name) => /^voice\./.test(name)
    },
    {
      title: 'Investigación y criterio',
      match: (name) => /^research\./.test(name)
    }
  ];

  const assigned = new Set();
  const sections = groups
    .map((group) => {
      const entries = tools.filter((tool) => {
        const ok = group.match(tool.name);
        if (ok) assigned.add(tool.name);
        return ok;
      });
      if (entries.length === 0) return null;
      return [
        `${group.title}:`,
        ...entries.map((tool) => `- ${tool.description}`)
      ].join('\n');
    })
    .filter(Boolean);

  const remaining = tools.filter((tool) => !assigned.has(tool.name));
  if (remaining.length > 0) {
    sections.push([
      'Otras capacidades activas:',
      ...remaining.map((tool) => `- ${tool.description}`)
    ].join('\n'));
  }

  return {
    speak: 'Hoy puedo ayudarte con varias tareas reales y ya tengo varias capacidades activas.',
    visual: [
      'Capacidades activas de Jarvis Codex',
      '',
      ...sections
    ].join('\n\n'),
    format: 'sections',
    outputValue: {
      mode: 'inspection',
      requiresTransformation: false,
      rule: 'Capability overviews must be concrete, grouped and readable.'
    },
    toolCalls: []
  };
}

class ConversationRuntime {
  constructor({ eventBus, taskRuntime, toolRegistry, modelProvider, presenterRegistry, memoryStore, workingMemoryStore, contextAssembler, knowledgeGraph, persona }) {
    this.eventBus = eventBus;
    this.taskRuntime = taskRuntime;
    this.toolRegistry = toolRegistry;
    this.modelProvider = modelProvider;
    this.presenterRegistry = presenterRegistry;
    this.memoryStore = memoryStore;
    this.workingMemoryStore = workingMemoryStore;
    this.contextAssembler = contextAssembler || null;
    this.knowledgeGraph = knowledgeGraph || null;
    // Perfil de persona resuelto (fábrica + overlay de cliente). Si no se pasa,
    // renderPersonaPrompt cae al perfil de fábrica.
    this.persona = persona || null;
    this.history = [];
    // Lecciones de comportamiento que estuvieron en juego el turno anterior.
    // Se evalúan contra la reacción del usuario en el turno siguiente (refuerzo).
    this._lessonsInPlay = [];
  }

  // System 100% estable (persona, tools, reglas) marcado para prompt caching.
  // NADA dinámico vive aquí: la memoria y la fecha viajan en el mensaje del
  // usuario. Así el prefijo system+historial es cacheable turno a turno —
  // si la fecha entrara al system, rompería el cache cada minuto.
  buildSystemPrompt() {
    const stable = `Eres Jarvis Codex, un asistente local-first gobernado por herramientas.

Tu arquitectura (hechos, no los contradigas nunca):
- Corres LOCALMENTE en el computador del usuario, como un proceso en su máquina. No eres un bot de nube: "el computador del usuario" es TU casa.
- El HUD (interfaz visual en pantalla), Telegram y la voz son CARAS distintas del mismo sistema: tú. Lo que llega por un canal existe para todos.
- Los archivos que el usuario te envía (fotos, documentos) quedan guardados en tu bandeja local (inbox) EN su computador. Ya tienes acceso a ellos.
- Si te preguntan si puedes hacer algo local (mostrar en el HUD, leer un archivo recibido), la respuesta nunca es "no tengo acceso a tu computador". Si existe una herramienta para eso, úsala; si no existe, di que esa función específica aún no está disponible — sin inventar limitaciones de acceso.
- Nunca afirmes una limitación sin verificarla: si hay una herramienta que podría servir, INTENTA primero y reporta el resultado real.

${renderPersonaPrompt(this.persona)}

No ejecutes acciones directamente. Decide si responder o solicitar herramientas.

Herramientas disponibles:
${buildToolSummary(this.toolRegistry.list())}

Responde siempre JSON valido con esta forma:
{
  "speak": "respuesta hablada para el usuario",
  "visual": "detalle opcional para pantalla",
  "screenDetail": false,
  "format": "brief | list | table | sections | artifact",
  "depth": "brief | expanded",
  "outputValue": { "mode": "response | inspection | summary | analysis | comparison", "requiresTransformation": true/false },
  "toolCalls": [
    { "toolName": "nombre.herramienta", "input": { } }
  ]
}

Reglas:
- Usa toolCalls solo cuando haga falta.
- No inventes resultados de herramientas.
- Si una herramienta puede cambiar datos, considera el riesgo real antes de asumir que necesita confirmacion.
- Para agenda, leer eventos es aceptable y crear reuniones normales tambien. Solo pide confirmacion si la accion es claramente sensible o ambigua.
- Si tienes todos los datos para una accion de alto riesgo, llama la herramienta; no pidas confirmacion en texto. El runtime creara la confirmacion formal.
- Si faltan datos obligatorios, pregunta solo por los datos faltantes.
- No inventes invitados, enlaces de videollamada, ubicaciones ni metadatos de calendario que el usuario no haya dado. Si faltan y son necesarios, preguntalos. Si no son necesarios, agenda solo con lo que si sabes.
- Piensa como humano que debe leer la pantalla: si el usuario pide elementos, ultimos correos, opciones, eventos, archivos o resultados, usa formato de lista.
- No entregues datos revisables como parrafo unico.
- speak es siempre voz: habla como si le contaras el resultado a alguien en persona. Nunca leas campos técnicos, IDs, URLs, nombres de parámetros ni términos internos. Si el resultado ya está en pantalla o en un documento externo, confirma en una sola frase natural.
- visual es para pantalla: estructura clara, listas, datos concretos.

REGISTRO DE CONVERSACION — campo "depth":
- Por defecto "depth": "brief". Responde directo y al grano: tareas, datos, confirmaciones y preguntas puntuales no necesitan que te explayes.
- Usa "depth": "expanded" SOLO cuando el usuario lo PIDE explícitamente: "explayate", "cuéntame más", "en detalle", "dame el desglose", "conversemos de…", "qué opinas", "analicemos esto", "profundiza", "no me cortes", "ayúdame a pensar". Si no lo pidió, NO te expandas por tu cuenta aunque el tema sea grande.
- Si el tema da para más pero el usuario NO pidió profundidad: responde breve con lo esencial y CIERRA ofreciendo más, de forma que quede explícito que hay más disponible si lo quiere. Ejemplos de cierre: "si quieres que profundice, dime", "tengo más detalle si te sirve", "puedo desglosártelo en pantalla si lo necesitas". El ofrecimiento es una invitación a que el usuario pida en otro mensaje — NO es una promesa de que el detalle viene solo (no digas "ahora te detallo" ni "dame un momento").
- No ofrezcas más en respuestas triviales o cerradas (la hora, un sí/no, una confirmación, un dato puntual): ahí el ofrecimiento sobra y molesta. El ofrecimiento es solo cuando genuinamente hay más tela que cortar.
- Con "expanded" desarrollas la idea como persona explicando en una conversación: varias frases, hilo propio, opinión si aplica. NUNCA recites un paper ni vuelques texto crudo de una búsqueda.
- En la duda entre los dos, elige "brief" + ofrecimiento. Es mejor quedarse corto y que el usuario pida más, que cansarlo.
- ESTA RESPUESTA ES TU UNICO TURNO. No existe un turno siguiente automático: si anuncias algo ("voy a analizar...", "dame un momento", "ahora te cuento"), ese contenido NUNCA llegará al usuario. Todo lo que el usuario pidió debe ir completo en esta misma respuesta.
- Si el usuario pide análisis, resumen, comparación, listado, catálogo o inventario con datos/opciones que se puedan estructurar (listas, tablas, secciones), usa "depth": "expanded" y "screenDetail": true. Esto incluye cuando pregunta por tus funciones, herramientas o capacidades: el catálogo va a pantalla, no a "speak" ni a "visual". En "speak" pon SOLO la síntesis hablada BREVE: el veredicto y lo esencial en pocas frases (apunta a unos 400 caracteres, lo que dirías en voz alta), natural y autosuficiente. El desglose completo (la tabla, la lista, las secciones, los datos) NO va en "speak" ni en "visual": se genera por separado para pantalla. Deja "visual" vacío (""). No viertas el análisis entero en "speak" — eso hace que la voz tarde en empezar.
- Si el usuario pide una opinión, reflexión o conversación abierta (sin datos que mostrar en pantalla), pon TODA la respuesta en "speak", deja "visual" vacío ("") y "screenDetail": false. NUNCA repitas o parafrasees en "visual" lo mismo que ya dijiste en "speak" — "speak" se lee en voz alta y "visual" también se concatena a la voz si no hay panel, así que el contenido duplicado se escucha dos veces.
- "screenDetail": true significa "hay detalle estructurado que vale mostrar en pantalla aparte de lo que digo por voz". Úsalo solo cuando ese detalle existe (listas, tablas, comparaciones, pasos). Para charla u opinión va false.
- "speak" es SIEMPRE texto plano para voz: jamás uses markdown (**, ##, -, \`, etc.) en "speak". Si necesitas remarcar algo, hazlo con la redacción, no con símbolos.
- Si prometes resumen, analisis o comparacion, entrega valor real: sintetiza, prioriza o compara. No copies texto bruto ni snippets limpiados.
- Si el contexto reciente contiene emailId o threadId de correos ya mostrados, usaLOS directamente para acciones (trash, archive, get_thread). No vuelvas a listar correos para buscar el ID.
- "borra", "elimina", "archiva", "marca como leído" sobre un correo mencionado antes = acción directa con el ID del contexto.
- Cuando el usuario especifica una cantidad ("los 3 más importantes", "el próximo evento", "los últimos 5"), tradúcela al parámetro correcto del tool (maxResults, limit) y úsala. No uses valores por defecto que ignoren lo pedido.
- Cuando el usuario especifica un filtro ("los importantes", "solo urgentes", "de esta semana"), tradúcelo al parámetro de filtro correspondiente. El resultado mostrado debe coincidir con lo pedido.
- En "speak" NUNCA menciones: parámetros internos (maxResults, attentionFilter, etc.), capacidades del sistema, herramientas usadas, nombres de funciones, ni contexto operacional interno. Solo habla de resultados y acciones desde la perspectiva del usuario.
- Reporta cuántos items encontraste o estás mostrando, nunca cuántos "pediste" al tool.

CONTENIDO HTML / PÁGINAS / LANDINGS:
- Si el usuario te pide crear una página, landing, sitio, maqueta web o algo visual en HTML, usa la herramienta preview.render_html. NO escribas tú el HTML: pásale un "brief" corto en lenguaje natural (qué página, para quién, secciones, tono) en input { brief, title }. La herramienta genera el HTML y lo muestra en el HUD. Nunca pongas HTML en "speak" ni en "visual".
- En "speak" confirma en una frase natural lo que armaste ("Te dejé una primera versión de la landing en pantalla, dime si la afinamos"). Nunca leas etiquetas ni código por voz.

AGENTES AUTOMATICOS — discovery antes de crear:
- Antes de llamar agents.create, REVISA tu catálogo de herramientas completo y evalúa si alguna combinación cumple la misión. Ejemplo: "vigilar el precio del dólar" SÍ es viable porque web.fetch puede leer páginas públicas con ese dato. No descartes una misión sin haber repasado el catálogo.
- Si tras revisar el catálogo de verdad falta una capacidad, NO crees el agente: dilo honestamente Y sugiere qué se necesitaría (qué conector, acceso o API) para hacerlo posible. El usuario decide si vale la pena agregarlo.
- Si la misión es ambigua (qué vigilar, con qué criterio, qué hacer con el resultado), haz máximo 2 preguntas concretas ANTES de crear. Un agente con misión vaga corre todos los días produciendo basura.
- NUNCA inventes el horario: si el usuario no dio horario ni frecuencia, pregúntale o propón uno explícitamente para que lo confirme.
- El goal del agente debe ser autosuficiente: se ejecutará sin contexto de esta conversación. Escríbelo con criterios concretos (qué filtrar, qué reportar, qué hacer si no hay novedades).

El mensaje del usuario puede venir precedido por un bloque [contexto] con memoria relevante y fecha actual. Úsalo, pero responde solo al mensaje.`;

    return [{ text: stable, cache: true }];
  }

  buildFinalResponsePrompt() {
    return [{ cache: true, text: `Eres Jarvis Codex cerrando una tarea ya ejecutada.

Mantén tu carácter: socio con criterio, directo, sin adular ni justificarte. Si algo salió mal, asúmelo en una frase. Español de Chile.

Recibiras el mensaje del usuario y los resultados reales de herramientas.
No solicites nuevas herramientas. No inventes datos.

REGLA DE VOZ — speak siempre:
- Habla como si le contaras el resultado a alguien en persona.
- "depth": "brief" (por defecto, cierre de una acción): una o dos oraciones máximo. Confirma y listo.
- "depth": "expanded" SOLO si el usuario venía conversando o pidió pensar/analizar/profundizar el tema: desarrolla la idea como en una conversación, varias frases, pero sin recitar un paper ni volcar texto crudo. Da lo esencial y ofrece seguir si hay más.
- En la duda, "brief".
- Nunca leas campos técnicos, IDs, URLs, nombres de parámetros, ni términos internos (markup, canonical, schema, attentionFilter, suggestedAction, etc.).
- Si el resultado ya está visible en pantalla (lista de correos, eventos) o escrito en un documento externo: confirma brevemente, menciona solo el dato más relevante si aplica.
- Si hay datos listos en pantalla: descríbelos como lo haría un asistente hablando, no los enumeres crudos.
- Nunca leas puntuaciones como "cien barra cien" — di "cien de cien" o "nota perfecta".

CRITICO: Responde UNICAMENTE con el objeto JSON. Sin texto antes, sin texto despues, sin bloques markdown, sin explicaciones. Solo el JSON puro:
{
  "speak": "cierre natural para voz",
  "visual": "detalle util para pantalla, vacio si el resultado ya esta en panel o documento",
  "format": "brief | list | table | sections | artifact",
  "depth": "brief | expanded",
  "outputValue": { "mode": "response | inspection | summary | analysis | comparison", "requiresTransformation": true/false }
}` }];
  }

  buildToolContinuationPrompt({ memoryContext = '', isLastRound = false } = {}) {
    const stable = `Eres Jarvis Codex. Acabas de ejecutar herramientas y tienes sus resultados.
Analiza los resultados y decide si necesitas mas informacion o puedes responder.

Herramientas disponibles:
${buildToolSummary(this.toolRegistry.list())}

CRITICO: Responde UNICAMENTE con el objeto JSON. Sin texto antes, sin texto despues, sin bloques markdown, sin explicaciones. Solo el JSON puro:
{
  "speak": "respuesta o avance para el usuario",
  "visual": "detalle util para pantalla",
  "format": "brief | list | table | sections | artifact",
  "depth": "brief | expanded",
  "outputValue": { "mode": "response | inspection | summary | analysis | comparison", "requiresTransformation": true/false },
  "toolCalls": []
}

Reglas:
- toolCalls vacio significa que esta es tu respuesta final.
- No inventes resultados. Usa solo los datos recibidos.
- Sintetiza y prioriza. No copies texto bruto.`;

    const forceClose = isLastRound
      ? 'ESTA ES LA ULTIMA RONDA. Entrega la respuesta final ahora. No incluyas toolCalls.'
      : 'Si con estos resultados ya puedes responder, entrega la respuesta final (toolCalls vacio). Si aun necesitas mas datos, llama las herramientas necesarias.';
    const dynamic = [memoryContext, forceClose].filter(Boolean).join('\n\n');

    return [{ text: stable, cache: true }, { text: dynamic }];
  }

  async executeToolCalls(toolCalls, { text, context, channel }) {
    const results = [];
    for (const call of toolCalls) {
      if (!call || !call.toolName) continue;
      const normalizedInput = /(^|\.)(calendar)\.?.*create_event$/i.test(call.toolName)
        ? sanitizeCalendarCreateEventInput(text, call.input || {})
        : (call.input || {});
      const toolTask = this.taskRuntime.createTask({
        title: `Tool ${call.toolName}`,
        type: 'tool',
        // origin marca que esta tarea nació dentro de una conversación: su
        // confirmación vive en el chat, no en la bandeja de aprobaciones.
        origin: 'conversation',
        input: normalizedInput
      });
      const completed = await this.taskRuntime.runToolTask(
        toolTask.id,
        call.toolName,
        normalizedInput,
        // userText viaja en el contexto para reglas de procedencia del
        // policy-engine (ej: distinguir mensaje dictado literal vs compuesto).
        // userGoAhead: el sí explícito del usuario en este turno cuenta como
        // confirmación para riesgo high (ver policy-engine).
        { ...context, channel, userText: text, userGoAhead: isExplicitGoAhead(text) }
      );
      // Una sola confirmación viva por tool: si el modelo re-llamó la misma
      // herramienta (ej: refinó el goal tras feedback) en vez de retomar la
      // pendiente, la confirmación anterior queda obsoleta — no se apilan
      // preguntas duplicadas para la misma acción.
      if (completed.status === 'waiting_confirmation') {
        for (const stale of this.taskRuntime.listTasks()) {
          if (stale.id !== completed.id && stale.status === 'waiting_confirmation' && stale.toolName === call.toolName) {
            stale.status = 'superseded';
          }
        }
      }
      results.push({
        toolName: call.toolName,
        taskId: completed.id,
        status: completed.status,
        input: completed.input,
        result: completed.result,
        error: completed.error
      });
    }
    return results;
  }

  async repairIncompleteResponse({ userText, initialResponse, toolResults, memoryContext }) {
    try {
      const repaired = await this.modelProvider.generateJson({
        system: buildResponseRepairPrompt({
          memoryContext,
          toolSummary: buildToolSummary(this.toolRegistry.list())
        }),
        messages: [
          {
            role: 'user',
            parts: [
              {
                text: JSON.stringify({
                  originalUserMessage: userText,
                  initialResponse,
                  toolResults: summarizeToolResults(toolResults)
                })
              }
            ]
          }
        ],
        temperature: 0.2,
        maxTokens: 450,
        purpose: 'response_repair'
      });

      return {
        speak: repaired.data?.speak || initialResponse.speak,
        visual: repaired.data?.visual || initialResponse.visual,
        format: repaired.data?.format || initialResponse.format,
        outputValue: repaired.data?.outputValue || initialResponse.outputValue
      };
    } catch (_) {
      if (isCapabilitiesIntent(userText)) {
        return buildCapabilitiesResponse(this.toolRegistry, this.memoryStore);
      }
      return initialResponse;
    }
  }

  fallbackFinalResponse(toolResults) {
    const waiting = toolResults.find((item) => item.status === 'waiting_confirmation');
    if (waiting) {
      const confirmation = formatConfirmationRequest(waiting);
      return {
        ...confirmation,
        format: 'sections'
      };
    }

    const failed = toolResults.find((item) => item.status === 'failed' || item.error);
    if (failed) {
      return {
        speak: 'La tarea no se pudo completar correctamente.',
        visual: `Falló ${failed.toolName}: ${failed.error?.message || 'error desconocido'}`
      };
    }

    if (this.presenterRegistry?.canPresent(toolResults)) {
      return this.presenterRegistry.present(toolResults);
    }

    return {
      speak: 'Tarea completada.',
      visual: ''
    };
  }

  shouldUseDeterministicClosing(toolResults, outputValue = null) {
    if (outputValue?.requiresTransformation) return false;
    return Boolean(this.presenterRegistry?.canPresent(toolResults));
  }

  // Fase 2 de la conversación: genera el detalle estructurado para pantalla,
  // aparte del JSON de decisión. Así la voz (Fase 1, el "speak") no espera a que
  // el modelo escriba todo el contenido largo. Devuelve markdown crudo (sin
  // envoltura JSON, sin escape) — más barato en tokens y sin fragilidad de parseo.
  async generateScreenDetail({ userText, speak, recentHistory = '' }) {
    const system = 'Eres Jarvis. Tu tarea acá es UNA sola cosa: producir el detalle estructurado que se mostrará en pantalla, complementando una respuesta que ya diste por voz. Devuelve SOLO ese contenido en markdown (listas, tablas, secciones, según corresponda). Nada de preámbulos, saludos ni cierres. No repitas literal la síntesis hablada: aporta el desglose, los datos concretos y la estructura. Español de Chile.';
    const ctx = recentHistory ? `\n\n[contexto reciente]\n${recentHistory}` : '';
    const messages = [{
      role: 'user',
      parts: [{
        text: `El usuario pidió: "${userText}".\n\nYa respondiste por voz con esta síntesis: "${speak}".${ctx}\n\nGenera ahora el detalle estructurado para pantalla en markdown.`
      }]
    }];

    if (typeof this.modelProvider.generateText === 'function') {
      const out = await this.modelProvider.generateText({ system, messages, temperature: 0.4, maxTokens: 1200, purpose: 'conversation_screen_detail' });
      return String(out.text || '').trim();
    }
    // Fallback si el proveedor activo no expone generateText: usar el camino JSON.
    const out = await this.modelProvider.generateJson({
      system: `${system}\n\nResponde JSON: { "visual": "<markdown>" }`,
      messages,
      temperature: 0.4,
      maxTokens: 1200,
      purpose: 'conversation_screen_detail'
    });
    return String(out.data?.visual || '').trim();
  }

  findLatestPendingToolTask() {
    return this.taskRuntime
      .listTasks()
      .slice()
      .reverse()
      .find((task) => task.status === 'waiting_confirmation' && task.type === 'tool' && task.toolName);
  }

  async maybeConfirmPendingTask({ text, conversationTask, channel }) {
    if (!isAffirmativeConfirmation(text)) return null;

    const pending = this.findLatestPendingToolTask();
    if (!pending) return null;

    const completed = await this.taskRuntime.confirmTask(pending.id, { channel });
    const ok = completed.status === 'completed';
    const toolResults = [
      {
        toolName: completed.toolName,
        taskId: completed.id,
        status: completed.status,
        input: completed.input,
        result: completed.result,
        error: completed.error
      }
    ];
    const presented = ok ? this.fallbackFinalResponse(toolResults) : null;
    conversationTask.status = completed.status;
    conversationTask.result = {
      speak: ok
        ? (presented?.speak || 'Confirmado. La acción fue completada.')
        : 'Confirmé la acción, pero no se completó correctamente.',
      visual: ok
        ? (presented?.visual || `Acción completada: ${completed.toolName}`)
        : `La acción ${completed.toolName} quedó en estado ${completed.status}.`,
      format: ok ? (presented?.format || 'brief') : 'brief',
      outputValue: {
        mode: 'response',
        requiresTransformation: false,
        rule: 'Confirmation should execute the existing pending action, not create a duplicate.'
      },
      toolResults
    };
    this.taskRuntime.emitTaskEvent(conversationTask, ok ? 'task_completed' : 'task_failed', {
      channel,
      status: conversationTask.status,
      confirmedTaskId: completed.id
    });
    return conversationTask;
  }

  async handleMessage({ text, channel = 'hud', context = {} }) {
    const turnStartedAt = Date.now();
    const conversationTask = this.taskRuntime.createTask({
      title: `Conversation from ${channel}`,
      type: 'conversation',
      input: { text, channel }
    });

    conversationTask.status = 'running';
    this.taskRuntime.emitTaskEvent(conversationTask, 'task_started', { channel });
    this.eventBus.emit('conversation_user_message', { taskId: conversationTask.id, channel });

    const confirmedTask = await this.maybeConfirmPendingTask({ text, conversationTask, channel });
    if (confirmedTask) return confirmedTask;

    const recentHistoryText = this.history
      .slice(-4)
      .map((entry) => entry.parts?.map((part) => part.text || '').join(' '))
      .join(' ');

    const memoryContext = this.contextAssembler
      ? this.contextAssembler.assemble({ userText: text, recentHistory: recentHistoryText })
      : (this.memoryStore?.buildPromptContext(`${text} ${recentHistoryText}`.trim(), { limit: 4 }) || '');
    const workingContext = this.contextAssembler
      ? ''
      : (this.workingMemoryStore?.buildPromptContext(text, { limit: 3 }) || '');

    // El contexto dinámico viaja en el mensaje actual, no en el system ni en el
    // historial: el system queda estable (cacheable) y el historial guarda el
    // texto crudo del usuario sin arrastrar contextos viejos turno tras turno.
    const dynamicContext = [memoryContext, workingContext].filter(Boolean).join('\n\n');
    const currentUserText = dynamicContext ? `${dynamicContext}\n\n[Mensaje del usuario]\n${text}` : text;

    const messages = [
      ...this.history,
      { role: 'user', parts: [{ text: currentUserText }] }
    ];

    let modelResult;
    try {
      modelResult = await this.modelProvider.generateJson({
        system: this.buildSystemPrompt(),
        messages,
        temperature: 0.3,
        // Cap bajo a propósito: la decisión + speak conciso + toolCalls caben de
        // sobra. El contenido largo NO se genera aquí (va a Fase 2), así que un
        // tope alto solo serviría para que el modelo vierta paredes de texto y
        // dispare la latencia de la voz. Esta es la palanca real de tiempo-a-voz.
        maxTokens: 450,
        purpose: 'conversation_decision'
      });
    } catch (error) {
      // El techo de la decisión (450) está pensado para el JSON corto de
      // Fase 1. Si el modelo lo chocó, lo que haya en rawText está cortado
      // por presupuesto: antes de rescatar texto trunco, reintentar UNA vez
      // con techo amplio — nunca entregar una frase cortada por maxTokens.
      if (error.stopReason === 'max_tokens') {
        try {
          modelResult = await this.modelProvider.generateJson({
            system: this.buildSystemPrompt(),
            messages,
            temperature: 0.3,
            maxTokens: 1200,
            purpose: 'conversation_decision_retry'
          });
          this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
            channel,
            step: 'model_decision_retry_after_truncation'
          });
        } catch (retryError) {
          error = retryError;
        }
      }

      if (!modelResult) {
      const plainResponse = coercePlainModelText(error.rawText);
      if (plainResponse) {
        conversationTask.status = 'completed';
        conversationTask.result = formatHumanReadable(plainResponse, { userText: text, toolResults: [] });
        conversationTask.result = applyOutputValueContract(conversationTask.result, { userText: text });
        conversationTask.result = enforceSpeakContract(conversationTask.result);
        conversationTask.result.toolResults = [];
        this.workingMemoryStore?.recordTurn({
          userText: text,
          channel,
          toolResults: [],
          assistantResult: conversationTask.result
        });
        this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
          channel,
          step: 'model_decision_plaintext_recovered'
        });
        this.taskRuntime.emitTaskEvent(conversationTask, 'task_completed', {
          channel,
          status: conversationTask.status,
          recoveredFrom: 'plain_text'
        });
        if (channel !== 'agent') {
          this.history.push({ role: 'user', parts: [{ text }] });
          this.history.push({ role: 'model', parts: [{ text: summarizeConversationResult(conversationTask.result) }] });
          if (this.history.length > 12) this.history.splice(0, this.history.length - 12);
        }
        this.scheduleBackgroundLearning({ text, channel, conversationTask, toolResults: [] });
        return conversationTask;
      }

      conversationTask.status = 'failed';
      conversationTask.error = { message: error.message };
      const failure = buildModelFailureMessage(error);
      conversationTask.result = {
        speak: failure.speak,
        visual: failure.visual,
        toolResults: []
      };
      this.taskRuntime.emitTaskEvent(conversationTask, 'task_failed', {
        channel,
        step: 'model_decision',
        message: error.message
      });
      return conversationTask;
      }
    }

    const decision = modelResult.data || {};
    const toolResults = [];
    const toolCalls = Array.isArray(decision.toolCalls) ? decision.toolCalls : [];
    const requestedOutputValue = decision.outputValue || inferOutputValue({
      userText: text,
      visual: decision.visual,
      format: decision.format
    });

    this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
      step: 'model_decision',
      model: modelResult.model || 'unknown',
      durationMs: modelResult.durationMs,
      cacheReadTokens: modelResult.usage?.cacheReadTokens,
      toolCallCount: toolCalls.length
    });

    // Frase corta para cubrir el hueco de latencia mientras corren las tools.
    // Solo se emite si REALMENTE habrá tool calls — nunca en turnos
    // puramente conversacionales (ej. "hola, ¿cómo estás?").
    if (toolCalls.length > 0 && channel === 'hud') {
      this.eventBus.emit('hud_quick_ack', { text: buildQuickAck(toolCalls) });
    }

    // --- Bounded tool loop (max 3 rounds) ---
    // Round 0: initial decision already made above (decision + toolCalls).
    // Each round: execute pending toolCalls, feed results back, let model decide
    // whether to call more tools or deliver the final answer.
    // On the last forced round the continuation prompt blocks further toolCalls.
    const MAX_TOOL_ROUNDS = 3;
    let loopMessages = messages; // starts with history + user message
    let currentDecision = decision;
    let currentToolCalls = toolCalls;
    // Track whether any tool produced a visual panel (list of emails, calendar events, etc.)
    // so the closing prompt can instruct the model to skip the summary in chat.
    // Tools that write content to external destinations — the model needs room
    // to compose the full payload (document body, email content, etc.)
    const CONTENT_OUTPUT_TOOLS = /google\.(docs\.|sheets\.|gmail\.send|gmail\.create_draft)/;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (currentToolCalls.length === 0) break;

      const toolsStartedAt = Date.now();
      const roundResults = await this.executeToolCalls(currentToolCalls, { text, context, channel });
      const toolsMs = Date.now() - toolsStartedAt;
      toolResults.push(...roundResults);

      const hasWaiting = roundResults.some((r) => r.status === 'waiting_confirmation');
      if (hasWaiting) {
        currentToolCalls = [];
        break;
      }

      const isLastRound = round === MAX_TOOL_ROUNDS - 1;

      this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
        step: `tool_round_${round}`,
        toolCount: roundResults.length,
        toolNames: roundResults.map((r) => r.toolName),
        toolsMs
      });

      // Next toolCalls may write documents/emails — need higher token ceiling
      const nextCallsNeedContentOutput = (Array.isArray(currentDecision.toolCalls) ? currentDecision.toolCalls : [])
        .some((c) => CONTENT_OUTPUT_TOOLS.test(c?.toolName || ''));
      const roundMaxTokens = (nextCallsNeedContentOutput || isLastRound) ? 4000 : 2000;

      let continuation;
      try {
        continuation = await this.modelProvider.generateJson({
          system: isLastRound
            ? this.buildFinalResponsePrompt()
            : this.buildToolContinuationPrompt({ memoryContext, isLastRound: false }),
          messages: [
            ...loopMessages,
            {
              role: 'model',
              parts: [{ text: JSON.stringify({ speak: currentDecision.speak || '', toolCalls: currentToolCalls }) }]
            },
            {
              role: 'user',
              parts: [{
                text: JSON.stringify({
                  toolResults: summarizeToolResults(roundResults),
                  note: isLastRound
                    ? 'Entrega la respuesta final ahora. No incluyas toolCalls.'
                    : 'Analiza y decide: responde o llama mas herramientas.'
                })
              }]
            }
          ],
          temperature: 0.2,
          maxTokens: roundMaxTokens,
          purpose: isLastRound ? 'final_response' : 'tool_continuation'
        });
      } catch (err) {
        this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
          step: `tool_continuation_fallback_round_${round}`,
          message: err.message
        });
        currentToolCalls = [];
        break;
      }

      currentDecision = continuation.data || {};
      currentToolCalls = isLastRound
        ? []
        : (Array.isArray(currentDecision.toolCalls) ? currentDecision.toolCalls : []);

      this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
        step: `continuation_round_${round}`,
        model: continuation.model || 'unknown',
        durationMs: continuation.durationMs,
        cacheReadTokens: continuation.usage?.cacheReadTokens,
        nextToolCallCount: currentToolCalls.length
      });

      // Update loop messages for potential next round
      loopMessages = [
        ...loopMessages,
        {
          role: 'model',
          parts: [{ text: JSON.stringify({ speak: currentDecision.speak || '', toolCalls: currentToolCalls }) }]
        },
        {
          role: 'user',
          parts: [{
            text: JSON.stringify({ toolResults: summarizeToolResults(roundResults) })
          }]
        }
      ];
    }
    // --- End tool loop ---

    const hasWaitingConfirmation = toolResults.some((item) => item.status === 'waiting_confirmation');
    let finalResponse = {
      speak: currentDecision.speak || '',
      visual: currentDecision.visual || '',
      format: currentDecision.format,
      outputValue: currentDecision.outputValue || requestedOutputValue
    };

    if (toolResults.length > 0 && (hasWaitingConfirmation || this.shouldUseDeterministicClosing(toolResults, requestedOutputValue))) {
      finalResponse = this.fallbackFinalResponse(toolResults);
    }

    // Si el turno declaró screenDetail, su brevedad es intencional: el detalle
    // viaja en Fase 2, no es un "turno fantasma". No lo mandamos a reparar.
    if (!currentDecision.screenDetail && responseSeemsIncomplete({
      userText: text,
      response: finalResponse,
      toolResults
    })) {
      finalResponse = await this.repairIncompleteResponse({
        userText: text,
        initialResponse: finalResponse,
        toolResults,
        memoryContext
      });
      this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
        step: 'response_repaired',
        channel
      });
    }

    conversationTask.status = hasWaitingConfirmation ? 'waiting_confirmation' : 'completed';
    finalResponse = formatHumanReadable(finalResponse, {
      userText: text,
      toolResults
    });
    finalResponse = applyOutputValueContract(finalResponse, {
      userText: text
    });
    finalResponse = enforceSpeakContract(finalResponse);

    // Fase 2 (contenido fuera del JSON): turnos expandidos SIN herramientas que
    // declararon detalle de pantalla generan ese detalle aparte. En el HUD se
    // entrega después por SSE (la voz no espera); en otros canales se genera
    // inline para no perder contenido. Los turnos con tools ya tienen sus
    // paneles y su lógica de cierre — no se tocan.
    const wantsScreenDetail = toolResults.length === 0
      && !hasWaitingConfirmation
      && currentDecision.screenDetail === true
      && !String(finalResponse.visual || '').trim();
    const deferToSse = wantsScreenDetail && channel === 'hud';

    conversationTask.result = {
      speak: finalResponse.speak,
      visual: finalResponse.visual,
      format: finalResponse.format,
      outputValue: finalResponse.outputValue,
      pendingContent: deferToSse,
      toolResults
    };

    // Canales no-HUD (Telegram): generar el detalle inline antes de devolver,
    // porque no hay panel ni SSE que lo reciba después.
    if (wantsScreenDetail && !deferToSse) {
      try {
        conversationTask.result.visual = await this.generateScreenDetail({ userText: text, speak: finalResponse.speak, recentHistory: recentHistoryText });
      } catch (_) { /* si falla, queda solo el speak: peor caso, sin regresión */ }
    }

    this.taskRuntime.emitTaskEvent(conversationTask, 'task_completed', {
      channel,
      status: conversationTask.status,
      turnMs: Date.now() - turnStartedAt
    });

    // HUD: el detalle se genera en background y llega por SSE. handleMessage
    // retorna YA con el speak para que la voz arranque sin esperar.
    if (deferToSse) {
      const taskId = conversationTask.id;
      setImmediate(async () => {
        try {
          const detail = await this.generateScreenDetail({ userText: text, speak: finalResponse.speak, recentHistory: recentHistoryText });
          conversationTask.result.visual = detail;
          conversationTask.result.pendingContent = false;
          this.eventBus.emit('conversation_content', { taskId, visual: detail, format: finalResponse.format });
        } catch (error) {
          conversationTask.result.pendingContent = false;
          this.eventBus.emit('conversation_content', { taskId, visual: '', failed: true, message: error.message });
        }
      });
    }

    // Las corridas de agentes no entran al historial del HUD: son misiones
    // automáticas, no parte de la conversación con el usuario.
    if (channel !== 'agent') {
      this.history.push({ role: 'user', parts: [{ text }] });
      this.history.push({ role: 'model', parts: [{ text: summarizeConversationResult(conversationTask.result) }] });
      if (this.history.length > 12) this.history.splice(0, this.history.length - 12);
    }

    this.scheduleBackgroundLearning({ text, channel, conversationTask, toolResults });

    this.workingMemoryStore?.recordTurn({
      userText: text,
      channel,
      toolResults,
      assistantResult: conversationTask.result
    });

    return conversationTask;
  }

  // Refuerzo + aprendizaje + captura de lecciones en juego, en background.
  // Se llama desde TODOS los caminos de cierre de turno para que el loop de
  // aprendizaje no se salte ninguno (incluida la recuperación por texto plano).
  scheduleBackgroundLearning({ text, channel, conversationTask, toolResults = [] }) {
    setImmediate(async () => {
      // 1) Refuerzo: el mensaje actual es la reacción al turno anterior.
      //    Evalúa las lecciones que estuvieron en juego antes de aprender nuevas.
      try {
        const polarity = detectFeedbackPolarity(text);
        if (this._lessonsInPlay.length > 0 && polarity !== 'neutral') {
          const adjusted = applyReinforcement({
            memoryStore: this.memoryStore,
            previousLessons: this._lessonsInPlay,
            polarity,
            // Para correcciones: solo se ajustan lecciones pertinentes al
            // texto del reclamo (invariante de pertinencia, ver módulo).
            userText: text
          });
          if (adjusted.length > 0) {
            this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
              channel,
              step: 'lesson_reinforcement',
              polarity,
              adjusted: adjusted.map((a) => ({ key: a.key, confidence: a.confidence, state: a.state }))
            });
          }
        }
      } catch (_) {
        // El refuerzo nunca debe romper el camino en vivo.
      }

      // 2) Aprendizaje: extrae lecciones nuevas de este turno.
      try {
        await learnFromConversationTurn({
          userText: text,
          assistantResult: conversationTask.result,
          toolResults,
          memoryStore: this.memoryStore,
          modelProvider: this.modelProvider
        });
      } catch (_) {
        // Learning should never break the live conversation path.
      }

      // 3) Captura las lecciones en juego AHORA (incluye las recién creadas)
      //    para evaluarlas contra la reacción del próximo turno.
      try {
        this._lessonsInPlay = selectLessonsInPlay(this.memoryStore);
      } catch (_) {
        this._lessonsInPlay = [];
      }

      // 4) Grafo de conocimiento: extrae entidades/hechos/relaciones/compromisos
      //    del turno y los deposita como candidatos. Modela el mundo del usuario.
      try {
        if (this.knowledgeGraph) {
          await extractGraphFromTurn({
            userText: text,
            assistantText: conversationTask.result?.speak || conversationTask.result?.visual || '',
            modelProvider: this.modelProvider,
            graph: this.knowledgeGraph
          });
        }
      } catch (_) {
        // La extracción al grafo nunca debe romper la conversación en vivo.
      }
    });
  }
}

module.exports = {
  ConversationRuntime,
  formatConfirmationRequest,
  enforceSpeakContract
};
