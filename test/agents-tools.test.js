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
