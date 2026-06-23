const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/app-runtime');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

function fakeModelProvider(data) {
  const queue = Array.isArray(data) ? [...data] : [data];
  return {
    generateJson: async () => ({
      model: 'fake-model',
      data: queue.shift() || data
    })
  };
}

function failingModelProvider(message) {
  return {
    generateJson: async () => {
      throw new Error(message);
    }
  };
}

test('agents.create valida la mision al crear y reporta el resultado', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const tool = runtime.toolRegistry.get('agents.create');
  const result = await tool.execute({
    name: 'Agente de prueba',
    goal: 'Decir hola',
    schedule: { type: 'manual' }
  });

  assert.ok(result.id);
  assert.ok(result.validation);
  assert.equal(result.validation.status, 'completed');
  assert.equal(result.validation.trigger, 'validation');

  const stored = runtime.agentStore.get(result.id);
  assert.equal(stored.lastResult.status, 'completed');
  assert.equal(stored.lastResult.trigger, 'validation');
});

test('agents.create reporta validation fallida cuando la mision no funciona', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: failingModelProvider('boom') }
  });

  const tool = runtime.toolRegistry.get('agents.create');
  const result = await tool.execute({
    name: 'Agente roto',
    goal: 'Visitar un sitio que no existe',
    schedule: { type: 'manual' }
  });

  assert.ok(result.id);
  assert.ok(result.validation);
  assert.equal(result.validation.status, 'failed');
});

test('agents.create es idempotente por nombre y no re-valida', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const tool = runtime.toolRegistry.get('agents.create');
  const first = await tool.execute({
    name: 'Agente unico',
    goal: 'Decir hola',
    schedule: { type: 'manual' }
  });

  const second = await tool.execute({
    name: 'agente unico',
    goal: 'Otra mision distinta',
    schedule: { type: 'manual' }
  });

  assert.equal(second.id, first.id);
  assert.equal(second.alreadyExisted, true);
  assert.equal(second.validation, undefined);
  assert.equal(runtime.agentStore.list().length, 1);
});

test('agents.update_goal corrige la mision de un agente existente', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const createTool = runtime.toolRegistry.get('agents.create');
  const created = await createTool.execute({
    name: 'Agente a corregir',
    goal: 'Visitar bccentral.cl',
    schedule: { type: 'manual' }
  });

  const updateTool = runtime.toolRegistry.get('agents.update_goal');
  const updated = await updateTool.execute({
    agent: created.id,
    goal: 'Visitar bcentral.cl'
  });

  assert.equal(updated.id, created.id);
  assert.equal(runtime.agentStore.get(created.id).goal, 'Visitar bcentral.cl');
});

test('agents.update_goal falla si el agente no existe', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const updateTool = runtime.toolRegistry.get('agents.update_goal');
  await assert.rejects(
    () => updateTool.execute({ agent: 'no-existe', goal: 'nuevo goal' }),
    /AGENT_NOT_FOUND/
  );
});

test('agents.create acepta schedule weekly (dias de semana especificos, no solo daily/interval)', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const tool = runtime.toolRegistry.get('agents.create');
  const result = await tool.execute({
    name: 'Recordatorio semanal',
    goal: 'Avisar el lunes',
    // "cada lunes a las 9" traducido una vez a estructura determinista.
    schedule: { type: 'weekly', daysOfWeek: [1], at: '09:00' }
  });

  assert.equal(result.schedule.type, 'weekly');
  assert.deepEqual(result.schedule.daysOfWeek, [1]);

  // Rechaza weekly sin daysOfWeek en vez de degradar silenciosamente a diario.
  await assert.rejects(
    () => tool.execute({ name: 'Roto', goal: 'x', schedule: { type: 'weekly', at: '09:00' } }),
    /AGENT_DEFINITION_INVALID/
  );
});

test('agent-scheduler shouldRun respeta weekly: solo corre en los dias configurados', () => {
  const { AgentScheduler } = require('../src/agents/agent-scheduler');
  const { AgentStore } = require('../src/agents/agent-store');
  const store = new AgentStore({ dataDir: tempDataDir() });
  const scheduler = new AgentScheduler({ store, conversationRuntime: { handleMessage: async () => ({}) }, eventBus: { emit() {} } });

  const agent = store.create({
    name: 'Agente lunes',
    goal: 'Avisar el lunes',
    schedule: { type: 'weekly', daysOfWeek: [1], at: '09:00' } // 1 = lunes
  });

  // Lunes 2026-06-22, 09:00 en America/Santiago -> corre
  const monday = new Date('2026-06-22T13:00:00.000Z');
  assert.equal(scheduler.shouldRun(agent, monday), true);

  // Martes a la misma hora -> NO corre (no es lunes)
  const tuesday = new Date('2026-06-23T13:00:00.000Z');
  assert.equal(scheduler.shouldRun(agent, tuesday), false);

  // Lunes pero antes de las 09:00 (07:00 en Chile) -> NO corre todavia
  const mondayEarly = new Date('2026-06-22T11:00:00.000Z');
  assert.equal(scheduler.shouldRun(agent, mondayEarly), false);
});

