class TaskRuntime {
  constructor({ eventBus, toolRegistry }) {
    this.eventBus = eventBus;
    this.toolRegistry = toolRegistry;
    this.tasks = new Map();
  }

  createTask({ title, type = 'general', input = {}, origin = null }) {
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      title,
      type,
      origin,
      input,
      status: 'queued',
      events: [],
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.tasks.set(task.id, task);
    this.emitTaskEvent(task, 'task_created', { title, type });
    return task;
  }

  emitTaskEvent(task, type, payload = {}) {
    task.updatedAt = new Date().toISOString();
    task.events.push({ type, payload, createdAt: task.updatedAt });
    this.eventBus.emit(type, { taskId: task.id, ...payload });
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  listTasks() {
    return Array.from(this.tasks.values());
  }

  async runToolTask(taskId, toolName, input = {}, context = {}) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.toolName = toolName;
    task.input = input;
    task.status = 'running';
    this.emitTaskEvent(task, 'task_started', { toolName });

    try {
      const result = await this.toolRegistry.execute(toolName, input, context);
      if (result.confirmationRequired) {
        task.status = 'waiting_confirmation';
        this.emitTaskEvent(task, 'task_needs_confirmation', { toolName, policy: result.policy, origin: task.origin });
        return task;
      }
      if (result.blocked) {
        task.status = 'blocked';
        task.error = result.policy;
        this.emitTaskEvent(task, 'task_failed', { reason: 'policy_denied', policy: result.policy });
        return task;
      }

      task.status = 'completed';
      task.result = result.output;
      this.emitTaskEvent(task, 'task_completed', { toolName });
      return task;
    } catch (error) {
      task.status = 'failed';
      task.error = { message: error.message };
      this.emitTaskEvent(task, 'task_failed', { message: error.message });
      return task;
    }
  }

  async confirmTask(taskId, context = {}) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status !== 'waiting_confirmation') {
      throw new Error(`Task is not waiting for confirmation: ${task.status}`);
    }
    if (!task.toolName) {
      throw new Error('Task has no toolName to resume');
    }

    this.emitTaskEvent(task, 'task_confirmed', { toolName: task.toolName });
    return this.runToolTask(task.id, task.toolName, task.input || {}, {
      ...context,
      confirmed: true
    });
  }
}

module.exports = {
  TaskRuntime
};
