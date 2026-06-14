const { normalizeInput, validateRequired } = require('./input-normalizer');
const { classifyProvenance } = require('./provenance');

class ToolRegistry {
  constructor({ policyEngine, eventBus, auditTrail }) {
    this.tools = new Map();
    this.policyEngine = policyEngine;
    this.eventBus = eventBus;
    this.auditTrail = auditTrail || null;
  }

  audit(entry) {
    if (this.auditTrail) {
      try { this.auditTrail.record(entry); } catch (_) { /* nunca rompe ejecución */ }
    }
  }

  register(tool) {
    if (!tool || !tool.name || typeof tool.execute !== 'function') {
      throw new Error('Tool must include name and execute(input, context)');
    }

    const normalized = {
      description: '',
      risk: 'low',
      permissions: [],
      inputSchema: null,
      aliases: {},
      required: [],
      outputSchema: null,
      ...tool
    };

    this.tools.set(normalized.name, normalized);
    this.eventBus?.emit('tool_registered', {
      name: normalized.name,
      risk: normalized.risk,
      permissions: normalized.permissions
    });
    return normalized;
  }

  list() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      permissions: tool.permissions
    }));
  }

  get(name) {
    return this.tools.get(name);
  }

  async execute(name, input = {}, context = {}) {
    const tool = this.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    const normalizedInput = normalizeInput(input, tool.aliases || {});
    const validation = validateRequired(normalizedInput, tool.required || []);
    if (!validation.ok) {
      this.eventBus?.emit('tool_input_invalid', { name, missing: validation.missing });
      this.audit({ tool: name, risk: tool.risk, outcome: 'invalid_input', channel: context.channel, input });
      return {
        ok: false,
        blocked: true,
        validation
      };
    }

    // Procedencia del contenido (¿lo dictó el usuario o lo compuso el LLM?). Se
    // calcula ANTES de la política para que ésta pueda regir la confirmación de
    // las herramientas de envío por autoría, no solo por riesgo. Ver provenance.js.
    const provenance = context.userText
      ? classifyProvenance({ input: normalizedInput, userText: context.userText }).provenance
      : null;

    const policy = this.policyEngine.evaluate(tool, normalizedInput, { ...context, provenance });
    if (!policy.allowed) {
      this.eventBus?.emit('tool_denied', { name, policy });
      this.audit({ tool: name, risk: policy.risk, outcome: 'denied', channel: context.channel, input: normalizedInput });
      return { ok: false, blocked: true, policy };
    }

    if (policy.requiresConfirmation && !context.confirmed) {
      this.eventBus?.emit('tool_confirmation_required', { name, input: normalizedInput, policy });
      this.audit({ tool: name, risk: policy.risk, outcome: 'confirmation_required', channel: context.channel, input: normalizedInput, requiresConfirmation: true, provenance });
      return { ok: false, confirmationRequired: true, policy };
    }

    this.eventBus?.emit('tool_started', { name });
    try {
      const output = await tool.execute(normalizedInput, context);
      this.eventBus?.emit('tool_completed', { name });
      this.audit({ tool: name, risk: policy.risk, outcome: 'ok', channel: context.channel, input: normalizedInput, provenance });
      return { ok: true, output, policy };
    } catch (error) {
      this.eventBus?.emit('tool_failed', { name, error: error.message });
      this.audit({ tool: name, risk: policy.risk, outcome: 'error', channel: context.channel, input: normalizedInput, error: error.message });
      throw error;
    }
  }
}

module.exports = {
  ToolRegistry
};
