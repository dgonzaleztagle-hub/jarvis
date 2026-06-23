const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/app-runtime');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-specialist-'));
}

// Qué especialista aplica (si alguno) lo declara el MODELO en su propio JSON
// de decisión (campo "specialist") — no un regex de palabras clave por módulo
// (eso se intentó y se revirtió: ver feedback_hardcode_vs_llm_judgment). Los
// fakes de estos tests simulan esa declaración directamente, como lo haría
// el modelo real con su propio criterio de lenguaje.
function capturingProvider(captured, { specialist = null, segments = null } = {}) {
  return {
    generateJson: async ({ messages, system, purpose }) => {
      captured.push({ purpose, messages, system });
      return {
        model: 'fake',
        data: { speak: segments ? '' : 'Listo.', visual: '', format: 'brief', toolCalls: [], specialist, segments }
      };
    }
  };
}

// Provider que pide UNA tool en la decisión inicial (declarando el
// especialista ahí) y cierra en la ronda de continuación — para probar que el
// override de voz llega tambien a ESA segunda llamada
// (buildToolContinuationPrompt/buildFinalResponsePrompt), no solo a la decision inicial.
function toolThenCloseProvider(captured, toolName, specialist) {
  let round = 0;
  return {
    generateJson: async ({ messages, system, purpose }) => {
      captured.push({ purpose, messages, system });
      round += 1;
      if (round === 1) {
        return { model: 'fake', data: { speak: '', visual: '', toolCalls: [{ toolName, input: {} }], specialist } };
      }
      return { model: 'fake', data: { speak: 'Listo, ya lo revisé.', visual: '', format: 'brief', toolCalls: [] } };
    }
  };
}

test('el modelo declara "specialist": design y activa a Alex con su voz', async () => {
  const captured = [];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    whatsapp: { autoStart: false },
    model: { provider: capturingProvider(captured, { specialist: 'design' }) }
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
  // El HUD necesita esto para que la respuesta hablada use la voz de Alex,
  // no la de Jarvis ("pásame a Mara" debe sonar a alguien distinto).
  assert.equal(events[0].voiceProfile, 'alex_voice');

  // El roster completo (con la identidad/expertise de los 3 especialistas) va
  // SIEMPRE en el system prompt estable/cacheado — no se inyecta por turno
  // según regex, y no depende de qué especialista se haya declarado.
  const systemText = runtime.conversationRuntime.buildSystemPrompt()[0].text;
  assert.match(systemText, /Alex \(Diseño\)/);
  assert.match(systemText, /Awwwards/);
  assert.match(systemText, /Mara \(Marketing\)/);
  assert.match(systemText, /Teo \(SEO\)/);
  assert.match(systemText, /"specialist"/);
});

test('el cambio de voz del especialista sobrevive al cierre tras usar tools (no solo a la decision inicial)', async () => {
  // Bug real encontrado en vivo: un audit SEO de Teo salia con tono neutro de
  // Jarvis porque buildFinalResponsePrompt/buildToolContinuationPrompt (el
  // cierre tras correr tools) decian literalmente "Eres Jarvis Codex...
  // Mantén tu carácter", pisando el override de la decision inicial.
  const captured = [];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    whatsapp: { autoStart: false },
    model: { provider: toolThenCloseProvider(captured, 'fake.seo_check', 'seo') }
  });
  runtime.toolRegistry.register({ name: 'fake.seo_check', risk: 'low', execute: async () => ({ ok: true }) });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'hazme una auditoria SEO de mi sitio',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  // Ronda 2: el system prompt es el de buildToolContinuationPrompt/
  // buildFinalResponsePrompt, no el de la decision inicial.
  const closingCall = captured.find((c) => c.purpose === 'tool_continuation' || c.purpose === 'final_response');
  assert.ok(closingCall, 'debe haber una llamada de cierre tras la tool');
  const closingSystemText = closingCall.system.map((b) => b.text).join('\n');
  assert.match(closingSystemText, /CAMBIO DE VOZ PARA ESTE TURNO/);
  assert.match(closingSystemText, /PRIMERA PERSONA como Teo/);
});

test('si el modelo no declara especialista, no se activa ninguno', async () => {
  const captured = [];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    whatsapp: { autoStart: false },
    model: { provider: capturingProvider(captured, { specialist: null }) }
  });

  const events = [];
  runtime.eventBus.on('specialist_active', (event) => events.push(event.payload));

  await runtime.conversationRuntime.handleMessage({ text: 'que hora es', channel: 'test' });

  assert.equal(events.length, 0);
});

test('mencionar al especialista por nombre sin pedir tarea de su dominio también lo activa, porque el modelo lo declara con su propio criterio', async () => {
  const captured = [];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    whatsapp: { autoStart: false },
    model: { provider: capturingProvider(captured, { specialist: 'marketing' }) }
  });

  const events = [];
  runtime.eventBus.on('specialist_active', (event) => events.push(event.payload));

  await runtime.conversationRuntime.handleMessage({ text: 'quien es mara?', channel: 'test' });

  assert.equal(events.length, 1);
  assert.equal(events[0].specialist, 'Mara');
});

test('"que se presenten todos" entrega segments resueltos con voz de cada especialista, no una promesa vacía', async () => {
  // Bug real encontrado en vivo: sin "segments", el modelo solo podía declarar
  // UN especialista por turno y respondía "Claro, que hablen ellos" sin que
  // nadie hablara — una promesa de algo que el turno nunca entregaba.
  const captured = [];
  const segments = [
    { specialist: 'marketing', text: 'Soy Mara.' },
    { specialist: 'design', text: 'Soy Alex.' },
    { specialist: 'seo', text: 'Soy Teo.' }
  ];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    whatsapp: { autoStart: false },
    model: { provider: capturingProvider(captured, { segments }) }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'que se presenten todos los especialistas',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.equal(task.result.segments.length, 3);
  assert.deepEqual(task.result.segments.map((s) => s.specialistName), ['Mara', 'Alex', 'Teo']);
  assert.deepEqual(task.result.segments.map((s) => s.voiceProfile), ['mara_voice', 'alex_voice', 'teo_voice']);
  // speak (voz/canales sin pantalla) va plano, sin markdown ni separación.
  assert.match(task.result.speak, /Soy Mara\.\s*Soy Alex\.\s*Soy Teo\./);
  // visual (pantalla) SÍ separa por especialista — si no, en pantalla se ve
  // un solo párrafo corrido sin saber quién dice qué (bug real reportado).
  assert.match(task.result.visual, /\*\*Mara:\*\* Soy Mara\.\n\n\*\*Alex:\*\* Soy Alex\.\n\n\*\*Teo:\*\* Soy Teo\./);
});
