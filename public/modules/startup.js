/**
 * startup.js — Startup sequence after the user clicks the reactor.
 * Handles intro speech pool, morning briefing orchestration, and mic hand-off.
 */
import { state } from './state.js';
import { speakText, startListening, clearListeningRestart, setListeningCooldown } from './voice.js';
import { runMorningBriefing } from './morning.js';

const INTRO_POOL = [
  'Su llegada era... esperada. Los sistemas del Imperio están en línea. ¿Cuáles son sus órdenes?',
  'Señor. Los sistemas han permanecido en alerta. Todo está listo.',
  'Daniel. El Imperio aguardaba su regreso. Estoy operativo.',
  'Sistemas en línea. El lado oscuro ha esperado. ¿Qué ordena?',
  'Su presencia era... anticipada. Todo bajo control, como siempre.',
  'Bienvenido, señor. Sistemas online. Listo para servir.',
];

/**
 * Run the full startup sequence.
 * @param {Function} fadeIntro  — call to fade out startup music
 * @param {Function} onMusicPick — called when briefing ends and mic is open for song pick
 */
export function runStartupSequence(fadeIntro, onMusicPick) {
  let briefingFired = false;
  let _ws = null, _we = null;

  function startMorningBriefing() {
    if (briefingFired) return;
    briefingFired = true;
    if (_ws) { clearInterval(_ws); _ws = null; }
    if (_we) { clearInterval(_we); _we = null; }
    // Cancel pending mic restart from intro speech onEnd —
    // without this the mic opens while briefing TTS is still loading.
    clearListeningRestart();
    setListeningCooldown(60000);
    fadeIntro();
    setTimeout(() => {
      runMorningBriefing().then(() => {
        onMusicPick?.();
        setListeningCooldown(0);
        setTimeout(() => {
          if (state.recognition && !state.listening && !state.speaking && !state.submittingVoiceTurn) {
            startListening();
          }
        }, 1500);
      }).catch(() => {});
    }, 500);
  }

  // Delay slightly so HUD finishes rendering before TTS starts
  setTimeout(() => {
    const idx = Number(sessionStorage.getItem('jarvis.introIdx') || 0);
    sessionStorage.setItem('jarvis.introIdx', (idx + 1) % INTRO_POOL.length);
    speakText(INTRO_POOL[idx % INTRO_POOL.length]);

    let introStarted = false;
    _ws = setInterval(() => {
      if (state.speaking) {
        introStarted = true;
        clearInterval(_ws); _ws = null;
        _we = setInterval(() => { if (!state.speaking) startMorningBriefing(); }, 150);
      }
    }, 150);

    // Fallback A: TTS never started (voice off / no key)
    setTimeout(() => { if (!introStarted) startMorningBriefing(); }, 4000);
    // Fallback B: absolute safety net
    setTimeout(startMorningBriefing, 25000);
  }, 1200);
}
