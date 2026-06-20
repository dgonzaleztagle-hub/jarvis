// Descubrimiento de servicios externos: encuentra si hay un servidor MCP disponible
// o cómo conectarse vía API REST, y qué credenciales se necesitan.

const MCP_REGISTRIES = [
  'https://smithery.ai/search?q=',
  'https://glama.ai/mcp/servers?search='
];

// Catálogo de servicios conocidos para no tener que buscar siempre.
const KNOWN_SERVICES = {
  linkedin: {
    name: 'LinkedIn',
    mcpPackage: '@modelcontextprotocol/server-linkedin',
    apiDocs: 'https://developer.linkedin.com/docs/guide/v2',
    authMethod: 'oauth2',
    scopes: ['w_member_social', 'r_liteprofile'],
    requiredCredentials: [
      { key: 'client_id', label: 'Client ID', hint: 'LinkedIn Developer App → Auth → Client ID' },
      { key: 'client_secret', label: 'Client Secret', secret: true, hint: 'LinkedIn Developer App → Auth → Client Secret' }
    ],
    capabilities: ['Crear posts en tu feed', 'Publicar en páginas de empresa', 'Ver métricas de posts', 'Leer perfil propio']
  },
  twitter: {
    name: 'X (Twitter)',
    mcpPackage: null,
    apiDocs: 'https://developer.twitter.com/en/docs/twitter-api',
    authMethod: 'oauth2',
    requiredCredentials: [
      { key: 'bearer_token', label: 'Bearer Token', secret: true, hint: 'developer.twitter.com → Projects → Tu App → Keys and Tokens' },
      { key: 'api_key', label: 'API Key', hint: 'Projects → Tu App → Keys and Tokens → Consumer Keys' }
    ],
    capabilities: ['Publicar tweets', 'Leer timeline', 'Buscar tweets', 'Ver métricas']
  },
  notion: {
    name: 'Notion',
    mcpPackage: '@modelcontextprotocol/server-notion',
    apiDocs: 'https://developers.notion.com',
    authMethod: 'token',
    requiredCredentials: [
      { key: 'api_key', label: 'Integration Token', secret: true, hint: 'notion.so/my-integrations → Nueva integración → Internal Integration Token' }
    ],
    capabilities: ['Leer páginas y bases de datos', 'Crear y actualizar páginas', 'Buscar en workspace', 'Gestionar bloques']
  },
  github: {
    name: 'GitHub',
    mcpPackage: '@modelcontextprotocol/server-github',
    apiDocs: 'https://docs.github.com/en/rest',
    authMethod: 'token',
    requiredCredentials: [
      { key: 'token', label: 'Personal Access Token', secret: true, hint: 'github.com → Settings → Developer settings → Personal access tokens' }
    ],
    capabilities: ['Leer repositorios e issues', 'Crear issues y PRs', 'Ver código', 'Gestionar proyectos']
  },
  slack: {
    name: 'Slack',
    mcpPackage: '@modelcontextprotocol/server-slack',
    apiDocs: 'https://api.slack.com',
    authMethod: 'token',
    requiredCredentials: [
      { key: 'bot_token', label: 'Bot Token', secret: true, hint: 'api.slack.com/apps → Tu App → OAuth & Permissions → Bot User OAuth Token (xoxb-...)' }
    ],
    capabilities: ['Leer mensajes de canales', 'Enviar mensajes', 'Buscar en el historial', 'Listar usuarios']
  },
  stripe: {
    name: 'Stripe',
    mcpPackage: null,
    apiDocs: 'https://stripe.com/docs/api',
    authMethod: 'apikey',
    requiredCredentials: [
      { key: 'api_key', label: 'Secret Key', secret: true, hint: 'dashboard.stripe.com → Developers → API keys → Secret key (sk_...)' }
    ],
    capabilities: ['Ver pagos y transacciones', 'Consultar clientes', 'Ver balances', 'Listar facturas']
  },
  hubspot: {
    name: 'HubSpot',
    mcpPackage: null,
    apiDocs: 'https://developers.hubspot.com/docs/api/overview',
    authMethod: 'apikey',
    requiredCredentials: [
      { key: 'access_token', label: 'Private App Token', secret: true, hint: 'app.hubspot.com → Settings → Integrations → Private Apps → Tu app → Access Token' }
    ],
    capabilities: ['Ver contactos y empresas', 'Crear y actualizar deals', 'Consultar pipeline de ventas', 'Agregar notas y actividades']
  },
  trello: {
    name: 'Trello',
    mcpPackage: null,
    apiDocs: 'https://developer.atlassian.com/cloud/trello/rest',
    authMethod: 'apikey',
    requiredCredentials: [
      { key: 'api_key', label: 'API Key', hint: 'trello.com/app-key' },
      { key: 'token', label: 'Token', secret: true, hint: 'trello.com/app-key → generar Token manualmente' }
    ],
    capabilities: ['Leer tableros y tarjetas', 'Crear y mover tarjetas', 'Asignar miembros', 'Gestionar listas']
  },
  airtable: {
    name: 'Airtable',
    mcpPackage: null,
    apiDocs: 'https://airtable.com/developers/web/api/introduction',
    authMethod: 'token',
    requiredCredentials: [
      { key: 'api_key', label: 'Personal Access Token', secret: true, hint: 'airtable.com/create/tokens → New token (con scopes data.records:read y write)' }
    ],
    capabilities: ['Leer y escribir registros', 'Buscar en bases', 'Crear registros', 'Listar tablas']
  }
};

