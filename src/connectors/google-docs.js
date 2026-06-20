const { google } = require('googleapis');
const { generateWithContinuation } = require('../model/long-content');
const { CONTENT_HONESTY_CLAUSE } = require('../conversation/persona-core');

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

// Extrae texto plano del árbol de contenido que devuelve la Docs API.
function extractDocText(content = []) {
  const parts = [];
  for (const el of content) {
    if (el.paragraph) {
      const text = (el.paragraph.elements || []).map((e) => e.textRun?.content || '').join('');
      if (text.trim()) parts.push(text);
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          const cellText = extractDocText(cell.content || []);
          if (cellText.trim()) parts.push(cellText);
        }
      }
    } else if (el.sectionBreak) {
      parts.push('\n');
    }
  }
  return parts.join('');
}

// Resuelve un docId a partir de input.docId, input.documentId, o busca por input.name en Drive.
async function resolveDocId(auth, input) {
  const docId = input.docId || input.documentId || input.id;
  if (docId) return docId;

  const name = String(input.name || input.title || '').trim();
  if (!name) throw new Error('GOOGLE_DOC_REQUIRES_ID_OR_NAME');

  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `name contains '${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.document' and trashed=false`,
    pageSize: 1,
    fields: 'files(id,name)',
    orderBy: 'modifiedTime desc'
  });
  const file = res.data.files?.[0];
  if (!file) throw new Error(`GOOGLE_DOC_NOT_FOUND: ${name}`);
  return file.id;
}

