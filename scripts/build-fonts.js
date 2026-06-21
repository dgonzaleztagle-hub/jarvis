#!/usr/bin/env node
/*
 * Build-time: descarga los woff2 (subset latin) de las Google Fonts que usa el
 * sistema de diseño de landings y arma public/vendor/fonts.css + los .woff2
 * locales. Así el .exe white-label renderiza con tipografía premium SIN red.
 * Re-correr si cambian las fuentes en landing-design-system.js.
 *
 * Uso: node scripts/build-fonts.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'public', 'vendor', 'fonts');
const CSS_OUT = path.join(__dirname, '..', 'public', 'vendor', 'fonts.css');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Familias + pesos que usa landing-design-system.js (TYPOGRAPHY).
const FAMILIES = [
  ['Playfair Display', 'wght@400;700;800'],
  ['Inter', 'wght@400;500;600;700'],
  ['Space Grotesk', 'wght@400;500;700'],
  ['JetBrains Mono', 'wght@400;700'],
  ['Outfit', 'wght@400;500;600;700;800'],
  ['DM Sans', 'wght@400;500;700'],
  ['Bebas Neue', 'wght@400'],
  ['Lora', 'ital,wght@0,400;0,600;1,400'],
  ['Archivo', 'wght@400;500;700']
];

function get(url, opts = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA }, ...opts }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location, opts));
      }
      if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} ${url.slice(0, 80)}`));
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let css = '/* AUTOGENERADO por scripts/build-fonts.js — fuentes locales (offline) de Google Fonts. */\n';
  let downloaded = 0;

  for (const [family, axis] of FAMILIES) {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axis}&display=swap`;
    let sheet;
    try { sheet = (await get(url)).toString('utf-8'); }
    catch (e) { console.warn(`  ! ${family}: ${e.message}`); continue; }

    // Bloques: /* subset */ @font-face { ... }
    const blocks = [...sheet.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[\s\S]*?\})/g)];
    let idx = 0;
    for (const [, subset, block] of blocks) {
      if (subset !== 'latin') continue; // solo latin para acotar peso
      const srcM = block.match(/src:\s*url\((https:\/\/[^)]+\.woff2)\)/);
      if (!srcM) continue;
      const weightM = block.match(/font-weight:\s*([^;]+);/);
      const styleM = block.match(/font-style:\s*([^;]+);/);
      const weight = (weightM ? weightM[1] : '400').trim();
      const italic = styleM && /italic/.test(styleM[1]);
      const fileName = `${slug(family)}-${weight.replace(/\s+/g, '')}${italic ? '-italic' : ''}-${idx++}.woff2`;
      try {
        const buf = await get(srcM[1]);
        fs.writeFileSync(path.join(OUT_DIR, fileName), buf);
        downloaded += 1;
      } catch (e) { console.warn(`  ! ${family} ${weight}: ${e.message}`); continue; }
      // Reescribe el bloque apuntando al woff2 local.
      css += block.replace(srcM[1], `/public/vendor/fonts/${fileName}`) + '\n';
    }
    console.log(`  ${family}: ok`);
  }

  fs.writeFileSync(CSS_OUT, css, 'utf-8');
  const total = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.woff2')).length;
  console.log(`\nDescargados ${downloaded} woff2 | ${total} en disco -> ${path.relative(process.cwd(), CSS_OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
