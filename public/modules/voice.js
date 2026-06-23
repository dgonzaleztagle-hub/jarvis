import { state, dom } from './state.js';
import { api } from './api.js';

/* ─── REACTOR ───────────────────────────────────────────────────────────────── */
export function setReactorState(mode) {
  if (typeof window.setVaderState === 'function') window.setVaderState(mode);
  dom.reactorEl.classList.remove('listening', 'speaking', 'processing');
  dom.reactorStatus.classList.remove('active', 'speaking');
  if (mode === 'listening') {
    dom.reactorEl.classList.add('listening');
    dom.reactorStatus.classList.add('active');
    dom.reactorStatus.textContent = 'ESCUCHANDO';
    dom.statusDot.className = 'status-dot listening';
  } else if (mode === 'speaking') {
    dom.reactorEl.classList.add('speaking');
    dom.reactorStatus.classList.add('speaking');
    dom.reactorStatus.textContent = 'HABLANDO';
    dom.statusDot.className = 'status-dot speaking';
  } else if (mode === 'processing') {
    dom.reactorEl.classList.add('processing');
    dom.reactorStatus.classList.add('active');
    dom.reactorStatus.textContent = 'PROCESANDO';
  } else {
    dom.reactorStatus.textContent = 'EN ESPERA';
    dom.statusDot.className = 'status-dot online';
  }
}

export function setStatus(text) {
  dom.statusText.textContent = text.toUpperCase();
}

/* ─── VOICE UI ──────────────────────────────────────────────────────────────── */
export function updateVoiceUI() {
  dom.voiceToggle.classList.toggle('active', state.voiceEnabled);
  dom.voiceToggle.textContent = state.voiceEnabled ? 'VOZ' : 'MUDO';
  dom.micToggle.classList.toggle('listening', state.listening);
  dom.micToggle.textContent = state.listening ? 'OYENDO' : 'MIC';
  dom.handsFreeToggle.classList.toggle('active', state.handsFree);
  dom.handsFreeToggle.textContent = state.handsFree ? 'LIBRE✓' : 'LIBRE';

  const hasVoiceActivity = state.voiceEnabled || state.listening || state.handsFree;
  dom.voiceBar.hidden = !hasVoiceActivity;
  if (hasVoiceActivity) {
    const text = state.interimTranscript || state.lastTranscript;
    dom.voiceBarIcon.textContent = state.listening ? '🔴' : state.speaking ? '🔊' : '🎙';
    dom.voiceBarText.textContent = text || (
      state.speaking   ? 'Jarvis hablando...' :
      state.listening  ? 'Escuchando...' :
      state.handsFree  ? 'Manos libres — en espera' : 'Voz activada'
    );
  }

  if (state.listening) {
    setReactorState('listening');
    dom.micToggle.classList.add('listening');
  } else if (state.speaking) {
    setReactorState('speaking');
    dom.voiceToggle.classList.add('speaking');
  } else if (state.processing) {
    setReactorState('processing');
  } else {
    setReactorState('idle');
  }
}

/* ─── VOICE SETTINGS ────────────────────────────────────────────────────────── */
export function percentFromSlider(v) { const n = Number(v || 0); return `${n >= 0 ? '+' : ''}${n}%`; }
export function hertzFromSlider(v)   { const n = Number(v || 0); return `${n >= 0 ? '+' : ''}${n}Hz`; }
export function numFromStr(v, fb = 0) { const m = String(v || '').match(/([+-]?\d+)/); return m ? Number(m[1]) : fb; }

export function persistVoiceState() {
  try {
    localStorage.setItem('jarvis.voiceEnabled', JSON.stringify(state.voiceEnabled));
    localStorage.setItem('jarvis.vaderEffect',  JSON.stringify(state.vaderEffect));
    localStorage.setItem('jarvis.handsFree',    JSON.stringify(state.handsFree));
    localStorage.setItem('jarvis.voiceProfile', state.voiceProfile);
    localStorage.setItem('jarvis.voiceRate',    state.voiceRate);
    localStorage.setItem('jarvis.voiceVolume',  state.voiceVolume);
    localStorage.setItem('jarvis.voicePitch',   state.voicePitch);
    if (dom.voicePreviewText) localStorage.setItem('jarvis.voicePreviewText', dom.voicePreviewText.value || '');
  } catch (_) {}
}

