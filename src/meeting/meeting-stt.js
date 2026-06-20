// STT para reuniones: transcribe chunks de audio base64 del browser (WebM/Opus).
// Adaptado de src/voice/stt-gemini.js pero acepta datos inline en lugar de
// archivo, y el prompt detecta decisiones/compromisos en el mismo pass.

const STT_MODELS = ['gemini-2.0-flash', 'gemini-flash-latest'];

const STT_PROMPT = `Transcribe este fragmento de audio en español, palabra por palabra.
Si detectas una decisión, acuerdo o compromiso explícito, márcalo así:
  [DECISIÓN: texto de la decisión]
  [COMPROMISO de <persona>: texto del compromiso]
  [CIFRA: dato numérico relevante mencionado]
Devuelve SOLO la transcripción con esas marcas cuando apliquen. Sin comentarios adicionales.`;

async function transcribeChunk({ audioBase64, mimeType = 'audio/webm;codecs=opus', apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING');
  if (!audioBase64) throw new Error('MEETING_STT_NO_AUDIO');

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
                { text: STT_PROMPT },
                { inline_data: { mime_type: mimeType, data: audioBase64 } }
              ]
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 1024 }
          })
        }
      );
      if (!response.ok) {
        lastError = new Error(`GEMINI_STT_${response.status}`);
        continue;
      }
      const data = await response.json();
      const text = String(data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (!text) return '';
      return text;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('GEMINI_STT_FAILURE');
}

module.exports = { transcribeChunk };
