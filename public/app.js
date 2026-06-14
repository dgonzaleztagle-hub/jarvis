import { state, dom, PREVIEW_PRESETS, setPendingQuestion, clearPendingQuestion } from './modules/state.js';
import { api } from './modules/api.js';
import {
  setReactorState, setStatus, updateVoiceUI, speakText,
  stopSpeaking, startListening, stopListening,
  initSpeechRecognition, loadSynthVoices,
  loadVoiceState, persistVoiceState, syncVoiceConfigToServer, syncVoiceSliders,
  renderVoiceProfiles, applyVoiceProfileDefaults, setVoiceSaveStatus,
  percentFromSlider, hertzFromSlider,
  scheduleListeningRestart, clearListeningRestart
} from './modules/voice.js';
import { addMessage, showTyping, hideTyping, buildDisplay, appendDeferredContent } from './modules/feed.js';
import { onHudShowFile } from './modules/inbox-viewer.js';
import { onHudOpenUrl } from './modules/open-url.js';
import { renderTasks, renderEvents, loadTasks, announceTaskClosure, findPendingToolResult, confirmPendingTask } from './modules/tasks.js';
import {
  ARTIFACT_DEFS, artifactState,
  openArtifact, closeWorkspace, openWorkspace,
  openActivity, closeActivity, toggleActivity,
  openArtifactModal, closeArtifactModal, openComposeModal,
  loadAgendaData, loadEmailsData, loadMemoryData, loadApprovalData,
  buildEventPanel, buildEmailsPanel, buildAgendaPanel, buildThreadPanel
} from './modules/artifacts.js';
import * as FloatingPanel from './modules/floating-panel.js';
import { isMusicIntent, isMusicDecline, isCloseIntent, handleMusicRequest, handleCloseIntent } from './modules/intents.js';
import { runStartupSequence } from './modules/startup.js';
import { loadTrustMode, initTrustToggle } from './modules/trust.js';
import { openAgentsPanel } from './modules/agents-panel.js';

/* ─── CLOCK ─────────────────────────────────────────────────────────────────── */
setInterval(() => { dom.hudClock.textContent = new Date().toLocaleTimeString('es-CL', { hour12: false }); }, 1000);
dom.hudClock.textContent = new Date().toLocaleTimeString('es-CL', { hour12: false });

/* ─── SETTINGS ───────────────────────────────────────────────────────────────── */
function switchTab(tab) {
  const isSistema = tab === 'sistema';
  dom.tabSistema.classList.toggle('active', isSistema);
  dom.tabVoz.classList.toggle('active', !isSistema);
  dom.panelSistema.classList.toggle('hidden', !isSistema);
  dom.panelVoz.classList.toggle('hidden', isSistema);
}
function openSettings(tab = 'sistema') {
  dom.settingsModal.classList.add('open');
  switchTab(tab);
  loadTrustMode().catch(() => {});
}

async function loadGoogleStatus() {
  try {
    const data = await api('/auth/google/status');
    dom.googleDot.className  = 'google-status-dot ' + (data.connected ? 'connected' : 'disconnected');
    dom.googleLabel.textContent = data.connected ? 'Google conectado' : 'Google no conectado';
    const sourceMap = { vault: 'bóveda', codex: 'codex local', companion: 'companion' };
    dom.googleSource.textContent = data.source ? (sourceMap[data.source] || data.source) : '';
    dom.googleSource.style.display = data.source ? '' : 'none';
    dom.telegramPill.textContent = data.connected ? 'G ✓' : 'G ✗';
    dom.telegramPill.className   = 'pill' + (data.connected ? ' ok' : '');
  } catch {
    dom.googleDot.className = 'google-status-dot disconnected';
    dom.googleLabel.textContent = 'Error al verificar Google';
  }
}

async function loadModelUsage() {
  const data = await api('/model/usage');
  const totals = data.usage?.totals || {};
  dom.modelPill.textContent = `HAIKU $${Number(totals.costUsd || 0).toFixed(4)}`;
}

