/**
 * morning.js — Morning briefing sequence
 *
 * Design rule: ONE speakText call for the entire briefing.
 * Multiple speakText calls kill each other (stopSpeaking on each call).
 * Panels open on timed offsets so they appear while Jarvis is talking.
 */
import { api } from './api.js';
import { speakText, waitForSpeechEnd } from './voice.js';
import { buildEmailsPanel, buildAgendaPanel } from './artifacts.js';
import * as FloatingPanel from './floating-panel.js';

/**
 * Run the morning briefing.
 * Caller (startup handler) must ensure this is called after any prior speech finishes.
 *
 * @param {{ skipSpeak?: boolean }} opts
 */
export async function runMorningBriefing({ skipSpeak = false } = {}) {
  let data;
  try {
    data = await api('/morning-briefing');
  } catch (err) {
    console.warn('[morning] /morning-briefing failed:', err.message);
    return;
  }
  if (!data) return;

  const { events = [], emails = [], speak = '' } = data;

  // Open panels — staggered so they slide in while Jarvis is speaking.
  // These are purely visual and don't interfere with TTS.
  if (events.length) {
    FloatingPanel.open('morning-agenda', {
      title:       `\u{1F4C5}  HOY (${events.length})`,
      contentNode: buildAgendaPanel({ events, connected: true }),
      zone:        'right',
      width:       '400px',
    });
  }

  if (emails.length) {
    setTimeout(() => {
      FloatingPanel.open('morning-emails', {
        title:       `✉  URGENTES (${emails.length})`,
        contentNode: buildEmailsPanel({ emails, connected: true }),
        zone:        'left',   // opposite side — emails left, agenda right
        width:       '400px',
      });
    }, 900);
  }

  // ONE speech call — no phases, no queue, no overlap possible.
  if (!skipSpeak && speak) {
    speakText(speak);
    // Wait for speech to start and finish so callers can open mic at the right moment.
    // waitForSpeechEnd handles TTS generation latency — it polls for speaking→true→false.
    await waitForSpeechEnd(6000, 90000);
  }

  return data;
}
