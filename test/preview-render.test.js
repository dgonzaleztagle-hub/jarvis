const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/app-runtime');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

test('preview.render_html materializa el HTML y emite evento para el HUD', async () => {
  const dataDir = tempDataDir();
  const runtime = createRuntime({ dataDir, agents: { autoStart: false } });

  // El eventBus envuelve el payload en { type, payload, ... }; el front lee
  // event.payload (igual que inbox-viewer / preview-panel).
  let emitted = null;
  runtime.eventBus.on('hud_show_preview', (event) => { emitted = event.payload; });

  const tool = runtime.toolRegistry.get('preview.render_html');
  assert.ok(tool, 'la tool debe estar registrada');

  const res = await tool.execute({ html: '<h1>Hola</h1>', title: 'Demo' });
  assert.equal(res.ok, true);
  assert.match(res.url, /^\/preview\/preview_.*\.html$/);
  assert.equal(res.title, 'Demo');

  // El archivo quedó escrito en disco con el contenido.
  const fileName = res.url.replace('/preview/', '');
  const onDisk = fs.readFileSync(path.join(dataDir, 'previews', fileName), 'utf-8');
  assert.equal(onDisk, '<h1>Hola</h1>');

  // Se emitió el evento que el HUD escucha.
  assert.ok(emitted);
  assert.equal(emitted.url, res.url);
});

test('preview.render_html rechaza HTML vacío', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  const res = await runtime.toolRegistry.get('preview.render_html').execute({ html: '   ' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'HTML_REQUIRED');
});
