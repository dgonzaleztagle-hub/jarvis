// Driver TikTok — Content Posting API v2
// Soporta: video (Reels/Shorts estilo)
// Estado: onboarding implementado, publish pendiente de aprobación de app TikTok

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../../core/atomic-json');

const CAPABILITIES = ['video'];

function createTikTokDriver({ credentialVault, dataDir }) {
  const configFile = path.join(dataDir, 'social-tiktok-config.json');

  function loadConfig() {
    try { return JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch (_) { return null; }
  }

  function saveConfig(cfg) {
    fs.mkdirSync(dataDir, { recursive: true });
    writeJsonAtomic(configFile, { ...cfg, updatedAt: new Date().toISOString() });
  }

  return {
    id: 'tiktok',
    platforms: ['tiktok'],
    capabilities: CAPABILITIES,

    isConnected() {
      if (!loadConfig()) return false;
      try { credentialVault.get('TIKTOK_ACCESS_TOKEN'); return true; } catch (_) { return false; }
    },

    onboardingInstructions() {
      return {
        steps: [
          '1. Ve a https://developers.tiktok.com/ y crea una app de desarrollador',
          '2. Solicita el producto "Content Posting API" (requiere aprobación de TikTok, puede tardar días)',
          '3. Una vez aprobado, en tu app ve a "Manage apps" → tu app → "Auth"',
          '4. Genera un Access Token con el scope "video.upload,video.publish"',
          '5. Copia el Client Key, Client Secret y Access Token',
          '6. Llama a social.connect { platform: "tiktok", accessToken: "...", clientKey: "...", openId: "..." }'
        ],
        note: 'TikTok requiere aprobación de la app para el Content Posting API. El proceso puede tardar 1-7 días hábiles. Para testing puedes usar el Sandbox.',
        docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started'
      };
    },

    async connect(input) {
      if (!input.accessToken || !input.openId) {
        return { ok: false, needsToken: true, ...this.onboardingInstructions() };
      }

      // Verificar el token con una llamada básica al perfil
      try {
        const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
          headers: { Authorization: `Bearer ${input.accessToken}` }
        });
        const data = await res.json();
        if (data.error?.code && data.error.code !== 'ok') {
          return { ok: false, error: `TikTok: ${data.error.message}` };
        }

        credentialVault.set('TIKTOK_ACCESS_TOKEN', input.accessToken, { source: 'social.connect' });
        if (input.clientKey) credentialVault.set('TIKTOK_CLIENT_KEY', input.clientKey, { source: 'social.connect' });

        const profile = data.data?.user || {};
        saveConfig({ openId: input.openId, displayName: profile.display_name, connectedAt: new Date().toISOString() });

        return { ok: true, platform: 'tiktok', user: profile.display_name || input.openId };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async publish(input) {
      if (!this.isConnected()) throw new Error('TikTok no configurado. Usa social.connect { platform: "tiktok" }.');

      const videoPath = input.videoPath ? String(input.videoPath).trim() : null;
      if (!videoPath || !fs.existsSync(videoPath)) {
        throw new Error('TikTok requiere videoPath apuntando a un MP4 local.');
      }

      const token = credentialVault.get('TIKTOK_ACCESS_TOKEN');
      const cfg = loadConfig();

      // Paso 1: iniciar sesión de upload
      const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_info: { title: String(input.text || '').slice(0, 150), privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_stitch: false, disable_comment: false },
          source_info: { source: 'FILE_UPLOAD', video_size: fs.statSync(videoPath).size, chunk_size: fs.statSync(videoPath).size, total_chunk_count: 1 }
        })
      });
      const initData = await initRes.json();
      if (initData.error?.code !== 'ok') throw new Error(`TikTok init: ${initData.error?.message}`);

      const { publish_id, upload_url } = initData.data;

      // Paso 2: subir el binario
      const fileBuffer = fs.readFileSync(videoPath);
      const uploadRes = await fetch(upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes 0-${fileBuffer.length - 1}/${fileBuffer.length}`
        },
        body: fileBuffer
      });
      if (!uploadRes.ok) throw new Error(`TikTok upload error: ${uploadRes.status}`);

      return { ok: true, platform: 'tiktok', publishId: publish_id, note: 'Video enviado a TikTok. Puede tardar unos minutos en procesarse y aparecer en tu perfil.' };
    }
  };
}

module.exports = { createTikTokDriver };
