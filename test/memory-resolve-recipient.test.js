const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoryStore } = require('../src/memory/memory-store');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

test('resolveRecipient: contacto único no es ambiguo', () => {
  const store = new MemoryStore({ dataDir: tempDataDir() });
  store.upsert({
    title: 'Rosie',
    type: 'contact',
    state: 'verified',
    confidence: 0.95,
    content: { name: 'Rosie', email: 'irigoyenrosa93@gmail.com' }
  });

  const result = store.resolveRecipient('Rosie');
  assert.equal(result.ambiguous, false);
  assert.equal(result.record.content.email, 'irigoyenrosa93@gmail.com');
});

test('resolveRecipient: dos contactos que empatan en el puntaje quedan marcados como ambiguos', () => {
  const store = new MemoryStore({ dataDir: tempDataDir() });
  store.upsert({
    title: 'Patricio Vergara',
    type: 'contact',
    state: 'verified',
    confidence: 0.9,
    content: { name: 'Patricio Vergara', email: 'patricio.vergara@example.com' }
  });
  store.upsert({
    title: 'Patricio Soto',
    type: 'contact',
    state: 'verified',
    confidence: 0.9,
    content: { name: 'Patricio Soto', email: 'patricio.soto@example.com' }
  });

  const result = store.resolveRecipient('Patricio');
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 2);
});

test('resolveRecipient: sin matches devuelve record null y ambiguous false', () => {
  const store = new MemoryStore({ dataDir: tempDataDir() });
  const result = store.resolveRecipient('Alguien Que No Existe');
  assert.equal(result.record, null);
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.candidates, []);
});
