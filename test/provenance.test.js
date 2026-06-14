const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyProvenance, isLiterallyFromUser, collectContentFields } = require('../src/core/provenance');

test('contenido dictado literal por el usuario → user_defined', () => {
  const res = classifyProvenance({
    input: { to: 'rosie', message: 'voy llegando en 10 minutos' },
    userText: 'mándale un whatsapp a Rosie que diga: voy llegando en 10 minutos'
  });
  assert.equal(res.provenance, 'user_defined');
  assert.equal(res.composedFields.length, 0);
});

test('contenido compuesto por el LLM → llm_composed', () => {
  const res = classifyProvenance({
    input: { to: 'cliente', subject: 'Resumen', body: 'Estimado cliente, adjunto el resumen de la reunión de hoy donde acordamos...' },
    userText: 'resume esto y envíaselo al cliente'
  });
  assert.equal(res.provenance, 'llm_composed');
  assert.ok(res.composedFields.includes('body'));
});

test('acción sin campos de contenido → no_content', () => {
  const res = classifyProvenance({
    input: { maxResults: 5, query: 'is:unread' },
    userText: 'lista mis correos no leídos'
  });
  assert.equal(res.provenance, 'no_content');
  assert.equal(res.contentFields, 0);
});

test('mezcla: un campo literal y otro compuesto → llm_composed con el campo correcto', () => {
  const res = classifyProvenance({
    input: {
      message: 'feliz cumpleaños Vikram que tengas un gran día',
      note: 'recordatorio generado automáticamente por el sistema'
    },
    userText: 'mándale a Vikram: feliz cumpleaños Vikram que tengas un gran día'
  });
  assert.equal(res.provenance, 'llm_composed');
  assert.deepEqual(res.composedFields, ['note']);
});

test('isLiterallyFromUser ignora acentos, mayúsculas y puntuación', () => {
  assert.equal(isLiterallyFromUser('Voy llegando, ¡en 10 min!', 'dile que voy llegando en 10 min'), true);
  assert.equal(isLiterallyFromUser('algo que no dije nunca jamás', 'hola cómo estás'), false);
});

test('collectContentFields encuentra contenido anidado', () => {
  const fields = collectContentFields({ emailDetails: { to: 'x', body: 'hola mundo esto es largo' } });
  assert.equal(fields.length, 1);
  assert.equal(fields[0].field, 'body');
});

test('telemetría de procedencia llega al audit en una ejecución real', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { ToolRegistry } = require('../src/core/tool-registry');
  const { PolicyEngine } = require('../src/core/policy-engine');
  const { AuditTrail } = require('../src/security/audit-trail');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
  const audit = new AuditTrail({ dataDir: dir });
  const registry = new ToolRegistry({ policyEngine: new PolicyEngine(), auditTrail: audit });
  registry.register({ name: 'send.thing', risk: 'low', execute: async () => 'sent' });

  await registry.execute('send.thing', { message: 'texto compuesto por el modelo aquí' }, {
    channel: 'hud',
    userText: 'mándale algo'
  });

  const entry = audit.query({ tool: 'send.thing' })[0];
  assert.equal(entry.provenance, 'llm_composed');
});
