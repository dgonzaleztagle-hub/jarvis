// Tool seo.generate_report: el entregable real de Teo. No expone el JSON
// crudo de las auditorías — compone un reporte narrativo, presentable a un
// cliente que no sabe qué es un H1 o un schema, listo para mandar a
// google.docs.create_document (eso lo hace el modelo orquestador después,
// con el markdown que devuelve esta tool — no se acopla aquí para mantener
// la composición de primitivos, mismo patrón que Alex con design.find_photos).
const { executeAuditSeo } = require('../../connectors/web-fetch');
const { auditAeo } = require('./aeo-audit-tool');

function createReportTool({ modelProvider, contentHonestyClause = '' }) {
  return {
    name: 'seo.generate_report',
    description: 'Genera un reporte de auditoría profundo y presentable a un cliente (SEO técnico + AEO/GEO) para una o más URLs. Devuelve markdown narrativo listo para pasar a google.docs.create_document — NO uses esta tool para ver datos crudos, para eso usa web.audit_seo / seo.audit_aeo directo. Input: { urls: ["https://..."], audience? ("cliente sin conocimiento técnico" por defecto) }.',
    risk: 'low',
    permissions: [],
    required: ['urls'],
    aliases: { urls: ['url', 'sitios', 'links'] },
    execute: async (input) => {
      const urls = Array.isArray(input.urls) ? input.urls : (input.url ? [input.url] : []);
      if (urls.length === 0) throw new Error('SEO_REPORT_REQUIRES_URLS');
      if (!modelProvider?.generateText) throw new Error('SEO_REPORT_REQUIRES_MODEL_PROVIDER');

      const audience = String(input.audience || 'un cliente sin conocimiento técnico de SEO').trim();

      const findings = [];
      for (const url of urls) {
        const [seo, aeo] = await Promise.all([
          executeAuditSeo({ url }).catch((err) => ({ ok: false, error: err.message, url })),
          auditAeo(url).catch((err) => ({ ok: false, error: err.message, url }))
        ]);
        findings.push({ url, seo, aeo });
      }

      const prompt = `Eres un consultor de auditoría web escribiendo un reporte para ${audience}. Tienes los datos crudos de auditoría SEO técnica y AEO/GEO (citabilidad por IA) de ${urls.length} URL(s) a continuación. Escribe un reporte en markdown, profesional pero claro (sin jerga sin explicar), que:
1. Resuma el estado general (puntaje SEO y AEO de cada URL, en contexto — qué significa ese número).
2. Explique los 3-5 hallazgos MÁS importantes en términos de impacto de negocio (no solo "falta un H1", sino por qué importa).
3. Termine con una lista priorizada de acciones recomendadas (qué hacer primero y por qué).
NO inventes datos que no estén en el JSON. Si algo falló (ok:false), dilo honestamente, no lo omitas.

DATOS:
${JSON.stringify(findings, null, 2)}`;

      const out = await modelProvider.generateText({
        system: `Escribes reportes de auditoría web claros y honestos.\n\n${contentHonestyClause}`,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        temperature: 0.4,
        purpose: 'seo_report'
      });

      return {
        ok: true,
        urls,
        report: String(out.text || ''),
        seoScores: findings.map((f) => ({ url: f.url, score: f.seo?.score ?? null })),
        aeoScores: findings.map((f) => ({ url: f.url, score: f.aeo?.score ?? null }))
      };
    }
  };
}

module.exports = { createReportTool };
