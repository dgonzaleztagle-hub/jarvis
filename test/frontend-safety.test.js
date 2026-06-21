const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `No se encontro ${signature}`);
  const nextExport = source.indexOf('\nexport function ', start + signature.length);
  const nextLocal = source.indexOf('\nfunction ', start + signature.length);
  const candidates = [nextExport, nextLocal].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test('meeting transcript escapa texto externo antes de inyectar resaltado HTML', () => {
  const source = readRepoFile('public', 'modules', 'artifacts.js');
  const appendChunkToPanel = extractFunction(source, 'export function appendChunkToPanel');
  assert.match(source, /function escapeHtml/);
  assert.match(appendChunkToPanel, /escapeHtml\(chunk\.text\)/);
  assert.doesNotMatch(appendChunkToPanel, /innerHTML\s*=\s*chunk\.text/);
});

test('preview iframe mantiene sandbox sin same-origin', () => {
  const source = readRepoFile('public', 'modules', 'preview-panel.js');
  assert.match(source, /frame\.setAttribute\('sandbox',\s*'allow-scripts'\)/);
  assert.doesNotMatch(source, /setAttribute\('sandbox',\s*'[^']*allow-same-origin/);
});
