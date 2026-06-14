const fs = require('fs');
const path = require('path');

const SCHEDULE_TYPES = ['daily', 'interval', 'manual'];

function validateDefinition(def = {}) {
  const errors = [];
  if (!String(def.name || '').trim()) errors.push('name requerido');
  if (!String(def.goal || '').trim()) errors.push('goal requerido');
  const schedule = def.schedule || { type: 'manual' };
  if (!SCHEDULE_TYPES.includes(schedule.type)) {
    errors.push(`schedule.type debe ser uno de: ${SCHEDULE_TYPES.join(', ')}`);
  }
  if (schedule.type === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(schedule.at || ''))) {
    errors.push('schedule.at debe ser hora "HH:MM" (24h)');
  }
  if (schedule.type === 'interval' && !(Number(schedule.minutes) >= 5)) {
    errors.push('schedule.minutes debe ser un número >= 5');
  }
  return errors;
}

class AgentStore {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'agents');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  filePath(id) {
    return path.join(this.dir, `${id}.json`);
  }

  list() {
    return fs.readdirSync(this.dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf-8')))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  get(idOrName) {
    const needle = String(idOrName || '').trim().toLowerCase();
    if (!needle) return null;
    return this.list().find(
      (agent) => agent.id === idOrName || agent.name.toLowerCase() === needle
    ) || null;
  }

  create(def = {}) {
    const errors = validateDefinition(def);
    if (errors.length > 0) {
      const error = new Error(`AGENT_DEFINITION_INVALID: ${errors.join('; ')}`);
      error.validation = errors;
      throw error;
    }
    if (this.get(def.name)) throw new Error(`AGENT_NAME_TAKEN: ya existe un agente llamado "${def.name}"`);

    const agent = {
      id: `agent_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      name: String(def.name).trim(),
      goal: String(def.goal).trim(),
      schedule: def.schedule || { type: 'manual' },
      // Presupuesto duro: el scheduler nunca ejecuta más allá de esto por día.
      maxRunsPerDay: Math.max(1, Math.min(Number(def.maxRunsPerDay) || 4, 24)),
      enabled: def.enabled !== false,
      lastRunAt: null,
      runsToday: 0,
      runsTodayDate: null,
      lastResult: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(this.filePath(agent.id), JSON.stringify(agent, null, 2), 'utf-8');
    return agent;
  }

  update(id, patch = {}) {
    const agent = this.get(id);
    if (!agent) throw new Error(`AGENT_NOT_FOUND: ${id}`);
    const updated = { ...agent, ...patch, id: agent.id, updatedAt: new Date().toISOString() };
    fs.writeFileSync(this.filePath(agent.id), JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  remove(idOrName) {
    const agent = this.get(idOrName);
    if (!agent) throw new Error(`AGENT_NOT_FOUND: ${idOrName}`);
    fs.rmSync(this.filePath(agent.id));
    return { removed: agent.id, name: agent.name };
  }
}

module.exports = {
  AgentStore,
  validateDefinition
};
