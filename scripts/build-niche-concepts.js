#!/usr/bin/env node
/*
 * Build-time: extrae la librería de conceptos por nicho desde los prompts de
 * HojaCero (auditoria_prompts/batch_*.sql, tabla demo_prompts) y la materializa
 * en src/design/niche-concepts.js — así Jarvis NO depende de Supabase en runtime
 * (local-first / white-label offline). Limpia el ruido específico de HojaCero
 * (READ BIBLIA, OBEY seeds, rutas de archivo) y conserva la sustancia de
 * contenido: CONCEPT, KEYWORDS, VOICE, HERO, SECTIONS, COLOR STRATEGY.
 *
 * Uso: node scripts/build-niche-concepts.js [rutaHojacero]
 */
const fs = require('fs');
const path = require('path');

const HOJACERO = process.argv[2] || 'C:/proyectos/hojacero';
const SRC_DIR = path.join(HOJACERO, 'auditoria_prompts');
const OUT = path.join(__dirname, '..', 'src', 'design', 'niche-concepts.js');

// batch_7 tiene una versión _FIXED que reemplaza a la original.
const FILES = [
  'batch_1_gastro_turismo.sql', 'batch_2_moda_auto.sql', 'batch_3_legal_realestate.sql',
  'batch_4_tech_consulting.sql', 'batch_5_salud_educacion.sql', 'batch_6_construction_fitness.sql',
  'batch_7_new_categories_FIXED.sql'
];

// Líneas-ruido propias del pipeline HojaCero que NO aplican a Jarvis.
const NOISE = /(READ ".*BIBLIA|READ ".*creative-director|READ "creative-director|CORE DIRECTIVE|OBEY|FOLLOW the Layout|Its principles are LAW|\.agent\\skills|d:\\proyectos|c:\\proyectos)/i;

function cleanContent(raw) {
  return raw
    .replace(/''/g, "'") // SQL unescape
    .split(/\r?\n/)
    .filter((line) => !NOISE.test(line))
    // colapsa separadores de comentario "-- ====" repetidos
    .filter((line) => !/^--\s*=+\s*$/.test(line.trim()))
    .map((line) => line.replace(/^--\s?/, '').replace(/\s+$/, '')) // saca prefijo "-- "
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function field(content, key) {
  const m = content.match(new RegExp(`${key}\\s*:\\s*(.+)`, 'i'));
  return m ? m[1].trim() : '';
}

function nicheFromDesc(desc) {
  const m = desc.match(/\(([^-)]+)/); // "Swiss Authority (Legal - ..." -> "Legal "
  return (m ? m[1] : '').trim().toLowerCase();
}

const concepts = [];
for (const file of FILES) {
  const full = path.join(SRC_DIR, file);
  if (!fs.existsSync(full)) { console.warn(`(falta ${file})`); continue; }
  const sql = fs.readFileSync(full, 'utf-8');

  // Mapa nombre -> { niche, subtype } desde los headers "-- N. Nombre (Niche - Subtype)".
  const nicheByName = {};
  for (const h of sql.matchAll(/^--\s*\d+\.\s*(.+?)\s*\(([^)]+)\)/gm)) {
    const parts = h[2].split('-').map((s) => s.trim());
    nicheByName[h[1].trim().toLowerCase()] = { niche: (parts[0] || '').toLowerCase(), subtype: (parts[1] || '').toLowerCase() };
  }

  const re = /SET content = '([\s\S]*?)'\s*WHERE description LIKE '%([^%]+)%'/g;
  let mm;
  while ((mm = re.exec(sql)) !== null) {
    const content = cleanContent(mm[1]);
    const name = mm[2].trim();
    if (!content || content.length < 40) continue;
    const tag = nicheByName[name.toLowerCase()] || { niche: '', subtype: '' };
    concepts.push({
      name,
      niche: tag.niche,
      subtype: tag.subtype,
      keywords: field(content, 'KEYWORDS'),
      color: field(content, 'COLOR STRATEGY'),
      content
    });
  }
}

const header = `// AUTOGENERADO por scripts/build-niche-concepts.js desde los prompts por nicho
// de HojaCero (IP de Daniel). NO editar a mano — re-correr el script. Es la capa
// de CONTENIDO (concepto, voz, hero, secciones) que complementa la capa VISUAL
// de landing-design-system.js. Embarcado para que Jarvis trabaje offline.

`;
const body = `module.exports = ${JSON.stringify(concepts, null, 2)};\n`;
fs.writeFileSync(OUT, header + body, 'utf-8');
console.log(`Extraídos ${concepts.length} conceptos -> ${path.relative(process.cwd(), OUT)}`);
console.log(concepts.map((c) => `  • ${c.name}`).join('\n'));
