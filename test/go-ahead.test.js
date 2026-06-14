const { test } = require('node:test');
const assert = require('node:assert');
const { PolicyEngine } = require('../src/core/policy-engine');
const { ToolRegistry } = require('../src/core/tool-registry');
const { isLiteralDictation } = require('../src/channels/whatsapp-tools');

function makeRegistry() {
  const policyEngine = new PolicyEngine();
  // Misma regla de procedencia que registra app-runtime para WhatsApp
  policyEngine.registerRule(({ tool, input, context }) => {
    if (tool.name !== 'wa.send_message') return null;
    if (isLiteralDictation(input.message, context.userText)) return null;
    return { requiresConfirmation: true, reason: 'compuesto' };
  });
  const registry = new ToolRegistry({ policyEngine, eventBus: { emit() {} } });
  registry.register({ name: 'agents.create', risk: 'high', execute: async () => ({ created: true }) });
  registry.register({ name: 'danger.critical', risk: 'critical', execute: async () => ({ done: true }) });
  registry.register({ name: 'wa.send_message', risk: 'medium', execute: async () => ({ sent: true }) });
  return registry;
}

test('go-ahead del usuario confirma riesgo high en el mismo turno', async () => {
  const registry = makeRegistry();
  const result = await registry.execute('agents.create',
    { name: 'vigia-dolar' },
    { userText: 'me gusta la idea entonces vamos con ello', userGoAhead: true });
  assert.equal(result.ok, true);
});

test('sin go-ahead, riesgo high sigue pidiendo confirmación', async () => {
  const registry = makeRegistry();
  const result = await registry.execute('agents.create',
    { name: 'vigia-dolar' },
    { userText: 'crea un agente que vigile el dolar' });
  assert.equal(result.confirmationRequired, true);
});

test('critical exige confirmación formal aunque haya go-ahead', async () => {
  const registry = makeRegistry();
  const result = await registry.execute('danger.critical', {}, { userGoAhead: true });
  assert.equal(result.confirmationRequired, true);
});

test('anti-recursión: una corrida de agente no puede gestionar agentes', async () => {
  const policyEngine = new PolicyEngine();
  policyEngine.registerRule(({ tool, context }) => {
    if (context.channel === 'agent' && /^agents\./.test(tool.name)) {
      return { allowed: false, reason: 'anti-recursión' };
    }
    return null;
  });
  const registry = new ToolRegistry({ policyEngine, eventBus: { emit() {} } });
  registry.register({ name: 'agents.create', risk: 'high', execute: async () => ({ created: true }) });

  const inRun = await registry.execute('agents.create', { name: 'x' }, { channel: 'agent', userGoAhead: true });
  assert.equal(inRun.blocked, true);

  const fromUser = await registry.execute('agents.create', { name: 'x' }, { channel: 'hud', userGoAhead: true });
  assert.equal(fromUser.ok, true);
});

test('go-ahead NO anula la regla de procedencia: WhatsApp compuesto confirma igual', async () => {
  const registry = makeRegistry();
  const result = await registry.execute('wa.send_message',
    { to: 'Patricio', message: 'Resumen redactado por el modelo...' },
    { userText: 'mandale el resumen, dale', userGoAhead: true });
  assert.equal(result.confirmationRequired, true);
});
