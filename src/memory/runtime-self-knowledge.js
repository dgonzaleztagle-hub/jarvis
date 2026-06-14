function inferCapabilityGroup(toolName = '') {
  if (/^google\.(gmail|calendar|contacts)\./.test(toolName)) return 'Comunicacion y organizacion';
  if (/^google\.docs\./.test(toolName)) return 'Documentos e informes';
  if (/^voice\./.test(toolName)) return 'Voz y audio';
  if (/^research\./.test(toolName)) return 'Investigacion y criterio';
  if (/^memory\./.test(toolName)) return 'Memoria';
  if (/^connections\./.test(toolName)) return 'Conexiones externas (MCP)';
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
    actions: actions.slice(0, 6)
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
