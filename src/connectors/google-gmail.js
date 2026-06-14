const { google } = require('googleapis');
const { withRetry } = require('../utils/retry');
const { ConnectorCache } = require('../utils/connector-cache');

function decodeBase64Url(value = '') {
  if (!value) return '';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

function stripHtml(value = '') {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(Number(code));
      } catch (_) {
        return ' ';
      }
    });
}

function cleanEmailText(value = '') {
  return String(value)
    .replace(/\r/g, '\n')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeForSummary(value = '') {
  return cleanEmailText(stripHtml(value))
    .replace(/\b(to view this email as a web page|view this email in your browser|si usted no visualiza bien este mail|haga click aquí|click here|unsubscribe|desuscribirse|darse de baja)\b/gi, ' ')
    .replace(/\b(ir a misiones|ir a|banner|web version|privacy policy)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectBodyParts(payload, parts = []) {
  if (!payload) return parts;
  const mimeType = payload.mimeType || '';
  const data = payload.body?.data;
  if (data && (mimeType.includes('text/plain') || mimeType.includes('text/html'))) {
    const decoded = decodeBase64Url(data);
    parts.push(mimeType.includes('text/html') ? stripHtml(decoded) : decoded);
  }
  for (const part of payload.parts || []) {
    collectBodyParts(part, parts);
  }
  return parts;
}

function buildEmailSummary({ subject, snippet, bodyText }) {
  const text = sanitizeForSummary(bodyText || snippet || '');
  if (!text) return 'No hay suficiente contenido visible para resumir este correo.';

  const source = cleanEmailText(text);
  const sentences = source.split(/(?<=[.!?])\s+/).filter((item) => item.length > 25);
  const candidate = sentences.slice(0, 2).join(' ') || source;
  const maxLength = 260;
  if (candidate.length <= maxLength) return candidate;
  const cut = candidate.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 180 ? lastSpace : maxLength).trim()}...`;
}

function extractEmailAddress(from = '') {
  const match = String(from).match(/<([^>]+)>/);
  return (match?.[1] || String(from)).trim().toLowerCase();
}

function inferFallbackTriage(email = {}) {
  const from = String(email.from || '');
  const subject = String(email.subject || '');
  const summary = String(email.summary || '');
  const preview = String(email.preview || '');
  const bodyPreview = sanitizeForSummary(String(email.bodyPreview || ''));
  const salientBody = bodyPreview.slice(0, 320);
  const text = `${from} ${subject} ${summary} ${preview} ${salientBody}`.toLowerCase();
  const labelIds = Array.isArray(email.labelIds) ? email.labelIds : [];

  // Gmail native category labels — most reliable signal available.
  const gmailIsPromotion = labelIds.includes('CATEGORY_PROMOTIONS');
  const gmailIsSocial    = labelIds.includes('CATEGORY_SOCIAL');
  const gmailIsUpdates   = labelIds.includes('CATEGORY_UPDATES');
  const gmailIsForums    = labelIds.includes('CATEGORY_FORUMS');
  const gmailIsImportant = labelIds.includes('IMPORTANT');

  let category = 'desconocido';
  let attention = 'media';
  let importanceScore = 40;
  let why = 'Puede requerir una revisión humana según el contexto.';
  let suggestedAction = 'Revísalo si este remitente o asunto te importa.';

  // Content signals — regexes more precise than before.
  const isDeliveryFailure  = /mailer-daemon|delivery status notification|address not found|dns error|final-recipient/i.test(text);
  const isSentBySelf       = /\bprueba\b/i.test(subject) && /\bhola\b/i.test(`${summary} ${preview}`);
  const isBusinessInbox    = /inbox bot|hojacero|nuevo mensaje|buz[oó]n/i.test(text);
  const isExpiredAssign    = /ipsos|asignaciones vencidas|vencimiento|atrasado/i.test(text);
  const isApiAccess        = /api key|access request|platprices|organization id|claim link|credits|anthropic/i.test(text);
  const isBankPurchaseAlert= /tu compra con app bci|realizaste una compra con cargo|cuenta bci|comercio prontopaga/i.test(text);
  // Financial: requires explicit payment/billing language, not generic price mentions.
  const isFinancial        = /\b(factura|invoice|cobro|transferencia|transferiste|cargo pendiente|deuda|venc[eió]|pago (requerido|pendiente|vencido|fallido|recibido)|payment (due|failed|received|required))\b/i.test(text);
  const isBankStatement    = /\b(estado de cuenta|resumen de tarjeta|cartola|extracto bancario|balance disponible)\b/i.test(text);
  const isMeeting          = /reuni[oó]n|meeting|calendar|agenda|cita|appointment/i.test(text);
  const isSecurity         = /security|seguridad|c[oó]digo de verificaci[oó]n|login alert|inicio de sesi[oó]n|verification code|password reset|contrase[nñ]a|acceso no autorizado/i.test(text);
  // Promotional: broader — catches energy companies, retail, airlines, etc.
  const isPromoContent     = /cyber|oferta|promoci[oó]n|newsletter|descuento|gana |gasoil|combustible|bencinera|precio especial|exclusivo para ti|aprovecha|fidelidad|puntos|millas|cupon|cupón|estacion de servicio/i.test(text);

  // --- Triage pipeline ---
  // Rule 1: Gmail native promotional label — strongest signal, no override by price words.
  if (gmailIsPromotion) {
    category = 'promocion';
    attention = gmailIsImportant ? 'media' : 'baja';
    importanceScore = gmailIsImportant ? 32 : 15;
    why = 'Gmail clasifica este correo como promocional.';
    suggestedAction = 'Ignóralo salvo que estés buscando esa oferta específica.';
    // Still allow hard security signals to override.
    if (!isSecurity) {
      return { ...email, category, attention, importanceScore, why, suggestedAction };
    }
  }

  // Rule 2: Gmail social/forums/updates
  if (gmailIsSocial || gmailIsForums) {
    category = 'notificacion';
    attention = 'baja';
    importanceScore = 20;
    why = 'Notificación de red social o foro, sin urgencia real.';
    suggestedAction = 'Revísalo cuando tengas tiempo libre.';
    if (!isSecurity) {
      return { ...email, category, attention, importanceScore, why, suggestedAction };
    }
  }

  if (gmailIsUpdates) {
    category = 'notificacion';
    attention = 'baja';
    importanceScore = 28;
    why = 'Actualización automática de un servicio.';
    suggestedAction = 'Lee solo si el servicio es relevante para ti ahora.';
  }

  // Rule 3: Content-based classification (applied in ascending importance order).
  if (isDeliveryFailure) {
    category = 'notificacion';
    attention = 'media';
    importanceScore = 22;
    why = 'Fallo de entrega; revisa solo si esperabas que ese correo llegara.';
    suggestedAction = 'Corrige el destinatario o ignora si no es relevante.';
  }

  if (isSentBySelf) {
    category = 'personal';
    attention = 'baja';
    importanceScore = 8;
    why = 'Parece un correo de prueba enviado por ti mismo.';
    suggestedAction = 'No requiere atención salvo que estés validando el flujo de envío.';
  }

  if (isPromoContent && !gmailIsImportant && importanceScore < 55) {
    category = 'promocion';
    attention = 'baja';
    importanceScore = 18;
    why = 'Contiene lenguaje promocional o de marketing.';
    suggestedAction = 'Ignóralo salvo que estés buscando esa oferta.';
  }

  if (isBusinessInbox) {
    category = 'trabajo';
    attention = 'alta';
    importanceScore = 78;
    why = 'Actividad nueva en un buzón de negocio que puede requerir seguimiento.';
    suggestedAction = 'Ábrelo para ver el contenido real y decidir respuesta.';
  }

  if (isExpiredAssign) {
    category = 'trabajo';
    attention = 'alta';
    importanceScore = 82;
    why = 'Hay tareas o asignaciones vencidas; puede implicar pérdida de oportunidad.';
    suggestedAction = 'Revisa y decide si actuar, reasignar o descartar.';
  }

  if (isApiAccess) {
    category = 'trabajo';
    attention = 'alta';
    importanceScore = Math.max(importanceScore, 86);
    why = 'Contiene acceso, credenciales, créditos o una oportunidad operativa.';
    suggestedAction = 'Revísalo pronto y guarda el dato antes de que expire.';
  }

  if (isMeeting) {
    category = 'trabajo';
    attention = 'media';
    importanceScore = Math.max(importanceScore, 68);
    why = 'Puede afectar agenda o coordinación con otras personas.';
    suggestedAction = 'Confirma si requiere agendar, asistir o preparar contexto.';
  }

  if (isFinancial || isBankStatement) {
    category = 'financiero';
    attention = 'alta';
    importanceScore = Math.max(importanceScore, 84);
    why = 'Tiene señales explícitas de cobro, transferencia o estado de cuenta.';
    suggestedAction = 'Verifica montos, fechas y si requiere pago o conciliación.';
  }

  if (isBankPurchaseAlert) {
    category = 'financiero';
    attention = 'media';
    importanceScore = Math.max(importanceScore, 62);
    why = 'Alerta de compra bancaria real; verifica si la reconoces.';
    suggestedAction = 'Confirma que el monto y comercio son correctos.';
  }

  if (isSecurity) {
    category = 'notificacion';
    attention = 'alta';
    importanceScore = Math.max(importanceScore, 88);
    why = 'Señales de acceso, seguridad o verificación que pueden ser sensibles.';
    suggestedAction = 'Revísalo pronto y confirma si el evento fue legítimo.';
  }

  // Final boost: Gmail marks it as important despite no other strong signal.
  if (gmailIsImportant && importanceScore < 60) {
    attention = 'media';
    importanceScore = Math.max(importanceScore, 60);
    why += ' Gmail lo marcó como importante.';
  }

  return {
    ...email,
    category,
    attention,
    importanceScore,
    why,
    suggestedAction
  };
}

async function summarizeEmailsWithModel({ provider, emails }) {
  if (!provider || emails.length === 0) return emails;

  const payload = emails.map((email) => ({
    id: email.id,
    subject: email.subject,
    from: email.from,
    preview: email.preview,
    content: sanitizeForSummary(email.bodyPreview || email.preview).slice(0, 2200)
  }));

  const result = await provider.generateJson({
    system: `Haz triage de correos para un usuario humano.

Devuelve exclusivamente JSON valido:
{
  "summaries": [
    {
      "id": "id del correo",
      "summary": "resumen real en una frase corta, sin URLs, sin texto tecnico de newsletter, sin repetir asunto",
      "category": "personal | trabajo | financiero | promocion | notificacion | spam_posible | desconocido",
      "attention": "alta | media | baja",
      "why": "por que merece o no merece atencion",
      "suggestedAction": "accion sugerida concreta para el usuario"
    }
  ]
}

Reglas de categoria:
- "promocion": correos de empresas (combustibles, retail, aereolineas, supermercados, bancos con ofertas, telecomunicaciones) que anuncian precios, descuentos, beneficios o novedades. AUNQUE mencionen precios o dinero, si el remitente es una marca y el proposito es marketing, es "promocion" con attention "baja".
- "financiero": SOLO si hay un cobro real pendiente, una transferencia ejecutada, una factura por pagar, un estado de cuenta o una alerta de cargo no reconocido. Mencionar precios o tarifas NO alcanza para ser financiero.
- "trabajo": mensajes de personas reales, clientes, colegas, plataformas de trabajo, tareas vencidas o bandejas de negocio.
- "notificacion": alertas automaticas de servicios (seguridad, redes sociales, actualizaciones de apps).
- "personal": correos de familiares, amigos o del propio usuario.

Reglas de attention:
- "baja": newsletters, marketing, notificaciones automaticas sin accion requerida.
- "media": correos que informan pero no urgen respuesta inmediata.
- "alta": accion requerida, cliente real, seguridad comprometida, pago pendiente real.

Ejemplos de "promocion baja" aunque mencionen dinero: "Shell te ofrece 10% en gasolina", "Oferta exclusiva en tu tarjeta", "Nuevas tarifas de internet".
Ejemplos de "financiero alto": "Tu cobro de $150.000 fue rechazado", "Factura vencida N°12345", "Transferencia recibida de Juan".

Reglas adicionales:
- No pegues texto literal largo.
- No incluyas links, codigos de tracking ni instrucciones de visualizacion.
- Baja el valor de correos de prueba del propio usuario y de notificaciones repetidas de fallo de entrega.
- Sube el valor de mensajes con oportunidad real de negocio, cliente, tarea vencida o correo nuevo en bandejas de trabajo.
- Maximo 28 palabras por summary.`,
    messages: [
      {
        role: 'user',
        parts: [{ text: JSON.stringify({ emails: payload }) }]
      }
    ],
    temperature: 0.1,
    maxTokens: 700
  });

  const summaries = Array.isArray(result.data?.summaries) ? result.data.summaries : [];
  const byId = new Map(summaries.map((item) => [item.id, item]));
  return emails.map((email) => ({
    ...inferFallbackTriage(email),
    summary: byId.get(email.id)?.summary || email.summary,
    category: byId.get(email.id)?.category || inferFallbackTriage(email).category,
    attention: byId.get(email.id)?.attention || inferFallbackTriage(email).attention,
    why: byId.get(email.id)?.why || inferFallbackTriage(email).why,
    suggestedAction: byId.get(email.id)?.suggestedAction || inferFallbackTriage(email).suggestedAction,
    importanceScore: byId.get(email.id)?.attention === 'alta'
      ? Math.max(inferFallbackTriage(email).importanceScore, 80)
      : byId.get(email.id)?.attention === 'media'
        ? Math.max(inferFallbackTriage(email).importanceScore, 50)
        : inferFallbackTriage(email).importanceScore,
    summarySource: byId.has(email.id) ? 'model' : email.summarySource
  }));
}

function encodeMessage({ to, subject, body }) {
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject || '').toString('base64')}?=`;
  const raw = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    String(body || '').replace(/\n/g, '<br>')
  ].join('\n');

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function normalizeMaxResults(input = {}) {
  const requestedMax = input.maxResults ?? input.max_results ?? input.limit ?? input.count ?? 5;
  return Math.max(1, Math.min(Number(requestedMax) || 5, 20));
}

async function fetchMessageDetail(gmail, messageId) {
  const detail = await withRetry(() =>
    gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
      metadataHeaders: ['From', 'To', 'Subject', 'Date']
    })
  );
  const headers = detail.data.payload?.headers || [];
  const findHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  const bodyText = cleanEmailText(collectBodyParts(detail.data.payload).join('\n'));
  return {
    id: messageId,
    threadId: detail.data.threadId,
    from: findHeader('From') || '(desconocido)',
    to: findHeader('To') || '',
    subject: findHeader('Subject') || '(sin asunto)',
    date: findHeader('Date'),
    snippet: cleanEmailText(detail.data.snippet || ''),
    body: bodyText.slice(0, 3000),
    labelIds: detail.data.labelIds || []
  };
}

