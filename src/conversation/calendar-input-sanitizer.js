// Sanitización del input de google.calendar.create_event ANTES de ejecutarlo.
// El modelo a veces rellena campos que el usuario no pidió (links de Meet
// inventados, descripciones, invitados que no son emails) o pone una fecha
// distinta a la que el usuario dijo. Esta capa recorta el input a lo que el
// texto del usuario realmente sustenta. Extraído de conversation-runtime.js
// como responsabilidad única, sin estado ni `this` — puro y testeable.

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

module.exports = {
  userMentionsExplicitDate,
  extractMentionedTime,
  setDateKeepingTime,
  isEmailLike,
  sanitizeAttendees,
  sanitizeCalendarCreateEventInput
};
