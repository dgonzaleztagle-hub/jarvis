// Driver YouTube — Data API v3 (YouTube Shorts via upload normal de video)
// Soporta: video (incluido Shorts si duración < 60s y ratio 9:16)
// Auth: reutiliza el Google OAuth de Jarvis (googleAuthFactory)

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../../core/atomic-json');

const CAPABILITIES = ['video'];

function createYouTubeDriver({ credentialVault, dataDir, googleAuthFactory }) {
  const configFile = path.join(dataDir, 'social-youtube-config.json');

  function loadConfig() {
    try { return JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch (_) { return null; }
  }

  function saveConfig(cfg) {
    fs.mkdirSync(dataDir, { recursive: true });
    writeJsonAtomic(configFile, { ...cfg, updatedAt: new Date().toISOString() });
  }

  return {
    id: 'youtube',
    platforms: ['youtube'],
    capabilities: CAPABILITIES,

    isConnected() {
      // YouTube usa Google OAuth, pero "conectado" significa que el usuario ya
      // validó el canal con social.connect y quedó config local para publicar.
      if (!googleAuthFactory) return false;
      if (!loadConfig()) return false;
      try { googleAuthFactory.getClient(); return true; } catch (_) { return false; }
    },

    onboardingInstructions() {
      // Si Google ya está conectado, YouTube hereda ese auth — solo necesita habilitar el scope
      const googleConnected = googleAuthFactory ? (() => { try { googleAuthFactory.getClient(); return true; } catch (_) { return false; } })() : false;
      if (googleConnected) {
        return {
          steps: [
            '1. Ya tienes Google conectado — YouTube usa el mismo auth',
            '2. Solo necesitas re-autorizar con el scope de YouTube agregado: ve a /auth/google en el HUD',
            '3. Marca "YouTube Data API" durante el proceso de autorización',
            '4. Llama a social.connect { platform: "youtube" } para confirmar'
          ],
          note: 'Si ya re-autorizaste con el scope de YouTube, el paso 2 no es necesario.'
        };
      }
      return {
        steps: [
          '1. Primero conecta Google: ve a /auth/google en el HUD',
          '2. Durante la autorización, asegúrate de incluir el scope de YouTube',
          '3. Luego llama a social.connect { platform: "youtube" }'
        ],
        note: 'YouTube usa el mismo OAuth de Google que ya usa Jarvis para Gmail, Calendar y Drive.'
      };
    },

    async connect(input) {
      if (!googleAuthFactory) return { ok: false, error: 'Google Auth no disponible en esta instancia de Jarvis.' };

      try {
        const auth = googleAuthFactory.getClient();
        const { google } = require('googleapis');
        const yt = google.youtube({ version: 'v3', auth });
        const me = await yt.channels.list({ part: 'snippet', mine: true });
        const channel = me.data.items?.[0];
        if (!channel) return { ok: false, error: 'No se encontró ningún canal de YouTube en esta cuenta de Google.' };

        saveConfig({ channelId: channel.id, channelName: channel.snippet.title, connectedAt: new Date().toISOString() });
        return { ok: true, platform: 'youtube', channel: channel.snippet.title, channelId: channel.id };
      } catch (err) {
        if (err.message?.includes('insufficient')) {
          return { ok: false, error: 'Falta el scope de YouTube. Re-autoriza en /auth/google.', ...this.onboardingInstructions() };
        }
        return { ok: false, error: err.message };
      }
    },

    async publish(input) {
      if (!this.isConnected()) throw new Error('YouTube no configurado. Usa social.connect { platform: "youtube" }.');

      const videoPath = input.videoPath ? String(input.videoPath).trim() : null;
      if (!videoPath || !fs.existsSync(videoPath)) throw new Error('YouTube requiere videoPath apuntando a un MP4 local.');

      const text = String(input.text || '').trim();
      const cfg = loadConfig();

      try {
        const auth = googleAuthFactory.getClient();
        const { google } = require('googleapis');
        const yt = google.youtube({ version: 'v3', auth });

        const res = await yt.videos.insert({
          part: 'snippet,status',
          requestBody: {
            snippet: {
              title: text.slice(0, 100) || 'Video de Jarvis',
              description: text,
              tags: input.tags || [],
              categoryId: '22'  // People & Blogs
            },
            status: { privacyStatus: input.private ? 'private' : 'public' }
          },
          media: { mimeType: 'video/mp4', body: fs.createReadStream(videoPath) }
        });

        const videoId = res.data.id;
        return {
          ok: true,
          platform: 'youtube',
          videoId,
          url: `https://youtu.be/${videoId}`,
          note: videoId ? 'Video subido. YouTube puede tardar unos minutos en procesarlo.' : 'Subida iniciada.'
        };
      } catch (err) {
        if (err.message?.includes('quota')) return { ok: false, error: 'YouTube API quota agotada. La cuota se resetea a medianoche PT.' };
        return { ok: false, error: err.message };
      }
    }
  };
}

module.exports = { createYouTubeDriver };
