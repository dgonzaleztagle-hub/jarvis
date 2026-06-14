const { normalizeInput, validateRequired } = require('./input-normalizer');

class ToolRegistry {
  constructor({ policyEngine, eventBus }) {
    this.tools = new Map();
    this.policyEngine = policyEngine;
    this.eventBus = eventBus;
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
      return {
        ok: false,
        blocked: true,
        validation
      };
    }

    const policy = this.policyEngine.evaluate(tool, normalizedInput, context);
    if (!policy.allowed) {
      this.eventBus?.emit('tool_denied', { name, policy });
      return { ok: false, blocked: true, policy };
    }

    if (policy.requiresConfirmation && !context.confirmed) {
      this.eventBus?.emit('tool_confirmation_required', { name, input: normalizedInput, policy });
      return { ok: false, confirmationRequired: true, policy };
    }

    this.eventBus?.emit('tool_started', { name });
    const output = await tool.execute(normalizedInput, context);
    this.eventBus?.emit('tool_completed', { name });
    return { ok: true, output, policy };
  }
}

module.exports = {
  ToolRegistry
};
