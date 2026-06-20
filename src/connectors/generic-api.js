// Conector REST genérico: permite conectar cualquier API HTTP sin escribir código.
// El usuario (o Jarvis tras investigar) provee: base URL, auth, y definición de endpoints.
// Genera tools dinámicamente bajo el namespace del servicio.

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../core/atomic-json');

function getStorePath(dataDir) {
  return path.join(dataDir, 'api-connections.json');
}

function loadApiConnections(dataDir) {
  const file = getStorePath(dataDir);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
}

function saveApiConnections(dataDir, connections) {
  writeJsonAtomic(getStorePath(dataDir), connections);
}

function buildAuthHeaders(auth = {}) {
  const headers = {};
  switch (String(auth.type || '').toLowerCase()) {
    case 'bearer':
      if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
      break;
    case 'apikey':
      if (auth.key) headers[auth.header || 'X-API-Key'] = auth.key;
      break;
    case 'basic':
      if (auth.username && auth.password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
      }
      break;
    case 'token':
      if (auth.token) headers['Authorization'] = `Token ${auth.token}`;
      break;
  }
  return headers;
}

async function callEndpoint({ baseUrl, authHeaders, endpoint, input = {}, timeoutMs = 15000 }) {
  const method = String(endpoint.method || 'GET').toUpperCase();

  // Interpolar parámetros de path: /users/{userId} → /users/123
  let urlPath = String(endpoint.path || '/');
  for (const [key, value] of Object.entries(input)) {
    urlPath = urlPath.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  const fullUrl = `${baseUrl.replace(/\/$/, '')}${urlPath}`;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Jarvis/1.0',
    ...authHeaders
  };

  const opts = { method, headers };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  opts.signal = controller.signal;

  // Params no usados en path van al body (POST/PUT/PATCH) o querystring (GET/DELETE)
  const usedInPath = (urlPath.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1));
  const remaining = Object.fromEntries(
    Object.entries(input).filter(([k]) => !usedInPath.includes(k))
  );

  if (['POST', 'PUT', 'PATCH'].includes(method) && Object.keys(remaining).length > 0) {
    opts.body = JSON.stringify(remaining);
  } else if (Object.keys(remaining).length > 0) {
    const qs = new URLSearchParams(remaining).toString();
    // fullUrl may already have '?' from urlPath; handle both cases
    const sep = fullUrl.includes('?') ? '&' : '?';
    opts.url = `${fullUrl}${sep}${qs}`;
  }

  try {
    const res = await fetch(opts.url || fullUrl, opts);
    clearTimeout(timer);
    const body = await res.text();
    let data;
    try { data = JSON.parse(body); } catch { data = body; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`API_CALL_FAILED: ${err.message}`);
  }
}

function registerApiTool(toolRegistry, connectionId, label, endpoint, getConn) {
  const toolName = `${connectionId}.${endpoint.name}`;
  toolRegistry.register({
    name: toolName,
    description: `[${label}] ${endpoint.description || endpoint.name}`,
    risk: endpoint.risk || (['POST','PUT','PATCH','DELETE'].includes(String(endpoint.method||'GET').toUpperCase()) ? 'medium' : 'low'),
    permissions: [],
    execute: async (input = {}) => {
      const conn = getConn(connectionId);
      if (!conn) return { ok: false, error: 'API_CONNECTION_NOT_FOUND' };
      const authHeaders = buildAuthHeaders(conn.auth || {});
      return callEndpoint({ baseUrl: conn.baseUrl, authHeaders, endpoint, input });
    }
  });
}

