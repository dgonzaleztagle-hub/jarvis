const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoryStore } = require('../src/memory/memory-store');
const { KnowledgeGraph } = require('../src/memory/knowledge-graph');
const { extractTurnKnowledge } = require('../src/memory/turn-extractor');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

// Provider que cuenta llamadas y responde el JSON unificado (memory + graph).
function countingProvider(data) {
  const provider = {
    calls: 0,
    purposes: [],
    generateJson: async ({ purpose }) => {
      provider.calls += 1;
      provider.purposes.push(purpose);
      return { model: 'fake', data };
    }
  };
  return provider;
}

test('extractTurnKnowledge: UNA sola llamada al modelo alimenta memoria y grafo', async () => {
  const dir = tempDataDir();
  const memoryStore = new MemoryStore({ dataDir: dir });
  const knowledgeGraph = new KnowledgeGraph({ dataDir: dir });

  const provider = countingProvider({
    memory: {
      items: [{
        key: 'contact_rosie',
        title: 'Rosie es la esposa de Daniel',
        type: 'contact',
        state: 'verified',
        confidence: 0.95,
        content: { relacion: 'esposa', nombre: 'Rosie' },
        evidence: 'mi esposa Rosie'
      }]
    },
    graph: {
      entities: [{ name: 'Rosie', type: 'person' }],
      facts: [{ subject: 'Rosie', predicate: 'relacion', object: 'esposa', confidence: 1 }],
      relationships: [],
      commitments: []
    }
  });

  const res = await extractTurnKnowledge({
    userText: 'mi esposa Rosie cumple años en marzo',
    assistantResult: { speak: 'anotado', visual: '' },
    toolResults: [],
    modelProvider: provider,
    memoryStore,
    knowledgeGraph,
    recentHistory: ''
  });

  // El punto de toda la unificación: una sola llamada para las dos formas.
  assert.equal(provider.calls, 1, 'debe haber exactamente UNA llamada al modelo por turno');
  assert.equal(res.unified, true);

  // Memoria: el item llegó con evidencia grounded → se persistió.
  assert.ok(res.stored.some((m) => m.type === 'contact'), 'la memoria de perfil debió persistir el contacto');

  // Grafo: la entidad y el hecho se depositaron.
  assert.equal(res.graphResult.entities, 1);
  assert.equal(knowledgeGraph.findEntities({ name: 'Rosie' }).length, 1);
});

test('extractTurnKnowledge: si la llamada unificada falla, degrada a dos llamadas sin propagar', async () => {
  const dir = tempDataDir();
  const memoryStore = new MemoryStore({ dataDir: dir });
  const knowledgeGraph = new KnowledgeGraph({ dataDir: dir });

  // Primera llamada (unificada) revienta; las siguientes (camino viejo) responden vacío.
  let calls = 0;
  const flaky = {
    generateJson: async () => {
      calls += 1;
      if (calls === 1) throw new Error('unified down');
      return { model: 'fake', data: { items: [], entities: [], facts: [], relationships: [], commitments: [] } };
    }
  };

  const res = await extractTurnKnowledge({
    userText: 'esto es un mensaje suficientemente largo para extraer',
    assistantResult: { speak: 'ok', visual: '' },
    toolResults: [],
    modelProvider: flaky,
    memoryStore,
    knowledgeGraph,
    recentHistory: ''
  });

  assert.equal(res.unified, false, 'tras fallar la unificada, marca degradado');
  // Degradó: hizo la unificada (1) + memoria standalone (2) + grafo standalone (3).
  assert.ok(calls >= 2, 'el fallback debe reintentar por el camino de dos llamadas');
  assert.deepEqual(res.graphResult, { entities: 0, facts: 0, relationships: 0, commitments: 0 });
});
