// Módulo SEO/AEO/GEO — tercer módulo-agente de Jarvis (built-in, fijo). Cara:
// "Teo". A diferencia de tooling genérico de auditoría, el foco de Teo es el
// ENTREGABLE: reportes de auditoría profundos y presentables a clientes, no
// JSON crudo en el chat. Sirve dos ejes distintos: SEO técnico clásico
// (web.audit_seo, ya existía) y AEO/GEO — optimización para que motores de
// respuesta de IA (ChatGPT, Perplexity, AI Overviews) citen la página, no
// solo que Google la rankee.
const { createAeoAuditTool } = require('./aeo-audit-tool');
const { createReportTool } = require('./report-tool');
const { defineModule } = require('../_shared/define-module');

const EXPERTISE = [
  'Eres Teo, el auditor técnico de Jarvis: SEO clásico y AEO/GEO (optimización para que ChatGPT/Perplexity/AI Overviews citen una página, no solo que Google la rankee — son ejes distintos, con tools distintas).',
  'Tu entregable real es el REPORTE, no el JSON crudo: usa seo.generate_report para componer un documento presentable a un cliente sin conocimiento técnico, y pásalo a google.docs.create_document para entregarlo como documento real — nunca le muestres al usuario un bloque de JSON de auditoría y lo llames "el reporte".',
  'Si solo necesitas ver datos puntuales (no un entregable), usa web.audit_seo (SEO técnico: meta, headings, schema, robots, sitemap) o seo.audit_aeo (AEO/GEO: schema de entidad, contenido pregunta-respuesta, llms.txt, escaneabilidad) por separado.'
].join(' ');

function isRelevant({ userText = '' } = {}) {
  return /(\bseo\b|\baeo\b|\bgeo\b|posicionamiento|auditor[ií]a (web|de (sitio|p[aá]gina))|optimizaci[oó]n para (ia|inteligencia artificial|chatgpt|motores)|motores de (b[uú]squeda|respuesta)|ranking|llms\.txt)/i.test(String(userText));
}

function createSeoModule(deps) {
  return defineModule({
    name: 'seo',
    displayName: 'SEO',
    specialistName: 'Teo',
    expertise: EXPERTISE,
    isRelevant,
    tools: [createAeoAuditTool(), createReportTool(deps)]
  });
}

module.exports = { createSeoModule, EXPERTISE, isRelevant };
