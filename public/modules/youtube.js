/**
 * youtube.js — YouTube search and playback.
 * Uses the server's /youtube/search proxy (calls Invidious, no API key, no CORS issues).
 */
import { api } from './api.js';

/**
 * Search YouTube and return the best match.
 * @param {string} query
 * @returns {Promise<{videoId:string, title:string, url:string}|null>}
 */
export async function searchYoutube(query) {
  try {
    return await api(`/youtube/search?q=${encodeURIComponent(query)}`);
  } catch (_) {
    return null;
  }
}

/**
 * Open the first YouTube result for `query` in a new tab.
 * Falls back to the YouTube search results page if the server search fails.
 * @param {string} query
 * @returns {Promise<{videoId:string, title:string, url:string}|null>}
 */
export async function playYoutube(query) {
  const result = await searchYoutube(query);
  const url = result?.url || `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  window.open(url, '_blank', 'noopener');
  return result;
}
