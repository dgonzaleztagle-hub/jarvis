const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSocialHubTools } = require('../src/connectors/social-hub');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-social-'));
}

function toolMap(tools) {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function fakeVault(values = {}) {
  return {
    get: (name) => values[name] ?? null,
    set: (name, value) => { values[name] = value; return { name }; }
  };
}

test('social.status no marca plataformas como conectadas solo por tener config local sin token', async () => {
  const dataDir = tempDataDir();
  fs.writeFileSync(path.join(dataDir, 'social-meta-config.json'), JSON.stringify({ pageId: 'page_1' }), 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'social-tiktok-config.json'), JSON.stringify({ openId: 'tt_1' }), 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'social-linkedin-config.json'), JSON.stringify({ personUrn: 'urn:li:person:1' }), 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'social-youtube-config.json'), JSON.stringify({ channelId: 'yt_1' }), 'utf-8');

  const tools = toolMap(createSocialHubTools({
    credentialVault: fakeVault(),
    dataDir,
    googleAuthFactory: { getClient: () => ({}) }
  }));

  const status = await tools['social.status'].execute();
  assert.equal(status.platforms.meta.connected, false);
  assert.equal(status.platforms.tiktok.connected, false);
  assert.equal(status.platforms.linkedin.connected, false);
  assert.equal(status.platforms.youtube.connected, true, 'YouTube usa Google OAuth + config local');
});

test('social.publish devuelve onboarding si la plataforma pedida no tiene token real', async () => {
  const dataDir = tempDataDir();
  fs.writeFileSync(path.join(dataDir, 'social-linkedin-config.json'), JSON.stringify({ personUrn: 'urn:li:person:1' }), 'utf-8');
  const tools = toolMap(createSocialHubTools({
    credentialVault: fakeVault(),
    dataDir,
    googleAuthFactory: null
  }));

  const result = await tools['social.publish'].execute({
    platforms: ['linkedin'],
    text: 'Post de prueba'
  });

  assert.equal(result.ok, false);
  assert.equal(result.needsOnboarding, true);
  assert.equal(result.platforms[0].platform, 'linkedin');
  assert.ok(result.platforms[0].instructions);
});

function withMockFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = async (url, opts) => handler(String(url), opts);
  return fn().finally(() => { global.fetch = original; });
}

function seedMetaPost(dataDir, { id, fbPostId }) {
  fs.writeFileSync(path.join(dataDir, 'social-meta-config.json'), JSON.stringify({ pageId: 'page_1' }), 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'social-posts.json'), JSON.stringify([{
    id, text: 'Lanzamiento del nuevo blend', platforms: ['fb'],
    results: { meta: { facebook: { ok: true, postId: fbPostId } } },
    publishedAt: new Date().toISOString(), status: 'published'
  }]), 'utf-8');
}

test('social.insights lee metricas reales de Meta sin pegarle a la red', async () => {
  const dataDir = tempDataDir();
  seedMetaPost(dataDir, { id: 'post_1', fbPostId: 'fb_999' });

  const tools = toolMap(createSocialHubTools({
    credentialVault: fakeVault({ META_PAGE_ACCESS_TOKEN: 'fake-token' }),
    dataDir,
    googleAuthFactory: null
  }));

  await withMockFetch((url) => {
    assert.ok(url.includes('/fb_999/insights'));
    return { json: async () => ({ data: [
      { name: 'post_impressions', values: [{ value: 340 }] },
      { name: 'post_engaged_users', values: [{ value: 28 }] }
    ] }) };
  }, async () => {
    const result = await tools['social.insights'].execute({ postId: 'post_1' });
    assert.equal(result.ok, true);
    assert.equal(result.metrics.post_impressions, 340);
    assert.equal(result.metrics.post_engaged_users, 28);
  });
});

test('social.insights devuelve error claro si el post no tiene resultados de Meta', async () => {
  const dataDir = tempDataDir();
  fs.writeFileSync(path.join(dataDir, 'social-posts.json'), JSON.stringify([{ id: 'post_x', status: 'published', results: {} }]), 'utf-8');
  const tools = toolMap(createSocialHubTools({ credentialVault: fakeVault(), dataDir, googleAuthFactory: null }));

  const result = await tools['social.insights'].execute({ postId: 'post_x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Meta/);
});

test('social.report agrega reach total y encuentra el mejor post', async () => {
  const dataDir = tempDataDir();
  fs.writeFileSync(path.join(dataDir, 'social-meta-config.json'), JSON.stringify({ pageId: 'page_1' }), 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'social-posts.json'), JSON.stringify([
    { id: 'p1', text: 'Post bajo', status: 'published', results: { meta: { facebook: { postId: 'fb_1' } } }, publishedAt: '2026-06-01T00:00:00Z' },
    { id: 'p2', text: 'Post estrella', status: 'published', results: { meta: { facebook: { postId: 'fb_2' } } }, publishedAt: '2026-06-02T00:00:00Z' }
  ]), 'utf-8');

  const tools = toolMap(createSocialHubTools({
    credentialVault: fakeVault({ META_PAGE_ACCESS_TOKEN: 'fake-token' }),
    dataDir,
    googleAuthFactory: null
  }));

  const reachByPost = { fb_1: 50, fb_2: 500 };
  await withMockFetch((url) => {
    const id = url.match(/\/(fb_\d)\/insights/)[1];
    return { json: async () => ({ data: [{ name: 'post_impressions', values: [{ value: reachByPost[id] }] }] }) };
  }, async () => {
    const result = await tools['social.report'].execute({ limit: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.postsAnalyzed, 2);
    assert.equal(result.totalReach, 550);
    assert.equal(result.bestPost.postId, 'p2');
  });
});
