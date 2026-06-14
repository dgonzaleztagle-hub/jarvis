/**
 * preview-panel.js — Renderiza HTML generado por Jarvis (landings, maquetas) en
 * el HUD. Escucha el evento SSE 'hud_show_preview' (emitido por la tool
 * preview.render_html) y abre la página en un panel flotante con un iframe, más
 * un botón "Abrir en grande" que la abre como pestaña real.
 *
 * El iframe va con sandbox="allow-scripts" SIN allow-same-origin: el HTML
 * generado corre aislado, no puede tocar el DOM ni los datos del HUD.
 */
import { el } from './state.js';
import * as FloatingPanel from './floating-panel.js';

export function showPreview({ url, title }) {
  if (!url) return;
  const fullUrl = window.location.origin + url;
  const container = document.createElement('div');

  const frame = document.createElement('iframe');
  frame.src = fullUrl;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'width:100%;height:60vh;border:1px solid rgba(0,229,255,0.25);border-radius:6px;background:#fff';
  container.appendChild(frame);

  const bar = el('div');
  bar.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center';

  const openBtn = document.createElement('button');
  openBtn.textContent = '⛶  Abrir en grande';
  openBtn.style.cssText = 'font-size:11px;padding:4px 12px;border-radius:4px;border:1px solid rgba(0,229,255,0.4);background:transparent;color:inherit;cursor:pointer';
  openBtn.addEventListener('mouseenter', () => { openBtn.style.background = 'rgba(0,229,255,0.15)'; });
  openBtn.addEventListener('mouseleave', () => { openBtn.style.background = 'transparent'; });
  openBtn.addEventListener('click', () => window.open(fullUrl, '_blank', 'noopener'));
  bar.appendChild(openBtn);

  container.appendChild(bar);

  FloatingPanel.open('preview', {
    title: `🌐  ${(title || 'VISTA PREVIA').toUpperCase()}`,
    contentNode: container,
    zone: 'left',
    width: '520px'
  });
}

export function onHudShowPreview(evt) {
  try {
    const event = JSON.parse(evt.data);
    showPreview(event.payload || {});
  } catch (_) {}
}
