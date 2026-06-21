function summarizeAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    goal: agent.goal,
    schedule: agent.schedule,
    maxRunsPerDay: agent.maxRunsPerDay,
    maxCostPerDayUsd: agent.maxCostPerDayUsd,
    costToday: agent.costToday || 0,
    enabled: agent.enabled,
    lastRunAt: agent.lastRunAt,
    lastResult: agent.lastResult ? { status: agent.lastResult.status, at: agent.lastResult.at } : null
  };
}

function createAgentTools({ store, scheduler, budgetConfig, usageMeter }) {
  return [
    {
      name: 'agents.set_daily_budget',
      description: 'Configurar (o quitar) el tope diario de gasto GLOBAL para TODOS los agentes combinados — distinto del tope por-agente (maxCostPerDayUsd en agents.create). Si se cruza, ningún agente corre más ese día, ni programado ni manual. Input: { usdPerDay: número, o null para quitar el tope }.',
      risk: 'medium',
      permissions: ['agents:manage'],
      execute: async (input) => {
        if (!budgetConfig) throw new Error('BUDGET_CONFIG_NOT_AVAILABLE');
        const cap = budgetConfig.setGlobalDailyCap(input.usdPerDay ?? null);
        return { ok: true, globalDailyCapUsd: cap, message: cap == null ? 'Tope global de agentes removido.' : `Tope global de agentes: $${cap}/día.` };
      }
    },
    {
      name: 'agents.budget_status',
      description: 'Ver el estado del presupuesto: tope global configurado (si hay), gasto de hoy entre todos los agentes, y si está bloqueado por haber cruzado el tope.',
      risk: 'low',
      permissions: [],
      execute: async () => {
        const globalDailyCapUsd = budgetConfig?.getGlobalDailyCap() ?? null;
        const spentToday = usageMeter?.getCostForDate() ?? 0;
        return {
          globalDailyCapUsd,
          spentToday: Number(spentToday.toFixed(4)),
          blocked: globalDailyCapUsd != null && spentToday >= globalDailyCapUsd,
          agents: store.list().map((a) => ({ id: a.id, name: a.name, maxCostPerDayUsd: a.maxCostPerDayUsd ?? null, costToday: a.costToday || 0 }))
        };
      }
    },
    {
      name: 'agents.create',
      description: 'Crear un agente automático con una misión recurrente. Input: { name, goal (misión en lenguaje natural, será el mensaje que el agente ejecuta), schedule: { type: "daily"|"interval"|"manual", at: "HH:MM" (daily), minutes: N (interval) }, maxRunsPerDay (opcional, default 4), maxCostPerDayUsd (opcional, tope de gasto diario en USD; si una corrida lo cruza, el agente deja de correr ese día aunque le queden corridas) }. Requiere confirmación del usuario antes de crear. Tras crearlo, el sistema corre la misión UNA VEZ de inmediato para validar que de verdad funciona — el resultado vuelve en "validation". Si "validation" muestra que falló por un problema de la propia misión (ej: URL/dominio que no existe, instrucción ambigua que no usó ninguna herramienta), corrige el goal con agents.update_goal y vuelve a probar con agents.run_now antes de responder al usuario. Si tras corregir una vez sigue sin funcionar, dilo explícitamente y pide al usuario lo que falte — no reportes "creado" sin contar cómo salió la prueba.',
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
      required: ['agent'],
      execute: async (input) => store.remove(String(input.agent || ''))
    }
  ];
}

module.exports = {
  createAgentTools
};
