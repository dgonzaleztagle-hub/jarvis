// Driver Meta — Facebook Pages + Instagram Business
// Soporta: texto, imagen, video/Reels
//
// Instagram Reels usa upload binario (Meta Resumable Upload API) para que
// el archivo local no necesite ser públicamente accesible.

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../../core/atomic-json');

const META_API = 'https://graph.facebook.com/v20.0';
const CONFIG_KEY = 'meta';

const CAPABILITIES = ['text', 'image', 'video'];

// ─── Helpers HTTP ────────────────────────────────────────────────────────────

async function metaGet(endpoint, token) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const res = await fetch(`${META_API}${endpoint}${sep}access_token=${encodeURIComponent(token)}`);
  const json = await res.json();
  if (json.error) throw new Error(`META: ${json.error.message} (code ${json.error.code})`);
  return json;
}

async function metaPost(endpoint, body, token) {
  const params = new URLSearchParams({ ...body, access_token: token });
  const res = await fetch(`${META_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const json = await res.json();
  if (json.error) throw new Error(`META: ${json.error.message} (code ${json.error.code})`);
  return json;
}

// Upload binario para video (evita necesidad de URL pública)
async function metaUploadBinary(endpoint, fileBuffer, mimeType, token) {
  const { FormData, Blob } = await import('node:buffer').catch(() => ({ FormData: global.FormData, Blob: global.Blob }));

  // Node 18+ tiene fetch + FormData global; en versiones anteriores usar form-data
  let form;
  try {
    form = new global.FormData();
    form.append('access_token', token);
    form.append('source', new Blob([fileBuffer], { type: mimeType }), 'video.mp4');
  } catch (_) {
    // Fallback: multipart manual vía fetch con Buffer
    const boundary = `boundary_${Date.now()}`;
    const CRLF = '\r\n';
    const tokenPart = Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="access_token"${CRLF}${CRLF}${token}${CRLF}`
    );
    const filePart = Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="source"; filename="video.mp4"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`
    );
    const end = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
    const body = Buffer.concat([tokenPart, filePart, fileBuffer, end]);
    const res = await fetch(`${META_API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    const json = await res.json();
    if (json.error) throw new Error(`META: ${json.error.message} (code ${json.error.code})`);
    return json;
  }

  const res = await fetch(`${META_API}${endpoint}`, { method: 'POST', body: form });
  const json = await res.json();
  if (json.error) throw new Error(`META: ${json.error.message} (code ${json.error.code})`);
  return json;
}

// Polling hasta que el container de IG esté listo (max 120s)
async function waitForIgContainer(creationId, token, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const data = await metaGet(`/${creationId}?fields=status_code,status`, token);
    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR') throw new Error(`META_IG_CONTAINER_ERROR: ${data.status}`);
  }
  throw new Error('META_IG_CONTAINER_TIMEOUT: el container de video tardó demasiado');
}

// ─── Driver ──────────────────────────────────────────────────────────────────

