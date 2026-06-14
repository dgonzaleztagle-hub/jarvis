const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentStore } = require('../src/agents/agent-store');
const { AgentScheduler } = require('../src/agents/agent-scheduler');
const { UsageMeter } = require('../src/model/usage-meter');

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
