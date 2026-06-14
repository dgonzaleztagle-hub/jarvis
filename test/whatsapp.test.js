const { test } = require('node:test');
const assert = require('node:assert');
const { PolicyEngine } = require('../src/core/policy-engine');
const { ToolRegistry } = require('../src/core/tool-registry');
const { toJid, extractText } = require('../src/channels/whatsapp-channel');

test('policy real (outbound + procedencia): wa.send_message compuesto exige confirmación, literal no', async () => {
  // Sin reglas ad-hoc: el mecanismo genérico outbound+provenance del
  // policy-engine (mismo que rige gmail.send_email) es el único que decide.
  const registry = new ToolRegistry({ policyEngine: new PolicyEngine(), eventBus: { emit() {} } });
  const sent = [];
  registry.register({
    name: 'wa.send_message',
    risk: 'high',
    outbound: true,
    execute: async (input) => { sent.push(input); return { sent: true }; }
  });

  // Literal: se envía sin confirmación
  const literal = await registry.execute('wa.send_message',
    { to: 'Rosie', message: 'te amo' },
    { userText: 'mándale un wsp a Rosie que diga te amo' });
  assert.equal(literal.ok, true);
  assert.equal(sent.length, 1);

  // Compuesto: queda esperando confirmación
  const composed = await registry.execute('wa.send_message',
    { to: 'Patricio', message: 'Hola, le comparto el resumen de avances...' },
    { userText: 'mándale un resumen a Patricio' });
  assert.equal(composed.confirmationRequired, true);
  assert.equal(sent.length, 1);

  // Compuesto confirmado: se envía
  const confirmed = await registry.execute('wa.send_message',
    { to: 'Patricio', message: 'Hola, le comparto el resumen de avances...' },
    { userText: 'mándale un resumen a Patricio', confirmed: true });
  assert.equal(confirmed.ok, true);
  assert.equal(sent.length, 2);

  // Sin userText (ej: agente programado): sin procedencia conocida, manda el
  // riesgo por defecto — 'high' confirma.
  const agentTriggered = await registry.execute('wa.send_message',
    { to: 'Rosie', message: 'hola' }, {});
  assert.equal(agentTriggered.confirmationRequired, true);
});

test('toJid: normaliza números chilenos y con código de país', () => {
  assert.equal(toJid('+56 9 1234 5678'), '56912345678@s.whatsapp.net');
  assert.equal(toJid('912345678'), '56912345678@s.whatsapp.net');
  assert.equal(toJid('5215512345678'), '5215512345678@s.whatsapp.net');
  assert.equal(toJid(''), null);
});

test('extractText: cubre tipos de mensaje comunes', () => {
  assert.equal(extractText({ conversation: 'hola' }), 'hola');
  assert.equal(extractText({ extendedTextMessage: { text: 'link' } }), 'link');
  assert.equal(extractText({ imageMessage: { caption: 'mira' } }), '[imagen] mira');
  assert.equal(extractText({ audioMessage: {} }), '[nota de voz]');
  assert.equal(extractText({ protocolMessage: {} }), null);
});
