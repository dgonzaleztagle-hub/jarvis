const fs = require('fs');
const path = require('path');

const AUDIO_MIME = {
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.opus': 'audio/ogg'
};

const STT_MODELS = ['gemini-2.0-flash', 'gemini-flash-latest'];

// Transcripción de notas de voz usando Gemini multimodal (audio inline).
// Local-first/BYOK: usa la GEMINI_API_KEY que ya está en el vault, sin
// servicios nuevos. Las notas de voz de Telegram pesan KB, lejos del límite
// de 20MB del request inline.
async function transcribeAudio({ filePath, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING');
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = AUDIO_MIME[ext];
  if (!mimeType) throw new Error(`UNSUPPORTED_AUDIO_TYPE: ${ext}`);
  const audioBase64 = fs.readFileSync(filePath).toString('base64');

  let lastError = null;
  for (const model of STT_MODELS) {
    try {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: 'Transcribe este audio en español, palabra por palabra. Devuelve SOLO la transcripción, sin comentarios ni etiquetas.' },
                { inline_data: { mime_type: mimeType, data: audioBase64 } }
              ]
            }],
            generationConfig: { temperature: 0 }
          })
        }
      );
      if (!response.ok) {
        lastError = new Error(`GEMINI_STT_${response.status}`);
        continue;
      }
      const data = await response.json();
      const text = String(data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (!text) throw new Error('GEMINI_STT_EMPTY');
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('GEMINI_STT_FAILURE');
}

module.exports = { transcribeAudio };
