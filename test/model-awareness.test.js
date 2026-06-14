const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/app-runtime');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

test('la elección de modelo persiste entre reinicios (mismo dataDir)', () => {
  const dataDir = tempDataDir();
  const r1 = createRuntime({ dataDir, agents: { autoStart: false } });
  assert.equal(r1.getActiveModel().id, 'claude-haiku-4-5'); // default dev
  r1.setActiveModel('claude-sonnet-4-6');
  assert.ok(fs.existsSync(path.join(dataDir, 'model-preference.json')));

  // Nuevo runtime sobre el mismo dataDir: debe arrancar en Sonnet, no en Haiku.
  const r2 = createRuntime({ dataDir, agents: { autoStart: false } });
  assert.equal(r2.getActiveModel().id, 'claude-sonnet-4-6');
});

test('el system prompt incluye el modelo activo y la recomendación cuando el tier es bajo', () => {
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  // Haiku (tier económico, rank 1 < 2) → incluye recomendación.
  const promptHaiku = runtime.conversationRuntime.buildSystemPrompt()[0].text;
  assert.match(promptHaiku, /MODELO ACTUAL/);
  assert.match(promptHaiku, /Claude Haiku 4\.5/);
  assert.match(promptHaiku, /RECOMENDACIÓN HONESTA/);
  assert.match(promptHaiku, /Sonnet 4\.6/);

  // Tras subir a Sonnet (tier fuerte, rank 2) → ya no recomienda subir.
  runtime.setActiveModel('claude-sonnet-4-6');
  const promptSonnet = runtime.conversationRuntime.buildSystemPrompt()[0].text;
  assert.match(promptSonnet, /Claude Sonnet 4\.6/);
  assert.doesNotMatch(promptSonnet, /RECOMENDACIÓN HONESTA/);
});
