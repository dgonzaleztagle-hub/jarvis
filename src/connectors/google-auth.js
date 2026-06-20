const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { loadEnvFile, getConfigValue } = require('../utils/env-file');

const LEGACY_PROJECT_DIR = 'C:\\proyectos\\jarvis-companion';
const CODEX_TOKEN_FILENAME = 'google-tokens.json';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/tasks'
];

// Google a menudo NO devuelve refresh_token al refrescar — nunca lo perdemos.
function mergeTokens(prev = {}, next = {}) {
  const merged = { ...(prev || {}), ...(next || {}) };
  if (!next?.refresh_token && prev?.refresh_token) merged.refresh_token = prev.refresh_token;
  return merged;
}

function hasRefresh(tokens) {
  return !!(tokens && tokens.refresh_token);
}

function isRevoked(err) {
  const msg = `${err?.message || ''} ${err?.response?.data?.error || ''}`;
  return /invalid_grant|expired or revoked|token has been/i.test(msg);
}

function createGoogleAuthFactory(options = {}) {
  const legacyEnvPath = options.legacyEnvPath || process.env.JARVIS_LEGACY_ENV_PATH || path.join(LEGACY_PROJECT_DIR, '.env');
  const legacyTokenPath = options.legacyTokenPath || process.env.JARVIS_GOOGLE_TOKEN_PATH || path.join(LEGACY_PROJECT_DIR, '.google-tokens.json');
  const codexTokenPath = options.codexTokenPath || path.join(options.dataDir || '.', CODEX_TOKEN_FILENAME);
  const fallbackEnv = loadEnvFile(legacyEnvPath);

  const CODEX_REDIRECT_URI = `http://localhost:${process.env.PORT || 3417}/auth/google/callback`;

  // El archivo legacy del companion es SOLO semilla de migración para desarrollo.
  // En producción no existe: el vault es la única fuente. Opt-in explícito (server.js
  // lo activa) para que tests con dataDir temporal no dependan de tokens reales de
  // otro proyecto en la máquina del dev.
  const allowLegacyFallback = options.allowLegacyFallback === true;
  const DISCONNECT_KEY = 'GOOGLE_AUTH_DISCONNECTED';

  // Estado de salud de la auth. needsReauth = el refresh_token está revocado y
  // NINGUNA fuente sirve; requiere que el usuario vuelva a autorizar.
  const authState = { needsReauth: false, lastError: null, source: null, checkedAt: null };

  function isDisconnected() {
    return !!options.vault?.get(DISCONNECT_KEY);
  }

  function getCredentials() {
    const clientId = options.vault?.get('GOOGLE_CLIENT_ID') || getConfigValue('GOOGLE_CLIENT_ID', fallbackEnv);
    const clientSecret = options.vault?.get('GOOGLE_CLIENT_SECRET') || getConfigValue('GOOGLE_CLIENT_SECRET', fallbackEnv);
    if (!clientId || !clientSecret) throw new Error('GOOGLE_OAUTH_CONFIG_MISSING');
    return { clientId, clientSecret };
  }

  function readFileTokens(filePath) {
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (_) {}
    return null;
  }

  function writeFileTokens(filePath, tokens) {
    try {
      const prev = readFileTokens(filePath) || {};
      const merged = mergeTokens(prev, tokens);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
      fs.renameSync(tmp, filePath);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        try { fs.writeFileSync(filePath, JSON.stringify(mergeTokens(readFileTokens(filePath) || {}, tokens), null, 2), 'utf-8'); } catch (_) {}
      }
    }
  }

  // Fuente de verdad: el vault. Todo refresh exitoso vuelve acá (y a un archivo
  // de respaldo), de modo que nunca quede una foto vieja con prioridad.
  function persistTokens(tokens) {
    if (options.vault) {
      const prev = options.vault.get('GOOGLE_OAUTH_TOKENS') || {};
      try {
        options.vault.set('GOOGLE_OAUTH_TOKENS', mergeTokens(prev, tokens), {
          source: 'google_refresh',
          updatedAt: new Date().toISOString()
        });
      } catch (_) {}
    }
    writeFileTokens(codexTokenPath, tokens);
  }

  // Reúne los tokens disponibles, etiquetados por fuente.
  // Tras un disconnect explícito, SOLO se honra el vault (lo que el usuario
  // reconectó); nada de resucitar archivos de dev/legacy.
  function gatherCandidates() {
    const out = [];
    const vt = options.vault?.get('GOOGLE_OAUTH_TOKENS');
    if (vt) out.push({ tokens: vt, source: 'vault' });
    if (isDisconnected()) return out;

    const ct = readFileTokens(codexTokenPath);
    if (ct) out.push({ tokens: ct, source: 'codex' });
    if (allowLegacyFallback) {
      const lt = readFileTokens(legacyTokenPath);
      if (lt) out.push({ tokens: lt, source: 'companion' });
    }
    return out;
  }

  // Elige el mejor token: debe poder refrescar; entre esos, el de expiry más
  // reciente (proxy de "el que estuvo funcionando hace menos"). Así el sistema
  // NO se queda pegado a un token muerto teniendo uno bueno al lado.
  function selectBest(candidates) {
    const refreshable = candidates.filter((c) => hasRefresh(c.tokens));
    const pool = refreshable.length ? refreshable : candidates;
    pool.sort((a, b) => (b.tokens.expiry_date || 0) - (a.tokens.expiry_date || 0));
    return pool[0] || null;
  }

  function attachRefreshListener(client) {
    client.on('tokens', (newTokens) => persistTokens(newTokens));
    return client;
  }

  function buildClient(tokens) {
    const { clientId, clientSecret } = getCredentials();
    const redirectUri = options.vault?.get('GOOGLE_REDIRECT_URI') || getConfigValue('GOOGLE_REDIRECT_URI', fallbackEnv);
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri || CODEX_REDIRECT_URI);
    client.setCredentials(tokens);
    return attachRefreshListener(client);
  }

  function getClient() {
    const best = selectBest(gatherCandidates());
    if (!best) throw new Error('GOOGLE_TOKENS_MISSING');
    // Promueve el token elegido al vault para que sea la única fuente autoritativa
    // y los futuros refresh actualicen un solo lugar (no más fotos viejas).
    if (best.source !== 'vault') persistTokens(best.tokens);
    authState.source = best.source;
    return buildClient(best.tokens);
  }

  // Validación REAL: fuerza un refresh y dice la verdad. Si un token está revocado
  // (invalid_grant), prueba el siguiente candidato; si ninguno sirve, marca
  // needsReauth. Esto es lo que el HUD debe mostrar, no un "existe un archivo".
  async function healthCheck() {
    const candidates = gatherCandidates()
      .filter((c) => hasRefresh(c.tokens))
      .sort((a, b) => (b.tokens.expiry_date || 0) - (a.tokens.expiry_date || 0));

    if (candidates.length === 0) {
      Object.assign(authState, { needsReauth: true, lastError: 'no_tokens', source: null, checkedAt: Date.now() });
      return { ok: false, reason: 'no_tokens', needsReauth: true };
    }

    for (const candidate of candidates) {
      try {
        const client = buildClient(candidate.tokens);
        const { token } = await client.getAccessToken(); // fuerza refresh si está vencido
        if (token) {
          persistTokens(client.credentials); // el que funciona pasa a ser autoritativo
          Object.assign(authState, { needsReauth: false, lastError: null, source: candidate.source, checkedAt: Date.now() });
          return { ok: true, source: candidate.source };
        }
      } catch (error) {
        authState.lastError = error.message;
        if (!isRevoked(error)) {
          // Error transitorio/red — no es para re-autorizar.
          Object.assign(authState, { checkedAt: Date.now() });
          return { ok: false, reason: error.message, needsReauth: false };
        }
        // invalid_grant: este token está muerto, sigue con el próximo.
      }
    }

    Object.assign(authState, { needsReauth: true, lastError: 'invalid_grant', source: null, checkedAt: Date.now() });
    return { ok: false, reason: 'invalid_grant', needsReauth: true };
  }

  // Best-effort sincrónico, basado en verdad de terreno (marca + presencia de
  // token), no en flags en memoria que se quedan pegados tras restart o reconexión.
  // La validación REAL (token revocado vs vivo) la da healthCheck.
  function getStatus() {
    const candidates = gatherCandidates();
    const hasUsable = candidates.some((c) => hasRefresh(c.tokens));
    const disconnected = isDisconnected();
    return {
      connected: hasUsable && !disconnected,
      source: candidates[0]?.source || null,
      needsReauth: disconnected || !hasUsable,
      lastError: authState.lastError,
      checkedAt: authState.checkedAt
    };
  }

  function generateAuthUrl() {
    const { clientId, clientSecret } = getCredentials();
    const client = new google.auth.OAuth2(clientId, clientSecret, CODEX_REDIRECT_URI);
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent'
    });
  }

  async function exchangeCode(code) {
    const { clientId, clientSecret } = getCredentials();
    const client = new google.auth.OAuth2(clientId, clientSecret, CODEX_REDIRECT_URI);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    // Reconectar levanta la marca de disconnect y repuebla la fuente autoritativa.
    try { options.vault?.delete(DISCONNECT_KEY); } catch (_) {}
    persistTokens(tokens);
    Object.assign(authState, { needsReauth: false, lastError: null, source: options.vault ? 'vault' : 'codex', checkedAt: Date.now() });
    return tokens;
  }

  // Cierra sesión de Google de verdad: revoca en Google, borra el token de TODAS
  // las fuentes nuestras y deja una marca para que nada lo resucite. Pensado para
  // que un usuario que probó con su Google personal cambie al de empresa limpio.
  async function disconnect({ revoke = true } = {}) {
    const current = options.vault?.get('GOOGLE_OAUTH_TOKENS') || readFileTokens(codexTokenPath);
    if (revoke && current?.refresh_token) {
      try {
        const { clientId, clientSecret } = getCredentials();
        const client = new google.auth.OAuth2(clientId, clientSecret, CODEX_REDIRECT_URI);
        client.setCredentials(current);
        await client.revokeCredentials();
      } catch (_) {
        // Si Google ya lo tenía revocado o no hay red, igual limpiamos local.
      }
    }
    try { options.vault?.delete('GOOGLE_OAUTH_TOKENS'); } catch (_) {}
    try { if (fs.existsSync(codexTokenPath)) fs.rmSync(codexTokenPath, { force: true }); } catch (_) {}
    try { options.vault?.set(DISCONNECT_KEY, true, { source: 'user_disconnect', at: new Date().toISOString() }); } catch (_) {}
    Object.assign(authState, { needsReauth: true, lastError: 'disconnected', source: null, checkedAt: Date.now() });
    return { disconnected: true };
  }

  return {
    getClient,
    getStatus,
    healthCheck,
    disconnect,
    generateAuthUrl,
    exchangeCode,
    legacyEnvPath,
    legacyTokenPath,
    codexTokenPath
  };
}

module.exports = { createGoogleAuthFactory };
