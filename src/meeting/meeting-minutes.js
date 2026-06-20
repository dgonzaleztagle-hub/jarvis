// Post-procesamiento de reunión: transcript → minuta estructurada → Google Doc.

function compact(s, max = 8000) {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

async function generateMinutes({ transcript, title, modelProvider }) {
  if (!transcript || !transcript.trim()) {
    return { summary: '', decisions: [], commitments: [], actionItems: [], topics: [] };
  }

  const prompt = `Eres el asistente de Daniel González Tagle. Acabas de transcribir su reunión "${title}".
Analiza la transcripción y devuelve ÚNICAMENTE JSON con esta forma (sin markdown):

{
  "summary": "resumen ejecutivo en 3-5 oraciones",
  "topics": ["tema 1", "tema 2"],
  "decisions": ["decisión tomada 1", "decisión tomada 2"],
  "commitments": [{ "person": "nombre", "commitment": "texto", "deadline": "fecha si se mencionó o null" }],
  "actionItems": [{ "task": "qué hacer", "owner": "quién", "deadline": "cuándo o null" }],
  "nextSteps": "próximos pasos recomendados en una oración"
}

TRANSCRIPCIÓN:
${compact(transcript)}`;

  const out = await modelProvider.generateJson({
    system: 'Devuelve únicamente JSON válido. Sin markdown.',
    messages: [{ role: 'user', parts: [{ text: prompt }] }],
    temperature: 0.2,
    maxTokens: 1200,
    purpose: 'meeting_minutes'
  });

  const d = out?.data || {};
  return {
    summary:     String(d.summary || ''),
    topics:      Array.isArray(d.topics)      ? d.topics      : [],
    decisions:   Array.isArray(d.decisions)   ? d.decisions   : [],
    commitments: Array.isArray(d.commitments) ? d.commitments : [],
    actionItems: Array.isArray(d.actionItems) ? d.actionItems : [],
    nextSteps:   String(d.nextSteps || '')
  };
}

function minutesToDocText({ title, startedAt, endedAt, minutes, transcript }) {
  const fmt = (iso) => iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : '—';
  const lines = [
    `# Minuta: ${title}`,
    `**Inicio:** ${fmt(startedAt)}   **Fin:** ${fmt(endedAt)}`,
    '',
  ];

  if (minutes.summary) {
    lines.push('## Resumen', minutes.summary, '');
  }
  if (minutes.topics.length) {
    lines.push('## Temas tratados');
    minutes.topics.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  if (minutes.decisions.length) {
    lines.push('## Decisiones');
    minutes.decisions.forEach((d) => lines.push(`- ${d}`));
    lines.push('');
  }
  if (minutes.commitments.length) {
    lines.push('## Compromisos');
    minutes.commitments.forEach((c) => {
      const dl = c.deadline ? ` _(${c.deadline})_` : '';
      lines.push(`- **${c.person}**: ${c.commitment}${dl}`);
    });
    lines.push('');
  }
  if (minutes.actionItems.length) {
    lines.push('## Tareas y próximos pasos');
    minutes.actionItems.forEach((a) => {
      const owner = a.owner ? ` → ${a.owner}` : '';
      const dl = a.deadline ? ` _(${a.deadline})_` : '';
      lines.push(`- [ ] ${a.task}${owner}${dl}`);
    });
    lines.push('');
  }
  if (minutes.nextSteps) {
    lines.push('## Siguiente acción', minutes.nextSteps, '');
  }
  if (transcript) {
    lines.push('---', '## Transcripción completa', '', transcript);
  }
  return lines.join('\n');
}

module.exports = { generateMinutes, minutesToDocText };
