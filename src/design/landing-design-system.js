// Sistema de diseño de landings — destilado del sistema creativo de HojaCero
// (IP de Daniel: creative-director-h0 + BIBLIA + ADN visual). Adaptado a la
// generación SINGLE-FILE de Jarvis (un HTML autocontenido con Tailwind), así que
// se deja fuera el arsenal React/Three.js y se traducen "motion" y "cosmética" a
// lo que un archivo con Tailwind + CSS + Google Fonts puede entregar premium.
//
// Objetivo (visión HojaCero): "WOW por defecto" — el sitio debe parecer pieza de
// colección, no herramienta genérica. Para eso: nicho → motor de variabilidad
// (anti-plantilla, con dados) → compatibility check → Wow Layering.

// ── Motor de variabilidad (las tablas de "tirar los dados") ────────────────────
const LAYOUTS = [
  { name: 'Asimetría Radical', desc: 'elementos desalineados a propósito, superposiciones, mucho aire negativo', vibe: 'editorial, moda, arte' },
  { name: 'Brutalist Grid', desc: 'líneas divisorias visibles (borders gruesos), tipografía gigante, sin esquinas suaves', vibe: 'arquitectura, streetwear, tech' },
  { name: 'Fluid Magazine', desc: 'imágenes/bloques que rompen la rejilla, texto que fluye alrededor, ritmo de revista', vibe: 'turismo, gastronomía, lifestyle' },
  { name: 'Cinematic Fullscreen', desc: 'cada sección ocupa ~100vh con scroll-snap, inmersión total', vibe: 'cine, eventos, lujo' },
  { name: 'Swiss Minimal', desc: 'grilla matemática perfecta, mucho espacio negativo, tipografía precisa', vibe: 'clínica, legal, consultoría' },
  { name: 'Chaos Collage', desc: 'elementos levemente rotados, texturas, superposiciones tipo scrapbook', vibe: 'creativos, tiendas locales, comida' }
];

// Tipografías → fuentes reales de Google Fonts (para que el modelo las cargue).
const TYPOGRAPHY = [
  { name: 'The Diplomat', header: 'Playfair Display', body: 'Inter', vibe: 'autoridad, lujo, tradición' },
  { name: 'The Disruptor', header: 'Space Grotesk', body: 'JetBrains Mono', vibe: 'tech, startups, moderno' },
  { name: 'The Friendly', header: 'Outfit', body: 'DM Sans', vibe: 'mascotas, panaderías, cercano' },
  { name: 'The Editorial', header: 'Bebas Neue', body: 'Lora', vibe: 'moda, noticias, blogs' },
  { name: 'The Industrial', header: 'Space Grotesk', body: 'Archivo', vibe: 'construcción, mecánica, gym' }
];

// Motion traducido a lo que un single-file puede hacer bien (CSS transitions,
// keyframes de revelado, scroll-snap, hover; nada de GSAP/WebGL).
const MOTION = [
  { name: 'Liquid Flow', desc: 'transiciones suaves y lentas (ease cubic-bezier .76,0,.24,1), elementos que flotan al hover, revelados con fade+translate al cargar', vibe: 'lujo, spa, calma' },
  { name: 'Snap & Punch', desc: 'entradas rápidas y marcadas, hover con escala y sombra fuerte, CTAs que "golpean"', vibe: 'deportes, ofertas, acción' },
  { name: 'Theater Curtain', desc: 'secciones que se revelan con máscaras/clip-path al entrar, telón tipográfico', vibe: 'restaurantes, teatro, cine' },
  { name: 'Solid Ground', desc: 'movimiento mínimo y sobrio, solo micro-transiciones de hover; nada llamativo', vibe: 'institucional, legal, banca, salud' }
];

const COLOR = [
  { name: 'Monocromo Puro', desc: 'blanco/negro + UN acento mínimo; elegancia extrema' },
  { name: 'Neón Tóxico', desc: 'fondo oscuro con acentos saturados (cian/magenta/lime); alto voltaje' },
  { name: 'Pastel Suave', desc: 'colores deslavados, bajo contraste, sensación de nube' },
  { name: 'Deep Earth', desc: 'tonos oscuros pero cálidos (café, terracota, verde bosque); NUNCA negro puro' },
  { name: 'Corporate Cold', desc: 'azules profundos, grises acero, blancos fríos' }
];

