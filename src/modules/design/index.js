// Módulo DISEÑO — primer módulo-agente de Jarvis (built-in, fijo; distinto de
// los agentes que crea el usuario con agents.create, que son cron jobs).
// Es un "departamento" especialista: su propio cerebro (director creativo), su
// conocimiento (sistema de diseño + conceptos por nicho destilados de HojaCero)
// y su grupo de tools. Jarvis sigue siendo la única puerta y orquesta; este
// módulo es el especialista detrás. Patrón inline context-swap (no sub-loop):
// cuando el turno es de diseño, su `expertise` se puede inyectar al system.

const { createPreviewTool } = require('./preview-tool');
const { createReferenceAnalysisTool } = require('./reference-analysis-tool');
const { createStockPhotoTool } = require('./stock-photo-tool');

// Cerebro del módulo: identidad/expertise lista para inyectar al system prompt
// cuando el turno entra en dominio de diseño (context-swap, siguiente capa).
const EXPERTISE = [
  'Eres el director creativo de Jarvis: tu estándar es Awwwards, no "plantilla cumplida".',
  'Toda página que produces debe eliminar el "olor a plantilla": dirección de arte única por proyecto (layout/tipografía/motion/color), Wow Layering (cimientos perfectos → física → profundidad → cosmética solo si el rubro es creativo) y contenido real por nicho (nunca lorem ipsum).',
  'La tipografía es el 80% del diseño; el contenido manda el qué, la dirección de arte el cómo.',
  'Cuando el usuario pida investigar/inspirarse en sitios reales para diseño, usa design.analyze_reference (renderiza y analiza el layout real: bento, simetría, jerarquía, imágenes) en vez de web.fetch/web.search — esos solo traen texto, no el patrón visual.',
  'No hay generación de imágenes en Jarvis. Para que una landing no se vea vacía ni con huecos, usa design.find_photos (fotografía real y gratuita de Pexels) y pasa las URLs reales que te devuelve dentro del brief de preview.render_html para que se usen como <img src> de verdad — nunca un placeholder que aparenta ser una foto.'
].join(' ');

// ¿El turno es de dominio diseño? Heurística para el context-swap (capa futura).
function isRelevant({ userText = '' } = {}) {
  return /(landing|p[aá]gina web|sitio web|maqueta|dise[ñn]o web|web para|render(iza|)|mockup)/i.test(String(userText));
}

function createDesignModule(deps) {
  return {
    name: 'design',
    displayName: 'Diseño',
    specialistName: 'Alex', // el "departamento" tiene cara: Alex, director creativo
    expertise: EXPERTISE,
    isRelevant,
    tools: [createPreviewTool(deps), createReferenceAnalysisTool(deps), createStockPhotoTool(deps)]
  };
}

module.exports = { createDesignModule, EXPERTISE, isRelevant };
