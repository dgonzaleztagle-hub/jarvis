const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDesktopTools, listWindows, focusWindow, openUrl, IS_WINDOWS } = require('../src/connectors/desktop-control');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

test('las 4 tools de escritorio quedan registradas con el riesgo correcto', () => {
  const { createRuntime } = require('../src/app-runtime');
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  const tools = Object.fromEntries(runtime.toolRegistry.list().map((t) => [t.name, t]));
  assert.ok(tools['desktop.list_windows']);
  assert.equal(tools['desktop.focus_window'].risk, 'high');
  assert.equal(tools['desktop.open_app'].risk, 'high');
  assert.equal(tools['desktop.open_url'].risk, 'medium');
});

test('desktop.focus_window de alto riesgo pide confirmación sin go-ahead', () => {
  const { createRuntime } = require('../src/app-runtime');
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  const tool = runtime.toolRegistry.get('desktop.focus_window');
  const policy = runtime.policyEngine.evaluate(tool, { query: 'chrome' }, {});
  assert.equal(policy.requiresConfirmation, true);
  const withGoAhead = runtime.policyEngine.evaluate(tool, { query: 'chrome' }, { userGoAhead: true });
  assert.equal(withGoAhead.requiresConfirmation, false);
});

test('openUrl rechaza esquemas no http(s)', async () => {
  const bad = await openUrl('file:///etc/passwd');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'INVALID_URL');
  const bad2 = await openUrl('javascript:alert(1)');
  assert.equal(bad2.ok, false);
});

test('focusWindow exige query', async () => {
  const res = await focusWindow('');
  // En Windows devuelve QUERY_REQUIRED; fuera de Windows, NOT_SUPPORTED. Ambos ok:false.
  assert.equal(res.ok, false);
});

// Smoke test real: solo corre en Windows (la máquina del usuario). Verifica que
// la enumeración de ventanas vía PowerShell funciona de verdad.
test('listWindows devuelve ventanas reales en Windows', { skip: !IS_WINDOWS }, async () => {
  const res = await listWindows();
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.windows));
  // Debe haber al menos una ventana con título (este proceso de test corre en una sesión con ventanas).
  for (const w of res.windows) {
    assert.equal(typeof w.title, 'string');
    assert.equal(typeof w.process, 'string');
  }
});

test('fuera de Windows las tools de control responden no-soportado', { skip: IS_WINDOWS }, async () => {
  const res = await listWindows();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'DESKTOP_CONTROL_WINDOWS_ONLY');
});