const SERIOUS_HINT = { layouts: ['Swiss Minimal', 'Brutalist Grid', 'Cinematic Fullscreen'], typo: ['The Diplomat', 'The Industrial', 'The Disruptor'], motion: ['Solid Ground'], color: ['Monocromo Puro', 'Corporate Cold', 'Deep Earth'] };
const CREATIVE_HINT = { layouts: ['Asimetría Radical', 'Fluid Magazine', 'Chaos Collage', 'Cinematic Fullscreen'], typo: ['The Editorial', 'The Friendly', 'The Disruptor', 'The Diplomat'], motion: ['Liquid Flow', 'Snap & Punch', 'Theater Curtain'], color: ['Deep Earth', 'Neón Tóxico', 'Pastel Suave', 'Monocromo Puro'] };

// ── Capa de CONTENIDO: librería de conceptos por nicho (extraída de HojaCero) ───
const NICHE_CONCEPTS = require('./niche-concepts');

// Términos (es-CL) que mapean un brief a uno de los 12 nichos de la librería.
const NICHE_KEYWORDS = {
  'gastronomía': ['restaurant', 'restaurante', 'café', 'cafeter', 'cocina', 'gastro', 'bar', 'comida', 'menú', 'chef', 'pasteler', 'panader', 'food', 'sushi', 'pizz', 'parrilla'],
  'turismo': ['turismo', 'hotel', 'hostal', 'viaje', 'tour', 'cabañas', 'lodge', 'destino', 'aventura', 'travel'],
  'moda': ['moda', 'ropa', 'tienda de ropa', 'fashion', 'streetwear', 'boutique', 'diseño de vestuario', 'marca de ropa', 'accesorios'],
  'automotriz': ['auto', 'automotriz', 'vehículo', 'taller mecánic', 'concesionari', 'tuning', 'car', 'neumátic', 'repuestos'],
  'legal': ['abogad', 'legal', 'jurídic', 'estudio jurídico', 'notarí', 'litig', 'penal', 'derecho', 'law'],
  'real estate': ['inmobiliari', 'propiedad', 'bienes raíces', 'real estate', 'corredora', 'arriendo', 'depto', 'departamento', 'casa en venta', 'proyecto inmobiliario', 'edificio'],
  'tech': ['saas', 'software', 'app', 'startup', 'plataforma', 'api', 'dev', 'tecnológic', 'fintech', 'ciberseguridad'],
  'consultoría': ['consultor', 'asesorí', 'coaching', 'estrategia', 'capacitación', 'consultora', 'agencia de consult'],
  'salud': ['clínic', 'salud', 'médic', 'dental', 'dentista', 'kinesi', 'spa', 'bienestar', 'psicólog', 'nutri', 'estétic'],
  'educación': ['colegio', 'escuela', 'educac', 'curso', 'bootcamp', 'academia', 'instituto', 'edtech', 'preuniversitario', 'jardín infantil'],
  'construcción': ['construc', 'constructora', 'remodelac', 'arquitect', 'obra', 'edificación', 'ingeniería civil', 'maestro'],
  'fitness': ['gimnasio', 'gym', 'fitness', 'crossfit', 'yoga', 'pilates', 'entrenamiento', 'box', 'personal trainer']
};

// Nichos que por defecto van por la rama SERIOUS del motor de variabilidad.
const SERIOUS_NICHES = new Set(['legal', 'real estate', 'tech', 'consultoría', 'salud', 'construcción']);

