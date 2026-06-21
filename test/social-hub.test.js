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