function createMetaDriver({ credentialVault, dataDir }) {
  const configFile = path.join(dataDir, 'social-meta-config.json');
  const postsFile = path.join(dataDir, 'social-posts.json');

  function loadConfig() {
    try { return JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch (_) { return null; }
  }

  function saveConfig(cfg) {
    fs.mkdirSync(dataDir, { recursive: true });
    writeJsonAtomic(configFile, { ...cfg, updatedAt: new Date().toISOString() });
  }

  function loadPosts() {
    try { return JSON.parse(fs.readFileSync(postsFile, 'utf-8')); } catch (_) { return []; }
  }

  function savePosts(posts) {
    writeJsonAtomic(postsFile, posts);
  }

  async function getToken() {
    return credentialVault.get('META_PAGE_ACCESS_TOKEN');
  }

  return {
    id: 'meta',
    platforms: ['fb', 'ig'],
    capabilities: CAPABILITIES,

    isConnected() {
      const cfg = loadConfig();
      if (!cfg?.pageId) return false;
      return Boolean(credentialVault.get('META_PAGE_ACCESS_TOKEN'));
    },

    onboardingInstructions() {
      return {
        steps: [
          '1. Ve a https://developers.facebook.com/tools/explorer/',
          '2. Selecciona o crea tu App en el selector superior',
          '3. Click "Generar token de acceso de usuario"',
          '4. Marca estos permisos: pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish',
          '5. Click "Generar token" y cópialo',
          '6. Llama a social.connect { platform: "meta", token: "<token_copiado>" }'
        ],
        note: 'Requiere al menos una Facebook Business Page. Para Instagram, la página debe tener una cuenta IG Profesional vinculada.',
        docsUrl: 'https://developers.facebook.com/docs/instagram-api/getting-started'
      };
    },

    async connect(input) {
      const token = input.token;
      if (!token) return { ok: false, needsToken: true, ...this.onboardingInstructions() };

      let meData;
      try {
        meData = await metaGet('/me/accounts', token);
      } catch (err) {
        return { ok: false, error: err.message, note: 'Token inválido o sin permisos de páginas.' };
      }

      const pages = (meData.data || []).map((p) => ({
        id: p.id, name: p.name, pageToken: p.access_token, category: p.category
      }));

      if (pages.length === 0) {
        return { ok: false, error: 'No se encontraron páginas de Facebook.', note: 'Asegúrate de tener una Facebook Business Page y de marcar el permiso pages_show_list.' };
      }

      const targetPage = input.pageId ? pages.find((p) => p.id === input.pageId) : pages[0];
      if (!targetPage) {
        return { ok: false, pages, error: `Página "${input.pageId}" no encontrada.`, note: 'Llama de nuevo con { platform: "meta", token, pageId } para elegir.' };
      }

      let igAccountId = null;
      try {
        const igData = await metaGet(`/${targetPage.id}?fields=instagram_business_account`, targetPage.pageToken);
        igAccountId = igData.instagram_business_account?.id || null;
      } catch (err) {
        // No bloquea el connect (FB queda igual), pero distingue "no hay IG" de
        // "el token no alcanza para verlo": sin esto, debuggear es a ciegas.
        console.warn(`[jarvis-codex] no se pudo resolver la cuenta IG de la página: ${err.message}`);
      }

      credentialVault.set('META_PAGE_ACCESS_TOKEN', targetPage.pageToken, { source: 'social.connect' });
      credentialVault.set('META_USER_TOKEN', token, { source: 'social.connect' });

      const cfg = { pageId: targetPage.id, pageName: targetPage.name, igAccountId, connectedAt: new Date().toISOString() };
      saveConfig(cfg);

      return {
        ok: true,
        platform: 'meta',
        page: targetPage.name,
        pageId: targetPage.id,
        instagramLinked: Boolean(igAccountId),
        availablePages: pages.length > 1 ? pages.map((p) => ({ id: p.id, name: p.name })) : undefined,
        note: igAccountId
          ? 'Facebook e Instagram listos.'
          : 'Facebook listo. Instagram no encontrado — vincula una cuenta IG Profesional en Meta Business Suite.'
      };
    },

    async publish(input) {
      const cfg = loadConfig();
      if (!cfg) throw new Error('Meta no configurado. Usa social.connect { platform: "meta" }.');
      const token = await getToken();
      if (!token) throw new Error('Meta no configurado. Usa social.connect { platform: "meta" }.');
      const platforms = Array.isArray(input.platforms)
        ? input.platforms.filter((p) => ['fb', 'ig'].includes(p))
        : ['fb', 'ig'];

      const text = String(input.text || '').trim();
      const imageUrl = input.imageUrl ? String(input.imageUrl).trim() : null;
      // videoPath es ruta local al MP4 renderizado
      const videoPath = input.videoPath ? String(input.videoPath).trim() : null;
      const isVideo = Boolean(videoPath && fs.existsSync(videoPath));

      if (!text && !imageUrl && !videoPath) throw new Error('Se requiere text, imageUrl o videoPath.');
      if (platforms.includes('ig') && !imageUrl && !isVideo) {
        throw new Error('Instagram requiere imageUrl o videoPath.');
      }

      const results = {};

      // ── Facebook ──────────────────────────────────────────────────────────
      if (platforms.includes('fb')) {
        if (isVideo) {
          const fileBuffer = fs.readFileSync(videoPath);
          const fbRes = await metaUploadBinary(
            `/${cfg.pageId}/videos`,
            fileBuffer, 'video/mp4', token
          );
          // También se puede pasar description. Si falla, NO mentir éxito total:
          // el video quedó publicado pero mudo, y el usuario debe saberlo.
          let captionOk = true;
          if (text) {
            try {
              await metaPost(`/${fbRes.id}`, { description: text }, token);
            } catch (err) {
              captionOk = false;
              console.warn(`[jarvis-codex] FB video subido pero la descripción no se adjuntó: ${err.message}`);
            }
          }
          results.facebook = captionOk
            ? { ok: true, videoId: fbRes.id }
            : { ok: true, videoId: fbRes.id, captionFailed: true, note: 'El video se publicó pero el texto no se pudo adjuntar.' };
        } else {
          const body = { message: text };
          if (imageUrl) body.link = imageUrl;
          const fbRes = await metaPost(`/${cfg.pageId}/feed`, body, token);
          results.facebook = { ok: true, postId: fbRes.id };
        }
      }

      // ── Instagram ─────────────────────────────────────────────────────────
      if (platforms.includes('ig') && cfg.igAccountId) {
        if (isVideo) {
          // Reels: upload binario → container → esperar → publicar
          const fileBuffer = fs.readFileSync(videoPath);
          const uploadRes = await metaUploadBinary(
            `/${cfg.igAccountId}/media`,
            fileBuffer, 'video/mp4', token
          );
          // El container necesita los metadatos por separado
          await metaPost(`/${cfg.igAccountId}/media`, {
            media_type: 'REELS',
            video_id: uploadRes.video_id || uploadRes.id,
            caption: text,
            share_to_feed: 'true'
          }, token);
          // Crear container con caption
          const container = await metaPost(`/${cfg.igAccountId}/media`, {
            media_type: 'REELS',
            video_url: `https://graph.facebook.com/v20.0/${uploadRes.video_id || uploadRes.id}?fields=source&access_token=${token}`,
            caption: text,
            share_to_feed: 'true'
          }, token);
          await waitForIgContainer(container.id, token);
          const igRes = await metaPost(`/${cfg.igAccountId}/media_publish`, { creation_id: container.id }, token);
          results.instagram = { ok: true, mediaId: igRes.id, type: 'reel' };
        } else if (imageUrl) {
          const container = await metaPost(`/${cfg.igAccountId}/media`, { image_url: imageUrl, caption: text }, token);
          const igRes = await metaPost(`/${cfg.igAccountId}/media_publish`, { creation_id: container.id }, token);
          results.instagram = { ok: true, mediaId: igRes.id, type: 'image' };
        }
      } else if (platforms.includes('ig') && !cfg.igAccountId) {
        results.instagram = { ok: false, error: 'Instagram no vinculado. Reconecta con social.connect { platform: "meta" }.' };
      }

      // Historial
      const posts = loadPosts();
      posts.push({
        id: Date.now().toString(36), text, imageUrl, videoPath, platforms,
        results, publishedAt: new Date().toISOString(), status: 'published'
      });
      savePosts(posts);

      return results;
    },

    async insights(postId, platform = 'fb') {
      const token = await getToken();
      if (!token) throw new Error('Meta no configurado. Usa social.connect { platform: "meta" }.');
      if (!postId) throw new Error('insights requiere postId.');

      // FB (post de página) e IG (media) usan métricas distintas en la API.
      const metric = platform === 'ig'
        ? 'impressions,reach,saved,likes,comments,shares'
        : 'post_impressions,post_engaged_users,post_reactions_by_type_total,post_clicks';

      try {
        const data = await metaGet(`/${postId}/insights?metric=${metric}`, token);
        const values = {};
        for (const item of (data.data || [])) {
          values[item.name] = item.values?.[0]?.value ?? item.values?.[0]?.values ?? null;
        }
        return { ok: true, postId, platform, metrics: values };
      } catch (err) {
        // No todas las métricas aplican a todo tipo de media (ej. Reels vs imagen
        // estática) — devolver el error real en vez de fingir métricas vacías.
        return { ok: false, postId, platform, error: err.message };
      }
    },

    loadPosts,
    savePosts
  };
}

module.exports = { createMetaDriver };
