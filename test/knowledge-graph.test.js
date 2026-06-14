const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KnowledgeGraph } = require('../src/memory/knowledge-graph');
const { storeExtraction, extractGraphFromTurn } = require('../src/memory/graph-extractor');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

test('upsertEntity deduplica por tipo + nombre normalizado y mergea propiedades', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const a = graph.upsertEntity('person', 'Vikram', { rol: 'dueño' });
  const b = graph.upsertEntity('person', 'vikram', { empresa: 'Rishtedar' });
  assert.equal(a.id, b.id);
  assert.equal(b.properties.rol, 'dueño');
  assert.equal(b.properties.empresa, 'Rishtedar');
  assert.equal(graph.stats().entities, 1);
});

test('addFact nace candidate y asciende a verified al reobservarse', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const ent = graph.upsertEntity('person', 'Vikram');
  const f1 = graph.addFact(ent.id, 'email', 'vikram@rishtedar.cl');
  assert.equal(f1.state, 'candidate');
  const f2 = graph.addFact(ent.id, 'email', 'vikram@rishtedar.cl');
  assert.equal(f2.id, f1.id);
  assert.equal(f2.state, 'verified');
  assert.equal(f2.observations, 2);
  assert.equal(graph.stats().facts, 1);
});

test('addRelationship conecta entidades y no duplica', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const vikram = graph.upsertEntity('person', 'Vikram');
  const rishtedar = graph.upsertEntity('org', 'Rishtedar');
  const r1 = graph.addRelationship(vikram.id, rishtedar.id, 'dueño_de');
  const r2 = graph.addRelationship(vikram.id, rishtedar.id, 'dueño_de');
  assert.equal(r1.id, r2.id);
  assert.equal(graph.stats().relationships, 1);
});

test('retrieveForMessage encuentra entidad por nombre y arma el perfil', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const vikram = graph.upsertEntity('person', 'Vikram');
  const rishtedar = graph.upsertEntity('org', 'Rishtedar');
  graph.addFact(vikram.id, 'rol', 'dueño de restaurante');
  graph.addRelationship(vikram.id, rishtedar.id, 'dueño_de');

  const profiles = graph.retrieveForMessage('qué sabes de Vikram?');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].entity.name, 'Vikram');
  assert.equal(profiles[0].facts.length, 1);
  assert.equal(profiles[0].relationships[0].target, 'Rishtedar');
});

test('getKnowledgeForMessage devuelve texto formateado y vacío si no hay match', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const v = graph.upsertEntity('person', 'Vikram');
  graph.addFact(v.id, 'rol', 'dueño');
  const text = graph.getKnowledgeForMessage('hablame de Vikram');
  assert.match(text, /Vikram \(person\)/);
  assert.match(text, /rol: dueño/);
  assert.equal(graph.getKnowledgeForMessage('algo totalmente inconexo xyz'), '');
});

test('compromisos: alta, listado por estado y cambio de estado', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const c = graph.addCommitment('Enviar propuesta a Vikram', { priority: 'high' });
  assert.equal(c.status, 'pending');
  const open = graph.findCommitments({ status: 'pending' });
  assert.equal(open.length, 1);
  graph.setCommitmentStatus(c.id, 'completed');
  assert.equal(graph.findCommitments({ status: 'pending' }).length, 0);
  assert.equal(graph.getOpenCommitmentsSummary(), '');
});

test('storeExtraction deposita el JSON del modelo en el grafo', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const result = storeExtraction(graph, {
    entities: [
      { name: 'Vikram', type: 'person' },
      { name: 'Rishtedar', type: 'org' }
    ],
    facts: [{ subject: 'Vikram', predicate: 'rol', object: 'dueño', confidence: 0.9 }],
    relationships: [{ from: 'Vikram', to: 'Rishtedar', type: 'dueño_de' }],
    commitments: [{ what: 'Llamar a Vikram el lunes', priority: 'normal' }]
  });
  assert.equal(result.entities, 2);
  assert.equal(result.facts, 1);
  assert.equal(result.relationships, 1);
  assert.equal(result.commitments, 1);
  const stats = graph.stats();
  assert.equal(stats.entities, 2);
  assert.equal(stats.facts, 1);
});

test('extractGraphFromTurn usa el modelo y persiste; nunca lanza', async () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const fakeProvider = {
    generateJson: async () => ({
      model: 'fake',
      data: {
        entities: [{ name: 'Rosie', type: 'person' }],
        facts: [{ subject: 'Rosie', predicate: 'relacion', object: 'esposa', confidence: 1 }],
        relationships: [],
        commitments: []
      }
    })
  };
  const res = await extractGraphFromTurn({
    userText: 'mi esposa Rosie cumple años en marzo',
    assistantText: 'anotado',
    modelProvider: fakeProvider,
    graph
  });
  assert.equal(res.entities, 1);
  assert.equal(graph.findEntities({ name: 'Rosie' }).length, 1);

  // Provider que revienta: no debe propagar.
  const boom = { generateJson: async () => { throw new Error('down'); } };
  const safe = await extractGraphFromTurn({ userText: 'x', assistantText: 'y', modelProvider: boom, graph });
  assert.equal(safe.facts, 0);
});

test('graph_query y graph_remember quedan registradas como tools', () => {
  const { createRuntime } = require('../src/app-runtime');
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  const names = runtime.toolRegistry.list().map((t) => t.name);
  assert.ok(names.includes('memory.graph_query'));
  assert.ok(names.includes('memory.graph_remember'));
  assert.ok(names.includes('memory.commitments'));
  assert.ok(runtime.knowledgeGraph);
});
