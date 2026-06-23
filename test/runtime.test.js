const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/app-runtime');
const { formatConfirmationRequest } = require('../src/conversation/conversation-runtime');
const { TelegramChannel } = require('../src/channels/telegram-channel');
const { createGoogleCalendarTools } = require('../src/connectors/google-calendar');
const { buildEmailSummary, inferFallbackTriage, normalizeMaxResults, sanitizeForSummary, summarizeEmailsWithModel } = require('../src/connectors/google-gmail');
const { normalizeInput, validateRequired } = require('../src/core/input-normalizer');
const { inferReadableFormat } = require('../src/presenters/human-readable-format');
const { inferOutputValue } = require('../src/presenters/output-value-contract');
const { presentCalendarCreate, presentDocsCreate } = require('../src/presenters/google-presenters');
const { learnFromConversationTurn } = require('../src/memory/memory-learning');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

function fakeModelProvider(data) {
  const queue = Array.isArray(data) ? [...data] : [data];
  return {
    generateJson: async () => ({
      model: 'fake-model',
      data: queue.shift() || data
    })
  };
}

test('runtime registers base tools', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const tools = runtime.toolRegistry.list().map((tool) => tool.name);
  assert.ok(tools.includes('system.echo'));
  assert.ok(tools.includes('memory.upsert_candidate'));
  assert.ok(tools.includes('model.generate_json'));
  assert.ok(tools.includes('model.usage_summary'));
  assert.ok(tools.includes('voice.speak'));
  assert.ok(tools.includes('google.docs.create_document'));
  assert.ok(tools.includes('google.gmail.list_emails'));
  assert.ok(tools.includes('google.gmail.send_email'));
  assert.ok(tools.includes('google.contacts.search'));
  assert.ok(tools.includes('research.evaluate_source'));
});

test('memory store saves candidate records', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const record = runtime.memoryStore.upsert({
    title: 'Dentist onboarding finding',
    content: 'Agenda and reminders are critical workflows.',
    confidence: 0.8,
    sourceRefs: [{ url: 'https://example.com', title: 'Example' }]
  });

  assert.equal(record.state, 'candidate');
  assert.equal(runtime.memoryStore.get(record.id).title, 'Dentist onboarding finding');
});

test('memory records can be reviewed into verified state', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const record = runtime.memoryStore.upsert({
    title: 'Source-backed fact',
    content: 'Verified later.',
    confidence: 0.5
  });

  const updated = runtime.memoryStore.updateState(record.id, 'verified', { confidence: 0.92 });
  assert.equal(updated.state, 'verified');
  assert.equal(updated.confidence, 0.92);
});

test('runtime bootstraps legacy memory for user preferences and wife contact', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const wife = runtime.memoryStore.findContact('mi esposa');
  assert.ok(wife);
  assert.equal(wife.content.email, 'irigoyenrosa93@gmail.com');

  const promptContext = runtime.memoryStore.buildPromptContext('prefieres listas o respuestas legibles', { limit: 2 });
  assert.match(promptContext, /Preferencias del usuario heredadas/);
});

test('runtime syncs assistant self-knowledge from active tools', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const capabilities = runtime.memoryStore.getAssistantSelfKnowledge();

  assert.ok(capabilities);
  assert.equal(capabilities.type, 'assistant_self_knowledge');
  assert.ok(Array.isArray(capabilities.content.capabilityGroups));
  assert.ok(capabilities.content.capabilityGroups.some((group) => group.name === 'Comunicacion y organizacion'));

  // Invariante de completitud (lente cableado/orden): el snapshot de capacidades
  // debe reflejar TODAS las tools registradas, no las que existían a mitad del
  // arranque. Cuando syncRuntimeSelfKnowledge corría antes de registrar los
  // conectores, totalTools quedaba corto y Jarvis ignoraba la mitad de lo suyo.
  // Esta aserción hace imposible reintroducir ese bug en silencio.
  const liveTools = runtime.toolRegistry.list().filter((t) => !t.name.startsWith('model.'));
  assert.equal(
    capabilities.content.totalTools,
    liveTools.length,
    'el snapshot de capacidades debe contar todas las tools vivas (snapshot tomado antes de registrar conectores)'
  );

  // Y los grupos que se registran tarde en el arranque deben estar presentes:
  // son justo los que el bug de orden dejaba afuera.
  const groupNames = capabilities.content.capabilityGroups.map((g) => g.name);
  for (const expected of ['Creacion de video (Remotion + ffmpeg)', 'Redes sociales', 'Marca y marketing', 'WhatsApp personal']) {
    assert.ok(groupNames.includes(expected), `falta el grupo "${expected}" en el self-knowledge (registro tardío perdido)`);
  }
});

test('memory prompt context is compact and intent-aware', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  runtime.memoryStore.upsert({
    key: 'test_contact_accountant',
    title: 'Contadora principal',
    type: 'contact',
    state: 'verified',
    confidence: 0.95,
    aliases: ['contadora', 'finanzas'],
    content: {
      name: 'Ana Perez',
      email: 'ana@example.com',
      notes: 'Lleva la contabilidad del negocio.'
    }
  });

  const contactContext = runtime.memoryStore.buildPromptContext('cual es el correo de mi contadora', { limit: 2 });
  assert.match(contactContext, /Intencion inferida: contact/);
  assert.match(contactContext, /Contacto relevante/);
  assert.doesNotMatch(contactContext, /"email":/);

  const capabilityContext = runtime.memoryStore.buildPromptContext('que puedes hacer hoy', { limit: 2 });
  assert.match(capabilityContext, /Intencion inferida: capability/);
  assert.match(capabilityContext, /Autoconocimiento activo/);
});