// Sube la config de voz al servidor: es la misma que usa el espejo de voz de
// Telegram y cualquier otro canal. El HUD guarda local + servidor.
export async function syncVoiceConfigToServer() {
  try {
    await fetch('/config/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: state.voiceProfile,
        rate: state.voiceRate,
        volume: state.voiceVolume,
        pitch: state.voicePitch
      })
    });
  } catch (_) {}
}

export function loadVoiceState() {
  try {
    const r = (key) => localStorage.getItem(key);
    if (r('jarvis.voiceEnabled') !== null) state.voiceEnabled = JSON.parse(r('jarvis.voiceEnabled'));
    if (r('jarvis.vaderEffect')  !== null) state.vaderEffect  = JSON.parse(r('jarvis.vaderEffect'));
    if (r('jarvis.handsFree')    !== null) state.handsFree    = JSON.parse(r('jarvis.handsFree'));
    if (r('jarvis.voiceProfile')) state.voiceProfile = r('jarvis.voiceProfile');
    if (r('jarvis.voiceRate'))    state.voiceRate    = r('jarvis.voiceRate');
    if (r('jarvis.voiceVolume'))  state.voiceVolume  = r('jarvis.voiceVolume');
    if (r('jarvis.voicePitch'))   state.voicePitch   = r('jarvis.voicePitch');
    if (r('jarvis.voicePreviewText') && dom.voicePreviewText) dom.voicePreviewText.value = r('jarvis.voicePreviewText');
  } catch (_) {}
}

export function syncVoiceSliders() {
  if (dom.voiceRateRange)   dom.voiceRateRange.value   = String(numFromStr(state.voiceRate, -12));
  if (dom.voiceRateValue)   dom.voiceRateValue.textContent = state.voiceRate;
  if (dom.voiceVolumeRange) dom.voiceVolumeRange.value = String(numFromStr(state.voiceVolume, 8));
  if (dom.voiceVolumeValue) dom.voiceVolumeValue.textContent = state.voiceVolume;
  if (dom.voicePitchRange)  dom.voicePitchRange.value  = String(numFromStr(state.voicePitch, -18));
  if (dom.voicePitchValue)  dom.voicePitchValue.textContent = state.voicePitch;
  if (dom.vaderEffectToggle) dom.vaderEffectToggle.checked = state.vaderEffect;
}

export function renderVoiceProfiles(profiles = []) {
  state.voiceProfiles = profiles;
  if (!dom.voiceProfilePanel) return;
  dom.voiceProfilePanel.innerHTML = '';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.label;
    dom.voiceProfilePanel.appendChild(opt);
  }
  if (!profiles.some(p => p.id === state.voiceProfile) && profiles[0]) state.voiceProfile = profiles[0].id;
  dom.voiceProfilePanel.value = state.voiceProfile;
}

export function applyVoiceProfileDefaults() {
  const profile = state.voiceProfiles.find(p => p.id === state.voiceProfile);
  if (!profile) return;
  state.voiceRate   = profile.rate   || state.voiceRate;
  state.voiceVolume = profile.volume || state.voiceVolume;
  state.voicePitch  = profile.pitch  || state.voicePitch;
  syncVoiceSliders();
  persistVoiceState();
}

export function setVoiceSaveStatus(text, tone = '') {
  if (!dom.voiceSaveStatus) return;
  dom.voiceSaveStatus.textContent = text;
  dom.voiceSaveStatus.className = 'config-status' + (tone === 'ok' ? ' ok' : '');
}

