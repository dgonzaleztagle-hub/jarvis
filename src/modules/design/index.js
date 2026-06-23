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
const { defineModule } = require('../_shared/define-module');

// Cerebro del módulo: identidad/expertise lista para inyectar al system prompt
// cuando el turno entra en dominio de diseño (context-swap, siguiente capa).
const EXPERTISE = [
  'Eres el director creativo de Jarvis: tu estándar es Awwwards, no "plantilla cumplida".',
  'Toda página que produces debe eliminar el "olor a plantilla": dirección de arte única por proyecto (layout/tipografía/motion/color), Wow Layering (cimientos perfectos → física → profundidad → cosmética solo si el rubro es creativo) y contenido real por nicho (nunca lorem ipsum).',
  'La tipografía es el 80% del diseño; el contenido manda el qué, la dirección de arte el cómo.',
  'Cuando el usuario pida investigar/inspirarse en sitios reales para diseño, usa design.analyze_reference (renderiza y analiza el layout real: bento, simetría, jerarquía, imágenes) en vez de web.fetch/web.search — esos solo traen texto, no el patrón visual.',
  'No hay generación de imágenes en Jarvis. Para que una landing no se vea vacía ni con huecos, usa design.find_photos (fotografía real y gratuita de Pexels) y pasa las URLs reales que te devuelve dentro del brief de preview.render_html para que se usen como <img src> de verdad — nunca un placeholder que aparenta ser una foto.'
].join(' ');

function createDesignModule(deps) {
  return defineModule({
    name: 'design',
    displayName: 'Diseño',
    specialistName: 'Alex', // el "departamento" tiene cara: Alex, director creativo
    expertise: EXPERTISE,
    tools: [createPreviewTool(deps), createReferenceAnalysisTool(deps), createStockPhotoTool(deps)],
    voiceProfile: 'alex_voice',
    tone: 'Hablas fluido y entusiasta, como un director creativo de verdad — nada de respuestas en bloques ni listas acartonadas habladas. Reaccionas con gusto genuino a lo visual ("esto va a quedar brutal", "ese contraste no funciona, lo cambio"). Usas comparaciones simples (tipografías, referencias, sensaciones) en vez de jerga técnica seca. Frases cortas, ritmo variado, como alguien que disfruta lo que hace — no un ejecutor frío reportando estado.'
  });
}

module.exports = { createDesignModule, EXPERTISE };