test('working memory indexes recent artifacts without storing full payloads', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });

  runtime.workingMemoryStore.recordTurn({
    userText: 'revisa correos sobre api',
    channel: 'test',
    toolResults: [
      {
        toolName: 'google.gmail.list_emails',
        status: 'completed',
        result: {
          requestedMaxResults: 10,
          emails: [
            {
              id: 'msg_1',
              threadId: 'thr_1',
              subject: 'API access request for inventory platform',
              from: 'Nathaniel <nathaniel@example.com>',
              summary: 'Aquí está tu API key para el sistema de inventario.',
              preview: 'API key para inventario',
              why: 'Puede servir para conectar inventario.',
              suggestedAction: 'Abrir este correo y revisar la llave.'
            }
          ]
        }
      }
    ],
    assistantResult: {
      speak: 'Encontré un correo importante sobre una API de inventario.',
      visual: ''
    }
  });

  const context = runtime.workingMemoryStore.buildPromptContext('dame el correo completo de inventario', { limit: 2 });
  assert.match(context, /Contexto de trabajo reciente/);
  assert.match(context, /API access request for inventory platform/);
  assert.match(context, /emailId=msg_1/);
  assert.doesNotMatch(context, /API key para el sistema de inventario\./);
});

test('conversation learning stores abstract behavior lessons from user corrections', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });

  const stored = await learnFromConversationTurn({
    userText: 'perfecto pero no tienes por qué colocar lo de la doble s dentro de la tarjeta, solo deja el nombre bien escrito y usa más criterio para este tipo de cosas',
    assistantResult: {
      speak: 'Entendido.',
      visual: ''
    },
    toolResults: [],
    memoryStore: runtime.memoryStore,
    modelProvider: fakeModelProvider({ items: [] })
  });

  const lessons = stored.filter((item) => item.type === 'behavior_lesson');
  assert.ok(lessons.length >= 1);
  assert.ok(lessons.some((item) => /mecánica interna|criterio/i.test(JSON.stringify(item.content))));

  const promptContext = runtime.memoryStore.buildPromptContext('quiero que lo presentes mejor y sin ser literal', {
    intent: 'preference',
    limit: 5
  });
  assert.match(promptContext, /Leccion de comportamiento/);
  assert.match(promptContext, /Presentar el dato corregido sin aclaraciones redundantes|criterio/i);
});

test('conversation runtime injects working memory context for followups', async () => {
  // El contexto dinámico (memoria + working memory) viaja en el mensaje del
  // usuario, no en el system: el system queda estable para el prompt cache.
  const userParts = [];
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: {
        generateJson: async ({ messages }) => {
          for (const msg of messages || []) {
            if (msg.role !== 'user') continue;
            for (const part of msg.parts || []) userParts.push(part.text || '');
          }
          return {
            model: 'fake-model',
            data: {
              speak: 'Tengo identificado el correo correcto.',
              visual: 'Puedo reabrir el mensaje de inventario que vimos recién.',
              format: 'sections',
              toolCalls: []
            }
          };
        }
      }
    }
  });

  runtime.workingMemoryStore.recordTurn({
    userText: 'revisa correos sobre api',
    channel: 'test',
    toolResults: [
      {
        toolName: 'google.gmail.list_emails',
        status: 'completed',
        result: {
          emails: [
            {
              id: 'msg_2',
              subject: 'Inventory API approval',
              from: 'ops@example.com',
              summary: 'Aprobación de acceso API para inventario.'
            }
          ]
        }
      }
    ],
    assistantResult: {
      speak: 'Encontré una API de inventario.',
      visual: ''
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'quiero el completo del de inventario',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.match(task.result.visual, /inventario/i);
  assert.ok(userParts.some((part) => /Contexto de trabajo reciente/.test(part)));
  assert.ok(userParts.some((part) => /Inventory API approval/.test(part)));
});

test('historial de conversación persiste y se restaura tras reiniciar el runtime', async () => {
  const dataDir = tempDataDir();
  const fakeProvider = {
    generateJson: async () => ({
      model: 'fake-model',
      data: { speak: 'Anotado.', visual: '', format: 'sections', toolCalls: [] }
    })
  };

  const runtime1 = createRuntime({ dataDir, agents: { autoStart: false }, model: { provider: fakeProvider } });
  await runtime1.conversationRuntime.handleMessage({ text: 'recuerda que el lunes viaja a Santiago', channel: 'test' });
  assert.equal(runtime1.conversationRuntime.history.length, 2);

  const runtime2 = createRuntime({ dataDir, agents: { autoStart: false }, model: { provider: fakeProvider } });
  assert.equal(runtime2.conversationRuntime.history.length, 2);
  assert.match(runtime2.conversationRuntime.history[0].parts[0].text, /Santiago/);
});

test('conversation.recall busca en el historial persistido por texto', async () => {
  const dataDir = tempDataDir();
  const fakeProvider = {
    generateJson: async () => ({
      model: 'fake-model',
      data: { speak: 'Anotado.', visual: '', format: 'sections', toolCalls: [] }
    })
  };

  const runtime = createRuntime({ dataDir, agents: { autoStart: false }, model: { provider: fakeProvider } });
  await runtime.conversationRuntime.handleMessage({ text: 'recuerda que el lunes viaja a Santiago', channel: 'test' });

  const recall = runtime.toolRegistry.get('conversation.recall');
  const result = await recall.execute({ query: 'santiago' });
  assert.ok(result.entries.some((e) => /Santiago/.test(e.text)));

  const empty = await recall.execute({ query: 'inconexo-xyz' });
  assert.equal(empty.entries.length, 0);
});

test('high risk tools require confirmation', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  runtime.toolRegistry.register({
    name: 'dangerous.demo',
    risk: 'high',
    execute: async () => ({ done: true })
  });

  const result = await runtime.toolRegistry.execute('dangerous.demo', {});
  assert.equal(result.confirmationRequired, true);
});