// Señales en español por concepto: los subtipos de la librería vienen en inglés
// (corporate/big firm), así que esto permite que un brief en es-CL elija el
// concepto FINO correcto dentro del nicho (ej: "abogado penal" → Legal Drama).
const SUBTYPE_SIGNALS = {
  'Midnight Theatre': ['noche', 'nocturn', 'exclusiv', 'coctel', 'cóctel', 'cena', 'elegante', 'fine dining'],
  'Tuscan Warmth': ['rústic', 'rustic', 'familiar', 'casero', 'tradicional', 'almuerzo', 'trattoria', 'hogareñ'],
  'Avant-Garde Lab': ['experimental', 'autor', 'vanguardia', 'moderno', 'molecular', 'especialidad', 'degustación'],
  'Wanderlust Cinema': ['aventura', 'naturaleza', 'trekking', 'montañ', 'outdoor', 'expedición', 'patagonia'],
  'Local Insider': ['ciudad', 'urbano', 'cultura', 'city tour', 'local', 'barrio'],
  'Luxury Escape': ['hotel', 'lujo', 'resort', 'boutique', 'cabañas', 'cinco estrellas', 'exclusiv'],
  'Runway Editorial': ['alta costura', 'minimalista', 'editorial', 'pasarela', 'diseñador', 'atelier'],
  'Lifestyle Brand': ['lifestyle', 'comercial', 'casual', 'accesible', 'cotidian'],
  'Streetwear Drop': ['streetwear', 'urban', 'hype', 'drop', 'sneaker', 'calle', 'cápsula'],
  'Performance Theatre': ['deportiv', 'tuning', 'performance', 'carrera', 'potencia', 'racing'],
  'Trusted Dealer': ['concesionari', 'venta', 'familiar', 'confiable', 'usados', 'financiamiento'],
  'Collector Gallery': ['clásic', 'colección', 'vintage', 'lujo', 'exclusiv', 'coleccionista'],
  'Swiss Authority': ['corporativ', 'empresas', 'transaccion', 'firma', 'internacional', 'sociedades', 'tributari'],
  'Legal Drama': ['penal', 'litig', 'juicio', 'demanda', 'criminal', 'defensa', 'tribunal'],
  'TechLaw': ['startup', 'patente', 'propiedad intelectual', 'innovación', 'tecnológic', 'marcas'],
  'Architectural Luxury': ['lujo', 'exclusiv', 'arquitect', 'premium', 'alto estándar', 'penthouse'],
  'Interactive Map': ['proyecto', 'sector', 'mapa', 'desarrollo', 'loteo', 'condominio'],
  'Investment Dashboard': ['inversión', 'comercial', 'rentabilidad', 'oficinas', 'renta', 'plusvalía'],
  'Product-Led Growth': ['saas', 'producto', 'plataforma', 'suscripción', 'onboarding'],
  'Developer First': ['api', 'developer', 'devtools', 'sdk', 'código', 'integración', 'documentación'],
  'Enterprise Trust': ['enterprise', 'seguridad', 'compliance', 'corporativ', 'infraestructura'],
  'Transformation Story': ['estrategia', 'transformación', 'cambio', 'estratégic'],
  'Workshop Energy': ['capacitación', 'taller', 'agile', 'entrenamiento', 'workshop', 'facilitación'],
  'Thought Leader': ['marca personal', 'conferencista', 'speaker', 'experto', 'autor', 'mentor'],
  'Future Clinical': ['clínic', 'centro médico', 'moderno', 'tecnológic', 'imagenología', 'especialidades'],
  'Holistic Wellness': ['spa', 'bienestar', 'holístic', 'terapia', 'relajación', 'masaje', 'alternativa'],
  'Smile Gallery': ['dental', 'dentista', 'sonrisa', 'estétic', 'ortodoncia', 'implante'],
  'Future Learning': ['edtech', 'online', 'plataforma', 'digital', 'e-learning'],
  'Career Accelerator': ['bootcamp', 'profesional', 'carrera', 'intensivo', 'empleabilidad', 'diplomado'],
  'Learning Platform': ['colegio', 'escuela', 'niñ', 'infantil', 'jardín', 'preescolar', 'kínder'],
  'Master Builder': ['residencial', 'casa', 'premium', 'alto estándar', 'vivienda', 'mansión'],
  'TechBuild': ['comercial', 'ingeniería', 'obra', 'industrial', 'edificio', 'infraestructura'],
  'Heritage Craftsman': ['remodelación', 'renovación', 'restauración', 'artesanal', 'patrimonial', 'ampliación'],
  'Transformation Energy': ['crossfit', 'intensidad', 'funcional', 'hiit', 'box', 'wod'],
  'Wellness Sanctuary': ['yoga', 'pilates', 'bienestar', 'meditación', 'relajación', 'mindfulness'],
  'Performance Lab': ['rendimiento', 'ciencia', 'atleta', 'performance', 'kinesi', 'deportiv']
};

function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
// Términos largos = match por prefijo/raíz (cafeter→cafetería); términos cortos
// (≤4) = palabra COMPLETA, para que "bar" no matchee "barrio" ni "spa" "espacio".
function tokenScore(brief, tokens) {
  const s = norm(brief);
  let score = 0;
  for (const raw of tokens) {
    const t = norm(raw);
    if (!t) continue;
    const re = t.length <= 4 ? new RegExp(`\\b${t}\\b`) : new RegExp(`\\b${t}`);
    if (re.test(s)) score += 1;
  }
  return score;
}

