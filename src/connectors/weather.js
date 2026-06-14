/**
 * weather.js — Open-Meteo connector (free, no API key)
 * Returns current temperature + condition for a given lat/lon.
 * Default coordinates: Santiago, Chile.
 */
const https = require('https');

const DEFAULT_LAT = -33.45;
const DEFAULT_LON = -70.65;
const DEFAULT_TZ  = 'America%2FSantiago';

// WMO Weather Interpretation Codes → Spanish description
const WMO = {
  0:  'despejado',
  1:  'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'con niebla', 48: 'con niebla helada',
  51: 'con llovizna ligera', 53: 'con llovizna', 55: 'con llovizna intensa',
  61: 'con lluvia ligera', 63: 'con lluvia', 65: 'con lluvia intensa',
  71: 'con nieve ligera', 73: 'con nieve', 75: 'con nieve intensa',
  77: 'con granizo fino',
  80: 'con chubascos', 81: 'con chubascos moderados', 82: 'con chubascos fuertes',
  85: 'con nevadas', 86: 'con nevadas intensas',
  95: 'con tormenta', 96: 'con tormenta y granizo', 99: 'con tormenta y granizo fuerte',
};

function wmoDescription(code) {
  if (WMO[code]) return WMO[code];
  // fallback: try rounded-down code (e.g. 61→ captured above, but future codes)
  const rounded = Math.floor(code / 10) * 10;
  return WMO[rounded] || 'variable';
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Weather JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Weather request timeout')); });
  });
}

/**
 * @param {{ lat?: number, lon?: number }} opts
 * @returns {Promise<{ temp: number, condition: string }>}
 */
async function getWeather({ lat = DEFAULT_LAT, lon = DEFAULT_LON } = {}) {
  const url = [
    'https://api.open-meteo.com/v1/forecast',
    `?latitude=${lat}&longitude=${lon}`,
    `&current=temperature_2m,weathercode`,
    `&timezone=${DEFAULT_TZ}`,
    `&forecast_days=1`
  ].join('');

  const data  = await fetchJson(url);
  const temp  = Math.round(data.current?.temperature_2m ?? NaN);
  const code  = data.current?.weathercode ?? 0;

  return {
    temp,
    condition: wmoDescription(code),
  };
}

module.exports = { getWeather };
