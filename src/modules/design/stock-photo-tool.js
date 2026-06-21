// Tool design.find_photos: fotografía real y gratuita para que las landings
// de Alex no se vean vacías ni con elementos que aparentan funcionar pero no
// hacen nada. No hay generación de imágenes en Jarvis (sin DALL-E/SD); en su
// lugar, búsqueda de stock libre (Pexels — misma API key que video.fetch_footage,
// así que si el usuario ya configuró video no necesita onboarding de nuevo).
function createStockPhotoTool({ credentialVault }) {
  return {
    name: 'design.find_photos',
    description: 'Buscar fotografía real y de uso libre (Pexels) para usar en una landing o demo: hero images, fotos de producto/ambiente, etc. Devuelve URLs directas + crédito del fotógrafo. Requiere PEXELS_API_KEY en el vault (gratis). Input: { query: "qué foto buscar, en inglés da mejores resultados (ej. \'cozy coffee shop interior\')", count? (default 4, máx 10), orientation? ("landscape"|"portrait"|"square", default "landscape") }.',
    risk: 'low',
    permissions: [],
    required: ['query'],
    aliases: { query: ['busqueda', 'consulta'], count: ['cantidad'], orientation: ['orientacion'] },
    execute: async (input) => {
      const apiKey = credentialVault?.get('PEXELS_API_KEY');
      if (!apiKey) {
        return {
          ok: false, needsSetup: true,
          error: 'PEXELS_API_KEY no configurada.',
          instructions: [
            '1. Ve a https://www.pexels.com/api/ y crea una cuenta gratuita',
            '2. Copia tu API Key',
            '3. Ejecuta: credentials.set { key: "PEXELS_API_KEY", value: "tu-key" }'
          ]
        };
      }
      const query = String(input.query || '').trim();
      if (!query) throw new Error('DESIGN_FIND_PHOTOS_REQUIRES_QUERY');
      const count = Math.min(Number(input.count) || 4, 10);
      const orientation = ['landscape', 'portrait', 'square'].includes(input.orientation) ? input.orientation : 'landscape';

      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=${orientation}`,
        { headers: { Authorization: apiKey } }
      );
      if (!res.ok) return { ok: false, error: `Pexels API error ${res.status}` };
      const data = await res.json();
      const photos = (data.photos || []).map((p) => ({
        url: p.src.large,
        urlSmall: p.src.medium,
        width: p.width,
        height: p.height,
        alt: p.alt || query,
        photographer: p.photographer,
        photographerUrl: p.photographer_url,
        pexelsPage: p.url
      }));
      if (photos.length === 0) return { ok: false, error: `Sin resultados para "${query}".` };
      return { ok: true, query, photos, credit: 'Foto vía Pexels — usar la URL "url" directo en <img src>, créditar al fotógrafo si se publica fuera de un demo interno.' };
    }
  };
}

module.exports = { createStockPhotoTool };
