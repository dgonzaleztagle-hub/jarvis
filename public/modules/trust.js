/**
 * trust.js — Modo Confianza.
 * When enabled, Jarvis skips confirmation dialogs for high-risk tools.
 * Preference persists in localStorage and syncs to the server policy engine on load.
 */
import { api } from './api.js';
import { dom } from './state.js';
import { addMessage } from './feed.js';

const KEY = 'jarvis.trustMode';

export async function loadTrustMode() {
  const enabled = localStorage.getItem(KEY) === 'true';
  if (dom.trustModeToggle) dom.trustModeToggle.checked = enabled;
  try { await api('/trust-mode', { method: 'POST', body: JSON.stringify({ enabled }) }); } catch (_) {}
}

export function initTrustToggle() {
  dom.trustModeToggle?.addEventListener('change', async () => {
    const enabled = dom.trustModeToggle.checked;
    localStorage.setItem(KEY, enabled);
    try { await api('/trust-mode', { method: 'POST', body: JSON.stringify({ enabled }) }); } catch (_) {}
    const msg = enabled
      ? 'Modo Confianza activado. Ejecutaré acciones sin pedir confirmación.'
      : 'Modo Confianza desactivado. Pediré confirmación en acciones de riesgo alto.';
    addMessage('jarvis', 'Jarvis', msg, { speakText: msg });
  });
}
