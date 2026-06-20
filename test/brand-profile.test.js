const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBrandProfileTools } = require('../src/connectors/brand-profile');
const { ContextAssembler } = require('../src/memory/context-assembler');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-brand-'));
}

function toolMap(tools) {
  return Object.fromEntries(tools.map((t) => [t.name, t]));
}

test('brand.save crea perfil y lo deja activo (primera marca)', async () => {
  const tools = toolMap(createBrandProfileTools({ dataDir: tempDataDir() }));
  const res = await tools['brand.save'].execute({
    name: 'Rishtedar',
    industry: 'restaurante indio',
    voice: 'cálido, auténtico',
    pillars: ['autenticidad', 'sabor casero']
  });
  assert.equal(res.ok, true);
  assert.equal(res.active, true);
  assert.match(res.summary, /Voz\/tono: cálido/);
});

test('brand.save acumula listas sin duplicar y mergea escalares', async () => {
  const tools = toolMap(createBrandProfileTools({ dataDir: tempDataDir() }));
  await tools['brand.save'].execute({ name: 'Hoja Cero', pillars: ['ingeniería'] });
  const res = await tools['brand.save'].execute({ name: 'hoja cero', pillars: ['ingeniería', 'AEO/GEO'], voice: 'técnico' });
  assert.equal(res.ok, true);
  const got = await tools['brand.get'].execute({ name: 'Hoja Cero' });
  assert.deepEqual(got.profile.pillars, ['ingeniería', 'AEO/GEO']);
  assert.equal(got.profile.voice, 'técnico');
});

test('brand.get sin name devuelve la marca activa', async () => {
  const tools = toolMap(createBrandProfileTools({ dataDir: tempDataDir() }));
  await tools['brand.save'].execute({ name: 'Rishtedar', voice: 'cálido' });
  const res = await tools['brand.get'].execute({});
  assert.equal(res.ok, true);
  assert.equal(res.profile.name, 'Rishtedar');
});

test('brand.get sin marcas devuelve error con hint', async () => {
  const tools = toolMap(createBrandProfileTools({ dataDir: tempDataDir() }));
  const res = await tools['brand.get'].execute({});
  assert.equal(res.ok, false);
  assert.match(res.hint, /brand\.save/);
});

test('brand.list y brand.set_active manejan multi-marca', async () => {
  const tools = toolMap(createBrandProfileTools({ dataDir: tempDataDir() }));
  await tools['brand.save'].execute({ name: 'Rishtedar' });
  await tools['brand.save'].execute({ name: 'Hoja Cero' });
  let list = await tools['brand.list'].execute();
  assert.equal(list.count, 2);
  assert.equal(list.active, 'Rishtedar'); // la primera quedó activa
  await tools['brand.set_active'].execute({ name: 'Hoja Cero' });
  list = await tools['brand.list'].execute();
  assert.equal(list.active, 'Hoja Cero');
});

test('getActiveProfile resuelve la única marca aunque no haya active explícito', async () => {
  const dir = tempDataDir();
  const tools = createBrandProfileTools({ dataDir: dir });
  await toolMap(tools)['brand.save'].execute({ name: 'Solo Marca', voice: 'x' });
  const profile = tools.getActiveProfile();
  assert.equal(profile.name, 'Solo Marca');
});

test('context-assembler inyecta [marca activa] solo en turnos de marketing', () => {
  const dir = tempDataDir();
  const tools = createBrandProfileTools({ dataDir: dir });
  // crear marca de forma síncrona via el tool
  const map = toolMap(tools);
  return map['brand.save'].execute({ name: 'Rishtedar', voice: 'cálido', pillars: ['autenticidad'] }).then(() => {
    const fakeStore = { list: () => [], search: () => [], get: () => null };
    const assembler = new ContextAssembler({
      memoryStore: fakeStore,
      getBrandProfile: tools.getActiveProfile,
      formatBrandProfile: tools.formatProfile
    });
    const mkt = assembler.assemble({ userText: 'armemos una campaña de marketing para el restaurante' });
    assert.match(mkt, /\[marca activa\]/);
    assert.match(mkt, /Rishtedar/);
    const other = assembler.assemble({ userText: 'qué hora es' });
    assert.doesNotMatch(other, /\[marca activa\]/);
  });
});
