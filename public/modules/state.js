/* ─── SHARED STATE ──────────────────────────────────────────────────────────── */
export const state = {
  events: [],
  agendaEvents: [],
  pendingChatConfirmations: new Set(),
  announcedTaskClosures: new Set(),
  voiceEnabled: true,
  vaderEffect: false,
  handsFree: false,
  voiceProfile: 'dark_lord',
  voiceProfiles: [],
  voiceRate: '-12%',
  voiceVolume: '+8%',
  voicePitch: '-18Hz',
  listening: false,
  speaking: false,
  processing: false,
  submittingVoiceTurn: false,
  manualStopListening: false,
  listeningRestartTimer: null,
  transcriptFinalizeTimer: null,
  pendingFinalTranscript: '',
  listeningCooldownUntil: 0,
  lastVoiceSubmissionText: '',
  lastVoiceSubmissionAt: 0,
  synthVoices: [],
  recognition: null,
  currentAudio: null,
  lastTranscript: '',
  interimTranscript: '',
  // Última pregunta que Jarvis hizo en voz y para la cual espera respuesta
  // (ej: "¿quieres que te ponga música?" o "¿quieres que reintente el agente X?").
  // El siguiente mensaje del usuario se interpreta a la luz de esto en vez de
  // asumir siempre que se trata de un pick de música.
  pendingQuestion: null,
  _pendingQuestionCancel: null, // setTimeout handle para expirar pendingQuestion
};

/**
 * Marca cuál fue la última pregunta hablada por Jarvis. Sobrescribe cualquier
 * pendingQuestion anterior — "lo último dicho" gana — y expira sola tras ttlMs.
 */
export function setPendingQuestion(pendingQuestion, ttlMs = 90000) {
  if (state._pendingQuestionCancel) clearTimeout(state._pendingQuestionCancel);
  state.pendingQuestion = pendingQuestion;
  state._pendingQuestionCancel = setTimeout(() => {
    state.pendingQuestion = null;
    state._pendingQuestionCancel = null;
  }, ttlMs);
}

export function clearPendingQuestion() {
  if (state._pendingQuestionCancel) { clearTimeout(state._pendingQuestionCancel); state._pendingQuestionCancel = null; }
  state.pendingQuestion = null;
}

export const PREVIEW_PRESETS = {
  greeting: 'Señor, Jarvis está en línea y listo para servir.',
  command:  'Objetivo recibido. Analizando la situación y preparando el siguiente paso.',
  count:    'Prueba de voz. Uno, dos, tres. Jarvis operativo.'
};

/* ─── DOM HELPERS ───────────────────────────────────────────────────────────── */
export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls)  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ─── DOM REFS ──────────────────────────────────────────────────────────────── */
export const dom = {
  startupOverlay:    $('startupOverlay'),
  startupBtn:        $('startupBtn'),
  hud:               $('hud'),
  hudClock:          $('hudClock'),
  statusDot:         $('statusDot'),
  statusText:        $('statusText'),
  modelPill:         $('modelPill'),
  telegramPill:      $('telegramPill'),
  eventsPill:        $('eventsPill'),
  settingsBtn:       $('settingsBtn'),
  tabSistema:        $('tabSistema'),
  tabVoz:            $('tabVoz'),
  panelSistema:      $('panelSistema'),
  panelVoz:          $('panelVoz'),
  googleDot:         $('googleDot'),
  googleLabel:       $('googleLabel'),
  googleSource:      $('googleSource'),
  googleRefreshBtn:  $('googleRefreshBtn'),
  vaderEffectToggle: $('vaderEffectToggle'),
  trustModeToggle:   $('trustModeToggle'),
  reactorEl:         $('reactor'),
  reactorStatus:     $('reactorStatus'),
  feed:              $('feed'),
  feedEmpty:         $('feedEmpty'),
  voiceBar:          $('voiceBar'),
  voiceBarIcon:      $('voiceBarIcon'),
  voiceBarText:      $('voiceBarText'),
  chatInput:         $('chatInput'),
  sendBtn:           $('sendBtn'),
  voiceToggle:       $('voiceToggle'),
  micToggle:         $('micToggle'),
  handsFreeToggle:   $('handsFreeToggle'),
  workspacePanel:    $('workspacePanel'),
  workspaceTitle:    $('workspaceTitle'),
  workspaceContent:  $('workspaceContent'),
  closeWorkspaceBtn: $('closeWorkspace'),
  reloadWorkspaceBtn:$('reloadWorkspace'),
  activityPanel:     $('activityPanel'),
  closeActivity:     $('closeActivity'),
  tasksList:         $('tasksList'),
  eventsList:        $('eventsList'),
  activityBadge:     $('activityBadge'),
  dockAgenda:        $('dockAgenda'),
  dockEmails:        $('dockEmails'),
  dockActivity:      $('dockActivity'),
  dockMemoria:       $('dockMemoria'),
  dockPermisos:      $('dockPermisos'),
  dockVoz:           $('dockVoz'),
  settingsModal:     $('settingsModal'),
  closeSettings:     $('closeSettings'),
  artifactModal:         $('artifactModal'),
  closeArtifactModal:    $('closeArtifactModal'),
  artifactModalTitle:    $('artifactModalTitle'),
  artifactModalBody:     $('artifactModalBody'),
  voiceProfilePanel:  $('voiceProfilePanel'),
  voiceRateRange:     $('voiceRateRange'),
  voiceRateValue:     $('voiceRateValue'),
  voiceVolumeRange:   $('voiceVolumeRange'),
  voiceVolumeValue:   $('voiceVolumeValue'),
  voicePitchRange:    $('voicePitchRange'),
  voicePitchValue:    $('voicePitchValue'),
  voicePreviewText:   $('voicePreviewText'),
  voicePreviewButton: $('voicePreviewButton'),
  voiceSaveButton:    $('voiceSaveButton'),
  voiceSaveStatus:    $('voiceSaveStatus'),
  voicePresetGreeting:$('voicePresetGreeting'),
  voicePresetCommand: $('voicePresetCommand'),
  voicePresetCount:   $('voicePresetCount')
};
