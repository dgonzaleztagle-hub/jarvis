import { api } from './api.js';
import { el } from './state.js';
import * as FloatingPanel from './floating-panel.js';

/* ─── PANEL DE ESPECIALISTAS (Alex/Mara/Teo) ─────────────────────────────────
 * Casa fija en el HUD para los especialistas internos built-in — distinta del
 * panel de AGENTES (agents-panel.js, los cron jobs que crea el usuario con
 * agents.create). Antes solo había un chip flotante que aparecía/desaparecía
 * en 1-2 segundos: si el usuario no miraba en ese instante, sentía que "no
 * existían". Acá quedan siempre visibles, con su nombre/dominio fijos y un
 * pulso cuando están trabajando — igual al patrón ya usado en agents-panel.js.
 */

const STYLE_ID = 'specialists-panel-style';

const COLORS = {
  design: '#00e5ff',
  marketing: '#ff5cf0',
  seo: '#ffb454'
};

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .spec-card { display: flex; align-items: center; gap: 10px; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; background: rgba(0, 20, 30, 0.45); transition: border-color .2s, box-shadow .2s; }
    .spec-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; background: #555; }
    .spec-dot.working { animation: spec-pulse 1.2s ease-in-out infinite; }
    @keyframes spec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    .spec-body { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .spec-name { font-weight: 700; letter-spacing: 0.03em; font-size: 12px; }
    .spec-domain { font-size: 10px; opacity: 0.65; }
    .spec-status { font-size: 10px; opacity: 0.85; font-style: italic; }
    .specialists-empty { font-size: 11px; opacity: 0.6; padding: 8px 2px; }
  `;
  document.head.appendChild(style);
}

// taskId del especialista trabajando AHORA + perfil de voz, para que la
// respuesta hablada de ESE turno use su voz en vez de la de Jarvis —
// correlacionado por taskId con el evento specialist_active (llega por SSE
// mientras el server procesa, antes de que resuelva la respuesta HTTP).
let lastSpecialistTaskId = null;
let lastSpecialistVoiceProfile = null;
let hideTimer = null;
let activeName = null;

export function getVoiceProfileForTask(taskId) {
  return taskId && taskId === lastSpecialistTaskId ? lastSpecialistVoiceProfile : null;
}

function buildCard(specialist) {
  const card = el('div', 'spec-card');
  card.dataset.specName = specialist.name;
  const color = COLORS[specialist.name] || '#00e5ff';
  card.style.borderColor = `${color}33`;

  const dot = el('span', 'spec-dot');
  dot.style.background = color;
  dot.style.boxShadow = `0 0 6px ${color}`;
  card.appendChild(dot);

  const body = el('div', 'spec-body');
  body.appendChild(el('span', 'spec-name', specialist.specialistName));
  body.appendChild(el('span', 'spec-domain', specialist.displayName));
  card.appendChild(body);

  return card;
}

async function render() {
  ensureStyles();
  const container = document.createElement('div');
  let specialists = [];
  try { specialists = (await api('/specialists')).specialists || []; } catch (_) { /* server caído: panel queda vacío hasta el próximo refresh */ }

  if (specialists.length === 0) {
    container.appendChild(el('div', 'specialists-empty', 'Sin especialistas disponibles.'));
  }
  for (const s of specialists) container.appendChild(buildCard(s));

  // zone:'left' — se apila debajo del panel de Agentes (mismo patrón de
  // _reflow en floating-panel.js): casa fija, no aparece/desaparece.
  FloatingPanel.open('specialists', {
    title: '👥  ESPECIALISTAS',
    contentNode: container,
    zone: 'left',
    width: '380px'
  });

  if (activeName) setWorking(activeName, true);
}

// Exportado: voice.js lo usa para prender/apagar el pulso de "trabajando"
// segmento por segmento cuando varios especialistas hablan en el mismo turno
// (ver speakSegments) — el mismo efecto que ya existía para un especialista
// único vía specialist_active, generalizado al caso de varios.
export function setWorking(name, working, statusText) {
  const card = document.querySelector(`.spec-card[data-spec-name="${name}"]`);
  if (!card) return;
  const dot = card.querySelector('.spec-dot');
  if (dot) dot.classList.toggle('working', working);
  let status = card.querySelector('.spec-status');
  if (working) {
    if (!status) {
      status = el('span', 'spec-status');
      card.querySelector('.spec-body').appendChild(status);
    }
    status.textContent = statusText || 'trabajando…';
  } else if (status) {
    status.remove();
  }
}

export async function openSpecialistsPanel() {
  await render();
}

export function setupSpecialistsPanel(stream) {
  stream.addEventListener('specialist_active', (evt) => {
    try {
      const payload = JSON.parse(evt.data).payload || {};
      if (!payload.name) return;
      if (activeName && activeName !== payload.name) setWorking(activeName, false);
      activeName = payload.name;
      lastSpecialistTaskId = payload.taskId || null;
      lastSpecialistVoiceProfile = payload.voiceProfile || null;
      setWorking(activeName, true);
      // Fallback: si no llega el task_completed, apaga el pulso a los 45s.
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (activeName) { setWorking(activeName, false); activeName = null; } }, 45000);
    } catch (_) {}
  });
  const onDone = (evt) => {
    if (!activeName || !lastSpecialistTaskId) return;
    try {
      // El sobre SSE es {id,type,payload,createdAt} — el taskId vive en
      // payload, no en el nivel superior (bug heredado del chip anterior:
      // comparaba contra un campo que nunca existe, así que esto nunca
      // apagaba el indicador salvo por el timeout de respaldo de 45s).
      const { payload } = JSON.parse(evt.data);
      if (payload?.taskId !== lastSpecialistTaskId) return;
    } catch (_) { return; }
    setWorking(activeName, false);
    activeName = null;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  };
  stream.addEventListener('task_completed', onDone);
  stream.addEventListener('task_failed', onDone);
}
