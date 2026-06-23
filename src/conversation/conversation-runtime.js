const { formatHumanReadable } = require('../presenters/human-readable-format');
const { applyOutputValueContract, inferOutputValue } = require('../presenters/output-value-contract');
const { extractTurnKnowledge } = require('../memory/turn-extractor');
const prompts = require('./conversation-prompts');
const { detectFeedbackPolarity, selectLessonsInPlay, applyReinforcement } = require('../memory/lesson-reinforcement');
const { buildQuickAck } = require('./quick-ack');
const { generateWithContinuation } = require('../model/long-content');
const { sanitizeCalendarCreateEventInput } = require('./calendar-input-sanitizer');

const { isAffirmativeConfirmation, isExplicitGoAhead, isCapabilitiesIntent } = require("./conversation-intents");
const { formatConfirmationInput, formatConfirmationRequest, buildToolSummary, summarizeConversationResult, enforceSpeakContract, responseSeemsIncomplete, summarizeToolResults, stripToolCallLeak, stripFabricatedActionClaim } = require("./conversation-presenter");
const { buildModelFailureMessage, coercePlainModelText } = require("./model-response-parser");

// Reintenta UNA vez con techo de tokens ampliado cuando una respuesta JSON
// quedó cortada por presupuesto (stopReason 'max_tokens') — tanto si el corte
// rompió el parseo (excepción con stopReason) como si cayó justo entre dos
// campos y el JSON parseó "bien" pero con una frase a medias en su interior.
// Nunca se debe entregar al usuario ni a la voz una frase cortada por un
// techo de tokens demasiado bajo: aplica a CUALQUIER llamada de decisión/
// continuación del modelo, no solo a la primera (ver bug real: el corte pasó
// en la ronda de cierre tras usar tools, que no tenía este resguardo).
async function generateJsonGuarded(modelProvider, params, retryMaxTokens) {
  let result;
  try {
    result = await modelProvider.generateJson(params);
  } catch (error) {
    if (error.stopReason === 'max_tokens' && retryMaxTokens > params.maxTokens) {
      return modelProvider.generateJson({ ...params, maxTokens: retryMaxTokens, purpose: `${params.purpose}_retry` });
    }
    throw error;
  }
  if (result.stopReason === 'max_tokens' && retryMaxTokens > params.maxTokens) {
    return modelProvider.generateJson({ ...params, maxTokens: retryMaxTokens, purpose: `${params.purpose}_retry` });
  }
  return result;
}

class ConversationRuntime {
  constructor({ eventBus, taskRuntime, toolRegistry, modelProvider, presenterRegistry, memoryStore, workingMemoryStore, contextAssembler, knowledgeGraph, getActiveModel, persona, historyStore, modules }) {
    this.eventBus = eventBus;
    // Módulos-especialistas built-in (Diseño/Alex, etc.). Su `expertise` se
    // inyecta como contexto del turno cuando el pedido entra en su dominio
    // (context-swap inline, sin sub-loop). Jarvis sigue siendo la única puerta.
    this.modules = Array.isArray(modules) ? modules : [];
    this.taskRuntime = taskRuntime;
    this.toolRegistry = toolRegistry;
    this.modelProvider = modelProvider;
    this.presenterRegistry = presenterRegistry;
    this.memoryStore = memoryStore;
    this.workingMemoryStore = workingMemoryStore;
    this.contextAssembler = contextAssembler || null;
    this.knowledgeGraph = knowledgeGraph || null;
    this.getActiveModel = typeof getActiveModel === 'function' ? getActiveModel : null;
    // Perfil de persona resuelto (fábrica + overlay de cliente). Si no se pasa,
    // el render de persona (en conversation-prompts) cae al perfil de fábrica.
    this.persona = persona || null;
    // El historial en memoria sobrevive el proceso si hay historyStore: se
    // restaura el final del JSONL persistido (ver history-store.js).
    this.historyStore = historyStore || null;
    this.history = this.historyStore?.loadRecent(12) || [];
    // Estado de sesión persistente: resumen rolling de turnos eviccionados
    // y compromiso multi-turno activo (pendingIntent).
    const savedState = this.historyStore?.loadState() || {};
    this.pendingIntent = savedState.pendingIntent || null;
    this._cachedSummary = savedState.summary || null;
    // Lecciones de comportamiento que estuvieron en juego el turno anterior.
    // Se evalúan contra la reacción del usuario en el turno siguiente (refuerzo).
    this._lessonsInPlay = [];
  }

  // Con tono definido: el especialista HABLA en primera persona — el usuario
  // debe oír a ${name}, no a Jarvis narrando lo que ${name} hace. Se usa tanto
  // en la ronda de tools/cierre (inyectado dinámico, ver buildFinalResponsePrompt/
  // buildToolContinuationPrompt) como base de la regla estática del JSON schema
  // (ver buildModuleRoster en conversation-prompts.js) para la decisión inicial
  // — sin la versión dinámica en el cierre, el carácter se re-fijaba a la fuerza
  // ahí ("Eres Jarvis Codex... Mantén tu carácter"), pisando el cambio de voz
  // si el turno usó alguna herramienta (encontrado en vivo: el audit de Teo
  // salía con tono neutro de Jarvis pese a la instrucción inicial).
  buildVoiceSwitchBlock(m) {
    if (!m?.tone) return '';
    const name = m.specialistName || 'el especialista';
    return [
      `CAMBIO DE VOZ PARA ESTE TURNO — ES LO MÁS IMPORTANTE DE ESTE MENSAJE:`,
      `Habla en PRIMERA PERSONA como ${name}, no como Jarvis narrando a ${name} en tercera persona. Nunca digas "${name} necesita..." o "${name} armó..." — di "necesito..." o "armé...", como si ${name} fuera quien te está hablando directo. Esto REEMPLAZA por completo cualquier instrucción de "mantén tu carácter [de Jarvis]" o "REGISTRO Y TONO" para este turno (eso es el registro de Jarvis en charla normal, no el de ${name}).`,
      m.tone,
      `El piso de honestidad/no-fabricación sigue exactamente igual — esto solo cambia CÓMO suena, nunca qué reglas sigue.`
    ].join(' ');
  }


