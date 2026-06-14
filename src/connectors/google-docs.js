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

function createGoogleDocsTools({ authFactory }) {
  async function createDocument(input = {}) {
    if (!input.title || !input.content) {
      throw new Error('GOOGLE_DOC_REQUIRES_TITLE_AND_CONTENT');
    }

    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${markdownToHtml(input.content)}</body></html>`;

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
      description: 'Create a Google Doc in the user Drive from Markdown-like content. Always gather ALL content and data BEFORE calling this tool — there is no update tool, so the document must be complete on creation.',
      risk: 'medium',
      permissions: ['google:drive:write', 'google:docs:create'],
      required: ['title', 'content'],
      aliases: {
        title: ['titulo', 'título', 'name', 'nombre'],
        content: ['body', 'contenido', 'markdown', 'text', 'texto']
      },
      execute: createDocument
    }
  ];
}

module.exports = {
  createGoogleDocsTools,
  markdownToHtml
};
