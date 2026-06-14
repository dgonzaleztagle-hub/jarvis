/**
 * youtube.js — YouTube search via yt-search (no API key required).
 */
'use strict';
const yts = require('yt-search');

/**
 * Search YouTube and return the first video result.
 * @param {string} query
 * @returns {Promise<{videoId:string, title:string, url:string}|null>}
 */
async function searchYoutube(query) {
  try {
    const result = await yts(query);
    const video  = result?.videos?.[0];
    if (!video?.videoId) return null;
    return {
      videoId: video.videoId,
      title:   video.title,
      url:     `https://www.youtube.com/watch?v=${video.videoId}`,
    };
  } catch (_) {
    return null;
  }
}

module.exports = { searchYoutube };
