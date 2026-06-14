const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

class PolicyEngine {
  constructor() {
    this.rules = [];
    // Trust mode: skip confirmation for 'high' risk tools.
    // Only 'critical' always requires confirmation.
    this.trustMode = false;
  }

  registerRule(rule) {
    this.rules.push(rule);
  }

  evaluate(tool, input, context = {}) {
    const risk = tool.risk || 'low';
    // userGoAhead: el mensaje del usuario que disparó esta acción fue un visto
    // bueno explícito ("vamos con ello", "dale", "hazlo"). Ese sí ES la
    // confirmación — pedirla de nuevo es hacerlo confirmar dos veces.
    // Solo aplica a 'high'; 'critical' siempre exige confirmación formal, y
    // las reglas registradas (ej: contenido compuesto) pueden re-imponerla.
    const needsConfirm = this.trustMode
      ? risk === 'critical'
      : risk === 'critical' || (risk === 'high' && !context.userGoAhead);
    const result = {
      allowed: true,
      requiresConfirmation: needsConfirm,
      risk,
      reasons: []
    };

    if (!RISK_LEVELS.includes(risk)) {
      result.allowed = false;
      result.reasons.push(`Unknown risk level: ${risk}`);
    }

    for (const rule of this.rules) {
      const ruleResult = rule({ tool, input, context });
      if (!ruleResult) continue;
      if (ruleResult.allowed === false) result.allowed = false;
      if (ruleResult.requiresConfirmation) result.requiresConfirmation = true;
      if (ruleResult.reason) result.reasons.push(ruleResult.reason);
    }

    // Procedencia — SOLO para herramientas de envío a terceros (tool.outbound).
    // La confirmación se rige por la AUTORÍA del contenido, no solo por el riesgo:
    // si el usuario dictó el texto literal, enviarlo directo (no molestar); si lo
    // compuso el asistente, confirmar siempre. 'critical' nunca se relaja.
    if (tool.outbound && context.provenance) {
      if (context.provenance === 'llm_composed') {
        result.requiresConfirmation = true;
        result.reasons.push('El contenido a enviar lo redactó el asistente (no fue dictado literal): revisar antes de enviar.');
      } else if (context.provenance === 'user_defined' && risk !== 'critical') {
        result.requiresConfirmation = false;
        result.reasons.push('El contenido fue dictado literalmente por el usuario: envío directo.');
      }
    }

    return result;
  }
}

module.exports = {
  PolicyEngine,
  RISK_LEVELS
};