function normalizeServiceName(raw = '') {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/x$/, 'twitter').replace(/^x$/, 'twitter');
}

async function fetchRegistrySearch(baseUrl, serviceName, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}${encodeURIComponent(serviceName)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Jarvis/1.0' }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    // Buscar menciones al servicio con URL de npm o GitHub
    const packageMatches = text.match(/@[\w-]+\/server-[\w-]+/g) || [];
    const npmMatches = text.match(/npmjs\.com\/package\/([\w@/-]+)/g) || [];
    const ghMatches = text.match(/github\.com\/[\w-]+\/[\w-]+/g) || [];
    return {
      packages: [...new Set(packageMatches)].slice(0, 3),
      npm: [...new Set(npmMatches)].slice(0, 3),
      github: [...new Set(ghMatches)].slice(0, 3)
    };
  } catch (_) {
    return null;
  }
}

async function discoverService(input = {}) {
  const rawName = String(input.service || input.name || '').trim();
  if (!rawName) throw new Error('DISCOVER_REQUIRES_SERVICE_NAME');

  const key = normalizeServiceName(rawName);

  // 1. Catálogo conocido — respuesta inmediata
  const known = KNOWN_SERVICES[key];
  if (known) {
    return {
      found: true,
      service: known.name,
      source: 'catalog',
      mcpPackage: known.mcpPackage || null,
      hasMcp: !!known.mcpPackage,
      apiDocs: known.apiDocs,
      authMethod: known.authMethod,
      requiredCredentials: known.requiredCredentials,
      capabilities: known.capabilities,
      connectInstructions: buildInstructions(known)
    };
  }

  // 2. Buscar en registros MCP
  const registryResults = await Promise.all(
    MCP_REGISTRIES.map((base) => fetchRegistrySearch(base, rawName))
  );
  const merged = { packages: [], npm: [], github: [] };
  for (const r of registryResults.filter(Boolean)) {
    merged.packages.push(...(r.packages || []));
    merged.npm.push(...(r.npm || []));
    merged.github.push(...(r.github || []));
  }

  const hasMcpResults = merged.packages.length > 0 || merged.npm.length > 0;

  if (hasMcpResults) {
    return {
      found: true,
      service: rawName,
      source: 'registry_search',
      hasMcp: true,
      mcpPackage: merged.packages[0] || null,
      npmUrls: merged.npm.slice(0, 2),
      githubUrls: merged.github.slice(0, 2),
      requiredCredentials: [
        { key: 'token', label: 'Token de acceso', secret: true, hint: `Revisa la documentación del paquete ${merged.packages[0] || rawName} para obtener el token.` }
      ],
      capabilities: ['Herramientas descubiertas automáticamente al conectar'],
      connectInstructions: `Instala el servidor MCP: npx ${merged.packages[0] || rawName}\nLuego conéctalo con connections.connect_dashboard pasando la URL y el token.`
    };
  }

  // 3. No encontrado — devolver instrucciones genéricas para API REST
  return {
    found: false,
    service: rawName,
    source: 'not_found',
    hasMcp: false,
    suggestion: `No encontré un servidor MCP para "${rawName}". Opciones:\n1. Busca su documentación API en https://developer.${rawName.toLowerCase()}.com o https://${rawName.toLowerCase()}.com/developers\n2. Usa connections.connect_api si tienen API REST documentada\n3. Pídeme que busque con web.search "MCP server ${rawName}" para encontrar implementaciones de la comunidad.`,
    requiredCredentials: []
  };
}

function buildInstructions(service) {
  if (service.mcpPackage) {
    return `1. Instala: npx ${service.mcpPackage}\n2. Obtén credenciales en: ${service.apiDocs}\n3. Conéctalo con connections.connect_dashboard`;
  }
  return `1. Obtén credenciales en: ${service.apiDocs}\n2. Úsalas con connections.connect_api para configurar los endpoints que necesitas.`;
}

function createServiceDiscoveryTools() {
  return [
    {
      name: 'connections.discover_service',
      description: 'Investigar cómo conectar un servicio externo (LinkedIn, Notion, GitHub, Slack, Stripe, etc.): busca si hay servidor MCP disponible, qué credenciales necesita y qué puede hacer. Input: { service: "nombre del servicio" }. Úsalo ANTES de connections.connect_dashboard o connections.connect_api cuando el usuario quiera conectar algo nuevo.',
      risk: 'low',
      permissions: [],
      required: ['service'],
      aliases: { service: ['servicio', 'nombre', 'name', 'que'] },
      execute: discoverService
    }
  ];
}

module.exports = { createServiceDiscoveryTools, KNOWN_SERVICES };
