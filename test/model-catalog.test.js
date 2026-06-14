const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalog = require('../src/model/model-catalog');
const { AnthropicProvider } = require('../src/model/anthropic-provider');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

test('el catálogo tiene los 4 tiers y Opus NO es recomendado', () => {
  assert.equal(catalog.getModel('gemini-2.0-flash').tier, 'base');
  assert.equal(catalog.getModel('claude-haiku-4-5').tier, 'economico');
  assert.equal(catalog.getModel('claude-sonnet-4-6').tier, 'fuerte');
  assert.equal(catalog.getModel('claude-opus-4-8').tier, 'maximo');
  // Principio de Daniel: recomendar el medio, no el tope.
  assert.equal(catalog.getModel('claude-sonnet-4-6').recommended, true);
  assert.equal(catalog.getModel('claude-opus-4-8').recommended, false);
});

test('recommendedStrongModel devuelve Sonnet (medio), nunca Opus', () => {
  assert.equal(catalog.recommendedStrongModel().id, 'claude-sonnet-4-6');
});

test('isBelowRecommended: Gemini free se queda corto para construir, no para conversar', () => {
  assert.equal(catalog.isBelowRecommended('gemini-2.0-flash', 'build'), true);
  assert.equal(catalog.isBelowRecommended('gemini-2.0-flash', 'conversation'), false);
  assert.equal(catalog.isBelowRecommended('claude-sonnet-4-6', 'build'), false);
});

test('recommendUpgrade sugiere Sonnet para una tarea de construir desde free', () => {
  const up = catalog.recommendUpgrade('claude-haiku-4-5', 'code');
  assert.equal(up.id, 'claude-sonnet-4-6');
  // Si el activo ya alcanza, no recomienda nada.
  assert.equal(catalog.recommendUpgrade('claude-sonnet-4-6', 'code'), null);
});

test('hotSwapTargets solo lista modelos del mismo proveedor', () => {
  const targets = catalog.hotSwapTargets('claude-haiku-4-5').map((m) => m.id);
  assert.ok(targets.includes('claude-sonnet-4-6'));
  assert.ok(targets.includes('claude-opus-4-8'));
  assert.ok(!targets.includes('gemini-2.0-flash')); // otro proveedor
});

test('AnthropicProvider.setModel cambia el modelo y el pricing en caliente', () => {
  const p = new AnthropicProvider({ apiKey: 'x', model: 'claude-haiku-4-5' });
  assert.equal(p.model, 'claude-haiku-4-5');
  p.setModel('claude-sonnet-4-6', catalog.getModel('claude-sonnet-4-6').pricing);
  assert.equal(p.model, 'claude-sonnet-4-6');
  assert.equal(p.pricing.inputPerMillion, 3);
});

test('runtime: swap en caliente dentro de Anthropic y bloqueo de cruce de proveedor', () => {
  const { createRuntime } = require('../src/app-runtime');
  const runtime = createRuntime({ dataDir: tempDataDir(), agents: { autoStart: false } });

  // Default dev = Haiku (Anthropic).
  assert.equal(runtime.getActiveModel().id, 'claude-haiku-4-5');

  // Swap hot a Sonnet (mismo proveedor) → ok.
  const after = runtime.setActiveModel('claude-sonnet-4-6');
  assert.equal(after.id, 'claude-sonnet-4-6');
  assert.equal(runtime.getActiveModel().id, 'claude-sonnet-4-6');

  // Cruzar a Gemini (otro proveedor) → exige onboarding.
  assert.throws(() => runtime.setActiveModel('gemini-2.0-flash'), /ONBOARDING/);

  // Modelo fuera del catálogo → error.
  assert.throws(() => runtime.setActiveModel('inventado'), /NOT_IN_CATALOG/);

  // Tools registradas.
  const names = runtime.toolRegistry.list().map((t) => t.name);
  assert.ok(names.includes('model.catalog'));
  assert.ok(names.includes('model.set_active'));
});