test('agents.update edita schedule/nombre/presupuesto sin tocar el goal', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const createTool = runtime.toolRegistry.get('agents.create');
  const created = await createTool.execute({
    name: 'Agente editable',
    goal: 'Revisar correos',
    schedule: { type: 'daily', at: '09:00' }
  });

  const updateTool = runtime.toolRegistry.get('agents.update');
  const updated = await updateTool.execute({
    agent: created.id,
    schedule: { type: 'weekly', daysOfWeek: [1, 4], at: '10:30' },
    maxRunsPerDay: 2,
    maxCostPerDayUsd: 1.5
  });

  assert.equal(updated.schedule.type, 'weekly');
  assert.deepEqual(updated.schedule.daysOfWeek, [1, 4]);
  assert.equal(updated.maxRunsPerDay, 2);
  assert.equal(updated.maxCostPerDayUsd, 1.5);
  // El goal no debia tocarse - agents.update no edita la mision.
  assert.equal(runtime.agentStore.get(created.id).goal, 'Revisar correos');
});

test('agents.update rechaza un schedule invalido (weekly sin daysOfWeek) sin dejarlo a medio editar', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const createTool = runtime.toolRegistry.get('agents.create');
  const created = await createTool.execute({
    name: 'Agente protegido',
    goal: 'Revisar correos',
    schedule: { type: 'daily', at: '09:00' }
  });

  const updateTool = runtime.toolRegistry.get('agents.update');
  await assert.rejects(
    () => updateTool.execute({ agent: created.id, schedule: { type: 'weekly' } }),
    /AGENT_DEFINITION_INVALID/
  );

  // El schedule original queda intacto: el rechazo no dejo el agente a medias.
  assert.deepEqual(runtime.agentStore.get(created.id).schedule, { type: 'daily', at: '09:00' });
});

test('agent-scheduler shouldRun (daily/weekly): no se re-dispara en la noche de Chile por desincronizar dia UTC vs dia Chile', () => {
  // Bug real: lastRunAt es ISO en UTC. Entre las 20:00 y 23:59 de Chile, el
  // dia UTC ya es "manana" mientras en Chile sigue siendo "hoy" — comparar
  // lastRunAt.slice(0,10) (UTC) contra todayKey(now) (Chile) hacia que
  // "alreadyToday" diera false durante esa ventana y el agente se re-disparara
  // cada tick hasta el tope de maxRunsPerDay. Repro real: "Test Validacion
  // Self QA" mandando WhatsApp cada minuto entre las 22:27 y 22:29 Chile.
  const { AgentScheduler } = require('../src/agents/agent-scheduler');
  const { AgentStore } = require('../src/agents/agent-store');
  const store = new AgentStore({ dataDir: tempDataDir() });
  const scheduler = new AgentScheduler({ store, conversationRuntime: { handleMessage: async () => ({}) }, eventBus: { emit() {} } });

  const daily = store.create({ name: 'Agente diario nocturno', goal: 'avisar', schedule: { type: 'daily', at: '09:00' } });
  // Corrio a las 22:27 hora Chile -> en UTC eso ya es el dia siguiente.
  const ranAt = new Date('2026-06-21T02:27:00.000Z'); // 22:27 Chile del 2026-06-20
  store.update(daily.id, { lastRunAt: ranAt.toISOString() });

  // Un minuto despues, todavia el mismo dia en Chile (22:28 del 2026-06-20).
  const nextTick = new Date('2026-06-21T02:28:00.000Z');
  assert.equal(scheduler.shouldRun(store.get(daily.id), nextTick), false, 'no debe re-dispararse: ya corrio hoy (en Chile)');

  const weekly = store.create({ name: 'Agente semanal nocturno', goal: 'avisar', schedule: { type: 'weekly', daysOfWeek: [6], at: '09:00' } }); // sabado
  store.update(weekly.id, { lastRunAt: ranAt.toISOString() });
  assert.equal(scheduler.shouldRun(store.get(weekly.id), nextTick), false, 'weekly tampoco debe re-dispararse en la misma ventana');
});

test('agents.update falla si el agente no existe', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeModelProvider({ speak: 'listo', toolCalls: [] }) }
  });

  const updateTool = runtime.toolRegistry.get('agents.update');
  await assert.rejects(
    () => updateTool.execute({ agent: 'no-existe', name: 'x' }),
    /AGENT_NOT_FOUND/
  );
});
