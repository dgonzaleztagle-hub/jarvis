#!/usr/bin/env node
/*
 * Gauntlet E2E de habilidades — auditoría en vivo contra el server que YA corre.
 *
 * Filosofía (política de ingeniería): no auditar leyendo, sino corriendo y
 * mirando resultados vs errores. Maneja a Jarvis como caja negra por HTTP, le
 * manda una cadena narrativa de mensajes naturales (como los que escribiría
 * Daniel), y por cada turno consulta el AUDIT real (/audit?since=) para saber
 * qué herramienta corrió y cómo terminó — no se fía del speak del modelo.
 *
 * NO levanta un segundo runtime: eso chocaría con la sesión de WhatsApp (Baileys
 * no tolera dos sockets) y duplicaría escritores del vault/estado. Caja negra.
 *
 * Cadena: memoria(escribe) -> memoria(recuerda) -> web(investiga) ->
 *         web(deliverable: render html) -> agente(crea+confirma) ->
 *         estado(verifica) -> whatsapp(reporta a Daniel) -> limpieza(borra agente).
 *
 * Uso:  node scripts/gauntlet-e2e.js
 *       GAUNTLET_BASE=http://127.0.0.1:3417 node scripts/gauntlet-e2e.js
 */

const BASE = process.env.GAUNTLET_BASE || 'http://127.0.0.1:3417';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m'
};
const tag = {
  PASS: `${C.green}PASS${C.reset}`,
  FAIL: `${C.red}FAIL${C.reset}`,
  WARN: `${C.yellow}WARN${C.reset}`
};

async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function totalCost() {
  try { return (await api('GET', '/model/usage')).usage.totals.costUsd || 0; }
  catch (_) { return null; }
}

// Marca de tiempo de la última entrada del audit, para atribuir exactamente las
// herramientas que corran a partir de aquí.
async function lastAuditAt() {
  try {
    const { entries } = await api('GET', '/audit?limit=1');
    return entries[0]?.at || new Date(0).toISOString();
  } catch (_) { return new Date(0).toISOString(); }
}

async function auditAfter(sinceIso) {
  const { entries } = await api('GET', `/audit?since=${encodeURIComponent(sinceIso)}&limit=80`);
  // since es inclusivo: descartamos la entrada exacta del corte.
  return entries.filter((e) => new Date(e.at).getTime() > new Date(sinceIso).getTime());
}

async function chat(text, channel = 'hud') {
  const since = await lastAuditAt();
  const { task } = await api('POST', '/chat', { text, channel });
  await sleep(250); // deja asentar el append del audit
  const entries = await auditAfter(since);
  return {
    speak: task?.result?.speak || '',
    visual: task?.result?.visual || '',
    taskId: task?.id || null,
    audit: entries
  };
}

// Una tool puede aparecer varias veces en un mismo paso (confirmation_required
// y LUEGO ok tras confirmar). Lo que importa para evaluar es si ALGUNA vez llego
// a ok, no el primer outcome — agregamos el mejor resultado, no el primero.
function toolOutcomes(audit) {
  const map = new Map(); // tool -> { ok, outcomes[] }
  for (const e of audit) {
    const cur = map.get(e.tool) || { ok: false, outcomes: [] };
    if (e.outcome === 'ok') cur.ok = true;
    cur.outcomes.push(e.outcome);
    map.set(e.tool, cur);
  }
  return map;
}
function toolReachedOk(audit, name) {
  return Boolean(toolOutcomes(audit).get(name)?.ok);
}

function summarizeAudit(audit) {
  if (!audit.length) return `${C.gray}(sin herramientas)${C.reset}`;
  return audit.map((e) => {
    const col = e.outcome === 'ok' ? C.green : e.outcome === 'error' ? C.red : C.yellow;
    return `${col}${e.tool}:${e.outcome}${C.reset}`;
  }).join(' ');
}

