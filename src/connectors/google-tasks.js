const { google } = require('googleapis');
const { withRetry } = require('../utils/retry');

function formatTask(task) {
  return {
    id: task.id,
    title: task.title || '(sin título)',
    notes: task.notes || '',
    status: task.status,
    due: task.due || null,
    completed: task.completed || null,
    updated: task.updated,
    selfLink: task.selfLink
  };
}

// Resuelve tasklistId: acepta el id directo, "@default", o busca por nombre parcial.
async function resolveTasklistId(tasks, raw) {
  const id = String(raw || '@default').trim();
  if (id === '@default' || id.startsWith('@') || id.includes('/')) return id;

  const lists = await withRetry(() => tasks.tasklists.list({ maxResults: 20 }));
  const match = (lists.data.items || []).find(
    (tl) => tl.title.toLowerCase().includes(id.toLowerCase())
  );
  return match ? match.id : id;
}

function createGoogleTasksTools({ authFactory }) {
  async function listTasklists(input = {}) {
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const response = await withRetry(() => tasks.tasklists.list({ maxResults: Number(input.maxResults) || 20 }));
    return {
      tasklists: (response.data.items || []).map((tl) => ({ id: tl.id, title: tl.title, updated: tl.updated }))
    };
  }

  async function listTasks(input = {}) {
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = await resolveTasklistId(tasks, input.tasklistId);

    const params = {
      tasklist: tasklistId,
      maxResults: Math.min(Number(input.maxResults) || 20, 100),
      showCompleted: input.showCompleted === true,
      showHidden: false
    };
    if (input.dueMin) params.dueMin = new Date(input.dueMin).toISOString();
    if (input.dueMax) params.dueMax = new Date(input.dueMax).toISOString();

    const response = await withRetry(() => tasks.tasks.list(params));
    return { tasklistId, tasks: (response.data.items || []).map(formatTask) };
  }

  async function createTask(input = {}) {
    if (!input.title) throw new Error('TASKS_CREATE_REQUIRES_TITLE');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = await resolveTasklistId(tasks, input.tasklistId);

    const resource = { title: input.title };
    if (input.notes) resource.notes = input.notes;
    if (input.due) {
      const dueDate = new Date(input.due);
      if (!Number.isNaN(dueDate.getTime())) resource.due = dueDate.toISOString();
    }

    const response = await withRetry(() => tasks.tasks.insert({ tasklist: tasklistId, requestBody: resource }));
    return formatTask(response.data);
  }

  async function updateTask(input = {}) {
    if (!input.taskId) throw new Error('TASKS_UPDATE_REQUIRES_TASK_ID');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = await resolveTasklistId(tasks, input.tasklistId);

    const patch = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.due !== undefined) {
      if (!input.due) {
        patch.due = null;
      } else {
        const dueDate = new Date(input.due);
        if (!Number.isNaN(dueDate.getTime())) patch.due = dueDate.toISOString();
      }
    }

    const response = await withRetry(() =>
      tasks.tasks.patch({ tasklist: tasklistId, task: input.taskId, requestBody: patch })
    );
    return formatTask(response.data);
  }

  async function completeTask(input = {}) {
    if (!input.taskId) throw new Error('TASKS_COMPLETE_REQUIRES_TASK_ID');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = await resolveTasklistId(tasks, input.tasklistId);

    const response = await withRetry(() =>
      tasks.tasks.patch({ tasklist: tasklistId, task: input.taskId, requestBody: { status: 'completed' } })
    );
    return formatTask(response.data);
  }

  async function reopenTask(input = {}) {
    if (!input.taskId) throw new Error('TASKS_REOPEN_REQUIRES_TASK_ID');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = await resolveTasklistId(tasks, input.tasklistId);

    const response = await withRetry(() =>
      tasks.tasks.patch({
        tasklist: tasklistId,
        task: input.taskId,
        requestBody: { status: 'needsAction', completed: null }
      })
    );
    return formatTask(response.data);
  }

  async function deleteTask(input = {}) {
    if (!input.taskId) throw new Error('TASKS_DELETE_REQUIRES_TASK_ID');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = await resolveTasklistId(tasks, input.tasklistId);

    await withRetry(() => tasks.tasks.delete({ tasklist: tasklistId, task: input.taskId }));
    return { deleted: true, taskId: input.taskId };
  }

  async function createTasklist(input = {}) {
    if (!input.title) throw new Error('TASKLIST_TITLE_REQUIRED');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const response = await withRetry(() =>
      tasks.tasklists.insert({ requestBody: { title: String(input.title).trim() } })
    );
    return { id: response.data.id, title: response.data.title, updated: response.data.updated };
  }

  return [
    {
      name: 'google.tasks.list_tasklists',
      description: 'Listar todas las listas de tareas de Google Tasks.',
      risk: 'low',
      permissions: ['google:tasks:read'],
      execute: listTasklists
    },
    {
      name: 'google.tasks.list_tasks',
      description: 'Ver tareas de una lista de Google Tasks. Filtra por fecha de vencimiento o estado. Input: { tasklistId? (nombre o id, default: lista principal), showCompleted?, dueMin?, dueMax? }.',
      risk: 'low',
      permissions: ['google:tasks:read'],
      aliases: {
        tasklistId: ['tasklist_id', 'list', 'lista', 'taskList'],
        showCompleted: ['show_completed', 'completadas'],
        dueMin: ['due_min', 'desde', 'vence_desde'],
        dueMax: ['due_max', 'hasta', 'vence_hasta'],
        maxResults: ['max_results', 'limit', 'count']
      },
      execute: listTasks
    },
    {
      name: 'google.tasks.create_task',
      description: 'Crear una tarea nueva en Google Tasks. Input: { title, notes?, due?: fecha ISO o texto, tasklistId? }.',
      risk: 'medium',
      permissions: ['google:tasks:write'],
      required: ['title'],
      aliases: {
        title: ['titulo', 'nombre', 'task', 'tarea'],
        notes: ['notas', 'description', 'descripcion', 'detalle'],
        due: ['fecha', 'vencimiento', 'deadline', 'due_date'],
        tasklistId: ['list', 'lista', 'tasklist_id']
      },
      execute: createTask
    },
    {
      name: 'google.tasks.update_task',
      description: 'Editar una tarea existente: cambiar título, notas o fecha de vencimiento. Input: { taskId, title?, notes?, due? (ISO o null para quitar fecha), tasklistId? }. Solo se actualizan los campos que se pasan.',
      risk: 'medium',
      permissions: ['google:tasks:write'],
      required: ['taskId'],
      aliases: {
        taskId: ['task_id', 'id', 'tarea_id'],
        tasklistId: ['list', 'lista', 'tasklist_id'],
        title: ['titulo', 'nombre'],
        notes: ['notas', 'descripcion', 'detalle'],
        due: ['fecha', 'vencimiento', 'deadline']
      },
      execute: updateTask
    },
    {
      name: 'google.tasks.complete_task',
      description: 'Marcar una tarea como completada. Input: { taskId, tasklistId? }.',
      risk: 'medium',
      permissions: ['google:tasks:write'],
      required: ['taskId'],
      aliases: {
        taskId: ['task_id', 'id', 'tarea_id'],
        tasklistId: ['list', 'lista', 'tasklist_id']
      },
      execute: completeTask
    },
    {
      name: 'google.tasks.reopen_task',
      description: 'Marcar una tarea completada como pendiente nuevamente (reabrir). Input: { taskId, tasklistId? }.',
      risk: 'medium',
      permissions: ['google:tasks:write'],
      required: ['taskId'],
      aliases: {
        taskId: ['task_id', 'id', 'tarea_id'],
        tasklistId: ['list', 'lista', 'tasklist_id']
      },
      execute: reopenTask
    },
    {
      name: 'google.tasks.delete_task',
      description: 'Eliminar una tarea de Google Tasks. Input: { taskId, tasklistId? }.',
      risk: 'high',
      permissions: ['google:tasks:write'],
      required: ['taskId'],
      aliases: {
        taskId: ['task_id', 'id', 'tarea_id'],
        tasklistId: ['list', 'lista', 'tasklist_id']
      },
      execute: deleteTask
    },
    {
      name: 'google.tasks.create_tasklist',
      description: 'Crear una lista de tareas nueva en Google Tasks. Input: { title }.',
      risk: 'medium',
      permissions: ['google:tasks:write'],
      required: ['title'],
      aliases: { title: ['nombre', 'name', 'lista'] },
      execute: createTasklist
    }
  ];
}

module.exports = { createGoogleTasksTools };
