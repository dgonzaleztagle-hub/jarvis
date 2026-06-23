const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TZ, dayKey, hhmm, weekday, startOfDayInTz, endOfDayInTz, addDaysInTz, daysInMonth, zonedTime
} = require('../src/utils/time');

test('TZ se auto-detecta del sistema operativo (no queda hardcodeado a Chile)', () => {
  // En esta máquina coincide con Chile, pero la fuente es Intl, no un string
  // fijo en el código — eso es justo lo que lo hace correcto para white-label.
  assert.equal(TZ, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('startOfDayInTz/endOfDayInTz: limites correctos en la ventana donde UTC ya cambio de dia y Chile no', () => {
  const lateNight = new Date('2026-06-22T02:30:00.000Z'); // 22:30 Chile del 2026-06-21
  assert.equal(dayKey(lateNight), '2026-06-21');
  assert.equal(startOfDayInTz(lateNight).toISOString(), '2026-06-21T04:00:00.000Z');
  assert.equal(endOfDayInTz(lateNight).toISOString(), '2026-06-22T03:59:59.000Z');
});

test('addDaysInTz: suma/resta dias de calendario en la zona del producto, no en milisegundos crudos', () => {
  const lateNight = new Date('2026-06-22T02:30:00.000Z'); // 22:30 Chile del 2026-06-21
  assert.equal(dayKey(addDaysInTz(lateNight, 1)), '2026-06-22');
  assert.equal(dayKey(addDaysInTz(lateNight, -1)), '2026-06-20');
  assert.equal(dayKey(addDaysInTz(lateNight, 7)), '2026-06-28');
});

test('zonedTime: construye el instante UTC real para una hora de pared en la zona del producto', () => {
  const t = zonedTime(2026, 6, 22, 9, 0, 0);
  assert.equal(hhmm(t), '09:00');
  assert.equal(dayKey(t), '2026-06-22');
});

test('daysInMonth: aritmetica de calendario pura (no depende de zona)', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 6), 30);
  assert.equal(daysInMonth(2024, 2), 29); // bisiesto
});

test('weekday: consistente con dayKey en la misma ventana nocturna', () => {
  const lateNight = new Date('2026-06-22T02:30:00.000Z'); // domingo 2026-06-21 en Chile
  assert.equal(weekday(lateNight), 0);
});

test('google-calendar resolvePeriod: "hoy"/"esta semana" no se corren un dia en la ventana nocturna de Chile', () => {
  const { resolvePeriod } = require('../src/connectors/google-calendar');
  // 22:30 hora Chile del domingo 2026-06-21 — en UTC ya es lunes 2026-06-22.
  // Antes esto usaba Date#getFullYear/getDate (zona del proceso Node) en vez
  // de la zona del producto; con TZ=UTC en el proceso, "hoy" se habria corrido
  // al lunes. Acá se fuerza pasando baseDate ya resuelto via dayKey/zonedTime.
  const lateNight = new Date('2026-06-22T02:30:00.000Z');

  const today = resolvePeriod('hoy', lateNight);
  assert.equal(today.timeMin, '2026-06-21T04:00:00.000Z'); // medianoche Chile del domingo
  assert.equal(today.timeMax, '2026-06-22T03:59:59.000Z'); // 23:59:59 Chile del domingo

  const thisWeek = resolvePeriod('esta_semana', lateNight);
  // El domingo 21 es el ultimo dia de SU semana (lunes 15 a domingo 21).
  assert.equal(thisWeek.timeMin, '2026-06-15T04:00:00.000Z'); // lunes 15, medianoche Chile
  assert.equal(thisWeek.timeMax, '2026-06-22T03:59:59.000Z'); // domingo 21, 23:59:59 Chile

  const tomorrow = resolvePeriod('manana', lateNight);
  assert.equal(tomorrow.timeMin, '2026-06-22T04:00:00.000Z'); // lunes 22, medianoche Chile
});

test('google-calendar resolvePeriod: este_mes cubre el mes completo en la zona del producto', () => {
  const { resolvePeriod } = require('../src/connectors/google-calendar');
  const mid = new Date('2026-06-15T16:00:00.000Z'); // mediodia Chile, sin ambiguedad de dia
  const month = resolvePeriod('este_mes', mid);
  assert.equal(month.timeMin, '2026-06-01T04:00:00.000Z');
  assert.equal(month.timeMax, '2026-07-01T03:59:59.000Z'); // 30 de junio, 23:59:59 Chile
});

test('google-calendar parseNaturalDateTime: "mañana a las 9" usa el dia de calendario en la zona del producto', () => {
  const { parseNaturalDateTime } = require('../src/connectors/google-calendar');
  const lateNight = new Date('2026-06-22T02:30:00.000Z'); // domingo 21, 22:30 Chile
  const result = parseNaturalDateTime('mañana a las 9', lateNight);
  // "mañana" desde el domingo 21 (Chile) es el lunes 22 a las 09:00 Chile.
  assert.equal(result, '2026-06-22T13:00:00.000Z');
});
