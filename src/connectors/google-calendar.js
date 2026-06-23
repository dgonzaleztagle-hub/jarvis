const { google } = require('googleapis');
const { withRetry } = require('../utils/retry');
const { ConnectorCache } = require('../utils/connector-cache');
const { tzParts, weekday, addDaysInTz, daysInMonth, startOfDayInTz, endOfDayInTz, zonedTime } = require('../utils/time');

// El parser laxo de Date() "adivina" fechas para texto que no es una fecha
// real — encontrado en vivo: new Date("mañana a las 9") no da NaN, da
// 2001-09-01 (basura silenciosa, no un error). Sin año explícito de 4 dígitos
// no hay garantía de que el string sea una fecha y no una frase en lenguaje
// natural; en ese caso hay que pasar SIEMPRE por el parser de abajo, nunca
// confiar en new Date() a ciegas.
function looksLikeExplicitDate(value) {
  if (value instanceof Date || typeof value === 'number') return true;
  return /\d{4}/.test(String(value || ''));
}

function toIsoOrNull(value) {
  if (!value || !looksLikeExplicitDate(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseNaturalDateTime(value, baseDate = new Date()) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const raw = String(value).trim();
  const direct = looksLikeExplicitDate(raw) ? new Date(raw) : null;
  if (direct && !Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const lower = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3] ? timeMatch[3].toLowerCase() : '';

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  // Día base en la ZONA DEL PRODUCTO, no en la del proceso Node — antes
  // candidate.setHours/setDate usaban Date#getDate() local, una fuente de
  // verdad distinta a JARVIS_TZ que podía desincronizar (mismo bug de fondo
  // que el de los agentes diarios, ver agent-scheduler.js).
  let dayDelta = 0;
  if (/\b(tomorrow|manana|mañana)\b/.test(lower)) dayDelta = 1;
  else if (/\b(yesterday|ayer)\b/.test(lower)) dayDelta = -1;
  else if (/\b(next week|proxima semana|pr[oó]xima semana)\b/.test(lower)) dayDelta = 7;

  const targetDate = dayDelta !== 0 ? addDaysInTz(baseDate, dayDelta) : baseDate;
  const p = tzParts(targetDate);
  return zonedTime(+p.year, +p.month, +p.day, hour, minute, 0).toISOString();
}

function normalizeGuests(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object' && item.email) return String(item.email).trim();
        return '';
      })
      .filter(Boolean)
      .map((email) => ({ email }));
  }

  return String(value)
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

function normalizeConferenceInput(input = {}) {
  if (input.meetingUrl || input.meetUrl || input.zoomUrl) {
    return {
      type: 'external_link',
      url: input.meetingUrl || input.meetUrl || input.zoomUrl
    };
  }

  const conference = input.conferenceData;
  if (!conference || typeof conference !== 'object') return null;
  if (conference.url) {
    return {
      type: 'external_link',
      url: conference.url
    };
  }
  if (conference.joinUrl) {
    return {
      type: 'external_link',
      url: conference.joinUrl
    };
  }
  if (conference.platform && /meet/i.test(String(conference.platform))) {
    return {
      type: 'google_meet'
    };
  }
  return null;
}

// Todos los límites de día/semana/mes se calculan EN LA ZONA DEL PRODUCTO
// (utils/time.js), no con los getters locales de Date (que leen la zona del
// PROCESO Node — una fuente de verdad distinta que podía desincronizar de
// JARVIS_TZ, el mismo bug de fondo que el de los agentes diarios).
function resolvePeriod(period, baseDate = new Date()) {
  const d = baseDate;

  const key = String(period || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/\s+/g, '_');

  switch (key) {
    case 'today':
    case 'hoy':
      return { timeMin: startOfDayInTz(d).toISOString(), timeMax: endOfDayInTz(d).toISOString() };
    case 'tomorrow':
    case 'manana':
    case 'mañana': {
      const t = addDaysInTz(d, 1);
      return { timeMin: t.toISOString(), timeMax: endOfDayInTz(t).toISOString() };
    }
    case 'this_week':
    case 'esta_semana': {
      const day = weekday(d); // 0=domingo..6=sábado
      const monday = addDaysInTz(d, -((day + 6) % 7));
      const sunday = addDaysInTz(monday, 6);
      return { timeMin: monday.toISOString(), timeMax: endOfDayInTz(sunday).toISOString() };
    }
    case 'next_week':
    case 'proxima_semana':
    case 'siguiente_semana': {
      const day = weekday(d);
      const nextMon = addDaysInTz(d, -((day + 6) % 7) + 7);
      const nextSun = addDaysInTz(nextMon, 6);
      return { timeMin: nextMon.toISOString(), timeMax: endOfDayInTz(nextSun).toISOString() };
    }
    case 'next_3_days':
    case 'proximos_3_dias': {
      const end = addDaysInTz(d, 3);
      return { timeMin: startOfDayInTz(d).toISOString(), timeMax: endOfDayInTz(end).toISOString() };
    }
    case 'next_7_days':
    case 'proximos_7_dias': {
      const end = addDaysInTz(d, 7);
      return { timeMin: startOfDayInTz(d).toISOString(), timeMax: endOfDayInTz(end).toISOString() };
    }
    case 'this_month':
    case 'este_mes': {
      const p = tzParts(d);
      const first = zonedTime(+p.year, +p.month, 1, 0, 0, 0);
      const last = zonedTime(+p.year, +p.month, daysInMonth(+p.year, +p.month), 23, 59, 59);
      return { timeMin: first.toISOString(), timeMax: last.toISOString() };
    }
    default:
      return null;
  }
}

