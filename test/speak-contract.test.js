const { test } = require('node:test');
const assert = require('node:assert');
const { enforceSpeakContract } = require('../src/conversation/conversation-runtime');

test('speak corto y completo pasa intacto', () => {
  const out = enforceSpeakContract({ speak: 'Mensaje enviado a Rosie, Señor.', visual: 'Detalle: 13 caracteres.' });
  assert.equal(out.speak, 'Mensaje enviado a Rosie, Señor.');
  assert.equal(out.visual, 'Detalle: 13 caracteres.');
});

test('speak que excede el techo se corta en límite de oración y el completo va a visual', () => {
  const sentence = 'Esta es una oración razonable que habla de algo concreto. ';
  const long = sentence.repeat(12).trim(); // ~700 chars
  const out = enforceSpeakContract({ speak: long, visual: '' });
  assert.ok(out.speak.length <= 420, `speak quedó en ${out.speak.length} chars`);
  assert.match(out.speak, /\.$/);
  assert.equal(out.visual, long);
});

test('speak cortado a media frase retrocede al último cierre de oración', () => {
  const out = enforceSpeakContract({
    speak: 'Revisé tus mensajes y Rosie te escribió dos veces. La segunda dice que la imagen se ve mejor que la otra. Además el grupo Rdrg estaba hablando de un formulario con selección múl',
    visual: ''
  });
  assert.match(out.speak, /mejor que la otra\.$/);
});

test('speak duplicado con visual colapsa a uno (comportamiento previo se conserva)', () => {
  const text = 'Encontré tres correos importantes sobre la factura.';
  const out = enforceSpeakContract({ speak: text, visual: text });
  assert.equal(out.speak, text);
  assert.equal(out.visual, '');
});

test('speak corto sin cierre no se vacía (el retroceso exige conservar la mitad)', () => {
  const out = enforceSpeakContract({ speak: 'Hola. Esto quedó cortado a media fra', visual: '' });
  assert.ok(out.speak.length > 0);
});
