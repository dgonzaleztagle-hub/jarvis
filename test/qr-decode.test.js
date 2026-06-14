const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVisionTools } = require('../src/vision/vision-tools');

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-qr-'));
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  return dir;
}

function decodeQrTool(dataDir) {
  return createVisionTools({ visionProvider: null, dataDir })
    .find((t) => t.name === 'vision.decode_qr');
}

test('decodifica QR estándar generado', async () => {
  const dataDir = tempDataDir();
  const QRCode = require('qrcode');
  const filePath = path.join(dataDir, 'inbox', 'standard.png');
  await QRCode.toFile(filePath, 'https://rishtedar.cl/menu', { width: 300 });

  const result = await decodeQrTool(dataDir).execute({ file: 'standard.png' });
  assert.equal(result.content, 'https://rishtedar.cl/menu');
  assert.equal(result.isUrl, true);
});

test('decodifica QR estilizado de Instagram (logos en patrones de búsqueda, gradiente)', async () => {
  const dataDir = tempDataDir();
  fs.copyFileSync(
    path.join(__dirname, 'fixtures', 'instagram-qr.jpg'),
    path.join(dataDir, 'inbox', 'instagram.jpg')
  );

  const result = await decodeQrTool(dataDir).execute({ file: 'instagram.jpg' });
  // El punto sutil del handle debe sobrevivir el decode (delicias._rys)
  assert.match(result.content, /^https:\/\/www\.instagram\.com\/delicias\._rys/);
  assert.equal(result.isUrl, true);
});

test('imagen sin QR falla con error claro', async () => {
  const dataDir = tempDataDir();
  const { Jimp } = require('jimp');
  const blank = new Jimp({ width: 100, height: 100, color: 0xffffffff });
  await blank.write(path.join(dataDir, 'inbox', 'blank.png'));

  await assert.rejects(
    () => decodeQrTool(dataDir).execute({ file: 'blank.png' }),
    /QR_NOT_FOUND/
  );
});