function formatEventSummary(event) {
  return {
    id: event.id,
    summary: event.summary || '(sin titulo)',
    description: event.description || '',
    location: event.location || '',
    start: event.start,
    end: event.end,
    attendees: (event.attendees || []).map((a) => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
    htmlLink: event.htmlLink
  };
}

function createGoogleCalendarTools({ authFactory }) {
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santiago';
  const cache = new ConnectorCache({ ttlMs: 30 * 60 * 1000 });

  async function listEvents(input = {}) {
    const force = input.force === true || input.refresh === true;
    const cacheKey = {
      period: input.period || null,
      timeMin: input.timeMin || null,
      timeMax: input.timeMax || null,
      calendarId: input.calendarId || 'primary',
      maxResults: input.maxResults || 20
    };

    // Cache key uses a generous fetch size — runtime limit applied post-cache
    const fetchMax = 20;
    const runtimeLimit = input.maxResults ? Math.max(1, Math.min(Number(input.maxResults), 20)) : null;
    const baseCacheKey = { ...cacheKey, maxResults: fetchMax };

    let baseResult;
    if (!force) {
      const cached = cache.get('list_events', baseCacheKey);
      if (cached) baseResult = { ...cached, _fromCache: true };
    }

    if (!baseResult) {
      const auth = authFactory.getClient();
      const calendar = google.calendar({ version: 'v3', auth });

      let timeMin, timeMax;
      if (input.period) {
        const resolved = resolvePeriod(input.period);
        if (resolved) { timeMin = resolved.timeMin; timeMax = resolved.timeMax; }
      }

      const now = new Date();
      timeMin = timeMin || toIsoOrNull(input.timeMin) || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
      timeMax = timeMax || toIsoOrNull(input.timeMax) || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

      const response = await withRetry(() =>
        calendar.events.list({
          calendarId: input.calendarId || 'primary',
          timeMin,
          timeMax,
          maxResults: fetchMax,
          singleEvents: true,
          orderBy: 'startTime'
        })
      );

      baseResult = {
        calendarId: input.calendarId || 'primary',
        period: input.period || null,
        timeMin,
        timeMax,
        events: (response.data.items || []).map(formatEventSummary)
      };

      cache.set('list_events', baseCacheKey, baseResult);
    }

    // Apply runtime limit post-cache — always respects what was requested
    const events = runtimeLimit ? baseResult.events.slice(0, runtimeLimit) : baseResult.events;
    return { ...baseResult, events };
  }

  async function createEvent(input = {}) {
    const auth = authFactory.getClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const timeZone = input.timeZone || tz();
    const attendees = normalizeGuests(input.guests || input.attendees);
    const conference = normalizeConferenceInput(input);
    const descriptionLines = [input.description || ''];
    const startDateTime = toIsoOrNull(input.startTime) || parseNaturalDateTime(input.startTime);
    const endDateTime = toIsoOrNull(input.endTime) || parseNaturalDateTime(input.endTime, startDateTime ? new Date(startDateTime) : new Date());

    if (!input.summary || !input.startTime || !input.endTime) throw new Error('CALENDAR_EVENT_REQUIRES_SUMMARY_START_END');
    if (!startDateTime || !endDateTime) throw new Error('CALENDAR_EVENT_INVALID_DATETIME');
    if (conference?.type === 'external_link' && conference.url) descriptionLines.push(`Enlace: ${conference.url}`);

    const resource = {
      summary: input.summary,
      description: descriptionLines.filter(Boolean).join('\n').trim(),
      location: input.location || '',
      start: { dateTime: startDateTime, timeZone },
      end: { dateTime: endDateTime, timeZone }
    };
    if (attendees.length > 0) resource.attendees = attendees;

    const request = { calendarId: input.calendarId || 'primary', resource };
    if (conference?.type === 'google_meet') {
      request.conferenceDataVersion = 1;
      resource.conferenceData = {
        createRequest: { requestId: `jarvis-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } }
      };
    }

    const response = await withRetry(() => calendar.events.insert(request));
    cache.invalidate('list_events');
    return {
      id: response.data.id,
      summary: response.data.summary,
      start: response.data.start,
      end: response.data.end,
      attendees: response.data.attendees || [],
      conferenceData: response.data.conferenceData || null,
      htmlLink: response.data.htmlLink
    };
  }

  async function updateEvent(input = {}) {
    if (!input.eventId) throw new Error('CALENDAR_UPDATE_REQUIRES_EVENT_ID');
    const auth = authFactory.getClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = input.calendarId || 'primary';
    const timeZone = input.timeZone || tz();

    const existing = await withRetry(() =>
      calendar.events.get({ calendarId, eventId: input.eventId })
    );
    const patch = { ...existing.data };

    if (input.summary) patch.summary = input.summary;
    if (input.description !== undefined) patch.description = input.description;
    if (input.location !== undefined) patch.location = input.location;
    if (input.startTime) {
      const dt = toIsoOrNull(input.startTime) || parseNaturalDateTime(input.startTime);
      if (dt) patch.start = { dateTime: dt, timeZone };
    }
    if (input.endTime) {
      const dt = toIsoOrNull(input.endTime) || parseNaturalDateTime(input.endTime);
      if (dt) patch.end = { dateTime: dt, timeZone };
    }
    if (input.guests || input.attendees) {
      patch.attendees = normalizeGuests(input.guests || input.attendees);
    }

    const response = await withRetry(() =>
      calendar.events.update({ calendarId, eventId: input.eventId, resource: patch })
    );
    cache.invalidate('list_events');
    return formatEventSummary(response.data);
  }

  async function deleteEvent(input = {}) {
    if (!input.eventId) throw new Error('CALENDAR_DELETE_REQUIRES_EVENT_ID');
    const auth = authFactory.getClient();
    const calendar = google.calendar({ version: 'v3', auth });
    await withRetry(() =>
      calendar.events.delete({ calendarId: input.calendarId || 'primary', eventId: input.eventId })
    );
    cache.invalidate('list_events');
    return { deleted: true, eventId: input.eventId };
  }

  async function findFreeSlots(input = {}) {
    const auth = authFactory.getClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = input.calendarId || 'primary';
    const durationMin = Number(input.durationMinutes) || 60;

    let timeMin, timeMax;
    if (input.period) {
      const resolved = resolvePeriod(input.period);
      if (resolved) { timeMin = resolved.timeMin; timeMax = resolved.timeMax; }
    }
    const now = new Date();
    timeMin = timeMin || toIsoOrNull(input.timeMin) || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    timeMax = timeMax || toIsoOrNull(input.timeMax) || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    const workDayStart = Number(input.workDayStart) || 9;
    const workDayEnd = Number(input.workDayEnd) || 18;

    const fbResponse = await withRetry(() =>
      calendar.freebusy.query({
        requestBody: { timeMin, timeMax, items: [{ id: calendarId }] }
      })
    );

    const busyPeriods = (fbResponse.data.calendars?.[calendarId]?.busy || [])
      .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
      .sort((a, b) => a.start - b.start);

    const slots = [];
    const rangeStart = new Date(timeMin);
    const rangeEnd = new Date(timeMax);
    let cursor = new Date(rangeStart);

    while (cursor < rangeEnd) {
      const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), workDayStart, 0, 0);
      const dayEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), workDayEnd, 0, 0);
      const windowStart = cursor < dayStart ? dayStart : cursor;
      const windowEnd = dayEnd < rangeEnd ? dayEnd : rangeEnd;

      let slotStart = new Date(windowStart);
      for (const busy of busyPeriods) {
        if (busy.end <= slotStart || busy.start >= windowEnd) continue;
        if (busy.start > slotStart) {
          const slotEnd = busy.start < windowEnd ? busy.start : windowEnd;
          if ((slotEnd - slotStart) >= durationMin * 60 * 1000) {
            slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString(), durationMinutes: Math.floor((slotEnd - slotStart) / 60000) });
          }
        }
        if (busy.end > slotStart) slotStart = new Date(busy.end);
      }
      if (slotStart < windowEnd && (windowEnd - slotStart) >= durationMin * 60 * 1000) {
        slots.push({ start: slotStart.toISOString(), end: windowEnd.toISOString(), durationMinutes: Math.floor((windowEnd - slotStart) / 60000) });
      }

      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0);
    }

    return { timeMin, timeMax, durationMinutes: durationMin, freeSlots: slots.slice(0, 10) };
  }

  async function listCalendars(input = {}) {
    const auth = authFactory.getClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const response = await withRetry(() =>
      calendar.calendarList.list({ minAccessRole: input.minAccessRole || 'reader' })
    );
    return {
      calendars: (response.data.items || []).map((c) => ({
        id: c.id,
        summary: c.summary,
        description: c.description || '',
        primary: c.primary || false,
        accessRole: c.accessRole,
        backgroundColor: c.backgroundColor || null,
        timeZone: c.timeZone || null
      }))
    };
  }

  return [
    {
      name: 'google.calendar.list_events',
      description: 'List calendar events. Use period for natural ranges: today, tomorrow, this_week, next_week, next_3_days, next_7_days, this_month.',
      risk: 'low',
      permissions: ['google:calendar:read'],
      aliases: {
        period: ['periodo', 'rango', 'cuando', 'when'],
        maxResults: ['max_results', 'limit', 'count', 'cantidad'],
        timeMin: ['time_min', 'start_time', 'desde'],
        timeMax: ['time_max', 'end_time', 'hasta']
      },
      execute: listEvents
    },
    {
      name: 'google.calendar.create_event',
      description: 'Create a Google Calendar event. Only summary, startTime and endTime are required; guests are OPTIONAL. A request like "agéndame una reunión CON Tomás" means block the time on the user\'s calendar — do NOT require or ask for the other person\'s email. Add guests ONLY if the user gives emails or explicitly asks to send an invitation. Supports optional Google Meet link.',
      risk: 'medium',
      permissions: ['google:calendar:write'],
      required: ['summary', 'startTime', 'endTime'],
      aliases: {
        summary: ['title', 'titulo', 'título', 'name', 'nombre'],
        description: ['descripcion', 'descripción', 'details'],
        startTime: ['start_time', 'start', 'inicio'],
        endTime: ['end_time', 'end', 'fin'],
        guests: ['guest', 'guestEmails', 'invitados', 'attendees', 'invitees'],
        meetingUrl: ['meeting_url', 'meetingLink', 'meet_link', 'zoom_link', 'zoomUrl'],
        location: ['ubicacion', 'ubicación', 'place', 'lugar']
      },
      execute: createEvent
    },
    {
      name: 'google.calendar.update_event',
      description: 'Update an existing calendar event: title, time, location, guests or description.',
      risk: 'medium',
      permissions: ['google:calendar:write'],
      required: ['eventId'],
      aliases: {
        eventId: ['event_id', 'id', 'evento_id'],
        summary: ['title', 'titulo', 'nombre'],
        startTime: ['start_time', 'start', 'inicio'],
        endTime: ['end_time', 'end', 'fin'],
        guests: ['invitados', 'attendees'],
        location: ['ubicacion', 'lugar']
      },
      execute: updateEvent
    },
    {
      name: 'google.calendar.delete_event',
      description: 'Cancel and delete a calendar event.',
      risk: 'high',
      permissions: ['google:calendar:write'],
      required: ['eventId'],
      aliases: {
        eventId: ['event_id', 'id', 'evento_id'],
        calendarId: ['calendar_id', 'calendario']
      },
      execute: deleteEvent
    },
    {
      name: 'google.calendar.find_free_slots',
      description: 'Find available time slots in the calendar for a given duration. Useful for scheduling meetings.',
      risk: 'low',
      permissions: ['google:calendar:read'],
      aliases: {
        period: ['periodo', 'rango', 'cuando'],
        timeMin: ['start', 'desde', 'start_time'],
        timeMax: ['end', 'hasta', 'end_time'],
        durationMinutes: ['duration', 'duracion', 'duracion_minutos', 'minutes'],
        workDayStart: ['work_start', 'inicio_jornada'],
        workDayEnd: ['work_end', 'fin_jornada']
      },
      execute: findFreeSlots
    },
    {
      name: 'google.calendar.list_calendars',
      description: 'Listar todos los calendarios del usuario (primario, compartidos, de trabajo, feriados, etc.). Útil antes de crear un evento en un calendario específico o para saber qué calendarios tiene activos. Sin input requerido.',
      risk: 'low',
      permissions: ['google:calendar:read'],
      execute: listCalendars
    }
  ];
}

module.exports = { createGoogleCalendarTools, resolvePeriod, parseNaturalDateTime };
