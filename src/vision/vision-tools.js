const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const MEDIA_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif'
};

const DEFAULT_PROMPT = `Analiza esta imagen y devuelve SOLO JSON con lo que observas:
{ "tipo": "boleta|factura|documento|foto|captura|otro", "texto": "todo el texto legible", "resumen": "qué es y qué datos contiene", "datos": { pares clave-valor de cualquier dato estructurado que detectes: montos, fechas, nombres, totales } }
No inventes datos que no estén en la imagen.`;

function fetchImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      const contentType = res.headers['content-type'] || 'image/jpeg';
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ base64: Buffer.concat(chunks).toString('base64'), contentType }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function createVisionTools({ visionProvider, dataDir, googleAuthFactory }) {
  const inboxDir = path.join(dataDir, 'inbox');

  async function resolveImageSource(input) {
    // 1. URL directa
    if (input.url) {
      const { base64, contentType } = await fetchImageAsBase64(String(input.url));
      const mediaType = MEDIA_TYPES[`.${contentType.split('/')[1]?.split(';')[0]}`] || contentType.split(';')[0] || 'image/jpeg';
      return { imageBase64: base64, mediaType, source: input.url };
    }

    // 2. Archivo en Drive (requiere googleAuthFactory)
    if (input.driveFileId || input.driveFile) {
      if (!googleAuthFactory) throw new Error('VISION_DRIVE_AUTH_NOT_AVAILABLE');
      const { google } = require('googleapis');
      const auth = googleAuthFactory.getClient();
      const drive = google.drive({ version: 'v3', auth });
      const fileId = String(input.driveFileId || input.driveFile);

      const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
      const mimeType = meta.data.mimeType;
      if (!Object.values(MEDIA_TYPES).includes(mimeType)) {
        throw new Error(`VISION_UNSUPPORTED_DRIVE_TYPE: ${mimeType} no es una imagen soportada`);
      }

      const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
      const imageBase64 = Buffer.from(res.data).toString('base64');
      return { imageBase64, mediaType: mimeType, source: `drive:${fileId}` };
    }

    // 3. Archivo local en inbox (comportamiento original)
    const fileName = path.basename(String(input.file || ''));
    if (!fileName) throw new Error('VISION_REQUIRES_FILE_URL_OR_DRIVE_ID');
    const filePath = path.join(inboxDir, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`INBOX_FILE_NOT_FOUND: ${fileName}`);
    const ext = path.extname(fileName).toLowerCase();
    const mediaType = MEDIA_TYPES[ext];
    if (!mediaType) throw new Error(`UNSUPPORTED_IMAGE_TYPE: ${ext}`);
    const imageBase64 = fs.readFileSync(filePath).toString('base64');
    return { imageBase64, mediaType, source: fileName };
  }

  return [
    {
      name: 'vision.read_image',
      description: 'Leer y analizar una imagen usando visión del modelo. Acepta: archivo local en la bandeja ({ file }), URL pública ({ url }), o archivo de Drive ({ driveFileId }). Input opcional: { prompt: instrucción específica de qué extraer }. Úsalo para extraer datos de boletas, documentos, capturas de pantalla, fotos de productos, etc.',
      risk: 'medium',
      permissions: ['model:external_llm'],
      aliases: {
        file: ['archivo', 'filename', 'nombre'],
        url: ['link', 'enlace', 'imagen_url'],
        driveFileId: ['drive_file_id', 'driveFile', 'drive_id'],
        prompt: ['instruccion', 'pregunta', 'que_extraer']
      },
      execute: async (input) => {
        if (!visionProvider?.analyzeImage) {
          throw new Error('VISION_NOT_AVAILABLE: el proveedor de modelo actual no soporta imágenes');
        }
        const { imageBase64, mediaType, source } = await resolveImageSource(input);
        const prompt = String(input.prompt || '').trim()
          ? `${input.prompt}\n\nDevuelve la respuesta como JSON.`
          : DEFAULT_PROMPT;
        const result = await visionProvider.analyzeImage({ imageBase64, mediaType, prompt });
        return { source, analysis: result.data };
      }
    },
    {
      name: 'vision.decode_qr',
      description: 'Decodificar un código QR de una imagen de la bandeja local y devolver su contenido REAL (la URL o texto codificado). Input: { file (nombre del archivo en la bandeja) }. Úsalo SIEMPRE que el usuario pregunte a dónde lleva un QR o qué contiene: el contenido codificado puede diferir del texto visible en la imagen, así que no adivines leyendo la imagen — decodifica.',
      risk: 'low',
      permissions: [],
      required: ['file'],
      aliases: { file: ['archivo', 'filename', 'nombre'] },
      execute: async (input) => {
        const { Jimp } = require('jimp');
        const fileName = path.basename(String(input.file || ''));
        const filePath = path.join(inboxDir, fileName);
        if (!fs.existsSync(filePath)) throw new Error(`INBOX_FILE_NOT_FOUND: ${fileName}`);

        const image = await Jimp.read(filePath);
        const { data, width, height } = image.bitmap;
        const pixels = new Uint8ClampedArray(data);

        // Motor principal: ZXing (WASM, sin binarios nativos). Lee QRs
        // estilizados (Instagram con logos en los patrones de búsqueda,
        // gradientes) que jsqr no logra ni localizar.
        let content = '';
        try {
          const { readBarcodes } = require('zxing-wasm/reader');
          const results = await readBarcodes(
            { data: pixels, width, height },
            { formats: ['QRCode'], tryHarder: true }
          );
          content = String(results?.[0]?.text || '').trim();
        } catch (_) {
          // WASM no disponible: cae al respaldo jsqr
        }

        if (!content) {
          const jsQR = require('jsqr');
          const code = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' });
          content = String(code?.data || '').trim();
        }

        if (!content) {
          throw new Error('QR_NOT_FOUND: no se detectó un código QR legible en la imagen');
        }
        return {
          file: fileName,
          content,
          isUrl: /^https?:\/\//i.test(content)
        };
      }
    }
  ];
}

module.exports = {
  createVisionTools
};
