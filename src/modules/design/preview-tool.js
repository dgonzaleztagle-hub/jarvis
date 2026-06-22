const fs = require('fs');
const path = require('path');
const { planLanding } = require('./landing-design-system');
const { recentCombos, recordCombo } = require('./variation-store');
const { auditLanding } = require('./landing-qa');

// Tool preview.render_html: el cerebro de "director creativo" del módulo Diseño.
// Genera una landing single-file (Tailwind local + fuentes offline) a partir de
// un brief, aplicando dirección de arte por variabilidad + concepto de contenido
// por nicho, memoria de variaciones por cliente y un gate de QA.
function createPreviewTool({ modelProvider, dataDir, eventBus, brandTools, generateWithContinuation, contentHonestyClause = '' }) {
  return {
    name: 'preview.render_html',
    description: 'Crear y mostrar una página (landing, maqueta, sitio, cualquier documento web) en el HUD del usuario: aparece renderizada en un panel con opción de abrirla en grande. Úsalo cuando el usuario pida una página/landing/web. NO escribas tú el HTML completo: pasa un BRIEF corto en lenguaje natural y la herramienta genera el HTML por dentro. Input: { brief: "qué página crear, para quién, secciones y tono (ej: landing para Rishtedar, restaurante indio en Santiago: hero, platos destacados, botón de reserva, estética cálida)", title: "nombre legible opcional" }.',
    risk: 'low',
    permissions: [],
    execute: async (input) => {
      let html = String(input.html || '');
      const brief = String(input.brief || '').trim();

      // Detecta corte por techo de tokens (provider lo avisa, o nunca cerró </html>).
      const isComplete = (text, stopReason) =>
        stopReason !== 'max_tokens' && /<\/html>\s*$/i.test(text.trim());
      const stripFences = (text) => text.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '');

      async function callOnce(messages, maxTokens) {
        if (typeof modelProvider.generateText === 'function') {
          const out = await modelProvider.generateText({
            system: `Eres un diseñador web. Devuelves únicamente HTML+CSS, sin explicaciones ni markdown.\n\n${contentHonestyClause}`,
            messages, maxTokens, temperature: 0.5, purpose: 'preview_html'
          });
          return { text: String(out.text || ''), stopReason: out.stopReason || null };
        }
        const out = await modelProvider.generateJson({
          system: `Devuelve únicamente JSON { "html": "<documento completo>" }. Sin markdown.\n\n${contentHonestyClause}`,
          messages, maxTokens, temperature: 0.5, purpose: 'preview_html'
        });
        return { text: String(out.data?.html || ''), stopReason: out.stopReason || null };
      }

      if (!html.trim() && brief) {
        // Marca activa → colores exactos + clave de cliente para la memoria de variaciones.
        let brandColors = null;
        let clientKey = '';
        try {
          const bp = brandTools && brandTools.getActiveProfile && brandTools.getActiveProfile();
          if (bp) {
            clientKey = bp.name || '';
            if (Array.isArray(bp.colors) && bp.colors.length) {
              brandColors = { primary: bp.colors[0], secondary: bp.colors[1] || null, accent: bp.colors[2] || null };
            }
          }
        } catch (_) { /* sin marca activa: paleta del rubro */ }
        if (!clientKey) clientKey = brief.slice(0, 60);
        const avoid = recentCombos(dataDir, clientKey, 3);
        const plan = planLanding({ brief, brandColors, avoid });
        recordCombo(dataDir, clientKey, plan.combo);
        const genPrompt = `${plan.directive}

---

Ahora genera el documento HTML COMPLETO y autocontenido para: ${brief}.
TÉCNICA: usa Tailwind (clases de utilidad) para el layout y el grueso del estilo — el runtime de Tailwind YA está inyectado, NO agregues el script ni el CDN de Tailwind. Las fuentes de la dirección de arte YA están cargadas localmente (no agregues <link> de Google Fonts): aplícalas por font-family en el <style>. Usa un único bloque <style> SOLO para lo que Tailwind no cubre (font-family de las fuentes elegidas, @keyframes de revelado, grano/textura, scroll-snap). No uses imágenes externas: resuelve lo visual con color, gradientes, formas y tipografía. Responsive mobile-first (sm/md/lg). Devuelve SOLO el HTML empezando por <!doctype html>, sin markdown ni explicación.`;
        try {
          const { text, truncated } = await generateWithContinuation({
            callOnce,
            prompt: genPrompt,
            isComplete,
            stripFences,
            continuePrompt: 'Continúa EXACTAMENTE donde quedó el documento anterior, sin repetir nada de lo ya escrito y sin comentarios, hasta cerrar con </html>.'
          });
          if (truncated) {
            return { ok: false, error: 'PREVIEW_INCOMPLETE: el documento generado quedó cortado (excede el límite de tokens) incluso tras continuar.' };
          }
          html = text;
        } catch (err) {
          return { ok: false, error: `PREVIEW_GENERATION_FAILED: ${err.message}` };
        }
      }

      if (!html.trim()) return { ok: false, error: 'BRIEF_OR_HTML_REQUIRED' };

      // El modelo a veces ignora la instrucción de no agregar CDN de Tailwind ni
      // Google Fonts (ya están inyectados/cargados localmente) — no es confiable
      // dejarlo solo a la instrucción: esto rompe el offline-first del white-label
      // (sale a internet a buscar algo que ya tenemos local) sin que el gate de QA
      // lo detecte (solo mira si HAY clases Tailwind, no si hay dependencias
      // externas de más). Limpieza determinística, no negociable con el modelo.
      html = stripExternalDependencies(html);

      // Gate de QA estático (sin browser). Si hay CRÍTICAS y vino de un brief,
      // UNA pasada de reparación dirigida antes de mostrarla.
      let qa = auditLanding(html);
      if (brief && qa.criticalCount > 0) {
        try {
          const repairPrompt = `Este HTML tiene problemas de QA que DEBES corregir, manteniendo el diseño, el contenido y las clases Tailwind. Problemas:\n${qa.issues.map((i) => `- ${i.msg}`).join('\n')}\n\nDevuelve el HTML COMPLETO corregido, empezando por <!doctype html>, sin markdown ni explicación.\n\nHTML:\n${html}`;
          const repaired = await generateWithContinuation({
            callOnce, prompt: repairPrompt, isComplete, stripFences,
            continuePrompt: 'Continúa EXACTAMENTE donde quedó, sin repetir, hasta cerrar </html>.'
          });
          if (repaired.text && !repaired.truncated) {
            const reQa = auditLanding(repaired.text);
            if (reQa.score >= qa.score) { html = repaired.text; qa = reQa; }
          }
        } catch (_) { /* best-effort */ }
      }

      // Runtime de Tailwind + fuentes locales (offline, white-label). Las
      // font-family las eligió el director de arte en el documento.
      html = injectAssets(html);

      const previewsDir = path.join(dataDir, 'previews');
      fs.mkdirSync(previewsDir, { recursive: true });
      const fileName = `preview_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.html`;
      fs.writeFileSync(path.join(previewsDir, fileName), html, 'utf-8');
      const payload = { url: `/preview/${fileName}`, title: String(input.title || 'Vista previa') };
      eventBus && eventBus.emit('hud_show_preview', payload);
      return { ok: true, ...payload, bytes: html.length, qa: { score: qa.score, summary: qa.summary, issues: qa.issues } };
    }
  };
}

function stripExternalDependencies(doc) {
  return doc
    // CDN de Tailwind (variantes comunes: cdn.tailwindcss.com, unpkg, jsdelivr)
    .replace(/<script[^>]+src=["'][^"']*(?:cdn\.tailwindcss\.com|unpkg\.com\/tailwindcss|jsdelivr\.net\/npm\/tailwindcss)[^"']*["'][^>]*>\s*<\/script>/gi, '')
    // Google Fonts vía <link> o @import — las fuentes ya están en /public/vendor/fonts.css
    .replace(/<link[^>]+href=["'][^"']*fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>/gi, '')
    .replace(/@import\s+url\(['"]?[^'")]*fonts\.googleapis\.com[^'")]*['"]?\)\s*;?/gi, '');
}

function injectAssets(doc) {
  if (/vendor\/tailwind\.js/.test(doc)) return doc; // ya inyectado
  const tags = [
    '<link rel="stylesheet" href="/public/vendor/fonts.css">',
    '<script src="/public/vendor/tailwind.js"></script>'
  ].join('\n');
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}\n${tags}`);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${tags}\n</head>`);
  return `${tags}\n${doc}`;
}

module.exports = { createPreviewTool };
