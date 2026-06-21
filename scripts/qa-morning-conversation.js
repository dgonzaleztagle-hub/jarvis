#!/usr/bin/env node
/*
 * QA conversacional — "una mañana con un lead nuevo".
 *
 * Test E2E en vivo (caja negra HTTP) que recorre una conversación realista de
 * mañana: revisar agenda/correos, capturar un lead, agendarle reunión, crearle
 * tarea, investigar en la web, hacerle una landing, redactar propuesta en Doc,
 * guardar marca, pedir publicar en LinkedIn/Instagram (SIN conexión -> verifica
 * el onboarding JIT, no que mienta), pedir un video (break-glass), crear un
 * agente de seguimiento y mandarse un resumen por WhatsApp.
 *
 * REVERSIBLE: todo lo creado lleva el marcador "QALEAD" en el nombre. El
 * teardown habilita trust-mode, lista por marcador y borra (calendar, tasks,
 * docs, agente), luego limpia grafo/store/marca por marcador. Verifica que
 * quede en cero. Backups .bak-qa de grafo/store/marca por las dudas.
 *
 * Uso:  node scripts/qa-morning-conversation.js
 *       node scripts/qa-morning-conversation.js --no-teardown   (deja todo para inspección)
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3417';
const TAG = 'QALEAD';
const DATA_DIR = path.join(__dirname, '..', 'local_data');
const NO_TEARDOWN = process.argv.includes('--no-teardown');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m'
};
const tag = { PASS: `${C.green}PASS${C.reset}`, FAIL: `${C.red}FAIL${C.reset}`, WARN: `${C.yellow}WARN${C.reset}` };
const out = (s) => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

async function callTool(toolName, input = {}, context = {}) {
  const r = await api('POST', '/tasks/tool', { toolName, input, context });
  return r.task?.result;
}

async function lastAuditAt() {
  try { const { entries } = await api('GET', '/audit?limit=1'); return entries[0]?.at || new Date(0).toISOString(); }
  catch (_) { return new Date(0).toISOString(); }
}
async function auditAfter(sinceIso) {
  const { entries } = await api('GET', `/audit?since=${encodeURIComponent(sinceIso)}&limit=120`);
  return entries.filter((e) => new Date(e.at).getTime() > new Date(sinceIso).getTime());
}
async function chat(text) {
  const since = await lastAuditAt();
  const { task } = await api('POST', '/chat', { text, channel: 'hud' });
  await sleep(250);
  return { speak: task?.result?.speak || '', visual: task?.result?.visual || '', audit: await auditAfter(since) };
}

function toolOutcomes(audit) {
  const m = new Map();
  for (const e of audit) { const c = m.get(e.tool) || { ok: false }; if (e.outcome === 'ok') c.ok = true; m.set(e.tool, c); }
  return m;
}
function reachedOk(audit, name) { return Boolean(toolOutcomes(audit).get(name)?.ok); }
function summarize(audit) {
  if (!audit.length) return `${C.gray}(sin tools)${C.reset}`;
  return audit.map((e) => {
    const col = e.outcome === 'ok' ? C.green : e.outcome === 'error' ? C.red : C.yellow;
    return `${col}${e.tool}:${e.outcome}${C.reset}`;
  }).join(' ');
}
function asksConfirmInProse(speak) {
  const s = (speak || '').toLowerCase();
  return /\bconfirmas\b|\bconfirmar\b|quieres que|procedo|lo creo|lo agendo|lo env[ií]o|\?\s*$/.test(s)
    && /confirm|proced|quieres que|cre|agend|env[ií]|borrar|eliminar/.test(s);
}

const STEPS = [
  { id: 'agenda-correos', msg: 'Buenos dias. Dime que tengo en la agenda de hoy y si hay algun correo importante sin leer.',
    expectTools: ['google.calendar.list_events', 'google.gmail.list_emails', 'google.gmail.search_emails'], tolerant: true },

  { id: 'captura-lead', msg: `Me llego un lead nuevo: una cafeteria que se llama "Cafe ${TAG}", el dueno es Tomas, quiere una pagina web y que le manejemos redes sociales. Guardalo como proyecto/lead con ese nombre exacto.`,
    expectTools: ['memory.graph_remember', 'memory.save', 'memory.upsert_candidate'], tolerant: true },

  { id: 'agendar-reunion', msg: `Agendame una reunion con Tomas manana a las 11:00. Ponle de titulo exactamente "Reunion Cafe ${TAG}".`,
    confirm: true, expectTools: ['google.calendar.create_event'] },

  { id: 'crear-tarea', msg: `Creame una tarea de seguimiento para pasado manana, titulo exacto "Seguimiento Cafe ${TAG}".`,
    confirm: true, expectTools: ['google.tasks.create_task'], tolerant: true },

  { id: 'investigar-web', msg: 'Investiga en la web 3 buenas practicas concretas para la pagina web de una cafeteria de especialidad. Lista corta.',
    expectTools: ['web.search', 'web.fetch'], tolerant: true },

  { id: 'crear-landing', msg: `Hazle una landing de una sola pantalla a Cafe ${TAG}: el nombre, el tagline "cafe de especialidad" y un boton "Reservar". Muestramela.`,
    expectTools: ['preview.render_html'], tolerant: true },

  { id: 'crear-doc', msg: `Creame un Google Doc con una propuesta breve (web + redes) para el lead. Titulo exacto "Propuesta Cafe ${TAG}".`,
    confirm: true, expectTools: ['google.docs.create_document'], tolerant: true },

  { id: 'guardar-marca', msg: `Guarda un perfil de marca para "Cafe ${TAG}": tono cercano y cálido, colores tierra. Usalo cuando generemos contenido de ese cliente.`,
    expectTools: ['brand.save'], tolerant: true },

  { id: 'social-jit', msg: `Publica un post de lanzamiento de Cafe ${TAG} en LinkedIn y en Instagram.`,
    // SIN conexion: debe hacer onboarding JIT (pedir conectar/credenciales), no mentir ni reventar.
    expectSpeak: /conect|vincul|credencial|configur|no est[aá]s? conectad|necesito (que )?(conect|vincul)/i,
    expectTools: ['social.status', 'social.connect', 'hud.request_credentials'], tolerant: true },

  { id: 'video-breakglass', msg: `Hazme un video corto de lanzamiento para Cafe ${TAG} y muestramelo.`,
    // Break-glass: o lo renderiza, o explica que falta setup. No debe mentir.
    expectSpeak: /video|render|instal|setup|configur|ffmpeg|remotion|no (puedo|esta)/i, tolerant: true },

  { id: 'crear-agente', msg: `Creame un agente que cada lunes a las 09:00 me recuerde revisar mis leads pendientes. Nombre exacto "Seguimiento Leads ${TAG}".`,
    confirm: true, expectTools: ['agents.create'] },

  { id: 'whatsapp-resumen', msg: `Mandame a mi WhatsApp un resumen corto de lo que armamos hoy para Cafe ${TAG}.`,
    // Texto compuesto por el modelo -> confirmacion; luego se envia (ya con el fix de jid).
    confirm: true, expectTools: ['wa.send_message'], tolerant: true }
];

async function runStep(step, idx) {
  out(`\n${C.bold}[${idx + 1}/${STEPS.length}] ${step.id}${C.reset}`);
  out(`${C.dim}> ${step.msg}${C.reset}`);
  let { speak, visual, audit } = await chat(step.msg);

  if (step.confirm) {
    const ran = () => step.expectTools?.some((t) => reachedOk(audit, t));
    for (let r = 0; r < 3 && !ran(); r += 1) {
      const policyGate = audit.some((e) => e.outcome === 'confirmation_required');
      const proseGate = asksConfirmInProse(speak);
      if (!policyGate && !proseGate) break;
      out(`${C.gray}  (confirmacion ${policyGate ? 'policy' : 'prosa'} -> "si", ronda ${r + 1})${C.reset}`);
      const f = await chat('Si, dale, confirmalo.');
      speak = f.speak || speak; visual = f.visual || visual; audit = audit.concat(f.audit);
    }
  }

  if (speak) out(`  ${C.cyan}speak:${C.reset} ${speak.slice(0, 280)}`);
  out(`  ${C.gray}audit:${C.reset} ${summarize(audit)}`);

  const outcomes = toolOutcomes(audit);
  const errors = audit.filter((e) => e.outcome === 'error' && !outcomes.get(e.tool)?.ok);
  const notes = [];
  let okTools = true, okSpeak = true;
  if (step.expectTools) { okTools = step.expectTools.some((t) => outcomes.get(t)?.ok); if (!okTools) notes.push(`sin ok en [${step.expectTools.join(', ')}]`); }
  if (step.expectSpeak) { okSpeak = step.expectSpeak.test(speak) || step.expectSpeak.test(visual); if (!okSpeak) notes.push('speak no satisface patrón'); }
  if (errors.length) notes.push(`errores: ${errors.map((e) => `${e.tool}`).join(', ')}`);

  const ok = (okTools || (!step.expectTools && okSpeak)) && (okSpeak || !step.expectSpeak) && errors.length === 0;
  const status = ok ? 'PASS' : (step.tolerant ? 'WARN' : 'FAIL');
  out(`  -> ${tag[status]}${notes.length ? ` ${C.dim}(${notes.join('; ')})${C.reset}` : ''}`);
  return { id: step.id, status, notes };
}

// ── Teardown ────────────────────────────────────────────────────────────────
async function setTrust(enabled) { try { await api('POST', '/trust-mode', { enabled }); } catch (_) {} }

function cleanLocalByTag() {
  const removed = { graph: 0, store: 0, brand: 0 };
  const hit = (o) => JSON.stringify(o).toLowerCase().includes(TAG.toLowerCase());

  // Grafo
  try {
    const gp = path.join(DATA_DIR, 'memory', 'graph.json');
    if (fs.existsSync(gp)) {
      fs.copyFileSync(gp, gp + '.bak-qa');
      const g = JSON.parse(fs.readFileSync(gp, 'utf-8'));
      const bad = new Set((g.entities || []).filter(hit).map((e) => e.id));
      const before = (g.entities || []).length;
      g.entities = (g.entities || []).filter((e) => !bad.has(e.id));
      g.facts = (g.facts || []).filter((f) => !bad.has(f.subjectId) && !bad.has(f.entityId) && !hit(f));
      g.relationships = (g.relationships || []).filter((r) => !bad.has(r.from) && !bad.has(r.to) && !hit(r));
      g.commitments = (g.commitments || []).filter((c) => !hit(c));
      removed.graph = before - g.entities.length;
      fs.writeFileSync(gp, JSON.stringify(g, null, 2));
    }
  } catch (e) { out(`  ${C.yellow}graph cleanup: ${e.message}${C.reset}`); }

  // Store
  try {
    const dir = path.join(DATA_DIR, 'memory');
    const idxPath = path.join(dir, 'index.json');
    if (fs.existsSync(idxPath)) {
      fs.copyFileSync(idxPath, idxPath + '.bak-qa');
      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
      const keep = [];
      for (const r of idx.records || []) {
        const f = path.join(dir, r.id + '.json');
        const isTag = fs.existsSync(f) && fs.readFileSync(f, 'utf-8').toLowerCase().includes(TAG.toLowerCase());
        if (isTag) { try { fs.rmSync(f); } catch (_) {} removed.store += 1; } else keep.push(r);
      }
      idx.records = keep;
      fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));
    }
  } catch (e) { out(`  ${C.yellow}store cleanup: ${e.message}${C.reset}`); }

  // Marca (busca cualquier json bajo local_data con el tag en brand)
  try {
    const candidates = ['brand-profiles.json', 'brand.json', path.join('brand', 'profiles.json')];
    for (const rel of candidates) {
      const bp = path.join(DATA_DIR, rel);
      if (!fs.existsSync(bp)) continue;
      const raw = fs.readFileSync(bp, 'utf-8');
      if (!raw.toLowerCase().includes(TAG.toLowerCase())) continue;
      fs.copyFileSync(bp, bp + '.bak-qa');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        for (const k of Object.keys(data)) { if (JSON.stringify(data[k]).toLowerCase().includes(TAG.toLowerCase())) { delete data[k]; removed.brand += 1; } }
        fs.writeFileSync(bp, JSON.stringify(data, null, 2));
      }
    }
  } catch (e) { out(`  ${C.yellow}brand cleanup: ${e.message}${C.reset}`); }

  return removed;
}

async function teardown() {
  out(`\n${C.bold}=== Teardown (reverso por marcador "${TAG}") ===${C.reset}`);
  await setTrust(true);
  const undone = { calendar: 0, tasks: 0, docs: 0, agents: 0 };
  try {
    // Calendar: ventana amplia (ahora .. +4 dias)
    const now = new Date();
    const timeMin = new Date(now.getTime() - 12 * 3600e3).toISOString();
    const timeMax = new Date(now.getTime() + 4 * 24 * 3600e3).toISOString();
    const ev = await callTool('google.calendar.list_events', { timeMin, timeMax, maxResults: 50 });
    for (const e of (ev?.events || ev?.items || [])) {
      const title = e.summary || e.title || '';
      if (title.toLowerCase().includes(TAG.toLowerCase())) {
        try { await callTool('google.calendar.delete_event', { eventId: e.id || e.eventId }); undone.calendar += 1; } catch (_) {}
      }
    }
  } catch (e) { out(`  ${C.yellow}calendar: ${e.message}${C.reset}`); }

  try {
    const lists = await callTool('google.tasks.list_tasklists', {});
    for (const tl of (lists?.tasklists || lists?.items || [{ id: '@default' }])) {
      const tks = await callTool('google.tasks.list_tasks', { tasklistId: tl.id });
      for (const t of (tks?.tasks || tks?.items || [])) {
        if ((t.title || '').toLowerCase().includes(TAG.toLowerCase())) {
          try { await callTool('google.tasks.delete_task', { tasklistId: tl.id, taskId: t.id }); undone.tasks += 1; } catch (_) {}
        }
      }
    }
  } catch (e) { out(`  ${C.yellow}tasks: ${e.message}${C.reset}`); }

  try {
    const found = await callTool('google.drive.search_files', { query: TAG });
    for (const f of (found?.files || found?.items || [])) {
      if ((f.name || '').toLowerCase().includes(TAG.toLowerCase())) {
        try { await callTool('google.drive.trash_file', { fileId: f.id }); undone.docs += 1; } catch (_) {}
      }
    }
  } catch (e) { out(`  ${C.yellow}docs/drive: ${e.message}${C.reset}`); }

  try {
    const { agents } = await api('GET', '/agents');
    for (const a of (agents || [])) {
      if ((a.name || '').toLowerCase().includes(TAG.toLowerCase())) {
        // El endpoint espera { agent } (id o nombre), no { id }.
        try { await api('POST', '/agents/delete', { agent: a.id }); undone.agents += 1; } catch (_) {}
      }
    }
  } catch (e) { out(`  ${C.yellow}agents: ${e.message}${C.reset}`); }

  await setTrust(false);
  // El aprendizaje de memoria/grafo es async (corre DESPUES de responder cada
  // turno): si limpiamos local de inmediato, esos writes tardios reescriben el
  // marcador. Esperamos a que asiente y limpiamos en dos pasadas.
  await sleep(2500);
  let local = cleanLocalByTag();
  await sleep(1500);
  const local2 = cleanLocalByTag();
  local = { graph: local.graph + local2.graph, store: local.store + local2.store, brand: local.brand + local2.brand };
  out(`  remoto -> calendar:${undone.calendar} tasks:${undone.tasks} docs:${undone.docs} agentes:${undone.agents}`);
  out(`  local  -> grafo:${local.graph} store:${local.store} marca:${local.brand}`);

  // Verificacion final
  let leftover = 0;
  try {
    const { agents } = await api('GET', '/agents');
    leftover += (agents || []).filter((a) => (a.name || '').toLowerCase().includes(TAG.toLowerCase())).length;
  } catch (_) {}
  try {
    const found = await callTool('google.drive.search_files', { query: TAG });
    leftover += (found?.files || found?.items || []).filter((f) => (f.name || '').toLowerCase().includes(TAG.toLowerCase())).length;
  } catch (_) {}
  out(`  verificacion: ${leftover === 0 ? `${C.green}sin restos de ${TAG}${C.reset}` : `${C.red}quedan ${leftover} restos (revisar)${C.reset}`}`);
  return leftover;
}

async function totalCost() { try { return (await api('GET', '/model/usage')).usage.totals.costUsd || 0; } catch (_) { return null; } }

async function main() {
  out(`${C.bold}=== QA conversacional "mañana con un lead" — ${BASE} ===${C.reset}`);
  try {
    await api('GET', '/health');
    const model = (await api('GET', '/model/active')).active;
    out(`server vivo | modelo ${C.cyan}${model.label}${C.reset} | marcador ${C.cyan}${TAG}${C.reset}${NO_TEARDOWN ? ` | ${C.yellow}sin teardown${C.reset}` : ''}`);
  } catch (e) { out(`${C.red}No hay server en ${BASE}: ${e.message}${C.reset}`); process.exit(2); }

  const cost0 = await totalCost();
  const t0 = Date.now();
  const results = [];
  for (let i = 0; i < STEPS.length; i += 1) {
    try { results.push(await runStep(STEPS[i], i)); }
    catch (e) { out(`  -> ${tag.FAIL} ${C.red}${e.message}${C.reset}`); results.push({ id: STEPS[i].id, status: 'FAIL', notes: [e.message] }); }
    await sleep(700);
  }

  let leftover = 0;
  if (!NO_TEARDOWN) leftover = await teardown();
  else out(`\n${C.yellow}Teardown OMITIDO (--no-teardown). Recordá limpiar los recursos ${TAG} manualmente.${C.reset}`);

  const cost1 = await totalCost();
  out(`\n${C.bold}=== Reporte ===${C.reset}`);
  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) { counts[r.status] += 1; out(`  ${tag[r.status]}  ${r.id}${r.notes.length ? ` ${C.dim}— ${r.notes.join('; ')}${C.reset}` : ''}`); }
  out(`\n  ${C.green}PASS ${counts.PASS}${C.reset}  ${C.yellow}WARN ${counts.WARN}${C.reset}  ${C.red}FAIL ${counts.FAIL}${C.reset}`);
  if (cost0 != null && cost1 != null) out(`  costo: ${C.cyan}$${(cost1 - cost0).toFixed(6)}${C.reset} (dia: $${cost1.toFixed(6)})`);
  out(`  duracion: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!NO_TEARDOWN) out(`  limpieza: ${leftover === 0 ? C.green + 'OK' + C.reset : C.red + 'revisar restos' + C.reset}`);

  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main().catch((e) => { out(`${C.red}abortado: ${e.stack || e.message}${C.reset}`); process.exit(2); });