// ── Definición de la cadena ────────────────────────────────────────────────────
// confirm: tras el primer turno, si alguna herramienta quedó en
//   confirmation_required, manda un "sí" y reaúna el audit.
// expectTools: al menos una de estas debe haber corrido con outcome ok.
// expectSpeak: regex que el speak (o visual) debe satisfacer.
// tolerant: si falla, es WARN (no rompe el run) — para pasos sujetos a red/externos.
const STEPS = [
  {
    id: 'memoria-escribe',
    msg: "Guarda esto en tu memoria para después, es importante: el proyecto piloto de esta prueba se llama 'Gauntlet Pilot' y su metrica clave es 47 reservas semanales.",
    expectTools: ['memory.save', 'memory.graph_remember', 'memory.upsert_candidate'],
    tolerant: true // el aprendizaje pasivo puede capturarlo sin tool explicita
  },
  {
    id: 'memoria-recuerda',
    msg: "Sin buscar en ningun lado: cual es la metrica clave del proyecto piloto que te acabo de mencionar?",
    expectSpeak: /47/
  },
  {
    id: 'web-investiga',
    msg: "Busca en la web la hora oficial actual en Tokio y dime con cuantas horas de diferencia esta respecto a Santiago de Chile. Una linea.",
    expectTools: ['web.search', 'web.fetch'],
    expectSpeak: /\d/,
    tolerant: true
  },
  {
    id: 'web-deliverable',
    msg: "Creame una pagina web simple de una sola pantalla para 'Gauntlet Pilot': el titulo del proyecto, el numero 47 bien grande con la etiqueta 'reservas semanales', y un boton que diga 'Contactar'. Renderizamela para verla.",
    expectTools: ['preview.render_html'],
    tolerant: true
  },
  {
    id: 'agente-crea',
    // Mision auto-contenida a proposito: deja una nota en memoria. Asi la corrida
    // de validacion inmediata de agents.create NO dispara envios externos y el
    // test es repetible. (En un run anterior verificamos que un agente
    // "resume mi WhatsApp" SI ejecuta el envio real durante la validacion.)
    msg: "Creame un agente automatico que cada dia a las 09:00 guarde en tu memoria una nota que diga 'chequeo diario Gauntlet hecho' con la fecha. Ponle de nombre 'Nota Diaria Gauntlet'.",
    confirm: true,
    expectTools: ['agents.create']
  },
  {
    id: 'estado-verifica',
    msg: "Que agentes automaticos tengo configurados ahora mismo? Listamelos.",
    expectTools: ['agents.list'],
    expectSpeak: /Gauntlet/i
  },
  {
    id: 'whatsapp-reporta',
    // Texto DICTADO literal -> por el contrato de procedencia se envia directo,
    // sin confirmacion. Destinatario: self (a Daniel).
    msg: "Mandame a MI propio WhatsApp un mensaje con este texto exacto: \"Gauntlet E2E OK: memoria, web, agente y verificacion pasaron. Reporta Jarvis.\"",
    expectTools: ['wa.send_message'],
    tolerant: true // depende de que la sesion de WhatsApp este viva
  },
  {
    id: 'limpieza-borra-agente',
    msg: "Borra el agente 'Nota Diaria Gauntlet', era solo de la prueba.",
    confirm: true,
    expectTools: ['agents.delete']
  }
];

function evaluate(step, audit, speak, visual) {
  const outcomes = toolOutcomes(audit);
  // Solo cuentan como error las tools que NO terminaron en ok (un error seguido
  // de ok tras auto-fix/confirmacion no es un fallo del paso).
  const errors = audit.filter((e) => e.outcome === 'error' && !outcomes.get(e.tool)?.ok);
  const notes = [];

  let toolsOk = true;
  if (step.expectTools) {
    const hit = step.expectTools.find((t) => outcomes.get(t)?.ok);
    toolsOk = Boolean(hit);
    if (!hit) notes.push(`esperaba ok en una de [${step.expectTools.join(', ')}]`);
  }

  let speakOk = true;
  if (step.expectSpeak) {
    speakOk = step.expectSpeak.test(speak) || step.expectSpeak.test(visual);
    if (!speakOk) notes.push(`speak no satisface ${step.expectSpeak}`);
  }

  if (errors.length) notes.push(`errores: ${errors.map((e) => `${e.tool}(${e.error || 's/d'})`).join(', ')}`);

  const ok = toolsOk && speakOk && errors.length === 0;
  return { ok, notes, errors };
}

// La confirmacion puede llegar por DOS vias: la policy (confirmation_required en
// el audit) o el propio modelo preguntando en prosa ("¿confirmas?"). Y un mismo
// paso puede encadenar ambas (el modelo pregunta, luego la policy gatea). El
// harness responde "si" hasta que la herramienta objetivo corra o se agoten las
// rondas — asi audita el camino real, no una version a medias.
function asksConfirmationInProse(speak) {
  const s = (speak || '').toLowerCase();
  return /\bconfirmas\b|\bconfirmar\b|quieres que (lo|la|los|las)\b|procedo\b|lo creo\??$|¿.*\?\s*$/.test(s)
    && /confirm|proced|quieres que|creo|crear|borrar|eliminar/.test(s);
}