/* ─── ABRIR DOCS/PLANILLAS CREADOS ────────────────────────────────────────────── */
// Escanea los resultados de tools de creación (Docs/Sheets) y abre cada URL de
// Google en una pestaña con foco. Si el navegador bloquea la apertura
// automática, deja un mensaje con link clickeable como respaldo garantizado.
function openCreatedDocs(toolResults = []) {
  const created = toolResults.filter(r =>
    /\.(create_spreadsheet|create_document)$/.test(r.toolName || '') &&
    r.status === 'completed' &&
    typeof r.result?.url === 'string' &&
    /docs\.google\.com/.test(r.result.url)
  );
  for (const r of created) {
    const { url, title } = r.result;
    // Target estable por documento: si la pestaña ya está abierta, la reusa y
    // enfoca en vez de acumular pestañas nuevas.
    const docId = (url.match(/\/d\/([^/]+)/) || [])[1] || url;
    const win = window.open(url, `gdoc_${docId}`);
    if (win) { win.focus?.(); }
    else {
      // Pop-up bloqueado: link manual en el feed (un click del usuario nunca se bloquea).
      addMessage('jarvis', 'Jarvis', `Abrir ${title || 'el documento'}: ${url}`, { silentVoice: true });
    }
  }
}

/* ─── CHAT ───────────────────────────────────────────────────────────────────── */
export async function submitChat(forcedText) {
  const text = String(forcedText ?? dom.chatInput.value).trim();
  if (!text) return;
  dom.chatInput.value = '';
  addMessage('user', 'Usuario', text, { silentVoice: true });

  // text shown in feed; apiText is what reaches the LLM (may carry injected context)
  let apiText = text;

  // Pre-LLM intercepts — handled client-side, no API call needed
  if (state.pendingQuestion) {
    const pendingQuestion = state.pendingQuestion;
    clearPendingQuestion();

    if (pendingQuestion.type === 'music_offer') {
      // Jarvis acaba de preguntar "¿qué música?": cualquier respuesta que no sea
      // un rechazo explícito ES el pick (género pelado o nombre de canción incluidos).
      if (!isMusicDecline(text)) {
        await handleMusicRequest(text);
        return;
      }
      // Rechazo — dale contexto al LLM para que responda correctamente
      apiText = `[contexto interno: Jarvis acaba de ofrecer poner música al usuario tras el briefing matutino, y el usuario respondió esto en vez de pedir una canción. Responde brevemente, sin motivación ni consejos.] ${text}`;
    } else if (pendingQuestion.type === 'agent_retry') {
      // Jarvis acaba de avisar que un agente no pudo completar su corrida y
      // preguntó si el usuario quiere reintentarlo — esta respuesta es a esa
      // pregunta, no un pick de música ni un comando suelto.
      apiText = `[contexto interno: Jarvis acaba de informar que el agente "${pendingQuestion.agentName}" no pudo completar su última corrida y preguntó si el usuario quiere reintentarlo ahora. El usuario respondió esto a esa pregunta — si es una afirmación, ejecuta ese agente de nuevo (agents.run_now) y reporta el resultado.] ${text}`;
    }
  }
  if (isMusicIntent(text))  { await handleMusicRequest(text); return; }
  if (isCloseIntent(text))  { handleCloseIntent(text); return; }

  // LLM path
  state.processing = true;
  setReactorState('processing');
  showTyping();

  try {
    const data   = await api('/chat', { method: 'POST', body: JSON.stringify({ text: apiText, channel: 'hud' }) });
    hideTyping();
    const result = data.task?.result || {};
    const pending = findPendingToolResult(data.task);

    const toolResults        = result.toolResults || [];
    const usedTools          = toolResults.map(r => r.toolName || '').filter(Boolean);
    const opensEmailPanel    = usedTools.some(t => /gmail\.list/.test(t));
    const opensCalendarPanel = usedTools.some(t => /calendar\.list/.test(t));
    const createdEventResult = toolResults.find(r => /calendar\.create_event/.test(r.toolName) && r.status === 'completed');
    const threadResult       = toolResults.find(r => /gmail\.get_thread/.test(r.toolName)      && r.status === 'completed');
    const searchResult       = toolResults.find(r => /gmail\.search_emails/.test(r.toolName)   && r.status === 'completed');
    // Solo abre el panel si la tool de agentes COMPLETÓ: si quedó esperando
    // confirmación, abrirlo mostraría el estado previo ("0 agentes") y
    // confunde — el panel se abre al confirmar (handler jarvis:confirm-task).
    const usedAgentTools     = toolResults.some(r => /^agents\./.test(r.toolName || '') && r.status === 'completed');
    const opensPanel = opensEmailPanel || opensCalendarPanel || !!createdEventResult || !!threadResult || !!searchResult || usedAgentTools;

    const jarvisMsg = addMessage('jarvis', 'Jarvis', opensPanel ? (result.speak || buildDisplay(result)) : buildDisplay(result), {
      confirmTaskId: pending?.taskId,
      voiceResult:  result,
      speakText:    opensPanel ? (result.speak || '') : undefined,
    });
    // Fase 2: el detalle estructurado se está generando aparte y llegará por SSE.
    // Registramos la burbuja para rellenarla cuando llegue el evento.
    if (result.pendingContent && data.task?.id) {
      pendingContentMsgs.set(data.task.id, jarvisMsg);
    }
    await loadTasks();
    await loadModelUsage();

    // Open appropriate floating panels based on tool results
    if (opensEmailPanel) {
      FloatingPanel.close('thread-detail');
      const emailData = toolResults.find(r => /gmail\.list/.test(r.toolName) && r.status === 'completed')?.result;
      if (emailData?.emails) {
        FloatingPanel.open('emails', { title: `✉  CORREOS (${emailData.emails.length})`, contentNode: buildEmailsPanel(emailData), zone: 'right', width: '400px' });
      } else {
        openArtifact('emails', { float: true }).catch(() => {});
      }
    }
    if (opensCalendarPanel) {
      const agendaData = toolResults.find(r => /calendar\.list/.test(r.toolName) && r.status === 'completed')?.result;
      if (agendaData?.events) {
        FloatingPanel.open('agenda', { title: '📅  AGENDA', contentNode: buildAgendaPanel(agendaData), zone: 'right', width: '400px' });
      } else {
        openArtifact('agenda', { float: true }).catch(() => {});
      }
    }
    if (threadResult?.result) {
      FloatingPanel.close('emails');
      FloatingPanel.close('emails-search');
      const t = threadResult.result;
      FloatingPanel.open('thread-detail', { title: `✉  ${(t.subject || 'Correo').slice(0, 40).toUpperCase()}`, contentNode: buildThreadPanel(t), zone: 'right', width: '420px' });
    }
    if (searchResult?.result?.emails?.length) {
      const emails = searchResult.result;
      FloatingPanel.open('emails-search', { title: `✉  BÚSQUEDA (${emails.emails.length})`, contentNode: buildEmailsPanel(emails), zone: 'right', width: '400px' });
    }
    if (createdEventResult?.result) {
      FloatingPanel.open('event-created', { title: '📅  EVENTO CREADO', contentNode: buildEventPanel(createdEventResult.result), zone: 'right', width: '340px' });
    }
    if (usedAgentTools) {
      openAgentsPanel().catch(() => {});
    }
    // Documentos/planillas recién creados: abrir en pestaña con foco. Google
    // bloquea embeber docs privados en iframe, pero abrirlos en pestaña sí
    // funciona. Si el navegador frena el pop-up, dejamos botón clickeable.
    openCreatedDocs(toolResults);
  } catch (err) {
    hideTyping();
    addMessage('jarvis', 'Jarvis', `No pude completar la solicitud: ${err.message}`, { silentVoice: true });
  } finally {
    state.processing = false;
    if (!state.listening && !state.speaking) setReactorState('idle');
  }
}

