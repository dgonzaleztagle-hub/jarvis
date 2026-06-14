import { api } from './api.js';
import { el } from './state.js';
import * as FloatingPanel from './floating-panel.js';

/* ─── PANEL DE AGENTES VIVOS ────────────────────────────────────────────────── */

const STYLE_ID = 'agents-panel-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .agent-card { border: 1px solid rgba(0, 229, 255, 0.25); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; background: rgba(0, 20, 30, 0.45); }
    .agent-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .agent-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .agent-dot.on { background: #2bff88; box-shadow: 0 0 6px #2bff88; }
    .agent-dot.off { background: #666; }
    .agent-name { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; font-size: 12px; }
    .agent-goal { font-size: 11px; opacity: 0.8; margin-bottom: 6px; line-height: 1.4; }
    .agent-meta { font-size: 10px; opacity: 0.6; margin-bottom: 8px; }
    .agent-result { font-size: 10px; opacity: 0.75; margin-bottom: 8px; padding: 4px 6px; border-left: 2px solid rgba(0, 229, 255, 0.35); line-height: 1.4; }
    .agent-result.failed { border-left-color: rgba(255, 80, 80, 0.6); color: #ff9090; }
    .agent-actions { display: flex; gap: 8px; }
    .agent-btn { font-size: 10px; padding: 3px 10px; border-radius: 4px; border: 1px solid rgba(0, 229, 255, 0.4); background: transparent; color: inherit; cursor: pointer; }
    .agent-btn:hover { background: rgba(0, 229, 255, 0.15); }
    .agent-btn.danger { border-color: rgba(255, 80, 80, 0.45); margin-left: auto; }
    .agent-btn.danger:hover { background: rgba(255, 80, 80, 0.15); }
    .agent-btn.danger.arm { background: rgba(255, 80, 80, 0.25); border-color: #ff5050; color: #ff9090; }
    .agents-empty { font-size: 11px; opacity: 0.6; padding: 8px 2px; }
  `;
  document.head.appendChild(style);
}

function humanSchedule(schedule = {}) {
  if (schedule.type === 'daily') return `Diario a las ${schedule.at}`;
  if (schedule.type === 'interval') return `Cada ${schedule.minutes} min`;
  return 'Manual';
}

function humanLastRun(agent) {
  if (!agent.lastRunAt) return 'Nunca ha corrido';
  const date = new Date(agent.lastRunAt);
  const when = date.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const status = agent.lastResult?.status === 'failed' ? ' · falló' : '';
  return `Última corrida: ${when}${status}`;
}

function buildAgentCard(agent, refresh) {
  const card = el('div', 'agent-card');

  const head = el('div', 'agent-head');
  head.appendChild(el('span', `agent-dot ${agent.enabled ? 'on' : 'off'}`));
  head.appendChild(el('span', 'agent-name', agent.name));
  card.appendChild(head);

  card.appendChild(el('div', 'agent-goal', agent.goal));
  card.appendChild(el('div', 'agent-meta', `${humanSchedule(agent.schedule)} · máx ${agent.maxRunsPerDay}/día · ${humanLastRun(agent)}`));

  // Resultado de la última corrida — para que "Ejecutar ahora" no quede sin
  // ninguna respuesta visible (ni en chat ni acá).
  const lastResult = agent.lastResult;
  if (lastResult) {
    const failed = lastResult.status === 'failed';
    const text = failed
      ? `Falló: ${lastResult.error || 'error desconocido'}`
      : (lastResult.speak || 'Sin novedades que reportar.');
    card.appendChild(el('div', `agent-result${failed ? ' failed' : ''}`, text));
  }

  const actions = el('div', 'agent-actions');

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'agent-btn';
  toggleBtn.textContent = agent.enabled ? 'Pausar' : 'Activar';
  toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;
    await api('/agents/toggle', { method: 'POST', body: JSON.stringify({ agent: agent.id, enabled: !agent.enabled }) });
    refresh();
  });
  actions.appendChild(toggleBtn);

  const runBtn = document.createElement('button');
  runBtn.className = 'agent-btn';
  runBtn.textContent = 'Ejecutar ahora';
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Corriendo...';
    try { await api('/agents/run', { method: 'POST', body: JSON.stringify({ agent: agent.id }) }); }
    finally { refresh(); }
  });
  actions.appendChild(runBtn);

  // Borrar con confirmación en dos clics: el primero arma el botón, el segundo
  // (dentro de 4s) ejecuta. Evita borrados por clic accidental sin modal.
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'agent-btn danger';
  deleteBtn.textContent = 'Borrar';
  let armTimer = null;
  deleteBtn.addEventListener('click', async () => {
    if (!deleteBtn.classList.contains('arm')) {
      deleteBtn.classList.add('arm');
      deleteBtn.textContent = '¿Seguro?';
      armTimer = setTimeout(() => {
        deleteBtn.classList.remove('arm');
        deleteBtn.textContent = 'Borrar';
      }, 4000);
      return;
    }
    clearTimeout(armTimer);
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Borrando...';
    try { await api('/agents/delete', { method: 'POST', body: JSON.stringify({ agent: agent.id }) }); }
    finally { refresh(); }
  });
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

export async function openAgentsPanel() {
  ensureStyles();
  const container = document.createElement('div');

  const refresh = async () => {
    const data = await api('/agents');
    const agents = data.agents || [];
    container.replaceChildren();
    if (agents.length === 0) {
      container.appendChild(el('div', 'agents-empty', 'No hay agentes creados. Pídele a Jarvis que cree uno.'));
    }
    for (const agent of agents) container.appendChild(buildAgentCard(agent, refresh));

    FloatingPanel.open('agents', {
      title: `⚙  AGENTES (${agents.filter(a => a.enabled).length}/${agents.length})`,
      contentNode: container,
      zone: 'right',
      width: '380px'
    });
  };

  await refresh();
}
