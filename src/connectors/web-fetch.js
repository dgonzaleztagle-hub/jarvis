/**
 * web-fetch.js — Fetches a URL and extracts structured content for the LLM.
 *
 * Two tools:
 *   web.fetch     — fetch any URL, return readable content + key metadata
 *   web.audit_seo — full SEO audit: metadata + headings + images + robots + sitemap
 *
 * Raw HTML never reaches the LLM. All extraction happens here in Node.
 * Output is kept under ~600 tokens to stay lean in the context window.
 */

'use strict';

const DEFAULT_TIMEOUT_MS = 12000;
const TEXT_EXCERPT_CHARS = 1200;

/* ─── HTML PARSING HELPERS ─────────────────────────────────────────────────── */

function extractTag(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m ? stripTags(m[1]).trim() : null;
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1].trim();
  // Also try content-first order
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : null;
}

function extractMetaProperty(html, property) {
  const re = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1].trim();
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : null;
}

function extractAllTags(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1]).replace(/\s+/g, ' ').trim();
    if (text) results.push(text);
  }
  return results;
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (m) return m[1].trim();
  const m2 = html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m2 ? m2[1].trim() : null;
}

function extractImages(html) {
  const re = /<img([^>]+)>/gi;
  let total = 0;
  let missingAlt = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    total++;
    const attrs = m[1];
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    if (!altMatch || altMatch[1].trim() === '') missingAlt++;
  }
  return { total, missingAlt };
}

function extractJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const types = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      const type = obj['@type'] || (Array.isArray(obj) ? obj.map(o => o['@type']).join(',') : null);
      if (type) types.push(type);
    } catch (_) {}
  }
  return types;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextExcerpt(html) {
  // Remove head, nav, footer, scripts, styles — keep body content
  let body = html
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');
  const text = stripTags(body);
  return text.length > TEXT_EXCERPT_CHARS ? text.slice(0, TEXT_EXCERPT_CHARS) + '...' : text;
}

/* ─── FETCH HELPERS ────────────────────────────────────────────────────────── */

async function fetchUrl(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Jarvis/1.0 (research assistant; +https://jarvis.local)' }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  try {
    const r = await fetchUrl(url);
    return r.ok ? r.body : null;
  } catch (_) {
    return null;
  }
}

/* ─── TOOL: web.fetch ───────────────────────────────────────────────────────── */

async function executeFetch({ url }) {
  let res;
  try {
    res = await fetchUrl(url);
  } catch (err) {
    return { ok: false, error: err.message, url };
  }

  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url };

  const html = res.body;
  const title       = extractTag(html, 'title');
  const description = extractMeta(html, 'description');
  const h1s         = extractAllTags(html, 'h1');
  const h2s         = extractAllTags(html, 'h2').slice(0, 6);
  const excerpt     = extractTextExcerpt(html);

  return {
    ok: true,
    url,
    title,
    description,
    h1: h1s[0] || null,
    h2s,
    excerpt,
  };
}

/* ─── TOOL: web.audit_seo ───────────────────────────────────────────────────── */

