// Perfil de marca — el cimiento de las capacidades de marketing de Jarvis.
//
// Toda tarea de marketing (campaña, copy, landing, revisión de contenido, SEO)
// necesita saber CONTRA QUÉ se mide: la voz, la audiencia, los pilares de
// mensaje, los colores, qué decir y qué evitar. Sin este perfil, Jarvis produce
// contenido genérico sin identidad. Con él, todo lo que genera hereda la marca.
//
// Multi-marca a propósito (white-label / agencia): una misma instancia puede
// manejar varias marcas (Rishtedar, Hoja Cero, ...) y marcar una activa. Si solo
// hay una, esa es la activa por defecto — el caso de un usuario individual no
// paga complejidad.
//
// Storage local en dataDir/brand/profiles.json. Generalista: el perfil es un
// objeto de campos abiertos, no un esquema rígido — Jarvis llena lo que tenga.

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../core/atomic-json');

const PROFILES_FILE = 'brand/profiles.json';

// Campos que son listas (se fusionan acumulando, no pisando) vs escalares.
const LIST_FIELDS = ['pillars', 'keywords', 'avoid', 'colors', 'competitors'];

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function createBrandProfileTools({ dataDir }) {
  const profilesPath = path.join(dataDir, PROFILES_FILE);

  function load() {
    try {
      return JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
    } catch (_) {
      return { active: null, profiles: {} };
    }
  }

  function save(store) {
    fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
    writeJsonAtomic(profilesPath, store);
  }

  // Resuelve qué marca está activa: la marcada explícitamente, o la única que
  // exista (caso usuario individual), o null si no hay ninguna.
  function resolveActive(store) {
    if (store.active && store.profiles[store.active]) return store.active;
    const names = Object.keys(store.profiles);
    return names.length === 1 ? names[0] : null;
  }

  function formatProfile(profile) {
    if (!profile) return '';
    const lines = [`Marca: ${profile.name}`];
    if (profile.industry) lines.push(`Rubro: ${profile.industry}`);
    if (profile.voice) lines.push(`Voz/tono: ${profile.voice}`);
    if (profile.audience) lines.push(`Audiencia: ${profile.audience}`);
    if (profile.pillars?.length) lines.push(`Pilares de mensaje: ${profile.pillars.join(' · ')}`);
    if (profile.keywords?.length) lines.push(`Términos preferidos: ${profile.keywords.join(', ')}`);
    if (profile.avoid?.length) lines.push(`Evitar: ${profile.avoid.join(', ')}`);
    if (profile.colors?.length) lines.push(`Colores: ${profile.colors.join(', ')}`);
    if (profile.competitors?.length) lines.push(`Competidores: ${profile.competitors.join(', ')}`);
    if (profile.links && Object.keys(profile.links).length) {
      lines.push(`Links: ${Object.entries(profile.links).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
    }
    if (profile.notes) lines.push(`Notas: ${profile.notes}`);
    return lines.join('\n');
  }

  function mergeProfile(prev = {}, patch = {}) {
    const out = { ...prev };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) continue;
      if (LIST_FIELDS.includes(key)) {
        // Fusión acumulativa sin duplicados (case-insensitive).
        const incoming = Array.isArray(value) ? value : [value];
        const existing = Array.isArray(prev[key]) ? prev[key] : [];
        const seen = new Set(existing.map((v) => String(v).toLowerCase()));
        out[key] = [...existing];
        for (const item of incoming) {
          const s = String(item).trim();
          if (s && !seen.has(s.toLowerCase())) { out[key].push(s); seen.add(s.toLowerCase()); }
        }
      } else if (key === 'links' && typeof value === 'object') {
        out.links = { ...(prev.links || {}), ...value };
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  // Expuesto para que el ensamblador de contexto inyecte la marca activa cuando
  // el turno es de marketing/contenido (lo hace el runtime, no este módulo).
  function getActiveProfile() {
    const store = load();
    const active = resolveActive(store);
    return active ? store.profiles[active] : null;
  }

  const tools = [
    {
      name: 'brand.save',
      description: 'Crear o actualizar un perfil de marca (el cimiento para campañas, copy, landings y revisión de contenido). Input: { name (requerido), industry?, voice? (tono/personalidad), audience?, pillars? (lista de pilares de mensaje), keywords? (términos preferidos), avoid? (términos a evitar), colors?, competitors?, links? ({web, instagram, ...}), notes? }. Las listas se acumulan (no pisan). Si es la primera marca, queda activa.',
      risk: 'low',
      permissions: [],
      required: ['name'],
      execute: async (input = {}) => {
        const name = String(input.name || '').trim();
        if (!name) return { ok: false, error: 'Se requiere name.' };
        const store = load();
        const key = normalizeName(name);
        const prev = store.profiles[key] || { name, createdAt: new Date().toISOString() };
        const { name: _n, ...patch } = input;
        const merged = mergeProfile(prev, patch);
        merged.name = name;
        merged.updatedAt = new Date().toISOString();
        store.profiles[key] = merged;
        if (!store.active) store.active = key;
        save(store);
        return { ok: true, name, active: store.active === key, summary: formatProfile(merged) };
      }
    },

    {
      name: 'brand.get',
      description: 'Obtener un perfil de marca. Input opcional: { name }. Sin name, devuelve la marca activa (o la única que exista). Úsalo ANTES de generar cualquier contenido de marketing para que herede la voz, audiencia y pilares de la marca.',
      risk: 'low',
      permissions: [],
      execute: async (input = {}) => {
        const store = load();
        const key = input.name ? normalizeName(input.name) : resolveActive(store);
        const profile = key ? store.profiles[key] : null;
        if (!profile) {
          return {
            ok: false,
            error: input.name
              ? `No hay perfil para "${input.name}".`
              : 'No hay ninguna marca configurada. Usa brand.save para crear el perfil.',
            hint: 'brand.save { name, voice, audience, pillars, ... }'
          };
        }
        return { ok: true, profile, summary: formatProfile(profile) };
      }
    },

    {
      name: 'brand.list',
      description: 'Listar las marcas configuradas (nombre, rubro y cuál está activa). Útil cuando se manejan varias marcas.',
      risk: 'low',
      permissions: [],
      execute: async () => {
        const store = load();
        const active = resolveActive(store);
        const brands = Object.entries(store.profiles).map(([key, p]) => ({
          name: p.name,
          industry: p.industry || null,
          active: key === active
        }));
        return { ok: true, count: brands.length, active: active ? store.profiles[active].name : null, brands };
      }
    },

    {
      name: 'brand.set_active',
      description: 'Marcar cuál marca es la activa (la que se usa por defecto en tareas de marketing). Input: { name }.',
      risk: 'low',
      permissions: [],
      required: ['name'],
      execute: async (input = {}) => {
        const store = load();
        const key = normalizeName(input.name);
        if (!store.profiles[key]) return { ok: false, error: `No hay perfil para "${input.name}".` };
        store.active = key;
        save(store);
        return { ok: true, active: store.profiles[key].name };
      }
    }
  ];

  // El runtime usa getActiveProfile para inyectar la marca activa al contexto.
  tools.getActiveProfile = getActiveProfile;
  tools.formatProfile = formatProfile;
  return tools;
}

module.exports = { createBrandProfileTools };
