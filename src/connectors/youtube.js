/**
 * youtube.js — YouTube search without an API key or third-party package.
 */
'use strict';

function decodeUnicodeEscapes(value = '') {
  return String(value).replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanTitle(value = '') {
  return decodeUnicodeEscapes(value)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFirstVideo(html = '') {
  const text = String(html || '');
  const seen = new Set();
  const patterns = [
    /"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1200}?"title":\{"runs":\[\{"text":"([^"]+)"/g,
    /"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1200}?"title":\{"simpleText":"([^"]+)"/g,
    /\/watch\?v=([a-zA-Z0-9_-]{11})/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const videoId = match[1];
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      return {
        videoId,
        title: cleanTitle(match[2] || 'YouTube video'),
        url: `https://www.youtube.com/watch?v=${videoId}`
      };
    }
  }
  return null;
}

/**
 * Search YouTube and return the first video result.
 * @param {string} query
 * @param {{fetchImpl?: Function}} options
 * @returns {Promise<{videoId:string, title:string, url:string}|null>}
 */
async function searchYoutube(query, options = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  try {
    const res = await fetchImpl(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.7'
      }
    });
    if (!res?.ok) return null;
    const html = await res.text();
    return parseFirstVideo(html);
  } catch (_) {
    return null;
  }
}

module.exports = { parseFirstVideo, searchYoutube };
