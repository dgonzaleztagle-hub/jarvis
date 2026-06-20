const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MeetingSession, startSession, getSession, clearSession } = require('../src/meeting/meeting-session');
const { generateMinutes, minutesToDocText } = require('../src/meeting/meeting-minutes');

/* ─── meeting-session ────────────────────────────────────────────────────── */

test('MeetingSession: addChunk acumula y getTranscript concatena', () => {
  const s = new MeetingSession({ title: 'Test' });
  s.addChunk('Hola, esto es una prueba.');
  s.addChunk('[DECISIÓN: seguimos con el plan A]');
  const t = s.getTranscript();
  assert.match(t, /prueba/);
  assert.match(t, /DECISIÓN/);
  assert.equal(s.chunks.length, 2);
});

test('MeetingSession: stop marca endedAt y isActive=false', () => {
  const s = new MeetingSession({ title: 'Test' });
  assert.equal(s.isActive, true);
  s.stop();
  assert.equal(s.isActive, false);
  assert.ok(s.endedAt);
});

test('startSession lanza si ya hay una activa', () => {
  clearSession();
  startSession({ title: 'Primera' });
  assert.throws(() => startSession({ title: 'Segunda' }), /MEETING_ALREADY_ACTIVE/);
  clearSession();
});

test('getSession devuelve la sesión activa', () => {
  clearSession();
  const s = startSession({ title: 'Mi reunión' });
  assert.equal(getSession(), s);
  clearSession();
  assert.equal(getSession(), null);
});

test('toStatus incluye durationSeconds y chunks', () => {
  const s = new MeetingSession({ title: 'Test' });
  s.addChunk('texto');
  const status = s.toStatus();
  assert.equal(status.active, true);
  assert.equal(status.chunks, 1);
  assert.ok(status.durationSeconds >= 0);
});

/* ─── meeting-minutes ────────────────────────────────────────────────────── */

test('generateMinutes: usa el modelProvider y devuelve estructura correcta', async () => {
  const fakeModel = {
    generateJson: async () => ({
      data: {
        summary: 'Se decidió avanzar con el plan.',
        topics: ['Precios', 'Fechas'],
        decisions: ['Abrir local en agosto'],
        commitments: [{ person: 'Vikram', commitment: 'enviar cotización', deadline: '2026-06-20' }],
        actionItems: [{ task: 'Revisar contrato', owner: 'Daniel', deadline: null }],
        nextSteps: 'Confirmar con abogado'
      }
    })
  };
  const minutes = await generateMinutes({
    transcript: 'Vikram: vamos a abrir en agosto.',
    title: 'Reunión Rishtedar',
    modelProvider: fakeModel
  });
  assert.equal(minutes.decisions[0], 'Abrir local en agosto');
  assert.equal(minutes.commitments[0].person, 'Vikram');
  assert.equal(minutes.actionItems[0].task, 'Revisar contrato');
  assert.equal(minutes.nextSteps, 'Confirmar con abogado');
});

test('generateMinutes: transcript vacío devuelve estructura vacía sin llamar al modelo', async () => {
  let called = false;
  const fakeModel = { generateJson: async () => { called = true; return { data: {} }; } };
  const minutes = await generateMinutes({ transcript: '', title: 'x', modelProvider: fakeModel });
  assert.equal(called, false);
  assert.deepEqual(minutes.decisions, []);
});

test('minutesToDocText: incluye secciones clave del template', () => {
  const minutes = {
    summary: 'Resumen de la reunión.',
    topics: ['Precios'],
    decisions: ['Bajar precios 10%'],
    commitments: [{ person: 'Vikram', commitment: 'enviar lista', deadline: '2026-07-01' }],
    actionItems: [{ task: 'Actualizar planilla', owner: 'Daniel', deadline: null }],
    nextSteps: 'Llamada la próxima semana'
  };
  const text = minutesToDocText({
    title: 'Rishtedar', startedAt: '2026-06-16T02:00:00Z', endedAt: '2026-06-16T03:00:00Z',
    minutes, transcript: 'texto completo'
  });
  assert.match(text, /Resumen/);
  assert.match(text, /Decisiones/);
  assert.match(text, /Vikram/);
  assert.match(text, /Actualizar planilla/);
  assert.match(text, /texto completo/);
});
