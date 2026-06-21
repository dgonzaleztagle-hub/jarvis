// Tool design.analyze_reference: Alex mirando una referencia real con sus
// propios ojos. web.fetch/web.search solo traen texto (título, snippet); para
// reconocer patrones de DISEÑO (bento, simetría, jerarquía, dónde van las
// imágenes) hay que renderizar la página y analizar el render, no el HTML.
// Screenshot headless (Playwright/Chromium) -> visión del modelo con un
// prompt de director creativo, no de SEO/contenido.

const DESIGN_VISION_PROMPT = `Eres un director creativo analizando esta captura de una página web. Devuelve SOLO JSON con lo que observas VISUALMENTE (no inventes nada que no se vea):
{
  "layout": "bento|grid simétrico|asimétrico|una columna|otro — el patrón de composición dominante",
  "simetria": "simétrico|asimétrico|mixto",
  "jerarquia": "qué elemento domina primero la mirada y por qué (tamaño, color, posición)",
  "imagenes": "dónde están ubicadas las imágenes/fotos respecto al texto, y qué proporción ocupan",
  "tipografia": "serif/sans/display, contraste de tamaños entre títulos y cuerpo",
  "paleta": ["colores dominantes que ves, en hex aproximado si puedes"],
  "espaciado": "denso/compacto vs amplio/aireado",
  "que_funciona": "1-2 cosas del diseño que están bien logradas",
  "que_evitar": "1-2 cosas que no replicarías"
}`;

async function screenshotUrl(url, { fullPage = true, viewport = { width: 1440, height: 900 } } = {}) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    const buffer = await page.screenshot({ fullPage });
    return buffer;
  } finally {
    await browser.close();
  }
}

function createReferenceAnalysisTool({ modelProvider }) {
  return {
    name: 'design.analyze_reference',
    description: 'Renderiza una URL real (screenshot del sitio tal cual se ve) y la analiza con criterio de director creativo: layout (bento/grid/asimétrico), simetría, jerarquía visual, ubicación de imágenes, tipografía, paleta y espaciado. Úsala cuando el usuario pida investigar/inspirarse en una página real para diseño (no para SEO ni contenido de texto — para eso usa web.fetch/web.audit_seo). Input: { url: "https://...", pregunta?: "algo puntual que quieras que observe" }.',
    risk: 'low',
    permissions: [],
    required: ['url'],
    fetchesExternalContent: true,
    aliases: { url: ['link', 'enlace', 'sitio'], pregunta: ['prompt', 'que_observar', 'foco'] },
    execute: async (input) => {
      const url = String(input.url || '').trim();
      if (!url) throw new Error('DESIGN_ANALYZE_REFERENCE_REQUIRES_URL');
      if (!modelProvider?.analyzeImage) {
        throw new Error('VISION_NOT_AVAILABLE: el proveedor de modelo actual no soporta imágenes');
      }

      let buffer;
      try {
        buffer = await screenshotUrl(url);
      } catch (err) {
        throw new Error(`DESIGN_SCREENSHOT_FAILED: no se pudo renderizar ${url} (${err.message})`);
      }

      const prompt = String(input.pregunta || '').trim()
        ? `${DESIGN_VISION_PROMPT}\n\nAdemás, responde puntualmente esto: ${input.pregunta}`
        : DESIGN_VISION_PROMPT;

      const result = await modelProvider.analyzeImage({
        imageBase64: buffer.toString('base64'),
        mediaType: 'image/png',
        prompt,
        purpose: 'design_analyze_reference'
      });

      return { url, analysis: result.data };
    }
  };
}

module.exports = { createReferenceAnalysisTool, screenshotUrl };
