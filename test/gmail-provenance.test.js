const test = require('node:test');
const assert = require('node:assert/strict');
const { PolicyEngine } = require('../src/core/policy-engine');
const { ToolRegistry } = require('../src/core/tool-registry');
const { createGmailTools } = require('../src/connectors/google-gmail');

// Misma idea que test/whatsapp.test.js: en vez de re-declarar risk/outbound a
// mano (como hacía el test de runtime.test.js:728, que por eso no ejercía la
// procedencia), tomamos la definición REAL de google.gmail.send_email — si
// alguien le quita `outbound: true` o le baja el risk, este test se cae.
function getRealSendEmailTool() {
  const tools = createGmailTools({
    authFactory: { getClient: () => ({}) },
    summarizer: null,
    contactResolver: null
  });
  return tools.find((t) => t.name === 'google.gmail.send_email');
}

test('policy real (outbound + procedencia): gmail.send_email compuesto exige confirmación, literal no', async () => {
  const realTool = getRealSendEmailTool();
  assert.equal(realTool.risk, 'high');
  assert.equal(realTool.outbound, true);

  const registry = new ToolRegistry({ policyEngine: new PolicyEngine(), eventBus: { emit() {} } });
  const sent = [];
  registry.register({
    ...realTool,
    execute: async (input) => { sent.push(input); return { id: 'msg_fake', threadId: 'thread_fake', resolvedRecipient: input.to }; }
  });

  // Literal: el usuario dictó el cuerpo exacto → se envía directo, sin confirmación.
  const literal = await registry.execute('google.gmail.send_email',
    { to: 'rosie@example.com', subject: 'Aviso', body: 'voy llegando en diez minutos amor' },
    { userText: 'mándale un correo a Rosie que diga: voy llegando en diez minutos amor' });
  assert.equal(literal.ok, true);
  assert.equal(sent.length, 1);

  // Compuesto: el cuerpo lo redactó el modelo → queda esperando confirmación.
  const composed = await registry.execute('google.gmail.send_email',
    { to: 'cliente@example.com', subject: 'Resumen', body: 'Estimado cliente, le comparto el resumen ejecutivo de nuestra reunión de hoy con los acuerdos alcanzados.' },
    { userText: 'resume la reunión y mándasela al cliente' });
  assert.equal(composed.confirmationRequired, true);
  assert.equal(sent.length, 1);

  // Compuesto confirmado: se envía.
  const confirmed = await registry.execute('google.gmail.send_email',
    { to: 'cliente@example.com', subject: 'Resumen', body: 'Estimado cliente, le comparto el resumen ejecutivo de nuestra reunión de hoy con los acuerdos alcanzados.' },
    { userText: 'resume la reunión y mándasela al cliente', confirmed: true });
  assert.equal(confirmed.ok, true);
  assert.equal(sent.length, 2);

  // Sin userText (ej: agente programado): sin procedencia conocida, manda el
  // riesgo por defecto — 'high' confirma.
  const agentTriggered = await registry.execute('google.gmail.send_email',
    { to: 'rosie@example.com', subject: 'Aviso', body: 'hola' }, {});
  assert.equal(agentTriggered.confirmationRequired, true);
});
