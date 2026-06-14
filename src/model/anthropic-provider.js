const HAIKU_45_PRICING = {
  inputPerMillion: 1,
  outputPerMillion: 5,
  // Anthropic prompt caching: escribir cache cuesta 1.25x input, leerlo 0.1x.
  cacheWriteMultiplier: 1.25,
  cacheReadMultiplier: 0.1
};

// El system puede venir como string (legacy) o como bloques [{ text, cache }].
// Los bloques marcados con cache:true se envían con cache_control para que
// Anthropic cachee ese prefijo entre llamadas (menos latencia y costo).
function toAnthropicSystem(system) {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    const blocks = system
      .filter((block) => block && String(block.text || '').trim())
      .map((block) => ({
        type: 'text',
        text: block.text,
        ...(block.cache ? { cache_control: { type: 'ephemeral' } } : {})
      }));
    return blocks.length > 0 ? blocks : undefined;
  }
  return String(system);
}

function extractTextFromMessage(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.text === 'string') return message.text;
  if (Array.isArray(message?.parts)) {
    return message.parts.map((part) => part.text || '').filter(Boolean).join('\n');
  }
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => part.text || '').filter(Boolean).join('\n');
  }
  return '';
}

function toAnthropicMessages(messages = []) {
  const normalized = [];
  for (const message of messages) {
    const role = message.role === 'model' ? 'assistant' : 'user';
    const text = extractTextFromMessage(message);
    if (!text.trim()) continue;

    const previous = normalized[normalized.length - 1];
    if (previous?.role === role) {
      previous.content += `\n\n${text}`;
    } else {
      normalized.push({ role, content: text });
    }
  }
  if (normalized.length === 0) return [{ role: 'user', content: 'Continua.' }];

  // Breakpoint de cache en el penúltimo mensaje: el historial es estable
  // (append-only), el último mensaje es el volátil (trae contexto dinámico).
  // Así el prefijo system+historial se cachea turno a turno; bajo el mínimo
  // del modelo Anthropic lo ignora sin costo.
  if (normalized.length >= 2) {
    const anchor = normalized[normalized.length - 2];
    anchor.content = [{ type: 'text', text: anchor.content, cache_control: { type: 'ephemeral' } }];
  }
  return normalized;
}

function parseJsonText(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

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

class AnthropicProvider {
  constructor({
    apiKey,
    model = 'claude-haiku-4-5',
    fetchImpl = fetch,
    usageMeter,
    pricing = HAIKU_45_PRICING
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
    this.usageMeter = usageMeter;
    this.pricing = pricing;
  }

  estimateCost(usage = {}) {
    const inputTokens = Number(usage.input_tokens || usage.inputTokens || 0);
    const outputTokens = Number(usage.output_tokens || usage.outputTokens || 0);
    const cacheWriteTokens = Number(usage.cache_creation_input_tokens || usage.cacheWriteTokens || 0);
    const cacheReadTokens = Number(usage.cache_read_input_tokens || usage.cacheReadTokens || 0);
    return {
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      costUsd:
        (inputTokens / 1_000_000) * this.pricing.inputPerMillion +
        (cacheWriteTokens / 1_000_000) * this.pricing.inputPerMillion * (this.pricing.cacheWriteMultiplier || 1.25) +
        (cacheReadTokens / 1_000_000) * this.pricing.inputPerMillion * (this.pricing.cacheReadMultiplier || 0.1) +
        (outputTokens / 1_000_000) * this.pricing.outputPerMillion
    };
  }

  // Análisis de imagen (boletas, documentos) → JSON estructurado. Haiku y los
  // modelos Claude recientes son multimodales: leen la imagen y comprenden, no
  // solo extraen texto crudo.
  async analyzeImage({ imageBase64, mediaType = 'image/jpeg', prompt, maxTokens = 1024, purpose = 'analyze_image' }) {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY_MISSING');
    const startedAt = Date.now();
    const response = await this.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic ${this.model} vision returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }

    const data = await response.json();
    const durationMs = Date.now() - startedAt;
    const text = data.content?.map((part) => part.text || '').filter(Boolean).join('\n').trim();
    if (!text) throw new Error('ANTHROPIC_EMPTY_VISION_RESPONSE');

    const usage = this.estimateCost(data.usage || {});
    this.usageMeter?.record({ provider: 'anthropic', model: this.model, purpose, durationMs, ...usage });
    return { model: this.model, usage, durationMs, data: parseJsonText(text) };
  }

  async generateJson({ system, messages, temperature = 0.4, maxTokens = 2048, purpose = 'generate_json' }) {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY_MISSING');

    const startedAt = Date.now();
    const response = await this.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        system: toAnthropicSystem(system),
        messages: toAnthropicMessages(messages)
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic ${this.model} returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }

    const data = await response.json();
    const durationMs = Date.now() - startedAt;
    const text = data.content?.map((part) => part.text || '').filter(Boolean).join('\n').trim();
    if (!text) throw new Error('ANTHROPIC_EMPTY_RESPONSE');

    const usage = this.estimateCost(data.usage || {});
    this.usageMeter?.record({
      provider: 'anthropic',
      model: this.model,
      purpose,
      durationMs,
      ...usage
    });

    // stop_reason viaja siempre: si fue 'max_tokens' el texto quedó cortado
    // por presupuesto y el caller puede decidir reintentar con techo mayor
    // en vez de entregar una frase a medias.
    let parsed;
    try {
      parsed = parseJsonText(text);
    } catch (error) {
      error.stopReason = data.stop_reason || null;
      throw error;
    }

    return {
      model: this.model,
      usage,
      durationMs,
      stopReason: data.stop_reason || null,
      data: parsed
    };
  }

  // Genera texto crudo (markdown), sin envoltura JSON. Lo usa la Fase 2 de la
  // conversación: el contenido largo del panel se genera aparte para que la voz
  // (Fase 1) no espere a que se escriba todo el detalle.
  async generateText({ system, messages, temperature = 0.4, maxTokens = 1200, purpose = 'generate_text' }) {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY_MISSING');
    const startedAt = Date.now();
    const response = await this.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature,
        system: toAnthropicSystem(system),
        messages: toAnthropicMessages(messages)
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic ${this.model} returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }

    const data = await response.json();
    const durationMs = Date.now() - startedAt;
    const text = data.content?.map((part) => part.text || '').filter(Boolean).join('\n').trim();
    if (!text) throw new Error('ANTHROPIC_EMPTY_RESPONSE');

    const usage = this.estimateCost(data.usage || {});
    this.usageMeter?.record({ provider: 'anthropic', model: this.model, purpose, durationMs, ...usage });
    return { model: this.model, usage, durationMs, text };
  }
}

module.exports = {
  AnthropicProvider,
  HAIKU_45_PRICING,
  toAnthropicMessages
};
