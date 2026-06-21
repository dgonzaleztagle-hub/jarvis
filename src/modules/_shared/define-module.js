// Contrato compartido de los módulos-agente (departamentos built-in: Diseño,
// Marketing, SEO, ...). Se extrae recién con el 3er módulo (regla del
// proyecto: generalizar al segundo caso real, no antes) — antes de esto cada
// index.js repetía la misma forma sin nada que la garantizara.
//
// No es un framework pesado: solo valida que el contrato no se desvíe
// (campos requeridos, tools es array) y devuelve el objeto tal cual.
function defineModule({ name, displayName, specialistName, expertise, isRelevant, tools }) {
  if (!name) throw new Error('defineModule requiere "name"');
  if (!displayName) throw new Error('defineModule requiere "displayName"');
  if (!specialistName) throw new Error('defineModule requiere "specialistName"');
  if (typeof isRelevant !== 'function') throw new Error('defineModule requiere "isRelevant" como función');
  if (!Array.isArray(tools)) throw new Error('defineModule requiere "tools" como array');

  return { name, displayName, specialistName, expertise: expertise || '', isRelevant, tools };
}

module.exports = { defineModule };