  // Registra un turno completo (usuario + resumen del modelo) en memoria y en
  // disco. Único punto de escritura de this.history para mantener ambos en
  // sync — ver pushHistory en los dos sitios donde se cierra un turno de HUD.
  pushHistory(text, result) {
    const modelText = summarizeConversationResult(result);
    this.history.push({ role: 'user', parts: [{ text }] });
    this.history.push({ role: 'model', parts: [{ text: modelText }] });
    if (this.history.length > 12) {
      // En vez de tirar los turnos eviccionados, los guardamos para incorporarlos
      // al resumen rolling en el próximo maybeTrimHistory().
      const evicted = this.history.splice(0, this.history.length - 12);
      this.historyStore?.appendEvicted(evicted);
    }
    this.historyStore?.append({ role: 'user', text });
    this.historyStore?.append({ role: 'model', text: modelText });
  }

  // Incorpora turnos eviccionados al resumen rolling si hay acumulados y no
  // hay un hilo abierto. Se llama al inicio de cada turno para no bloquear la
  // respuesta — si falla, la conversación sigue sin el summary actualizado.
  async maybeTrimHistory() {
    if (!this.historyStore || !this.modelProvider) return;
    if (this.pendingIntent) return; // no comprimir con un hilo abierto
    const evicted = this.historyStore.loadEvicted();
    // Por diseño, history.length>12 eviciona 2 entradas (1 turno) en CADA
    // turno una vez que se cruza el techo — si comprimiéramos apenas hay algo
    // eviccionado, esto llamaría al modelo y mostraría el toast "Historial
    // comprimido" en CADA turno para siempre. Se acumula en lotes de ~3 turnos
    // (6 entradas) antes de gastar una llamada y avisar al usuario.
    if (!evicted || evicted.length < 6) return;

    const evictedText = evicted
      .map((e) => `${e.role === 'model' ? 'Jarvis' : 'Usuario'}: ${e.text}`)
      .join('\n');
    const existingSummary = this._cachedSummary || '';

    try {
      const result = await this.modelProvider.generateText({
        system: 'Eres un asistente que comprime historial de conversación. Responde solo con el resumen, sin preámbulo.',
        messages: [{
          role: 'user',
          parts: [{
            text: [
              existingSummary ? `Resumen existente:\n${existingSummary}` : '',
              `Turnos a incorporar:\n${evictedText}`,
              'Genera un resumen actualizado en máximo 250 palabras. Preserva: compromisos activos, decisiones tomadas, contexto relevante para continuar. Descarta: saludos, confirmaciones triviales, repeticiones.'
            ].filter(Boolean).join('\n\n')
          }]
        }],
        maxTokens: 350,
        purpose: 'history_compression'
      });

      const newSummary = `[Resumen de conversación anterior]\n${result.text || result}`;
      this._cachedSummary = newSummary;
      this.historyStore.saveState({ summary: newSummary, pendingIntent: this.pendingIntent });
      this.historyStore.clearEvicted();

      this.eventBus.emit('conversation_history_compressed', {
        message: 'Comprimí el historial para mantener fluidez. Si quieres que el próximo resumen enfatice algo, dímelo.'
      });
    } catch (_) {
      // Si falla la compresión, la conversación sigue sin interrumpirse.
    }
  }

  // System 100% estable (persona, tools, reglas) marcado para prompt caching.
  // NADA dinámico vive aquí: la memoria y la fecha viajan en el mensaje del
  // usuario. Así el prefijo system+historial es cacheable turno a turno —
  // si la fecha entrara al system, rompería el cache cada minuto.
  // System prompt + prompts de fase: el TEXTO vive en conversation-prompts.js.
  // Acá solo se inyectan las dependencias del runtime (persona, tools, modelo).
  buildSystemPrompt() {
    return prompts.buildSystemPrompt({
      persona: this.persona,
      toolList: this.toolRegistry.list(),
      getActiveModel: this.getActiveModel,
      modules: this.modules
    });
  }

  buildFinalResponsePrompt(specialist) {
    return prompts.buildFinalResponsePrompt({ voiceOverride: this.buildVoiceSwitchBlock(specialist) });
  }

  buildToolContinuationPrompt({ memoryContext = '', isLastRound = false, specialist = null } = {}) {
    return prompts.buildToolContinuationPrompt({
      toolList: this.toolRegistry.list(),
      memoryContext,
      isLastRound,
      voiceOverride: this.buildVoiceSwitchBlock(specialist)
    });
  }

