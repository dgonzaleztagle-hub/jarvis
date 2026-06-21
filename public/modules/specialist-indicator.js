/**
 * specialist-indicator.js — "Alex · Diseño · trabajando…" en el HUD.
 *
 * Capa visual honesta de los módulos-especialistas: cuando el runtime emite
 * 'specialist_active' (un turno entró en el dominio de un módulo), muestra un
 * chip con quién está trabajando. Se oculta cuando la tarea de ese turno termina
 * (task_completed/task_failed con el mismo taskId), con un fallback por timeout.
 *
 * Genérico: sirve para cualquier especialista (Alex, Mara, …). NO es el avatar
 * animado (eso es teatro/otra capa); es el indicador real de lo que pasa.
 */

const COLORS = {
  'Diseño': '#00e5ff',
  'Marketing': '#ff5cf0'
};

let chip = null;
let activeTaskId = null;
let hideTimer = null;

function ensureChip() {
  if (chip) return chip;
  chip = document.createElement('div');
  chip.id = 'specialistChip';
  chip.style.cssText = [
    'position:fixed', 'top:68px', 'left:20px',
    'z-index:9000', 'display:none', 'align-items:center', 'gap:10px',
    'padding:7px 14px 7px 10px', 'border-radius:999px',
    'background:rgba(8,16,24,0.82)', 'backdrop-filter:blur(6px)',
    'border:1px solid rgba(0,229,255,0.35)', 'box-shadow:0 0 18px rgba(0,229,255,0.18)',
    'font:600 12px/1 system-ui,-apple-system,Segoe UI,sans-serif', 'color:#cfeef5',
    'letter-spacing:0.02em', 'pointer-events:none', 'transition:opacity .25s'
  ].join(';');
  document.body.appendChild(chip);
  return chip;
}

function show({ specialist, domain }) {
  const c = ensureChip();
  const color = COLORS[domain] || '#00e5ff';
  const initial = (specialist || domain || '?').trim().charAt(0).toUpperCase();
  c.style.borderColor = hexA(color, 0.4);
  c.style.boxShadow = `0 0 18px ${hexA(color, 0.22)}`;
  c.innerHTML = `
    <span style="display:inline-flex;width:22px;height:22px;border-radius:50%;align-items:center;justify-content:center;background:${hexA(color, 0.18)};border:1px solid ${hexA(color, 0.55)};color:${color};font-weight:700">${escapeHtml(initial)}</span>
    <span><b style="color:${color}">${escapeHtml(specialist || domain)}</b> · ${escapeHtml(domain)} · <span style="opacity:.8">trabajando</span><span class="specDots"></span></span>
  `;
  c.style.display = 'flex';
  c.style.opacity = '1';
  animateDots(c.querySelector('.specDots'));
}

function hide() {
  if (!chip) return;
  chip.style.opacity = '0';
  setTimeout(() => { if (chip) chip.style.display = 'none'; }, 250);
  activeTaskId = null;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

let dotsTimer = null;
function animateDots(node) {
  if (!node) return;
  if (dotsTimer) clearInterval(dotsTimer);
  let n = 0;
  dotsTimer = setInterval(() => {
    if (!chip || chip.style.display === 'none') { clearInterval(dotsTimer); dotsTimer = null; return; }
    n = (n + 1) % 4;
    node.textContent = '.'.repeat(n);
  }, 450);
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function setupSpecialistIndicator(stream) {
  stream.addEventListener('specialist_active', (evt) => {
    try {
      const payload = JSON.parse(evt.data).payload || {};
      if (!payload.specialist && !payload.domain) return;
      activeTaskId = payload.taskId || null;
      show(payload);
      // Fallback: si no llega el task_completed, oculta a los 45s.
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 45000);
    } catch (_) {}
  });
  const onDone = (evt) => {
    try {
      const e = JSON.parse(evt.data);
      if (activeTaskId && e.taskId === activeTaskId) hide();
    } catch (_) {}
  };
  stream.addEventListener('task_completed', onDone);
  stream.addEventListener('task_failed', onDone);
}
