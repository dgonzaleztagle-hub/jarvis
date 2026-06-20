// Generación de contenido largo (landings, documentos, detalle de pantalla):
// primer intento al techo real de la API: si el modelo se queda corto, se le
// pide CONTINUAR exactamente donde quedó -sin recortar diseño/contenido-, en
// vez de forzar una versión más pobre para caber en un techo arbitrario.
// ANTI_LOOP_MAX_ROUNDS es un guardrail de seguridad (evita loops si el modelo
// nunca declara terminado), no un tope de calidad.
const ANTI_LOOP_MAX_ROUNDS = 8;
const FIRST_MAX_TOKENS = 8192;
const CONTINUE_MAX_TOKENS = 4096;
const DEFAULT_CONTINUE_PROMPT = 'Continúa EXACTAMENTE donde quedó el contenido anterior, sin repetir nada de lo ya escrito y sin agregar comentarios, hasta terminarlo por completo.';

async function generateWithContinuation({
  callOnce,
  prompt,
  isComplete,
  continuePrompt = DEFAULT_CONTINUE_PROMPT,
  firstMaxTokens = FIRST_MAX_TOKENS,
  continueMaxTokens = CONTINUE_MAX_TOKENS,
  maxRounds = ANTI_LOOP_MAX_ROUNDS,
  stripFences = (text) => text
}) {
  let messages = [{ role: 'user', parts: [{ text: prompt }] }];
  let result = await callOnce(messages, firstMaxTokens);
  let acc = stripFences(result.text);
  let rounds = 0;

  while (!isComplete(acc, result.stopReason) && rounds < maxRounds) {
    messages = [
      ...messages,
      { role: 'model', parts: [{ text: result.text }] },
      { role: 'user', parts: [{ text: continuePrompt }] }
    ];
    result = await callOnce(messages, continueMaxTokens);
    acc += stripFences(result.text);
    rounds++;
  }

  return { text: acc.trim(), truncated: !isComplete(acc, result.stopReason) };
}

module.exports = {
  generateWithContinuation,
  ANTI_LOOP_MAX_ROUNDS,
  FIRST_MAX_TOKENS,
  CONTINUE_MAX_TOKENS
};