async function runStep(step, idx) {
  process.stdout.write(`\n${C.bold}[${idx + 1}/${STEPS.length}] ${step.id}${C.reset}\n`);
  process.stdout.write(`${C.dim}> ${step.msg}${C.reset}\n`);

  let { speak, visual, audit } = await chat(step.msg);

  if (step.confirm) {
    const targetRan = () => step.expectTools?.some((t) => toolReachedOk(audit, t));
    for (let round = 0; round < 3 && !targetRan(); round += 1) {
      const policyGate = audit.some((e) => e.outcome === 'confirmation_required');
      const proseGate = asksConfirmationInProse(speak);
      if (!policyGate && !proseGate) break;
      process.stdout.write(`${C.gray}  (confirmacion ${policyGate ? 'por policy' : 'en prosa'} -> respondo "si", ronda ${round + 1})${C.reset}\n`);
      const follow = await chat('Si, dale, confirmalo.');
      speak = follow.speak || speak;
      visual = follow.visual || visual;
      audit = audit.concat(follow.audit);
    }
  }

  if (speak) process.stdout.write(`  ${C.cyan}speak:${C.reset} ${speak.slice(0, 300)}\n`);
  process.stdout.write(`  ${C.gray}audit:${C.reset} ${summarizeAudit(audit)}\n`);

  const { ok, notes } = evaluate(step, audit, speak, visual);
  let status;
  if (ok) status = 'PASS';
  else status = step.tolerant ? 'WARN' : 'FAIL';
  process.stdout.write(`  -> ${tag[status]}${notes.length ? ` ${C.dim}(${notes.join('; ')})${C.reset}` : ''}\n`);
  return { id: step.id, status, notes };
}

async function main() {
  process.stdout.write(`${C.bold}=== Gauntlet E2E de habilidades — ${BASE} ===${C.reset}\n`);

  // Sanity: server vivo + modelo.
  try {
    const health = await api('GET', '/health');
    const model = (await api('GET', '/model/active')).active;
    process.stdout.write(`server: ${C.green}vivo${C.reset} | modelo: ${C.cyan}${model.label}${C.reset} (${model.tier})\n`);
    void health;
  } catch (err) {
    process.stdout.write(`${C.red}No hay server vivo en ${BASE}. Arranca Jarvis primero. (${err.message})${C.reset}\n`);
    process.exit(2);
  }

  const cost0 = await totalCost();
  const t0 = Date.now();
  const results = [];
  for (let i = 0; i < STEPS.length; i += 1) {
    try {
      results.push(await runStep(STEPS[i], i));
    } catch (err) {
      process.stdout.write(`  -> ${tag.FAIL} ${C.red}excepcion: ${err.message}${C.reset}\n`);
      results.push({ id: STEPS[i].id, status: 'FAIL', notes: [err.message] });
    }
    await sleep(800); // pacing: deja asentar aprendizaje async entre turnos
  }
  const cost1 = await totalCost();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ── Reporte ──
  process.stdout.write(`\n${C.bold}=== Reporte ===${C.reset}\n`);
  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) {
    counts[r.status] += 1;
    process.stdout.write(`  ${tag[r.status]}  ${r.id}${r.notes.length ? ` ${C.dim}— ${r.notes.join('; ')}${C.reset}` : ''}\n`);
  }
  process.stdout.write(`\n  ${C.green}PASS ${counts.PASS}${C.reset}  ${C.yellow}WARN ${counts.WARN}${C.reset}  ${C.red}FAIL ${counts.FAIL}${C.reset}\n`);
  if (cost0 != null && cost1 != null) {
    process.stdout.write(`  costo del gauntlet: ${C.cyan}$${(cost1 - cost0).toFixed(6)}${C.reset} (acumulado del dia: $${cost1.toFixed(6)})\n`);
  }
  process.stdout.write(`  duracion: ${elapsed}s\n`);

  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`${C.red}gauntlet abortado: ${err.stack || err.message}${C.reset}\n`);
  process.exit(2);
});
