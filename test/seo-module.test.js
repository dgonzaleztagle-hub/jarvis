const test = require('node:test');
const assert = require('node:assert/strict');
const { auditAeo } = require('../src/modules/seo/aeo-audit-tool');
const { createReportTool } = require('../src/modules/seo/report-tool');

function withMockFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = async (url) => handler(String(url));
  return fn().finally(() => { global.fetch = original; });
}

const GOOD_HTML = `<!doctype html><html><head>
  <meta name="author" content="Equipo Jarvis">
  <script type="application/ld+json">{"@type":"Organization","name":"Jarvis"}</script>
</head><body>
  <h2>¿Qué hace este producto?</h2>
  <p>Respuesta corta y clara.</p>
</body></html>`;

const BAD_HTML = `<!doctype html><html><head></head><body>
  <h2>Sobre nosotros</h2>
  <p>${'palabra '.repeat(200)}</p>
</body></html>`;

test('seo.audit_aeo detecta señales de citabilidad presentes', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/llms.txt')) return { ok: true, status: 200, text: async () => 'allow: /' };
    return { ok: true, status: 200, text: async () => GOOD_HTML };
  }, async () => {
    const result = await auditAeo('https://example.com');
    assert.equal(result.ok, true);
    assert.equal(result.checks.hasEntitySchema, true);
    assert.equal(result.checks.hasQuestionHeadings, true);
    assert.equal(result.checks.hasLlmsTxt, true);
    assert.ok(result.score > 50);
  });
});

test('seo.audit_aeo marca issues cuando faltan señales y hay parrafos largos', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/llms.txt')) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => BAD_HTML };
  }, async () => {
    const result = await auditAeo('https://example.com');
    assert.equal(result.ok, true);
    assert.equal(result.checks.hasEntitySchema, false);
    assert.equal(result.checks.hasLlmsTxt, false);
    assert.equal(result.checks.noTextWalls, false);
    assert.ok(result.issues.length >= 3);
    assert.ok(result.score < 50);
  });
});

test('seo.generate_report compone narrativa a partir de auditorias sin pegarle a la red', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/llms.txt')) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => GOOD_HTML };
  }, async () => {
    const fakeModel = {
      generateText: async ({ messages }) => {
        assert.ok(messages[0].content.includes('example.com'));
        return { text: '# Reporte\n\nTodo bien.' };
      }
    };
    const tool = createReportTool({ modelProvider: fakeModel, contentHonestyClause: 'no inventes' });
    const result = await tool.execute({ urls: ['https://example.com'] });
    assert.equal(result.ok, true);
    assert.match(result.report, /Reporte/);
    assert.equal(result.seoScores[0].url, 'https://example.com');
    assert.ok(typeof result.aeoScores[0].score === 'number');
  });
});
