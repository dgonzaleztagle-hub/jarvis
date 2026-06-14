import { state, dom, el } from './state.js';
import { api } from './api.js';
import { addMessage, buildDisplay } from './feed.js';

/* ─── CONSTANTS ─────────────────────────────────────────────────────────────── */
export const STATUS_ES = {
  waiting_confirmation: 'ESPERANDO CONFIRMACIÓN',
  completed: 'COMPLETADO', failed: 'FALLIDO',
  running: 'EN PROCESO', pending: 'PENDIENTE', queued: 'EN COLA'
};

export const EVENT_LABELS = {
  task_started:            'Tarea iniciada',
  task_progress:           'En progreso',
  task_completed:          'Tarea completada',
  task_failed:             'Tarea fallida',
  task_needs_confirmation: 'Requiere aprobación',
  task_confirmed:          'Acción confirmada'
};

/* ─── HELPERS ───────────────────────────────────────────────────────────────── */
export function findPendingToolResult(task) {
  return task?.result?.toolResults?.find(r=>r.status==='waiting_confirmation');
}

function formatToolClosure(task) {
  const result=task?.result||{};
  if (task?.status==='failed') return { speak:'No pude completar la acción.', visual:`Falló ${task.toolName||'la acción'}: ${task.error?.message||'error desconocido'}` };
  if (task?.toolName==='google.gmail.send_email') {
    const to=result.resolvedRecipient||task?.input?.to||'destinatario';
    return { speak:'Listo. El correo ya fue enviado.', visual:`Correo enviado a ${to}.` };
  }
  return { speak:'Listo. La acción fue completada.', visual:task?.toolName?`Completado: ${task.toolName}`:'' };
}

export function announceTaskClosure(task) {
  if (!task?.id||state.announcedTaskClosures.has(task.id)) return;
  state.pendingChatConfirmations.delete(task.id);
  state.announcedTaskClosures.add(task.id);
  const closure=formatToolClosure(task);
  addMessage('jarvis','Jarvis',buildDisplay(closure),{voiceResult:closure});
}

export async function confirmPendingTask(taskId) {
  state.pendingChatConfirmations.add(taskId);
  const data=await api(`/tasks/${taskId}/confirm`,{method:'POST',body:'{}'});
  addMessage('jarvis','Jarvis','Confirmado. Ejecutando la acción.',{silentVoice:false});
  if (data?.task&&['completed','failed'].includes(data.task.status)) announceTaskClosure(data.task);
  await loadTasks();
  return data?.task||null;
}

/* ─── RENDERERS ─────────────────────────────────────────────────────────────── */
export function updateActivityBadge(count) {
  if (count>0) { dom.activityBadge.textContent=count; dom.activityBadge.classList.remove('hidden'); }
  else dom.activityBadge.classList.add('hidden');
}

export function renderTasks(tasks) {
  dom.tasksList.innerHTML='';
  const active=tasks.filter(t=>!['completed','failed'].includes(t.status));
  const recent=tasks.filter(t=>['completed','failed'].includes(t.status)).slice(-3);
  const all=[...active,...recent].reverse();

  if (!all.length) { dom.tasksList.appendChild(el('div','task-meta','Sin tareas activas')); updateActivityBadge(0); return; }
  updateActivityBadge(active.length);

  // Update PERMISOS badge
  const waitingCount=tasks.filter(t=>t.status==='waiting_confirmation').length;
  const permisosBadge=document.getElementById('permisosBadge');
  if (permisosBadge) {
    if (waitingCount>0) { permisosBadge.textContent=waitingCount; permisosBadge.classList.remove('hidden'); }
    else permisosBadge.classList.add('hidden');
  }

  for (const t of all) {
    const card=el('div',`task-card ${t.status||''}`);
    card.appendChild(el('div','task-title',t.title));
    card.appendChild(el('div','task-status',STATUS_ES[t.status]||(t.status||'').toUpperCase()));
    if (t.toolName) card.appendChild(el('div','task-meta',t.toolName));
    dom.tasksList.appendChild(card);
  }
  if (active.length>0&&!dom.activityPanel.classList.contains('panel-open')) {
    document.dispatchEvent(new CustomEvent('jarvis:open-activity'));
  }
}

export function renderEvents() {
  dom.eventsList.innerHTML='';
  const recent=state.events.slice(-12).reverse();
  if (!recent.length) { dom.eventsList.appendChild(el('div','task-meta','Sin actividad reciente')); return; }
  for (const ev of recent) {
    const item=el('div','event-item');
    item.appendChild(el('span','event-type',EVENT_LABELS[ev.type]||ev.type.replace(/_/g,' ')));
    const d=new Date(ev.createdAt||Date.now());
    item.appendChild(el('span','event-time',d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'})));
    dom.eventsList.appendChild(item);
  }
}

/* ─── LOADER ────────────────────────────────────────────────────────────────── */
export async function loadTasks() {
  const data=await api('/tasks');
  renderTasks(data.tasks||[]);
}