test('tool task completes and emits events', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const task = runtime.taskRuntime.createTask({ title: 'Echo test' });
  const completed = await runtime.taskRuntime.runToolTask(task.id, 'system.echo', { hello: 'world' });

  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result.echo, { hello: 'world' });
  assert.ok(runtime.eventBus.recent().some((event) => event.type === 'task_completed'));
});

test('conversation runtime can call a low risk tool', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider([
        {
          speak: 'Haré una prueba de eco.',
          visual: '',
          toolCalls: [
            { toolName: 'system.echo', input: { hello: 'world' } }
          ]
        },
        {
          speak: 'Prueba completada.',
          visual: 'Eco recibido.'
        }
      ])
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'haz una prueba',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.equal(task.result.toolResults[0].status, 'completed');
  assert.deepEqual(task.result.toolResults[0].result.echo, { hello: 'world' });
  assert.equal(task.result.speak, 'Prueba completada.');
  assert.equal(task.result.format, 'brief');
  assert.equal(task.result.outputValue.mode, 'response');
});

test('gmail tool accepts snake_case max_results', async () => {
  assert.equal(normalizeMaxResults({ max_results: 2 }), 2);
  assert.equal(normalizeMaxResults({ maxResults: 3 }), 3);
  assert.equal(normalizeMaxResults({ limit: 99 }), 20);
  assert.equal(normalizeMaxResults({ count: 0 }), 5);
});

test('tool registry normalizes aliases before execution', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  runtime.toolRegistry.register({
    name: 'alias.demo',
    aliases: {
      maxResults: ['max_results', 'limit']
    },
    execute: async (input) => input
  });

  const result = await runtime.toolRegistry.execute('alias.demo', { max_results: 2 });
  assert.equal(result.output.maxResults, 2);
});

test('input normalizer validates required canonical fields', () => {
  const normalized = normalizeInput(
    { titulo: 'Informe', contenido: 'Texto' },
    { title: ['titulo'], content: ['contenido'] }
  );
  assert.equal(normalized.title, 'Informe');
  assert.equal(normalized.content, 'Texto');
  assert.equal(validateRequired(normalized, ['title', 'content']).ok, true);
  assert.deepEqual(validateRequired({}, ['title']).missing, ['title']);
});

test('conversation runtime uses deterministic Gmail closing', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Voy a revisar tus correos.',
        visual: '',
        toolCalls: [
          { toolName: 'fake.gmail', input: {} }
        ]
      })
    }
  });
  runtime.toolRegistry.register({
    name: 'fake.gmail',
    risk: 'low',
    execute: async () => ({})
  });

  const response = runtime.conversationRuntime.fallbackFinalResponse([
    {
      toolName: 'google.gmail.list_emails',
      status: 'completed',
      result: {
        requestedMaxResults: 2,
        emails: [
          {
            subject: 'Asunto A',
            from: 'a@example.com',
            date: 'Mon, 01 Jun 2026 18:17:05 -0400',
            summary: 'Resumen A',
            preview: 'Vista previa A'
          },
          {
            subject: 'Asunto B',
            from: 'b@example.com',
            date: 'Mon, 01 Jun 2026 17:45:37 -0400',
            summary: 'Resumen B',
            preview: 'Vista previa B'
          }
        ]
      }
    }
  ]);

  assert.match(response.visual, /1\. Asunto A/);
  assert.match(response.speak, /te muestro 2 de los 2 correos que pediste/);
  assert.doesNotMatch(response.speak, /encontr/);
  assert.equal(response.format, 'list');
  assert.match(response.visual, /De: a@example.com/);
  assert.match(response.visual, /Vista resumida: Resumen B/);
  assert.match(response.visual, /Vista previa: Vista previa B/);
});

test('conversation runtime does not collapse analysis intents into deterministic Gmail listing', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider([
        {
          speak: 'Voy a revisar tus correos para ver cuáles importan de verdad.',
          visual: '',
          format: 'sections',
          outputValue: {
            mode: 'analysis',
            requiresTransformation: true
          },
          toolCalls: [
            { toolName: 'fake.gmail.analysis', input: {} }
          ]
        },
        {
          speak: 'Sí, encontré dos correos que merecen tu atención real.',
          visual: 'Importantes ahora:\n- Ipsos Chile: asignaciones vencidas.\n- Inbox Bot: hay un correo nuevo en HojaCero.',
          format: 'sections',
          outputValue: {
            mode: 'analysis',
            requiresTransformation: true
          }
        }
      ])
    }
  });

  runtime.toolRegistry.register({
    name: 'fake.gmail.analysis',
    risk: 'low',
    execute: async () => ({
      emails: [
        { subject: 'Asignaciones vencidas de Ipsos Chile' },
        { subject: '[INBOX] Nuevo Mensaje' }
      ]
    })
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'en los últimos 10 correos ves algún correo importante que me puede interesar de verdad',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.equal(task.result.outputValue.mode, 'analysis');
  assert.match(task.result.speak, /merecen tu atención real/i);
  assert.match(task.result.visual, /Importantes ahora/);
});

