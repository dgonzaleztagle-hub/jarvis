function inferCapabilityGroup(toolName = '') {
  if (/^google\.(gmail|calendar|contacts)\./.test(toolName)) return 'Comunicacion y organizacion';
  if (/^google\.docs\./.test(toolName)) return 'Documentos e informes';
  if (/^google\.sheets\./.test(toolName)) return 'Planillas';
  if (/^google\.tasks\./.test(toolName)) return 'Tareas Google';
  if (/^agents\./.test(toolName)) return 'Agentes automaticos';
  if (/^tasks\./.test(toolName)) return 'Tareas autonomas';
  if (/^meeting\./.test(toolName)) return 'Reuniones';
  if (/^video\./.test(toolName)) return 'Creacion de video (Remotion + ffmpeg)';
  if (/^social\./.test(toolName)) return 'Redes sociales';
  if (/^brand\./.test(toolName)) return 'Marca y marketing';
  if (/^vision\./.test(toolName)) return 'Vision e imagenes';
  if (/^wa\./.test(toolName)) return 'WhatsApp personal';
  if (/^web\./.test(toolName)) return 'Web';
  if (/^hud\.|^preview\.|^files\./.test(toolName)) return 'HUD y presentacion';
  if (/^desktop\./.test(toolName)) return 'Control de escritorio (local)';
  if (/^memory\./.test(toolName)) return 'Memoria';
  if (/^mcp\./.test(toolName)) return 'Conexiones externas (MCP)';
  if (/^voice\./.test(toolName)) return 'Voz y audio';
  if (/^research\./.test(toolName)) return 'Investigacion y criterio';
  if (/^conversation\./.test(toolName)) return 'Conversacion';
  if (/^audit\./.test(toolName)) return 'Auditoria';
  return 'Otras capacidades';
}

function compactDescription(description = '') {
  return String(description || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
}

function syncRuntimeSelfKnowledge({ memoryStore, toolRegistry }) {
  if (!memoryStore || !toolRegistry) return null;

  const tools = toolRegistry
    .list()
    .filter((tool) => !tool.name.startsWith('model.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const grouped = new Map();
  const confirmationRequiredFor = [];

  for (const tool of tools) {
    const groupName = inferCapabilityGroup(tool.name);
    const current = grouped.get(groupName) || [];
    current.push(compactDescription(tool.description || tool.name));
    grouped.set(groupName, current);
    if (tool.risk === 'high') {
      confirmationRequiredFor.push(compactDescription(tool.description || tool.name));
    }
  }

  const capabilityGroups = Array.from(grouped.entries()).map(([name, actions]) => ({
    name,
    actions
  }));

  return memoryStore.upsert({
    key: 'runtime_assistant_capabilities',
    title: 'Capacidades activas de Jarvis',
    type: 'assistant_self_knowledge',
    state: 'verified',
    confidence: 0.99,
    tags: ['runtime', 'capabilities', 'self_knowledge'],
    aliases: ['capacidades', 'habilidades', 'superpoderes', 'que puedes hacer', 'qué puedes hacer'],
    content: {
      refreshedAt: new Date().toISOString(),
      totalTools: tools.length,
      capabilityGroups,
      confirmationRequiredFor: confirmationRequiredFor.slice(0, 8)
    }
  });
}

module.exports = {
  syncRuntimeSelfKnowledge
};
