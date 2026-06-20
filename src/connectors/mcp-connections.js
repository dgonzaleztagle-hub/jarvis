/**
 * mcp-connections.js — Cliente MCP genérico (HTTP + Bearer token).
 *
 * Permite conectar cualquier dashboard/agente que expone un endpoint MCP
 * (JSON-RPC: tools/list, tools/call) en `${url}/api/mcp`, autenticado con
 * un token personal (ej: staff_api_tokens de Rishtedar, generado desde
 * "Conectar agente" en el panel). Sin código específico de cliente: las
 * tools disponibles se descubren y registran dinámicamente.
 */
const fs = require('fs');
const path = require('path');

function getStorePath(dataDir) {
  return path.join(dataDir, 'mcp-connections.json');
}

function loadConnections(dataDir) {
  const file = getStorePath(dataDir);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConnections(dataDir, connections) {
  fs.writeFileSync(getStorePath(dataDir), JSON.stringify(connections, null, 2));
}

function normalizeMcpUrl(url) {
  const trimmed = url.replace(/\/$/, '');
  return trimmed.endsWith('/api/mcp') ? trimmed : `${trimmed}/api/mcp`;
}

async function callMcp(url, token, method, params) {
  const res = await fetch(normalizeMcpUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

function registerRemoteTool(toolRegistry, connectionId, connectionLabel, tool, getConnection) {
  toolRegistry.register({
    name: `${connectionId}.${tool.name}`,
    description: `[${connectionLabel}] ${tool.description}`,
    risk: tool.risk || 'low',
    permissions: tool.permissions || [],
    inputSchema: tool.inputSchema || null,
    execute: async (input = {}) => {
      const conn = getConnection(connectionId);
      if (!conn) return { ok: false, error: 'CONNECTION_NOT_FOUND' };
      try {
        return await callMcp(conn.url, conn.token, 'tools/call', { name: tool.name, arguments: input });
      } catch (err) {
        return { ok: false, error: 'MCP_CALL_FAILED', message: err.message };
      }
    }
  });
}

function createMcpConnectionTools({ toolRegistry, dataDir }) {
  const connections = loadConnections(dataDir);
  function getConnection(id) {
    return connections[id];
  }

  // Re-registrar tools de conexiones guardadas al iniciar.
  for (const [id, conn] of Object.entries(connections)) {
    for (const tool of conn.tools || []) {
      registerRemoteTool(toolRegistry, id, conn.label, tool, getConnection);
    }
  }

  return [
    {
      name: 'connections.connect_dashboard',
      description: 'Conectar un dashboard externo (Rishtedar, Hoja Cero, etc.) que expone un endpoint MCP en /api/mcp. Input: { label, url, token }. Descubre y registra automáticamente las herramientas disponibles.',
      risk: 'medium',
      permissions: ['connections:write'],
      required: ['label', 'url', 'token'],
      execute: async (input) => {
        const id = String(input.label).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const url = String(input.url).replace(/\/$/, '');
        const token = String(input.token);

        let result;
        try {
          result = await callMcp(url, token, 'tools/list', {});
        } catch (err) {
          return { ok: false, error: 'MCP_CONNECT_FAILED', message: err.message };
        }

        const tools = result?.tools || [];
        connections[id] = { label: input.label, url, token, tools, connectedAt: new Date().toISOString() };
        saveConnections(dataDir, connections);

        for (const tool of tools) {
          registerRemoteTool(toolRegistry, id, input.label, tool, getConnection);
        }

        return {
          ok: true,
          id,
          label: input.label,
          toolsConnected: tools.map((t) => `${id}.${t.name}`),
          message: `Conectado "${input.label}" — ${tools.length} herramienta(s) disponible(s): ${tools.map((t) => t.name).join(', ')}`
        };
      }
    },
    {
      name: 'connections.list',
      description: 'Listar los dashboards/agentes externos conectados y sus herramientas disponibles.',
      risk: 'low',
      permissions: [],
      execute: async () => ({
        ok: true,
        connections: Object.entries(connections).map(([id, c]) => ({
          id,
          label: c.label,
          url: c.url,
          tools: (c.tools || []).map((t) => t.name),
          connectedAt: c.connectedAt
        }))
      })
    },
    {
      name: 'connections.disconnect',
      description: 'Desconectar un dashboard/agente externo previamente conectado. Input: { id }.',
      risk: 'medium',
      permissions: ['connections:write'],
      required: ['id'],
      execute: async (input) => {
        const id = input.id;
        if (!connections[id]) return { ok: false, error: 'NOT_FOUND' };

        const removed = connections[id];
        delete connections[id];
        saveConnections(dataDir, connections);

        for (const tool of removed.tools || []) {
          toolRegistry.tools.delete(`${id}.${tool.name}`);
        }

        return { ok: true, id, message: `Desconectado "${removed.label}"` };
      }
    },
    {
      name: 'connections.reconnect',
      description: 'Re-sincronizar las herramientas de un dashboard/agente ya conectado: vuelve a hacer tools/list y actualiza el registro si el servidor cambió o agregó herramientas. Input: { id }.',
      risk: 'low',
      permissions: ['connections:write'],
      required: ['id'],
      execute: async (input) => {
        const id = input.id;
        if (!connections[id]) return { ok: false, error: 'NOT_FOUND' };

        const conn = connections[id];
        let result;
        try {
          result = await callMcp(conn.url, conn.token, 'tools/list', {});
        } catch (err) {
          return { ok: false, error: 'MCP_RECONNECT_FAILED', message: err.message };
        }

        const newTools = result?.tools || [];
        const oldToolNames = new Set((conn.tools || []).map((t) => `${id}.${t.name}`));
        const newToolNames = new Set(newTools.map((t) => `${id}.${t.name}`));

        // Dar de baja tools que ya no existen.
        for (const fullName of oldToolNames) {
          if (!newToolNames.has(fullName)) toolRegistry.tools.delete(fullName);
        }

        // Registrar tools nuevas o actualizadas.
        for (const tool of newTools) {
          registerRemoteTool(toolRegistry, id, conn.label, tool, getConnection);
        }

        connections[id] = { ...conn, tools: newTools, reconnectedAt: new Date().toISOString() };
        saveConnections(dataDir, connections);

        return {
          ok: true,
          id,
          label: conn.label,
          toolsNow: newTools.map((t) => `${id}.${t.name}`),
          removed: [...oldToolNames].filter((n) => !newToolNames.has(n)),
          added: [...newToolNames].filter((n) => !oldToolNames.has(n))
        };
      }
    }
  ];
}

module.exports = { createMcpConnectionTools };
