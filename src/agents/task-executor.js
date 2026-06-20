// Ejecutor autónomo multi-paso. Para tareas que exceden el tool loop corto
// (3 rondas) del runtime: planifica el objetivo en pasos, los ejecuta uno a
// uno encadenando resultados, y si un paso falla intenta repararlo solo una
// vez antes de rendirse. Reimplementación propia inspirada en el planner/
// executor/error-handler de Mark-XXXIX, adaptada a la gobernanza de codex.
//
// Gobernanza: cada paso pasa por toolRegistry.execute, así que respeta policy
// y audit. Un paso de alto riesgo NO se auto-confirma — se marca
// 'needs_approval' y el ejecutor se detiene. La autonomía tiene techo.

const MAX_STEPS = 8;

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return '[unserializable]'; }
}

function compact(value, max = 400) {
  const s = typeof value === 'string' ? value : safeJson(value);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

// Catálogo de tools para el planificador: excluye las meta/peligrosas que no
// deben componerse dentro de un plan autónomo (anti-recursión y anti-escalada).
function planmableTools(toolRegistry) {
  return toolRegistry.list().filter((t) =>
    !/^tasks\.run_autonomous$/.test(t.name) &&
    !/^agents\./.test(t.name) &&
    t.risk !== 'critical'
  );
}

async function planTask({ goal, modelProvider, toolRegistry }) {
  const tools = planmableTools(toolRegistry)
    .map((t) => `- ${t.name} (${t.risk}): ${t.description || ''}`)
    .join('\n');

  const prompt = `Eres un planificador de tareas. Descompón el objetivo del usuario en una secuencia corta de pasos concretos y ejecutables, usando SOLO las herramientas disponibles. Cada paso usa exactamente una herramienta.

OBJETIVO: ${goal}

HERRAMIENTAS DISPONIBLES:
${tools}

Devuelve ÚNICAMENTE JSON con esta forma (sin markdown):
{
  "feasible": true,
  "steps": [
    { "n": 1, "description": "qué hace este paso", "tool": "nombre.exacto.de.herramienta", "input": { } }
  ],
  "missing": "si NO es factible, qué herramienta o dato falta (string, si feasible=false)"
}

REGLAS:
- Máximo ${MAX_STEPS} pasos. Menos es mejor.
- "tool" debe ser un nombre EXACTO de la lista. Si ninguna sirve, feasible=false y explica en "missing".
- "input" son los parámetros tentativos; si un paso depende del resultado de otro, igual pon tu mejor intento (se corregirá en ejecución).
- No inventes herramientas ni datos. Responde SOLO el JSON.`;

  const out = await modelProvider.generateJson({
    system: 'Devuelve únicamente JSON válido. Sin markdown.',
    messages: [{ role: 'user', parts: [{ text: prompt }] }],
    temperature: 0.2,
    maxTokens: 900,
    purpose: 'task_planning'
  });
  const data = out?.data || {};
  return {
    feasible: data.feasible !== false,
    steps: Array.isArray(data.steps) ? data.steps.slice(0, MAX_STEPS) : [],
    missing: data.missing || ''
  };
}

// Después de un paso exitoso, verifica que el output sea realmente útil para
// el objetivo. Detecta "falsos ok": 404s, JSON vacíos, datos irrelevantes que
// la tool devolvió sin lanzar excepción pero que harían fallar el siguiente paso.
async function verifyStepOutput({ goal, step, output, modelProvider }) {
  const prompt = `Acabas de ejecutar un paso de una tarea autónoma. Verifica si el output es válido para continuar.

OBJETIVO GENERAL: ${goal}
PASO: ${compact(step.description)} (herramienta: ${step.tool})
OUTPUT RECIBIDO: ${compact(output, 500)}

¿El output contiene datos útiles y coherentes para avanzar hacia el objetivo?
Responde ÚNICAMENTE JSON (sin markdown):
{ "valid": true }
{ "valid": false, "reason": "..." }  ← si el output es vacío, un error camuflado, datos irrelevantes o claramente inválido`;

  try {
    const out = await modelProvider.generateJson({
      system: 'Devuelve únicamente JSON válido. Sin markdown.',
      messages: [{ role: 'user', parts: [{ text: prompt }] }],
      temperature: 0.1,
      maxTokens: 150,
      purpose: 'task_verify'
    });
    const data = out?.data || {};
    return { valid: data.valid !== false, reason: data.reason || '' };
  } catch (_) {
    return { valid: true }; // best-effort: si la verificación falla, no bloqueamos
  }
}

// Dado un paso fallido + el error + lo que ya se logró, el modelo propone un
// input corregido o una herramienta alternativa. Una sola oportunidad.
async function autoFixStep({ goal, step, error, priorResults, modelProvider, toolRegistry }) {
  const tools = planmableTools(toolRegistry).map((t) => `- ${t.name}: ${t.description || ''}`).join('\n');
  const prompt = `Un paso de una tarea autónoma falló. Propón UNA corrección.

OBJETIVO GENERAL: ${goal}
PASO QUE FALLÓ: ${compact(step.description)} (herramienta: ${step.tool})
INPUT USADO: ${compact(step.input)}
ERROR: ${compact(error, 300)}
RESULTADOS PREVIOS: ${compact(priorResults, 500)}

HERRAMIENTAS DISPONIBLES:
${tools}

Devuelve ÚNICAMENTE JSON: { "fixable": true, "tool": "nombre", "input": { } }
Si no hay forma de arreglarlo, { "fixable": false }. Sin markdown.`;

  try {
    const out = await modelProvider.generateJson({
      system: 'Devuelve únicamente JSON válido. Sin markdown.',
      messages: [{ role: 'user', parts: [{ text: prompt }] }],
      temperature: 0.2,
      maxTokens: 400,
      purpose: 'task_autofix'
    });
    const data = out?.data || {};
    if (data.fixable && data.tool) return { tool: data.tool, input: data.input || {} };
    return null;
  } catch (_) {
    return null;
  }
}

// Ejecuta un paso vía el registry (respeta policy + audit). Traduce el
// resultado a un veredicto del ejecutor.
async function runStep(toolRegistry, tool, input, channel) {
  try {
    const res = await toolRegistry.execute(tool, input || {}, { channel, inAutonomousTask: true });
    if (res.confirmationRequired) return { status: 'needs_approval', risk: res.policy?.risk };
    if (res.blocked) return { status: 'blocked', reason: res.policy?.reasons?.join('; ') || res.validation?.missing?.join(', ') || 'bloqueado' };
    return { status: 'ok', output: res.output };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

async function executeTask({ goal, modelProvider, toolRegistry, channel = 'hud', onProgress }) {
  if (!goal || !modelProvider || !toolRegistry) {
    return { status: 'failed', goal, error: 'MISSING_DEPENDENCIES', steps: [] };
  }

  const plan = await planTask({ goal, modelProvider, toolRegistry });
  if (!plan.feasible || plan.steps.length === 0) {
    return { status: 'infeasible', goal, missing: plan.missing || 'No se pudo planificar la tarea.', steps: [] };
  }

  const executed = [];
  const priorResults = [];
  let outcome = 'completed';

  for (const step of plan.steps) {
    const stepTool = String(step.tool || '');
    const known = toolRegistry.get(stepTool);
    if (!known) {
      executed.push({ n: step.n, description: step.description, tool: stepTool, status: 'unknown_tool' });
      outcome = 'failed';
      break;
    }

    onProgress?.({ step: step.n, description: step.description, tool: stepTool });
    let result = await runStep(toolRegistry, stepTool, step.input, channel);

    // Auto-fix: una sola reparación ante error real (no ante needs_approval/blocked).
    if (result.status === 'error') {
      const fix = await autoFixStep({ goal, step, error: result.error, priorResults, modelProvider, toolRegistry });
      if (fix && toolRegistry.get(fix.tool)) {
        const retried = await runStep(toolRegistry, fix.tool, fix.input, channel);
        result = { ...retried, repaired: true, originalError: result.error, repairTool: fix.tool };
      }
    }

    // Verificación de output: detecta "falsos ok" — la tool corrió sin excepción
    // pero devolvió datos inválidos (404, JSON vacío, contenido irrelevante) que
    // harían fallar el siguiente paso. Si la verificación falla, se intenta el
    // mismo autofix que ante errores. No se re-verifica tras un repair.
    if (result.status === 'ok' && !result.repaired) {
      const verification = await verifyStepOutput({ goal, step, output: result.output, modelProvider });
      if (!verification.valid) {
        const fix = await autoFixStep({
          goal, step,
          error: `Verificación de output falló: ${verification.reason}`,
          priorResults, modelProvider, toolRegistry
        });
        if (fix && toolRegistry.get(fix.tool)) {
          const retried = await runStep(toolRegistry, fix.tool, fix.input, channel);
          result = { ...retried, repaired: true, verificationFailed: true, verificationReason: verification.reason, repairTool: fix.tool };
        } else {
          result = { status: 'error', error: `Output inválido sin corrección posible: ${verification.reason}` };
        }
      }
    }

    const record = { n: step.n, description: step.description, tool: stepTool, status: result.status };
    if (result.repaired) record.repaired = true;
    if (result.verificationFailed) { record.verificationFailed = true; record.verificationReason = result.verificationReason; }
    if (result.output !== undefined) {
      record.output = result.output;
      priorResults.push({ step: step.n, output: compact(result.output, 300) });
    }
    if (result.error) record.error = result.error;
    if (result.reason) record.reason = result.reason;
    if (result.risk) record.risk = result.risk;
    executed.push(record);

    // La autonomía se detiene ante aprobación humana o bloqueo/fallo.
    if (result.status === 'needs_approval') { outcome = 'paused_for_approval'; break; }
    if (result.status === 'blocked') { outcome = 'blocked'; break; }
    if (result.status === 'error') { outcome = 'failed'; break; }
  }

  return {
    status: outcome,
    goal,
    completedCount: executed.filter((s) => s.status === 'ok').length,
    totalSteps: plan.steps.length,
    steps: executed
  };
}

module.exports = {
  executeTask,
  planTask,
  autoFixStep,
  MAX_STEPS
};
