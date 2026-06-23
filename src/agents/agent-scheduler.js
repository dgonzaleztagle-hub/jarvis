// Día y hora en la zona del producto (Chile por defecto), no UTC ni la zona de
// la máquina: con UTC el presupuesto diario se reseteaba a las 20:00/21:00 de
// Chile y un agente diario nocturno podía correr dos veces o saltarse.
const { dayKey, hhmm, weekday } = require('../utils/time');

function todayKey(now) {
  return dayKey(now);
}

function localHHMM(now) {
  return hhmm(now);
}

class AgentScheduler {
  constructor({ store, conversationRuntime, eventBus, usageMeter, budgetConfig, auditTrail, toolRegistry, intervalMs = 60_000 }) {
    this.store = store;
    this.conversationRuntime = conversationRuntime;
    this.eventBus = eventBus;
    this.usageMeter = usageMeter || null;
    this.budgetConfig = budgetConfig || null;
    this.auditTrail = auditTrail || null;
    this.toolRegistry = toolRegistry || null;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = new Set();
    // Dedup en memoria: no repetir el aviso de tope global en cada corrida del
    // mismo día (a diferencia del tope por-agente, que sí persiste en disco).
    this._globalWarnedDate = null;
  }

  // Tope diario GLOBAL (todos los agentes combinados) — corte duro antes de
  // correr NADA, automático o manual. El tope por-agente (maxCostPerDayUsd)
  // sigue aparte y se revisa independientemente en shouldRun().
  globalCapExceeded(now = new Date()) {
    if (!this.budgetConfig || !this.usageMeter) return false;
    const cap = this.budgetConfig.getGlobalDailyCap();
    if (cap == null) return false;
    return this.usageMeter.getCostForDate(todayKey(now)) >= cap;
  }

  maybeWarnGlobalBudget(now = new Date()) {
    if (!this.budgetConfig || !this.usageMeter || !this.eventBus) return;
    const cap = this.budgetConfig.getGlobalDailyCap();
    if (cap == null) return;
    const spent = this.usageMeter.getCostForDate(todayKey(now));
    if (spent < cap * 0.8) return;
    const today = todayKey(now);
    if (this._globalWarnedDate === today) return;
    this._globalWarnedDate = today;
    this.eventBus.emit('agent_budget_warning', { scope: 'global', spent: Number(spent.toFixed(4)), limit: cap, at: now.toISOString() });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.intervalMs);
    // unref: el scheduler no debe mantener vivo el proceso (tests, shutdown limpio)
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  shouldRun(agent, now) {
    if (!agent.enabled) return false;
    if (this.globalCapExceeded(now)) return false;
    const schedule = agent.schedule || { type: 'manual' };
    if (schedule.type === 'manual') return false;

    const runsToday = agent.runsTodayDate === todayKey(now) ? agent.runsToday : 0;
    if (runsToday >= agent.maxRunsPerDay) return false;

    if (agent.maxCostPerDayUsd != null) {
      const costToday = agent.costTodayDate === todayKey(now) ? agent.costToday : 0;
      if (costToday >= agent.maxCostPerDayUsd) return false;
    }

    if (schedule.type === 'daily') {
      // OJO: lastRunAt es ISO en UTC (toISOString) — compararlo con
      // .slice(0,10) contra todayKey(now) (día en Chile) desincroniza entre
      // las 20:00 y 23:59 de Chile, cuando el día UTC ya es "mañana" pero en
      // Chile sigue siendo "hoy": el agente cree que NO ha corrido hoy y se
      // re-dispara cada tick hasta el tope de maxRunsPerDay. Bug real
      // encontrado en vivo: "Test Validacion Self QA" disparándose solo cada
      // minuto. Fix: convertir lastRunAt a día-Chile antes de comparar.
      const alreadyToday = agent.lastRunAt && todayKey(new Date(agent.lastRunAt)) === todayKey(now);
      return !alreadyToday && localHHMM(now) >= schedule.at;
    }
    if (schedule.type === 'interval') {
      if (!agent.lastRunAt) return true;
      const elapsedMin = (now.getTime() - new Date(agent.lastRunAt).getTime()) / 60_000;
      return elapsedMin >= Number(schedule.minutes);
    }
    if (schedule.type === 'weekly') {
      const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
      if (!days.includes(weekday(now))) return false;
      // OJO: lastRunAt es ISO en UTC (toISOString) — compararlo con
      // .slice(0,10) contra todayKey(now) (día en Chile) desincroniza entre
      // las 20:00 y 23:59 de Chile, cuando el día UTC ya es "mañana" pero en
      // Chile sigue siendo "hoy": el agente cree que NO ha corrido hoy y se
      // re-dispara cada tick hasta el tope de maxRunsPerDay. Bug real
      // encontrado en vivo: "Test Validacion Self QA" disparándose solo cada
      // minuto. Fix: convertir lastRunAt a día-Chile antes de comparar.
      const alreadyToday = agent.lastRunAt && todayKey(new Date(agent.lastRunAt)) === todayKey(now);
      return !alreadyToday && localHHMM(now) >= schedule.at;
    }
    return false;
  }

