const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentStore } = require('../src/agents/agent-store');
const { AgentScheduler } = require('../src/agents/agent-scheduler');
const { UsageMeter } = require('../src/model/usage-meter');
const { BudgetConfig } = require('../src/agents/budget-config');
const { AuditTrail } = require('../src/security/audit-trail');

function fakeEventBus() {
  const events = [];
  return { emit: (type, payload) => events.push({ type, payload }), events };
}

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

// conversationRuntime falso: cada handleMessage "gasta" costUsd en el usage
// meter, simulando lo que harían las llamadas reales al modelo.
function fakeRuntime(usageMeter, costUsd) {
  return {
    handleMessage: async () => {
      usageMeter.record({ provider: 'fake', model: 'fake-model', costUsd });
      return { status: 'completed', result: { speak: 'listo' } };
    }
  };
}

test('maxCostPerDayUsd: corte automático cuando el gasto del día lo cruza, aunque queden corridas/día', async () => {
  // Reloj congelado a mediodía: runAgent estampa el costo con `new Date()`
  // interno, y el test mira `now + 1h`. Si el test corre cerca de medianoche
  // (Chile), ese +1h cruza de día y el presupuesto diario se resetea (correcto
  // en producción: hay un test aparte para eso) — lo que hacía fallar ESTE test
  // de forma espuria entre las 23:00 y 00:00. Congelando el reloj el día es
  // estable y la prueba aísla de verdad el corte por costo.
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00-04:00').getTime() });
  try {
    const dataDir = tempDataDir();
    const usageMeter = new UsageMeter({ dataDir });
    const store = new AgentStore({ dataDir });
    const runtime = fakeRuntime(usageMeter, 0.10);
    const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: { emit() {} }, usageMeter });

    const agent = store.create({
      name: 'Vigia con presupuesto',
      goal: 'Revisar algo',
      schedule: { type: 'interval', minutes: 5 },
      maxRunsPerDay: 10,
      maxCostPerDayUsd: 0.15
    });

    // Punto en el futuro: lejos de lastRunAt para que el intervalo (5 min) ya
    // haya pasado y shouldRun no quede bloqueado por eso, solo por el costo.
    // Mismo día que la corrida (reloj congelado), así no se resetea el costo.
    const future = new Date(Date.now() + 60 * 60 * 1000);

    // Primera corrida: gasta 0.10 de 0.15 — queda margen, sigue corriendo.
    await scheduler.runAgent(agent.id);
    let updated = store.get(agent.id);
    assert.ok(Math.abs(updated.costToday - 0.10) < 1e-9);
    assert.equal(scheduler.shouldRun(updated, future), true);

    // Segunda corrida: gasta otros 0.10 → acumulado 0.20 >= 0.15.
    await scheduler.runAgent(agent.id);
    updated = store.get(agent.id);
    assert.ok(updated.costToday >= 0.15);
    assert.equal(updated.runsToday < updated.maxRunsPerDay, true); // quedan corridas/día
    assert.equal(scheduler.shouldRun(updated, future), false); // pero el corte de costo lo detiene
  } finally {
    mock.timers.reset();
  }
});

test('sin maxCostPerDayUsd, el gasto no limita las corridas (solo maxRunsPerDay)', async () => {
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const runtime = fakeRuntime(usageMeter, 5); // gasto grande, no debería importar
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: { emit() {} }, usageMeter });

  const agent = store.create({
    name: 'Vigia sin presupuesto',
    goal: 'Revisar algo',
    schedule: { type: 'interval', minutes: 5 },
    maxRunsPerDay: 10
  });
  assert.equal(agent.maxCostPerDayUsd, null);

  await scheduler.runAgent(agent.id);
  const updated = store.get(agent.id);
  assert.ok(updated.costToday >= 5); // se registra igual, para visibilidad
  const future = new Date(Date.now() + 60 * 60 * 1000);
  assert.equal(scheduler.shouldRun(updated, future), true);
});

test('costToday se resetea al cambiar de día', async () => {
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const runtime = fakeRuntime(usageMeter, 0.20);
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: { emit() {} }, usageMeter });

  const agent = store.create({
    name: 'Vigia de un dia',
    goal: 'Revisar algo',
    schedule: { type: 'interval', minutes: 5 },
    maxRunsPerDay: 10,
    maxCostPerDayUsd: 0.15
  });

  await scheduler.runAgent(agent.id);
  let updated = store.get(agent.id);
  assert.ok(updated.costToday >= 0.15);

  // Simula que la fecha guardada quedó "ayer": un nuevo "now" de mañana debe
  // tratar el gasto acumulado como 0 para el cupo de hoy.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  assert.equal(scheduler.shouldRun(updated, tomorrow), true);
});

