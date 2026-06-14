const http = require('http');
const fs = require('fs');
const path = require('path');
const { PORT } = require('./config');
const { createRuntime } = require('./app-runtime');
const { VOICE_PROFILES } = require('./voice/edge-tts-provider');
const { getWeather }     = require('./connectors/weather');
const { searchYoutube } = require('./connectors/youtube');

const runtime = createRuntime();

// Último archivo que se pidió mostrar en el HUD. SSE es fire-and-forget: si el
// HUD no está conectado en el instante exacto del evento (o reconecta), se
// perdería. Lo recordamos y lo reenviamos a cada cliente nuevo tras 'ready'.
let lastHudFile = null;
runtime.eventBus.on('hud_show_file', (event) => { lastHudFile = event; });

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/public/'))) {
      const publicDir = path.resolve(__dirname, '..', 'public');
      const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/public\//, '');
      const filePath = path.resolve(publicDir, requestedPath);
      const relative = path.relative(publicDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
        return sendJson(res, 404, { error: 'not_found' });
      }
      const ext = path.extname(filePath).toLowerCase();
      const typeMap = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8'
      };
      const content = fs.readFileSync(filePath);
      // no-cache: el HUD es una sola página de larga vida; sin esto el navegador
      // sirve módulos ES viejos y los listeners nuevos (p.ej. hud_show_file)
      // nunca se registran aunque el backend emita el evento.
      res.writeHead(200, {
        'Content-Type': typeMap[ext] || 'application/octet-stream',
        'Content-Length': content.length,
        'Cache-Control': 'no-cache'
      });
      res.end(content);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/runtime/audio/')) {
      const audioDir = path.resolve(runtime.dataDir, 'audio');
      const requestedPath = url.pathname.replace(/^\/runtime\/audio\//, '');
      const filePath = path.resolve(audioDir, requestedPath);
      const relative = path.relative(audioDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
        return sendJson(res, 404, { error: 'not_found' });
      }
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': content.length,
        'Cache-Control': 'no-cache'
      });
      res.end(content);
      return;
    }

    // Sirve archivos de la bandeja local (fotos/documentos recibidos por
    // Telegram u otros canales) para que el HUD pueda mostrarlos.
    if (req.method === 'GET' && url.pathname.startsWith('/inbox/')) {
      const inboxDir = path.resolve(runtime.dataDir, 'inbox');
      const requestedPath = decodeURIComponent(url.pathname.replace(/^\/inbox\//, ''));
      const filePath = path.resolve(inboxDir, requestedPath);
      const relative = path.relative(inboxDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
        return sendJson(res, 404, { error: 'not_found' });
      }
      const ext = path.extname(filePath).toLowerCase();
      const inboxTypes = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
        '.txt': 'text/plain; charset=utf-8'
      };
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': inboxTypes[ext] || 'application/octet-stream',
        'Content-Length': content.length,
        'Cache-Control': 'no-cache'
      });
      res.end(content);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      // Reenvía el último archivo pedido para el HUD: cubre el caso de abrir o
      // recargar el HUD después de pedirlo por Telegram.
      if (lastHudFile) {
        res.write(`event: hud_show_file\ndata: ${JSON.stringify(lastHudFile)}\n\n`);
      }
      const off = runtime.eventBus.on('*', (event) => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      req.on('close', () => off());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'jarvis-codex', dataDir: runtime.dataDir });
    }

    if (url.pathname === '/trust-mode') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { trustMode: runtime.policyEngine.trustMode });
      }
      if (req.method === 'POST') {
        const { enabled } = await readJson(req);
        runtime.policyEngine.trustMode = !!enabled;
        runtime.fileLogger.write('trust_mode_changed', { enabled: runtime.policyEngine.trustMode });
        return sendJson(res, 200, { trustMode: runtime.policyEngine.trustMode });
      }
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      return sendJson(res, 200, { events: runtime.eventBus.recent() });
    }

    if (req.method === 'GET' && url.pathname === '/logs') {
      const limit = Number(url.searchParams.get('limit') || 200);
      return sendJson(res, 200, { logs: runtime.fileLogger.tail(limit) });
    }

    if (req.method === 'GET' && url.pathname === '/tools') {
      return sendJson(res, 200, { tools: runtime.toolRegistry.list() });
    }

    if (req.method === 'GET' && url.pathname === '/audit') {
      const limit = Number(url.searchParams.get('limit') || 100);
      return sendJson(res, 200, {
        entries: runtime.auditTrail.query({
          limit,
          tool: url.searchParams.get('tool') || undefined,
          outcome: url.searchParams.get('outcome') || undefined
        }),
        stats: runtime.auditTrail.stats()
      });
    }

    if (req.method === 'GET' && url.pathname === '/calendar/today') {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      try {
        const result = await runtime.toolRegistry.execute('google.calendar.list_events', {
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          maxResults: 12
        });
        return sendJson(res, 200, {
          connected: true,
          events: result.output?.events || []
        });
      } catch (error) {
        return sendJson(res, 200, {
          connected: false,
          error: error.message,
          events: []
        });
      }
    }

    if (req.method === 'GET' && url.pathname === '/emails/digest') {
      const max = Math.min(Number(url.searchParams.get('max') || 15), 30);
      try {
        const result = await runtime.toolRegistry.execute('google.gmail.list_emails', { maxResults: max });
        const emails = result.output?.emails || [];
        const highAttention = emails.filter(e => e.attention === 'alta').length;
        return sendJson(res, 200, {
          connected: true,
          emails,
          stats: { total: emails.length, highAttention }
        });
      } catch (error) {
        return sendJson(res, 200, { connected: false, error: error.message, emails: [] });
      }
    }

    if (req.method === 'GET' && url.pathname === '/auth/google/status') {
      const factory = runtime.googleAuthFactory;
      if (!factory) return sendJson(res, 200, { connected: false, source: null });
      // Validación real: fuerza refresh y reporta si el token sirve de verdad.
      const health = await factory.healthCheck?.();
      const status = factory.getStatus();
      const needsReauth = status.needsReauth || !!health?.needsReauth;
      return sendJson(res, 200, {
        ...status,
        connected: !!health?.ok,
        verified: !!health?.ok,
        needsReauth,
        reason: health?.ok ? null : health?.reason || null,
        authUrl: needsReauth ? '/auth/google' : null
      });
    }

    if (req.method === 'POST' && url.pathname === '/auth/google/disconnect') {
      const factory = runtime.googleAuthFactory;
      if (!factory?.disconnect) return sendJson(res, 200, { disconnected: false });
      const result = await factory.disconnect();
      return sendJson(res, 200, { ...result, authUrl: '/auth/google' });
    }

    if (req.method === 'GET' && url.pathname === '/auth/google') {
      try {
        const authUrl = runtime.googleAuthFactory.generateAuthUrl();
        res.writeHead(302, { Location: authUrl });
        res.end();
      } catch (error) {
        return sendJson(res, 500, { error: error.message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Error: código de autorización no recibido.</h2>');
        return;
      }
      try {
        await runtime.googleAuthFactory.exchangeCode(code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><meta charset="utf-8">
          <style>body{background:#04080f;color:#00d4ff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px;}
          h2{font-size:18px;letter-spacing:2px;}p{color:#6a8ab0;font-size:13px;}</style></head>
          <body><h2>✓ GOOGLE CONECTADO</h2><p>Puedes cerrar esta ventana y volver a Jarvis.</p>
          <script>setTimeout(()=>window.close(),2000);</script></body></html>`);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2>Error al conectar Google: ${error.message}</h2>`);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/model/usage') {
      return sendJson(res, 200, { usage: runtime.usageMeter.summary() });
    }

    if (req.method === 'GET' && url.pathname === '/agents') {
      return sendJson(res, 200, { agents: runtime.agentStore.list() });
    }

    if (req.method === 'GET' && url.pathname === '/agents/notifications') {
      return sendJson(res, 200, { notifications: runtime.drainAgentNotifications() });
    }

    if (req.method === 'POST' && url.pathname === '/agents/toggle') {
      const body = await readJson(req);
      const agent = runtime.agentStore.get(String(body.agent || ''));
      if (!agent) return sendJson(res, 404, { error: 'AGENT_NOT_FOUND' });
      return sendJson(res, 200, { agent: runtime.agentStore.update(agent.id, { enabled: body.enabled !== false }) });
    }

    if (req.method === 'POST' && url.pathname === '/agents/delete') {
      const body = await readJson(req);
      try {
        return sendJson(res, 200, { result: runtime.agentStore.remove(String(body.agent || '')) });
      } catch (error) {
        if (/AGENT_NOT_FOUND/.test(error.message)) return sendJson(res, 404, { error: 'AGENT_NOT_FOUND' });
        return sendJson(res, 400, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/agents/run') {
      const body = await readJson(req);
      try {
        const result = await runtime.agentScheduler.runAgent(String(body.agent || ''), { trigger: 'manual' });
        return sendJson(res, 200, { result });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/voice/options') {
      return sendJson(res, 200, { profiles: Object.values(VOICE_PROFILES) });
    }

    if (req.method === 'GET' && url.pathname === '/tasks') {
      return sendJson(res, 200, { tasks: runtime.taskRuntime.listTasks() });
    }

    const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && taskMatch) {
      const task = runtime.taskRuntime.getTask(taskMatch[1]);
      return task ? sendJson(res, 200, { task }) : sendJson(res, 404, { error: 'task_not_found' });
    }

    const confirmMatch = url.pathname.match(/^\/tasks\/([^/]+)\/confirm$/);
    if (req.method === 'POST' && confirmMatch) {
      const body = await readJson(req);
      const task = await runtime.taskRuntime.confirmTask(confirmMatch[1], body.context || {});
      return sendJson(res, 200, { task });
    }

    if (req.method === 'POST' && url.pathname === '/tasks/tool') {
      const body = await readJson(req);
      const task = runtime.taskRuntime.createTask({
        title: body.title || `Run ${body.toolName}`,
        type: 'tool',
        input: body.input || {}
      });
      const completed = await runtime.taskRuntime.runToolTask(task.id, body.toolName, body.input || {}, body.context || {});
      return sendJson(res, 200, { task: completed });
    }

    if (req.method === 'POST' && url.pathname === '/chat') {
      const body = await readJson(req);
      const task = await runtime.conversationRuntime.handleMessage({
        text: body.text || '',
        channel: body.channel || 'hud',
        context: body.context || {}
      });
      return sendJson(res, 200, { task });
    }

    // Config de voz compartida entre canales: el panel del HUD la guarda acá
    // y el espejo de Telegram (y cualquier canal) sintetiza con estos valores.
    if (url.pathname === '/config/voice') {
      const { loadVoiceConfig, saveVoiceConfig } = require('./voice/voice-config');
      if (req.method === 'GET') {
        return sendJson(res, 200, { voice: loadVoiceConfig(runtime.dataDir) });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        return sendJson(res, 200, { voice: saveVoiceConfig(runtime.dataDir, body) });
      }
    }

    if (req.method === 'POST' && url.pathname === '/voice/speak') {
      const body = await readJson(req);
      const result = await runtime.toolRegistry.execute('voice.speak', {
        text: body.text || '',
        voiceProfile: body.voiceProfile,
        voice: body.voice,
        rate: body.rate,
        volume: body.volume,
        pitch: body.pitch
      });
      return sendJson(res, 200, {
        voice: result.output,
        url: result.output?.fileName ? `/runtime/audio/${result.output.fileName}` : null
      });
    }

    if (req.method === 'GET' && url.pathname === '/memory') {
      const filter = Object.fromEntries(url.searchParams);
      const withContent = filter.include === 'content';
      delete filter.include;
      const records = runtime.memoryStore.list(filter);
      const enriched = withContent
        ? records.map(r => { const full = runtime.memoryStore.get(r.id); return full || r; })
        : records;
      return sendJson(res, 200, { records: enriched });
    }

    const memoryGetMatch = url.pathname.match(/^\/memory\/([^/]+)$/);
    if (req.method === 'GET' && memoryGetMatch && !url.pathname.endsWith('/state')) {
      const record = runtime.memoryStore.get(memoryGetMatch[1]);
      return record ? sendJson(res, 200, { record }) : sendJson(res, 404, { error: 'not_found' });
    }

    if (req.method === 'POST' && url.pathname === '/memory') {
      const body = await readJson(req);
      return sendJson(res, 201, { record: runtime.memoryStore.upsert(body) });
    }

    const memoryStateMatch = url.pathname.match(/^\/memory\/([^/]+)\/state$/);
    if (req.method === 'POST' && memoryStateMatch) {
      const body = await readJson(req);
      const record = runtime.memoryStore.updateState(memoryStateMatch[1], body.state, body.patch || {});
      return sendJson(res, 200, { record });
    }

    if (req.method === 'GET' && url.pathname === '/vault') {
      return sendJson(res, 200, { credentials: runtime.credentialVault.list() });
    }

    if (req.method === 'POST' && url.pathname === '/vault/import-legacy') {
      const body = await readJson(req);
      const result = runtime.importLegacyCredentials(body || {});
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/channels/telegram/status') {
      return sendJson(res, 200, { telegram: runtime.telegramChannel.status() });
    }

    if (req.method === 'POST' && url.pathname === '/channels/telegram/start') {
      return sendJson(res, 200, { telegram: runtime.telegramChannel.start() });
    }

    if (req.method === 'POST' && url.pathname === '/channels/telegram/stop') {
      return sendJson(res, 200, { telegram: runtime.telegramChannel.stop() });
    }

    if (req.method === 'GET' && url.pathname === '/morning-briefing') {
      const now        = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      const [weatherRes, calendarRes, emailsRes] = await Promise.allSettled([
        getWeather(),
        runtime.toolRegistry.execute('google.calendar.list_events', {
          timeMin: todayStart.toISOString(),
          timeMax:  todayEnd.toISOString(),
          maxResults: 10,
        }),
        runtime.toolRegistry.execute('google.gmail.list_emails', {
          maxResults: 20,
          attentionFilter: 'alta',
        }),
      ]);

      const weatherData    = weatherRes.status   === 'fulfilled' ? weatherRes.value                         : null;
      const events         = calendarRes.status  === 'fulfilled' ? (calendarRes.value.output?.events || []) : [];
      const importantEmails= emailsRes.status    === 'fulfilled' ? (emailsRes.value.output?.emails  || []) : [];

      const connected = {
        calendar: calendarRes.status === 'fulfilled',
        gmail:    emailsRes.status   === 'fulfilled',
        weather:  weatherRes.status  === 'fulfilled',
      };

      const briefing = buildBriefingSpeech({ now, weather: weatherData, events, emails: importantEmails, connected });

      return sendJson(res, 200, {
        time:         hhmm(now),
        weather:      weatherData,
        events,
        emails:       importantEmails,
        connected,
        greeting:     briefing.greeting,
        continuation: briefing.continuation,
        speak:        briefing.speak,
      });
    }

    // ── YouTube search proxy ─────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/youtube/search') {
      const q = url.searchParams.get('q') || '';
      if (!q) return sendJson(res, 400, { error: 'q is required' });
      const result = await searchYoutube(q);
      if (!result) {
        return sendJson(res, 200, {
          videoId:  null,
          title:    null,
          url:      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
          fallback: true,
        });
      }
      return sendJson(res, 200, {
        videoId:  result.videoId,
        title:    result.title,
        url:      `https://www.youtube.com/watch?v=${result.videoId}`,
        fallback: false,
      });
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

/* ─── TIME HELPER ─────────────────────────────────────────────────────────────── */
function hhmm(date) {
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

/* ─── MORNING BRIEFING NARRATION BUILDER ─────────────────────────────────────── */
/**
 * Builds the morning briefing speech.
 * Greeting and closing are selected from pools so they rotate daily — avoids the
 * "same line every morning" repetition. Pool index = stable per calendar day.
 *
 * Returns { greeting, continuation, speak } where `speak` is the full narration.
 */
let _briefingCallCount = 0; // increments each call — gives different pool entry every session

function buildBriefingSpeech({ now, weather, events = [], emails = [], connected = {} }) {
  const hour     = now.getHours();
  const sessionIdx = _briefingCallCount++; // unique per server run, increments per call

  // ── Greeting pools (rotates each call) ─────────────────────────────────────
  const greetingPool = hour < 12
    ? [
        `Buenos días, Daniel. Son las ${hhmm(now)}.`,
        `Operativo, Daniel. Las ${hhmm(now)}, sistemas al cien.`,
        `El Imperio amanece. Son las ${hhmm(now)}, señor.`,
        `Señor González, las ${hhmm(now)}. Buenos días.`,
        `Las ${hhmm(now)} y todo en orden, Daniel.`,
      ]
    : hour < 20
    ? [
        `Buenas tardes, Daniel. Son las ${hhmm(now)}.`,
        `Las ${hhmm(now)}, señor. El día avanza a buen ritmo.`,
        `Tarde en curso — las ${hhmm(now)}. Consolas operativas.`,
        `Señor González, las ${hhmm(now)}. Al tanto.`,
        `Las ${hhmm(now)}, Daniel. Traigo el panorama del día.`,
      ]
    : [
        `Buenas noches, Daniel. Son las ${hhmm(now)}. El Imperio no descansa.`,
        `Las ${hhmm(now)}, señor. Turno nocturno activo.`,
        `Noche en curso — las ${hhmm(now)}. Briefing listo.`,
        `Las ${hhmm(now)}, señor González. A sus órdenes.`,
        `Operativo a las ${hhmm(now)}, Daniel. Trabajando de noche.`,
      ];

  const greeting = greetingPool[sessionIdx % greetingPool.length];

  // ── Cuerpo: clima + eventos + correos ───────────────────────────────────────
  const contParts = [];

  if (weather && !isNaN(weather.temp)) {
    contParts.push(`Afuera hay ${weather.temp} grados, ${weather.condition}.`);
  }

  const upcoming = events.filter(ev => {
    const s = new Date(ev.start?.dateTime || ev.start?.date || 0);
    return !isNaN(s) && s >= now;
  });

  if (connected.calendar === false) {
    contParts.push('No pude conectar con tu agenda, así que no puedo confirmar tus eventos.');
  } else if (upcoming.length === 0) {
    contParts.push('No tiene compromisos agendados para hoy.');
  } else if (upcoming.length === 1) {
    const ev      = upcoming[0];
    const s       = new Date(ev.start?.dateTime || ev.start?.date);
    const timeFmt = !isNaN(s) && ev.start?.dateTime ? ` a las ${hhmm(s)}` : '';
    contParts.push(`Tiene un evento hoy: ${ev.summary || 'reunión'}${timeFmt}.`);
  } else {
    const evList = upcoming.slice(0, 3).map(ev => {
      const s = new Date(ev.start?.dateTime || ev.start?.date);
      const t = !isNaN(s) && ev.start?.dateTime ? ` a las ${hhmm(s)}` : '';
      return `${ev.summary || 'reunión'}${t}`;
    });
    const extra = upcoming.length > 3 ? ` y ${upcoming.length - 3} más` : '';
    contParts.push(`Tiene ${upcoming.length} eventos hoy: ${evList.join(', ')}${extra}.`);
  }

  if (connected.gmail === false) {
    contParts.push('No pude revisar tu correo, así que no puedo decirte si hay algo urgente.');
  } else if (emails.length === 0) {
    contParts.push('Sin correos urgentes en bandeja.');
  } else if (emails.length === 1) {
    const e        = emails[0];
    const fromName = (e.from || '').replace(/<[^>]+>/g, '').replace(/"/g, '').trim() || 'alguien';
    const subj     = e.subject ? ` sobre ${e.subject}` : '';
    contParts.push(`Tiene un correo importante de ${fromName}${subj}.`);
  } else {
    const descs = emails.slice(0, 3).map(e => {
      const fromName = (e.from || '').replace(/<[^>]+>/g, '').replace(/"/g, '').trim() || 'alguien';
      return `uno de ${fromName}`;
    });
    const extra = emails.length > 3 ? ` y ${emails.length - 3} más` : '';
    contParts.push(`Tiene ${emails.length} correos que requieren atención: ${descs.join(', ')}${extra}.`);
  }

  // ── Closing phrase pool (rotates daily) ─────────────────────────────────────
  const closingPool = [
    'Todo listo, señor. A sus órdenes.',
    'Al tanto de todo. Listo para trabajar.',
    'Panorama completo. El resto depende de usted.',
    'Briefing completo, señor. A disposición.',
    'Situación controlada. ¿Por dónde empezamos?',
  ];
  const closing = closingPool[(sessionIdx + 1) % closingPool.length];

  // ── Music offer ─────────────────────────────────────────────────────────────
  const musicOfferPool = [
    '¿Con qué música arrancamos hoy?',
    '¿Le pongo algo para ambientar?',
    '¿Alguna canción para empezar bien, señor?',
    '¿Quiere que busque algo para arrancar?',
    '¿Lo acompaño con música mientras trabaja?',
  ];
  const musicOffer = musicOfferPool[(sessionIdx + 2) % musicOfferPool.length];

  const continuation = contParts.join(' ');
  const speak = [greeting, continuation, closing, musicOffer].filter(Boolean).join(' ');

  return { greeting, continuation, speak };
}

if (require.main === module) {
  http.createServer(router).listen(PORT, '127.0.0.1', () => {
    console.log(`[jarvis-codex] local runtime listening on http://127.0.0.1:${PORT}`);
    // Canal entrante de Telegram: si hay bot configurado, escuchar desde el boot.
    // Permite comandar a Jarvis y enviarle archivos desde el celular.
    if (runtime.telegramChannel.status().configured) {
      try {
        runtime.telegramChannel.start();
        console.log('[jarvis-codex] Telegram polling activo (canal entrante listo)');
      } catch (error) {
        console.warn(`[jarvis-codex] Telegram no pudo iniciar: ${error.message}`);
      }
    }
  });
}

module.exports = {
  router,
  runtime
};