  async executeToolCalls(toolCalls, { text, context, channel }) {
    const results = [];
    for (const call of toolCalls) {
      if (!call || !call.toolName) continue;
      const normalizedInput = /(^|\.)(calendar)\.?.*create_event$/i.test(call.toolName)
        ? sanitizeCalendarCreateEventInput(text, call.input || {})
        : (call.input || {});
      const toolTask = this.taskRuntime.createTask({
        title: `Tool ${call.toolName}`,
        type: 'tool',
        // origin marca que esta tarea nació dentro de una conversación: su
        // confirmación vive en el chat, no en la bandeja de aprobaciones.
        origin: 'conversation',
        input: normalizedInput
      });
      const completed = await this.taskRuntime.runToolTask(
        toolTask.id,
        call.toolName,
        normalizedInput,
        // userText viaja en el contexto para reglas de procedencia del
        // policy-engine (ej: distinguir mensaje dictado literal vs compuesto).
        // userGoAhead: el sí explícito del usuario en este turno cuenta como
        // confirmación para riesgo high (ver policy-engine).
        { ...context, channel, userText: text, userGoAhead: isExplicitGoAhead(text) }
      );
      // Dedup, no "última gana": si el modelo re-emitió EXACTAMENTE la misma
      // acción (mismo tool + mismos inputs) que ya estaba pendiente, la copia
      // vieja queda obsoleta — no se apilan dos confirmaciones idénticas.
      // Una acción pendiente DISTINTA (otro destinatario, otro contenido) NO
      // se cancela sola: queda visible para el usuario/modelo via el bloque
      // "Acciones pendientes de confirmación" (ver handleMessage), que es
      // donde se decide confirmarla, cancelarla o dejarla — no acá a ciegas.
      if (completed.status === 'waiting_confirmation') {
        const sameInput = JSON.stringify(normalizedInput);
        for (const stale of this.taskRuntime.listTasks()) {
          if (
            stale.id !== completed.id &&
            stale.status === 'waiting_confirmation' &&
            stale.toolName === call.toolName &&
            JSON.stringify(stale.input || {}) === sameInput
          ) {
            stale.status = 'superseded';
          }
        }
      }
      results.push({
        toolName: call.toolName,
        taskId: completed.id,
        status: completed.status,
        input: completed.input,
        result: completed.result,
        error: completed.error
      });
    }
    return results;
  }

  async repairIncompleteResponse({ userText, initialResponse, toolResults, memoryContext }) {
    try {
      const repaired = await this.modelProvider.generateJson({
        system: prompts.buildResponseRepairPrompt({
          memoryContext,
          toolSummary: buildToolSummary(this.toolRegistry.list())
        }),
        messages: [
          {
            role: 'user',
            parts: [
              {
                text: JSON.stringify({
                  originalUserMessage: userText,
                  initialResponse,
                  toolResults: summarizeToolResults(toolResults)
                })
              }
            ]
          }
        ],
        temperature: 0.2,
        maxTokens: 450,
        purpose: 'response_repair'
      });

      return stripFabricatedActionClaim(stripToolCallLeak({
        speak: repaired.data?.speak || initialResponse.speak,
        visual: repaired.data?.visual || initialResponse.visual,
        format: repaired.data?.format || initialResponse.format,
        outputValue: repaired.data?.outputValue || initialResponse.outputValue
      }), { userText, toolResultsCount: toolResults.length });
    } catch (_) {
      if (isCapabilitiesIntent(userText)) {
        return prompts.buildCapabilitiesResponse(this.toolRegistry, this.memoryStore);
      }
      return initialResponse;
    }
  }

  fallbackFinalResponse(toolResults) {
    const waiting = toolResults.find((item) => item.status === 'waiting_confirmation');
    if (waiting) {
      const confirmation = formatConfirmationRequest(waiting);
      return {
        ...confirmation,
        format: 'sections'
      };
    }

    const failed = toolResults.find((item) => item.status === 'failed' || item.error);
    if (failed) {
      return {
        speak: 'La tarea no se pudo completar correctamente.',
        visual: `Falló ${failed.toolName}: ${failed.error?.message || 'error desconocido'}`
      };
    }

    if (this.presenterRegistry?.canPresent(toolResults)) {
      return this.presenterRegistry.present(toolResults);
    }

    return {
      speak: 'Tarea completada.',
      visual: ''
    };
  }

  shouldUseDeterministicClosing(toolResults, outputValue = null) {
    if (outputValue?.requiresTransformation) return false;
    return Boolean(this.presenterRegistry?.canPresent(toolResults));
  }

  // Fase 2 de la conversación: genera el detalle estructurado para pantalla,
  // aparte del JSON de decisión. Así la voz (Fase 1, el "speak") no espera a que
  // el modelo escriba todo el contenido largo. Devuelve markdown crudo (sin
  // envoltura JSON, sin escape) — más barato en tokens y sin fragilidad de parseo.
  async generateScreenDetail({ userText, speak, recentHistory = '' }) {
    const system = 'Eres Jarvis. Tu tarea acá es UNA sola cosa: producir el detalle estructurado que se mostrará en pantalla, complementando una respuesta que ya diste por voz. Devuelve SOLO ese contenido en markdown (listas, tablas, secciones, según corresponda). Nada de preámbulos, saludos ni cierres. No repitas literal la síntesis hablada: aporta el desglose, los datos concretos y la estructura. Español de Chile.';
    const ctx = recentHistory ? `\n\n[contexto reciente]\n${recentHistory}` : '';
    const messages = [{
      role: 'user',
      parts: [{
        text: `El usuario pidió: "${userText}".\n\nYa respondiste por voz con esta síntesis: "${speak}".${ctx}\n\nGenera ahora el detalle estructurado para pantalla en markdown.`
      }]
    }];

    const isComplete = (_text, stopReason) => stopReason !== 'max_tokens';
    const callOnce = typeof this.modelProvider.generateText === 'function'
      ? async (msgs, maxTokens) => {
          const out = await this.modelProvider.generateText({ system, messages: msgs, temperature: 0.4, maxTokens, purpose: 'conversation_screen_detail' });
          return { text: String(out.text || ''), stopReason: out.stopReason || null };
        }
      // Fallback si el proveedor activo no expone generateText: usar el camino JSON.
      : async (msgs, maxTokens) => {
          const out = await this.modelProvider.generateJson({
            system: `${system}\n\nResponde JSON: { "visual": "<markdown>" }`,
            messages: msgs,
            temperature: 0.4,
            maxTokens,
            purpose: 'conversation_screen_detail'
          });
          return { text: String(out.data?.visual || ''), stopReason: out.stopReason || null };
        };

    const { text } = await generateWithContinuation({
      callOnce,
      prompt: messages[0].parts[0].text,
      isComplete
    });
    return text;
  }

