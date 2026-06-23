#!/usr/bin/env node
/*
 * Auditoria de campo — "un dentista compro Jarvis".
 *
 * E2E pesado, en vivo, contra el server que YA corre (caja negra HTTP, mismo
 * patron que gauntlet-e2e.js / qa-morning-conversation.js). A diferencia de
 * esos: NO hace teardown solo. Documenta todo lo creado (con IDs/paths) para
 * que Daniel revise y de la orden de borrado el mismo, explicita, despues.
 *
 * Persona: "Clinica Dental Sonrisa Plena", Dr. Andres Pizarro, Providencia.
 * Marcador para trazabilidad/limpieza futura: SONRISAQA
 *
 * Cobertura (cada paso es una capacidad real, no relleno):
 *  1.  Investigacion de nicho (web.search/web.fetch)
 *  2.  Memoria explicita (memory.graph_remember / aprendizaje pasivo)
 *  3.  Perfil de marca (brand.save) — cimiento de Mara
 *  4.  Landing (Alex: preview.render_html)
 *  5.  Fotografia de stock real para la landing (design.find_photos)
 *  6.  Mirar una referencia real (design.analyze_reference) — Playwright+visión
 *  7.  Reporte de auditoria SEO/AEO (Teo: seo.generate_report)
 *  8.  Marketing: post de Instagram (Mara: social.publish) — SIN conexion,
 *      valida JIT onboarding real (no publica nada de verdad)
 *  9.  Marketing: metricas (social.report) — sin posts reales, valida que no mienta
 *  10. Autonomia explicita ("dale libertad") — valida el fix de hoy en persona-core
 *  11. Memoria-antes-que-internet — pide investigar algo ya mencionado
 *  12. Agenda: crear evento de paciente (google.calendar.create_event)
 *  13. Tareas: seguimiento (google.tasks.create_task)
 *  14. Gmail: revisar correos de pacientes (lectura, no envio)
 *  15. Documento: plan de marketing (google.docs.create_document)
 *  16. Memoria externa en Sheets (memory.setup_external / memory.save)
 *  17. Video: footage de stock (video.fetch_footage) — break-glass, valida onboarding
 *  18. Agente automatico: recordatorio semanal (agents.create + confirm)
 *  19. Estado de agentes + presupuesto (agents.list, agents.budget_status)
 *  20. WhatsApp: resumen a si mismo (wa.send_message, self, dictado literal)
 *  21. Verificacion de consistencia de memoria (memory.graph_query)
 *
 * Uso:  node scripts/qa-field-dentist.js
 *       node scripts/qa-field-dentist.js --report-only   (solo imprime que existe, no corre nada)
 *       node scripts/qa-field-dentist.js --teardown       (borra memoria/grafo/resumen marcados con TAG)
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3417';
const TAG = 'SONRISAQA';
const CLINIC = 'Clinica Dental Sonrisa Plena';
const DATA_DIR = path.join(__dirname, '..', 'local_data');
const REPORT_ONLY = process.argv.includes('--report-only');
const TEARDOWN = process.argv.includes('--teardown');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m', gray: '\x1b[90m'
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
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function callTool(toolName, input = {}) {
  const r = await api('POST', '/tasks/tool', { toolName, input });
  return r.task;
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
  await sleep(400);
  return { speak: task?.result?.speak || '', visual: task?.result?.visual || '', taskId: task?.id, audit: await auditAfter(since) };
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
  return /\bconfirmas\b|\bconfirmar\b|quieres que|procedo|lo creo|lo agendo|\?\s*$/.test(s)
    && /confirm|proced|quieres que|cre|agend|borrar|eliminar/.test(s);
}

const STEPS = [
  { id: '01-investiga-nicho',
    msg: `Soy el Dr. Andres Pizarro, dueño de "${CLINIC}" en Providencia, Santiago. Acabo de instalar Jarvis. Investiga en la web 3 tendencias actuales de marketing digital para clinicas dentales en Chile. Lista corta.`,
    expectTools: ['web.search', 'web.fetch'], tolerant: true },

  { id: '02-memoria-explicita',
    msg: `Guarda esto: mi clinica se llama "${CLINIC}", especialidad principal es blanqueamiento dental y ortodoncia invisible, ubicada en Providencia. El proyecto interno se llama "${TAG}".`,
    expectTools: ['memory.graph_remember', 'memory.save', 'memory.upsert_candidate'], tolerant: true },

  { id: '03-perfil-marca',
    msg: `Guarda un perfil de marca para "${CLINIC}": tono cercano y profesional, colores #1E88E5 y #FFFFFF, dirigido a adultos jovenes 25-45 que buscan estetica dental. Usalo para todo el contenido de esta clinica.`,
    expectTools: ['brand.save'], tolerant: true },

  { id: '04-landing',
    msg: `Hazme una landing de una sola pantalla para "${CLINIC}": hero con el nombre, tagline "Tu sonrisa, nuestra prioridad", servicios destacados (blanqueamiento, ortodoncia invisible, limpieza), boton "Reservar hora", y seccion de contacto. Muestramela.`,
    expectTools: ['preview.render_html'], tolerant: true },

  { id: '05-fotos-stock',
    msg: `Busca 3 fotos reales y gratuitas de "modern dental clinic interior" para usarlas en la landing de la clinica.`,
    expectTools: ['design.find_photos'], tolerant: true },

  { id: '06-mirar-referencia',
    msg: `Investiga el diseño de https://www.colgate.com mirandolo de verdad (no solo el texto) — dime si usa bento, si es simetrico, y donde pone las imagenes.`,
    expectTools: ['design.analyze_reference'], tolerant: true },

  { id: '07-reporte-seo',
    msg: `Hazme un reporte de auditoria SEO y AEO profundo, presentable a un cliente, de https://www.colgate.com — quiero el documento listo para mandarselo a un cliente, no datos sueltos.`,
    expectTools: ['seo.generate_report'], tolerant: true },

  { id: '08-marketing-post-jit',
    msg: `Publica un post de lanzamiento de "${CLINIC}" anunciando el nuevo servicio de ortodoncia invisible en Instagram y Facebook.`,
    // SIN conexion: debe ofrecer onboarding JIT, no mentir publicacion exitosa.
    expectSpeak: /conect|vincul|credencial|configur|no est[aá]s? conectad|token/i,
    expectTools: ['social.status', 'social.connect', 'hud.request_credentials'], tolerant: true },

  { id: '09-marketing-insights',
    msg: `Como les fue a mis ultimos posts de Instagram de la clinica? Dame las metricas.`,
    expectSpeak: /no (hay|tengo|existen)|sin (posts|publicaciones|datos)|0\b/i, tolerant: true },

  { id: '10-autonomia-libertad',
    msg: `Necesito un texto corto para el pie de pagina de la landing de la clinica. No tengo idea que poner, dale tu libertad creativa total, decide tu y aplicalo directo.`,
    tolerant: true },

  { id: '11-memoria-antes-que-internet',
    msg: `Recuerdame rapido: cual es la especialidad principal de mi clinica? No busques en la web, deberias saberlo ya.`,
    expectSpeak: /blanqueamiento|ortodoncia/i, tolerant: true },

  { id: '12-agenda-paciente',
    msg: `Agendame una hora con un paciente nuevo mañana a las 15:00, control y evaluacion inicial. Titulo exacto "Control Paciente ${TAG}".`,
    confirm: true, expectTools: ['google.calendar.create_event'], tolerant: true },

  { id: '13-tarea-seguimiento',
    msg: `Creame una tarea de seguimiento para pasado mañana, titulo exacto "Llamar paciente ${TAG}".`,
    confirm: true, expectTools: ['google.tasks.create_task'], tolerant: true },

  { id: '14-revisar-correos',
    msg: `Revisa si tengo correos importantes sin leer de pacientes o proveedores.`,
    expectTools: ['google.gmail.list_emails', 'google.gmail.search_emails'], tolerant: true },

  { id: '15-doc-plan-marketing',
    msg: `Creame un Google Doc con un plan de marketing del primer mes para "${CLINIC}" (redes + web). Titulo exacto "Plan Marketing ${TAG}".`,
    confirm: true, expectTools: ['google.docs.create_document'], tolerant: true },

  { id: '16-memoria-externa',
    msg: `Guarda en mi memoria externa de Google Sheets que el proyecto "${CLINIC} - ${TAG}" arranco hoy, estado activo.`,
    expectTools: ['memory.setup_external', 'memory.save'], tolerant: true },

  { id: '17-video-footage',
    msg: `Busca footage de stock para un video corto promocional de la clinica, tema "smiling patient dental clinic".`,
    expectTools: ['video.fetch_footage'], expectSpeak: /pexels|api.?key|configur|footage|clip/i, tolerant: true },

  { id: '18-crear-agente',
    msg: `Creame un agente automatico que cada lunes a las 09:00 me recuerde revisar los pacientes pendientes de la semana. Nombre exacto "Recordatorio Semanal ${TAG}".`,
    confirm: true, expectTools: ['agents.create'] },

  { id: '19-estado-agentes-presupuesto',
    msg: `Listame mis agentes automaticos y dime cuanto he gastado hoy en total entre todos.`,
    expectTools: ['agents.list', 'agents.budget_status'], tolerant: true },

  { id: '20-whatsapp-resumen',
    msg: `Mandame a mi propio WhatsApp este mensaje exacto: "Resumen ${TAG}: landing, reporte SEO, agenda y agente quedaron probados para la clinica dental."`,
    expectTools: ['wa.send_message'], tolerant: true },

  { id: '21-verifica-grafo',
    msg: `Que sabes hasta ahora sobre mi clinica? Resume todo lo que tienes guardado.`,
    expectSpeak: new RegExp(CLINIC.split(' ')[0], 'i'), tolerant: true }
];

async function runStep(step, idx) {
  out(`\n${C.bold}[${idx + 1}/${STEPS.length}] ${step.id}${C.reset}`);
  out(`${C.dim}> ${step.msg}${C.reset}`);
  let { speak, visual, audit, taskId } = await chat(step.msg);

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

  if (speak) out(`  ${C.cyan}speak:${C.reset} ${speak.slice(0, 320)}`);
  out(`  ${C.gray}audit:${C.reset} ${summarize(audit)}`);

  const outcomes = toolOutcomes(audit);
  const errors = audit.filter((e) => e.outcome === 'error' && !outcomes.get(e.tool)?.ok);
  const notes = [];
  let okTools = true, okSpeak = true;
  if (step.expectTools) { okTools = step.expectTools.some((t) => outcomes.get(t)?.ok); if (!okTools) notes.push(`sin ok en [${step.expectTools.join(', ')}]`); }
  if (step.expectSpeak) { okSpeak = step.expectSpeak.test(speak) || step.expectSpeak.test(visual); if (!okSpeak) notes.push('speak no satisface patrón'); }
  if (errors.length) notes.push(`errores: ${errors.map((e) => `${e.tool}(${e.error || 's/d'})`).join(', ')}`);

  const ok = (okTools || !step.expectTools) && okSpeak && errors.length === 0;
  const status = ok ? 'PASS' : (step.tolerant ? 'WARN' : 'FAIL');
  out(`  -> ${tag[status]}${notes.length ? ` ${C.dim}(${notes.join('; ')})${C.reset}` : ''}`);
  return { id: step.id, status, notes, audit, speak: speak.slice(0, 400), taskId };
}

// ── Inventario: que quedo creado, para que Daniel revise antes de borrar ──────
async function buildInventory() {
  const inv = { calendar: [], tasks: [], docs: [], agents: [], graphEntities: [], memoryRecords: [], previews: [], videoFootage: [] };

  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - 6 * 3600e3).toISOString();
    const timeMax = new Date(now.getTime() + 4 * 24 * 3600e3).toISOString();
    const ev = await callTool('google.calendar.list_events', { timeMin, timeMax, maxResults: 50 });
    for (const e of (ev?.result?.events || ev?.result?.items || [])) {
      const title = e.summary || e.title || '';
      if (title.toLowerCase().includes(TAG.toLowerCase())) inv.calendar.push({ id: e.id || e.eventId, title, start: e.start });
    }
  } catch (err) { out(`${C.yellow}inventario calendar: ${err.message}${C.reset}`); }

  try {
    const lists = await callTool('google.tasks.list_tasklists', {});
    for (const tl of (lists?.result?.tasklists || lists?.result?.items || [{ id: '@default' }])) {
      const tks = await callTool('google.tasks.list_tasks', { tasklistId: tl.id });
      for (const t of (tks?.result?.tasks || tks?.result?.items || [])) {
        if ((t.title || '').toLowerCase().includes(TAG.toLowerCase())) inv.tasks.push({ id: t.id, title: t.title, tasklistId: tl.id });
      }
    }
  } catch (err) { out(`${C.yellow}inventario tasks: ${err.message}${C.reset}`); }

  try {
    const found = await callTool('google.drive.search_files', { query: TAG });
    for (const f of (found?.result?.files || found?.result?.items || [])) {
      if ((f.name || '').toLowerCase().includes(TAG.toLowerCase())) inv.docs.push({ id: f.id, name: f.name });
    }
  } catch (err) { out(`${C.yellow}inventario docs/drive: ${err.message}${C.reset}`); }

  try {
    const { agents } = await api('GET', '/agents');
    for (const a of (agents || [])) {
      if ((a.name || '').toLowerCase().includes(TAG.toLowerCase())) inv.agents.push({ id: a.id, name: a.name, schedule: a.schedule });
    }
  } catch (err) { out(`${C.yellow}inventario agents: ${err.message}${C.reset}`); }

  try {
    const gp = path.join(DATA_DIR, 'memory', 'graph.json');
    if (fs.existsSync(gp)) {
      const g = JSON.parse(fs.readFileSync(gp, 'utf-8'));
      const hit = (o) => JSON.stringify(o).toLowerCase().includes(TAG.toLowerCase()) || JSON.stringify(o).toLowerCase().includes('sonrisa plena');
      inv.graphEntities = (g.entities || []).filter(hit).map((e) => ({ id: e.id, name: e.name, type: e.type }));
    }
  } catch (err) { out(`${C.yellow}inventario grafo: ${err.message}${C.reset}`); }

  try {
    const idxPath = path.join(DATA_DIR, 'memory', 'index.json');
    if (fs.existsSync(idxPath)) {
      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
      for (const r of (idx.records || [])) {
        const f = path.join(DATA_DIR, 'memory', r.id + '.json');
        if (fs.existsSync(f) && fs.readFileSync(f, 'utf-8').toLowerCase().includes('sonrisa plena')) {
          inv.memoryRecords.push({ id: r.id, title: r.title, type: r.type });
        }
      }
    }
  } catch (err) { out(`${C.yellow}inventario memoria: ${err.message}${C.reset}`); }

  try {
    const previewsDir = path.join(DATA_DIR, 'previews');
    if (fs.existsSync(previewsDir)) {
      const recent = fs.readdirSync(previewsDir)
        .map((f) => ({ f, t: fs.statSync(path.join(previewsDir, f)).mtimeMs }))
        .filter((x) => Date.now() - x.t < 30 * 60 * 1000)
        .sort((a, b) => b.t - a.t);
      inv.previews = recent.map((x) => x.f);
    }
  } catch (err) { out(`${C.yellow}inventario previews: ${err.message}${C.reset}`); }

  try {
    const footageDir = path.join(DATA_DIR, 'video', 'footage');
    if (fs.existsSync(footageDir)) inv.videoFootage = fs.readdirSync(footageDir);
  } catch (_) {}

  return inv;
}

// ── Teardown: borra del local_data REAL lo que quedó marcado con TAG ─────────
// No hay tool de borrado de memoria/grafo (memory.delete no existe) — esto
// edita los JSON directo, igual que la limpieza manual que se hizo la vez que
// esto faltó y el HUD recitó un agente fantasma ("Recordatorio Semanal
// SONRISAQA") ya borrado, porque quedó fosilizado en memory/index.json y
// graph.json sin que nada lo supiera invalidar. Conserva la entidad "Daniel"
// (nunca se borra al usuario real), solo sus hechos contaminados con el tag.
async function teardown() {
  const memDir = path.join(DATA_DIR, 'memory');
  const mentionsTag = (o) => {
    const s = JSON.stringify(o).toLowerCase();
    return s.includes(TAG.toLowerCase()) || s.includes('sonrisa plena');
  };

  const idxPath = path.join(memDir, 'index.json');
  let removedMemory = 0;
  if (fs.existsSync(idxPath)) {
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
    const keep = [];
    for (const r of idx.records || []) {
      const f = path.join(memDir, `${r.id}.json`);
      const contaminated = fs.existsSync(f) && fs.readFileSync(f, 'utf-8').toLowerCase().includes('sonrisa plena');
      if (contaminated) { fs.unlinkSync(f); removedMemory += 1; } else { keep.push(r); }
    }
    idx.records = keep;
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));
  }

  const gp = path.join(memDir, 'graph.json');
  let graphCounts = null;
  if (fs.existsSync(gp)) {
    const g = JSON.parse(fs.readFileSync(gp, 'utf-8'));
    const removedIds = new Set(
      g.entities.filter((e) => e.name !== 'Daniel' && mentionsTag(e)).map((e) => e.id)
    );
    const before = { entities: g.entities.length, facts: g.facts.length, relationships: g.relationships.length, commitments: g.commitments.length };
    g.entities = g.entities.filter((e) => !removedIds.has(e.id));
    g.facts = g.facts.filter((f) => !removedIds.has(f.subjectId) && !mentionsTag(f));
    g.relationships = g.relationships.filter((r) => !removedIds.has(r.fromId) && !removedIds.has(r.toId));
    g.commitments = g.commitments.filter((c) => !mentionsTag(c));
    fs.writeFileSync(gp, JSON.stringify(g, null, 2));
    graphCounts = { before, after: { entities: g.entities.length, facts: g.facts.length, relationships: g.relationships.length, commitments: g.commitments.length } };
  }

  // Resumen rolling de conversación: si algún turno de esta corrida ya quedó
  // incorporado al resumen persistido, se cuela en TODOS los turnos futuros
  // del usuario real hasta el próximo resumen (es el caso que de verdad
  // produjo la confusión visible en el HUD, más que memoria/grafo).
  const statePath = path.join(DATA_DIR, 'logs', 'conversation-state.json');
  let summaryTouched = false;
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (state.summary && state.summary.toLowerCase().includes(TAG.toLowerCase())) {
      state.summary = state.summary.split('\n').filter((line) => !line.toLowerCase().includes(TAG.toLowerCase())).join('\n');
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      summaryTouched = true;
    }
  }

  out(`${C.bold}=== Teardown (${TAG}) ===${C.reset}`);
  out(`  memoria: ${removedMemory} registros borrados`);
  if (graphCounts) out(`  grafo: ${JSON.stringify(graphCounts.before)} -> ${JSON.stringify(graphCounts.after)}`);
  out(`  resumen rolling: ${summaryTouched ? 'limpiado' : 'sin mención, no se tocó'}`);
  out(`${C.yellow}  Nota: agentes/calendar/tasks/docs/drive reales (si los hubiera) no se tocan acá — bórralos tú explícito si el inventario los lista.${C.reset}`);
}

async function main() {
  out(`${C.bold}=== Auditoria de campo: ${CLINIC} (Dr. Pizarro) — ${BASE} ===${C.reset}`);
  out(`${C.dim}marcador de trazabilidad: ${TAG} — SIN teardown automatico, queda todo para revision${C.reset}`);

  if (REPORT_ONLY) {
    const inv = await buildInventory();
    out(JSON.stringify(inv, null, 2));
    return;
  }

  if (TEARDOWN) {
    await teardown();
    return;
  }

  try {
    await api('GET', '/health');
    const model = (await api('GET', '/model/active')).active;
    out(`server vivo | modelo ${C.cyan}${model.label}${C.reset} | marcador ${C.cyan}${TAG}${C.reset}`);
  } catch (e) { out(`${C.red}No hay server en ${BASE}: ${e.message}${C.reset}`); process.exit(2); }

  const cost0 = (await api('GET', '/model/usage')).usage.totals.costUsd;
  const t0 = Date.now();
  const results = [];
  for (let i = 0; i < STEPS.length; i += 1) {
    try { results.push(await runStep(STEPS[i], i)); }
    catch (e) { out(`  -> ${tag.FAIL} ${C.red}${e.message}${C.reset}`); results.push({ id: STEPS[i].id, status: 'FAIL', notes: [e.message] }); }
    await sleep(900);
  }
  const cost1 = (await api('GET', '/model/usage')).usage.totals.costUsd;

  out(`\n${C.bold}=== Reporte de pasos ===${C.reset}`);
  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) { counts[r.status] += 1; out(`  ${tag[r.status]}  ${r.id}${r.notes?.length ? ` ${C.dim}— ${r.notes.join('; ')}${C.reset}` : ''}`); }
  out(`\n  ${C.green}PASS ${counts.PASS}${C.reset}  ${C.yellow}WARN ${counts.WARN}${C.reset}  ${C.red}FAIL ${counts.FAIL}${C.reset}`);
  out(`  costo: ${C.cyan}$${(cost1 - cost0).toFixed(6)}${C.reset} (acumulado: $${cost1.toFixed(6)})`);
  out(`  duracion: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  out(`\n${C.bold}=== Inventario de lo creado (marcador "${TAG}") — para revisar antes de borrar ===${C.reset}`);
  const inv = await buildInventory();
  out(JSON.stringify(inv, null, 2));

  fs.writeFileSync(
    path.join(__dirname, '..', 'qa-field-dentist-report.json'),
    JSON.stringify({ tag: TAG, clinic: CLINIC, at: new Date().toISOString(), results: results.map(({ audit, ...r }) => r), inventory: inv, costUsd: cost1 - cost0 }, null, 2)
  );
  out(`\n${C.dim}Reporte completo guardado en qa-field-dentist-report.json${C.reset}`);

  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main().catch((e) => { out(`${C.red}abortado: ${e.stack || e.message}${C.reset}`); process.exit(2); });