/* ─── SSE RUNTIME EVENTS ─────────────────────────────────────────────────────── */
function renderArtifactIfCurrent(type, data) {
  if (artifactState.current === type) ARTIFACT_DEFS[type]?.render(data);
}

// taskId → burbuja de Jarvis cuyo detalle (Fase 2) aún está generándose.
const pendingContentMsgs = new Map();

function onConversationContent(evt) {
  try {
    const event = JSON.parse(evt.data);
    const { taskId, visual, failed } = event.payload || {};
    const msg = pendingContentMsgs.get(taskId);
    pendingContentMsgs.delete(taskId);
    if (!msg || failed) return;
    appendDeferredContent(msg, visual);
  } catch (_) {}
}

function onRuntimeEvent(evt) {
  try {
    const event = JSON.parse(evt.data);
    state.events.push(event);
    renderEvents();
    loadTasks().catch(() => {});

    if (event.type === 'task_needs_confirmation') {
      // Conversation tasks already show CONFIRMAR ACCIÓN in chat — skip PERMISOS panel for those
      const isConvTask = event.payload?.type === 'conversation' || event.payload?.taskType === 'conversation' || event.payload?.origin === 'conversation';
      if (!isConvTask) {
        document.getElementById('permisosBadge')?.classList.add('pulse');
        setTimeout(() => document.getElementById('permisosBadge')?.classList.remove('pulse'), 3000);
        if (!dom.workspacePanel.classList.contains('panel-open')) openArtifact('approval').catch(() => {});
        else if (artifactState.current === 'approval') loadApprovalData().then(d => renderArtifactIfCurrent('approval', d)).catch(() => {});
      }
    }
    if (/(task_completed|task_failed|task_confirmed)/.test(event.type)) {
      if (artifactState.current === 'agenda')   loadAgendaData().then(d   => renderArtifactIfCurrent('agenda',   d)).catch(() => {});
      if (artifactState.current === 'approval') loadApprovalData().then(d => renderArtifactIfCurrent('approval', d)).catch(() => {});
    }
    if (event.type === 'task_completed' && event.payload?.toolName) {
      const tool = event.payload.toolName;
      if (/gmail/.test(tool)    && artifactState.current === 'emails') loadEmailsData().then(d => renderArtifactIfCurrent('emails', d)).catch(() => {});
      if (/calendar/.test(tool) && artifactState.current === 'agenda') loadAgendaData().then(d => renderArtifactIfCurrent('agenda', d)).catch(() => {});
    }
    if ((event.type === 'task_completed' || event.type === 'task_failed') && state.pendingChatConfirmations.has(event.taskId)) {
      api(`/tasks/${event.taskId}`).then(d => announceTaskClosure(d.task)).catch(() => {});
    }
  } catch (_) {}
}

