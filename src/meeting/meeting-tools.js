// Tools meeting.* — inician/detienen reuniones y generan minutas en Docs.
// El flujo de audio va por el endpoint HTTP /meeting/chunk (server.js),
// no por estas tools — estas solo controlan el estado de la sesión.

const { startSession, getSession, clearSession } = require('./meeting-session');
const { generateMinutes, minutesToDocText } = require('./meeting-minutes');

function createMeetingTools({ eventBus, modelProvider, googleAuthFactory }) {
  return [
    {
      name: 'meeting.start',
      description: 'Iniciar modo reunión: activa la grabación de audio en el HUD, transcribe en tiempo real y prepara la minuta al finalizar. Input: { title (nombre de la reunión, opcional) }.',
      risk: 'medium',
      permissions: ['meeting:record'],
      execute: async (input) => {
        const title = String(input?.title || 'Reunión').trim() || 'Reunión';
        const session = startSession({ title });
        eventBus.emit('meeting_started', { id: session.id, title, startedAt: session.startedAt });
        return { started: true, id: session.id, title, startedAt: session.startedAt };
      }
    },
    {
      name: 'meeting.status',
      description: 'Estado de la reunión activa: si hay una en curso, cuántos fragmentos se transcribieron y cuánto tiempo lleva.',
      risk: 'low',
      permissions: [],
      execute: async () => {
        const session = getSession();
        if (!session || !session.isActive) return { active: false };
        return { active: true, ...session.toStatus() };
      }
    },
    {
      name: 'meeting.stop',
      description: 'Terminar la reunión activa, generar la minuta estructurada y guardarla en Google Docs. Devuelve resumen, decisiones, tareas y URL del doc.',
      risk: 'medium',
      permissions: ['meeting:record'],
      execute: async () => {
        const session = getSession();
        if (!session || !session.isActive) throw new Error('MEETING_NOT_ACTIVE');

        session.stop();
        const transcript = session.getTranscript();
        eventBus.emit('meeting_stopped', { id: session.id, title: session.title, chunks: session.chunks.length });

        // Generar minuta
        let minutes = { summary: '', decisions: [], commitments: [], actionItems: [], topics: [], nextSteps: '' };
        if (modelProvider && transcript) {
          try {
            minutes = await generateMinutes({ transcript, title: session.title, modelProvider });
          } catch (_) { /* minuta vacía si el modelo falla */ }
        }

        eventBus.emit('meeting_minutes_ready', { id: session.id, title: session.title, minutes });

        // Crear Doc si hay auth de Google
        let docUrl = null;
        if (googleAuthFactory) {
          try {
            const auth = await googleAuthFactory.getClient();
            const { google } = require('googleapis');
            const docs = google.docs({ version: 'v1', auth });
            const drive = google.drive({ version: 'v3', auth });

            const docTitle = `Minuta: ${session.title} — ${new Date(session.startedAt).toLocaleDateString('es-CL')}`;
            const docText = minutesToDocText({
              title: session.title,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              minutes,
              transcript
            });

            const created = await docs.documents.create({ requestBody: { title: docTitle } });
            const docId = created.data.documentId;

            await docs.documents.batchUpdate({
              documentId: docId,
              requestBody: {
                requests: [{ insertText: { location: { index: 1 }, text: docText } }]
              }
            });

            const file = await drive.files.get({ fileId: docId, fields: 'webViewLink' });
            docUrl = file.data.webViewLink;
            eventBus.emit('meeting_doc_created', { id: session.id, docUrl, title: docTitle });
          } catch (err) {
            eventBus.emit('meeting_doc_error', { id: session.id, error: err.message });
          }
        }

        clearSession();

        return {
          id: session.id,
          title: session.title,
          durationSeconds: session.toStatus().durationSeconds,
          chunks: session.chunks.length,
          minutes,
          docUrl
        };
      }
    }
  ];
}

module.exports = { createMeetingTools };
