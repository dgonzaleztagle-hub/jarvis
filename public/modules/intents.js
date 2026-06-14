/**
 * intents.js — Pre-LLM intent detection and handlers.
 * Each intent intercepts specific user inputs before they reach the LLM,
 * providing faster responses for known patterns.
 */
import { speakText } from './voice.js';
import { addMessage } from './feed.js';
import { playYoutube } from './youtube.js';
import * as FloatingPanel from './floating-panel.js';

/* ─── MUSIC INTENT ──────────────────────────────────────────────────────────── */
const MUSIC_KEYWORDS = /\b(youtube|música|musica|canción|cancion|tema|banda|artista|playlist|álbum|album|electrónica|electronica|rock|jazz|reggaeton|pop|cumbia|salsa)\b/;

/* Negación dirigida a la música misma: "no quiero canción", "sin música",
   "nada de música", "no me pongas temas". OJO: "no, mejor rock" NO matchea
   (no hay verbo negado sobre la música) y sigue contando como pick. */
const MUSIC_NEGATION = /\b(no\s+(quiero|quer[ií]a|deseo|necesito|me\s+pongas|pongas|toques|reproduzcas|busques|abras)|nada\s+de|sin)\s+(escuchar\s+|poner\s+|que\s+pongas\s+)?(m[uú]sica|canci[oó]n(es)?|tema(s)?)\b/;

export function isMusicIntent(text) {
  const lc = text.toLowerCase();
  if (MUSIC_NEGATION.test(lc)) return false;
  if (/\b(pon|ponme|toca|tocame|reproduce|reproducir|abre|busca|muéstrame)\b/.test(lc) && MUSIC_KEYWORDS.test(lc)) return true;
  if (/\b(quiero|quiero escuchar|escuchar|escúchame|pásame|pasame)\b/.test(lc)          && MUSIC_KEYWORDS.test(lc)) return true;
  return false;
}

/**
 * ¿La respuesta al "¿qué música?" del briefing es un rechazo?
 * Tras preguntar, CUALQUIER respuesta que no sea un "no" cuenta como pick
 * (un género pelado "electrónica" o un nombre de canción no traen verbo).
 * Solo es rechazo si hay marca de negación Y no menciona música/género.
 */
/* Respuestas cortas y genéricas ("sí", "ok", "dale"...) no son un pick válido
   — no traen ningún nombre de canción/género — así que se tratan como no-pick
   y se reenvían al LLM con contexto, no como búsqueda literal en YouTube. */
const GENERIC_SHORT_REPLY = /^\s*(s[ií]|no|ok(?:ay)?|dale|bueno|listo|vale|claro|perfecto|gracias|de\s+una)\s*[.!¡¿]?\s*$/;

export function isMusicDecline(text) {
  const lc = String(text || '').toLowerCase().trim();
  if (MUSIC_NEGATION.test(lc)) return true; // "no quiero canción" es rechazo aunque diga "canción"
  if (MUSIC_KEYWORDS.test(lc)) return false; // "no, mejor rock" sí es un pick
  if (GENERIC_SHORT_REPLY.test(lc)) return true;
  return /\b(no|nada|ninguna|paso|despu[eé]s|luego|ahora no|m[aá]s tarde|m[aá]s rato|silencio|sin m[uú]sica|prefiero no|mejor no)\b/.test(lc);
}

export async function handleMusicRequest(query) {
  speakText('Buscando en YouTube...');
  try {
    const result = await playYoutube(query);
    const msg = result?.title ? `Abriendo "${result.title}".` : 'Abriendo YouTube con tu búsqueda.';
    addMessage('jarvis', 'Jarvis', msg, { speakText: msg });
  } catch (_) {
    addMessage('jarvis', 'Jarvis', 'No pude conectar con YouTube.', { speakText: 'No pude conectar con YouTube.' });
  }
}

/* ─── CLOSE PANEL INTENT ────────────────────────────────────────────────────── */
const EMAIL_PANEL_IDS  = ['thread-detail', 'emails', 'emails-search'];
const AGENDA_PANEL_IDS = ['agenda'];
const ALL_PANEL_IDS    = [...EMAIL_PANEL_IDS, ...AGENDA_PANEL_IDS];

export function isCloseIntent(text) {
  const lc = text.toLowerCase();
  return (
    /\b(cierra|cerrar|quita|oculta|esconde|saca|elimina)\b/.test(lc) &&
    /\b(ventana|panel|paneles|correo|correos|email|emails|agenda|calendario|eso|esto|la pantalla|todo)\b/.test(lc)
  );
}

export function handleCloseIntent(text) {
  const lc = text.toLowerCase();
  let ids;
  if (/\b(correo|correos|email|emails|thread|mensaje|búsqueda|busqueda)\b/.test(lc)) ids = EMAIL_PANEL_IDS;
  else if (/\b(agenda|calendario)\b/.test(lc)) ids = AGENDA_PANEL_IDS;
  else ids = ALL_PANEL_IDS;

  const anyOpen = ids.some(id => FloatingPanel.isOpen(id));
  ids.forEach(id => FloatingPanel.close(id));
  const msg = anyOpen ? 'Listo.' : 'No hay paneles abiertos.';
  addMessage('jarvis', 'Jarvis', msg, { speakText: msg });
}