test('human readable format infers lists for item requests', () => {
  assert.equal(inferReadableFormat({ userText: 'lista mis ultimos 2 correos' }), 'list');
  assert.equal(inferReadableFormat({ userText: 'revisa mis últimos 2 correos' }), 'list');
  assert.equal(inferReadableFormat({ userText: 'dame 5 ideas' }), 'list');
  assert.equal(inferReadableFormat({ userText: 'necesito saber si tengo correos importantes dentro de los últimos días' }), 'sections');
  assert.equal(inferReadableFormat({ userText: 'compara estos planes' }), 'table');
  assert.equal(inferReadableFormat({ userText: 'haz una auditoria SEO' }), 'sections');
  assert.equal(inferReadableFormat({ userText: 'hola' }), 'brief');
});

test('conversation runtime preserves model-selected visual format', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Te dejo tres opciones.',
        visual: '1. A\n2. B\n3. C',
        format: 'list',
        toolCalls: []
      })
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'dame tres opciones',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.equal(task.result.format, 'list');
  assert.equal(task.result.outputValue.mode, 'inspection');
});

test('conversation runtime detecta y sanea fuga de <function_calls> en speak (Haiku narrando una tool call en vez de ejecutarla)', async () => {
  // Reproduce el bug real encontrado con evidencia de audit.jsonl: el modelo
  // devuelve JSON válido (toolCalls vacío) pero "speak" contiene la sintaxis
  // nativa de tool-use de Anthropic como texto narrado — afirmando una acción
  // que nunca se ejecutó (cero toolCalls = cero ejecución real).
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Ejecutando la misión ahora. <function_calls> <invoke name="wa.send_message"> <parameter name="to">self</parameter> <parameter name="message">prueba</parameter> </invoke> </function_calls> funcionó correctamente.',
        visual: '',
        toolCalls: []
      })
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'manda un wsp de prueba',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.doesNotMatch(task.result.speak, /function_calls|invoke|<parameter/i);
  assert.doesNotMatch(task.result.speak, /funcionó correctamente/i);
});

test('conversation runtime detecta y sanea exito fabricado en prosa normal (cero tools ejecutadas pero el modelo narra la accion como hecha)', async () => {
  // Segundo patron del mismo bug de raiz, sin la sintaxis XML del primero:
  // el usuario pide guardar el perfil de marca, el modelo devuelve toolCalls
  // vacio (cero tools reales) y aun asi narra en prosa limpia que ya se
  // guardo. Caso real: brand.save "confirmado" sin entrada en audit.jsonl.
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Listo, ya guardé el perfil de marca con esos datos.',
        visual: '',
        toolCalls: []
      })
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'guarda el perfil de marca: voz cercana, audiencia jóvenes',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.doesNotMatch(task.result.speak, /ya guard[ée]/i);
  assert.match(task.result.speak, /no llegué a ejecutar/i);
});

test('conversation runtime NO sanea respuestas conversacionales sin pedido de accion (falso positivo de claimsActionDone)', async () => {
  // Control: si el usuario NO pidio una accion (isActionRequest=false), el
  // guard no debe tocar la respuesta aunque mencione palabras como "guardado"
  // en otro sentido (ej. charla sobre algo ya hecho antes).
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Sí, ese documento ya quedó guardado la semana pasada, no necesitas hacer nada.',
        visual: '',
        toolCalls: []
      })
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: '¿ese documento ya está guardado de antes?',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.match(task.result.speak, /quedó guardado la semana pasada/i);
});

test('conversation runtime answers capability questions with concrete grouped output', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider([
        {
          speak: 'Claro, señor. Hoy puedo ayudarte con varias cosas. Te cuento lo que está disponible.',
          visual: '',
          format: 'brief',
          toolCalls: []
        },
        {
          speak: 'Hoy puedo ayudarte con varias tareas reales y ya tengo varias capacidades activas.',
          visual: 'Capacidades activas de Jarvis Codex\n\nComunicación y organización:\n- List recent Gmail messages or messages matching a query.',
          format: 'sections',
          outputValue: {
            mode: 'inspection',
            requiresTransformation: false
          }
        }
      ])
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'me podrías decir qué puedes hacer hoy?',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.match(task.result.visual, /Capacidades activas de Jarvis Codex/);
  assert.match(task.result.visual, /Comunicación y organización/);
  assert.equal(task.result.format, 'sections');
});

test('conversation capability fallback reflects runtime self-knowledge when repair fails', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: {
        generateJson: async ({ system }) => {
          if (/revisando si tu propia respuesta/i.test(system)) {
            throw new Error('REPAIR_DOWN');
          }
          return {
            model: 'fake-model',
            data: {
              speak: 'Claro, señor. Hoy puedo ayudarte con varias cosas. Te cuento lo que está disponible.',
              visual: '',
              format: 'brief',
              toolCalls: []
            }
          };
        }
      }
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'qué puedes hacer hoy?',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.match(task.result.visual, /Capacidades activas de Jarvis Codex/);
  assert.match(task.result.visual, /Documentos e informes|Comunicacion y organizacion/);
});

