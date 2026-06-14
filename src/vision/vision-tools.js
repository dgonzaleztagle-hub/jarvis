const fs = require('fs');
const path = require('path');

const MEDIA_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif'
};

const DEFAULT_PROMPT = `Analiza esta imagen y devuelve SOLO JSON con lo que observas:
{ "tipo": "boleta|factura|documento|foto|captura|otro", "texto": "todo el texto legible", "resumen": "qué es y qué datos contiene", "datos": { pares clave-valor de cualquier dato estructurado que detectes: montos, fechas, nombres, totales } }
No inventes datos que no estén en la imagen.`;

function createVisionTools({ visionProvider, dataDir }) {
  const inboxDir = path.join(dataDir, 'inbox');

  return [
    {
      name: 'vision.read_image',
      description: 'Leer y analizar una imagen de la bandeja local (foto, boleta, documento, captura) usando visión del modelo. Input: { file (nombre del archivo en la bandeja), prompt (opcional, instrucción específica de qué extraer, ej: "dame el monto total y el comercio") }. Devuelve el análisis. Úsalo para extraer datos de boletas/documentos que el usuario envió.',
      risk: 'medium',
      permissions: ['model:external_llm'],
      required: ['file'],
      aliases: { file: ['archivo', 'filename', 'nombre'], prompt: ['instruccion', 'pregunta'] },
      execute: async (input) => {
        if (!visionProvider?.analyzeImage) {
          throw new Error('VISION_NOT_AVAILABLE: el proveedor de modelo actual no soporta imágenes');
        }
        const fileName = path.basename(String(input.file || ''));
        const filePath = path.join(inboxDir, fileName);
        if (!fs.existsSync(filePath)) throw new Error(`INBOX_FILE_NOT_FOUND: ${fileName}`);
        const ext = path.extname(fileName).toLowerCase();
        const mediaType = MEDIA_TYPES[ext];
        if (!mediaType) throw new Error(`UNSUPPORTED_IMAGE_TYPE: ${ext}`);

        const imageBase64 = fs.readFileSync(filePath).toString('base64');
        const prompt = String(input.prompt || '').trim()
          ? `${input.prompt}\n\nDevuelve la respuesta como JSON.`
          : DEFAULT_PROMPT;
        const result = await visionProvider.analyzeImage({ imageBase64, mediaType, prompt });
        return { file: fileName, analysis: result.data };
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
