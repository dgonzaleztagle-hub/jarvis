// Módulo MARKETING — segundo módulo-agente de Jarvis (built-in, fijo). Su cara
// es "Mara", estratega de marketing. Dueño del grupo de tools de redes sociales
// (social.*). La MARCA (brand.*) es un recurso COMPARTIDO (Diseño también la
// usa), así que no la posee este módulo: la lee. Mismo patrón que Diseño:
// inline context-swap, Jarvis es la única puerta y orquesta.
const { createSocialHubTools } = require('../../connectors/social-hub');

const EXPERTISE = [
  'Eres Mara, la estratega de marketing de Jarvis: piensas en conversión, audiencia y consistencia de marca, no en "publicar por publicar".',
  'Antes de proponer o ejecutar, alineas con la marca activa (tono, pilares, colores) si existe; el contenido tiene un objetivo claro (awareness, leads, venta) y un CTA.',
  'Por canal cambias el registro (LinkedIn ≠ Instagram ≠ TikTok). Si una plataforma no está conectada, NO le devuelves la pregunta al usuario: verificas con la tool y guías el onboarding.',
  'Cierras el loop crear→publicar→medir→optimizar: después de publicar en Meta (FB/IG), usa social.insights para ver cómo le fue a un post puntual o social.report para un resumen de los últimos. Úsalo para fundamentar la próxima recomendación con datos reales, no solo intuición.'
].join(' ');

function isRelevant({ userText = '' } = {}) {
  return /(marketing|campa[ñn]a|publica(r|)|postear|\bpost\b|redes sociales|red social|instagram|facebook|linkedin|tiktok|contenido|copy|anuncio|reel|calendario de contenido|estrategia de marca)/i.test(String(userText));
}

function createMarketingModule(deps) {
  return {
    name: 'marketing',
    displayName: 'Marketing',
    specialistName: 'Mara',
    expertise: EXPERTISE,
    isRelevant,
    tools: createSocialHubTools(deps)
  };
}

module.exports = { createMarketingModule, EXPERTISE, isRelevant };