  listPendingConfirmations() {
    return this.taskRuntime
      .listTasks()
      .filter((task) => task.status === 'waiting_confirmation' && task.type === 'tool' && task.toolName);
  }

  async maybeConfirmPendingTask({ text, conversationTask, channel }) {
    if (!isAffirmativeConfirmation(text)) return null;

    // Atajo determinista solo cuando NO hay ambigüedad posible: con una sola
    // acción pendiente, "sí/dale/ok" solo puede referirse a ella. Con 2+
    // pendientes, cuál confirma es ambiguo por definición — no se adivina acá
    // (esa fue la causa del bug real: "sí" confirmaba la última pendiente, no
    // necesariamente la que el usuario tenía en mente). Se deja pasar al turno
    // normal del modelo, que ve el bloque "Acciones pendientes de confirmación"
    // en el contexto y resuelve con tasks.confirm_pending/cancel_pending.
    const pendingTasks = this.listPendingConfirmations();
    if (pendingTasks.length !== 1) return null;
    const pending = pendingTasks[0];

    const completed = await this.taskRuntime.confirmTask(pending.id, { channel });
    const ok = completed.status === 'completed';
    const toolResults = [
      {
        toolName: completed.toolName,
        taskId: completed.id,
        status: completed.status,
        input: completed.input,
        result: completed.result,
        error: completed.error
      }
    ];
    const presented = ok ? this.fallbackFinalResponse(toolResults) : null;
    conversationTask.status = completed.status;
    conversationTask.result = {
      speak: ok
        ? (presented?.speak || 'Confirmado. La acción fue completada.')
        : 'Confirmé la acción, pero no se completó correctamente.',
      visual: ok
        ? (presented?.visual || `Acción completada: ${completed.toolName}`)
        : `La acción ${completed.toolName} quedó en estado ${completed.status}.`,
      format: ok ? (presented?.format || 'brief') : 'brief',
      outputValue: {
        mode: 'response',
        requiresTransformation: false,
        rule: 'Confirmation should execute the existing pending action, not create a duplicate.'
      },
      toolResults
    };
    this.taskRuntime.emitTaskEvent(conversationTask, ok ? 'task_completed' : 'task_failed', {
      channel,
      status: conversationTask.status,
      confirmedTaskId: completed.id
    });
    return conversationTask;
  }

