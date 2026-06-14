// Escala de modelos por capacidad/tarea — cableada y documentada.
//
// Estrategia (Daniel, 2026-06-14): marca blanca arranca con Gemini free; el
// "fuerte recomendado" es el modelo MEDIO de cada ecosistema (Sonnet), NO el
// tope (Opus) — los medios ya son capaces de casi todo y gastar en el tope es
// gasto innecesario del usuario. Opus existe en el catálogo pero NO se recomienda
// por defecto. La recomendación de subir de tier es REACTIVA (cuando el usuario
// se queja en una tarea cuyo tier supera al modelo activo), nunca autoswap salvo
// preferencia opt-in. Ver memoria project-model-strategy.

// Pricing aproximado por millón de tokens (referencia familia Claude; el medidor
// real de costo usa esto al hacer swap dentro de Anthropic).
const PRICING = {
  haiku:  { inputPerMillion: 1,  outputPerMillion: 5,  cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 },
  sonnet: { inputPerMillion: 3,  outputPerMillion: 15, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 },
  opus:   { inputPerMillion: 15, outputPerMillion: 75, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 },
  free:   { inputPerMillion: 0,  outputPerMillion: 0,  cacheWriteMultiplier: 1,    cacheReadMultiplier: 1 }
};

// tierRank: 0 base/gratis · 1 económico · 2 fuerte (medio capaz, recomendado) · 3 máximo (tope)
const MODELS = {
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash', provider: 'gemini', label: 'Gemini Flash',
    tier: 'base', tierRank: 0, free: true, recommended: true,
    strengths: ['conversar', 'leer', 'resumir', 'tareas simples'],
    note: 'Gratis con cualquier cuenta Google. Default de marca blanca.',
    pricing: PRICING.free
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5',
    tier: 'economico', tierRank: 1, free: false, recommended: true,
    strengths: ['conversar', 'leer', 'resumir', 'tareas simples con más consistencia'],
    note: 'Económico y muy capaz. Default de desarrollo (Daniel).',
    pricing: PRICING.haiku
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6',
    tier: 'fuerte', tierRank: 2, free: false, recommended: true,
    strengths: ['construir (web, código)', 'documentos largos', 'análisis profundo', 'diseño'],
    note: 'El "fuerte recomendado": modelo medio capaz de casi todo. Mejor relación capacidad/gasto.',
    pricing: PRICING.sonnet
  },
  'claude-opus-4-8': {
    id: 'claude-opus-4-8', provider: 'anthropic', label: 'Claude Opus 4.8',
    tier: 'maximo', tierRank: 3, free: false, recommended: false,
    strengths: ['lo más exigente', 'máxima calidad'],
    note: 'Tope de línea. NO recomendado por defecto: el gasto extra rara vez justifica el cambio vs Sonnet.',
    pricing: PRICING.opus
  }
};

// Tier mínimo que conviene para cada tipo de tarea.
const TASK_MIN_TIER = {
  conversation: 0, read: 0, summary: 0, simple: 0,
  research: 1, analysis: 2,
  build: 2, code: 2, design: 2, document: 2
};

function getModel(id) {
  return MODELS[id] || null;
}

function listCatalog() {
  return Object.values(MODELS);
}

function tierRankOf(modelId) {
  return MODELS[modelId] ? MODELS[modelId].tierRank : 0;
}

function minTierForTask(taskType) {
  return TASK_MIN_TIER[taskType] ?? 0;
}

// El modelo "fuerte recomendado" (medio capaz) — el que se sugiere para subir,
// nunca el tope. Por defecto Sonnet.
function recommendedStrongModel() {
  return Object.values(MODELS).find((m) => m.tier === 'fuerte' && m.recommended) || null;
}

// ¿El modelo activo se queda corto para esta tarea?
function isBelowRecommended(activeModelId, taskType) {
  return tierRankOf(activeModelId) < minTierForTask(taskType);
}

// Qué recomendar si el modelo activo se queda corto: el fuerte recomendado
// (medio), no el tope. Devuelve null si el modelo activo ya alcanza.
function recommendUpgrade(activeModelId, taskType) {
  if (!isBelowRecommended(activeModelId, taskType)) return null;
  return recommendedStrongModel();
}

// Modelos a los que se puede saltar "en caliente" desde el activo: mismo
// proveedor (misma API key). Cruzar de proveedor es onboarding (key nueva).
function hotSwapTargets(activeModelId) {
  const active = MODELS[activeModelId];
  if (!active) return [];
  return Object.values(MODELS).filter((m) => m.provider === active.provider && m.id !== active.id);
}

module.exports = {
  MODELS,
  PRICING,
  TASK_MIN_TIER,
  getModel,
  listCatalog,
  tierRankOf,
  minTierForTask,
  recommendedStrongModel,
  isBelowRecommended,
  recommendUpgrade,
  hotSwapTargets
};