/* ─── BOOT ───────────────────────────────────────────────────────────────────── */
async function boot() {
  loadVoiceState(); syncVoiceSliders(); updateVoiceUI(); loadSynthVoices();
  if ('speechSynthesis' in window && typeof speechSynthesis.onvoiceschanged !== 'undefined') speechSynthesis.onvoiceschanged = loadSynthVoices;
  initSpeechRecognition();

  try {
    const [voiceOpts, health, telegram] = await Promise.all([api('/voice/options'), api('/health'), api('/channels/telegram/status')]);
    renderVoiceProfiles(voiceOpts.profiles || []);
    setStatus(`${health.service || 'Jarvis'} activo`);
    dom.statusDot.className  = 'status-dot online';
    dom.telegramPill.textContent = 'TG';
    dom.telegramPill.className   = 'pill' + (telegram.telegram?.configured ? ' ok' : '');
    dom.modelPill.className = 'pill active';
  } catch (err) { setStatus(`Error de inicio: ${err.message}`); }

  await loadTasks().catch(() => {});
  await loadModelUsage().catch(() => {});
  await loadTrustMode().catch(() => {});
  await loadGoogleStatus().catch(() => {});

  loadEmailsData().then(emailsData => {
    const high  = (emailsData.emails || []).filter(e => e.attention === 'alta').length;
    const badge = document.getElementById('emailsBadge');
    if (badge) { badge.textContent = high || ''; badge.classList.toggle('hidden', !high); }
  }).catch(() => {});

  const stream = new EventSource('/events/stream');
  stream.addEventListener('ready', () => { dom.eventsPill.textContent = 'EVT'; dom.eventsPill.className = 'pill ok'; });
  stream.onmessage = () => {};
  for (const t of ['task_started','task_progress','task_completed','task_failed','task_needs_confirmation','task_confirmed']) {
    stream.addEventListener(t, onRuntimeEvent);
  }
  stream.addEventListener('conversation_content', onConversationContent);
  stream.addEventListener('hud_show_file', onHudShowFile);
  stream.addEventListener('hud_open_url', onHudOpenUrl);
  stream.addEventListener('hud_quick_ack', (evt) => {
    try { speakText(JSON.parse(evt.data).payload?.text || ''); } catch (_) {}
  });
  stream.onerror = () => { dom.eventsPill.className = 'pill'; dom.eventsPill.textContent = 'EVT?'; };
}

/* ─── EVENT LISTENERS ────────────────────────────────────────────────────────── */

