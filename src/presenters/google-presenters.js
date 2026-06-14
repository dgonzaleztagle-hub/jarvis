const { formatForUser } = require('../utils/time');

function presentCalendarList(toolResult) {
  const events = toolResult.result?.events || [];
  return {
    speak: events.length === 0 ? 'He revisado tu agenda y no tienes eventos para ese periodo.' : `He revisado tu agenda y encontré ${events.length} evento${events.length === 1 ? '' : 's'}.`,
    format: 'list',
    visual: events.length === 0
      ? 'No hay eventos en el periodo consultado.'
      : events.map((event) => {
        const start = event.start?.dateTime || event.start?.date || '';
        const when = start ? formatForUser(start, { dateStyle: 'short', timeStyle: 'short' }) : 'hora no disponible';
        return [
          `- ${event.summary}`,
          `  ${when}`,
          event.location ? `  ${event.location}` : null
        ].filter(Boolean).join('\n');
      }).join('\n')
  };
}

function presentCalendarCreate(toolResult) {
  const summary = toolResult.result?.summary || toolResult.input?.summary || 'Evento sin título';
  const start = toolResult.result?.start?.dateTime || toolResult.result?.start?.date || toolResult.input?.startTime || '';
  const end = toolResult.result?.end?.dateTime || toolResult.result?.end?.date || toolResult.input?.endTime || '';
  const startText = start ? formatForUser(start, { dateStyle: 'short', timeStyle: 'short' }) : null;
  const endText = end ? formatForUser(end, { dateStyle: 'short', timeStyle: 'short' }) : null;
  return {
    speak: 'Listo. El evento ya fue creado.',
    format: 'sections',
    visual: [
      `Evento: ${summary}`,
      startText ? `Inicio: ${startText}` : null,
      endText ? `Fin: ${endText}` : null,
      toolResult.result?.htmlLink ? `Enlace: ${toolResult.result.htmlLink}` : null
    ].filter(Boolean).join('\n')
  };
}

function presentGmailList(toolResult) {
  const emails = toolResult.result?.emails || [];
  const requestedMaxResults = toolResult.result?.requestedMaxResults;
  const requestedText = requestedMaxResults || emails.length;
  return {
    speak: emails.length === 0
      ? 'Revisé tu correo y no encontré mensajes para esa búsqueda.'
      : `Revisé tu correo y te muestro ${emails.length} de los ${requestedText} correo${requestedText === 1 ? '' : 's'} que pediste.`,
    format: 'list',
    visual: emails.length === 0
      ? 'No hay correos para mostrar.'
      : [`Últimos ${requestedText} correo${requestedText === 1 ? '' : 's'} solicitados:`].concat(emails.map((email, index) => {
        const dateText = email.date ? formatForUser(email.date, {
          dateStyle: 'short',
          timeStyle: 'short'
        }) : 'fecha no disponible';
        const summary = email.summary || 'No hay suficiente contenido para resumir este correo.';
        const preview = email.preview || email.snippet || '';
        const summaryLabel = email.summarySource === 'model' ? 'Resumen' : 'Vista resumida';
        return [
          `${index + 1}. ${email.subject}`,
          `- De: ${email.from}`,
          `- Fecha: ${dateText}`,
          email.category ? `- Tipo: ${email.category}` : null,
          email.attention ? `- Atención: ${email.attention}` : null,
          `- ${summaryLabel}: ${summary}`,
          email.why ? `- Por qué importa: ${email.why}` : null,
          email.suggestedAction ? `- Acción sugerida: ${email.suggestedAction}` : null,
          preview ? `- Vista previa: ${preview}` : null
        ].filter(Boolean).join('\n');
      })).join('\n\n')
  };
}

function presentContactsSearch(toolResult) {
  const matches = toolResult.result?.matches || [];
  return {
    speak: matches.length === 0 ? 'No encontré contactos que coincidan.' : `Encontré ${matches.length} contacto${matches.length === 1 ? '' : 's'}.`,
    format: 'list',
    visual: matches.map((contact) => `- ${contact.name} ${contact.emails?.[0] || ''} ${contact.phones?.[0] || ''}`.trim()).join('\n')
  };
}

function presentGmailSend(toolResult) {
  const recipient = toolResult.result?.resolvedRecipient || toolResult.input?.to || 'destinatario no identificado';
  const subject = toolResult.input?.subject;
  return {
    speak: 'Listo. El correo ya fue enviado.',
    format: 'sections',
    visual: [
      `Correo enviado a ${recipient}.`,
      subject ? `Asunto: ${subject}` : null
    ].filter(Boolean).join('\n')
  };
}

function presentDocsCreate(toolResult) {
  const title = toolResult.result?.name || toolResult.input?.title || 'Documento sin título';
  return {
    speak: 'Listo. El documento ya fue creado.',
    format: 'sections',
    visual: [
      `Documento: ${title}`,
      toolResult.result?.webViewLink ? `Enlace: ${toolResult.result.webViewLink}` : null
    ].filter(Boolean).join('\n')
  };
}

function registerGooglePresenters(registry) {
  registry.register('google.calendar.list_events', presentCalendarList);
  registry.register('google.calendar.create_event', presentCalendarCreate);
  registry.register('google.docs.create_document', presentDocsCreate);
  registry.register('google.gmail.list_emails', presentGmailList);
  registry.register('google.gmail.send_email', presentGmailSend);
  registry.register('google.contacts.search', presentContactsSearch);
}

module.exports = {
  registerGooglePresenters,
  presentCalendarList,
  presentCalendarCreate,
  presentGmailList,
  presentGmailSend,
  presentDocsCreate,
  presentContactsSearch
};
