const { test } = require('node:test');
const assert = require('node:assert');
const { PolicyEngine } = require('../src/core/policy-engine');
const { ToolRegistry } = require('../src/core/tool-registry');
const { isLiteralDictation } = require('../src/channels/whatsapp-tools');
const { toJid, extractText } = require('../src/channels/whatsapp-channel');

test('isLiteralDictation: dictado literal pasa, compuesto no', () => {
  assert.equal(isLiteralDictation('te amo', 'envía un mensaje a Rosie y que diga te amo'), true);
  assert.equal(isLiteralDictation('Té amo!', 'que diga te amo'), true);
  assert.equal(isLiteralDictation('Hola don Patricio, le resumo lo construido', 'envía un resumen a don Patricio'), false);
  assert.equal(isLiteralDictation('te amo', ''), false);
  assert.equal(isLiteralDictation('', 'di algo'), false);
});

test('policy: wa.send_message compuesto exige confirmación, literal no', async () => {
  const policyEngine = new PolicyEngine();
  policyEngine.registerRule(({ tool, input, context }) => {
    if (tool.name !== 'wa.send_message') return null;
    if (isLiteralDictation(input.message, context.userText)) return null;
    return { requiresConfirmation: true, reason: 'compuesto' };
  });
  const registry = new ToolRegistry({ policyEngine, eventBus: { emit() {} } });
  const sent = [];
  registry.register({
    name: 'wa.send_message',
    risk: 'medium',
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

  // Sin userText (ej: agente programado): siempre confirma
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
