const { DATA_DIR } = require('./config');
const { EventBus } = require('./core/event-bus');
const { FileLogger } = require('./core/file-logger');
const { PolicyEngine } = require('./core/policy-engine');
const { ToolRegistry } = require('./core/tool-registry');
const { TaskRuntime } = require('./core/task-runtime');
const { WorkingMemoryStore } = require('./core/working-memory');
const { MemoryStore } = require('./memory/memory-store');
const { KnowledgeGraph } = require('./memory/knowledge-graph');
const { bootstrapLegacyMemory } = require('./memory/legacy-memory-bootstrap');
const { syncRuntimeSelfKnowledge } = require('./memory/runtime-self-knowledge');
const { ContextAssembler } = require('./memory/context-assembler');
const { CredentialVault } = require('./security/credential-vault');
const { AuditTrail } = require('./security/audit-trail');
const { importLegacyCredentials } = require('./security/legacy-credential-importer');
const { createGoogleAuthFactory } = require('./connectors/google-auth');
const { createGoogleCalendarTools } = require('./connectors/google-calendar');
const { createGoogleDocsTools } = require('./connectors/google-docs');
const { createGmailTools } = require('./connectors/google-gmail');
const { createGoogleContactsTools } = require('./connectors/google-contacts');
const { createGoogleSheetsTools } = require('./connectors/google-sheets');
const { createGoogleTasksTools } = require('./connectors/google-tasks');
const { createGoogleDriveTools } = require('./connectors/google-drive');
const { createModelProvider, createModelTools } = require('./model/model-tools');
const modelCatalog = require('./model/model-catalog');
const { UsageMeter } = require('./model/usage-meter');
const { generateWithContinuation } = require('./model/long-content');
const { ConversationRuntime } = require('./conversation/conversation-runtime');
const { resolvePersona, loadPersonaOverlay, CONTENT_HONESTY_CLAUSE } = require('./conversation/persona-core');
const { HistoryStore } = require('./conversation/history-store');
const { createVoiceTools } = require('./voice/voice-tools');
const { createEdgeTTSProvider } = require('./voice/edge-tts-provider');
const { TelegramChannel } = require('./channels/telegram-channel');
const { WhatsAppChannel } = require('./channels/whatsapp-channel');
const { createWhatsAppTools } = require('./channels/whatsapp-tools');
const { createResearchTools } = require('./research/source-quality');
const { createWebFetchTools } = require('./connectors/web-fetch');
const { createDesktopTools } = require('./connectors/desktop-control');
const { createMcpConnectionTools } = require('./connectors/mcp-connections');
const { createServiceDiscoveryTools } = require('./connectors/service-discovery');
const { createGenericApiTools } = require('./connectors/generic-api');
const { PresenterRegistry } = require('./presenters/presenter-registry');
const { registerGooglePresenters } = require('./presenters/google-presenters');
const { AgentStore } = require('./agents/agent-store');
const { AgentScheduler } = require('./agents/agent-scheduler');
const { createAgentTools } = require('./agents/agent-tools');
const { executeTask } = require('./agents/task-executor');
const { createVisionTools } = require('./vision/vision-tools');
const { createMeetingTools } = require('./meeting/meeting-tools');
const { createSocialHubTools } = require('./connectors/social-hub');
const { createVideoTools } = require('./connectors/video-pipeline');
const { createSheetsMemoryTools } = require('./connectors/sheets-memory');
const { createBrandProfileTools } = require('./connectors/brand-profile');