/* ─── VADER WEB AUDIO EFFECT ────────────────────────────────────────────────── */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function makeReverbImpulse(ctx, duration = 1.8, decay = 2.5) {
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function makeDistortionCurve(amount = 25) {
  const n = 512; const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export async function playVaderAudio(url, { onStart, onEnd, onError } = {}) {
  const ctx = getAudioCtx();
  try {
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = 0.80;
    const bass = ctx.createBiquadFilter(); bass.type='lowshelf'; bass.frequency.value=180; bass.gain.value=10;
    const mid  = ctx.createBiquadFilter(); mid.type='peaking';   mid.frequency.value=1200; mid.Q.value=1; mid.gain.value=-5;
    const dist = ctx.createWaveShaper(); dist.curve=makeDistortionCurve(25); dist.oversample='2x';
    const convolver = ctx.createConvolver(); convolver.buffer=makeReverbImpulse(ctx,1.8,2.5);
    const dryGain=ctx.createGain(); dryGain.gain.value=0.72;
    const wetGain=ctx.createGain(); wetGain.gain.value=0.38;
    const master =ctx.createGain(); master.gain.value=1.0;
    source.connect(bass); bass.connect(mid); mid.connect(dist);
    dist.connect(dryGain); dist.connect(convolver); convolver.connect(wetGain);
    dryGain.connect(master); wetGain.connect(master); master.connect(ctx.destination);
    source.onended = () => onEnd?.();
    onStart?.();
    source.start(0);
    return { stop: () => { try { source.stop(); } catch(_){} } };
  } catch (err) { onError?.(err); return null; }
}

/* ─── TTS ───────────────────────────────────────────────────────────────────── */
export function loadSynthVoices() {
  if ('speechSynthesis' in window) state.synthVoices = speechSynthesis.getVoices();
}

export function pickBestVoice() {
  const sp = state.synthVoices.filter(v => String(v.lang||'').toLowerCase().startsWith('es'));
  if (!sp.length) return state.synthVoices[0] || null;
  return sp.find(v=>/es-cl|chile/i.test(`${v.lang} ${v.name}`))
      || sp.find(v=>/google|microsoft|helena|sabina|laura|sofia/i.test(v.name))
      || sp[0];
}

export function stopSpeaking() {
  if (state.currentAudio) {
    try {
      if (typeof state.currentAudio.stop === 'function') state.currentAudio.stop();
      else state.currentAudio.pause();
    } catch(_) {}
    state.currentAudio = null;
  }
  state.speaking = false;
  updateVoiceUI();
}

export function fallbackSpeak(content) {
  if (!('speechSynthesis' in window)) return;
  stopListening({ manual: true });
  clearListeningRestart();
  const utt = new SpeechSynthesisUtterance(content);
  const v = pickBestVoice();
  if (v) utt.voice = v;
  utt.lang = v?.lang || 'es-CL';
  utt.rate = 1.04; utt.pitch = 0.96;
  utt.onstart = () => { state.speaking = true;  updateVoiceUI(); };
  utt.onend   = () => { state.speaking = false; setListeningCooldown(2400); updateVoiceUI(); scheduleListeningRestart(650); };
  utt.onerror = () => { state.speaking = false; updateVoiceUI(); };
  speechSynthesis.speak(utt);
}

export async function speakText(text, { voiceProfile } = {}) {
  if (!state.voiceEnabled) return;
  // Strip URLs and markdown before TTS — they read as gibberish letter-by-letter
  // ("**" se lee como "asterisco asterisco")
  const content = String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!content) return;
  stopSpeaking();
  // Mark speaking immediately — closes the gap between calling speakText and audio
  // actually starting (TTS API latency). Prevents mic restart and transcript commits.
  state.speaking = true;
  updateVoiceUI();
  stopListening({ manual: true });
  clearListeningRestart();
  try {
    // Si un especialista (Alex/Mara/Teo) está hablando este turno, su perfil
    // de voz va SOLO (sin el rate/volume/pitch afinados por Daniel para SU
    // propia voz) — si no, esos ajustes pisarían el carácter del perfil del
    // especialista y todos sonarían igual de "Jarvis", solo con otro acento.
    const body = voiceProfile
      ? { text: content, voiceProfile }
      : { text: content, voiceProfile: state.voiceProfile, rate: state.voiceRate, volume: state.voiceVolume, pitch: state.voicePitch };
    const data = await api('/voice/speak', { method: 'POST', body: JSON.stringify(body) });
    if (data?.url) {
      // El efecto Vader (playbackRate 0.80, bajos, distorsión, reverb) es el
      // carácter propio de Jarvis — aplicado sin condición, aplastaba también
      // la voz de los especialistas: Alex/Teo (voces masculinas, registro
      // similar) terminaban sonando casi igual a Jarvis después del
      // procesamiento, y solo Mara (voz femenina) se notaba distinta. Si está
      // hablando un especialista, su voz va limpia, sin el filtro de Vader.
      if (state.vaderEffect && !voiceProfile) {
        const node = await playVaderAudio(data.url, {
          onStart: () => { state.speaking=true; state.currentAudio=node; updateVoiceUI(); },
          onEnd:   () => { state.speaking=false; state.currentAudio=null; setListeningCooldown(2400); updateVoiceUI(); scheduleListeningRestart(650); },
          onError: () => { state.currentAudio=null; fallbackSpeak(content); }
        });
        state.speaking=true; state.currentAudio=node; updateVoiceUI();
        return;
      }
      const audio = new Audio(data.url);
      state.currentAudio = audio;
      audio.onplay  = () => { state.speaking=true; updateVoiceUI(); };
      audio.onended = () => { state.speaking=false; state.currentAudio=null; setListeningCooldown(2400); updateVoiceUI(); scheduleListeningRestart(650); };
      audio.onerror = () => { state.currentAudio=null; fallbackSpeak(content); };
      await audio.play();
      return;
    }
  } catch(_) {}
  fallbackSpeak(content);
}

/* ─── VOICE QUEUE HELPERS ────────────────────────────────────────────────────── */

/**
 * Wait until Jarvis stops speaking (or until maxMs ms pass).
 * Resolves immediately if not currently speaking.
 */
export function waitForSilence(maxMs = 18000) {
  return new Promise(resolve => {
    if (!state.speaking) { resolve(); return; }
    const deadline = Date.now() + maxMs;
    const check = setInterval(() => {
      if (!state.speaking || Date.now() >= deadline) { clearInterval(check); resolve(); }
    }, 150);
  });
}

/**
 * Wait for speech to START (handles TTS generation latency) then wait for it to END.
 * Unlike waitForSilence(), this correctly handles the case where TTS hasn't started yet.
 *
 * @param {number} startTimeoutMs  Max ms to wait for speech to begin (default 6000)
 * @param {number} speakTimeoutMs  Max ms to wait for speech to end once started (default 90000)
 */
export function waitForSpeechEnd(startTimeoutMs = 6000, speakTimeoutMs = 90000) {
  return new Promise(resolve => {
    const phase1End = Date.now() + startTimeoutMs;

    const checkStart = setInterval(() => {
      if (state.speaking) {
        // Speech started — now wait for it to end
        clearInterval(checkStart);
        const phase2End = Date.now() + speakTimeoutMs;
        // Debounce: require silence for 400ms before resolving.
        // Prevents early resolution during brief gaps between TTS chunks.
        let silentSince = null;
        const checkEnd = setInterval(() => {
          if (Date.now() >= phase2End) { clearInterval(checkEnd); resolve(); return; }
          if (!state.speaking) {
            if (!silentSince) silentSince = Date.now();
            if (Date.now() - silentSince >= 400) { clearInterval(checkEnd); resolve(); }
          } else {
            silentSince = null; // speech resumed — reset debounce
          }
        }, 150);
      } else if (Date.now() >= phase1End) {
        // Speech never started (TTS failed / voice off) — resolve anyway
        clearInterval(checkStart);
        resolve();
      }
    }, 150);
  });
}

/**
 * Speak text AFTER the current speech finishes (queues it).
 * If nothing is playing, speaks immediately.
 */
export async function speakAfter(text) {
  await waitForSilence();
  await speakText(text);
}

/**
 * Reproduce varios segmentos en secuencia, cada uno con su propia voz —
 * para cuando varios especialistas hablan en el mismo turno (ej: "que se
 * presenten todos"). Espera a que cada uno termine antes de empezar el
 * siguiente para que no se pisen ni se corten.
 *
 * Generaliza el mismo pulso de "trabajando" del panel de especialistas que ya
 * existía para el caso de uno solo (vía specialist_active) — sin esto, el
 * panel se quedaba mudo mientras 2-3 especialistas hablaban en secuencia,
 * exactamente la misma clase de bug que el de la voz: la pieza visual nunca
 * se generalizó al caso de varios, solo al de uno.
 */
export async function speakSegments(segments = []) {
  const { setWorking } = await import('./specialists-panel.js');
  for (const seg of segments) {
    if (!seg?.text) continue;
    if (seg.specialist) setWorking(seg.specialist, true);
    await speakText(seg.text, { voiceProfile: seg.voiceProfile });
    await waitForSpeechEnd();
    if (seg.specialist) setWorking(seg.specialist, false);
  }
}

/* ─── SPEECH RECOGNITION ────────────────────────────────────────────────────── */
export function setListeningCooldown(ms=0) { state.listeningCooldownUntil = Date.now() + Math.max(0,ms); }

export function clearListeningRestart() {
  if (state.listeningRestartTimer) { clearTimeout(state.listeningRestartTimer); state.listeningRestartTimer=null; }
}

function clearTranscriptFinalize() {
  if (state.transcriptFinalizeTimer) { clearTimeout(state.transcriptFinalizeTimer); state.transcriptFinalizeTimer=null; }
}

export function scheduleListeningRestart(delay=700) {
  if (!state.handsFree) return;
  clearListeningRestart();
  state.listeningRestartTimer = setTimeout(() => {
    state.listeningRestartTimer = null;
    const remaining = state.listeningCooldownUntil - Date.now();
    if (remaining>0) { scheduleListeningRestart(Math.max(remaining+120,300)); return; }
    if (!state.handsFree||state.listening||state.speaking||state.submittingVoiceTurn) return;
    startListening();
  }, delay);
}

function normalizeVoiceText(t='') {
  return String(t||'').normalize('NFKC').toLowerCase().replace(/[¿?¡!.,;:()"']/g,' ').replace(/\s+/g,' ').trim();
}

function commitVoiceTranscript(transcript) {
  const final = String(transcript||'').trim();
  // Discard if Jarvis is speaking or TTS is loading — prevents self-listening submissions.
  if (!final||state.submittingVoiceTurn||state.speaking) return;
  const normalized = normalizeVoiceText(final);
  const now = Date.now();
  if (normalized && normalized===state.lastVoiceSubmissionText && now-state.lastVoiceSubmissionAt<30000) {
    state.lastTranscript=`Ignoré repetición: "${final}"`; state.interimTranscript=''; state.pendingFinalTranscript='';
    updateVoiceUI();
    if (state.handsFree&&!state.speaking) { setListeningCooldown(1800); scheduleListeningRestart(1200); }
    return;
  }
  clearTranscriptFinalize();
  state.pendingFinalTranscript='';
  state.lastTranscript=final; state.interimTranscript='';
  state.lastVoiceSubmissionText=normalized; state.lastVoiceSubmissionAt=now;
  dom.chatInput.value=final;
  state.submittingVoiceTurn=true;
  if (state.listening) stopListening({ manual:false });
  updateVoiceUI();
  // Fire event so app.js can call submitChat without a circular import
  document.dispatchEvent(new CustomEvent('jarvis:voice-transcript', { detail: { text: final } }));
}

function scheduleTranscriptCommit(delay=550) {
  clearTranscriptFinalize();
  state.transcriptFinalizeTimer = setTimeout(() => {
    state.transcriptFinalizeTimer=null;
    if (state.pendingFinalTranscript&&!state.interimTranscript) commitVoiceTranscript(state.pendingFinalTranscript);
  }, delay);
}

export function startListening() {
  if (!state.recognition||state.listening||state.speaking||state.submittingVoiceTurn) return;
  clearListeningRestart(); clearTranscriptFinalize();
  state.manualStopListening=false; state.pendingFinalTranscript='';
  stopSpeaking();
  try { state.recognition.start(); } catch(_) {}
}

export function stopListening({ manual=true }={}) {
  if (!state.recognition||!state.listening) return;
  clearListeningRestart();
  state.manualStopListening=manual;
  try { state.recognition.stop(); } catch(_) {}
}

export function initSpeechRecognition() {
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  if (!SR) { dom.micToggle.disabled=true; dom.handsFreeToggle.disabled=true; return; }
  const rec = new SR();
  rec.lang='es-CL'; rec.continuous=true; rec.interimResults=true; rec.maxAlternatives=1;
  rec.onstart = () => { state.listening=true; state.interimTranscript=''; state.pendingFinalTranscript=''; setStatus('Jarvis escuchando'); updateVoiceUI(); };
  rec.onend   = () => {
    state.listening=false; setStatus('Jarvis activo'); updateVoiceUI();
    const manual=state.manualStopListening; state.manualStopListening=false;
    if (state.pendingFinalTranscript&&!state.submittingVoiceTurn) { commitVoiceTranscript(state.pendingFinalTranscript); return; }
    if (state.handsFree&&!state.speaking&&!state.submittingVoiceTurn&&!manual) scheduleListeningRestart(700);
  };
  rec.onerror = (ev) => { state.listening=false; clearTranscriptFinalize(); setStatus(`Micrófono — ${ev?.error||'error'}`); updateVoiceUI(); };
  rec.onresult = (ev) => {
    const results=Array.from(ev.results||[]); const interim=[]; const finals=[];
    for (const r of results) { const t=r?.[0]?.transcript?.trim(); if(!t) continue; (r.isFinal?finals:interim).push(t); }
    state.interimTranscript=interim.join(' ').trim();
    if (state.interimTranscript) dom.chatInput.value=state.interimTranscript;
    const finalText=finals.join(' ').trim();
    if (finalText) {
      state.pendingFinalTranscript=finalText; state.lastTranscript=finalText; dom.chatInput.value=finalText;
      scheduleTranscriptCommit(state.interimTranscript?700:250);
    }
    updateVoiceUI();
  };
  state.recognition=rec;
}
