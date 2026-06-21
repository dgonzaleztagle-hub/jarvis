const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/app-runtime');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-specialist-'));
}

function capturingProvider(captured) {
  return {
    generateJson: async ({ messages, purpose }) => {
      captured.push({ purpose, messages });
      return {
        model: 'fake',
        data: {
          speak: 'Listo.',
          visual: '',
          format: 'brief',
          toolCalls: []
        }
      };
    }
  };
}

test('turno de diseno activa Alex e inyecta contexto especialista solo en el mensaje dinamico', async () => {
  const captured = [];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    whatsapp: { autoStart: false },
    model: { provider: capturingProvider(captured) }
  });

  const events = [];
  runtime.eventBus.on('specialist_active', (event) => events.push(event.payload));

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'crea una landing premium para una clinica dental',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'design');
  assert.equal(events[0].specialist, 'Alex');

  const decision = captured.find((call) => call.purpose === 'conversation_decision');
  const userText = decision.messages.at(-1).parts[0].text;
  assert.match(userText, /\[Especialista del turno: Alex \(Diseño\)\]/);
  assert.match(userText, /Awwwards/);

  const systemText = runtime.conversationRuntime.buildSystemPrompt()[0].text;
  assert.doesNotMatch(systemText, /\[Especialista del turno:/);
});

test('turno de marketing activa Mara y un turno generico no activa especialista', async () => {
  const captured = [];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    whatsapp: { autoStart: false },
    model: { provider: capturingProvider(captured) }
  });

  const events = [];
  runtime.eventBus.on('specialist_active', (event) => events.push(event.payload));

  await runtime.conversationRuntime.handleMessage({
    text: 'armemos una campana para instagram de un restaurante',
    channel: 'test'
  });
  await runtime.conversationRuntime.handleMessage({
    text: 'que hora es',
    channel: 'test'
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'marketing');
  assert.equal(events[0].specialist, 'Mara');

  const marketingDecision = captured.find((call) => {
    const text = call.messages?.at(-1)?.parts?.[0]?.text || '';
    return /campana para instagram/.test(text);
  });
  assert.match(marketingDecision.messages.at(-1).parts[0].text, /\[Especialista del turno: Mara \(Marketing\)\]/);
});
