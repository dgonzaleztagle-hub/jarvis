const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeTask } = require('../src/agents/task-executor');
const { ToolRegistry } = require('../src/core/tool-registry');
const { PolicyEngine } = require('../src/core/policy-engine');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

// modelProvider falso: entrega respuestas de generateJson desde una cola.
function fakeModel(queue) {
  const q = [...queue];
  return { generateJson: async () => ({ model: 'fake', data: q.shift() || {} }) };
}

function registryWith(tools) {
  const registry = new ToolRegistry({ policyEngine: new PolicyEngine() });
  for (const t of tools) registry.register(t);
  return registry;
}

test('planifica y ejecuta pasos encadenados hasta completar', async () => {
  const calls = [];
  const registry = registryWith([
    { name: 'a.uno', risk: 'low', execute: async (i) => { calls.push(['a.uno', i]); return { v: 1 }; } },
    { name: 'a.dos', risk: 'low', execute: async (i) => { calls.push(['a.dos', i]); return { v: 2 }; } }
  ]);
  const model = fakeModel([
    { feasible: true, steps: [
      { n: 1, description: 'paso uno', tool: 'a.uno', input: { x: 1 } },
      { n: 2, description: 'paso dos', tool: 'a.dos', input: { y: 2 } }
    ] }
  ]);

  const res = await executeTask({ goal: 'hacer dos cosas', modelProvider: model, toolRegistry: registry });
  assert.equal(res.status, 'completed');
  assert.equal(res.completedCount, 2);
  assert.equal(calls.length, 2);
  assert.equal(res.steps[0].status, 'ok');
});

test('infeasible cuando el plan no es factible', async () => {
  const registry = registryWith([{ name: 'x', risk: 'low', execute: async () => 'ok' }]);
  const model = fakeModel([{ feasible: false, missing: 'falta un conector de Spotify' }]);
  const res = await executeTask({ goal: 'reproducir en spotify', modelProvider: model, toolRegistry: registry });
  assert.equal(res.status, 'infeasible');
  assert.match(res.missing, /Spotify/);
});

test('auto-fix repara un paso que falla y continúa', async () => {
  let attempts = 0;
  const registry = registryWith([
    { name: 'flaky', risk: 'low', execute: async (i) => {
      attempts += 1;
      if (i.bad) throw new Error('input malo');
      return 'ok';
    } }
  ]);
  const model = fakeModel([
    { feasible: true, steps: [{ n: 1, description: 'intenta', tool: 'flaky', input: { bad: true } }] },
    { fixable: true, tool: 'flaky', input: { bad: false } } // autoFixStep
  ]);

  const res = await executeTask({ goal: 'tarea con fallo', modelProvider: model, toolRegistry: registry });
  assert.equal(res.status, 'completed');
  assert.equal(res.steps[0].repaired, true);
  assert.equal(attempts, 2);
});

test('se detiene y marca needs_approval ante un paso de alto riesgo', async () => {
  const registry = new ToolRegistry({ policyEngine: new PolicyEngine() });
  registry.register({ name: 'safe', risk: 'low', execute: async () => 'ok' });
  registry.register({ name: 'risky', risk: 'critical', execute: async () => 'no deberia correr' });
  const model = fakeModel([
    { feasible: true, steps: [
      { n: 1, description: 'paso seguro', tool: 'safe', input: {} },
      { n: 2, description: 'paso riesgoso', tool: 'risky', input: {} }
    ] }
  ]);

  const res = await executeTask({ goal: 'algo con riesgo', modelProvider: model, toolRegistry: registry });
  assert.equal(res.status, 'paused_for_approval');
  assert.equal(res.steps[1].status, 'needs_approval');
});

test('falla si el plan referencia una tool inexistente', async () => {
  const registry = registryWith([{ name: 'real', risk: 'low', execute: async () => 'ok' }]);
  const model = fakeModel([
    { feasible: true, steps: [{ n: 1, description: 'usa fantasma', tool: 'no.existe', input: {} }] }
  ]);
  const res = await executeTask({ goal: 'x', modelProvider: model, toolRegistry: registry });
  assert.equal(res.status, 'failed');
  assert.equal(res.steps[0].status, 'unknown_tool');
});

test('la tool tasks.run_autonomous queda registrada y anti-recursión activa', () => {
  const { createRuntime } = require('../src/app-runtime');
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  assert.ok(runtime.toolRegistry.list().some((t) => t.name === 'tasks.run_autonomous'));
  const tool = runtime.toolRegistry.get('tasks.run_autonomous');
  const policy = runtime.policyEngine.evaluate(tool, {}, { inAutonomousTask: true });
  assert.equal(policy.allowed, false);
});
