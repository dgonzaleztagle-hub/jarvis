function summarizeAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    goal: agent.goal,
    schedule: agent.schedule,
    maxRunsPerDay: agent.maxRunsPerDay,
    enabled: agent.enabled,
    lastRunAt: agent.lastRunAt,
    lastResult: agent.lastResult ? { status: agent.lastResult.status, at: agent.lastResult.at } : null
  };
}

function createAgentTools({ store, scheduler }) {
  return [
    {
      name: 'agents.create',
      description: 'Crear un agente automático con una misión recurrente. Input: { name, goal (misión en lenguaje natural, será el mensaje que el agente ejecuta), schedule: { type: "daily"|"interval"|"manual", at: "HH:MM" (daily), minutes: N (interval) }, maxRunsPerDay (opcional, default 4) }. Requiere confirmación del usuario antes de crear. Tras crearlo, el sistema corre la misión UNA VEZ de inmediato para validar que de verdad funciona — el resultado vuelve en "validation". Si "validation" muestra que falló por un problema de la propia misión (ej: URL/dominio que no existe, instrucción ambigua que no usó ninguna herramienta), corrige el goal con agents.update_goal y vuelve a probar con agents.run_now antes de responder al usuario. Si tras corregir una vez sigue sin funcionar, dilo explícitamente y pide al usuario lo que falte — no reportes "creado" sin contar cómo salió la prueba.',
      risk: 'high',
      permissions: ['agents:create'],
      execute: async (input) => {
        // Idempotente por nombre: si ya existe, devolver el existente en vez
        // de reventar — "¿seguro que lo creaste?" debe responderse con el
        // agente real, no con un re-intento fallido de creación.
        const existing = store.list().find(
          (a) => a.name.trim().toLowerCase() === String(input.name || '').trim().toLowerCase()
        );
        if (existing) {
          return { ...summarizeAgent(existing), alreadyExisted: true, note: 'Ya existía un agente con ese nombre. No se creó otro.' };
        }

        const agent = store.create(input);

        // Validación inmediata: una misión recién creada que nunca corrió no
        // sirve de nada — se ejecuta una vez ahora mismo para que el modelo
        // pueda ver si realmente funciona antes de darla por buena.
        let validation;
        try {
          validation = await scheduler.runAgent(agent, { trigger: 'validation' });
        } catch (err) {
          validation = { status: 'failed', error: err.message };
        }

        return { ...summarizeAgent(store.get(agent.id)), validation };
      }
    },
    {
      name: 'agents.update_goal',
      description: 'Corregir la misión (goal) de un agente existente — por ejemplo cuando "validation" de agents.create (o una corrida posterior) revela que apunta a una URL/dominio inexistente o a una instrucción ambigua. Input: { agent (id o nombre), goal (nuevo texto de la misión) }. Después de corregir, vuelve a probar con agents.run_now.',
      risk: 'medium',
      permissions: ['agents:manage'],
      execute: async (input) => {
        const agent = store.get(String(input.agent || ''));
        if (!agent) throw new Error(`AGENT_NOT_FOUND: ${input.agent}`);
        const goal = String(input.goal || '').trim();
        if (!goal) throw new Error('AGENT_GOAL_REQUIRED');
        return summarizeAgent(store.update(agent.id, { goal }));
      }
    },
    {
      name: 'agents.list',
      description: 'Listar los agentes automáticos existentes con su estado, agenda y última corrida.',
      risk: 'low',
      permissions: [],
      execute: async () => {
        const agents = store.list().map(summarizeAgent);
        return { agents, total: agents.length };
      }
    },
    {
      name: 'agents.run_now',
      description: 'Ejecutar inmediatamente un agente por id o nombre, sin esperar su agenda. Input: { agent }.',
      risk: 'medium',
      permissions: ['agents:run'],
      execute: async (input) => scheduler.runAgent(String(input.agent || ''), { trigger: 'manual' })
    },
    {
      name: 'agents.set_enabled',
      description: 'Activar o desactivar un agente (kill switch). Input: { agent (id o nombre), enabled: true|false }.',
      risk: 'medium',
      permissions: ['agents:manage'],
      execute: async (input) => {
        const agent = store.get(String(input.agent || ''));
        if (!agent) throw new Error(`AGENT_NOT_FOUND: ${input.agent}`);
        return summarizeAgent(store.update(agent.id, { enabled: input.enabled !== false }));
      }
    },
    {
      name: 'agents.delete',
      description: 'Eliminar un agente definitivamente por id o nombre. Input: { agent }.',
      risk: 'high',
      permissions: ['agents:manage'],
      execute: async (input) => store.remove(String(input.agent || ''))
    }
  ];
}

module.exports = {
  createAgentTools
};
