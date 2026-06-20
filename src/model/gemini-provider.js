// Mapea el finishReason de Gemini al vocabulario que ya usa el resto del
// código (Anthropic): solo 'max_tokens' importa para detectar truncamiento
// y disparar generateWithContinuation (ver src/model/long-content.js).
function toStopReason(finishReason) {
  return finishReason === 'MAX_TOKENS' ? 'max_tokens' : null;
}

class GeminiProvider {
  constructor({ apiKey, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.models = [
      'gemini-2.0-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite',
      'gemini-flash-latest'
    ];
  }

  // Llama generateContent con reintentos/fallback de modelo. generationConfig
  // se pasa tal cual (responseMimeType, maxOutputTokens, etc.) según el caller.
  async _generateContent({ system, messages, generationConfig }) {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY_MISSING');

    // El system puede venir como bloques [{ text, cache }] (formato Anthropic
    // con prompt caching). Gemini no cachea por bloques: se aplana a string.
    let systemText = system;
    if (Array.isArray(systemText)) {
      systemText = systemText.map((block) => block?.text || '').filter(Boolean).join('\n\n');
    }

    const startedAt = Date.now();
    let lastError = null;
    for (const model of this.models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await this.fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: messages,
                systemInstruction: { parts: [{ text: systemText }] },
                generationConfig
              })
            }
          );

          if (!response.ok) {
            lastError = new Error(`Gemini ${model} returned ${response.status}`);
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
            continue;
          }

          const data = await response.json();
          const candidate = data.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text;
          if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');
          return {
            model,
            durationMs: Date.now() - startedAt,
            stopReason: toStopReason(candidate?.finishReason),
            text
          };
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
    }

    throw lastError || new Error('GEMINI_API_FAILURE');
  }

  async generateJson({ system, messages, temperature = 0.4, maxTokens }) {
    const { model, durationMs, stopReason, text } = await this._generateContent({
      system,
      messages,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature,
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {})
      }
    });
    return { model, durationMs, stopReason, data: parseJsonText(text) };
  }

  // Contraparte de AnthropicProvider.generateText: texto crudo (markdown/HTML),
  // sin envoltura JSON. Necesario para que generateWithContinuation
  // (src/model/long-content.js) funcione igual con Gemini que con Anthropic.
  async generateText({ system, messages, temperature = 0.4, maxTokens }) {
    const { model, durationMs, stopReason, text } = await this._generateContent({
      system,
      messages,
      generationConfig: {
        temperature,
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {})
      }
    });
    return { model, durationMs, stopReason, text: text.trim() };
  }
}

function parseJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

  // Attempt 1: direct parse
  try { return JSON.parse(cleaned); } catch (_) {}

  // Attempt 2: extract from ```json ... ``` block embedded anywhere in the text
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[1].trim()); } catch (_) {}
  }

  // Attempt 3: find first { or [ and parse the tail
  const startCandidates = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0);
  const start = startCandidates.length ? Math.min(...startCandidates) : -1;
  if (start >= 0) {
    try { return JSON.parse(cleaned.slice(start)); } catch (_) {}

    // Attempt 4: shrink from the end until valid
    for (let end = cleaned.length; end > start; end -= 1) {
      const slice = cleaned.slice(start, end).trim();
      if (!slice) continue;
      try { return JSON.parse(slice); } catch (_) {}
    }
  }

  const error = new Error(`MODEL_JSON_PARSE_FAILED: ${cleaned.slice(0, 120)}`);
  error.rawText = cleaned;
  throw error;
}

module.exports = {
  GeminiProvider
};
