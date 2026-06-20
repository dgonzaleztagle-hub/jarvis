// Modal de ingreso de credenciales.
// Se activa vía SSE evento hud_request_credentials emitido por hud.request_credentials.
// El usuario llena los campos y confirma → POST /credentials/respond.

import { api } from './api.js';

let _activeModal = null;

const STYLES = `
  .cred-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    animation: cred-fade-in .18s ease;
  }
  @keyframes cred-fade-in { from { opacity:0 } to { opacity:1 } }
  .cred-box {
    background: #0f1117; border: 1px solid #2d3748;
    border-radius: 14px; padding: 28px 32px; width: 420px; max-width: 94vw;
    box-shadow: 0 24px 64px rgba(0,0,0,.7);
    animation: cred-slide-in .2s ease;
  }
  @keyframes cred-slide-in { from { transform:translateY(12px); opacity:0 } to { transform:translateY(0); opacity:1 } }
  .cred-service-badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: #1a2035; border: 1px solid #2d3a58; border-radius: 8px;
    padding: 6px 12px; margin-bottom: 16px; font-size: 13px; color: #63b3ed;
  }
  .cred-title { font-size: 17px; font-weight: 600; color: #e2e8f0; margin-bottom: 6px; }
  .cred-desc  { font-size: 13px; color: #718096; margin-bottom: 22px; line-height: 1.5; }
  .cred-field { margin-bottom: 16px; }
  .cred-label { font-size: 12px; font-weight: 500; color: #a0aec0; margin-bottom: 6px; display: block; text-transform: uppercase; letter-spacing: .04em; }
  .cred-input-wrap { position: relative; }
  .cred-input {
    width: 100%; box-sizing: border-box;
    background: #1a1f2e; border: 1px solid #2d3748; border-radius: 8px;
    color: #e2e8f0; font-size: 14px; padding: 10px 14px;
    outline: none; transition: border-color .15s;
    font-family: 'SF Mono', 'Consolas', monospace;
  }
  .cred-input:focus { border-color: #4299e1; }
  .cred-input.has-toggle { padding-right: 42px; }
  .cred-toggle {
    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; color: #4a5568; padding: 4px;
    font-size: 15px; line-height: 1;
  }
  .cred-toggle:hover { color: #718096; }
  .cred-hint { font-size: 11px; color: #4a5568; margin-top: 5px; }
  .cred-actions { display: flex; gap: 10px; margin-top: 24px; justify-content: flex-end; }
  .cred-btn {
    padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
    border: none; cursor: pointer; transition: opacity .15s;
  }
  .cred-btn:hover { opacity: .85; }
  .cred-btn-cancel { background: #1a2035; color: #718096; border: 1px solid #2d3748; }
  .cred-btn-confirm { background: #3182ce; color: #fff; }
  .cred-btn-confirm:disabled { background: #2a4a7f; color: #4a6fa5; cursor: not-allowed; opacity: 1; }
  .cred-security-note {
    font-size: 11px; color: #4a5568; margin-top: 18px;
    display: flex; align-items: center; gap: 6px;
  }
`;

function injectStyles() {
  if (document.getElementById('cred-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'cred-modal-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function showCredentialsModal({ requestId, service, description, fields }) {
  if (_activeModal) _activeModal.remove();
  injectStyles();

  const overlay = document.createElement('div');
  overlay.className = 'cred-overlay';

  const serviceLabel = String(service || 'Servicio externo');
  const desc = String(description || `Para que Jarvis pueda usar ${serviceLabel} en tu nombre.`);

  overlay.innerHTML = `
    <div class="cred-box" role="dialog" aria-modal="true" aria-label="Conectar ${serviceLabel}">
      <div class="cred-service-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        Conectar ${serviceLabel}
      </div>
      <div class="cred-title">Ingresa tus credenciales</div>
      <div class="cred-desc">${desc}</div>
      <div id="cred-fields"></div>
      <div class="cred-security-note">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Guardadas cifradas en tu vault local — nunca se envían fuera de tu máquina.
      </div>
      <div class="cred-actions">
        <button class="cred-btn cred-btn-cancel" id="cred-cancel">Cancelar</button>
        <button class="cred-btn cred-btn-confirm" id="cred-confirm">Guardar y conectar</button>
      </div>
    </div>
  `;

  const fieldsContainer = overlay.querySelector('#cred-fields');
  const inputs = {};

  for (const field of (fields || [])) {
    const isSecret = field.secret !== false;
    const div = document.createElement('div');
    div.className = 'cred-field';
    div.innerHTML = `
      <label class="cred-label" for="cred-field-${field.key}">${field.label || field.key}</label>
      <div class="cred-input-wrap">
        <input
          id="cred-field-${field.key}"
          class="cred-input${isSecret ? ' has-toggle' : ''}"
          type="${isSecret ? 'password' : 'text'}"
          placeholder="${field.placeholder || ''}"
          autocomplete="off" autocorrect="off" spellcheck="false"
        />
        ${isSecret ? '<button class="cred-toggle" type="button" title="Mostrar/ocultar" data-key="' + field.key + '">👁</button>' : ''}
      </div>
      ${field.hint ? `<div class="cred-hint">${field.hint}</div>` : ''}
    `;
    fieldsContainer.appendChild(div);
    inputs[field.key] = div.querySelector('input');
  }

  // Toggle visibility de campos secretos
  overlay.querySelectorAll('.cred-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = inputs[btn.dataset.key];
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });

  // Validación: confirmar solo si hay al menos un campo lleno
  const confirmBtn = overlay.querySelector('#cred-confirm');
  function checkValid() {
    const anyFilled = Object.values(inputs).some((el) => el.value.trim().length > 0);
    confirmBtn.disabled = !anyFilled;
  }
  Object.values(inputs).forEach((el) => el.addEventListener('input', checkValid));
  checkValid();

  // Cancelar
  overlay.querySelector('#cred-cancel').addEventListener('click', async () => {
    try { await api('/credentials/respond', { method: 'POST', body: JSON.stringify({ requestId, cancel: true }) }); }
    catch (_) {}
    close();
  });

  // Confirmar
  confirmBtn.addEventListener('click', async () => {
    const values = {};
    for (const [key, el] of Object.entries(inputs)) {
      if (el.value.trim()) values[key] = el.value.trim();
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Guardando…';
    try {
      await api('/credentials/respond', { method: 'POST', body: JSON.stringify({ requestId, values }) });
      close();
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Guardar y conectar';
      console.error('[credentials-modal] Error al enviar:', err);
    }
  });

  // Enter confirma
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click();
    if (e.key === 'Escape') overlay.querySelector('#cred-cancel').click();
  });

  function close() {
    overlay.remove();
    _activeModal = null;
  }

  document.body.appendChild(overlay);
  _activeModal = overlay;

  // Focus en el primer campo
  const firstInput = Object.values(inputs)[0];
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}