function createGenericApiTools({ toolRegistry, dataDir, credentialVault }) {
  const connections = loadApiConnections(dataDir);

  function getConn(id) { return connections[id]; }

  // Registrar conexiones guardadas al arrancar, resolviendo tokens del vault
  for (const [id, conn] of Object.entries(connections)) {
    const resolvedAuth = resolveAuth(conn.auth || {}, credentialVault);
    const connWithAuth = { ...conn, auth: resolvedAuth };
    for (const ep of conn.endpoints || []) {
      registerApiTool(toolRegistry, id, conn.label, ep, () => connWithAuth);
    }
  }

  return [
    {
      name: 'connections.connect_api',
      description: 'Conectar cualquier API REST externa configurando base URL, autenticación y endpoints. Input: { label: "nombre del servicio", baseUrl: "https://api.servicio.com/v2", auth: { type: "bearer"|"apikey"|"basic"|"token", token?, key?, header?, username?, password? }, endpoints: [{ name: "list_posts", method: "GET", path: "/posts", description: "Listar publicaciones" }], vaultKeys?: { token: "LINKEDIN_TOKEN" } (para resolver credenciales del vault). Devuelve las tools creadas.',
      risk: 'medium',
      permissions: ['connections:write'],
      required: ['label', 'baseUrl', 'endpoints'],
      aliases: {
        label: ['nombre', 'servicio', 'service'],
        baseUrl: ['base_url', 'url', 'api_url'],
        auth: ['autenticacion', 'auth', 'credentials'],
        endpoints: ['rutas', 'methods', 'tools']
      },
      execute: async (input) => {
        const id = String(input.label).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const baseUrl = String(input.baseUrl || input.base_url || '').trim().replace(/\/$/, '');
        if (!baseUrl.startsWith('http')) throw new Error('CONNECT_API_INVALID_BASE_URL');

        const endpoints = Array.isArray(input.endpoints) ? input.endpoints : [];
        if (endpoints.length === 0) throw new Error('CONNECT_API_REQUIRES_ENDPOINTS');

        // Construir config de auth — puede referenciar keys del vault
        let auth = input.auth || {};
        if (input.vaultKeys && credentialVault) {
          auth = resolveAuth(auth, credentialVault, input.vaultKeys);
        }

        connections[id] = { label: input.label, baseUrl, auth, endpoints, connectedAt: new Date().toISOString() };
        saveApiConnections(dataDir, connections);

        const connWithAuth = { ...connections[id], auth };
        const toolNames = [];
        for (const ep of endpoints) {
          if (!ep.name) continue;
          registerApiTool(toolRegistry, id, input.label, ep, () => connWithAuth);
          toolNames.push(`${id}.${ep.name}`);
        }

        return {
          ok: true,
          id,
          label: input.label,
          baseUrl,
          toolsCreated: toolNames,
          message: `Conectado "${input.label}" — ${toolNames.length} endpoint(s): ${toolNames.join(', ')}`
        };
      }
    },
    {
      name: 'connections.list_api',
      description: 'Listar las conexiones REST genéricas configuradas y sus endpoints disponibles.',
      risk: 'low',
      permissions: [],
      execute: async () => ({
        ok: true,
        connections: Object.entries(connections).map(([id, c]) => ({
          id,
          label: c.label,
          baseUrl: c.baseUrl,
          endpoints: (c.endpoints || []).map((e) => `${id}.${e.name}`)
        }))
      })
    },
    {
      name: 'connections.disconnect_api',
      description: 'Eliminar una conexión REST genérica y sus tools. Input: { id }.',
      risk: 'medium',
      permissions: ['connections:write'],
      required: ['id'],
      execute: async (input) => {
        const id = input.id;
        if (!connections[id]) return { ok: false, error: 'NOT_FOUND' };
        const conn = connections[id];
        delete connections[id];
        saveApiConnections(dataDir, connections);
        for (const ep of conn.endpoints || []) {
          toolRegistry.tools?.delete(`${id}.${ep.name}`);
        }
        return { ok: true, id, message: `Desconectado "${conn.label}"` };
      }
    }
  ];
}

function resolveAuth(auth, credentialVault, vaultKeys = {}) {
  if (!credentialVault) return auth;
  const resolved = { ...auth };

  // vaultKeys puede mapear campos de auth a claves del vault
  // Ej: { token: 'LINKEDIN_TOKEN' } → auth.token = vault.get('LINKEDIN_TOKEN')
  for (const [field, vaultKey] of Object.entries(vaultKeys)) {
    const val = credentialVault.get(vaultKey);
    if (val) resolved[field] = val;
  }

  // Auto-resolve si auth.token/key/password es una clave en mayúsculas del vault
  for (const field of ['token', 'key', 'password', 'username']) {
    const current = resolved[field];
    if (typeof current === 'string' && /^[A-Z][A-Z0-9_]+$/.test(current)) {
      const fromVault = credentialVault.get(current);
      if (fromVault) resolved[field] = fromVault;
    }
  }

  return resolved;
}

module.exports = { createGenericApiTools };
