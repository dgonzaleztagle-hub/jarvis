function inferReadableFormat({ userText = '', visual = '', toolResults = [] } = {}) {
  const text = `${userText}\n${visual}`.toLowerCase();
  const asksPriorityJudgment = /\b(importante|importantes|prioritario|prioritarios|relevante|relevantes|urgente|urgentes|vale la pena|me puede interesar|me interesan|de verdad|selecciona|seleccionar|filtra|filtrar|triage)\b/i.test(text);
  const hasItems = /\b(lista|listar|muestra|mostrar|dame|verifica|revisa|ultim[oa]s|últim[oa]s|correos|eventos|archivos|tareas|contactos|resultados|opciones|cosas|items|elementos)\b/i.test(text) ||
    /\b\d+\s+(correos|eventos|archivos|tareas|contactos|resultados|opciones|cosas|items|elementos)\b/i.test(text);
  const hasStructuredToolResult = toolResults.some((item) => {
    const result = item.result || {};
    return Object.values(result).some((value) => Array.isArray(value) && value.length > 1);
  });

  if (asksPriorityJudgment) return 'sections';
  if (hasItems || hasStructuredToolResult) return 'list';
  if (/\b(compara|comparar|comparativa|tabla|precios|costos|planes|alternativas)\b/i.test(text)) return 'table';
  if (/\b(reporte|auditoria|auditoría|informe|analisis|análisis|investigacion|investigación|diagnostico|diagnóstico)\b/i.test(text)) return 'sections';
  return 'brief';
}

function formatHumanReadable(response = {}, context = {}) {
  const format = response.format || inferReadableFormat({
    userText: context.userText,
    visual: response.visual,
    toolResults: context.toolResults
  });

  return {
    ...response,
    format
  };
}

module.exports = {
  formatHumanReadable,
  inferReadableFormat
};
