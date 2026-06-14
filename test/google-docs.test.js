const test = require('node:test');
const assert = require('node:assert/strict');

// Stub de googleapis: evita llamadas reales y nos deja inspeccionar el HTML
// que llega a drive.files.create.
const googleapisPath = require.resolve('googleapis');
let lastCreateCall = null;
require.cache[googleapisPath] = {
  id: googleapisPath,
  filename: googleapisPath,
  loaded: true,
  exports: {
    google: {
      drive: () => ({
        files: {
          create: async (opts) => {
            lastCreateCall = opts;
            return { data: { id: 'doc123', name: opts.requestBody.name, webViewLink: 'https://docs.google.com/document/d/doc123' } };
          }
        }
      })
    }
  }
};

const { createGoogleDocsTools } = require('../src/connectors/google-docs');

function getTool(modelProvider) {
  const authFactory = { getClient: () => ({}) };
  const tools = createGoogleDocsTools({ authFactory, modelProvider });
  return tools.find((t) => t.name === 'google.docs.create_document');
}

test('google.docs.create_document sin title rechaza', async () => {
  const tool = getTool();
  await assert.rejects(() => tool.execute({ brief: 'algo' }), /GOOGLE_DOC_REQUIRES_TITLE/);
});

test('google.docs.create_document sin content ni brief rechaza', async () => {
  const tool = getTool();
  await assert.rejects(() => tool.execute({ title: 'Doc' }), /GOOGLE_DOC_REQUIRES_CONTENT_OR_BRIEF/);
});

test('google.docs.create_document con content literal lo usa directo (sin llamar al modelo)', async () => {
  let called = false;
  const modelProvider = { generateText: async () => { called = true; return { text: 'no debería usarse' }; } };
  const tool = getTool(modelProvider);

  const res = await tool.execute({ title: 'Notas', content: '# Hola\nTexto literal del usuario.' });
  assert.equal(res.id, 'doc123');
  assert.equal(called, false);
  assert.match(lastCreateCall.media.body, /Texto literal del usuario/);
});

test('google.docs.create_document con brief genera el contenido por dentro con el modelo activo', async () => {
  const modelProvider = {
    generateText: async ({ maxTokens }) => {
      assert.equal(maxTokens, 6000);
      return { text: '# Informe\nContenido generado por el modelo.' };
    }
  };
  const tool = getTool(modelProvider);

  const res = await tool.execute({ title: 'Informe', brief: 'informe ejecutivo de la reunión' });
  assert.equal(res.id, 'doc123');
  assert.match(lastCreateCall.media.body, /Contenido generado por el modelo/);
  assert.match(lastCreateCall.media.body, /<h1>Informe<\/h1>/);
});
