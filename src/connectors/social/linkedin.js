// Driver LinkedIn — Marketing API v2
// Soporta: texto, imagen, video (como UGC post)
// Auth: OAuth 2.0 — el usuario pega el token desde LinkedIn Developer Portal

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../../core/atomic-json');

const LI_API = 'https://api.linkedin.com/v2';
const CAPABILITIES = ['text', 'image', 'video'];

function createLinkedInDriver({ credentialVault, dataDir }) {
  const configFile = path.join(dataDir, 'social-linkedin-config.json');

  function loadConfig() {
    try { return JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch (_) { return null; }
  }

  function saveConfig(cfg) {
    fs.mkdirSync(dataDir, { recursive: true });
    writeJsonAtomic(configFile, { ...cfg, updatedAt: new Date().toISOString() });
  }

  async function liGet(endpoint, token) {
    const res = await fetch(`${LI_API}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' }
    });
    if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function liPost(endpoint, body, token) {
    const res = await fetch(`${LI_API}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return {
    id: 'linkedin',
    platforms: ['linkedin'],
    capabilities: CAPABILITIES,

    isConnected() {
      if (!loadConfig()) return false;
      return Boolean(credentialVault.get('LINKEDIN_ACCESS_TOKEN'));
    },

    onboardingInstructions() {
      return {
        steps: [
          '1. Ve a https://www.linkedin.com/developers/apps y crea o selecciona tu app',
          '2. En la app, ve a "Auth" → "OAuth 2.0 scopes" y agrega: r_liteprofile, w_member_social',
          '3. Para obtener el token: usa OAuth 2.0 Authorization Code Flow o el token de prueba en "OAuth Tools"',
          '4. Copia el Access Token (válido 60 días)',
          '5. Llama a social.connect { platform: "linkedin", accessToken: "..." }'
        ],
        note: 'LinkedIn requiere una app registrada. Para cuentas personales, el token de prueba de "OAuth Tools" funciona directamente.',
        docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api'
      };
    },

    async connect(input) {
      if (!input.accessToken) return { ok: false, needsToken: true, ...this.onboardingInstructions() };

      try {
        const profile = await liGet('/me', input.accessToken);
        credentialVault.set('LINKEDIN_ACCESS_TOKEN', input.accessToken, { source: 'social.connect' });
        saveConfig({ personUrn: `urn:li:person:${profile.id}`, name: `${profile.localizedFirstName} ${profile.localizedLastName}`, connectedAt: new Date().toISOString() });
        return { ok: true, platform: 'linkedin', user: `${profile.localizedFirstName} ${profile.localizedLastName}` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async publish(input) {
      if (!this.isConnected()) throw new Error('LinkedIn no configurado. Usa social.connect { platform: "linkedin" }.');

      const cfg = loadConfig();
      const token = credentialVault.get('LINKEDIN_ACCESS_TOKEN');
      const text = String(input.text || '').trim();
      const imageUrl = input.imageUrl ? String(input.imageUrl) : null;
      const videoPath = input.videoPath ? String(input.videoPath) : null;

      if (!text) throw new Error('LinkedIn requiere texto en el post.');

      // Post de texto simple o con imagen (UGC Post)
      const postBody = {
        author: cfg.personUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: imageUrl ? 'IMAGE' : 'NONE',
            ...(imageUrl ? {
              media: [{ status: 'READY', originalUrl: imageUrl, description: { text }, title: { text: text.slice(0, 50) } }]
            } : {})
          }
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
      };

      // Video requiere upload separado (resumable) — por ahora solo texto e imagen
      if (videoPath) {
        return { ok: false, error: 'LinkedIn video upload requiere el flujo de upload resumable de Assets API — pendiente de implementar. Por ahora usa texto o imagen.' };
      }

      const result = await liPost('/ugcPosts', postBody, token);
      return { ok: true, platform: 'linkedin', postId: result.id };
    }
  };
}

module.exports = { createLinkedInDriver };