test('tope diario GLOBAL bloquea a TODOS los agentes aunque les quede cupo individual', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00-04:00').getTime() });
  try {
    const dataDir = tempDataDir();
    const usageMeter = new UsageMeter({ dataDir });
    const store = new AgentStore({ dataDir });
    const budgetConfig = new BudgetConfig({ dataDir });
    budgetConfig.setGlobalDailyCap(0.05);
    const runtime = fakeRuntime(usageMeter, 0.10); // ya cruza el tope global en una corrida
    const bus = fakeEventBus();
    const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter, budgetConfig });

    const agentA = store.create({ name: 'Agente A', goal: 'x', schedule: { type: 'interval', minutes: 5 }, maxRunsPerDay: 10 });
    const agentB = store.create({ name: 'Agente B', goal: 'y', schedule: { type: 'interval', minutes: 5 }, maxRunsPerDay: 10 });

    await scheduler.runAgent(agentA.id); // gasta 0.10, ya >= 0.05 global

    const future = new Date(Date.now() + 60 * 60 * 1000);
    assert.equal(scheduler.shouldRun(store.get(agentB.id), future), false, 'agente B nunca corrió, pero el tope global ya lo bloquea');
    await assert.rejects(() => scheduler.runAgent(agentB.id), /GLOBAL_DAILY_BUDGET_EXCEEDED/);
  } finally {
    mock.timers.reset();
  }
});

test('agent_budget_warning se emite al 80% del tope por-agente, una sola vez por dia', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00-04:00').getTime() });
  try {
    const dataDir = tempDataDir();
    const usageMeter = new UsageMeter({ dataDir });
    const store = new AgentStore({ dataDir });
    const runtime = fakeRuntime(usageMeter, 0.09); // 90% de 0.10 en una sola corrida
    const bus = fakeEventBus();
    const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter });

    const agent = store.create({ name: 'Agente con aviso', goal: 'x', schedule: { type: 'manual' }, maxRunsPerDay: 10, maxCostPerDayUsd: 0.10 });

    await scheduler.runAgent(agent.id);
    const warnings = bus.events.filter((e) => e.type === 'agent_budget_warning' && e.payload.scope === 'agent');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].payload.agentId, agent.id);

    // Otra corrida el mismo día: no se repite el aviso.
    await scheduler.runAgent(agent.id);
    const warningsAfter = bus.events.filter((e) => e.type === 'agent_budget_warning' && e.payload.scope === 'agent');
    assert.equal(warningsAfter.length, 1, 'no debe repetir el aviso el mismo dia');
  } finally {
    mock.timers.reset();
  }
});

test('runAgent reporta needs_approval (no completed) si la corrida dejo una tool en confirmation_required', async () => {
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const auditTrail = new AuditTrail({ dataDir });
  const bus = fakeEventBus();

  // Runtime falso: simula que el modelo intento wa.send_message y quedo en
  // confirmation_required (igual que el caso real: agente desatendido sin
  // nadie para confirmar). El audit real queda escrito, como en produccion.
  const runtime = {
    handleMessage: async () => {
      auditTrail.record({ tool: 'wa.send_message', risk: 'high', outcome: 'confirmation_required', channel: 'agent' });
      return { status: 'completed', result: { speak: 'Necesito tu confirmación antes de ejecutar esta acción.' } };
    }
  };
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter, auditTrail });

  const agent = store.create({ name: 'Agente con confirmacion pendiente', goal: 'avisar por whatsapp', schedule: { type: 'manual' } });
  const result = await scheduler.runAgent(agent.id, { trigger: 'validation' });

  assert.equal(result.status, 'needs_approval');
  assert.deepEqual(result.pendingTools, ['wa.send_message']);

  const approvalEvents = bus.events.filter((e) => e.type === 'agent_run_needs_approval');
  assert.equal(approvalEvents.length, 1, 'debe emitir agent_run_needs_approval, no agent_run_completed');
  const completedEvents = bus.events.filter((e) => e.type === 'agent_run_completed');
  assert.equal(completedEvents.length, 0, 'NO debe reportarse como completada — nadie confirmo nada');
});

test('runAgent reporta needs_input (no completed) si el speak termina en pregunta sin tool de confirmacion de por medio', async () => {
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const bus = fakeEventBus();

  // Caso real encontrado: el agente quedo "completed" pero el speak era una
  // pregunta por un dato faltante (telefono) que nadie iba a contestar en una
  // corrida desatendida — el panel lo mostraba como si nada hubiera pasado.
  const runtime = {
    handleMessage: async () => ({
      status: 'completed',
      result: { speak: 'No encontré tu número de WhatsApp guardado. ¿Me das tu teléfono?' }
    })
  };
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter });

  const agent = store.create({ name: 'Agente con pregunta pendiente', goal: 'avisar por whatsapp', schedule: { type: 'manual' } });
  const result = await scheduler.runAgent(agent.id, { trigger: 'schedule' });

  assert.equal(result.status, 'needs_input');
  const inputEvents = bus.events.filter((e) => e.type === 'agent_run_needs_input');
  assert.equal(inputEvents.length, 1, 'debe emitir agent_run_needs_input, no agent_run_completed');
  const completedEvents = bus.events.filter((e) => e.type === 'agent_run_completed');
  assert.equal(completedEvents.length, 0, 'NO debe reportarse como completada — quedo una pregunta sin responder');
});

