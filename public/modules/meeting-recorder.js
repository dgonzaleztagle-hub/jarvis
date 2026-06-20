// Captura de audio para modo reunión.
// Se activa cuando el HUD recibe un evento meeting_started desde el servidor.
// Graba en chunks de CHUNK_MS ms (WebM/Opus), los envía a /meeting/chunk
// como base64 y actualiza el panel de transcripción en tiempo real.

import { api } from './api.js';

const CHUNK_MS = 8000; // 8 segundos por chunk

let _recorder = null;
let _stream = null;
let _active = false;

async function startRecording() {
  if (_active) return;
  try {
    _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    console.error('[meeting] Error al acceder al micrófono:', err.message);
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  _recorder = new MediaRecorder(_stream, { mimeType });
  _active = true;

  _recorder.ondataavailable = async (e) => {
    if (!e.data || e.data.size < 500) return; // descarta chunks silenciosos
    try {
      const arrayBuf = await e.data.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
      await api('/meeting/chunk', {
        method: 'POST',
        body: JSON.stringify({ audioBase64: base64, mimeType })
      });
    } catch (err) {
      console.warn('[meeting] Error enviando chunk:', err.message);
    }
  };

  _recorder.start(CHUNK_MS);
  console.info('[meeting] Grabación iniciada');
}

function stopRecording() {
  if (!_active) return;
  _active = false;
  _recorder?.stop();
  _stream?.getTracks().forEach((t) => t.stop());
  _recorder = null;
  _stream = null;
  console.info('[meeting] Grabación detenida');
}

export function isRecording() { return _active; }
export { startRecording, stopRecording };
