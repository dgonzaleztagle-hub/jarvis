const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/app-runtime');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-codex-test-'));
}

// Reproduce el caso real: el usuario pide enviar un wsp a Rosa (queda
// pendiente de confirmación), luego pide OTRO wsp a un destinatario distinto
// (queda OTRA pendiente, sin cancelar la primera), y finalmente confirma "el
// de Rosa". La primera NO debe perderse en silencio, y debe poder resolverse
// aunque no sea "la última" pendiente.
test('una acción pendiente nueva no cancela en silencio una pendiente previa distinta', async () => {
  const dataDir = tempDataDir();
  let call = 0;
  let rosaTaskId = null;

  const provider = {
    generateJson: async ({ messages }) => {
      call++;
      if (call === 1) {
        return {
          model: 'fake-model',
          data: {
            speak: 'Le mando un wsp a Rosa.',
            visual: '',
            toolCalls: [{ toolName: 'wa.send_message', input: { to: 'Rosa Irigoyen', message: 'Hola Rosa, ¿cómo estás?' } }]
          }
        };
      }
      if (call === 2) {
        return {
          model: 'fake-model',
          data: {
            speak: 'Le mando un wsp a Rossie.',
            visual: '',
            toolCalls: [{ toolName: 'wa.send_message', input: { to: 'Rossie', message: 'Hola, ¿qué tal?' } }]
          }
        };
      }
      if (call === 3) {
        const promptText = messages.map((m) => (m.parts || []).map((p) => p.text || '').join(' ')).join('\n');
        assert.match(promptText, /\[Acciones pendientes de confirmación\]/);
        const match = promptText.match(/id: (task_\S+) \| herramienta: wa\.send_message \| datos:[^\n]*Rosa Irigoyen/);
        assert.ok(match, 'debe listar la acción pendiente para Rosa Irigoyen con su id');
        rosaTaskId = match[1];
        return {
          model: 'fake-model',
          data: {
            speak: 'Confirmado, le mando el mensaje a Rosa.',
            visual: '',
            toolCalls: [{ toolName: 'tasks.confirm_pending', input: { id: rosaTaskId } }]
          }
        };
      }
      // Ronda de continuación tras ejecutar tasks.confirm_pending.
      return {
        model: 'fake-model',
        data: { speak: 'Listo, le mandé el mensaje a Rosa.', visual: '', toolCalls: [] }
      };
    }
  };

  const runtime = createRuntime({ dataDir, model: { provider } });
  runtime.toolRegistry.register({
    name: 'wa.send_message',
    risk: 'medium',
    outbound: true,
    permissions: [],
    execute: async (input) => ({ sent: true, to: input.to, message: input.message })
  });

  const turn1 = await runtime.conversationRuntime.handleMessage({
    text: 'mándale un wsp a Rosa preguntándole cómo está',
    channel: 'test'
  });
  assert.equal(turn1.status, 'waiting_confirmation');

  const turn2 = await runtime.conversationRuntime.handleMessage({
    text: 'ahora mándale uno a Rossie también',
    channel: 'test'
  });
  assert.equal(turn2.status, 'waiting_confirmation');

  // Ambas quedan pendientes — la segunda NO supersedea a la primera porque
  // son acciones distintas (distinto destinatario/contenido).
  const pendingAfterTurn2 = runtime.taskRuntime
    .listTasks()
    .filter((t) => t.status === 'waiting_confirmation' && t.type === 'tool');
  assert.equal(pendingAfterTurn2.length, 2);

  const turn3 = await runtime.conversationRuntime.handleMessage({
    text: 'sí, confirma el de Rosa',
    channel: 'test'
  });
  assert.equal(turn3.status, 'completed');

  const waTasks = runtime.taskRuntime.listTasks().filter((t) => t.toolName === 'wa.send_message');
  const rosaTask = waTasks.find((t) => t.input?.to === 'Rosa Irigoyen');
  const rossieTask = waTasks.find((t) => t.input?.to === 'Rossie');

  assert.equal(rosaTask.id, rosaTaskId);
  assert.equal(rosaTask.status, 'completed');
  assert.equal(rosaTask.result.sent, true);
  // La de Rossie sigue intacta, esperando — nadie la canceló por error.
  assert.equal(rossieTask.status, 'waiting_confirmation');
});

// Con UNA sola pendiente, "sí/dale/ok" sigue siendo el atajo determinista
// (sin pasar por el modelo) — no debe romperse por el cambio.
test('con una sola acción pendiente, "confirmo" la resuelve directo sin ambigüedad', async () => {
  const dataDir = tempDataDir();
  const provider = {
    generateJson: async () => ({
      model: 'fake-model',
      data: {
        speak: 'Le mando un wsp a Rosa.',
        visual: '',
        toolCalls: [{ toolName: 'wa.send_message', input: { to: 'Rosa Irigoyen', message: 'Hola Rosa, ¿cómo estás?' } }]
      }
    })
  };

  const runtime = createRuntime({ dataDir, model: { provider } });
  runtime.toolRegistry.register({
    name: 'wa.send_message',
    risk: 'medium',
    outbound: true,
    permissions: [],
    execute: async (input) => ({ sent: true, to: input.to, message: input.message })
  });

  const turn1 = await runtime.conversationRuntime.handleMessage({
    text: 'mándale un wsp a Rosa preguntándole cómo está',
    channel: 'test'
  });
  assert.equal(turn1.status, 'waiting_confirmation');

  const turn2 = await runtime.conversationRuntime.handleMessage({ text: 'confirmo', channel: 'test' });
  assert.equal(turn2.status, 'completed');

  const waTask = runtime.taskRuntime.listTasks().find((t) => t.toolName === 'wa.send_message');
  assert.equal(waTask.status, 'completed');
});

// Re-emitir EXACTAMENTE la misma acción (mismo tool + mismos inputs) sigue
// deduplicando: no se apilan dos confirmaciones idénticas.
test('re-emitir la misma acción exacta deduplica la pendiente anterior', async () => {
  const dataDir = tempDataDir();
  const provider = {
    generateJson: async () => ({
      model: 'fake-model',
      data: {
        speak: 'Le mando un wsp a Rosa.',
        visual: '',
        toolCalls: [{ toolName: 'wa.send_message', input: { to: 'Rosa Irigoyen', message: 'Hola Rosa, ¿cómo estás?' } }]
      }
    })
  };

  const runtime = createRuntime({ dataDir, model: { provider } });
  runtime.toolRegistry.register({
    name: 'wa.send_message',
    risk: 'medium',
    outbound: true,
    permissions: [],
    execute: async (input) => ({ sent: true, to: input.to, message: input.message })
  });

  await runtime.conversationRuntime.handleMessage({
    text: 'mándale un wsp a Rosa preguntándole cómo está',
    channel: 'test'
  });
  await runtime.conversationRuntime.handleMessage({
    text: 'mándale un wsp a Rosa preguntándole cómo está',
    channel: 'test'
  });

  const waTasks = runtime.taskRuntime.listTasks().filter((t) => t.toolName === 'wa.send_message');
  const waiting = waTasks.filter((t) => t.status === 'waiting_confirmation');
  const superseded = waTasks.filter((t) => t.status === 'superseded');
  assert.equal(waiting.length, 1);
  assert.equal(superseded.length, 1);
});