// Voice transcript
document.addEventListener('jarvis:voice-transcript', (e) => {
  submitChat(e.detail.text).finally(() => {
    state.submittingVoiceTurn = false;
    updateVoiceUI();
    if (state.handsFree && !state.speaking) scheduleListeningRestart(850);
  });
});
document.addEventListener('jarvis:confirm-task', async (e) => {
  const confirmed = await confirmPendingTask(e.detail.taskId);
  // El panel correspondiente se abrió cuando la acción aún esperaba aprobación
  // (mostrando el estado previo, ej: "0 agentes"). Ahora que la acción corrió
  // de verdad, refrescarlo para que muestre lo que se acaba de crear.
  if (/^agents\./.test(confirmed?.toolName || '')) openAgentsPanel().catch(() => {});
});
document.addEventListener('jarvis:open-activity', () => openActivity());

// Startup
dom.startupBtn.addEventListener('click', () => {
  dom.startupOverlay.classList.add('hidden');
  dom.hud.classList.add('visible');

  const intro = new Audio('/public/audio/startup.mp3');
  intro.volume = 0.18;
  intro.play().catch(() => {});
  const fadeIntro = () => {
    const timer = setInterval(() => {
      if (intro.volume > 0.03) intro.volume = Math.max(0, intro.volume - 0.025);
      else { intro.pause(); clearInterval(timer); }
    }, 80);
  };

  runStartupSequence(fadeIntro, () => {
    // No pisar una pregunta más reciente (ej: un agente que se reportó
    // encima del briefing y preguntó si reintentarlo) — esa tiene prioridad.
    if (!state.pendingQuestion) setPendingQuestion({ type: 'music_offer' });
  });

  // Si hay agentes vivos, mostrar su panel al arrancar — el usuario debe saber
  // qué corre en su nombre sin tener que preguntarlo.
  api('/agents').then((data) => {
    if ((data.agents || []).length > 0) openAgentsPanel().catch(() => {});
  }).catch(() => {});

  // Corridas programadas de agentes: el HUD las anuncia por voz y las deja en
  // el feed. Polling liviano — el server drena su cola en cada consulta.
  setInterval(async () => {
    try {
      const data = await api('/agents/notifications');
      for (const note of (data.notifications || [])) {
        addMessage('jarvis', 'Jarvis', note.text, { speakText: note.text });
        // Si Jarvis terminó su aviso con una pregunta (ej: "¿quieres que
        // reintente?"), la siguiente respuesta del usuario es para ESO,
        // no un pick de música — esto gana sobre cualquier pendingQuestion previa.
        if (/\?/.test(note.text)) {
          setPendingQuestion({ type: 'agent_retry', agentId: note.agentId, agentName: note.name });
        }
      }
      if ((data.notifications || []).length > 0) openAgentsPanel().catch(() => {});
    } catch (_) { /* server caído: el próximo tick reintenta */ }
  }, 20000);

  boot().catch(err => setStatus(`Error: ${err.message}`));
});

// Chat
dom.sendBtn.addEventListener('click', () => submitChat());
dom.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitChat(); });

// Workspace panels
dom.closeWorkspaceBtn.addEventListener('click', () => closeWorkspace());
dom.reloadWorkspaceBtn?.addEventListener('click', () => {
  const type = artifactState.current;
  const def  = ARTIFACT_DEFS[type];
  if (!def) return;
  dom.workspaceContent.innerHTML = `<div class="artifact-placeholder"><span class="art-icon">${def.icon}</span><span>Recargando...</span></div>`;
  def.load().then(data => { if (artifactState.current === type) def.render(data); }).catch(() => {});
});
dom.closeActivity.addEventListener('click', () => closeActivity());

// Settings modal
dom.settingsBtn.addEventListener('click', () => openSettings('sistema'));
dom.closeSettings.addEventListener('click', () => dom.settingsModal.classList.remove('open'));
dom.settingsModal.addEventListener('click', (e) => { if (e.target === dom.settingsModal) dom.settingsModal.classList.remove('open'); });
dom.tabSistema.addEventListener('click', () => switchTab('sistema'));
dom.tabVoz.addEventListener('click', () => switchTab('voz'));
dom.googleRefreshBtn?.addEventListener('click', () => loadGoogleStatus());
initTrustToggle();

// Artifact modal
dom.closeArtifactModal.addEventListener('click', () => closeArtifactModal());
dom.artifactModal.addEventListener('click', (e) => { if (e.target === dom.artifactModal) closeArtifactModal(); });

