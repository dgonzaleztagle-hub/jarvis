/**
 * inbox-viewer.js — Muestra archivos de la bandeja local en el HUD.
 * Escucha el evento SSE 'hud_show_file' (emitido por el tool hud.show_file
 * desde cualquier canal: HUD, Telegram, agentes) y abre el archivo en un
 * panel flotante. Imágenes inline; PDF/otros como enlace.
 */
import { el } from './state.js';
import * as FloatingPanel from './floating-panel.js';

export function showInboxFile({ name, url, kind }) {
  if (!url) return;
  const container = document.createElement('div');

  if (kind === 'image') {
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    img.style.cssText = 'max-width:100%;max-height:60vh;display:block;border-radius:6px';
    container.appendChild(img);
  } else if (kind === 'pdf') {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.style.cssText = 'width:100%;height:60vh;border:none;border-radius:6px;background:#fff';
    container.appendChild(frame);
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = `Abrir ${name}`;
    container.appendChild(link);
  }

  const meta = el('div', '', name);
  meta.style.cssText = 'font-size:10px;opacity:0.6;margin-top:6px;word-break:break-all';
  container.appendChild(meta);

  FloatingPanel.open('inbox-file', {
    title: '📥  ARCHIVO RECIBIDO',
    contentNode: container,
    zone: 'left',
    width: '420px'
  });
}

export function onHudShowFile(evt) {
  try {
    const event = JSON.parse(evt.data);
    showInboxFile(event.payload || {});
  } catch (_) {}
}
