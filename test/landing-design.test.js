const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchConcept, buildDesignDirective, rollSeeds, planLanding } = require('../src/modules/design/landing-design-system');
const { auditLanding } = require('../src/modules/design/landing-qa');
const { recordCombo, recentCombos } = require('../src/modules/design/variation-store');

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

test('QA gate: documento bueno puntúa alto sin críticas; uno roto las detecta', () => {
  const good = '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width"><title>Café Lumina</title></head><body><h1 class="text-6xl">Café Lumina</h1><h2 class="text-2xl">Especialidad</h2><p class="px-4">Café de origen.</p><a class="bg-amber-700 px-6 py-3">Reservar</a></body></html>';
  const g = auditLanding(good);
  assert.equal(g.criticalCount, 0);
  assert.ok(g.score >= 0.9, `esperaba score alto, fue ${g.score}`);

  const bad = '<html><body><div>bienvenidos lorem ipsum dolor sit amet</div></body></html>';
  const b = auditLanding(bad);
  assert.ok(b.criticalCount >= 1, 'doc sin h1/title/cta debe tener críticas');
  assert.ok(b.issues.some((i) => i.id === 'has_cta'));
  assert.ok(b.issues.some((i) => i.id === 'no_lorem'));
  assert.ok(b.score < g.score);
});

test('memoria de variaciones: registra y recupera por cliente; planLanding evita el combo reciente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-var-'));
  recordCombo(dir, 'Café Lumina', 'A|B|C|D');
  assert.deepEqual(recentCombos(dir, 'café lumina', 3), ['A|B|C|D']); // clave normalizada

  // planLanding con avoid del combo recién planificado: el siguiente difiere (best-effort).
  const p1 = planLanding({ brief: 'cafetería de especialidad' });
  const p2 = planLanding({ brief: 'cafetería de especialidad', avoid: [p1.combo] });
  assert.notEqual(p2.combo, p1.combo);
});
