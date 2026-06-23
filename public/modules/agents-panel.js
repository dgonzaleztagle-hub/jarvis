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
    .agent-dot.working { background: #2bff88; animation: agent-pulse 1.4s ease-in-out infinite; }
    @keyframes agent-pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 6px #2bff88; } 50% { opacity: 0.35; box-shadow: 0 0 16px #2bff88; } }
    .agent-card.working { border-color: rgba(43, 255, 136, 0.5); }
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
    .agent-result.needs-input { border-left-color: rgba(255, 196, 0, 0.7); color: #ffd866; }
    .agent-answer { display: flex; gap: 6px; margin-bottom: 8px; }
    .agent-answer input { flex: 1; font-size: 10px; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(255, 196, 0, 0.5); background: rgba(0, 0, 0, 0.3); color: inherit; }
    .agent-answer button { font-size: 10px; padding: 3px 10px; border-radius: 4px; border: 1px solid rgba(255, 196, 0, 0.6); background: rgba(255, 196, 0, 0.15); color: inherit; cursor: pointer; }
    .agent-answer button:hover { background: rgba(255, 196, 0, 0.3); }
  `;
  document.head.appendChild(style);
}

const WEEKDAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function humanSchedule(schedule = {}) {
  if (schedule.type === 'daily') return `Diario a las ${schedule.at}`;
  if (schedule.type === 'interval') return `Cada ${schedule.minutes} min`;
  if (schedule.type === 'weekly') {
    const days = (schedule.daysOfWeek || []).map((d) => WEEKDAY_LABELS[d] || d).join(', ');
    return `${days} a las ${schedule.at}`;
  }
  return 'Manual';
}

function humanLastRun(agent) {
  if (!agent.lastRunAt) return 'Nunca ha corrido';
  const date = new Date(agent.lastRunAt);
  const when = date.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const status = agent.lastResult?.status === 'failed' ? ' · falló' : '';
  return `Última corrida: ${when}${status}`;
}

// agentIds que están corriendo AHORA MISMO, según los eventos SSE
// agent_run_started/completed/failed/needs_*. Vive a nivel de módulo (no del
// panel) para sobrevivir a refresh() y poder pintar el pulso apenas llega el
// evento, sin esperar al próximo poll de /agents.
const runningIds = new Set();

function buildAgentCard(agent, refresh) {
  const card = el('div', 'agent-card');
  card.dataset.agentId = agent.id;
  const working = agent.running || runningIds.has(agent.id);
  if (working) card.classList.add('working');

  const head = el('div', 'agent-head');
  head.appendChild(el('span', `agent-dot ${working ? 'working' : (agent.enabled ? 'on' : 'off')}`));
  head.appendChild(el('span', 'agent-name', agent.name));
  card.appendChild(head);

  card.appendChild(el('div', 'agent-goal', agent.goal));
  card.appendChild(el('div', 'agent-meta', `${humanSchedule(agent.schedule)} · máx ${agent.maxRunsPerDay}/día · ${humanLastRun(agent)}`));

  // Resultado de la última corrida — para que "Ejecutar ahora" no quede sin
  // ninguna respuesta visible (ni en chat ni acá).
  const lastResult = agent.lastResult;
  if (lastResult) {
    const failed = lastResult.status === 'failed';
    const needsInput = lastResult.status === 'needs_input';
    const text = failed
      ? `Falló: ${lastResult.error || 'error desconocido'}`
      : (lastResult.speak || 'Sin novedades que reportar.');
    card.appendChild(el('div', `agent-result${failed ? ' failed' : ''}${needsInput ? ' needs-input' : ''}`, text));

    // Pregunta pendiente de una corrida desatendida (ej: falta un dato) — a
    // diferencia de antes, acá SÍ se puede responder sin abrir el chat ni
    // recrear el agente. La respuesta se inyecta solo en esta corrida puntual.
    if (needsInput) {
      const answerRow = el('div', 'agent-answer');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Responde aquí...';
      const answerBtn = document.createElement('button');
      answerBtn.textContent = 'Responder';
      answerBtn.addEventListener('click', async () => {
        const answer = input.value.trim();
        if (!answer) return;
        answerBtn.disabled = true;
        answerBtn.textContent = 'Enviando...';
        try { await api('/agents/answer', { method: 'POST', body: JSON.stringify({ agent: agent.id, answer }) }); }
        finally { refresh(); }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') answerBtn.click(); });
      answerRow.appendChild(input);
      answerRow.appendChild(answerBtn);
      card.appendChild(answerRow);
    }
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

    // zone:'left' — vive fijo en esa columna junto al correo/landings, que se
    // pueden cerrar y no compiten por el espacio. Es la casa permanente de los
    // agentes en el HUD, no un panel que aparece y desaparece.
    FloatingPanel.open('agents', {
      title: `⚙  AGENTES (${agents.filter(a => a.enabled).length}/${agents.length})`,
      contentNode: container,
      zone: 'left',
      width: '380px'
    });
  };

  await refresh();
}

// Prende/apaga el pulso de "trabajando" en el momento real del evento SSE
// (agent_run_started / agent_run_completed|failed|needs_*), sin esperar al
// próximo refresh. Si el panel está abierto, toca el DOM directo (sin
// recargar de /agents — evita parpadeo y no pierde texto que el usuario
// esté escribiendo en el input de "Responder").
export function markAgentRunning(agentId, isRunning) {
  if (isRunning) runningIds.add(agentId); else runningIds.delete(agentId);
  const card = document.querySelector(`.agent-card[data-agent-id="${agentId}"]`);
  if (!card) return;
  card.classList.toggle('working', isRunning);
  const dot = card.querySelector('.agent-dot');
  if (dot) {
    dot.classList.remove('on', 'off', 'working');
    dot.classList.add(isRunning ? 'working' : 'on');
  }
}
