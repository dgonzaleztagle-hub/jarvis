// Día y hora en la zona del producto (Chile por defecto), no UTC ni la zona de
// la máquina: con UTC el presupuesto diario se reseteaba a las 20:00/21:00 de
// Chile y un agente diario nocturno podía correr dos veces o saltarse.
const { dayKey, hhmm } = require('../utils/time');

function todayKey(now) {
  return dayKey(now);
}

function localHHMM(now) {
  return hhmm(now);
}

class AgentScheduler {
  constructor({ store, conversationRuntime, eventBus, usageMeter, intervalMs = 60_000 }) {
    this.store = store;
    this.conversationRuntime = conversationRuntime;
    this.eventBus = eventBus;
    this.usageMeter = usageMeter || null;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = new Set();
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
    const schedule = agent.schedule || { type: 'manual' };
    if (schedule.type === 'manual') return false;

    const runsToday = agent.runsTodayDate === todayKey(now) ? agent.runsToday : 0;
    if (runsToday >= agent.maxRunsPerDay) return false;

    if (agent.maxCostPerDayUsd != null) {
      const costToday = agent.costTodayDate === todayKey(now) ? agent.costToday : 0;
      if (costToday >= agent.maxCostPerDayUsd) return false;
    }

    if (schedule.type === 'daily') {
      const alreadyToday = agent.lastRunAt && agent.lastRunAt.slice(0, 10) === todayKey(now);
      return !alreadyToday && localHHMM(now) >= schedule.at;
    }
    if (schedule.type === 'interval') {
      if (!agent.lastRunAt) return true;
      const elapsedMin = (now.getTime() - new Date(agent.lastRunAt).getTime()) / 60_000;
      return elapsedMin >= Number(schedule.minutes);
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

  async runAgent(agentOrId, { trigger = 'manual' } = {}) {
    const agent = typeof agentOrId === 'string' ? this.store.get(agentOrId) : agentOrId;
    if (!agent) throw new Error(`AGENT_NOT_FOUND: ${agentOrId}`);
    if (this.running.has(agent.id)) throw new Error(`AGENT_ALREADY_RUNNING: ${agent.name}`);

    this.running.add(agent.id);
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
      const task = await this.conversationRuntime.handleMessage({
        text: `[Corrida automática del agente "${agent.name}". Esta es UNA ejecución de su misión: hazla AHORA con las herramientas disponibles y reporta el resultado. La recurrencia ya está programada — no crees, modifiques ni programes agentes.] Misión: ${agent.goal}`,
        channel: 'agent'
      });
      const result = {
        status: task.status,
        speak: task.result?.speak || '',
        at: now.toISOString(),
        trigger
      };
      this.recordRunCost(agent, costBefore, now);
      this.store.update(agent.id, { lastResult: result });
      this.eventBus?.emit('agent_run_completed', { agentId: agent.id, name: agent.name, ...result });
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
    this.store.update(agent.id, {
      costToday: (sameDay ? agent.costToday : 0) + runCostUsd,
      costTodayDate: todayKey(now)
    });
  }
}

module.exports = {
  AgentScheduler
};