test('runAgent: una respuesta a la pregunta pendiente se inyecta como contexto de esa corrida puntual', async () => {
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const bus = fakeEventBus();

  let lastText = null;
  const runtime = {
    handleMessage: async ({ text }) => {
      lastText = text;
      return { status: 'completed', result: { speak: 'Listo, mensaje enviado.' } };
    }
  };
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter });

  const agent = store.create({ name: 'Agente respondido', goal: 'avisar por whatsapp', schedule: { type: 'manual' } });
  store.update(agent.id, { lastResult: { status: 'needs_input', speak: '¿Me das tu teléfono?' } });

  const result = await scheduler.runAgent(agent.id, { trigger: 'manual', answerToLastQuestion: '+56912345678' });

  assert.equal(result.status, 'completed');
  assert.match(lastText, /\+56912345678/);
});

test('runAgent marca deliveredViaOutbound cuando una tool outbound (ej wa.send_message) corrio completed en la corrida', async () => {
  // Caso real: agente cuya mision es mandar un WhatsApp. Si ya entrego el
  // mensaje por ese canal, una notificacion aparte por Telegram diciendo "tu
  // agente corrio" es un segundo aviso del mismo hecho — ruido.
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const bus = fakeEventBus();
  const fakeToolRegistry = {
    get: (name) => (name === 'wa.send_message' ? { outbound: true } : { outbound: false })
  };
  const runtime = {
    handleMessage: async () => ({
      status: 'completed',
      result: {
        speak: 'Listo, mensaje enviado.',
        toolResults: [{ toolName: 'wa.send_message', status: 'completed' }]
      }
    })
  };
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter, toolRegistry: fakeToolRegistry });

  const agent = store.create({ name: 'Agente que ya avisa por wsp', goal: 'avisar por whatsapp', schedule: { type: 'manual' } });
  const result = await scheduler.runAgent(agent.id, { trigger: 'schedule' });

  assert.equal(result.deliveredViaOutbound, true);
  const completedEvents = bus.events.filter((e) => e.type === 'agent_run_completed');
  assert.equal(completedEvents[0].payload.deliveredViaOutbound, true);
});

test('runAgent NO marca deliveredViaOutbound si ninguna tool outbound corrio (ej: agente que solo leyo/analizo algo en silencio)', async () => {
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const bus = fakeEventBus();
  const fakeToolRegistry = { get: () => ({ outbound: false }) };
  const runtime = {
    handleMessage: async () => ({
      status: 'completed',
      result: {
        speak: 'Revisé tus correos, nada urgente.',
        toolResults: [{ toolName: 'google.gmail.list_emails', status: 'completed' }]
      }
    })
  };
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter, toolRegistry: fakeToolRegistry });

  const agent = store.create({ name: 'Agente silencioso', goal: 'revisar correos', schedule: { type: 'manual' } });
  const result = await scheduler.runAgent(agent.id, { trigger: 'schedule' });

  assert.equal(result.deliveredViaOutbound, false);
});

test('runAgent emite agent_run_started al arrancar, antes de que termine la corrida', async () => {
  // El HUD necesita saber que el agente EMPEZÓ a trabajar en el momento real,
  // no enterarse recién cuando termina (eso ya lo cubrían los eventos
  // agent_run_completed/failed/needs_*) — para el pulso de "trabajando".
  const dataDir = tempDataDir();
  const usageMeter = new UsageMeter({ dataDir });
  const store = new AgentStore({ dataDir });
  const bus = fakeEventBus();
  let sawStartedBeforeHandle = false;
  const runtime = {
    handleMessage: async () => {
      sawStartedBeforeHandle = bus.events.some((e) => e.type === 'agent_run_started');
      return { status: 'completed', result: { speak: 'listo' } };
    }
  };
  const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter });

  const agent = store.create({ name: 'Agente con started', goal: 'x', schedule: { type: 'manual' } });
  await scheduler.runAgent(agent.id);

  assert.equal(sawStartedBeforeHandle, true);
  const started = bus.events.filter((e) => e.type === 'agent_run_started');
  assert.equal(started.length, 1);
  assert.equal(started[0].payload.agentId, agent.id);
});

test('agent_budget_warning global se emite al 80% del tope global', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00-04:00').getTime() });
  try {
    const dataDir = tempDataDir();
    const usageMeter = new UsageMeter({ dataDir });
    const store = new AgentStore({ dataDir });
    const budgetConfig = new BudgetConfig({ dataDir });
    budgetConfig.setGlobalDailyCap(1.0);
    const runtime = fakeRuntime(usageMeter, 0.85);
    const bus = fakeEventBus();
    const scheduler = new AgentScheduler({ store, conversationRuntime: runtime, eventBus: bus, usageMeter, budgetConfig });

    const agent = store.create({ name: 'Agente global', goal: 'x', schedule: { type: 'manual' }, maxRunsPerDay: 10 });
    await scheduler.runAgent(agent.id);

    const warnings = bus.events.filter((e) => e.type === 'agent_budget_warning' && e.payload.scope === 'global');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].payload.spent >= 0.8);
  } finally {
    mock.timers.reset();
  }
});
