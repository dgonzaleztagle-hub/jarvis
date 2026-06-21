// Gate de QA estático para landings (sin browser headless: cero dependencias,
// corre offline en el .exe). NO mide performance ni contraste reales —eso exige
// renderizar, y queda como audit break-glass futuro—; sí atrapa las fallas
// comunes y objetivas: estructura, accesibilidad básica, completitud y las
// reglas de física de diseño (BIBLIA). Devuelve { score 0..1, issues[] }.

function count(re, html) {
  const m = html.match(re);
  return m ? m.length : 0;
}

const CTA_WORDS = /(reservar|reserva|contacto|cont[aá]ctanos|cotiza|cotizar|agendar|agenda|comprar|empezar|comienza|solicitar|pedir|llamar|whatsapp|inscr[ií])/i;

// Cada check: { id, weight, critical, test(html) -> bool, msg }
const CHECKS = [
  { id: 'doc_complete', weight: 3, critical: true, test: (h) => /<!doctype html/i.test(h) && /<\/html>\s*$/i.test(h.trim()), msg: 'El documento no está completo (falta <!doctype> o no cierra </html>).' },
  { id: 'has_title', weight: 2, critical: true, test: (h) => /<title>[^<]{3,}<\/title>/i.test(h), msg: 'Falta un <title> con texto.' },
  { id: 'has_lang', weight: 1, test: (h) => /<html[^>]*\slang=/i.test(h), msg: 'El <html> no declara lang (accesibilidad/SEO).' },
  { id: 'has_viewport', weight: 1, test: (h) => /<meta[^>]+viewport/i.test(h), msg: 'Falta <meta viewport> (responsive).' },
  { id: 'has_h1', weight: 2, critical: true, test: (h) => count(/<h1[\s>]/gi, h) >= 1, msg: 'No hay <h1> (el hero necesita un titular semántico).' },
  { id: 'single_h1', weight: 1, test: (h) => count(/<h1[\s>]/gi, h) <= 1, msg: 'Hay más de un <h1> (debería ser único).' },
  { id: 'has_subheadings', weight: 1, test: (h) => count(/<h2[\s>]/gi, h) >= 1, msg: 'No hay <h2> (falta jerarquía/estructura de secciones).' },
  { id: 'has_cta', weight: 3, critical: true, test: (h) => {
    const ctas = h.match(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi) || [];
    return ctas.some((c) => CTA_WORDS.test(c));
  }, msg: 'No se detecta un CTA claro (reservar/contactar/cotizar/agendar...).' },
  { id: 'images_alt', weight: 1, test: (h) => {
    const imgs = h.match(/<img\b[^>]*>/gi) || [];
    return imgs.every((i) => /\salt=/.test(i));
  }, msg: 'Hay <img> sin atributo alt (accesibilidad).' },
  { id: 'no_lorem', weight: 2, test: (h) => !/lorem ipsum/i.test(h), msg: 'Contiene "lorem ipsum" (prohibido: contenido de relleno).' },
  { id: 'no_text_walls', weight: 1, test: (h) => {
    const ps = h.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [];
    return ps.every((p) => p.replace(/<[^>]+>/g, '').trim().length <= 600);
  }, msg: 'Hay muros de texto (>600 chars en un <p>): descomponer en bento/tarjetas.' },
  { id: 'links_have_text', weight: 1, test: (h) => {
    const links = h.match(/<a\b[^>]*>([\s\S]*?)<\/a>/gi) || [];
    return links.every((a) => a.replace(/<[^>]+>/g, '').trim().length > 0 || /aria-label=/.test(a));
  }, msg: 'Hay enlaces sin texto ni aria-label (accesibilidad).' },
  { id: 'uses_tailwind', weight: 1, test: (h) => /class="[^"]*\b(flex|grid|px-|py-|text-|bg-|rounded|gap-)/.test(h), msg: 'No se ven utilidades Tailwind (¿se generó el estilo?).' }
];

function auditLanding(html = '') {
  const issues = [];
  let got = 0;
  let total = 0;
  for (const c of CHECKS) {
    total += c.weight;
    let ok = false;
    try { ok = c.test(html); } catch (_) { ok = false; }
    if (ok) got += c.weight;
    else issues.push({ id: c.id, severity: c.critical ? 'critical' : 'minor', msg: c.msg });
  }
  const score = total ? Number((got / total).toFixed(2)) : 0;
  const criticals = issues.filter((i) => i.severity === 'critical');
  return { score, issues, criticalCount: criticals.length, summary: `QA ${Math.round(score * 100)}/100${issues.length ? ` — ${issues.length} obs (${criticals.length} críticas)` : ' — sin observaciones'}` };
}

module.exports = { auditLanding, CHECKS };
