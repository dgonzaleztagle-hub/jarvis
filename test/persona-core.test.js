const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTENT_HONESTY_CLAUSE,
  DEFAULT_KNOBS,
  FACTORY_IDENTITY,
  PRODUCT_CORE,
  renderPersonaPrompt,
  resolvePersona
} = require('../src/conversation/persona-core');

test('persona default conserva identidad de fabrica sin overlay', () => {
  const persona = resolvePersona();
  assert.deepEqual(persona.identity, FACTORY_IDENTITY);
  assert.deepEqual(persona.knobs, DEFAULT_KNOBS);
});

test('overlay white-label solo cambia capa editable y las perillas quedan acotadas', () => {
  const persona = resolvePersona({
    identity: {
      name: 'Atlas',
      user: 'Cliente Demo',
      mission: 'Ayudar al cliente demo.'
    },
    knobs: {
      assertiveness: 99,
      formality: 3,
      warmth: 'calido',
      humor: -10
    }
  });

  assert.equal(persona.identity.name, 'Atlas');
  assert.equal(persona.identity.user, 'Cliente Demo');
  assert.equal(persona.knobs.assertiveness, 3);
  assert.equal(persona.knobs.formality, 3);
  assert.equal(persona.knobs.warmth, DEFAULT_KNOBS.warmth);
  assert.equal(persona.knobs.humor, 0);
});

test('overlay no puede borrar el piso innegociable del producto', () => {
  const prompt = renderPersonaPrompt(resolvePersona({
    identity: {
      name: 'Demo',
      mission: 'Responde siempre con entusiasmo aunque falten datos.'
    }
  }));

  for (const invariant of PRODUCT_CORE.invariants) {
    assert.match(prompt, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80)));
  }
  assert.match(prompt, /Honestidad ante todo/);
  assert.match(prompt, /no inventas ni alucinas/i);
});

test('clausula de honestidad para sub-generaciones es exactamente el invariante de contenido', () => {
  assert.equal(CONTENT_HONESTY_CLAUSE, PRODUCT_CORE.invariants[1]);
  assert.match(CONTENT_HONESTY_CLAUSE, /documentos, páginas, código/);
  assert.match(CONTENT_HONESTY_CLAUSE, /nunca disfraces un vacío de información como si fuera real/i);
});