function createGoogleDocsTools({ authFactory, modelProvider }) {
  async function createDocument(input = {}) {
    if (!input.title) throw new Error('GOOGLE_DOC_REQUIRES_TITLE');

    let content = String(input.content || '');
    const brief = String(input.brief || '').trim();

    if (!content.trim() && brief) {
      const genPrompt = `Escribe el contenido COMPLETO de un documento para: ${brief}.\nFormato: Markdown (encabezados con #/##/###, listas con -, negritas con **). Contenido real y completo, no esquemático ni "lorem ipsum". Devuelve SOLO el contenido del documento, sin explicaciones ni envoltorio.`;
      try {
        if (typeof modelProvider?.generateText === 'function') {
          const { text } = await generateWithContinuation({
            callOnce: async (messages, maxTokens) => {
              const out = await modelProvider.generateText({
                system: `Eres un redactor de documentos. Devuelves únicamente el contenido en Markdown, sin explicaciones.\n\n${CONTENT_HONESTY_CLAUSE}`,
                messages, maxTokens, temperature: 0.5, purpose: 'doc_content'
              });
              return { text: String(out.text || ''), stopReason: out.stopReason || null };
            },
            prompt: genPrompt,
            isComplete: (_text, stopReason) => stopReason !== 'max_tokens'
          });
          content = text;
        }
      } catch (err) {
        throw new Error(`GOOGLE_DOC_GENERATION_FAILED: ${err.message}`);
      }
    }

    if (!content.trim()) throw new Error('GOOGLE_DOC_REQUIRES_CONTENT_OR_BRIEF');

    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${markdownToHtml(content)}</body></html>`;

    const response = await drive.files.create({
      requestBody: { name: input.title, mimeType: 'application/vnd.google-apps.document' },
      media: { mimeType: 'text/html', body: html },
      fields: 'id,name,webViewLink'
    });

    return {
      id: response.data.id,
      name: response.data.name,
      url: response.data.webViewLink
    };
  }

  async function readDocument(input = {}) {
    const auth = authFactory.getClient();
    const docId = await resolveDocId(auth, input);
    const docs = google.docs({ version: 'v1', auth });

    const response = await docs.documents.get({ documentId: docId });
    const doc = response.data;
    const text = extractDocText(doc.body?.content || []);
    const maxChars = Number(input.maxChars) || 12000;

    return {
      docId,
      title: doc.title,
      url: `https://docs.google.com/document/d/${docId}`,
      text: text.slice(0, maxChars),
      totalChars: text.length,
      truncated: text.length > maxChars
    };
  }

  async function updateDocument(input = {}) {
    const auth = authFactory.getClient();
    const docId = await resolveDocId(auth, input);

    let content = String(input.content || '').trim();
    const brief = String(input.brief || '').trim();

    if (!content && brief) {
      try {
        if (typeof modelProvider?.generateText === 'function') {
          const { text } = await generateWithContinuation({
            callOnce: async (messages, maxTokens) => {
              const out = await modelProvider.generateText({
                system: `Eres un redactor de documentos. Devuelves únicamente el contenido en texto plano (sin markdown), sin explicaciones.\n\n${CONTENT_HONESTY_CLAUSE}`,
                messages, maxTokens, temperature: 0.5, purpose: 'doc_content'
              });
              return { text: String(out.text || ''), stopReason: out.stopReason || null };
            },
            prompt: `Escribe el contenido COMPLETO para agregar al documento: ${brief}. Devuelve SOLO el contenido, sin encabezados ni envoltorio.`,
            isComplete: (_text, stopReason) => stopReason !== 'max_tokens'
          });
          content = text;
        }
      } catch (err) {
        throw new Error(`GOOGLE_DOC_GENERATION_FAILED: ${err.message}`);
      }
    }

    if (!content) throw new Error('GOOGLE_DOC_UPDATE_REQUIRES_CONTENT_OR_BRIEF');

    const docs = google.docs({ version: 'v1', auth });

    // Busca el último índice del doc para insertar al final.
    const docRes = await docs.documents.get({ documentId: docId, fields: 'body.content,title' });
    const bodyContent = docRes.data.body?.content || [];
    const lastEl = bodyContent[bodyContent.length - 1];
    const endIndex = lastEl?.endIndex ? lastEl.endIndex - 1 : 1;

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: endIndex }, text: `\n${content}` } }]
      }
    });

    return {
      ok: true,
      docId,
      title: docRes.data.title,
      url: `https://docs.google.com/document/d/${docId}`,
      appendedChars: content.length
    };
  }

  async function listDocuments(input = {}) {
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });

    const queryParts = ["mimeType='application/vnd.google-apps.document'", 'trashed=false'];
    if (input.query) {
      queryParts.push(`name contains '${String(input.query).replace(/'/g, "\\'")}'`);
    }

    const response = await drive.files.list({
      q: queryParts.join(' and '),
      pageSize: Math.min(Number(input.maxResults) || 20, 50),
      fields: 'files(id,name,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc'
    });

    return {
      documents: (response.data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        url: f.webViewLink,
        modifiedTime: f.modifiedTime
      }))
    };
  }

  return [
    {
      name: 'google.docs.create_document',
      description: 'Crear un Google Doc nuevo en Drive. Pasa un BRIEF en lenguaje natural y la herramienta genera el contenido por dentro. Input: { title, brief: "de qué trata el documento, secciones y tono" }. Alternativa: si el usuario dictó el contenido literal, pasalo en "content" (Markdown).',
      risk: 'medium',
      permissions: ['google:drive:write', 'google:docs:create'],
      required: ['title'],
      aliases: {
        title: ['titulo', 'título', 'name', 'nombre'],
        content: ['body', 'contenido', 'markdown', 'text', 'texto'],
        brief: ['resumen', 'tema', 'descripcion', 'descripción']
      },
      execute: createDocument
    },
    {
      name: 'google.docs.read_document',
      description: 'Leer el contenido de texto de un Google Doc existente. Input: { docId } o { name: "parte del nombre" }. Devuelve el texto completo (hasta 12000 chars, truncado con flag si excede). Úsalo para resumir, responder preguntas sobre el contenido, o procesar el texto antes de actualizar.',
      risk: 'low',
      permissions: ['google:docs:read'],
      aliases: {
        docId: ['documentId', 'document_id', 'id'],
        name: ['title', 'titulo', 'nombre'],
        maxChars: ['max_chars', 'limit', 'chars']
      },
      execute: readDocument
    },
    {
      name: 'google.docs.update_document',
      description: 'Agregar contenido al final de un Google Doc existente. Input: { docId } o { name: "parte del nombre" }, más { content: "texto a agregar" } o { brief: "qué agregar" }. Úsalo para añadir secciones, actualizar minutas, anexar información nueva sin reemplazar lo existente.',
      risk: 'medium',
      permissions: ['google:docs:write'],
      aliases: {
        docId: ['documentId', 'document_id', 'id'],
        name: ['title', 'titulo', 'nombre'],
        content: ['texto', 'text', 'body', 'contenido'],
        brief: ['resumen', 'tema', 'descripcion']
      },
      execute: updateDocument
    },
    {
      name: 'google.docs.list_documents',
      description: 'Listar Google Docs del Drive del usuario, ordenados por modificación reciente. Input opcional: { query: "texto en el nombre", maxResults }. Úsalo para encontrar un documento cuando el usuario no sabe el id.',
      risk: 'low',
      permissions: ['google:drive:read'],
      aliases: {
        query: ['search', 'buscar', 'nombre', 'name', 'filter'],
        maxResults: ['max_results', 'limit', 'count']
      },
      execute: listDocuments
    }
  ];
}

module.exports = {
  createGoogleDocsTools,
  markdownToHtml
};