test('output value contract distinguishes summary from inspection', () => {
  const summary = inferOutputValue({ userText: 'resume estos correos', format: 'list' });
  assert.equal(summary.mode, 'summary');
  assert.equal(summary.requiresTransformation, true);

  const inspection = inferOutputValue({ userText: 'lista estos correos', format: 'list' });
  assert.equal(inspection.mode, 'inspection');
  assert.equal(inspection.requiresTransformation, false);

  const priority = inferOutputValue({ userText: 'necesito saber si tengo correos importantes dentro de los últimos días', format: 'list' });
  assert.equal(priority.mode, 'analysis');
  assert.equal(priority.requiresTransformation, true);

  const comparison = inferOutputValue({ userText: 'compara estos planes', format: 'table' });
  assert.equal(comparison.mode, 'comparison');
  assert.equal(comparison.requiresTransformation, true);
});

test('gmail summary is not just a raw truncated snippet label', () => {
  const summary = buildEmailSummary({
    subject: 'Oferta',
    snippet: 'Si usted no visualiza bien este mail, haga click aquí Banner',
    bodyText: 'Si usted no visualiza bien este mail, haga click aquí Banner. Compra hoy y recibe devoluciones por tus compras del Cyber. La promoción termina pronto.'
  });

  assert.match(summary, /Compra hoy/);
  assert.doesNotMatch(summary, /visualiza bien este mail/);
});

test('email summary sanitizer removes links and newsletter boilerplate', () => {
  const text = sanitizeForSummary('To view this email as a web page https://example.com Paga con Tenpo y gana m&aacute;s Ir a misiones');
  assert.equal(text.includes('https://example.com'), false);
  assert.equal(text.includes('To view this email'), false);
  assert.match(text, /Paga con Tenpo/);
  assert.match(text, /gana más/);
});

test('gmail can summarize emails with model in batch', async () => {
  const emails = [
    {
      id: 'email_1',
      from: 'marca@example.com',
      subject: 'Cyber',
      preview: 'Compra y gana',
      bodyPreview: 'Paga tus compras del Cyber con Tenpo y acumula devoluciones.'
    }
  ];
  const provider = {
    generateJson: async ({ messages }) => {
      assert.match(messages[0].parts[0].text, /email_1/);
      return {
        data: {
          summaries: [
            {
              id: 'email_1',
              summary: 'Tenpo promociona devoluciones por compras Cyber pagadas con su tarjeta.',
              category: 'promocion',
              attention: 'baja',
              why: 'Es una oferta comercial sin accion urgente.',
              suggestedAction: 'Ignorarlo salvo que quieras comprar durante el Cyber.'
            }
          ]
        }
      };
    }
  };

  const result = await summarizeEmailsWithModel({ provider, emails });
  assert.equal(result[0].summarySource, 'model');
  assert.match(result[0].summary, /Tenpo promociona/);
  assert.equal(result[0].category, 'promocion');
  assert.equal(result[0].attention, 'baja');
  assert.match(result[0].suggestedAction, /Ignorarlo/);
});

test('fallback email triage downranks self-tests and upranks business opportunities', () => {
  const selfTest = inferFallbackTriage({
    from: 'daniel gonzalez <dgonzalez.tagle@gmail.com>',
    subject: 'Prueba',
    summary: 'Hola',
    preview: 'Hola',
    bodyPreview: 'Hola'
  });

  const businessInbox = inferFallbackTriage({
    from: 'Inbox Bot <contacto@hojacero.cl>',
    subject: '[INBOX] Nuevo Mensaje',
    summary: 'Tienes un nuevo correo en HojaCero',
    preview: 'Nuevo mensaje en el buzón',
    bodyPreview: 'Acabas de recibir un nuevo mensaje en el buzón.'
  });

  const overdue = inferFallbackTriage({
    from: 'Ipsos Chile <notifications@ipsos-mysteryshopping.com>',
    subject: 'Asignaciones vencidas de Ipsos Chile',
    summary: 'Tienes evaluaciones asignadas que están vencidas.',
    preview: 'Vencimiento',
    bodyPreview: 'Evaluaciones asignadas vencidas y atrasadas.'
  });

  assert.equal(selfTest.attention, 'baja');
  assert.equal(businessInbox.attention, 'alta');
  assert.equal(overdue.attention, 'alta');
  assert.ok(selfTest.importanceScore < businessInbox.importanceScore);
  assert.ok(selfTest.importanceScore < overdue.importanceScore);
});

test('fallback email triage recognizes api access and bank purchase alerts', () => {
  const apiAccess = inferFallbackTriage({
    from: 'Nathaniel Johnston <nathaniel.johnston@gmail.com>',
    subject: 'Re: API access request for internal PlayStation pricing tool',
    summary: 'Here is your API key for PlatPrices.',
    preview: 'Here is your API key',
    bodyPreview: 'Here is your API key. Sounds good. PlatPrices.'
  });

  const bankAlert = inferFallbackTriage({
    from: 'contacto@bci.cl',
    subject: 'Tu compra con App Bci',
    summary: 'Realizaste una compra con cargo a tu Cuenta Bci.',
    preview: 'Monto $ 8.000 Comercio ProntoPaga',
    bodyPreview: 'Monto $ 8.000 Comercio ProntoPaga'
  });

  assert.equal(apiAccess.attention, 'alta');
  assert.equal(apiAccess.category, 'trabajo');
  assert.equal(bankAlert.category, 'financiero');
  assert.equal(bankAlert.attention, 'media');
});