function createRuntime(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  const eventBus = new EventBus();
  const fileLogger = new FileLogger({ dataDir });
  eventBus.on('*', (event) => fileLogger.write('event', event));
  const policyEngine = new PolicyEngine();
  // Escritura en planilla: append (registrar datos que el usuario pide) es seguro
  // y no debe friccionar — es inyección directa del usuario. Pero overwrite puede
  // pisar datos existentes, así que ese sí pide confirmación.
  policyEngine.registerRule(({ tool, input }) => {
    if (tool.name === 'google.sheets.write_range' && input.mode !== 'append') {
      return { requiresConfirmation: true, reason: 'Sobrescribir un rango puede pisar datos existentes de la planilla.' };
    }
    return null;
  });
  // Invariante anti-recursión: un agente corriendo (channel 'agent') no puede
  // crear, modificar ni borrar agentes. Sin esto, un goal redactado como
  // misión recurrente hace que la corrida intente programar otro agente.
  policyEngine.registerRule(({ tool, context }) => {
    if (context.channel === 'agent' && /^agents\./.test(tool.name)) {
      return { allowed: false, reason: 'Las corridas de agentes no pueden gestionar agentes (anti-recursión).' };
    }
    return null;
  });
  // Anti-recursión del ejecutor autónomo: una tarea autónoma no puede lanzar
  // otra tarea autónoma (ni desde una corrida de agente). Evita planes que se
  // delegan a sí mismos en bucle.
  policyEngine.registerRule(({ tool, context }) => {
    if (tool.name === 'tasks.run_autonomous' && (context.inAutonomousTask || context.channel === 'agent')) {
      return { allowed: false, reason: 'Una tarea autónoma no puede lanzar otra tarea autónoma (anti-recursión).' };
    }
    return null;
  });
  const auditTrail = new AuditTrail({ dataDir });
  // memoryStore se declara más abajo, pero el resolver solo se invoca durante
  // ejecuciones de tools (mucho después de que termine el arranque).
  const toolRegistry = new ToolRegistry({
    policyEngine,
    eventBus,
    auditTrail,
    recipientResolver: async (query) => memoryStore.resolveRecipient(query)
  });
  const taskRuntime = new TaskRuntime({ eventBus, toolRegistry });
  const workingMemoryStore = new WorkingMemoryStore();
  const memoryStore = new MemoryStore({ dataDir });
  bootstrapLegacyMemory({ memoryStore });
  const knowledgeGraph = new KnowledgeGraph({ dataDir });
  // Poda de arranque: limpia basura efímera y entidades huérfanas acumuladas.
  // Nunca toca lo verificado, lo declarado por el usuario, ni los compromisos.
  try {
    const pruned = knowledgeGraph.prune();
    if (pruned.removedFacts || pruned.removedEntities) {
      console.log(`[jarvis-codex] grafo podado: -${pruned.removedFacts} hechos, -${pruned.removedEntities} entidades`);
    }
  } catch (err) {
    console.warn(`[jarvis-codex] poda del grafo falló: ${err.message}`);
  }
  const credentialVault = new CredentialVault({ dataDir });
  const presenterRegistry = new PresenterRegistry();
  registerGooglePresenters(presenterRegistry);
  const usageMeter = new UsageMeter({ dataDir });
  const modelProvider = createModelProvider({
    dataDir,
    vault: credentialVault,
    usageMeter,
    ...(options.model || {})
  });

  // Escala de modelos: el modelo activo y el swap en caliente dentro del mismo
  // ecosistema (ver src/model/model-catalog.js). Cruzar de proveedor es
  // onboarding (key nueva) — no soportado en caliente todavía.
  function getActiveModelId() {
    if (typeof modelProvider.model === 'string') return modelProvider.model;
    if (Array.isArray(modelProvider.models) && modelProvider.models[0]) return modelProvider.models[0];
    return 'unknown';
  }
  function getActiveModel() {
    const id = getActiveModelId();
    return modelCatalog.getModel(id) || { id, label: id, tier: 'desconocido', tierRank: 0 };
  }
  const modelPrefPath = require('path').join(dataDir, 'model-preference.json');
  function setActiveModel(modelId, { persist = true } = {}) {
    const target = modelCatalog.getModel(modelId);
    if (!target) throw new Error(`MODEL_NOT_IN_CATALOG: ${modelId}`);
    const active = modelCatalog.getModel(getActiveModelId());
    if (active && target.provider !== active.provider) {
      throw new Error(`MODEL_SWAP_NEEDS_ONBOARDING: cambiar de ${active.provider} a ${target.provider} requiere su API key y reinicio`);
    }
    if (typeof modelProvider.setModel !== 'function') {
      throw new Error('MODEL_SWAP_UNSUPPORTED: el proveedor activo no permite swap en caliente');
    }
    modelProvider.setModel(target.id, target.pricing);
    // La elección persiste: al reiniciar, Jarvis vuelve al modelo que el usuario
    // dejó puesto, no al default. Solo dentro del mismo proveedor (el provider lo
    // fija el arranque/onboarding).
    if (persist) {
      try { require('fs').writeFileSync(modelPrefPath, JSON.stringify({ model: target.id }), 'utf-8'); } catch (_) {}
    }
    return getActiveModel();
  }
  // Restaurar la preferencia guardada (si es compatible con el proveedor activo).
  try {
    const saved = JSON.parse(require('fs').readFileSync(modelPrefPath, 'utf-8'));
    const pref = saved && modelCatalog.getModel(saved.model);
    if (pref && pref.provider === modelCatalog.getModel(getActiveModelId())?.provider && pref.id !== getActiveModelId()) {
      setActiveModel(pref.id, { persist: false });
    }
  } catch (_) { /* sin preferencia guardada: queda el default */ }

  toolRegistry.register({
    name: 'model.catalog',
    description: 'Mostrar la escala de modelos disponibles (tiers, fortalezas, cuál es gratis, cuál es el recomendado) y cuál está activo ahora. Útil para "¿con qué modelo estás pensando?" o "¿qué modelos puedo usar?". Sin input.',
    risk: 'low',
    permissions: [],
    execute: async () => ({
      active: getActiveModel(),
      catalog: modelCatalog.listCatalog(),
      hotSwapTargets: modelCatalog.hotSwapTargets(getActiveModelId()).map((m) => m.id)
    })
  });

  toolRegistry.register({
    name: 'model.set_active',
    description: 'Cambiar el modelo activo de Jarvis. Swap en caliente si es del mismo ecosistema (ej: Haiku→Sonnet en Anthropic, sin reinicio); cambiar de proveedor requiere onboarding. Úsalo cuando el usuario, tras un resultado pobre, acepta probar un modelo más potente, o pide explícitamente cambiar de modelo. Input: { model: "id del catálogo" }.',
    risk: 'medium',
    permissions: ['model:manage'],
    execute: async (input) => {
      try {
        const active = setActiveModel(String(input.model || ''));
        return { ok: true, active };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  });

  toolRegistry.register({
    name: 'memory.upsert_candidate',
    description: 'Store a candidate memory record for later review.',
    risk: 'low',
    permissions: ['memory:write_candidate'],
    execute: async (input) => memoryStore.upsert({ ...input, state: input.state || 'candidate' })
  });

  toolRegistry.register({
    name: 'memory.update_state',
    description: 'Review a memory record and change its state.',
    risk: 'medium',
    permissions: ['memory:review'],
    execute: async (input) => memoryStore.updateState(input.id, input.state, input.patch || {})
  });

  toolRegistry.register({
    name: 'memory.correct',
    description: 'Corregir o descartar algo que Jarvis tiene guardado (memoria o hecho del grafo) cuando el usuario dice que está mal. Dos pasos: (1) sin "id": busca con { query } y devuelve candidatos de memoria y del grafo con sus ids para que elijas el correcto; (2) con { id, source: "memory"|"fact", action: "reject"|"replace", correction? }: "reject" descarta el dato erróneo (no se vuelve a usar), "replace" además registra el valor correcto — correction: { predicate, object } para hechos del grafo, o { content, title, ... } para memorias.',
    risk: 'medium',
    permissions: ['memory:review'],
    execute: async (input) => {
      if (!input.id) {
        const query = String(input.query || '');
        const memories = memoryStore.searchScored(query, { limit: 5 }).map(({ record, score }) => ({
          id: record.id, source: 'memory', type: record.type, title: record.title,
          content: record.content, state: record.state, score
        }));
        const profiles = knowledgeGraph.retrieveForMessage(query, { limit: 5 });
        const facts = profiles.flatMap((p) => p.facts.map((f) => ({
          id: f.id, source: 'fact', entity: p.entity.name, predicate: f.predicate, object: f.object, state: f.state
        })));
        return { found: memories.length + facts.length, memories, facts };
      }

      if (input.source === 'fact') {
        if (input.action === 'replace' && input.correction) {
          const old = knowledgeGraph.setFactState(input.id, 'obsolete');
          if (!old) return { ok: false, error: 'NOT_FOUND' };
          const replacement = knowledgeGraph.addFact(
            old.subjectId,
            input.correction.predicate || old.predicate,
            input.correction.object,
            { confidence: 1, source: 'user_correction', state: 'verified' }
          );
          return { ok: true, old, replacement };
        }
        const fact = knowledgeGraph.setFactState(input.id, 'rejected');
        return fact ? { ok: true, fact } : { ok: false, error: 'NOT_FOUND' };
      }

      try {
        if (input.action === 'replace' && input.correction) {
          const record = memoryStore.updateState(input.id, 'verified', { ...input.correction, sourceRefs: ['user_correction'] });
          return { ok: true, record };
        }
        const record = memoryStore.updateState(input.id, 'rejected');
        return { ok: true, record };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  });

  toolRegistry.register({
    name: 'memory.graph_query',
    description: 'Consultar el grafo de conocimiento sobre el mundo del usuario (personas, proyectos, lugares, organizaciones y sus hechos/relaciones). Útil para responder "¿qué sabes de X?". Input: { query: "nombre o tema" }. Devuelve los perfiles de entidad relevantes.',
    risk: 'low',
    permissions: [],
    execute: async (input) => {
      const profiles = knowledgeGraph.retrieveForMessage(String(input.query || ''), { limit: input.limit || 5 });
      return { query: input.query, found: profiles.length, profiles };
    }
  });

  toolRegistry.register({
    name: 'memory.graph_remember',
    description: 'Registrar explícitamente en el grafo de conocimiento una entidad y sus hechos cuando el usuario pide recordar algo concreto sobre alguien o algo. Input: { name, type: "person|project|tool|place|concept|event|org", facts: [{ predicate, object }], properties? }. Los hechos quedan verificados (el usuario los afirmó directo).',
    risk: 'low',
    permissions: ['memory:write_candidate'],
    execute: async (input) => {
      const entity = knowledgeGraph.upsertEntity(input.type || 'concept', input.name, input.properties || {}, 'user_explicit');
      if (!entity) return { ok: false, error: 'NAME_REQUIRED' };
      const facts = [];
      for (const f of Array.isArray(input.facts) ? input.facts : []) {
        const fact = knowledgeGraph.addFact(entity.id, f.predicate, f.object, { confidence: 1, source: 'user_explicit', state: 'verified' });
        if (fact) facts.push(fact);
      }
      return { ok: true, entity, facts };
    }
  });

  toolRegistry.register({
    name: 'audit.query',
    description: 'Consultar el registro de auditoría de acciones que Jarvis ejecutó en nombre del usuario (qué herramienta, riesgo, resultado, canal). Útil para "¿qué hiciste hoy?" o "¿qué acciones de riesgo corriste?". Input opcional: { tool, outcome: "ok|error|denied|confirmation_required", since: ISO, limit }.',
    risk: 'low',
    permissions: [],
    execute: async (input) => ({
      entries: auditTrail.query(input || {}),
      stats: auditTrail.stats()
    })
  });

  toolRegistry.register({
    name: 'memory.commitments',
    description: 'Listar o actualizar compromisos del usuario (promesas/tareas con o sin fecha) guardados en el grafo. Input para listar: { status?: "pending|active|completed|failed|cancelled" }. Input para actualizar: { id, status }.',
    risk: 'low',
    permissions: [],
    execute: async (input) => {
      if (input.id && input.status) {
        const updated = knowledgeGraph.setCommitmentStatus(input.id, input.status);
        return updated ? { ok: true, commitment: updated } : { ok: false, error: 'NOT_FOUND' };
      }
      return { commitments: knowledgeGraph.findCommitments({ status: input.status }) };
    }
  });

  toolRegistry.register({
    name: 'system.echo',
    description: 'Diagnostic echo tool.',
    risk: 'low',
    permissions: [],
    execute: async (input) => ({ echo: input, at: new Date().toISOString() })
  });

  toolRegistry.register({
    name: 'tasks.list_pending',
    description: 'List active or pending tasks in the runtime queue. Use to check what is in progress or waiting for confirmation.',
    risk: 'low',
    permissions: [],
    execute: async () => {
      const tasks = taskRuntime.listTasks();
      const active = tasks.filter(t => !['completed', 'failed', 'cancelled', 'superseded'].includes(t.status));
      const safe = active.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        toolName: t.toolName || null,
        createdAt: t.createdAt
      }));
      return { tasks: safe, total: tasks.length, active: safe.length };
    }
  });

  toolRegistry.register({
    name: 'tasks.confirm_pending',
    description: 'Confirmar y ejecutar una acción que quedó esperando confirmación (cualquier herramienta). Input: { id } — el id viene del bloque "Acciones pendientes de confirmación" en el contexto. Úsalo cuando el usuario confirma esa acción; no vuelvas a generarla desde cero.',
    risk: 'low',
    permissions: [],
    execute: async (input, context) => {
      const id = String(input.id || '');
      const task = taskRuntime.getTask(id);
      if (!task) throw new Error(`PENDING_TASK_NOT_FOUND: ${id}`);
      if (task.status !== 'waiting_confirmation') throw new Error(`TASK_NOT_PENDING: ${id} (status=${task.status})`);
      const completed = await taskRuntime.confirmTask(id, context);
      return { id, status: completed.status, toolName: completed.toolName, result: completed.result, error: completed.error };
    }
  });

  toolRegistry.register({
    name: 'tasks.cancel_pending',
    description: 'Cancelar (sin ejecutar) una acción que quedó esperando confirmación. Input: { id } — el id viene del bloque "Acciones pendientes de confirmación" en el contexto. Úsalo cuando el usuario descarta esa acción o pide algo distinto.',
    risk: 'low',
    permissions: [],
    execute: async (input) => {
      const id = String(input.id || '');
      const task = taskRuntime.getTask(id);
      if (!task) throw new Error(`PENDING_TASK_NOT_FOUND: ${id}`);
      if (task.status !== 'waiting_confirmation') throw new Error(`TASK_NOT_PENDING: ${id} (status=${task.status})`);
      task.status = 'cancelled';
      taskRuntime.emitTaskEvent(task, 'task_cancelled', { toolName: task.toolName });
      return { id, status: 'cancelled', toolName: task.toolName };
    }
  });

  const googleAuthFactory = createGoogleAuthFactory({ vault: credentialVault, dataDir, ...(options.google || {}) });
  // Autocuración al arranque: valida el token y promueve el mejor disponible al
  // vault ANTES de que cualquier tool corra. Si está revocado, deja needsReauth
  // marcado para que el HUD lo muestre — nunca falla en silencio.
  googleAuthFactory.healthCheck?.()
    .then((h) => {
      if (h?.ok) console.log(`[jarvis-codex] Google auth OK (source: ${h.source})`);
      else console.warn(`[jarvis-codex] Google auth necesita atención: ${h?.reason}${h?.needsReauth ? ' — re-autorizar en /auth/google' : ''}`);
    })
    .catch(() => {});
  for (const tool of createGoogleCalendarTools({ authFactory: googleAuthFactory })) {
    toolRegistry.register(tool);
  }

  for (const tool of createGoogleDocsTools({ authFactory: googleAuthFactory, modelProvider })) {
    toolRegistry.register(tool);
  }

  for (const tool of createGmailTools({
    authFactory: googleAuthFactory,
    summarizer: modelProvider,
    contactResolver: async (query) => {
      const record = memoryStore.findContact(query);
      if (!record) return null;
      const content = record.content || {};
      return {
        name: content.name || record.title,
        email: content.email || content.primaryEmail || null
      };
    }
  })) {
    toolRegistry.register(tool);
  }

  for (const tool of createGoogleContactsTools({ authFactory: googleAuthFactory })) {
    toolRegistry.register(tool);
  }

  for (const tool of createGoogleSheetsTools({ authFactory: googleAuthFactory })) {
    toolRegistry.register(tool);
  }

  for (const tool of createGoogleTasksTools({ authFactory: googleAuthFactory })) {
    toolRegistry.register(tool);
  }

  for (const tool of createGoogleDriveTools({ authFactory: googleAuthFactory, dataDir })) {
    toolRegistry.register(tool);
  }

  for (const tool of createModelTools({ provider: modelProvider, usageMeter })) {
    toolRegistry.register(tool);
  }

  for (const tool of createVoiceTools({ dataDir, providerOptions: { vault: credentialVault, ...(options.voice || {}) } })) {
    toolRegistry.register(tool);
  }

  for (const tool of createResearchTools()) {
    toolRegistry.register(tool);
  }

  for (const tool of createWebFetchTools()) {
    toolRegistry.register(tool);
  }

  // Manos en la máquina local (Fase E): listar/enfocar ventanas, abrir apps/URLs.
  // Riesgo alto en las que mueven la máquina → confirmación por policy + audit.
  for (const tool of createDesktopTools()) {
    toolRegistry.register(tool);
  }

  syncRuntimeSelfKnowledge({ memoryStore, toolRegistry });

  // Perfil de marca: se crea acá (antes del context-assembler) para poder
  // inyectar la marca activa al contexto en turnos de marketing. Las tools se
  // registran más abajo junto al resto.
  const brandTools = createBrandProfileTools({ dataDir });

  const contextAssembler = new ContextAssembler({
    memoryStore,
    workingMemoryStore,
    knowledgeGraph,
    getBrandProfile: brandTools.getActiveProfile,
    formatBrandProfile: brandTools.formatProfile
  });

  // Persona: fábrica (config de Daniel) + overlay opcional de cliente white-label.
  // Sin overlay → perfil idéntico al de siempre. options.persona permite
  // inyectar un overlay en tests sin tocar disco.
  const persona = resolvePersona(options.persona || loadPersonaOverlay(dataDir));
  const historyStore = new HistoryStore({ dataDir });
  const conversationRuntime = new ConversationRuntime({
    eventBus,
    fileLogger,
    taskRuntime,
    toolRegistry,
    modelProvider,
    presenterRegistry,
    memoryStore,
    workingMemoryStore,
    contextAssembler,
    knowledgeGraph,
    getActiveModel,
    persona,
    historyStore
  });
  toolRegistry.register({
    name: 'conversation.recall',
    description: 'Buscar en el historial completo de la conversación (no solo los últimos turnos). Útil para "¿qué te dije hace un rato/ayer?" o para encontrar algo mencionado antes. Input opcional: { query?: "texto a buscar", sinceMinutes?: number, limit?: number }.',
    risk: 'low',
    permissions: [],
    execute: async (input) => ({
      entries: historyStore.search({
        query: input?.query,
        sinceMinutes: input?.sinceMinutes,
        limit: input?.limit
      })
    })
  });

  const agentStore = new AgentStore({ dataDir });
  const agentScheduler = new AgentScheduler({ store: agentStore, conversationRuntime, eventBus, usageMeter });
  for (const tool of createAgentTools({ store: agentStore, scheduler: agentScheduler })) {
    toolRegistry.register(tool);
  }

  // Ejecutor autónomo multi-paso: para tareas que exceden el tool loop corto.
  // Planifica, ejecuta paso a paso con auto-fix, y se detiene ante acciones que
  // requieren aprobación (la autonomía tiene techo, ver policy + audit).
  toolRegistry.register({
    name: 'tasks.run_autonomous',
    description: 'Ejecutar una tarea COMPLEJA de varios pasos de forma autónoma: planifica el objetivo en pasos, los corre encadenando resultados y se auto-repara una vez si un paso falla. Úsala solo cuando la tarea claramente excede lo que puedes resolver en una o dos herramientas directas (ej: "investiga X, resume y guárdalo en un doc"). Input: { goal: "objetivo en lenguaje natural" }. Se detiene si un paso necesita tu aprobación.',
    risk: 'medium',
    permissions: ['tasks:autonomous'],
    execute: async (input, context = {}) => executeTask({
      goal: String(input.goal || ''),
      modelProvider,
      toolRegistry,
      channel: context.channel || 'hud'
    })
  });
  if (options.agents?.autoStart !== false) agentScheduler.start();

  toolRegistry.register({
    name: 'files.list_inbox',
    description: 'Listar los archivos recibidos en la bandeja local (fotos y documentos enviados por Telegram u otros canales). Devuelve nombre, tamaño y fecha.',
    risk: 'low',
    permissions: [],
    execute: async () => {
      const fs = require('fs');
      const path = require('path');
      const inboxDir = path.join(dataDir, 'inbox');
      if (!fs.existsSync(inboxDir)) return { files: [], total: 0 };
      const files = fs.readdirSync(inboxDir)
        .map((name) => {
          const stat = fs.statSync(path.join(inboxDir, name));
          return { name, bytes: stat.size, receivedAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, 30);
      return { files, total: files.length };
    }
  });

  toolRegistry.register({
    name: 'hud.show_file',
    description: 'Mostrar un archivo de la bandeja local (foto o documento recibido) en el HUD de la pantalla del computador del usuario. Input: { file: "nombre exacto o parte del nombre del archivo" }. Úsalo cuando el usuario pida ver, mostrar o "subir al HUD" un archivo que envió antes (por Telegram u otro canal). Funciona desde cualquier canal: el HUD y tú son el mismo sistema local.',
    risk: 'low',
    permissions: [],
    execute: async (input) => {
      const fs = require('fs');
      const path = require('path');
      const inboxDir = path.join(dataDir, 'inbox');
      const needle = String(input.file || '').toLowerCase().trim();
      if (!fs.existsSync(inboxDir)) throw new Error('INBOX_EMPTY: no hay archivos recibidos');
      const candidates = fs.readdirSync(inboxDir)
        .filter((name) => !needle || name.toLowerCase().includes(needle))
        .map((name) => ({ name, mtime: fs.statSync(path.join(inboxDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (candidates.length === 0) throw new Error(`INBOX_FILE_NOT_FOUND: ${input.file}`);
      const file = candidates[0];
      const ext = path.extname(file.name).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
      const payload = {
        name: file.name,
        url: `/inbox/${encodeURIComponent(file.name)}`,
        kind: isImage ? 'image' : ext === '.pdf' ? 'pdf' : 'file'
      };
      eventBus.emit('hud_show_file', payload);
      return { shown: file.name, ...payload };
    }
  });

  toolRegistry.register({
    name: 'hud.request_credentials',
    description: 'Mostrar un formulario en el HUD para que el usuario ingrese credenciales de un servicio externo (API key, token, usuario/contraseña). Úsalo cuando necesites conectar un servicio que el usuario aún no autorizó. Input: { service: "nombre del servicio (ej: LinkedIn)", description: "para qué se usará (ej: publicar en tu feed)", fields: [{ key: "api_key", label: "API Key", secret: true, hint: "Encuéntrala en developer.linkedin.com/apps" }] }. Espera hasta 2 minutos a que el usuario llene el formulario. Las credenciales se guardan cifradas en el vault local.',
    risk: 'medium',
    permissions: ['vault:write'],
    required: ['service', 'fields'],
    execute: async (input) => {
      const { createRequest } = require('./connectors/pending-credentials');
      const crypto = require('crypto');
      const requestId = crypto.randomBytes(8).toString('hex');
      const service = String(input.service || '').trim();
      const description = String(input.description || '').trim();
      const fields = Array.isArray(input.fields) ? input.fields : [];
      if (fields.length === 0) throw new Error('CREDENTIALS_NO_FIELDS');

      eventBus.emit('hud_request_credentials', { requestId, service, description, fields });

      const values = await createRequest(requestId, { service, fields: fields.map(f => f.key) });

      // Guardar en vault con prefijo del servicio
      const serviceKey = service.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const saved = {};
      for (const field of fields) {
        const val = values[field.key];
        if (val) {
          const vaultKey = `${serviceKey}_${field.key}`.toUpperCase();
          credentialVault.set(vaultKey, String(val));
          saved[field.key] = vaultKey;
        }
      }

      return { ok: true, service, savedKeys: saved, message: `Credenciales de ${service} guardadas en el vault.` };
    }
  });

  toolRegistry.register({
    name: 'hud.open_url',
    description: 'Abrir una página web en el navegador del usuario (pestaña nueva desde el HUD). Input: { url: "https://...", label: "nombre legible opcional" }. Úsalo cuando el usuario pida abrir un sitio o servicio: "abre google calendar" → https://calendar.google.com, "abre gmail" → https://mail.google.com, o cualquier URL que conozcas o hayas encontrado. Funciona desde cualquier canal mientras el HUD esté abierto.',
    risk: 'low',
    permissions: [],
    execute: async (input) => {
      const url = String(input.url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('HUD_OPEN_URL_INVALID: la URL debe empezar con http:// o https://');
      }
      const payload = { url, label: String(input.label || '').trim() || url };
      eventBus.emit('hud_open_url', payload);
      return { opened: true, ...payload };
    }
  });

  toolRegistry.register({
    name: 'preview.render_html',
    description: 'Crear y mostrar una página (landing, maqueta, sitio, cualquier documento web) en el HUD del usuario: aparece renderizada en un panel con opción de abrirla en grande. Úsalo cuando el usuario pida una página/landing/web. NO escribas tú el HTML completo: pasa un BRIEF corto en lenguaje natural y la herramienta genera el HTML por dentro. Input: { brief: "qué página crear, para quién, secciones y tono (ej: landing para Rishtedar, restaurante indio en Santiago: hero, platos destacados, botón de reserva, estética cálida)", title: "nombre legible opcional" }.',
    risk: 'low',
    permissions: [],
    execute: async (input) => {
      const fs = require('fs');
      const path = require('path');
      let html = String(input.html || '');
      const brief = String(input.brief || '').trim();

      // El HTML largo NO viaja en el toolCall (no cabe en el presupuesto de la
      // decisión): se genera acá, con techo amplio, usando el MODELO ACTIVO.
      // Así la calidad de la landing depende del modelo (Gemini free vs Sonnet)
      // — justo lo que el flujo de escala de modelos quiere poder comparar.
      // Detecta si el HTML quedó cortado por el techo de tokens: o el provider
      // avisa stop_reason==='max_tokens', o el documento nunca llegó a cerrar
      // </html> (heurística para providers que no reportan stop reason).
      const isComplete = (text, stopReason) =>
        stopReason !== 'max_tokens' && /<\/html>\s*$/i.test(text.trim());
      const stripFences = (text) => text.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '');

      async function callOnce(messages, maxTokens) {
        if (typeof modelProvider.generateText === 'function') {
          const out = await modelProvider.generateText({
            system: `Eres un diseñador web. Devuelves únicamente HTML+CSS, sin explicaciones ni markdown.\n\n${CONTENT_HONESTY_CLAUSE}`,
            messages, maxTokens, temperature: 0.5, purpose: 'preview_html'
          });
          return { text: String(out.text || ''), stopReason: out.stopReason || null };
        }
        const out = await modelProvider.generateJson({
          system: `Devuelve únicamente JSON { "html": "<documento completo>" }. Sin markdown.\n\n${CONTENT_HONESTY_CLAUSE}`,
          messages, maxTokens, temperature: 0.5, purpose: 'preview_html'
        });
        return { text: String(out.data?.html || ''), stopReason: out.stopReason || null };
      }

      if (!html.trim() && brief) {
        const genPrompt = `Genera un documento HTML COMPLETO y autocontenido para: ${brief}.\nRequisitos: un único archivo, todo el CSS dentro de <style>, responsive, estética cuidada y moderna —no escatimes en diseño—, contenido realista (no "lorem ipsum"). Sin dependencias externas ni <script>. Devuelve SOLO el HTML empezando por <!doctype html>, sin markdown ni explicación.`;
        try {
          const { text, truncated } = await generateWithContinuation({
            callOnce,
            prompt: genPrompt,
            isComplete,
            stripFences,
            continuePrompt: 'Continúa EXACTAMENTE donde quedó el documento anterior, sin repetir nada de lo ya escrito y sin comentarios, hasta cerrar con </html>.'
          });
          if (truncated) {
            return { ok: false, error: 'PREVIEW_INCOMPLETE: el documento generado quedó cortado (excede el límite de tokens) incluso tras continuar.' };
          }
          html = text;
        } catch (err) {
          return { ok: false, error: `PREVIEW_GENERATION_FAILED: ${err.message}` };
        }
      }

      if (!html.trim()) return { ok: false, error: 'BRIEF_OR_HTML_REQUIRED' };
      const previewsDir = path.join(dataDir, 'previews');
      fs.mkdirSync(previewsDir, { recursive: true });
      const fileName = `preview_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.html`;
      fs.writeFileSync(path.join(previewsDir, fileName), html, 'utf-8');
      const payload = { url: `/preview/${fileName}`, title: String(input.title || 'Vista previa') };
      eventBus.emit('hud_show_preview', payload);
      return { ok: true, ...payload, bytes: html.length };
    }
  });

  // Visión genérica: lee imágenes del inbox (boletas, documentos, fotos) con el
  // modelo si soporta multimodal (Anthropic hoy). Pieza genérica — Jarvis decide
  // cómo combinarla con Sheets/Docs/memoria según lo que pida el usuario.
  for (const tool of createVisionTools({ visionProvider: modelProvider, dataDir, googleAuthFactory })) {
    toolRegistry.register(tool);
  }

  for (const tool of createMeetingTools({ eventBus, modelProvider, googleAuthFactory })) {
    toolRegistry.register(tool);
  }

  for (const tool of createSheetsMemoryTools({ authFactory: googleAuthFactory, dataDir })) {
    toolRegistry.register(tool);
  }

  // brandTools ya se creó antes del context-assembler; acá solo se registran.
  for (const tool of brandTools) {
    toolRegistry.register(tool);
  }

  for (const tool of createSocialHubTools({ credentialVault, dataDir, googleAuthFactory })) {
    toolRegistry.register(tool);
  }

  for (const tool of createVideoTools({ dataDir, credentialVault })) {
    toolRegistry.register(tool);
  }

  // Canal WhatsApp personal (Baileys, multi-device — no toca las sesiones web
  // existentes). Solo auto-conecta si ya hay sesión vinculada; si no, el QR
  // se pide explícitamente con wa.link.
  const whatsappChannel = new WhatsAppChannel({
    dataDir,
    eventBus,
    contactResolver: async (query) => {
      const record = memoryStore.findContact(query);
      if (!record) return null;
      const content = record.content || {};
      return {
        name: content.name || record.title,
        phone: content.phone || content.telephone || null
      };
    }
  });
  for (const tool of createWhatsAppTools({ channel: whatsappChannel })) {
    toolRegistry.register(tool);
  }

  // Conexiones MCP genéricas a dashboards externos (Rishtedar, Hoja Cero,
  // etc.), vía staff_api_tokens / "Conectar agente". Sin código específico
  // de cliente: las tools se descubren y registran dinámicamente.
  for (const tool of createMcpConnectionTools({ toolRegistry, dataDir })) {
    toolRegistry.register(tool);
  }

  for (const tool of createServiceDiscoveryTools()) {
    toolRegistry.register(tool);
  }

  for (const tool of createGenericApiTools({ toolRegistry, dataDir, credentialVault })) {
    toolRegistry.register(tool);
  }
  if (options.whatsapp?.autoStart !== false && whatsappChannel.hasSession()) {
    whatsappChannel.start().catch((e) => console.warn(`[jarvis-codex] WhatsApp no conectó al arranque: ${e.message}`));
  }

  // Escucha reactiva: cuando wa.start_watching está activo, procesar mensajes
  // entrantes y responder automáticamente al remitente. Guard de concurrencia
  // para no solapar dos handleMessage simultáneos del mismo canal.
  let _waMsgLock = false;
  eventBus.on('whatsapp_incoming', async ({ jid, name, text }) => {
    if (_waMsgLock) return;
    _waMsgLock = true;
    try {
      const task = await conversationRuntime.handleMessage({
        text: `[WhatsApp de ${name}]: ${text}`,
        channel: 'whatsapp',
        context: { whatsapp: { jid, senderName: name } }
      });
      const reply = task.result?.speak || task.result?.visual || null;
      if (reply && whatsappChannel.connected && whatsappChannel.sock) {
        await whatsappChannel.sock.sendMessage(jid, { text: String(reply) });
      }
    } catch (err) {
      console.warn(`[jarvis-codex] WhatsApp watching error: ${err.message}`);
    } finally {
      _waMsgLock = false;
    }
  });

  const telegramChannel = new TelegramChannel({
    conversationRuntime,
    vault: credentialVault,
    dataDir,
    // Espejo de voz: si el usuario manda nota de voz, Jarvis responde con
    // nota de voz usando el mismo TTS del HUD (edge-tts, perfil por defecto).
    ttsProvider: createEdgeTTSProvider({ dataDir, vault: credentialVault, ...(options.voice || {}) }),
    ...(options.telegram || {})
  });

  // Notificaciones de corridas programadas de agentes: cola que drena el HUD
  // (voz) + envío a Telegram. Las corridas manuales no notifican — el usuario
  // ya está mirando cuando las dispara.
  const agentNotifications = [];
  // OJO: los listeners del EventBus reciben el sobre {id, type, payload} — los
  // datos de la corrida vienen en .payload.
  const queueAgentNotification = (event, status) => {
    const run = event.payload || {};
    if (run.trigger !== 'schedule') return;
    const text = status === 'failed'
      ? `El agente ${run.name} falló en su corrida programada: ${run.error || 'error desconocido'}.`
      : `Tu agente ${run.name} terminó su corrida. ${run.speak || 'Sin novedades que reportar.'}`;
    agentNotifications.push({ text, name: run.name, agentId: run.agentId, status, at: run.at });
    if (agentNotifications.length > 50) agentNotifications.splice(0, agentNotifications.length - 50);
    if (telegramChannel.token && telegramChannel.allowedUserId) {
      telegramChannel.sendMessage(telegramChannel.allowedUserId, text).catch(() => {});
    }
  };
  eventBus.on('agent_run_completed', (event) => queueAgentNotification(event, 'completed'));
  eventBus.on('agent_run_failed', (event) => queueAgentNotification(event, 'failed'));
  const drainAgentNotifications = () => agentNotifications.splice(0, agentNotifications.length);

  return {
    dataDir,
    eventBus,
    fileLogger,
    policyEngine,
    presenterRegistry,
    toolRegistry,
    taskRuntime,
    workingMemoryStore,
    memoryStore,
    knowledgeGraph,
    credentialVault,
    auditTrail,
    usageMeter,
    importLegacyCredentials: (importOptions = {}) => importLegacyCredentials({
      vault: credentialVault,
      ...importOptions
    }),
    googleAuthFactory,
    modelProvider,
    getActiveModel,
    setActiveModel,
    conversationRuntime,
    persona,
    agentStore,
    agentScheduler,
    drainAgentNotifications,
    telegramChannel,
    whatsappChannel
  };
}

module.exports = {
  createRuntime
};
