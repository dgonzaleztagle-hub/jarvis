// Tool seo.audit_aeo: auditoría de AEO/GEO (Answer Engine / Generative Engine
// Optimization) — optimizar para que ChatGPT/Perplexity/AI Overviews CITEN la
// página, no solo para que Google la rankee. Eje distinto de web.audit_seo
// (SEO técnico clásico: meta/headings/schema/robots/sitemap), por eso vive
// en su propio score — mezclarlos perdería la señal de cada uno.
const { fetchUrl, fetchText, extractJsonLd, extractAllTags, stripTags } = require('../../connectors/web-fetch');

function hasEntitySchema(types = []) {
  return types.some((t) => /Organization|LocalBusiness|Person|Brand/i.test(t));
}

function hasFaqSchema(types = []) {
  return types.some((t) => /FAQPage|QAPage/i.test(t));
}

function hasQuestionHeadings(html) {
  const headings = [...extractAllTags(html, 'h2'), ...extractAllTags(html, 'h3')];
  return headings.some((h) => h.trim().endsWith('?'));
}

function hasAuthorMeta(html) {
  return /<meta[^>]+name=["']author["']/i.test(html);
}

// Escaneabilidad: párrafos largos son malos para citación (un motor de
// respuesta cita oraciones/fragmentos cortos, no un bloque de 500 palabras).
function hasTextWalls(html) {
  const paragraphs = extractAllTags(html, 'p');
  return paragraphs.some((p) => p.split(/\s+/).length > 150);
}

async function auditAeo(url) {
  const res = await fetchUrl(url);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url };
  const html = res.body;
  const base = new URL(url);

  const schemaTypes = extractJsonLd(html);
  const llmsTxt = await fetchText(`${base.origin}/llms.txt`);

  const checks = {
    hasEntitySchema: hasEntitySchema(schemaTypes),
    hasFaqSchema: hasFaqSchema(schemaTypes),
    hasQuestionHeadings: hasQuestionHeadings(html),
    hasLlmsTxt: Boolean(llmsTxt),
    hasAuthorMeta: hasAuthorMeta(html),
    noTextWalls: !hasTextWalls(html)
  };

  const issues = [];
  if (!checks.hasEntitySchema) issues.push('Sin schema de entidad (Organization/Person/LocalBusiness) — los motores de respuesta no pueden identificar quién es la fuente.');
  if (!checks.hasFaqSchema && !checks.hasQuestionHeadings) issues.push('Sin contenido en formato pregunta-respuesta (FAQPage schema o encabezados terminados en "?") — el formato que más citan los motores de respuesta.');
  if (!checks.hasLlmsTxt) issues.push('Sin llms.txt — estándar emergente para guiar a los crawlers de IA sobre qué contenido es citable.');
  if (!checks.hasAuthorMeta) issues.push('Sin meta de autor — afecta señales de autoridad/credibilidad de la fuente.');
  if (!checks.noTextWalls) issues.push('Párrafos muy largos (>150 palabras) — un motor de respuesta cita fragmentos cortos, no bloques densos.');

  const score = Math.max(0, 100 - issues.length * 18);
  return { ok: true, url, checks, issues, score };
}

function createAeoAuditTool() {
  return {
    name: 'seo.audit_aeo',
    description: 'Auditoría de AEO/GEO (Answer Engine / Generative Engine Optimization): qué tan citable es una página para ChatGPT/Perplexity/AI Overviews — distinto del SEO clásico (eso es web.audit_seo). Revisa schema de entidad, contenido formato pregunta-respuesta, llms.txt, autoría, escaneabilidad. Input: { url }.',
    risk: 'low',
    permissions: [],
    required: ['url'],
    execute: ({ url }) => auditAeo(url)
  };
}

module.exports = { createAeoAuditTool, auditAeo };