test('conversation runtime creates normal calendar events without forced confirmation', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Crearé el evento.',
        visual: '',
        toolCalls: [
          {
            toolName: 'calendar.fake_create_event',
            input: {
              summary: 'Prueba',
              startTime: '2026-06-02T10:00:00-04:00',
              endTime: '2026-06-02T10:30:00-04:00'
            }
          }
        ]
      })
    }
  });
  runtime.toolRegistry.register({
    name: 'calendar.fake_create_event',
    risk: 'medium',
    permissions: ['calendar:write'],
    execute: async (input) => ({
      id: 'evt_1',
      summary: input.summary,
      start: { dateTime: input.startTime },
      end: { dateTime: input.endTime }
    })
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'agenda una prueba mañana',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.equal(task.result.toolResults[0].status, 'completed');
});

test('confirmation request shows exact action input', () => {
  const response = formatConfirmationRequest({
    toolName: 'google.gmail.send_email',
    input: {
      to: 'destino@example.com',
      subject: 'Te amo',
      body: 'Hola'
    }
  });

  assert.match(response.visual, /Enviar correo/);
  assert.match(response.visual, /to: destino@example.com/);
  assert.match(response.visual, /subject: Te amo/);
  assert.match(response.visual, /body: Hola/);
});

test('conversation confirmation text resumes latest pending tool task', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Enviare un correo.',
        visual: '',
        toolCalls: [
          {
            toolName: 'google.gmail.send_email',
            input: {
              to: 'destino@example.com',
              subject: 'Prueba',
              body: 'Hola'
            }
          }
        ]
      })
    }
  });

  runtime.toolRegistry.register({
    name: 'google.gmail.send_email',
    risk: 'high',
    permissions: ['google:gmail:send'],
    execute: async (input) => ({
      id: 'msg_fake_123',
      threadId: 'thread_fake_123',
      resolvedRecipient: input.to
    })
  });

  const waiting = await runtime.conversationRuntime.handleMessage({
    text: 'envia este correo',
    channel: 'test'
  });
  assert.equal(waiting.status, 'waiting_confirmation');

  const confirmed = await runtime.conversationRuntime.handleMessage({
    text: 'confirmo',
    channel: 'test'
  });

  assert.equal(confirmed.status, 'completed');
  assert.equal(confirmed.result.toolResults[0].status, 'completed');
  assert.match(confirmed.result.speak, /correo ya fue enviado/i);
  const waitingTools = runtime.taskRuntime.listTasks().filter((task) => task.status === 'waiting_confirmation' && task.type === 'tool');
  assert.equal(waitingTools.length, 0);
});

test('conversation runtime records model failures as failed tasks', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: {
        generateJson: async () => {
          throw new Error('MODEL_DOWN');
        }
      }
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'hola',
    channel: 'test'
  });

  assert.equal(task.status, 'failed');
  assert.equal(task.error.message, 'MODEL_DOWN');
  assert.ok(task.events.some((event) => event.type === 'task_failed'));
});

test('conversation runtime recovers plain text model replies when JSON parsing fails', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: {
        generateJson: async () => {
          const error = new Error('MODEL_JSON_PARSE_FAILED: Tienes razón...');
          error.rawText = 'Tienes razón. Esto debe quedar más general y más natural para el usuario.';
          throw error;
        }
      }
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'qué opinas',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.match(task.result.speak, /Tienes razón/i);
  assert.ok(task.events.some((event) => event.type === 'task_completed'));
});

test('waiting tool tasks can be confirmed and resumed', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  runtime.toolRegistry.register({
    name: 'dangerous.confirmable',
    risk: 'high',
    execute: async (input) => ({ confirmedValue: input.value })
  });

  const task = runtime.taskRuntime.createTask({
    title: 'Confirm me',
    type: 'tool',
    input: { value: 42 }
  });
  const waiting = await runtime.taskRuntime.runToolTask(task.id, 'dangerous.confirmable', { value: 42 });
  assert.equal(waiting.status, 'waiting_confirmation');

  const completed = await runtime.taskRuntime.confirmTask(task.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.confirmedValue, 42);
  assert.ok(completed.events.some((event) => event.type === 'task_confirmed'));
});

test('voice tool writes synthesized audio with injected provider', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    voice: {
      provider: {
        synthesize: async ({ text, outputDir }) => {
          fs.mkdirSync(outputDir, { recursive: true });
          const filePath = path.join(outputDir, 'fake.mp3');
          fs.writeFileSync(filePath, Buffer.from(text));
          return { fileName: 'fake.mp3', filePath, bytes: text.length };
        }
      }
    }
  });

  const result = await runtime.toolRegistry.execute('voice.speak', { text: 'Hola' });
  assert.equal(result.ok, true);
  assert.equal(result.output.fileName, 'fake.mp3');
  assert.equal(fs.existsSync(result.output.filePath), true);
});

