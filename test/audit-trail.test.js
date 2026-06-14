const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditTrail } = require('../src/security/audit-trail');
const { ToolRegistry } = require('../src/core/tool-registry');
const { PolicyEngine } = require('../src/core/policy-engine');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

test('record + query filtran por tool y outcome', () => {
  const audit = new AuditTrail({ dataDir: tempDataDir() });
  audit.record({ tool: 'a', outcome: 'ok', channel: 'hud' });
  audit.record({ tool: 'b', outcome: 'error', channel: 'hud', error: 'boom' });
  audit.record({ tool: 'a', outcome: 'denied', channel: 'agent' });

  assert.equal(audit.query({ tool: 'a' }).length, 2);
  assert.equal(audit.query({ outcome: 'error' }).length, 1);
  assert.equal(audit.query({ channel: 'agent' })[0].tool, 'a');
  const stats = audit.stats();
  assert.equal(stats.total, 3);
  assert.equal(stats.byOutcome.ok, 1);
});

test('redacta claves sensibles y trunca inputs enormes', () => {
  const audit = new AuditTrail({ dataDir: tempDataDir() });
  audit.record({ tool: 't', outcome: 'ok', input: { apiKey: 'sk-123', texto: 'hola' } });
  const entry = audit.query({ tool: 't' })[0];
  assert.match(entry.input, /\[REDACTED\]/);
  assert.doesNotMatch(entry.input, /sk-123/);
});

test('consecutiveApprovals cuenta oks seguidos hasta el último no-ok', () => {
  const audit = new AuditTrail({ dataDir: tempDataDir() });
  audit.record({ tool: 'x', outcome: 'ok' });
  audit.record({ tool: 'x', outcome: 'denied' });
  audit.record({ tool: 'x', outcome: 'ok' });
  audit.record({ tool: 'x', outcome: 'ok' });
  assert.equal(audit.consecutiveApprovals('x'), 2);
});

test('ToolRegistry audita ok, error y denied a través de execute', async () => {
  const audit = new AuditTrail({ dataDir: tempDataDir() });
  const policyEngine = new PolicyEngine();
  const registry = new ToolRegistry({ policyEngine, auditTrail: audit });

  registry.register({ name: 'safe.echo', risk: 'low', execute: async (i) => i });
  registry.register({ name: 'boom', risk: 'low', execute: async () => { throw new Error('kaboom'); } });
  registry.register({ name: 'danger', risk: 'critical', execute: async () => 'done' });

  await registry.execute('safe.echo', { v: 1 }, { channel: 'hud' });
  await assert.rejects(() => registry.execute('boom', {}, { channel: 'hud' }));
  await registry.execute('danger', {}, { channel: 'hud' }); // critical → confirmation_required, no corre

  const entries = audit.readAll();
  const byTool = Object.fromEntries(entries.map((e) => [e.tool, e.outcome]));
  assert.equal(byTool['safe.echo'], 'ok');
  assert.equal(byTool['boom'], 'error');
  assert.equal(byTool['danger'], 'confirmation_required');
});

test('audit.query queda registrada como tool y el runtime expone auditTrail', () => {
  const { createRuntime } = require('../src/app-runtime');
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  assert.ok(runtime.toolRegistry.list().some((t) => t.name === 'audit.query'));
  assert.ok(runtime.auditTrail);
});
