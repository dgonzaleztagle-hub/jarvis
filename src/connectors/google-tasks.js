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

function createGoogleTasksTools({ authFactory }) {
  async function listTasklists(input = {}) {
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const response = await withRetry(() =>
      tasks.tasklists.list({ maxResults: Number(input.maxResults) || 20 })
    );
    return {
      tasklists: (response.data.items || []).map((tl) => ({
        id: tl.id,
        title: tl.title,
        updated: tl.updated
      }))
    };
  }

  async function listTasks(input = {}) {
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });

    let tasklistId = input.tasklistId || '@default';
    if (!tasklistId.startsWith('@') && !tasklistId.includes('/')) {
      const lists = await withRetry(() => tasks.tasklists.list({ maxResults: 20 }));
      const match = (lists.data.items || []).find((tl) =>
        tl.title.toLowerCase().includes(String(tasklistId).toLowerCase())
      );
      if (match) tasklistId = match.id;
    }

    const params = {
      tasklist: tasklistId,
      maxResults: Math.min(Number(input.maxResults) || 20, 100),
      showCompleted: input.showCompleted === true,
      showHidden: false
    };
    if (input.dueMin) params.dueMin = new Date(input.dueMin).toISOString();
    if (input.dueMax) params.dueMax = new Date(input.dueMax).toISOString();

    const response = await withRetry(() => tasks.tasks.list(params));
    return {
      tasklistId,
      tasks: (response.data.items || []).map(formatTask)
    };
  }

  async function createTask(input = {}) {
    if (!input.title) throw new Error('TASKS_CREATE_REQUIRES_TITLE');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = input.tasklistId || '@default';

    const resource = { title: input.title };
    if (input.notes) resource.notes = input.notes;
    if (input.due) {
      const dueDate = new Date(input.due);
      if (!Number.isNaN(dueDate.getTime())) resource.due = dueDate.toISOString();
    }

    const response = await withRetry(() =>
      tasks.tasks.insert({ tasklist: tasklistId, requestBody: resource })
    );
    return formatTask(response.data);
  }

  async function completeTask(input = {}) {
    if (!input.taskId) throw new Error('TASKS_COMPLETE_REQUIRES_TASK_ID');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    const tasklistId = input.tasklistId || '@default';

    const response = await withRetry(() =>
      tasks.tasks.patch({
        tasklist: tasklistId,
        task: input.taskId,
        requestBody: { status: 'completed' }
      })
    );
    return formatTask(response.data);
  }

  async function deleteTask(input = {}) {
    if (!input.taskId) throw new Error('TASKS_DELETE_REQUIRES_TASK_ID');
    const auth = authFactory.getClient();
    const tasks = google.tasks({ version: 'v1', auth });
    await withRetry(() =>
      tasks.tasks.delete({ tasklist: input.tasklistId || '@default', task: input.taskId })
    );
    return { deleted: true, taskId: input.taskId };
  }

  return [
    {
      name: 'google.tasks.list_tasklists',
      description: 'List all Google Task lists available in the account.',
      risk: 'low',
      permissions: ['google:tasks:read'],
      execute: listTasklists
    },
    {
      name: 'google.tasks.list_tasks',
      description: 'List tasks from a Google Tasks list. Filters by due date or completion status.',
      risk: 'low',
      permissions: ['google:tasks:read'],
      aliases: {
        tasklistId: ['tasklist_id', 'list', 'lista', 'taskList'],
        showCompleted: ['show_completed', 'completadas', 'incluir_completadas'],
        dueMin: ['due_min', 'desde', 'vence_desde'],
        dueMax: ['due_max', 'hasta', 'vence_hasta'],
        maxResults: ['max_results', 'limit', 'count']
      },
      execute: listTasks
    },
    {
      name: 'google.tasks.create_task',
      description: 'Create a new task in Google Tasks with optional due date and notes.',
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
      name: 'google.tasks.complete_task',
      description: 'Mark a Google Task as completed.',
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
      name: 'google.tasks.delete_task',
      description: 'Delete a task from Google Tasks.',
      risk: 'high',
      permissions: ['google:tasks:write'],
      required: ['taskId'],
      aliases: {
        taskId: ['task_id', 'id', 'tarea_id'],
        tasklistId: ['list', 'lista', 'tasklist_id']
      },
      execute: deleteTask
    }
  ];
}

module.exports = { createGoogleTasksTools };
