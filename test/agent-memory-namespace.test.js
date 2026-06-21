const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KnowledgeGraph } = require('../src/memory/knowledge-graph');
const { MemoryStore } = require('../src/memory/memory-store');
const { ContextAssembler } = require('../src/memory/context-assembler');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-ns-'));
}

test('knowledge-graph: una entidad/hecho/compromiso escrito por un agente no aparece en el contexto global', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const ent = graph.upsertEntity('project', 'Proyecto Secreto del Agente', {}, 'llm_extraction', 'agent_A');
  graph.addFact(ent.id, 'estado', 'en curso', { sourceAgentId: 'agent_A', state: 'verified' });
  graph.addCommitment('Revisar el proyecto secreto', { sourceAgentId: 'agent_A' });

  // Turno normal (HUD/Telegram, sin agentId): no debe verlo.
  assert.equal(graph.getKnowledgeForMessage('proyecto secreto del agente'), '');
  assert.equal(graph.getOpenCommitmentsSummary({}).includes('proyecto secreto'), false);

  // Otro agente: tampoco lo ve.
  assert.equal(graph.getKnowledgeForMessage('proyecto secreto del agente', { agentId: 'agent_B' }), '');

  // El MISMO agente, en una corrida futura: sí lo ve (memoria de trabajo propia).
  const ownView = graph.getKnowledgeForMessage('proyecto secreto del agente', { agentId: 'agent_A' });
  assert.match(ownView, /Proyecto Secreto del Agente/);
  const ownCommitments = graph.getOpenCommitmentsSummary({ agentId: 'agent_A' });
  assert.match(ownCommitments, /Revisar el proyecto secreto/);
});

test('knowledge-graph: una entidad SIN sourceAgentId (turno normal) sigue visible para todos', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  graph.upsertEntity('person', 'Vikram', { rol: 'dueño' });
  assert.match(graph.getKnowledgeForMessage('vikram'), /Vikram/);
  assert.match(graph.getKnowledgeForMessage('vikram', { agentId: 'agent_A' }), /Vikram/);
});

test('memory-store: un registro taggeado con sourceAgentId queda fuera del contexto global', () => {
  const store = new MemoryStore({ dataDir: tempDataDir() });
  store.upsert({
    key: 'lead_secreto', title: 'Lead secreto del agente', type: 'business_context',
    state: 'verified', confidence: 0.9, content: { nombre: 'Lead Secreto' }, sourceAgentId: 'agent_A'
  });

  assert.equal(store.list({ type: 'business_context' }).length, 0);
  assert.equal(store.list({ type: 'business_context', agentId: 'agent_B' }).length, 0);
  assert.equal(store.list({ type: 'business_context', agentId: 'agent_A' }).length, 1);

  assert.equal(store.search('lead secreto', { types: ['business_context'], states: ['verified'] }).length, 0);
  assert.equal(store.search('lead secreto', { types: ['business_context'], states: ['verified'], agentId: 'agent_A' }).length, 1);
});

test('context-assembler: agentId se propaga end-to-end y filtra el bloque del grafo', () => {
  const dataDir = tempDataDir();
  const graph = new KnowledgeGraph({ dataDir });
  const store = new MemoryStore({ dataDir });
  const ent = graph.upsertEntity('project', 'Mision Confidencial', {}, 'llm_extraction', 'agent_A');
  graph.addFact(ent.id, 'cliente', 'Cliente Z', { sourceAgentId: 'agent_A', state: 'verified' });

  const assembler = new ContextAssembler({ memoryStore: store, knowledgeGraph: graph });

  const globalContext = assembler.assemble({ userText: 'mision confidencial' });
  assert.doesNotMatch(globalContext, /Mision Confidencial/);

  const agentContext = assembler.assemble({ userText: 'mision confidencial', agentId: 'agent_A' });
  assert.match(agentContext, /Mision Confidencial/);
});