async function executeAuditSeo({ url }) {
  const base = new URL(url);
  const origin = base.origin;

  // Fetch main page + robots.txt + sitemap in parallel
  const [pageRes, robotsBody, sitemapBody] = await Promise.all([
    fetchUrl(url).catch(err => ({ ok: false, error: err.message })),
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap.xml`),
  ]);

  if (!pageRes.ok) return { ok: false, error: pageRes.error || `HTTP ${pageRes.status}`, url };

  const html = pageRes.body;

  // Metadata
  const title       = extractTag(html, 'title');
  const description = extractMeta(html, 'description');
  const canonical   = extractCanonical(html);
  const ogTitle     = extractMetaProperty(html, 'og:title');
  const ogDesc      = extractMetaProperty(html, 'og:description');

  // Structure
  const h1s  = extractAllTags(html, 'h1');
  const h2s  = extractAllTags(html, 'h2').slice(0, 8);
  const h3s  = extractAllTags(html, 'h3').slice(0, 10);
  const imgs = extractImages(html);

  // Schema
  const schemaTypes = extractJsonLd(html);

  // Sitemap URLs
  let sitemapUrls = [];
  if (sitemapBody) {
    const urlMatches = sitemapBody.match(/<loc>([^<]+)<\/loc>/g) || [];
    sitemapUrls = urlMatches.map(m => m.replace(/<\/?loc>/g, '').trim()).slice(0, 20);
  }

  // Issues detected
  const issues = [];
  if (!title)                           issues.push('Sin title tag');
  if (title && title.length > 60)       issues.push(`Title largo (${title.length} chars, recomendado <60)`);
  if (!description)                     issues.push('Sin meta description');
  if (description && description.length > 160) issues.push(`Description larga (${description.length} chars, recomendado <160)`);
  if (h1s.length === 0)                 issues.push('Sin H1');
  if (h1s.length > 1)                   issues.push(`${h1s.length} H1s — debería haber solo 1`);
  if (imgs.missingAlt > 0)              issues.push(`${imgs.missingAlt} imágenes sin alt text`);
  if (!canonical)                       issues.push('Sin canonical tag');
  if (schemaTypes.length === 0)         issues.push('Sin schema markup (JSON-LD)');
  if (!ogTitle)                         issues.push('Sin Open Graph tags');
  if (!sitemapBody)                     issues.push('Sin sitemap.xml');

  return {
    ok: true,
    url,
    metadata: {
      title,
      titleLength: title?.length || 0,
      description,
      descriptionLength: description?.length || 0,
      canonical,
      ogTitle,
      ogDescription: ogDesc,
    },
    headings: { h1: h1s, h2: h2s, h3: h3s },
    images: imgs,
    schema: schemaTypes.length > 0 ? schemaTypes : null,
    robotsTxt: robotsBody ? robotsBody.slice(0, 600) : null,
    sitemapUrls,
    issues,
    score: Math.max(0, 100 - issues.length * 10),
  };
}

/* ─── TOOL: web.search ──────────────────────────────────────────────────────── */

async function executeSearch({ query, maxResults = 8 }) {
  if (!query) throw new Error('WEB_SEARCH_REQUIRES_QUERY');
  const q = encodeURIComponent(String(query).trim());
  const limit = Math.min(Number(maxResults) || 8, 20);

  // DuckDuckGo HTML scrape — sin API key, sin tracking
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  let res;
  try {
    res = await fetchUrl(url, 15000);
  } catch (err) {
    return { ok: false, error: err.message, results: [] };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, results: [] };

  // Extraer resultados del HTML de DDG
  const html = res.body;
  const results = [];
  const resultRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [];
  let sm;
  while ((sm = snippetRe.exec(html)) !== null) {
    snippets.push(stripTags(sm[1]).trim());
  }
  let rm; let i = 0;
  while ((rm = resultRe.exec(html)) !== null && results.length < limit) {
    const rawUrl = rm[1];
    const title = stripTags(rm[2]).trim();
    if (!title || !rawUrl) continue;
    // DDG wraps URLs in redirects — extraer URL real
    let href = rawUrl;
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try { href = decodeURIComponent(uddgMatch[1]); } catch (_) {}
    }
    if (!href.startsWith('http')) continue;
    results.push({ title, url: href, snippet: snippets[i] || '' });
    i++;
  }

  return { ok: true, query, results };
}

/* ─── EXPORTS ───────────────────────────────────────────────────────────────── */

function createWebFetchTools() {
  return [
    {
      name: 'web.fetch',
      description: 'Fetch a URL and return its readable content: title, description, headings, and a text excerpt. Use for reading articles, documentation, or any web page. Does NOT return raw HTML.',
      risk: 'low',
      permissions: [],
      required: ['url'],
      fetchesExternalContent: true,
      execute: executeFetch,
    },
    {
      name: 'web.audit_seo',
      description: 'Run a full SEO technical audit on a URL. Returns metadata quality, heading structure, image alt coverage, schema markup, robots.txt, sitemap URLs, and a list of detected issues with a score. Use when asked to analyze or audit a website for SEO.',
      risk: 'low',
      permissions: [],
      required: ['url'],
      fetchesExternalContent: true,
      execute: executeAuditSeo,
    },
    {
      name: 'web.search',
      description: 'Buscar en internet y obtener los primeros resultados relevantes (título, URL, resumen) sin necesidad de API key. Input: { query: "qué buscar", maxResults?: número (default 8, máx 20) }. Úsalo para investigar servicios, encontrar documentación, buscar servidores MCP, o responder preguntas que requieren información actualizada.',
      risk: 'low',
      permissions: [],
      required: ['query'],
      aliases: {
        query: ['buscar', 'busca', 'search', 'q', 'consulta'],
        maxResults: ['max_results', 'limit', 'count', 'n']
      },
      fetchesExternalContent: true,
      execute: executeSearch,
    },
  ];
}

module.exports = { createWebFetchTools, executeAuditSeo, fetchUrl, fetchText, extractJsonLd, extractAllTags, stripTags };
