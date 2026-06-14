/**
 * quick-ack.js — Frase corta que Jarvis dice mientras ejecuta tools, para
 * cubrir el hueco de latencia. Se basa en la(s) tool(s) que el modelo decidió
 * llamar, no en el texto del usuario, así nunca se dispara en turnos
 * puramente conversacionales (sin toolCalls).
 */
function buildQuickAck(toolCalls = []) {
  const name = String(toolCalls[0]?.name || '');
  if (/gmail/.test(name))                     return 'Revisando tu bandeja...';
  if (/calendar/.test(name))                  return 'Consultando tu agenda...';
  if (/tasks/.test(name))                     return 'Revisando tus tareas...';
  if (/list|search|find|get/.test(name))      return 'Buscando...';
  if (/create|send|write|draft|update/.test(name)) return 'Lo preparo...';
  if (/delete|trash|archive/.test(name))      return 'Entendido...';
  return 'Un momento...';
}

module.exports = { buildQuickAck };
