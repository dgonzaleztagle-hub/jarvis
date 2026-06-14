const { google } = require('googleapis');

function markdownToHtml(markdown = '') {
  return String(markdown)
    .trim()
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>')
    .replace(/^---$/gim, '<hr>')
    .replace(/\n/g, '<br>');
}

function createGoogleDocsTools({ authFactory, modelProvider }) {
  async function createDocument(input = {}) {
    if (!input.title) {
      throw new Error('GOOGLE_DOC_REQUIRES_TITLE');
    }

    let content = String(input.content || '');
    const brief = String(input.brief || '').trim();

    // El contenido largo NO viaja en el toolCall (no cabe en el presupuesto de
    // la decisión): se genera acá, con techo amplio, usando el MODELO ACTIVO.
    // Mismo patrón que preview.render_html — ver REGLA en conversation-runtime.js.
    if (!content.trim() && brief) {
      const genPrompt = `Escribe el contenido COMPLETO de un documento para: ${brief}.\nFormato: Markdown (encabezados con #/##/###, listas con -, negritas con **). Contenido real y completo, no esquemático ni "lorem ipsum". Devuelve SOLO el contenido del documento, sin explicaciones ni envoltorio.`;
      try {
        if (typeof modelProvider?.generateText === 'function') {
          const out = await modelProvider.generateText({
            system: 'Eres un redactor de documentos. Devuelves únicamente el contenido en Markdown, sin explicaciones.',
            messages: [{ role: 'user', parts: [{ text: genPrompt }] }],
            temperature: 0.5, maxTokens: 6000, purpose: 'doc_content'
          });
          content = String(out.text || '').trim();
        }
      } catch (err) {
        throw new Error(`GOOGLE_DOC_GENERATION_FAILED: ${err.message}`);
      }
    }

    if (!content.trim()) {
      throw new Error('GOOGLE_DOC_REQUIRES_CONTENT_OR_BRIEF');
    }

    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${markdownToHtml(content)}</body></html>`;

    const response = await drive.files.create({
      requestBody: {
        name: input.title,
        mimeType: 'application/vnd.google-apps.document'
      },
      media: {
        mimeType: 'text/html',
        body: html
      },
      fields: 'id,name,webViewLink'
    });

    return {
      id: response.data.id,
      name: response.data.name,
      webViewLink: response.data.webViewLink
    };
  }

  return [
    {
      name: 'google.docs.create_document',
      description: 'Create a Google Doc in the user Drive. NO escribas tú el contenido completo: pasa un BRIEF corto en lenguaje natural y la herramienta genera el contenido por dentro. Input: { title, brief: "de qué trata el documento, secciones y tono" }. Alternativa: si el usuario dictó el contenido literal, pasalo directo en "content" (Markdown). There is no update tool — the document is created complete in one call.',
      risk: 'medium',
      permissions: ['google:drive:write', 'google:docs:create'],
      required: ['title'],
      aliases: {
        title: ['titulo', 'título', 'name', 'nombre'],
        content: ['body', 'contenido', 'markdown', 'text', 'texto'],
        brief: ['resumen', 'tema', 'descripcion', 'descripción']
      },
      execute: createDocument
    }
  ];
}

module.exports = {
  createGoogleDocsTools,
  markdownToHtml
};
