// Social Hub — capa de tools unificada para todas las plataformas
// Drivers: Meta (FB+IG), TikTok, LinkedIn, YouTube
// Patrón JIT onboarding: verifica credenciales ANTES de publicar,
// dispara onboarding inline si alguna plataforma no está configurada.

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../core/atomic-json');

const { createMetaDriver } = require('./social/meta');
const { createTikTokDriver } = require('./social/tiktok');
const { createLinkedInDriver } = require('./social/linkedin');
const { createYouTubeDriver } = require('./social/youtube');

// Mapa de alias → id canónico del driver
const PLATFORM_ALIASES = {
  fb: 'meta', facebook: 'meta', meta: 'meta',
  ig: 'meta', instagram: 'meta',
  tiktok: 'tiktok', tt: 'tiktok',
  linkedin: 'linkedin', li: 'linkedin',
  youtube: 'youtube', yt: 'youtube'
};

// Plataformas que un driver cubre (para el status multi-plataforma)
const DRIVER_COVERS = {
  meta: ['fb', 'ig'],
  tiktok: ['tiktok'],
  linkedin: ['linkedin'],
  youtube: ['youtube']
};

function createSocialHubTools({ credentialVault, dataDir, googleAuthFactory }) {
  const postsFile = path.join(dataDir, 'social-posts.json');

  // Instanciar todos los drivers
  const drivers = {
    meta:     createMetaDriver({ credentialVault, dataDir }),
    tiktok:   createTikTokDriver({ credentialVault, dataDir }),
    linkedin: createLinkedInDriver({ credentialVault, dataDir }),
    youtube:  createYouTubeDriver({ credentialVault, dataDir, googleAuthFactory })
  };

  function loadPosts() {
    try { return JSON.parse(fs.readFileSync(postsFile, 'utf-8')); } catch (_) { return []; }
  }

  function savePosts(posts) {
    fs.mkdirSync(dataDir, { recursive: true });
    writeJsonAtomic(postsFile, posts);
  }

  // Resuelve lista de plataformas pedidas → { ok: [driverId,...], needsOnboarding: [{platform, driverId, instructions},...] }
  function checkPlatforms(requestedPlatforms) {
    const seen = new Set();
    const ok = [];
    const needsOnboarding = [];

    for (const p of requestedPlatforms) {
      const driverId = PLATFORM_ALIASES[p.toLowerCase()];
      if (!driverId) {
        needsOnboarding.push({ platform: p, error: `Plataforma desconocida: "${p}". Plataformas soportadas: fb, ig, tiktok, linkedin, youtube.` });
        continue;
      }
      if (seen.has(driverId)) continue;
      seen.add(driverId);

      const driver = drivers[driverId];
      if (driver.isConnected()) {
        ok.push(driverId);
      } else {
        needsOnboarding.push({
          platform: p,
          driverId,
          instructions: driver.onboardingInstructions()
        });
      }
    }

    return { ok, needsOnboarding };
  }

  return [
    // ── social.connect ───────────────────────────────────────────────────────
    {
      name: 'social.connect',
      description: 'Conectar una plataforma de redes sociales. Si no se pasan credenciales, devuelve instrucciones de onboarding.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Plataforma: fb, ig, meta, tiktok, linkedin, youtube' },
          token:        { type: 'string', description: 'Access token (Meta/LinkedIn)' },
          accessToken:  { type: 'string', description: 'Access token alternativo (TikTok/LinkedIn)' },
          pageId:       { type: 'string', description: 'ID de página de Facebook (opcional si hay varias)' },
          openId:       { type: 'string', description: 'open_id de TikTok' },
          clientKey:    { type: 'string', description: 'Client key de TikTok (opcional)' }
        },
        required: ['platform']
      },
      riskLevel: 'medium',
      async execute(input) {
        const driverId = PLATFORM_ALIASES[(input.platform || '').toLowerCase()];
        if (!driverId) {
          return { ok: false, error: `Plataforma desconocida: "${input.platform}". Soportadas: fb, ig, meta, tiktok, linkedin, youtube.` };
        }
        return drivers[driverId].connect(input);
      }
    },

    // ── social.status ────────────────────────────────────────────────────────
    {
      name: 'social.status',
      description: 'Muestra el estado de conexión de todas las plataformas de redes sociales.',
      input_schema: { type: 'object', properties: {} },
      riskLevel: 'low',
      async execute() {
        const status = {};
        for (const [driverId, driver] of Object.entries(drivers)) {
          const connected = driver.isConnected();
          status[driverId] = {
            connected,
            platforms: DRIVER_COVERS[driverId],
            ...(connected ? {} : { onboarding: driver.onboardingInstructions() })
          };
        }
        const posts = loadPosts();
        const scheduled = posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt) > new Date());
        return { platforms: status, scheduledPending: scheduled.length };
      }
    },

    // ── social.publish ────────────────────────────────────────────────────────
    {
      name: 'social.publish',
      description: 'Publica contenido en una o más plataformas. Si alguna no está configurada, devuelve instrucciones de onboarding antes de publicar.',
      input_schema: {
        type: 'object',
        properties: {
          platforms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de plataformas: ["ig", "tiktok", "linkedin", "youtube"]. Por defecto todas las conectadas.'
          },
          text:      { type: 'string', description: 'Texto / caption del post' },
          imageUrl:  { type: 'string', description: 'URL pública de imagen (Facebook/Instagram imagen)' },
          videoPath: { type: 'string', description: 'Ruta local al archivo MP4 (Instagram Reels, TikTok, YouTube, Facebook)' },
          tags:      { type: 'array', items: { type: 'string' }, description: 'Hashtags / etiquetas (YouTube)' },
          private:   { type: 'boolean', description: 'Subir como privado (YouTube)' }
        }
      },
      riskLevel: 'high',
      async execute(input) {
        const requestedPlatforms = Array.isArray(input.platforms) && input.platforms.length > 0
          ? input.platforms
          : Object.keys(drivers).filter((id) => drivers[id].isConnected()).flatMap((id) => DRIVER_COVERS[id]);

        if (requestedPlatforms.length === 0) {
          return {
            ok: false,
            error: 'Ninguna plataforma configurada.',
            hint: 'Usa social.connect { platform: "meta" } (o tiktok/linkedin/youtube) para conectar tu primera plataforma.'
          };
        }

        // JIT onboarding check
        const { ok: readyDriverIds, needsOnboarding } = checkPlatforms(requestedPlatforms);

        if (needsOnboarding.length > 0) {
          return {
            ok: false,
            needsOnboarding: true,
            message: `Antes de publicar, necesito configurar ${needsOnboarding.length} plataforma(s):`,
            platforms: needsOnboarding.map((n) => ({
              platform: n.platform,
              ...(n.error ? { error: n.error } : { instructions: n.instructions })
            })),
            hint: 'Llama a social.connect { platform: "...", ... } para cada plataforma y luego vuelve a social.publish.'
          };
        }

        // Publicar en todos los drivers listos
        const results = {};
        for (const driverId of readyDriverIds) {
          try {
            const driver = drivers[driverId];
            // Para Meta necesitamos pasar también la lista de sub-plataformas solicitadas
            const publishInput = driverId === 'meta'
              ? { ...input, platforms: requestedPlatforms.map((p) => PLATFORM_ALIASES[p.toLowerCase()]).includes('meta') ? requestedPlatforms.filter((p) => ['fb', 'ig', 'facebook', 'instagram', 'meta'].includes(p.toLowerCase())).map((p) => p.toLowerCase() === 'instagram' || p.toLowerCase() === 'ig' ? 'ig' : 'fb') : ['fb', 'ig'] }
              : input;
            results[driverId] = await driver.publish(publishInput);
          } catch (err) {
            results[driverId] = { ok: false, error: err.message };
          }
        }

        // Guardar en historial
        const posts = loadPosts();
        posts.push({
          id: Date.now().toString(36),
          text: input.text,
          imageUrl: input.imageUrl,
          videoPath: input.videoPath,
          platforms: requestedPlatforms,
          results,
          publishedAt: new Date().toISOString(),
          status: 'published'
        });
        savePosts(posts);

        const allOk = Object.values(results).every((r) => r.ok !== false);
        return { ok: allOk, results };
      }
    },

    // ── social.schedule_post ─────────────────────────────────────────────────
    {
      name: 'social.schedule_post',
      description: 'Guarda un post para publicación futura. El agente scheduler o el usuario deben ejecutar social.publish_scheduled cuando llegue el momento.',
      input_schema: {
        type: 'object',
        properties: {
          platforms:   { type: 'array', items: { type: 'string' } },
          text:        { type: 'string' },
          imageUrl:    { type: 'string' },
          videoPath:   { type: 'string' },
          scheduledAt: { type: 'string', description: 'ISO 8601 — cuándo publicar' }
        },
        required: ['scheduledAt']
      },
      riskLevel: 'low',
      async execute(input) {
        if (!input.text && !input.imageUrl && !input.videoPath) {
          return { ok: false, error: 'Se requiere al menos text, imageUrl o videoPath.' };
        }
        const posts = loadPosts();
        const id = Date.now().toString(36);
        posts.push({
          id,
          text: input.text,
          imageUrl: input.imageUrl,
          videoPath: input.videoPath,
          platforms: input.platforms || ['ig'],
          scheduledAt: input.scheduledAt,
          status: 'scheduled',
          createdAt: new Date().toISOString()
        });
        savePosts(posts);
        return { ok: true, id, scheduledAt: input.scheduledAt, message: `Post programado (id: ${id}). Llama a social.publish_scheduled para ejecutar los pendientes.` };
      }
    },

    // ── social.publish_scheduled ─────────────────────────────────────────────
    {
      name: 'social.publish_scheduled',
      description: 'Ejecuta todos los posts programados cuyo scheduledAt ya pasó.',
      input_schema: { type: 'object', properties: {} },
      riskLevel: 'medium',
      async execute() {
        const now = new Date();
        const posts = loadPosts();
        const due = posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt) <= now);

        if (due.length === 0) return { ok: true, published: 0, message: 'No hay posts pendientes por ejecutar.' };

        const published = [];
        for (const post of due) {
          const { ok: readyDriverIds, needsOnboarding } = checkPlatforms(post.platforms || []);
          if (needsOnboarding.length > 0) {
            post.status = 'blocked';
            post.blockReason = `Plataformas sin configurar: ${needsOnboarding.map((n) => n.platform).join(', ')}`;
            continue;
          }
          const results = {};
          for (const driverId of readyDriverIds) {
            try {
              results[driverId] = await drivers[driverId].publish(post);
            } catch (err) {
              results[driverId] = { ok: false, error: err.message };
            }
          }
          post.status = 'published';
          post.results = results;
          post.publishedAt = new Date().toISOString();
          published.push({ id: post.id, results });
        }

        savePosts(posts);
        return { ok: true, published: published.length, details: published };
      }
    },

    // ── social.list_posts ────────────────────────────────────────────────────
    {
      name: 'social.list_posts',
      description: 'Lista el historial de posts publicados y programados.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['published', 'scheduled', 'blocked', 'all'], description: 'Filtrar por estado (default: all)' },
          limit:  { type: 'number', description: 'Máximo de resultados (default: 20)' }
        }
      },
      riskLevel: 'low',
      async execute(input) {
        let posts = loadPosts();
        if (input.status && input.status !== 'all') {
          posts = posts.filter((p) => p.status === input.status);
        }
        posts = posts.slice(-(input.limit || 20)).reverse();
        return { total: posts.length, posts };
      }
    }
  ];
}

module.exports = { createSocialHubTools };