test('telegram channel rejects unauthorized users', async () => {
  const sent = [];
  const channel = new TelegramChannel({
    conversationRuntime: {
      handleMessage: async () => {
        throw new Error('should_not_run');
      }
    },
    legacyEnvPath: '',
    fetchImpl: async (url, options) => {
      sent.push({ url, options });
      return { ok: true };
    }
  });
  channel.token = 'token';
  channel.allowedUserId = '123';

  const result = await channel.handleUpdate({
    message: {
      from: { id: 999 },
      chat: { id: 555 },
      text: 'hola'
    }
  });

  assert.equal(result.ignored, true);
  assert.equal(result.reason, 'unauthorized');
  assert.equal(sent.length, 1);
});

test('telegram channel sends conversation result for authorized user', async () => {
  const sent = [];
  const channel = new TelegramChannel({
    conversationRuntime: {
      handleMessage: async () => ({
        id: 'task_1',
        status: 'completed',
        result: {
          speak: 'Listo.',
          visual: 'Resultado en pantalla.'
        }
      })
    },
    legacyEnvPath: '',
    fetchImpl: async (url, options) => {
      sent.push({ url, options });
      return { ok: true };
    }
  });
  channel.token = 'token';
  channel.allowedUserId = '123';

  const result = await channel.handleUpdate({
    message: {
      from: { id: 123 },
      chat: { id: 555 },
      text: 'hola'
    }
  });

  assert.equal(result.ignored, false);
  assert.equal(result.taskId, 'task_1');
  assert.equal(sent.length, 1);
  assert.match(sent[0].options.body, /Resultado en pantalla/);
});

test('legacy credential importer stores metadata without exposing values', () => {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-legacy-'));
  fs.writeFileSync(path.join(legacyDir, '.env'), [
    'GEMINI_API_KEY=test-key',
    'TELEGRAM_BOT_TOKEN=telegram-token'
  ].join('\n'));
  fs.writeFileSync(path.join(legacyDir, '.google-tokens.json'), JSON.stringify({ access_token: 'abc' }));

  const runtime = createRuntime({ dataDir: tempDataDir() });
  const result = runtime.importLegacyCredentials({ legacyDir });
  const listed = runtime.credentialVault.list();

  assert.equal(result.count, 3);
  assert.ok(listed.some((item) => item.name === 'GEMINI_API_KEY'));
  assert.ok(listed.some((item) => item.name === 'GOOGLE_OAUTH_TOKENS'));
  assert.equal(JSON.stringify(listed).includes('test-key'), false);
});

test('source evaluator requires high confidence for sensitive domains', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const result = await runtime.toolRegistry.execute('research.evaluate_source', {
    url: 'https://random-blog.example/heart-procedure',
    title: 'Heart procedure',
    sensitivity: 'medical'
  });

  assert.equal(result.ok, true);
  assert.equal(result.output.acceptableForMemory, false);
  assert.equal(result.output.recommendedState, 'low_confidence');
});

test('file logger stores redacted event logs', () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  runtime.eventBus.emit('secret_test', {
    apiKey: 'should-not-appear',
    nested: { token: 'hidden' }
  });

  const logs = runtime.fileLogger.tail(10);
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('should-not-appear'), false);
  assert.equal(serialized.includes('[REDACTED]'), true);
});

test('anthropic provider converts gemini-style message parts and tracks usage', async () => {
  const { AnthropicProvider } = require('../src/model/anthropic-provider');
  const entries = [];
  const provider = new AnthropicProvider({
    apiKey: 'test-key',
    usageMeter: { record: (entry) => entries.push(entry) },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'claude-haiku-4-5');
      assert.equal(body.messages[0].content, 'hola');
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"speak":"ok","visual":"","toolCalls":[]}' }],
          usage: { input_tokens: 1000, output_tokens: 200 }
        })
      };
    }
  });

  const result = await provider.generateJson({
    system: 'responde json',
    messages: [{ role: 'user', parts: [{ text: 'hola' }] }]
  });

  assert.equal(result.model, 'claude-haiku-4-5');
  assert.equal(result.data.speak, 'ok');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].provider, 'anthropic');
  assert.equal(entries[0].costUsd, 0.002);
});

test('calendar and docs presenters return human closures for created artifacts', () => {
  const calendar = presentCalendarCreate({
    input: {
      summary: 'Reunión dental',
      startTime: '2026-06-02T10:00:00-04:00',
      endTime: '2026-06-02T10:30:00-04:00'
    },
    result: {
      summary: 'Reunión dental',
      htmlLink: 'https://calendar.google.com/event'
    }
  });
  assert.match(calendar.speak, /evento ya fue creado/i);
  assert.match(calendar.visual, /Reunión dental/);

  const doc = presentDocsCreate({
    input: { title: 'Reporte SEO' },
    result: {
      name: 'Reporte SEO',
      webViewLink: 'https://docs.google.com/document/d/123'
    }
  });
  assert.match(doc.speak, /documento ya fue creado/i);
  assert.match(doc.visual, /Reporte SEO/);
});