function createGmailTools({ authFactory, summarizer, contactResolver }) {
  const cache = new ConnectorCache({ ttlMs: 30 * 60 * 1000 });

  async function listEmails(input = {}) {
    const force = input.force === true || input.refresh === true;
    const cacheKey = {
      query: input.query || null,
      maxResults: normalizeMaxResults(input)
    };

    // Cache with a generous fixed size — runtime limit applied post-cache
    const FETCH_MAX = 20;
    const runtimeMax = normalizeMaxResults(input);
    const baseCacheKey = { query: cacheKey.query, maxResults: FETCH_MAX };

    let baseResult;

    if (!force) {
      const cached = cache.get('list_emails', baseCacheKey);
      if (cached) baseResult = { ...cached, _fromCache: true };
    }

    if (!baseResult) {
      const auth = authFactory.getClient();
      const gmail = google.gmail({ version: 'v1', auth });
      const maxResults = FETCH_MAX;

      const listResponse = await withRetry(() => gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: input.query || undefined
      }));

      const messages = listResponse.data.messages || [];

      // Fetch all message details in parallel
      const details = await Promise.all(
        messages.map((msg) =>
          withRetry(() =>
            gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
              format: 'full',
              metadataHeaders: ['From', 'Subject', 'Date']
            })
          ).catch(() => null)
        )
      );

      const emails = details
        .filter(Boolean)
        .map((detail) => {
          const headers = detail.data.payload?.headers || [];
          const findHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
          const bodyText = cleanEmailText(collectBodyParts(detail.data.payload).join('\n'));
          const subject = findHeader('Subject') || '(sin asunto)';
          const snippet = detail.data.snippet || '';
          return {
            id: detail.data.id,
            from: findHeader('From') || '(desconocido)',
            subject,
            date: findHeader('Date'),
            labelIds: detail.data.labelIds || [],
            summary: cleanEmailText(snippet).slice(0, 220) || buildEmailSummary({ subject, snippet, bodyText }),
            summarySource: 'fallback',
            bodyPreview: bodyText.slice(0, 1200)
          };
        });

      // Apply triage — always store unfiltered so cache works for any attentionFilter value
      let triaged = emails.map((email) => inferFallbackTriage(email));
      let summaryMode = 'fallback';

      const wantModelSummary = input.summarize === true || (summarizer && emails.length <= 5);
      if (wantModelSummary && summarizer && emails.length > 0) {
        try {
          triaged = await summarizeEmailsWithModel({ provider: summarizer, emails });
          summaryMode = 'model';
        } catch (_) {}
      }

      baseResult = {
        emails: triaged,
        summaryMode,
        resultSizeEstimate: listResponse.data.resultSizeEstimate
      };

      // Cache stores the FULL unfiltered base — runtime filters applied below
      cache.set('list_emails', baseCacheKey, baseResult);
    }

    // Always apply runtime transforms post-cache (hit or miss)
    let emails = baseResult.emails;

    // 1. Semantic filter
    if (input.attentionFilter) {
      const levels = { alta: 3, media: 2, baja: 1 };
      const minLevel = levels[String(input.attentionFilter).toLowerCase()] || 0;
      emails = emails.filter((e) => (levels[e.attention] || 0) >= minLevel);
    }

    // 2. Count limit — applied after semantic filter
    if (runtimeMax < emails.length) emails = emails.slice(0, runtimeMax);

    return { ...baseResult, emails };
  }

  async function sendEmail(input = {}) {
    if (process.env.JARVIS_DISABLE_GMAIL_SEND === '1') {
      throw new Error('GMAIL_SEND_DISABLED_DURING_DEBUG');
    }

    if (!input.to || !input.subject || !input.body) {
      throw new Error('GMAIL_SEND_REQUIRES_TO_SUBJECT_BODY');
    }

    let resolvedInput = { ...input };
    if (contactResolver && !String(input.to).includes('@')) {
      const match = await contactResolver(String(input.to), input);
      if (match?.email) {
        resolvedInput = { ...resolvedInput, to: match.email };
      }
    }

    const auth = authFactory.getClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const response = await withRetry(() =>
      gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodeMessage(resolvedInput) }
      })
    );

    cache.invalidate('list_emails');
    return {
      id: response.data.id,
      threadId: response.data.threadId,
      resolvedRecipient: resolvedInput.to
    };
  }

  async function trashEmail(input = {}) {
    const id = input.emailId || input.messageId || input.id;
    if (!id) throw new Error('GMAIL_TRASH_REQUIRES_EMAIL_ID');
    const auth = authFactory.getClient();
    const gmail = google.gmail({ version: 'v1', auth });
    await withRetry(() => gmail.users.messages.trash({ userId: 'me', id }));
    cache.invalidate('list_emails');
    return { trashed: true, emailId: id };
  }

  async function archiveEmail(input = {}) {
    const id = input.emailId || input.messageId || input.id;
    if (!id) throw new Error('GMAIL_ARCHIVE_REQUIRES_EMAIL_ID');
    const auth = authFactory.getClient();
    const gmail = google.gmail({ version: 'v1', auth });
    await withRetry(() => gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { removeLabelIds: ['INBOX'] }
    }));
    cache.invalidate('list_emails');
    return { archived: true, emailId: id };
  }

  async function markEmailRead(input = {}) {
    const id = input.emailId || input.messageId || input.id;
    if (!id) throw new Error('GMAIL_MARK_READ_REQUIRES_EMAIL_ID');
    const auth = authFactory.getClient();
    const gmail = google.gmail({ version: 'v1', auth });
    await withRetry(() => gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { removeLabelIds: ['UNREAD'] }
    }));
    cache.invalidate('list_emails');
    return { read: true, emailId: id };
  }

  async function searchEmails(input = {}) {
    if (!input.query && !input.from && !input.subject && !input.after && !input.before) {
      throw new Error('GMAIL_SEARCH_REQUIRES_AT_LEAST_ONE_FILTER');
    }

    const parts = [];
    if (input.query) parts.push(input.query);
    if (input.from) parts.push(`from:${input.from}`);
    if (input.subject) parts.push(`subject:${input.subject}`);
    if (input.after) parts.push(`after:${input.after}`);
    if (input.before) parts.push(`before:${input.before}`);
    if (input.hasAttachment) parts.push('has:attachment');
    if (input.label) parts.push(`label:${input.label}`);
    if (input.isUnread) parts.push('is:unread');

    const auth = authFactory.getClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const maxResults = Math.min(Number(input.maxResults) || 10, 20);

    const listResponse = await withRetry(() =>
      gmail.users.messages.list({ userId: 'me', maxResults, q: parts.join(' ') })
    );

    const messages = listResponse.data.messages || [];
    const results = [];
    for (const message of messages) {
      const detail = await fetchMessageDetail(gmail, message.id);
      results.push({
        ...detail,
        summary: buildEmailSummary({ subject: detail.subject, snippet: detail.snippet, bodyText: detail.body })
      });
    }

    return { query: parts.join(' '), total: listResponse.data.resultSizeEstimate, emails: results };
  }

  async function getThread(input = {}) {
    if (!input.threadId && !input.messageId) {
      throw new Error('GMAIL_GET_THREAD_REQUIRES_THREAD_ID_OR_MESSAGE_ID');
    }

    const auth = authFactory.getClient();
    const gmail = google.gmail({ version: 'v1', auth });

    let threadId = input.threadId;
    if (!threadId && input.messageId) {
      const msg = await withRetry(() =>
        gmail.users.messages.get({ userId: 'me', id: input.messageId, format: 'minimal' })
      );
      threadId = msg.data.threadId;
    }

    const thread = await withRetry(() =>
      gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
    );

    const messages = (thread.data.messages || []).map((msg) => {
      const headers = msg.payload?.headers || [];
      const findHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
      const bodyText = cleanEmailText(collectBodyParts(msg.payload).join('\n'));
      return {
        id: msg.id,
        from: findHeader('From'),
        to: findHeader('To'),
        date: findHeader('Date'),
        snippet: cleanEmailText(msg.snippet || ''),
        body: bodyText.slice(0, 2000)
      };
    });

    const firstHeaders = thread.data.messages?.[0]?.payload?.headers || [];
    const subject = firstHeaders.find((h) => h.name.toLowerCase() === 'subject')?.value || '(sin asunto)';

    return {
      threadId,
      subject,
      messageCount: messages.length,
      participants: [...new Set(messages.flatMap((m) => [m.from, m.to]).filter(Boolean))],
      messages
    };
  }

  async function createDraft(input = {}) {
    if (!input.to || !input.subject || !input.body) {
      throw new Error('GMAIL_DRAFT_REQUIRES_TO_SUBJECT_BODY');
    }

    let resolvedInput = { ...input };
    if (contactResolver && !String(input.to).includes('@')) {
      const match = await contactResolver(String(input.to), input);
      if (match?.email) {
        resolvedInput = { ...resolvedInput, to: match.email };
      }
    }

    const auth = authFactory.getClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const response = await withRetry(() =>
      gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: encodeMessage(resolvedInput) } }
      })
    );

    return {
      draftId: response.data.id,
      messageId: response.data.message?.id,
      resolvedRecipient: resolvedInput.to,
      url: `https://mail.google.com/mail/#drafts/${response.data.id}`
    };
  }

  return [
    {
      name: 'google.gmail.list_emails',
      description: 'List recent Gmail messages. Use attentionFilter="alta" to show only high-priority emails. Use query to filter by sender, subject or date.',
      risk: 'medium',
      permissions: ['google:gmail:read'],
      aliases: {
        maxResults:      ['max_results', 'limit', 'count', 'cantidad'],
        attentionFilter: ['atencion', 'prioridad', 'priority', 'attention', 'filter']
      },
      execute: listEmails
    },
    {
      name: 'google.gmail.send_email',
      description: 'Send an email through the user Gmail account.',
      risk: 'high',
      // Envío a terceros: la confirmación se rige por procedencia del contenido
      // (cuerpo dictado literal → directo; redactado por el asistente → confirmar).
      outbound: true,
      permissions: ['google:gmail:send'],
      required: ['to', 'subject', 'body'],
      aliases: {
        to: ['recipient', 'destinatario', 'email'],
        subject: ['asunto'],
        body: ['message', 'mensaje', 'content', 'contenido']
      },
      execute: sendEmail
    },
    {
      name: 'google.gmail.trash_email',
      description: 'Move an email to trash. Use emailId from context when the user asks to delete a specific email they saw earlier.',
      risk: 'medium',
      permissions: ['google:gmail:write'],
      aliases: {
        emailId: ['email_id', 'messageId', 'message_id', 'id', 'correo_id']
      },
      execute: trashEmail
    },
    {
      name: 'google.gmail.archive_email',
      description: 'Archive an email (removes from inbox, keeps in All Mail). Use emailId from context.',
      risk: 'medium',
      permissions: ['google:gmail:write'],
      aliases: {
        emailId: ['email_id', 'messageId', 'message_id', 'id', 'correo_id']
      },
      execute: archiveEmail
    },
    {
      name: 'google.gmail.mark_read',
      description: 'Mark an email as read. Use emailId from context.',
      risk: 'low',
      permissions: ['google:gmail:write'],
      aliases: {
        emailId: ['email_id', 'messageId', 'message_id', 'id', 'correo_id']
      },
      execute: markEmailRead
    },
    {
      name: 'google.gmail.search_emails',
      description: 'Search Gmail messages with filters: from, subject, date range, label, unread, attachments.',
      risk: 'low',
      permissions: ['google:gmail:read'],
      aliases: {
        query: ['q', 'buscar', 'search'],
        from: ['de', 'remitente', 'sender'],
        subject: ['asunto', 'titulo'],
        after: ['desde', 'despues'],
        before: ['hasta', 'antes'],
        hasAttachment: ['has_attachment', 'con_adjunto', 'adjunto'],
        label: ['etiqueta', 'carpeta', 'folder'],
        isUnread: ['is_unread', 'no_leido', 'unread'],
        maxResults: ['max_results', 'limit', 'count']
      },
      execute: searchEmails
    },
    {
      name: 'google.gmail.get_thread',
      description: 'Get a full Gmail conversation thread including all replies.',
      risk: 'low',
      permissions: ['google:gmail:read'],
      aliases: {
        threadId: ['thread_id', 'hilo', 'conversacion'],
        messageId: ['message_id', 'id', 'correo_id']
      },
      execute: getThread
    },
    {
      name: 'google.gmail.create_draft',
      description: 'Create a Gmail draft without sending it. Lower risk alternative to send_email.',
      risk: 'medium',
      permissions: ['google:gmail:write'],
      required: ['to', 'subject', 'body'],
      aliases: {
        to: ['recipient', 'destinatario', 'para'],
        subject: ['asunto'],
        body: ['message', 'mensaje', 'content', 'contenido']
      },
      execute: createDraft
    }
  ];
}

module.exports = {
  createGmailTools,
  buildEmailSummary,
  cleanEmailText,
  inferFallbackTriage,
  sanitizeForSummary,
  summarizeEmailsWithModel,
  encodeMessage,
  normalizeMaxResults
};
