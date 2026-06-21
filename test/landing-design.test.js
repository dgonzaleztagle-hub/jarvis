const test = require('node:test');
const assert = require('node:assert/strict');
const { matchConcept, buildDesignDirective, rollSeeds } = require('../src/design/landing-design-system');

test('matchConcept calza el nicho (determinista) y el concepto cuando la señal es fuerte', () => {
  // Nicho: determinista por keywords en español.
  assert.equal(matchConcept('cafetería de especialidad experimental')?.niche, 'gastronomía');
  assert.equal(matchConcept('estudio jurídico, abogados corporativos')?.niche, 'legal');
  assert.equal(matchConcept('clínica dental, estética dental')?.niche, 'salud');
  // Concepto exacto: cuando el brief trae la señal de subtipo (es/en compartida).
  assert.equal(matchConcept('gimnasio crossfit de alta intensidad')?.name, 'Transformation Energy');
  assert.equal(matchConcept('restaurante familiar rústico')?.name, 'Tuscan Warmth');
  assert.equal(matchConcept('estudio jurídico corporativo, grandes transacciones')?.name, 'Swiss Authority');
  assert.equal(matchConcept('abogado penal, litigación y juicios')?.name, 'Legal Drama');
});

test('matchConcept NO inventa nicho (word-boundary): "barrio" no es "bar"', () => {
  assert.equal(matchConcept('una bicicletería de barrio'), null);
  assert.equal(matchConcept('un spa de relajación')?.niche, 'salud'); // spa sí, no por "espacio"
  assert.equal(matchConcept('hablemos del espacio de trabajo'), null);
});

test('buildDesignDirective inyecta capa visual + capa de contenido cuando hay match', () => {
  const d = buildDesignDirective({ brief: 'estudio jurídico, abogados corporativos en Santiago' });
  assert.match(d, /DIRECTOR CREATIVO/);
  assert.match(d, /WOW LAYERING/);
  assert.match(d, /CONCEPTO DE CONTENIDO/);
  assert.match(d, /Swiss Authority|Legal Drama|TechLaw/);
});

test('buildDesignDirective funciona sin match (rubro desconocido): solo capa visual', () => {
  const d = buildDesignDirective({ brief: 'algo totalmente genérico sin rubro' });
  assert.match(d, /DIRECTOR CREATIVO/);
  assert.doesNotMatch(d, /CONCEPTO DE CONTENIDO/);
});

test('rollSeeds respeta el nicho (SERIOUS no usa motion llamativo)', () => {
  for (let i = 0; i < 20; i += 1) {
    const s = rollSeeds('SERIOUS');
    assert.equal(s.motion.name, 'Solid Ground', 'SERIOUS siempre va sobrio en motion');
  }
});