// Elige el concepto de contenido que mejor calza con el brief. Primero detecta el
// nicho; dentro del nicho, afina por subtype/keywords; empates → al azar (varía).
function matchConcept(brief = '') {
  let bestNiche = null;
  let bestNicheScore = 0;
  for (const [niche, kws] of Object.entries(NICHE_KEYWORDS)) {
    const sc = tokenScore(brief, kws);
    if (sc > bestNicheScore) { bestNicheScore = sc; bestNiche = niche; }
  }
  if (!bestNiche) return null;

  const candidates = NICHE_CONCEPTS.filter((c) => c.niche === bestNiche);
  if (candidates.length === 0) return null;

  let best = [];
  let bestScore = -1;
  for (const c of candidates) {
    // Señales en español (peso x2, son las más precisas) + tokens del subtipo/keywords en inglés.
    const enTokens = `${c.subtype} ${c.keywords}`.toLowerCase().split(/[\s,/]+/).filter((t) => t.length > 3);
    const sc = tokenScore(brief, SUBTYPE_SIGNALS[c.name] || []) * 2 + tokenScore(brief, enTokens);
    if (sc > bestScore) { bestScore = sc; best = [c]; }
    else if (sc === bestScore) best.push(c);
  }
  return pick(best); // empate → variabilidad (deja variar el ángulo dentro del nicho)
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickWhere(arr, names) {
  const pool = arr.filter((x) => names.includes(x.name));
  return pick(pool.length ? pool : arr);
}

// Tira los dados sesgando por nicho (pero sin clavar siempre lo mismo): da una
// dirección sugerida que el modelo puede ajustar si choca con el rubro.
function rollSeeds(niche) {
  const hint = niche === 'SERIOUS' ? SERIOUS_HINT : CREATIVE_HINT;
  return {
    layout: pickWhere(LAYOUTS, hint.layouts),
    typography: pickWhere(TYPOGRAPHY, hint.typo),
    motion: pickWhere(MOTION, hint.motion),
    color: pickWhere(COLOR, hint.color)
  };
}

// Heurística rápida de nicho desde el brief (el modelo igual reclasifica si hace
// falta; esto solo sesga los dados).
function guessNiche(brief = '') {
  const s = String(brief).toLowerCase();
  const serious = /(abogad|legal|jurídic|clínic|salud|médic|laboratori|finanz|banc|seguro|consultor|notarí|contador|ingenier|industrial|b2b|corporativ)/;
  return serious.test(s) ? 'SERIOUS' : 'CREATIVE';
}

// Construye la directiva de diseño que se antepone al prompt de generación.
// brandColors opcional: { primary, secondary, ... } para forzar paleta de marca.
function buildDesignDirective({ brief = '', brandColors = null } = {}) {
  // Capa de contenido: concepto por nicho (HojaCero). Si calza, además define si
  // el motor visual va por la rama SERIOUS o CREATIVE.
  const concept = matchConcept(brief);
  const niche = concept ? (SERIOUS_NICHES.has(concept.niche) ? 'SERIOUS' : 'CREATIVE') : guessNiche(brief);
  const seeds = rollSeeds(niche);

  const conceptBlock = concept ? `

CONCEPTO DE CONTENIDO — "${concept.name}" (calza con el rubro "${concept.niche}${concept.subtype ? ` / ${concept.subtype}` : ''}"). Gobierna el QUÉ se dice: la voz, el hero, las secciones y el ángulo. La dirección de arte de arriba gobierna el CÓMO se ve y MANDA si hay conflicto visual. Adáptalo al cliente concreto del brief (nombre, ciudad, detalles) en español de Chile; las "SECTIONS" son la espina dorsal; traduce cualquier "IMAGES/ASSET DIRECTION" a color, gradientes y formas (no uses imágenes externas):
${concept.content}` : '';

  const paletteLine = brandColors && (brandColors.primary || brandColors.accent)
    ? `PALETA (MARCA ACTIVA — manda sobre cualquier estrategia de color): usa EXACTAMENTE estos hex como paleta dominante, con clases Tailwind de valor arbitrario (bg-[${brandColors.primary}], text-[${brandColors.primary}], border-[${brandColors.primary}]) o CSS vars — no los "interpretes" ni los suavices. Primario ${brandColors.primary || ''} (acentos, CTA, énfasis)${brandColors.secondary ? `, secundario ${brandColors.secondary}` : ''}${brandColors.accent ? `, acento ${brandColors.accent}` : ''}. Construye fondos y neutros en armonía con ellos.`
    : `PALETA: estrategia "${seeds.color.name}" — ${seeds.color.desc}. Define 2-3 hex coherentes con el rubro y úsalos consistentes.`;

  return `Actúa como DIRECTOR CREATIVO antes de escribir una línea. Esto NO es una landing genérica: el objetivo es "WOW por defecto" — que parezca pieza de Awwwards, no plantilla. Elimina todo "olor a plantilla".

NICHO: ${niche === 'SERIOUS' ? 'SERIOUS / INSTITUCIONAL → High Fidelity Wow: física sutil, micro-interacciones, tipografía perfecta, CERO grano/distorsión/caos.' : 'CREATIVE / LIFESTYLE → High Impact Wow: tipografía display grande, composición con carácter, se permiten texturas/grano sutil y degradados.'}

DIRECCIÓN DE ARTE (dados ya tirados — síguelos salvo que choquen con el rubro; si chocan, ajusta SOLO esa variable y dilo implícitamente en el diseño):
- LAYOUT: ${seeds.layout.name} — ${seeds.layout.desc} (${seeds.layout.vibe}).
- TIPOGRAFÍA: ${seeds.typography.name} — titulares en "${seeds.typography.header}", cuerpo en "${seeds.typography.body}" (${seeds.typography.vibe}). Estas fuentes YA están cargadas localmente (no agregues <link> de Google Fonts): úsalas directo por font-family en un <style> (ej: definir clases/CSS vars y aplicarlas a títulos y cuerpo). La tipografía es el 80% del diseño: tamaños grandes y jerarquía fuerte.
- MOTION: ${seeds.motion.name} — ${seeds.motion.desc}. Hazlo solo con CSS (transitions, @keyframes de revelado, scroll-snap, hover). Nada de librerías JS.
- ${paletteLine}

WOW LAYERING (aplica en este orden, no saltes cimientos):
1. Cimientos: el sitio debe verse perfecto ESTÁTICO — contenido completo, legible, contraste correcto. El H1 nunca se ensucia con efectos.
2. Física: hover states con transición, botones con leve escala/sombra al pasar el cursor.
3. Profundidad: sombras suaves, gradientes sutiles, separación por capas.
${niche === 'CREATIVE' ? '4. Cosmética (permitida por ser CREATIVE): grano/textura sutil (vía gradientes o SVG inline), display type gigante, degradados con carácter — sin ensuciar la legibilidad.' : '4. Cosmética: PROHIBIDA en este nicho (grano, distorsión, caos). Mantén la sobriedad institucional.'}

FUNCIONES QUE LA PÁGINA DEBE CUMPLIR (manifiéstalas según el rubro, no como checklist literal): 1) CAPTURA (hero con hook visual + headline), 2) OFERTA (qué hace/vende), 3) CREDIBILIDAD (por qué confiar: años, método, fundador), 4) DIFERENCIACIÓN (por qué elegirlos), 5) VALIDACIÓN (testimonios/casos/reseñas — inventa ejemplos realistas y creíbles, jamás "lorem ipsum"), 6) CONVERSIÓN (CTA claro: reservar/contactar/cotizar).

FÍSICA DE DISEÑO (reglas duras anti-feo):
- HARD CAP: ninguna imagen/bloque visual sin un contenedor con ancho máximo explícito (max-w-*). Nada de cosas que se estiran a toda la pantalla por error.
- GRID DEFENSIVO: define un piso de columnas (ej grid-cols-2 md:grid-cols-3); no confíes en que colapse "gracioso" a lista kilométrica.
- COMPACTNESS: prohibido el espacio en blanco "gratis". Footers compactos (py-8 máx). El contenedor abraza el contenido.
- BENTO NARRATIVE: nunca muros de texto. Más de 2 párrafos → tarjetas/bento (icono o número + título + bajada).
- 12 COLUMNAS: piensa el desktop en 12 columnas, usa justify-between, evita elementos huérfanos flotando.
- CONTENIDO REAL: copy concreto y específico del rubro en español de Chile (sin acento de España), nada de relleno.
${conceptBlock}

No expliques nada de esto en la salida; tradúcelo en el HTML.`;
}

module.exports = {
  buildDesignDirective,
  matchConcept,
  rollSeeds,
  guessNiche,
  LAYOUTS,
  TYPOGRAPHY,
  MOTION,
  COLOR
};