  async handleMessage({ text, channel = 'hud', context = {} }) {
    // Namespace de memoria por agente: una corrida con channel:'agent' viaja
    // con su agentId en el contexto. Lo que LEE sigue siendo la memoria global
    // (igual que cualquier turno) MÁS su propio historial de corridas previas;
    // lo que ESCRIBE queda taggeado con su agentId, así que no contamina la
    // memoria principal ni la de otros agentes (ver knowledge-graph._visible).
    const agentId = channel === 'agent' ? (context.agentId || null) : null;
    const turnStartedAt = Date.now();
    const conversationTask = this.taskRuntime.createTask({
      title: `Conversation from ${channel}`,
      type: 'conversation',
      input: { text, channel }
    });

    conversationTask.status = 'running';
    this.taskRuntime.emitTaskEvent(conversationTask, 'task_started', { channel });
    this.eventBus.emit('conversation_user_message', { taskId: conversationTask.id, channel });

    const confirmedTask = await this.maybeConfirmPendingTask({ text, conversationTask, channel });
    if (confirmedTask) return confirmedTask;

    // Compresión asíncrona del historial eviccionado. No bloquea si no hay nada
    // que comprimir ni si hay un pendingIntent activo (hilo abierto).
    await this.maybeTrimHistory();

    const recentHistoryText = this.history
      .slice(-4)
      .map((entry) => entry.parts?.map((part) => part.text || '').join(' '))
      .join(' ');

    const memoryContext = this.contextAssembler
      ? this.contextAssembler.assemble({ userText: text, recentHistory: recentHistoryText, agentId })
      : (this.memoryStore?.buildPromptContext(`${text} ${recentHistoryText}`.trim(), { limit: 4, agentId }) || '');
    const workingContext = this.contextAssembler
      ? ''
      : (this.workingMemoryStore?.buildPromptContext(text, { limit: 3 }) || '');

    // Acciones que quedaron esperando confirmación en turnos anteriores
    // (de CUALQUIER herramienta, no solo la última). Generalista a propósito:
    // es el modelo quien decide, viendo el mensaje del usuario, si se refiere
    // a alguna de estas — y con qué tool (confirm/cancel) — en vez de que el
    // código adivine por nombre de herramienta o se quede con "la más nueva".
    const pendingConfirmations = this.listPendingConfirmations();
    const pendingContext = pendingConfirmations.length > 0
      ? [
          '[Acciones pendientes de confirmación]',
          ...pendingConfirmations.map((task) => {
            const details = formatConfirmationInput(task.input || {});
            return `- id: ${task.id} | herramienta: ${task.toolName}${details ? ` | datos: ${details.replace(/\n/g, '; ')}` : ''}`;
          }),
          'Si el mensaje del usuario confirma, cancela o se refiere a alguna de estas acciones, usa tasks.confirm_pending o tasks.cancel_pending con el "id" correspondiente — no la repitas ni la redactes de nuevo. Si el mensaje es sobre algo distinto, déjalas como están: no se cancelan solas.'
        ].join('\n')
      : '';

    // Compromiso multi-turno activo: si Jarvis declaró un pendingIntent en un
    // turno anterior, lo inyectamos para que no pierda el hilo.
    const pendingIntentContext = this.pendingIntent
      ? `[Compromiso pendiente]\n${this.pendingIntent}\nSi este turno lo resuelve, omite "pendingIntent" en tu respuesta.`
      : '';

    // Resumen rolling de turnos eviccionados: contexto de más atrás del
    // ventana de 6 turnos en memoria. Viaja aquí, no en el system (cacheable).
    const summaryContext = this._cachedSummary || '';

    // El contexto dinámico viaja en el mensaje actual, no en el system ni en el
    // historial: el system queda estable (cacheable) y el historial guarda el
    // texto crudo del usuario sin arrastrar contextos viejos turno tras turno.
    // Qué especialista (si alguno) aplica este turno ya NO se decide por regex
    // de palabras clave acá: el modelo lo declara él mismo en su propia
    // decisión JSON (campo "specialist"), con su propio criterio de lenguaje
    // natural — el roster completo de Alex/Mara/Teo vive en el system prompt
    // estable (cacheado), no hace falta inyectarlo por turno.
    const dynamicContext = [summaryContext, memoryContext, workingContext, pendingContext, pendingIntentContext].filter(Boolean).join('\n\n');
    const currentUserText = dynamicContext ? `${dynamicContext}\n\n[Mensaje del usuario]\n${text}` : text;

    const messages = [
      ...this.history,
      { role: 'user', parts: [{ text: currentUserText }] }
    ];

    let modelResult;
    try {
      modelResult = await this.modelProvider.generateJson({
        system: this.buildSystemPrompt(),
        messages,
        temperature: 0.3,
        // Cap bajo a propósito: la decisión + speak conciso + toolCalls caben de
        // sobra. El contenido largo NO se genera aquí (va a Fase 2), así que un
        // tope alto solo serviría para que el modelo vierta paredes de texto y
        // dispare la latencia de la voz. Esta es la palanca real de tiempo-a-voz.
        maxTokens: 450,
        purpose: 'conversation_decision'
      });
      // Caso sin excepción: el JSON parseó bien pero el corte cayó justo entre
      // dos campos (ej. toolCalls cerrado, "speak" a medias) — stopReason lo
      // delata aunque no haya reventado el parseo. Mismo resguardo que el catch.
      if (modelResult.stopReason === 'max_tokens') {
        modelResult = await this.modelProvider.generateJson({
          system: this.buildSystemPrompt(),
          messages,
          temperature: 0.3,
          maxTokens: 1200,
          purpose: 'conversation_decision_retry'
        });
        this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
          channel,
          step: 'model_decision_retry_after_truncation'
        });
      }
    } catch (error) {
      // El techo de la decisión (450) está pensado para el JSON corto de
      // Fase 1. Si el modelo lo chocó, lo que haya en rawText está cortado
      // por presupuesto: antes de rescatar texto trunco, reintentar UNA vez
      // con techo amplio — nunca entregar una frase cortada por maxTokens.
      if (error.stopReason === 'max_tokens') {
        try {
          modelResult = await this.modelProvider.generateJson({
            system: this.buildSystemPrompt(),
            messages,
            temperature: 0.3,
            maxTokens: 1200,
            purpose: 'conversation_decision_retry'
          });
          this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
            channel,
            step: 'model_decision_retry_after_truncation'
          });
        } catch (retryError) {
          error = retryError;
        }
      }

      if (!modelResult) {
      const plainResponse = stripToolCallLeak(coercePlainModelText(error.rawText) || {});
      if (plainResponse.speak || plainResponse.visual) {
        conversationTask.status = 'completed';
        conversationTask.result = formatHumanReadable(plainResponse, { userText: text, toolResults: [] });
        conversationTask.result = applyOutputValueContract(conversationTask.result, { userText: text });
        conversationTask.result = enforceSpeakContract(conversationTask.result);
        conversationTask.result.toolResults = [];
        this.workingMemoryStore?.recordTurn({
          userText: text,
          channel,
          toolResults: [],
          assistantResult: conversationTask.result
        });
        this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
          channel,
          step: 'model_decision_plaintext_recovered'
        });
        this.taskRuntime.emitTaskEvent(conversationTask, 'task_completed', {
          channel,
          status: conversationTask.status,
          recoveredFrom: 'plain_text'
        });
        if (channel !== 'agent') {
          this.pushHistory(text, conversationTask.result);
        }
        this.scheduleBackgroundLearning({ text, channel, conversationTask, toolResults: [], recentHistory: recentHistoryText, agentId });
        return conversationTask;
      }

      conversationTask.status = 'failed';
      conversationTask.error = { message: error.message };
      const failure = buildModelFailureMessage(error);
      conversationTask.result = {
        speak: failure.speak,
        visual: failure.visual,
        toolResults: []
      };
      this.taskRuntime.emitTaskEvent(conversationTask, 'task_failed', {
        channel,
        step: 'model_decision',
        message: error.message
      });
      return conversationTask;
      }
    }

    const decision = stripToolCallLeak(modelResult.data || {});

    // El modelo declaró por su propio criterio (no regex) si este turno es de
    // uno de sus especialistas — ver el campo "specialist" del schema en
    // buildSystemPrompt. Se resuelve al módulo real para el evento del HUD y
    // para que las rondas de tools/cierre hablen con SU voz (buildVoiceSwitchBlock).
    const specialist = this.modules.find((m) => m.name === decision.specialist) || null;
    if (specialist) {
      this.eventBus?.emit('specialist_active', {
        name: specialist.name,
        domain: specialist.displayName || specialist.name,
        specialist: specialist.specialistName || null,
        voiceProfile: specialist.voiceProfile || null,
        taskId: conversationTask.id
      });
    }

    // Cuando el usuario pide que VARIOS especialistas hablen en el mismo turno
    // (ej: "que se presenten todos"), el modelo usa "segments" en vez de
    // "speak" único — bug real encontrado en vivo: sin esto, el modelo
    // respondía "Claro, que hablen ellos" y no entregaba nada, porque solo
    // podía declarar UN especialista por turno. Se resuelve cada segmento a
    // su módulo real (voz) acá; el HUD reproduce la secuencia con la voz de
    // cada uno.
    const segments = Array.isArray(decision.segments)
      ? decision.segments
        .map((seg) => {
          const mod = this.modules.find((m) => m.name === seg?.specialist) || null;
          const segText = String(seg?.text || '').trim();
          if (!segText) return null;
          return {
            specialist: mod?.name || null,
            specialistName: mod?.specialistName || null,
            voiceProfile: mod?.voiceProfile || null,
            text: segText
          };
        })
        .filter(Boolean)
      : null;

    const toolResults = [];
    const toolCalls = Array.isArray(decision.toolCalls) ? decision.toolCalls : [];
    const requestedOutputValue = decision.outputValue || inferOutputValue({
      userText: text,
      visual: decision.visual,
      format: decision.format
    });

    // Actualiza el estado de pendingIntent según lo que declaró el modelo.
    // Si omitió el campo o lo puso vacío, se considera hilo cerrado.
    const declaredIntent = typeof decision.pendingIntent === 'string' ? decision.pendingIntent.trim() : null;
    const newPendingIntent = declaredIntent || null;
    if (newPendingIntent !== this.pendingIntent) {
      this.pendingIntent = newPendingIntent;
      const currentState = this.historyStore?.loadState() || {};
      this.historyStore?.saveState({ ...currentState, pendingIntent: this.pendingIntent });
    }

    this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
      step: 'model_decision',
      model: modelResult.model || 'unknown',
      durationMs: modelResult.durationMs,
      cacheReadTokens: modelResult.usage?.cacheReadTokens,
      toolCallCount: toolCalls.length
    });

    // Frase corta para cubrir el hueco de latencia mientras corren las tools.
    // Solo se emite si REALMENTE habrá tool calls — nunca en turnos
    // puramente conversacionales (ej. "hola, ¿cómo estás?").
    if (toolCalls.length > 0 && channel === 'hud') {
      this.eventBus.emit('hud_quick_ack', { text: buildQuickAck(toolCalls) });
    }

    // --- Bounded tool loop (max 3 rounds) ---
    // Round 0: initial decision already made above (decision + toolCalls).
    // Each round: execute pending toolCalls, feed results back, let model decide
    // whether to call more tools or deliver the final answer.
    // On the last forced round the continuation prompt blocks further toolCalls.
    const MAX_TOOL_ROUNDS = 3;
    let loopMessages = messages; // starts with history + user message
    let currentDecision = decision;
    let currentToolCalls = toolCalls;
    // Track whether any tool produced a visual panel (list of emails, calendar events, etc.)
    // so the closing prompt can instruct the model to skip the summary in chat.
    //
    // REGLA — contenido largo generado por el modelo (toda tool nueva que lo
    // necesite debe seguir esto, NO agregarse acá):
    // El presupuesto de tokens de la decisión/continuación (450-4000) es para
    // la DECISIÓN, no para prosa larga. Si una tool produce contenido extenso
    // (HTML, documentos, reportes), la tool recibe un BRIEF corto y genera el
    // contenido POR DENTRO con su propio modelProvider.generateText({maxTokens:
    // 6000+}) — ver preview.render_html y google.docs.create_document. Subir
    // este techo es el parche rechazado: nunca alcanza para todo y mezcla
    // generación de contenido con la decisión de qué tools llamar.
    // gmail.send/create_draft y sheets.write_range quedan acá porque sus
    // cuerpos (emails, filas de datos) entran cómodo en 4000 tokens.
    const CONTENT_OUTPUT_TOOLS = /google\.(sheets\.|gmail\.send|gmail\.create_draft)/;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (currentToolCalls.length === 0) break;

      const toolsStartedAt = Date.now();
      const roundResults = await this.executeToolCalls(currentToolCalls, { text, context, channel });
      const toolsMs = Date.now() - toolsStartedAt;
      toolResults.push(...roundResults);

      const hasWaiting = roundResults.some((r) => r.status === 'waiting_confirmation');
      if (hasWaiting) {
        currentToolCalls = [];
        break;
      }

      const isLastRound = round === MAX_TOOL_ROUNDS - 1;

      this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
        step: `tool_round_${round}`,
        toolCount: roundResults.length,
        toolNames: roundResults.map((r) => r.toolName),
        toolsMs
      });

      // Next toolCalls may write documents/emails — need higher token ceiling
      const nextCallsNeedContentOutput = (Array.isArray(currentDecision.toolCalls) ? currentDecision.toolCalls : [])
        .some((c) => CONTENT_OUTPUT_TOOLS.test(c?.toolName || ''));
      const roundMaxTokens = (nextCallsNeedContentOutput || isLastRound) ? 4000 : 2000;

      let continuation;
      try {
        continuation = await generateJsonGuarded(this.modelProvider, {
          system: isLastRound
            ? this.buildFinalResponsePrompt(specialist)
            : this.buildToolContinuationPrompt({ memoryContext, isLastRound: false, specialist }),
          messages: [
            ...loopMessages,
            {
              role: 'model',
              parts: [{ text: JSON.stringify({ speak: currentDecision.speak || '', toolCalls: currentToolCalls }) }]
            },
            {
              role: 'user',
              parts: [{
                text: JSON.stringify({
                  toolResults: summarizeToolResults(roundResults),
                  note: isLastRound
                    ? 'Entrega la respuesta final ahora. No incluyas toolCalls.'
                    : 'Analiza y decide: responde o llama mas herramientas.'
                })
              }]
            }
          ],
          temperature: 0.2,
          maxTokens: roundMaxTokens,
          purpose: isLastRound ? 'final_response' : 'tool_continuation'
        }, Math.min(roundMaxTokens * 2, 6000));
      } catch (err) {
        this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
          step: `tool_continuation_fallback_round_${round}`,
          message: err.message
        });
        currentToolCalls = [];
        break;
      }

      currentDecision = stripToolCallLeak(continuation.data || {});
      currentToolCalls = isLastRound
        ? []
        : (Array.isArray(currentDecision.toolCalls) ? currentDecision.toolCalls : []);

      this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
        step: `continuation_round_${round}`,
        model: continuation.model || 'unknown',
        durationMs: continuation.durationMs,
        cacheReadTokens: continuation.usage?.cacheReadTokens,
        nextToolCallCount: currentToolCalls.length
      });

      // Update loop messages for potential next round
      loopMessages = [
        ...loopMessages,
        {
          role: 'model',
          parts: [{ text: JSON.stringify({ speak: currentDecision.speak || '', toolCalls: currentToolCalls }) }]
        },
        {
          role: 'user',
          parts: [{
            text: JSON.stringify({ toolResults: summarizeToolResults(roundResults) })
          }]
        }
      ];
    }
    // --- End tool loop ---

    const hasWaitingConfirmation = toolResults.some((item) => item.status === 'waiting_confirmation');
    let finalResponse = {
      speak: currentDecision.speak || '',
      visual: currentDecision.visual || '',
      format: currentDecision.format,
      outputValue: currentDecision.outputValue || requestedOutputValue
    };

    if (toolResults.length > 0 && (hasWaitingConfirmation || this.shouldUseDeterministicClosing(toolResults, requestedOutputValue))) {
      finalResponse = this.fallbackFinalResponse(toolResults);
    }

    // segments solo aplica al turno sin tools (la decisión inicial, antes de
    // cualquier ronda de continuación que ya no carga ese campo) — el HUD
    // reproduce cada uno con su propia voz. "speak" (voz/canales sin pantalla,
    // ej Telegram) va sin formato, todo seguido — nunca markdown en voz. El
    // texto de pantalla SÍ separa por especialista (una línea por uno, con su
    // nombre): si no, en pantalla se ve como un solo párrafo corrido sin saber
    // quién dice qué, aunque por voz suene correctamente separado.
    if (segments && segments.length > 0 && toolResults.length === 0) {
      finalResponse.speak = finalResponse.speak || segments.map((s) => s.text).join(' ');
      finalResponse.visual = finalResponse.visual || segments
        .map((s) => `**${s.specialistName || 'Especialista'}:** ${s.text}`)
        .join('\n\n');
      finalResponse.segments = segments;
    }

    finalResponse = stripFabricatedActionClaim(finalResponse, { userText: text, toolResultsCount: toolResults.length });

    // Si el turno declaró screenDetail, su brevedad es intencional: el detalle
    // viaja en Fase 2, no es un "turno fantasma". No lo mandamos a reparar.
    if (!currentDecision.screenDetail && responseSeemsIncomplete({
      userText: text,
      response: finalResponse,
      toolResults
    })) {
      finalResponse = await this.repairIncompleteResponse({
        userText: text,
        initialResponse: finalResponse,
        toolResults,
        memoryContext
      });
      this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
        step: 'response_repaired',
        channel
      });
    }

    conversationTask.status = hasWaitingConfirmation ? 'waiting_confirmation' : 'completed';
    finalResponse = formatHumanReadable(finalResponse, {
      userText: text,
      toolResults
    });
    finalResponse = applyOutputValueContract(finalResponse, {
      userText: text
    });
    finalResponse = enforceSpeakContract(finalResponse);

    // Fase 2 (contenido fuera del JSON): turnos expandidos SIN herramientas que
    // declararon detalle de pantalla generan ese detalle aparte. En el HUD se
    // entrega después por SSE (la voz no espera); en otros canales se genera
    // inline para no perder contenido. Los turnos con tools ya tienen sus
    // paneles y su lógica de cierre — no se tocan.
    const wantsScreenDetail = toolResults.length === 0
      && !hasWaitingConfirmation
      && currentDecision.screenDetail === true
      && !String(finalResponse.visual || '').trim();
    const deferToSse = wantsScreenDetail && channel === 'hud';

    conversationTask.result = {
      speak: finalResponse.speak,
      visual: finalResponse.visual,
      format: finalResponse.format,
      outputValue: finalResponse.outputValue,
      pendingContent: deferToSse,
      toolResults,
      ...(finalResponse.segments ? { segments: finalResponse.segments } : {})
    };

    // Canales no-HUD (Telegram): generar el detalle inline antes de devolver,
    // porque no hay panel ni SSE que lo reciba después.
    if (wantsScreenDetail && !deferToSse) {
      try {
        conversationTask.result.visual = await this.generateScreenDetail({ userText: text, speak: finalResponse.speak, recentHistory: recentHistoryText });
      } catch (_) { /* si falla, queda solo el speak: peor caso, sin regresión */ }
    }

    this.taskRuntime.emitTaskEvent(conversationTask, 'task_completed', {
      channel,
      status: conversationTask.status,
      turnMs: Date.now() - turnStartedAt
    });

    // HUD: el detalle se genera en background y llega por SSE. handleMessage
    // retorna YA con el speak para que la voz arranque sin esperar.
    if (deferToSse) {
      const taskId = conversationTask.id;
      setImmediate(async () => {
        try {
          const detail = await this.generateScreenDetail({ userText: text, speak: finalResponse.speak, recentHistory: recentHistoryText });
          conversationTask.result.visual = detail;
          conversationTask.result.pendingContent = false;
          this.eventBus.emit('conversation_content', { taskId, visual: detail, format: finalResponse.format });
        } catch (error) {
          conversationTask.result.pendingContent = false;
          this.eventBus.emit('conversation_content', { taskId, visual: '', failed: true, message: error.message });
        }
      });
    }

    // Las corridas de agentes no entran al historial del HUD: son misiones
    // automáticas, no parte de la conversación con el usuario.
    if (channel !== 'agent') {
      this.pushHistory(text, conversationTask.result);
    }

    this.scheduleBackgroundLearning({ text, channel, conversationTask, toolResults, recentHistory: recentHistoryText, agentId });

    this.workingMemoryStore?.recordTurn({
      userText: text,
      channel,
      toolResults,
      assistantResult: conversationTask.result
    });

    return conversationTask;
  }

  // Refuerzo + aprendizaje + captura de lecciones en juego, en background.
  // Se llama desde TODOS los caminos de cierre de turno para que el loop de
  // aprendizaje no se salte ninguno (incluida la recuperación por texto plano).
  scheduleBackgroundLearning({ text, channel, conversationTask, toolResults = [], recentHistory = '', agentId = null }) {
    setImmediate(async () => {
      // 1) Refuerzo: el mensaje actual es la reacción al turno anterior.
      //    Evalúa las lecciones que estuvieron en juego antes de aprender nuevas.
      try {
        const polarity = detectFeedbackPolarity(text);
        if (this._lessonsInPlay.length > 0 && polarity !== 'neutral') {
          const adjusted = applyReinforcement({
            memoryStore: this.memoryStore,
            previousLessons: this._lessonsInPlay,
            polarity,
            // Para correcciones: solo se ajustan lecciones pertinentes al
            // texto del reclamo (invariante de pertinencia, ver módulo).
            userText: text
          });
          if (adjusted.length > 0) {
            this.taskRuntime.emitTaskEvent(conversationTask, 'task_progress', {
              channel,
              step: 'lesson_reinforcement',
              polarity,
              adjusted: adjusted.map((a) => ({ key: a.key, confidence: a.confidence, state: a.state }))
            });
          }
        }
      } catch (err) {
        // El refuerzo nunca debe romper el camino en vivo — pero el error se
        // registra: silenciar la excepción no debe silenciar su existencia.
        console.warn(`[jarvis-codex] refuerzo de lecciones falló: ${err.message}`);
      }

      // 2) Aprendizaje: extrae memoria de perfil Y grafo de conocimiento del
      //    turno con UNA sola llamada al modelo (antes eran dos secuenciales que
      //    repetían los mismos invariantes). El orquestador aísla cada
      //    persistencia y nunca propaga; aun así lo envolvemos por el catch
      //    externo del pipeline. Ver src/memory/turn-extractor.js.
      try {
        await extractTurnKnowledge({
          userText: text,
          assistantResult: conversationTask.result,
          toolResults,
          modelProvider: this.modelProvider,
          memoryStore: this.memoryStore,
          knowledgeGraph: this.knowledgeGraph,
          recentHistory,
          agentId
        });
      } catch (err) {
        console.warn(`[jarvis-codex] extracción de conocimiento del turno falló: ${err.message}`);
      }

      // 3) Captura las lecciones en juego AHORA (incluye las recién creadas)
      //    para evaluarlas contra la reacción del próximo turno.
      try {
        this._lessonsInPlay = selectLessonsInPlay(this.memoryStore);
      } catch (err) {
        this._lessonsInPlay = [];
        console.warn(`[jarvis-codex] captura de lecciones en juego falló: ${err.message}`);
      }
    });
  }
}

module.exports = {
  ConversationRuntime,
  formatConfirmationRequest,
  enforceSpeakContract
};
