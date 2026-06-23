// Reloj único del producto. Todo lo que decide o muestra "qué día/hora es"
// pasa por acá, anclado a una sola zona horaria. El almacenamiento sigue
// siendo ISO UTC — eso es correcto y no se toca; este módulo gobierna la
// INTERPRETACIÓN: límites de día, horas mostradas al usuario, y comparaciones
// de agenda. Sin esto, "hoy" cambia a las 20:00/21:00 de Chile (medianoche
// UTC) y los agentes diarios se cruzan.
//
// La zona se detecta del sistema operativo (Intl ya sabe leerla, sin onboarding
// ni que nadie configure nada) — JARVIS_TZ sigue disponible como override
// explícito para el caso raro de un servidor en una región distinta a la del
// cliente. Detectarla así, en vez de hardcodear 'America/Santiago', es lo que
// hace esto seguro para una instalación white-label en cualquier país.
const TZ = process.env.JARVIS_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCALE = process.env.JARVIS_LOCALE || 'es-CL';

function tzParts(date = new Date(), tz = TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  // Algunos runtimes devuelven "24" para medianoche con hourCycle h24
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

// Offset (en minutos) entre la zona dada y UTC, EN ESE INSTANTE — no es una
// constante: zonas con horario de verano cambian de offset según la fecha
// (Chile ya no usa DST, pero esta cuenta sirve para cualquier zona).
function tzOffsetMinutes(date, tz = TZ) {
  const p = tzParts(date, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - date.getTime()) / 60_000;
}

// Inverso de tzParts(): dado un año/mes/día/hora "de pared" en la zona del
// producto, devuelve el instante UTC real que representa. Converge en 1-2
// iteraciones porque el offset solo salta en transiciones de DST, nunca varía
// de forma continua. Es la pieza que faltaba para anclar TODO el cálculo de
// fechas (no solo el de agentes) a una sola zona, en vez de mezclar esto con
// los getters locales de Date (que leen la zona del PROCESO Node, una fuente
// de verdad distinta que puede desincronizar de JARVIS_TZ).
function zonedTime(year, month, day, hour = 0, minute = 0, second = 0, tz = TZ) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMinutes(guess, tz);
    const next = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess;
}

// Sumar/restar N días de calendario EN LA ZONA DEL PRODUCTO. Aritmética sobre
// el GRID de calendario (año/mes/día), no sobre milisegundos — así una zona
// con DST no salta de día por culpa de una hora menos/más.
function addDaysInTz(date, days, tz = TZ) {
  const p = tzParts(date, tz);
  const grid = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  grid.setUTCDate(grid.getUTCDate() + days);
  return zonedTime(grid.getUTCFullYear(), grid.getUTCMonth() + 1, grid.getUTCDate(), 0, 0, 0, tz);
}

// Cuántos días tiene un mes — aritmética de calendario Gregoriano pura, no
// depende de zona horaria (día 0 del mes siguiente = último día de este mes).
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Límites de un día calendario EN LA ZONA DEL PRODUCTO — el reemplazo correcto
// de "new Date(y, m, d, 0,0,0)" (que usa la zona del PROCESO Node).
function startOfDayInTz(date = new Date(), tz = TZ) {
  const p = tzParts(date, tz);
  return zonedTime(+p.year, +p.month, +p.day, 0, 0, 0, tz);
}
function endOfDayInTz(date = new Date(), tz = TZ) {
  const p = tzParts(date, tz);
  return zonedTime(+p.year, +p.month, +p.day, 23, 59, 59, tz);
}

// 'YYYY-MM-DD' del día EN CHILE (no UTC). Es la clave para "hoy": presupuestos
// diarios, dedupe de corridas, agrupaciones por día.
function dayKey(date = new Date()) {
  const p = tzParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// 'HH:MM' en hora de Chile, comparable lexicográficamente con schedule.at.
function hhmm(date = new Date()) {
  const p = tzParts(date);
  return `${p.hour}:${p.minute}`;
}

// Formato para mostrar al usuario. Siempre en la zona del producto, aunque la
// máquina esté configurada en otra.
function formatForUser(date, options = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(LOCALE, { timeZone: TZ, ...options });
}

// Día de la semana (0=domingo..6=sábado) de la fecha EN CHILE, no UTC ni la
// zona de la máquina — para schedule.type:'weekly' de agentes ("cada lunes").
// El día calendario ya viene correcto de dayKey(); tratarlo como medianoche
// UTC da el weekday correcto sin import de librerías de fechas.
function weekday(date = new Date()) {
  return new Date(`${dayKey(date)}T00:00:00Z`).getUTCDay();
}

module.exports = {
  TZ, LOCALE, tzParts, dayKey, hhmm, formatForUser, weekday,
  tzOffsetMinutes, zonedTime, addDaysInTz, daysInMonth, startOfDayInTz, endOfDayInTz
};