  async tick(now = new Date()) {
    for (const agent of this.store.list()) {
      if (this.shouldRun(agent, now) && !this.running.has(agent.id)) {
        await this.runAgent(agent, { trigger: 'schedule' }).catch(() => {});
      }
    }
  }

  async runAgent(agentOrId, { trigger = 'manual', answerToLastQuestion = null } = {}) {
    const agent = typeof agentOrId === 'string' ? this.store.get(agentOrId) : agentOrId;
    if (!agent) throw new Error(`AGENT_NOT_FOUND: ${agentOrId}`);
    if (this.running.has(agent.id)) throw new Error(`AGENT_ALREADY_RUNNING: ${agent.name}`);
    // Corte duro también para corridas manuales/de validación — el tope
    // global no se salta porque alguien lo dispare a mano.
    if (this.globalCapExceeded(new Date())) {
      throw new Error('GLOBAL_DAILY_BUDGET_EXCEEDED: se alcanzó el tope diario de gasto configurado para el conjunto de agentes.');
    }

    this.running.add(agent.id);
    // El HUD escucha esto para prender el pulso de "trabajando" en el momento
    // real en que arranca — no cuando termina, que es lo único que ya emitía.
    this.eventBus?.emit('agent_run_started', { agentId: agent.id, name: agent.name, trigger });
    const now = new Date();
    const sameDay = agent.runsTodayDate === todayKey(now);
    this.store.update(agent.id, {
      lastRunAt: now.toISOString(),
      runsToday: (sameDay ? agent.runsToday : 0) + 1,
      runsTodayDate: todayKey(now)
    });

    // Costo de la corrida = delta del gasto total del usage-meter durante el
    // handleMessage de este agente. No requiere etiquetar cada llamada al
    // modelo con agentId: las corridas de agentes no se solapan (this.running
    // las serializa por id), así que el delta global = costo de esta corrida.
    const costBefore = this.usageMeter?.summary().totals.costUsd || 0;

    try {
      // Cada corrida es el mismo pipeline de conversación, con la misión como
      // mensaje. El canal 'agent' evita contaminar el historial del HUD.
      // El encuadre es crítico: un goal redactado como misión recurrente
      // ("revisar todos los días...") se leería como orden de PROGRAMAR un
      // agente nuevo — recursión. Acá se ejecuta UNA pasada, ahora.
      const runStartedIso = now.toISOString();
      // Si esta corrida responde una pregunta que el agente dejó pendiente
      // (datos faltantes, ej: "¿me das tu teléfono?"), la respuesta se inyecta
      // como contexto de ESTA corrida puntual — no se vuelve parte permanente
      // del goal, es información de una sola vez (igual que contestarle a un
      // humano que preguntó algo).
      const answerContext = answerToLastQuestion
        ? ` [El usuario respondió a tu pregunta anterior ("${agent.lastResult?.speak || ''}"): "${answerToLastQuestion}". Úsalo para completar la misión ahora.]`
        : '';
      const task = await this.conversationRuntime.handleMessage({
        text: `[Corrida automática del agente "${agent.name}". Esta es UNA ejecución de su misión: hazla AHORA con las herramientas disponibles y reporta el resultado. La recurrencia ya está programada — no crees, modifiques ni programes agentes. Si decides notificar al dueño del sistema (por WhatsApp/Telegram/etc), dirígelo a "self"/"yo" — NUNCA a su nombre propio, no es un contacto suyo guardado.]${answerContext} Misión: ${agent.goal}`,
        channel: 'agent',
        // Namespace de memoria: lo que esta corrida aprenda queda taggeado con
        // este agentId, no contamina la memoria principal ni la de otros
        // agentes — ver knowledge-graph.js _visible().
        context: { agentId: agent.id }
      });

      // Una corrida desatendida que dejó una tool en confirmation_required NO
      // "terminó" de verdad — quedó esperando un sí que nadie le va a dar (no
      // hay un humano mirando). Sin esto, la notificación pega "terminó su
      // corrida" + el speak de esa confirmación pendiente, armando un mensaje
      // sin sentido (lo vimos real: agente de WhatsApp -> mensaje garabateado).
      const pendingConfirm = this.auditTrail?.query({ outcome: 'confirmation_required', since: runStartedIso, limit: 5 }) || [];
      const speakText = task.result?.speak || '';

      // Mismo problema de fondo que confirmation_required, pero sin tool de
      // por medio: el modelo le faltó un dato (ej: un teléfono no guardado) y
      // terminó el turno con una pregunta — en una corrida desatendida nadie
      // va a contestarla. Detectado real: agente que quedó preguntando "¿me
      // das tu teléfono?" reportado como si hubiera "terminado" normal. Señal
      // 100% estructural (termina en "?"), no requiere interpretar el texto.
      const danglingQuestion = pendingConfirm.length === 0 && task.status === 'completed' && /\?\s*$/.test(speakText.trim());

      // Si la misión ya entregó algo al usuario por un canal real (ej: le
      // mandó el WhatsApp que era justo su tarea), el aviso de "tu agente
      // corrió" por Telegram es ruido duplicado — el WhatsApp YA es el aviso.
      // Señal estructural: ¿alguna tool outbound (tool.outbound=true en el
      // registro) corrió "completed" en este turno? No depende de leer el
      // contenido de "speak", solo de qué tools de verdad se ejecutaron.
      const toolResults = Array.isArray(task.result?.toolResults) ? task.result.toolResults : [];
      const deliveredViaOutbound = this.toolRegistry
        ? toolResults.some((r) => r.status === 'completed' && this.toolRegistry.get(r.toolName)?.outbound)
        : false;

      const status = pendingConfirm.length > 0 ? 'needs_approval' : (danglingQuestion ? 'needs_input' : task.status);
      const result = {
        status,
        speak: speakText,
        pendingTools: pendingConfirm.length > 0 ? [...new Set(pendingConfirm.map((e) => e.tool))] : undefined,
        deliveredViaOutbound,
        at: now.toISOString(),
        trigger
      };
      this.recordRunCost(agent, costBefore, now);
      this.store.update(agent.id, { lastResult: result });
      const eventType = pendingConfirm.length > 0
        ? 'agent_run_needs_approval'
        : (danglingQuestion ? 'agent_run_needs_input' : 'agent_run_completed');
      this.eventBus?.emit(eventType, { agentId: agent.id, name: agent.name, ...result });
      return result;
    } catch (error) {
      this.recordRunCost(agent, costBefore, now);
      const result = { status: 'failed', error: error.message, at: now.toISOString(), trigger };
      this.store.update(agent.id, { lastResult: result });
      this.eventBus?.emit('agent_run_failed', { agentId: agent.id, name: agent.name, ...result });
      throw error;
    } finally {
      this.running.delete(agent.id);
    }
  }

  recordRunCost(agent, costBefore, now) {
    if (!this.usageMeter) return;
    const costAfter = this.usageMeter.summary().totals.costUsd;
    const runCostUsd = Math.max(0, costAfter - costBefore);
    const sameDay = agent.costTodayDate === todayKey(now);
    const costToday = (sameDay ? agent.costToday : 0) + runCostUsd;
    const today = todayKey(now);
    const updated = this.store.update(agent.id, { costToday, costTodayDate: today });

    // Alerta por-agente al 80% de su propio tope — una vez por día (dedup en
    // disco vía budgetWarnedDate, sobrevive a reinicios del proceso).
    if (agent.maxCostPerDayUsd != null && costToday >= agent.maxCostPerDayUsd * 0.8 && updated.budgetWarnedDate !== today) {
      this.store.update(agent.id, { budgetWarnedDate: today });
      this.eventBus?.emit('agent_budget_warning', {
        scope: 'agent', agentId: agent.id, name: agent.name,
        spent: Number(costToday.toFixed(4)), limit: agent.maxCostPerDayUsd, at: now.toISOString()
      });
    }

    this.maybeWarnGlobalBudget(now);
  }
}

module.exports = {
  AgentScheduler
};
