const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFrameRate } = require('../src/connectors/video-pipeline');

test('parseFrameRate convierte fracciones de ffprobe sin ejecutar codigo', () => {
  assert.equal(parseFrameRate('30000/1001'), 30000 / 1001);
  assert.equal(parseFrameRate('30/1'), 30);
  assert.equal(parseFrameRate('24'), 24);
  assert.equal(parseFrameRate('0/0'), null);
  assert.equal(parseFrameRate('process.exit()'), null);
  assert.equal(parseFrameRate(''), null);
});
