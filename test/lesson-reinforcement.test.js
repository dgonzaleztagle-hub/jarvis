const { test } = require('node:test');
const assert = require('node:assert');
const { applyReinforcement, detectFeedbackPolarity } = require('../src/memory/lesson-reinforcement');

function fakeStore() {
  const updates = [];
  return {
    updates,
    updateState(id, state, patch) { updates.push({ id, state, ...patch }); }
  };
}

const LESSONS = [
  { id: 'l1', key: 'rechazo_de_musica_matutina', confidence: 0.7, state: 'candidate', matchText: 'rechazo_de_musica_matutina no poner musica en la manana sin pedirla' },
  { id: 'l2', key: 'documentos_completos', confidence: 0.7, state: 'candidate', matchText: 'crear documentos solo con contenido completo nunca esqueleto vacio' }
];

test('corrección solo castiga lecciones pertinentes al reclamo', () => {
  const store = fakeStore();
  const adjusted = applyReinforcement({
    memoryStore: store,
    previousLessons: LESSONS,
    polarity: 'correction',
    userText: 'no, el documento quedó a medias de nuevo, los documentos deben ir completos'
  });
  assert.equal(adjusted.length, 1);
  assert.equal(adjusted[0].key, 'documentos_completos');
});

test('corrección sin lección pertinente no castiga ninguna', () => {
  const store = fakeStore();
  const adjusted = applyReinforcement({
    memoryStore: store,
    previousLessons: LESSONS,
    polarity: 'correction',
    userText: 'no, eso no era lo que pedí con el calendario'
  });
  assert.equal(adjusted.length, 0);
  assert.equal(store.updates.length, 0);
});

test('afirmación sigue aplicando amplio a lo que estaba en juego', () => {
  const store = fakeStore();
  const adjusted = applyReinforcement({
    memoryStore: store,
    previousLessons: LESSONS,
    polarity: 'affirmation',
    userText: 'perfecto, gracias'
  });
  assert.equal(adjusted.length, 2);
});

test('detectFeedbackPolarity sigue funcionando', () => {
  assert.equal(detectFeedbackPolarity('no, eso no era'), 'correction');
  assert.equal(detectFeedbackPolarity('perfecto, gracias'), 'affirmation');
  assert.equal(detectFeedbackPolarity('muéstrame la agenda'), 'neutral');
});
