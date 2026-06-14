const { test } = require('node:test');
const assert = require('node:assert');
const { buildQuickAck } = require('../src/conversation/quick-ack');

test('buildQuickAck mapea por nombre de tool', () => {
  assert.equal(buildQuickAck([{ name: 'google.gmail.list_emails' }]), 'Revisando tu bandeja...');
  assert.equal(buildQuickAck([{ name: 'google.calendar.list_events' }]), 'Consultando tu agenda...');
  assert.equal(buildQuickAck([{ name: 'google.tasks.list_tasks' }]), 'Revisando tus tareas...');
  assert.equal(buildQuickAck([{ name: 'google.gmail.search_emails' }]), 'Revisando tu bandeja...');
  assert.equal(buildQuickAck([{ name: 'google.contacts.search' }]), 'Buscando...');
  assert.equal(buildQuickAck([{ name: 'google.calendar.create_event' }]), 'Consultando tu agenda...');
  assert.equal(buildQuickAck([{ name: 'google.docs.create_document' }]), 'Lo preparo...');
  assert.equal(buildQuickAck([{ name: 'google.gmail.trash_email' }]), 'Revisando tu bandeja...');
  assert.equal(buildQuickAck([{ name: 'agents.delete' }]), 'Entendido...');
  assert.equal(buildQuickAck([{ name: 'hud.open_url' }]), 'Un momento...');
});

test('buildQuickAck no rompe con lista vacía', () => {
  assert.equal(buildQuickAck([]), 'Un momento...');
});
