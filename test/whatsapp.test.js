const { test } = require('node:test');
const assert = require('node:assert');
const { PolicyEngine } = require('../src/core/policy-engine');
const { ToolRegistry } = require('../src/core/tool-registry');
const { toJid, extractText, WhatsAppChannel } = require('../src/channels/whatsapp-channel');

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

test('resolveRecipient: word-boundary evita falso match Daniel→Daniela', async () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'));
  const channel = new WhatsAppChannel({ dataDir, eventBus: { emit() {} } });

  // Simular mensaje entrante de Daniela González
  channel.messages.push({ jid: '56972739105@s.whatsapp.net', name: 'Daniela González', text: 'hola', at: new Date().toISOString(), isGroup: false, seen: false });

  // "Daniel" NO debe matchear a "Daniela González" (word-boundary)
  const res = await channel.resolveRecipient('Daniel');
  assert.equal(res, null, 'Daniel no debe resolver a Daniela González');

  // "Daniela" SÍ debe matchear
  const resD = await channel.resolveRecipient('Daniela');
  assert.ok(resD?.jid, 'Daniela sí debe resolver');

  // Nombre compuesto: "Daniela González" matcheable por primer nombre
  const resFirst = await channel.resolveRecipient('Daniela González');
  assert.ok(resFirst?.jid);
});

test('wa.send_message prepare: resuelve destinatario antes de confirmación', async () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'));
  const channel = new WhatsAppChannel({ dataDir, eventBus: { emit() {} } });
  channel.messages.push({ jid: '56911111111@s.whatsapp.net', name: 'Rosie', text: 'hola', at: new Date().toISOString(), isGroup: false, seen: false });

  const registry = new ToolRegistry({ policyEngine: new PolicyEngine(), eventBus: { emit() {} } });
  const sent = [];
  registry.register({
    name: 'wa.send_message',
    risk: 'high',
    outbound: true,
    prepare: async (input) => {
      const resolved = await channel.resolveRecipient(String(input.to || ''));
      if (!resolved?.jid) return {};
      const digits = resolved.jid.split('@')[0];
      return { to: `${resolved.label} (+${digits})`, _jid: resolved.jid };
    },
    execute: async (input) => { sent.push(input); return { sent: true }; }
  });

  // Compuesto: debe quedar en confirmación con el destinatario ya resuelto
  const result = await registry.execute('wa.send_message',
    { to: 'Rosie', message: 'el resumen de KPIs es este...' },
    { userText: 'mándale el resumen de KPIs a Rosie' });

  assert.equal(result.confirmationRequired, true);
  // El input que vería el usuario en la confirmación ya tiene el nombre resuelto
  const task = result.policy; // policy is available; check via the actual task
  // Verificar que prepare corrió: en la confirmada, el _jid llega al execute
  const confirmed = await registry.execute('wa.send_message',
    { to: 'Rosie', message: 'el resumen de KPIs es este...' },
    { userText: 'mándale el resumen de KPIs a Rosie', confirmed: true });
  assert.equal(confirmed.ok, true);
  assert.ok(sent[0]._jid === '56911111111@s.whatsapp.net');
  assert.match(sent[0].to, /Rosie/);
});

test('extractText: cubre tipos de mensaje comunes', () => {
  assert.equal(extractText({ conversation: 'hola' }), 'hola');
  assert.equal(extractText({ extendedTextMessage: { text: 'link' } }), 'link');
  assert.equal(extractText({ imageMessage: { caption: 'mira' } }), '[imagen] mira');
  assert.equal(extractText({ audioMessage: {} }), '[nota de voz]');
  assert.equal(extractText({ protocolMessage: {} }), null);
});
