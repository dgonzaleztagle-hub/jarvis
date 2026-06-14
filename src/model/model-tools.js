const path = require('path');
const { AnthropicProvider } = require('./anthropic-provider');
const { GeminiProvider } = require('./gemini-provider');
const { UsageMeter } = require('./usage-meter');
const { loadEnvFile, getConfigValue } = require('../utils/env-file');

const LEGACY_PROJECT_DIR = 'C:\\proyectos\\jarvis-companion';

function createGeminiProvider(options = {}) {
  if (options.provider) return options.provider;

  const legacyEnvPath = options.legacyEnvPath || process.env.JARVIS_LEGACY_ENV_PATH || path.join(LEGACY_PROJECT_DIR, '.env');
  const fallbackEnv = loadEnvFile(legacyEnvPath);
  const apiKey = options.apiKey || options.vault?.get('GEMINI_API_KEY') || getConfigValue('GEMINI_API_KEY', fallbackEnv);
  return new GeminiProvider({ apiKey, fetchImpl: options.fetchImpl || fetch });
}

function createAnthropicProvider(options = {}) {
  if (options.provider) return options.provider;

  const legacyEnvPath = options.legacyEnvPath || process.env.JARVIS_LEGACY_ENV_PATH || path.join(LEGACY_PROJECT_DIR, '.env');
  const fallbackEnv = loadEnvFile(legacyEnvPath);
  const apiKey = options.apiKey || options.vault?.get('ANTHROPIC_API_KEY') || getConfigValue('ANTHROPIC_API_KEY', fallbackEnv);
  return new AnthropicProvider({
    apiKey,
    model: options.model || 'claude-haiku-4-5',
    fetchImpl: options.fetchImpl || fetch,
    usageMeter: options.usageMeter
  });
}

function createModelProvider(options = {}) {
  if (options.provider) return options.provider;
  const usageMeter = options.usageMeter || (options.dataDir ? new UsageMeter({ dataDir: options.dataDir }) : null);
  const providerName = options.providerName || options.providerType || process.env.JARVIS_MODEL_PROVIDER || 'anthropic';
  if (providerName === 'gemini') {
    return createGeminiProvider(options);
  }
  return createAnthropicProvider({ ...options, usageMeter });
}

function createModelTools({ provider, usageMeter }) {
  return [
    {
      name: 'model.generate_json',
      description: 'Generate structured JSON with the configured model provider.',
      risk: 'medium',
      permissions: ['model:external_llm'],
      execute: async (input) => provider.generateJson(input)
    },
    {
      name: 'model.usage_summary',
      description: 'Show local model token and cost usage summary.',
      risk: 'low',
      permissions: ['model:usage:read'],
      execute: async () => usageMeter?.summary() || { totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, recent: [] }
    }
  ];
}

module.exports = {
  createAnthropicProvider,
  createGeminiProvider,
  createModelProvider,
  createModelTools
};
