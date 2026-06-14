const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PolicyEngine } = require('../src/core/policy-engine');
const { ToolRegistry } = require('../src/core/tool-registry');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

// --- Nivel policy-engine: la regla de procedencia, aislada ---

test('outbound + contenido dictado literal (user_defined) → NO confirma', () => {
  const pe = new PolicyEngine();
  const tool = { name: 'mail.send', risk: 'high', outbound: true };
  assert.equal(pe.evaluate(tool, {}, { provenance: 'user_defined' }).requiresConfirmation, false);
});

test('outbound + contenido compuesto por el LLM → SÍ confirma', () => {
  const pe = new PolicyEngine();
  const tool = { name: 'mail.send', risk: 'high', outbound: true };
  assert.equal(pe.evaluate(tool, {}, { provenance: 'llm_composed' }).requiresConfirmation, true);
});

test('SALVAGUARDA: critical NUNCA se relaja, aunque sea user_defined', () => {
  const pe = new PolicyEngine();
  const tool = { name: 'mail.blast', risk: 'critical', outbound: true };
  assert.equal(pe.evaluate(tool, {}, { provenance: 'user_defined' }).requiresConfirmation, true);
});

test('herramienta NO-outbound no se ve afectada por la procedencia (sigue por riesgo)', () => {
  const pe = new PolicyEngine();
  const tool = { name: 'files.delete', risk: 'high' }; // sin outbound
  // high sin go-ahead sigue confirmando, sin importar la procedencia
  assert.equal(pe.evaluate(tool, {}, { provenance: 'user_defined' }).requiresConfirmation, true);
});

test('sin procedencia conocida (no_content / null) el comportamiento por riesgo no cambia', () => {
  const pe = new PolicyEngine();
  const tool = { name: 'mail.send', risk: 'high', outbound: true };
  assert.equal(pe.evaluate(tool, {}, {}).requiresConfirmation, true); // high sin go-ahead
  assert.equal(pe.evaluate(tool, {}, { provenance: 'no_content' }).requiresConfirmation, true);
});

// --- Nivel tool-registry: flujo completo (classifyProvenance + policy) ---

test('E2E: envío con cuerpo dictado literal se ejecuta sin confirmación; compuesto la pide', async () => {
  const registry = new ToolRegistry({ policyEngine: new PolicyEngine() });
  let sent = 0;
  registry.register({
    name: 'mail.send', risk: 'high', outbound: true,
    execute: async () => { sent += 1; return 'sent'; }
  });

  // El usuario dictó el cuerpo literal → se envía directo (sin confirmación).
  const literal = await registry.execute(
    'mail.send',
    { to: 'rosie', body: 'voy llegando en diez minutos amor' },
    { userText: 'mándale un correo a Rosie que diga: voy llegando en diez minutos amor' }
  );
  assert.equal(literal.ok, true);
  assert.equal(sent, 1);

  // El asistente compuso el cuerpo → pide confirmación (no se ejecuta aún).
  const composed = await registry.execute(
    'mail.send',
    { to: 'cliente', body: 'Estimado cliente, le comparto el resumen ejecutivo de nuestra reunión de hoy con los acuerdos alcanzados.' },
    { userText: 'resume la reunión y mándasela al cliente' }
  );
  assert.equal(composed.confirmationRequired, true);
  assert.equal(sent, 1); // no se envió
});