// Dock
dom.dockAgenda.addEventListener('click',   () => openArtifact('agenda'));
dom.dockEmails.addEventListener('click',   () => openArtifact('emails'));
dom.dockActivity.addEventListener('click', () => toggleActivity());
dom.dockMemoria.addEventListener('click',  () => openArtifact('memory'));
dom.dockPermisos.addEventListener('click', () => openArtifact('approval'));
dom.dockVoz.addEventListener('click', () => { syncVoiceSliders(); openSettings('voz'); });

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (dom.artifactModal.classList.contains('open'))    { closeArtifactModal(); return; }
    if (dom.settingsModal.classList.contains('open'))    { dom.settingsModal.classList.remove('open'); return; }
    if (dom.workspacePanel.classList.contains('panel-open')) { closeWorkspace(); return; }
    if (dom.activityPanel.classList.contains('panel-open'))  { closeActivity(); return; }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); dom.chatInput.focus(); }
});

// Voice controls
dom.voiceToggle.addEventListener('click', () => {
  state.voiceEnabled = !state.voiceEnabled;
  if (!state.voiceEnabled) stopSpeaking();
  persistVoiceState(); updateVoiceUI();
});
dom.micToggle.addEventListener('click', () => {
  if (state.listening) stopListening({ manual: true });
  else { state.handsFree = false; persistVoiceState(); updateVoiceUI(); startListening(); }
});
dom.handsFreeToggle.addEventListener('click', () => {
  state.handsFree = !state.handsFree;
  persistVoiceState(); updateVoiceUI();
  if (state.handsFree) startListening();
  else if (state.listening) stopListening({ manual: true });
  else clearListeningRestart();
});

// Voice settings
dom.voiceProfilePanel?.addEventListener('change', () => { state.voiceProfile = dom.voiceProfilePanel.value || 'dark_lord'; applyVoiceProfileDefaults(); setVoiceSaveStatus('Perfil cargado. Prueba la voz y guarda si te convence.'); });
dom.voiceRateRange?.addEventListener('input',   () => { state.voiceRate   = percentFromSlider(dom.voiceRateRange.value);   if (dom.voiceRateValue)   dom.voiceRateValue.textContent   = state.voiceRate;   setVoiceSaveStatus('Cambios sin guardar.'); });
dom.voiceVolumeRange?.addEventListener('input', () => { state.voiceVolume = percentFromSlider(dom.voiceVolumeRange.value); if (dom.voiceVolumeValue) dom.voiceVolumeValue.textContent = state.voiceVolume; setVoiceSaveStatus('Cambios sin guardar.'); });
dom.voicePitchRange?.addEventListener('input',  () => { state.voicePitch  = hertzFromSlider(dom.voicePitchRange.value);   if (dom.voicePitchValue)  dom.voicePitchValue.textContent  = state.voicePitch;  setVoiceSaveStatus('Cambios sin guardar.'); });
dom.voicePresetGreeting?.addEventListener('click', () => { if (dom.voicePreviewText) dom.voicePreviewText.value = PREVIEW_PRESETS.greeting; setVoiceSaveStatus('Frase de saludo cargada.'); });
dom.voicePresetCommand?.addEventListener('click',  () => { if (dom.voicePreviewText) dom.voicePreviewText.value = PREVIEW_PRESETS.command;  setVoiceSaveStatus('Frase de comando cargada.'); });
dom.voicePresetCount?.addEventListener('click',    () => { if (dom.voicePreviewText) dom.voicePreviewText.value = PREVIEW_PRESETS.count;    setVoiceSaveStatus('Frase de conteo cargada.'); });
dom.voicePreviewButton?.addEventListener('click', async () => { const text = String(dom.voicePreviewText?.value || '').trim(); if (!text) return; persistVoiceState(); setVoiceSaveStatus('Reproduciendo prueba...'); await speakText(text); });
dom.voiceSaveButton?.addEventListener('click', async () => { persistVoiceState(); await syncVoiceConfigToServer(); setVoiceSaveStatus('Configuración guardada (HUD y Telegram).', 'ok'); });
dom.vaderEffectToggle?.addEventListener('change', () => { state.vaderEffect = dom.vaderEffectToggle.checked; persistVoiceState(); setVoiceSaveStatus(state.vaderEffect ? 'Efecto Vader activado.' : 'Efecto Vader desactivado.'); });
