function inferOutputValue({ userText = '', visual = '', format = 'brief' } = {}) {
  const text = `${userText}\n${visual}`.toLowerCase();
  const asksPriorityJudgment = /\b(importante|importantes|prioritario|prioritarios|relevante|relevantes|urgente|urgentes|vale la pena|me puede interesar|me interesan|de verdad|selecciona|seleccionar|filtra|filtrar|triage)\b/i.test(text);

  if (/\b(resume|resumen|resumir|resumido|síntesis|sintesis|sintetiza|sintetizar)\b/i.test(text)) {
    return {
      mode: 'summary',
      requiresTransformation: true,
      rule: 'A summary must synthesize meaning, not paste a cleaned snippet.'
    };
  }

  if (/\b(analiza|análisis|analisis|audita|auditoría|auditoria|diagnostica|diagnóstico|diagnostico)\b/i.test(text) || format === 'sections') {
    return {
      mode: 'analysis',
      requiresTransformation: true,
      rule: 'Analysis must explain findings, relevance, risk and next action.'
    };
  }

  if (asksPriorityJudgment) {
    return {
      mode: 'analysis',
      requiresTransformation: true,
      rule: 'Priority questions require judgment: select what matters, explain why, and suggest the next action.'
    };
  }

  if (/\b(compara|comparar|comparativa|mejor|peor|precio|costo|plan)\b/i.test(text) || format === 'table') {
    return {
      mode: 'comparison',
      requiresTransformation: true,
      rule: 'Comparison must expose criteria and tradeoffs, not just list options.'
    };
  }

  if (format === 'list') {
    return {
      mode: 'inspection',
      requiresTransformation: false,
      rule: 'Inspection must be complete, ordered and scannable.'
    };
  }

  return {
    mode: 'response',
    requiresTransformation: false,
    rule: 'Brief responses should be direct and useful.'
  };
}

function applyOutputValueContract(response = {}, context = {}) {
  const outputValue = response.outputValue || inferOutputValue({
    userText: context.userText,
    visual: response.visual,
    format: response.format
  });

  return {
    ...response,
    outputValue
  };
}

module.exports = {
  applyOutputValueContract,
  inferOutputValue
};
