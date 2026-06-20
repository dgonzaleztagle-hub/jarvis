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

test('read() con grafo corrupto respalda el archivo en vez de perderlo en silencio', () => {
  const dir = tempDataDir();
  const graph = new KnowledgeGraph({ dataDir: dir });
  const ent = graph.upsertEntity('person', 'Vikram', { rol: 'dueño' });
  graph.addFact(ent.id, 'empresa', 'Rishtedar', { state: 'verified', source: 'user_explicit' });

  // Corromper el archivo del grafo a mano (simula escritura cortada / disco).
  const graphPath = path.join(dir, 'memory', 'graph.json');
  fs.writeFileSync(graphPath, '{ "entities": [ {corrupto', 'utf-8');

  // read() no debe explotar y debe degradar a vacío, PERO sin destruir el dato:
  // el contenido original tiene que quedar respaldado en disco.
  const recovered = new KnowledgeGraph({ dataDir: dir });
  const data = recovered.read();
  assert.deepEqual(data, { entities: [], facts: [], relationships: [], commitments: [] });

  const backups = fs.readdirSync(path.join(dir, 'memory')).filter((f) => f.includes('.corrupt-'));
  assert.equal(backups.length, 1, 'el grafo corrupto debe respaldarse antes de reiniciarse');
  assert.match(fs.readFileSync(path.join(dir, 'memory', backups[0]), 'utf-8'), /corrupto/);
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

test('upsertEntity colapsa misma cosa con distinto tipo (org/place/project/tool)', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const org = graph.upsertEntity('org', 'Rishtedar', { dueño: 'Vikram' });
  const place = graph.upsertEntity('place', 'Rishtedar', { ciudad: 'Santiago' });
  const proj = graph.upsertEntity('project', 'Rishtedar', { estado: 'activo' });
  assert.equal(org.id, place.id);
  assert.equal(org.id, proj.id);
  assert.equal(graph.stats().entities, 1);
  // pero una PERSONA con el mismo nombre NO se fusiona con la cosa
  const person = graph.upsertEntity('person', 'Rishtedar');
  assert.notEqual(person.id, org.id);
  assert.equal(graph.stats().entities, 2);
});

test('upsertEntity fusiona persona por apodo/contact_name y por nombre real', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const apodo = graph.upsertEntity('person', 'hijito', { contact_name: 'hijito' });
  const real = graph.upsertEntity('person', 'Baltasar', { apodo: 'hijito' });
  assert.equal(apodo.id, real.id);
  assert.equal(graph.stats().entities, 1);
});

test('storeExtraction descarta hechos efímeros y auto-claims del asistente', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const result = storeExtraction(graph, {
    entities: [
      { name: 'WhatsApp', type: 'tool' },
      { name: 'Jarvis', type: 'tool' },
      { name: 'Vikram', type: 'person' }
    ],
    facts: [
      { subject: 'WhatsApp', predicate: 'tiene_error', object: 'true', confidence: 0.9 },
      { subject: 'WhatsApp', predicate: 'estado_conexion', object: 'conectado', confidence: 0.9 },
      { subject: 'Vikram', predicate: 'puede_gestionar_correos', object: 'true', confidence: 0.9 },
      { subject: 'Vikram', predicate: 'email', object: 'vikram@rishtedar.cl', confidence: 0.95 }
    ],
    relationships: [],
    commitments: []
  });
  // Jarvis se descarta como entidad (self), WhatsApp y Vikram quedan
  assert.equal(graph.findEntities({ name: 'Jarvis' }).length, 0);
  // Solo el hecho duradero (email) sobrevive; los efímeros/auto-claim se filtran
  assert.equal(result.facts, 1);
  const stats = graph.stats();
  assert.equal(stats.facts, 1);
});

test('prune elimina hechos efímeros viejos y entidades huérfanas, conserva lo verificado', () => {
  const dir = tempDataDir();
  const graph = new KnowledgeGraph({ dataDir: dir });
  const ent = graph.upsertEntity('person', 'Vikram');
  const verified = graph.addFact(ent.id, 'email', 'v@x.cl');
  graph.addFact(ent.id, 'email', 'v@x.cl'); // segunda observación → verified
  const weak = graph.addFact(ent.id, 'humor', 'bueno', { confidence: 0.5, state: 'candidate' });
  const orphan = graph.upsertEntity('concept', 'algo suelto viejo');

  // Envejecer artificialmente el hecho débil y la entidad huérfana
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'memory', 'graph.json'), 'utf-8'));
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  for (const f of raw.facts) if (f.id === weak.id) f.updatedAt = old;
  for (const e of raw.entities) if (e.id === orphan.id) e.updatedAt = old;
  fs.writeFileSync(path.join(dir, 'memory', 'graph.json'), JSON.stringify(raw));

  const res = graph.prune();
  assert.ok(res.removedFacts >= 1);
  assert.ok(res.removedEntities >= 1);
  // El hecho verificado sobrevive
  const profile = graph.getEntityProfile(ent.id);
  assert.ok(profile.facts.some((f) => f.id === verified.id));
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
  assert.ok(names.includes('memory.correct'));
  assert.ok(runtime.knowledgeGraph);
});

test('setFactState descarta o corrige un hecho sin perder historial', () => {
  const graph = new KnowledgeGraph({ dataDir: tempDataDir() });
  const v = graph.upsertEntity('person', 'Vikram');
  const fact = graph.addFact(v.id, 'email', 'viejo@rishtedar.cl', { state: 'verified' });

  const rejected = graph.setFactState(fact.id, 'rejected');
  assert.equal(rejected.state, 'rejected');
  assert.equal(graph.getEntityProfile(v.id).facts.length, 0);

  assert.equal(graph.setFactState('fact_no_existe', 'rejected'), null);
});

test('memory.correct: busca candidatos y luego corrige un hecho del grafo', async () => {
  const { createRuntime } = require('../src/app-runtime');
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });
  const v = runtime.knowledgeGraph.upsertEntity('person', 'Vikram');
  const fact = runtime.knowledgeGraph.addFact(v.id, 'email', 'viejo@rishtedar.cl', { state: 'verified' });

  const correct = runtime.toolRegistry.get('memory.correct');
  const found = await correct.execute({ query: 'Vikram' });
  assert.ok(found.facts.some((f) => f.id === fact.id));

  const result = await correct.execute({
    id: fact.id,
    source: 'fact',
    action: 'replace',
    correction: { object: 'nuevo@rishtedar.cl' }
  });
  assert.equal(result.ok, true);
  assert.equal(result.replacement.object, 'nuevo@rishtedar.cl');
  assert.equal(result.replacement.state, 'verified');

  const profile = runtime.knowledgeGraph.getEntityProfile(v.id);
  assert.equal(profile.facts.length, 1);
  assert.equal(profile.facts[0].object, 'nuevo@rishtedar.cl');
});
