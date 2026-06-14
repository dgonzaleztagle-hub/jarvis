// Reloj único del producto. Todo lo que decide o muestra "qué día/hora es"
// pasa por acá, anclado a una sola zona horaria (configurable para white-label
// vía JARVIS_TZ). El almacenamiento sigue siendo ISO UTC — eso es correcto y
// no se toca; este módulo gobierna la INTERPRETACIÓN: límites de día, horas
// mostradas al usuario, y comparaciones de agenda. Sin esto, "hoy" cambia a
// las 20:00/21:00 de Chile (medianoche UTC) y los agentes diarios se cruzan.
const TZ = process.env.JARVIS_TZ || 'America/Santiago';
const LOCALE = process.env.JARVIS_LOCALE || 'es-CL';

function tzParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  // Algunos runtimes devuelven "24" para medianoche con hourCycle h24
  if (parts.hour === '24') parts.hour = '00';
  return parts;
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

module.exports = { TZ, LOCALE, tzParts, dayKey, hhmm, formatForUser };
