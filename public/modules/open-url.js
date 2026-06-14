/**
 * open-url.js — Abre páginas web pedidas por Jarvis.
 * Escucha el evento SSE 'hud_open_url' (emitido por el tool hud.open_url
 * desde cualquier canal) y abre la URL en una pestaña nueva. Si el navegador
 * bloquea el pop-up, deja un link clickeable en el feed como respaldo.
 */
import { addMessage } from './feed.js';

export function openExternalUrl({ url, label }) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    addMessage('jarvis', 'Jarvis', `Abrir ${label || 'la página'}: ${url}`, { silentVoice: true });
  }
}

export function onHudOpenUrl(evt) {
  try {
    const event = JSON.parse(evt.data);
    openExternalUrl(event.payload || {});
  } catch (_) {}
}