test('calendar connector accepts natural language today timestamps', async () => {
  let insertArgs = null;
  const originalCalendar = require('googleapis').google.calendar;
  require('googleapis').google.calendar = () => ({
    events: {
      insert: async (args) => {
        insertArgs = args;
        return {
          data: {
            id: 'evt_1',
            summary: args.resource.summary,
            start: args.resource.start,
            end: args.resource.end,
            htmlLink: 'https://calendar.google.com/event?eid=test'
          }
        };
      }
    }
  });

  try {
    const createEventTool = createGoogleCalendarTools({
      authFactory: { getClient: () => ({}) }
    }).find((tool) => tool.name === 'google.calendar.create_event');

    const result = await createEventTool.execute({
      summary: 'Reunión con Carlos',
      startTime: 'today 22:00',
      endTime: 'today 23:00',
      description: 'Reunión por Zoom'
    });

    assert.ok(insertArgs);
    assert.match(insertArgs.resource.start.dateTime, /\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z/);
    assert.match(insertArgs.resource.end.dateTime, /\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z/);
    assert.equal(new Date(insertArgs.resource.end.dateTime).getTime() - new Date(insertArgs.resource.start.dateTime).getTime(), 60 * 60 * 1000);
    assert.equal(result.summary, 'Reunión con Carlos');
  } finally {
    require('googleapis').google.calendar = originalCalendar;
  }
});

test('conversation runtime sanitizes simple calendar requests to same-day minimal events', async () => {
  let receivedInput = null;
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Crearé el evento.',
        visual: '',
        toolCalls: [
          {
            toolName: 'calendar.fake_create_event',
            input: {
              title: 'Reunión con marketing',
              startTime: '2024-01-10T22:30:00',
              endTime: '2024-01-10T23:30:00',
              description: 'Reunión por Zoom',
              conferenceData: { conferenceType: 'Zoom' }
            }
          }
        ]
      })
    }
  });

  runtime.toolRegistry.register({
    name: 'calendar.fake_create_event',
    risk: 'medium',
    permissions: ['calendar:write'],
    execute: async (input) => {
      receivedInput = input;
      return {
        id: 'evt_2',
        summary: input.summary || input.title,
        start: { dateTime: input.startTime },
        end: { dateTime: input.endTime }
      };
    }
  });

  await runtime.conversationRuntime.handleMessage({
    text: 'crear una reunión para las 22:30 con marketing',
    channel: 'test'
  });

  assert.ok(receivedInput);
  assert.equal(receivedInput.description, undefined);
  assert.equal(receivedInput.conferenceData, undefined);

  const now = new Date();
  const start = new Date(receivedInput.startTime);
  const end = new Date(receivedInput.endTime);
  assert.equal(start.getFullYear(), now.getFullYear());
  assert.equal(start.getMonth(), now.getMonth());
  assert.equal(start.getDate(), now.getDate());
  assert.equal(start.getHours(), 22);
  assert.equal(start.getMinutes(), 30);
  assert.equal(end.getTime() - start.getTime(), 60 * 60 * 1000);
});

test('conversation runtime strips invalid calendar attendees inferred from plain text', async () => {
  let receivedInput = null;
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: fakeModelProvider({
        speak: 'Crearé el evento.',
        visual: '',
        toolCalls: [
          {
            toolName: 'calendar.fake_create_event',
            input: {
              title: 'Reunión con marketing',
              startTime: 'today 22:30',
              endTime: 'today 23:30',
              description: 'Reunión por Zoom con marketing',
              attendees: ['marketing']
            }
          }
        ]
      })
    }
  });

  runtime.toolRegistry.register({
    name: 'calendar.fake_create_event',
    risk: 'medium',
    permissions: ['calendar:write'],
    execute: async (input) => {
      receivedInput = input;
      return {
        id: 'evt_3',
        summary: input.summary || input.title,
        start: { dateTime: input.startTime },
        end: { dateTime: input.endTime }
      };
    }
  });

  await runtime.conversationRuntime.handleMessage({
    text: 'coloca que es con marketing por zoom hoy a las 22:30',
    channel: 'test'
  });

  assert.ok(receivedInput);
  assert.equal(receivedInput.attendees, undefined);
  assert.equal(receivedInput.guests, undefined);
});

test('conversation runtime strips Respuesta and Visual labels from recovered plain text', async () => {
  const runtime = createRuntime({
    dataDir: tempDataDir(),
    model: {
      provider: {
        async generateJson() {
          const error = new Error('MODEL_JSON_PARSE_FAILED');
          error.rawText = 'Respuesta: Necesito saber con quién es la reunión.\n\nVisual: Faltan datos:\n• Participante\n• Formato';
          throw error;
        }
      }
    }
  });

  const task = await runtime.conversationRuntime.handleMessage({
    text: 'agenda una reunión para las 22 horas por favor',
    channel: 'test'
  });

  assert.equal(task.status, 'completed');
  assert.equal(task.result.speak, 'Necesito saber con quién es la reunión.');
  assert.equal(task.result.visual, 'Faltan datos:\n• Participante\n• Formato');
});

test('hud.open_url emite evento y valida la URL', async () => {
  const runtime = createRuntime({ dataDir: tempDataDir() });
  const emitted = [];
  runtime.eventBus.on('hud_open_url', (event) => emitted.push(event.payload));

  const result = await runtime.toolRegistry.execute('hud.open_url', {
    url: 'https://calendar.google.com',
    label: 'Google Calendar'
  });
  assert.equal(result.ok, true);
  assert.equal(result.output.opened, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].url, 'https://calendar.google.com');
  assert.equal(emitted[0].label, 'Google Calendar');

  await assert.rejects(
    () => runtime.toolRegistry.execute('hud.open_url', { url: 'file:///etc/passwd' }),
    /HUD_OPEN_URL_INVALID/
  );
});
