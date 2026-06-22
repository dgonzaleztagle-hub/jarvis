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

  // El archivo quedó escrito en disco con el contenido, y se inyectó el runtime
  // de Tailwind (bundle local) para que el preview salga con estilos.
  const fileName = res.url.replace('/preview/', '');
  const onDisk = fs.readFileSync(path.join(dataDir, 'previews', fileName), 'utf-8');
  assert.match(onDisk, /<h1>Hola<\/h1>/);
  assert.match(onDisk, /vendor\/tailwind\.js/, 'todo preview debe inyectar el runtime local de Tailwind');

  // Se emitió el evento que el HUD escucha.
  assert.ok(emitted);
  assert.equal(emitted.url, res.url);
});

test('preview.render_html borra CDN de Tailwind y Google Fonts si el modelo los agrega de mas', async () => {
  const dataDir = tempDataDir();
  const runtime = createRuntime({ dataDir, agents: { autoStart: false } });
  const tool = runtime.toolRegistry.get('preview.render_html');

  const dirtyHtml = `<!doctype html><html><head>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
    <style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display');</style>
  </head><body><h1>Clinica</h1></body></html>`;

  const res = await tool.execute({ html: dirtyHtml, title: 'Demo' });
  assert.equal(res.ok, true);
  const onDisk = fs.readFileSync(path.join(dataDir, 'previews', res.url.replace('/preview/', '')), 'utf-8');

  // Las dependencias externas (rompen el offline-first del white-label) deben
  // desaparecer, sin importar si el modelo las agrego pese a la instruccion.
  assert.doesNotMatch(onDisk, /cdn\.tailwindcss\.com/);
  assert.doesNotMatch(onDisk, /fonts\.googleapis\.com/);
  // El runtime local SI debe seguir presente.
  assert.match(onDisk, /vendor\/tailwind\.js/);
  assert.match(onDisk, /vendor\/fonts\.css/);
  assert.match(onDisk, /<h1>Clinica<\/h1>/);
});

test('preview.render_html rechaza sin html ni brief', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  const res = await runtime.toolRegistry.get('preview.render_html').execute({ html: '   ' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'BRIEF_OR_HTML_REQUIRED');
});

test('preview.render_html genera el HTML desde un brief con el modelo activo', async () => {
  const fakeProvider = {
    generateText: async () => ({ text: '```html\n<!doctype html><html><body><h1>Rishtedar</h1></body></html>\n```' })
  };
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    agents: { autoStart: false },
    model: { provider: fakeProvider }
  });
  const res = await runtime.toolRegistry.get('preview.render_html').execute({ brief: 'landing para Rishtedar', title: 'Landing' });
  assert.equal(res.ok, true);
  assert.match(res.url, /^\/preview\/preview_.*\.html$/);
  // El HTML generado quedó limpio (sin fences markdown) y materializado.
  const fs = require('fs');
  const path = require('path');
  const onDisk = fs.readFileSync(path.join(runtime.dataDir, 'previews', res.url.replace('/preview/', '')), 'utf-8');
  assert.match(onDisk, /^<!doctype html>/);
  assert.doesNotMatch(onDisk, /```/);
});
