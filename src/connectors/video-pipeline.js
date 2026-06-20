// Pipeline de video — ffmpeg + Gemini STT + Remotion
//
// Capa siempre disponible (solo requiere ffmpeg):
//   video.info, video.cut_silences, video.transcribe, video.add_captions
//   video.fetch_footage, video.add_voiceover
//
// Capa break-glass (requiere video.setup_renderer una sola vez):
//   video.setup_renderer, video.list_templates
//   video.render, video.render_still, video.compose
//
// Templates Remotion (16 total):
//   KineticText, StatsCard, QuoteCard, NewsTicker, ProductShowcase,
//   CaptionedClip, DataViz, Testimonial, CodeExplainer, MusicVisualizer,
//   StatsWrapped, ProductCatalog, BeforeAfter, TikTokCaptions,
//   Audiogram, MarketingReel

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const RENDERER_DIR_NAME = path.join('video', 'renderer');
const READY_FLAG = '.ready';
const INBOX_DIR = path.join('video', 'inbox');
const RENDERS_DIR = path.join('video', 'renders');
const FOOTAGE_DIR = path.join('video', 'footage');

const TEMPLATE_SCHEMAS = {
  KineticText: {
    description: 'Palabras que entran escalonadas con spring physics. Ideal para anuncios y mensajes de impacto.',
    props: {
      lines: 'string[] — líneas de texto (cada línea se anima por separado)',
      bgColor: 'string — color de fondo hex (default "#000000")',
      accentColor: 'string — color de acento para palabras alternadas (default "#7F77DD")',
      fontStyle: '"bold"|"light"|"mono" (default "bold")',
      subtitle: 'string? — subtítulo que aparece después de las líneas',
      durationSecs: 'number — duración (default 6)'
    }
  },
  StatsCard: {
    description: 'Número grande que cuenta hacia arriba con spring, etiqueta y CTA. Para métricas de impacto.',
    props: {
      value: 'number — número final',
      label: 'string — descripción del dato',
      suffix: 'string? — sufijo (ej: "%", "K", "+")',
      prefix: 'string? — prefijo (ej: "$")',
      color: 'string — color de acento (default "#00C2FF")',
      cta: 'string? — texto de CTA',
      durationSecs: 'number (default 5)'
    }
  },
  QuoteCard: {
    description: 'Cita o testimonio con fondo dramático y marca. Para social proof en redes.',
    props: {
      quote: 'string — texto de la cita',
      author: 'string — nombre del autor',
      brandColor: 'string — color de marca (default "#6C63FF")',
      logo: 'string? — URL del logo',
      durationSecs: 'number (default 7)'
    }
  },
  NewsTicker: {
    description: 'Valor principal en pantalla completa con ticker animado. Para noticias y datos urgentes.',
    props: {
      headline: 'string — texto principal',
      value: 'string — valor destacado (ej: "$980")',
      context: 'string — contexto (ej: "+2.3% hoy")',
      ticker: 'string? — texto del ticker inferior',
      accentColor: 'string (default "#FF4444")',
      durationSecs: 'number (default 8)'
    }
  },
  ProductShowcase: {
    description: 'Imagen de producto + nombre + precio + badge. Para restaurantes, e-commerce, marcas.',
    props: {
      imageUrl: 'string — URL de la imagen',
      name: 'string — nombre del producto',
      price: 'string — precio (ej: "$12.990")',
      badge: 'string? — badge (ej: "Nuevo")',
      description: 'string? — descripción breve',
      brandColor: 'string (default "#FF6B35")',
      durationSecs: 'number (default 8)'
    }
  },
  CaptionedClip: {
    description: 'Video base con captions animadas y lower-third de marca.',
    props: {
      videoSrc: 'string — ruta al MP4',
      captions: 'Array<{ text: string, startSec: number, endSec: number }>',
      brandName: 'string — nombre de marca',
      brandColor: 'string (default "#000000")'
    }
  },
  DataViz: {
    description: 'Gráfico de barras horizontal animado con spring. Datos desde JSON. Para reportes y comparativas.',
    props: {
      title: 'string — título del gráfico',
      subtitle: 'string? — subtítulo',
      bars: 'Array<{ label: string, value: number, color?: string }> — máx 8 barras',
      accentColor: 'string — color de acento (default "#378ADD")',
      bgColor: 'string (default "#0A0A0A")',
      unit: 'string? — unidad (ej: "USD", "%", "kg")',
      durationSecs: 'number (default 10)'
    }
  },
  Testimonial: {
    description: 'Cita con type-on effect, estrellas con spring stagger, foto con clip-mask. Para social proof.',
    props: {
      quote: 'string — texto de la cita',
      author: 'string — nombre',
      role: 'string? — cargo o empresa',
      stars: 'number — 1-5 (default 5)',
      photoUrl: 'string? — URL de foto del autor',
      brandColor: 'string (default "#D4537E")',
      brandName: 'string? — marca al pie',
      durationSecs: 'number (default 9)'
    }
  },
  CodeExplainer: {
    description: 'Terminal macOS con typing animado y syntax highlighting. Para demos técnicas y tutoriales.',
    props: {
      title: 'string? — título sobre el terminal',
      command: 'string — comando a "escribir"',
      outputLines: 'Array<{ text: string, type: "success"|"error"|"info"|"muted" }>',
      accentColor: 'string (default "#5DCAA5")',
      durationSecs: 'number (default 10)'
    }
  },
  MusicVisualizer: {
    description: 'Now Playing card con barras de ecualizer animadas. Para artistas y contenido de música.',
    props: {
      trackTitle: 'string — nombre de la canción',
      artist: 'string — artista',
      accentColor: 'string — color de acento (default "#FF6B9D")',
      albumColor1: 'string — color 1 del gradiente de portada (default "#1a0533")',
      albumColor2: 'string — color 2 (default "#FF6B9D")',
      durationSecs: 'number (default 8)'
    }
  },
  StatsWrapped: {
    description: 'Video estilo Wrapped con una tarjeta animada por métrica. Para reportes anuales y resúmenes.',
    props: {
      year: 'number — año (ej: 2025)',
      brandName: 'string — nombre de la marca/persona',
      stats: 'Array<{ value: string|number, label: string, context?: string, accentColor?: string }>',
      bgColor: 'string (default "#0A0A0A")',
      durationPerStat: 'number — segundos por tarjeta (default 5)'
    }
  },
  ProductCatalog: {
    description: 'Catálogo animado: una escena por producto con clip-mask reveal. Para menús y e-commerce.',
    props: {
      products: 'Array<{ name: string, price: string, imageUrl?: string, badge?: string, description?: string }>',
      brandColor: 'string — color de marca',
      brandName: 'string — nombre de la marca',
      durationPerItem: 'number — segundos por producto (default 6)',
      bgColor: 'string (default "#FAFAFA")'
    }
  },
  BeforeAfter: {
    description: 'Wipe reveal entre dos imágenes/videos. Para remodelaciones, rediseños, transformaciones.',
    props: {
      beforeSrc: 'string — URL o ruta imagen/video "antes"',
      afterSrc: 'string — URL o ruta imagen/video "después"',
      beforeLabel: 'string? (default "Antes")',
      afterLabel: 'string? (default "Después")',
      wipeDir: '"left"|"right"|"top" (default "right")',
      brandColor: 'string (default "#534AB7")',
      durationSecs: 'number (default 8)'
    }
  },
  TikTokCaptions: {
    description: 'Captions palabra-por-palabra estilo TikTok/Reels, sincronizadas con STT de Gemini.',
    props: {
      segments: 'Array<{ text: string, startSec: number, endSec: number }> — output de video.transcribe',
      videoSrc: 'string? — video de fondo (opcional)',
      bgColor: 'string (default "#000000")',
      accentColor: 'string — color de palabra activa (default "#FACC15")',
      fontSize: 'number (default 72)',
      durationSecs: 'number — debe coincidir con duración del audio/video'
    }
  },
  Audiogram: {
    description: 'Visualización de audio: waveform animada sincronizada con el audio. Para podcasts y entrevistas.',
    props: {
      trackTitle: 'string — título del episodio/audio',
      author: 'string — nombre del speaker o podcast',
      accentColor: 'string (default "#1D9E75")',
      bgColor: 'string (default "#050F08")',
      coverGradient: 'string[]? — dos colores para el cover art generativo',
      durationSecs: 'number — debe coincidir con la duración del audio'
    }
  },
  MarketingReel: {
    description: 'Compositor de escenas: encadena cualquier template con Series. Duración dinámica según las escenas.',
    props: {
      scenes: 'Array<{ template: string, props: object, durationSecs?: number }> — lista de escenas en orden',
      brandName: 'string? — marca global (inyectada en cada escena si aplica)',
      accentColor: 'string? — color de acento global'
    }
  }
};

const STT_MODELS = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.0-flash-lite'];

async function transcribeWithGemini({ fileBuffer, mimeType, prompt, apiKey }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
  let lastError;
  for (const model of STT_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: fileBuffer.toString('base64') } }
            ]}],
            generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 4096 }
          })
        }
      );
      if (!res.ok) { lastError = new Error(`GEMINI_${res.status}`); continue; }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');
      return text;
    } catch (err) { lastError = err; }
  }
  throw lastError || new Error('GEMINI_TRANSCRIBE_FAILURE');
}

function createVideoTools({ dataDir, credentialVault }) {
  const rendererDir = path.join(dataDir, RENDERER_DIR_NAME);
  const inboxDir   = path.join(dataDir, INBOX_DIR);
  const rendersDir = path.join(dataDir, RENDERS_DIR);
  const footageDir = path.join(dataDir, FOOTAGE_DIR);
  const readyFlag  = path.join(rendererDir, READY_FLAG);

  function isRendererReady() { return fs.existsSync(readyFlag); }

  function requireRenderer() {
    if (!isRendererReady()) return {
      ok: false, needsSetup: true,
      error: 'Renderer no instalado. Ejecuta video.setup_renderer una vez (tarda ~2 min).'
    };
    return null;
  }

  async function runFfprobe(filePath) {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath
    ]);
    return JSON.parse(stdout);
  }

  async function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      const stderr = [];
      proc.stderr.on('data', d => stderr.push(d.toString()));
      proc.on('close', code => {
        if (code === 0) resolve(stderr.join(''));
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-3).join('')}`));
      });
    });
  }

  async function downloadFile(url, destPath) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer);
    return destPath;
  }

  return [

    // ── video.info ──────────────────────────────────────────────────────────────
    {
      name: 'video.info',
      description: 'Metadata de un video o audio: duración, resolución, codec, tamaño. Requiere ffprobe.',
      input_schema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
      riskLevel: 'low',
      async execute(input) {
        const filePath = path.isAbsolute(input.filePath) ? input.filePath : path.join(inboxDir, input.filePath);
        if (!fs.existsSync(filePath)) return { ok: false, error: `No encontrado: ${filePath}` };
        try {
          const probe = await runFfprobe(filePath);
          const fmt = probe.format || {};
          const video = (probe.streams || []).find(s => s.codec_type === 'video');
          const audio = (probe.streams || []).find(s => s.codec_type === 'audio');
          return {
            ok: true, file: path.basename(filePath),
            durationSecs: Math.round(Number(fmt.duration) || 0),
            sizeMb: ((Number(fmt.size) || 0) / 1e6).toFixed(1),
            format: fmt.format_name,
            video: video ? { codec: video.codec_name, width: video.width, height: video.height, fps: eval(video.r_frame_rate) || null } : null,
            audio: audio ? { codec: audio.codec_name, sampleRate: audio.sample_rate } : null
          };
        } catch (err) {
          if (err.code === 'ENOENT') return { ok: false, error: 'ffprobe no encontrado. Instala ffmpeg.' };
          return { ok: false, error: err.message };
        }
      }
    },

    // ── video.cut_silences ──────────────────────────────────────────────────────
    {
      name: 'video.cut_silences',
      description: 'Cortar silencios de un video con ffmpeg. Input: { filePath, minSilenceDuration? (default 0.7s), threshold? (default -40dB), outputName? }',
      input_schema: { type: 'object', properties: { filePath: { type: 'string' }, minSilenceDuration: { type: 'number' }, threshold: { type: 'number' }, outputName: { type: 'string' } }, required: ['filePath'] },
      riskLevel: 'medium',
      async execute(input) {
        const filePath = path.isAbsolute(input.filePath) ? input.filePath : path.join(inboxDir, input.filePath);
        if (!fs.existsSync(filePath)) return { ok: false, error: `No encontrado: ${filePath}` };
        const minDur = Number(input.minSilenceDuration) || 0.7;
        const thresh = Number(input.threshold) || -40;
        try {
          const { stderr: detectOutput } = await execFileAsync('ffmpeg', [
            '-i', filePath, '-af', `silencedetect=noise=${thresh}dB:d=${minDur}`, '-f', 'null', '-'
          ]).catch(e => ({ stderr: e.stderr || e.message }));
          const starts = [], ends = [];
          let m;
          const sr = /silence_start: ([\d.]+)/g;
          const er = /silence_end: ([\d.]+)/g;
          while ((m = sr.exec(detectOutput)) !== null) starts.push(parseFloat(m[1]));
          while ((m = er.exec(detectOutput)) !== null) ends.push(parseFloat(m[1]));
          const silences = starts.map((s, i) => ({ start: s, end: ends[i] })).filter(s => s.end !== undefined);
          if (silences.length === 0) return { ok: true, outputFile: filePath, silencesFound: 0, note: 'Sin silencios detectados.' };
          const probe = await runFfprobe(filePath);
          const totalDur = Number(probe.format?.duration) || 0;
          const keepSegments = [];
          let cursor = 0;
          for (const s of silences) { if (s.start > cursor) keepSegments.push([cursor, s.start]); cursor = s.end; }
          if (cursor < totalDur) keepSegments.push([cursor, totalDur]);
          if (keepSegments.length === 0) return { ok: false, error: 'Video completamente silencioso.' };
          fs.mkdirSync(rendersDir, { recursive: true });
          const baseName = path.basename(filePath, path.extname(filePath));
          const outFile = path.join(rendersDir, `${input.outputName || baseName + '_cut'}.mp4`);
          const filterParts = keepSegments.map((seg, i) =>
            `[0:v]trim=${seg[0]}:${seg[1]},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=${seg[0]}:${seg[1]},asetpts=PTS-STARTPTS[a${i}]`
          );
          const filterComplex = [
            ...filterParts,
            `${keepSegments.map((_, i) => `[v${i}]`).join('')}concat=n=${keepSegments.length}:v=1:a=0[outv]`,
            `${keepSegments.map((_, i) => `[a${i}]`).join('')}concat=n=${keepSegments.length}:v=0:a=1[outa]`
          ].join(';');
          await runFfmpeg(['-i', filePath, '-filter_complex', filterComplex, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-y', outFile]);
          const outProbe = await runFfprobe(outFile);
          return { ok: true, outputFile: outFile, originalDuration: Math.round(totalDur), outputDuration: Math.round(Number(outProbe.format?.duration) || 0), silencesRemoved: silences.length };
        } catch (err) {
          if (err.code === 'ENOENT') return { ok: false, error: 'ffmpeg no encontrado.' };
          return { ok: false, error: err.message };
        }
      }
    },

    // ── video.transcribe ────────────────────────────────────────────────────────
    {
      name: 'video.transcribe',
      description: 'Transcribir video o audio con Gemini STT. Devuelve texto + segmentos + archivo .srt. Input: { filePath, language? }',
      input_schema: { type: 'object', properties: { filePath: { type: 'string' }, language: { type: 'string' } }, required: ['filePath'] },
      riskLevel: 'low',
      async execute(input) {
        const filePath = path.isAbsolute(input.filePath) ? input.filePath : path.join(inboxDir, input.filePath);
        if (!fs.existsSync(filePath)) return { ok: false, error: `No encontrado: ${filePath}` };
        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/opus' };
        const mimeType = mimeMap[ext] || 'video/mp4';
        const lang = input.language || 'es';
        const prompt = `Transcribe exactamente lo que se dice en este ${mimeType.startsWith('video') ? 'video' : 'audio'}. Idioma esperado: ${lang}.\nDevuelve JSON exacto: { "transcript": "texto completo", "segments": [{ "text": "...", "startSec": 0, "endSec": 3 }] }\nSolo el JSON, sin markdown.`;
        try {
          const apiKey = credentialVault?.get('GEMINI_API_KEY');
          const rawText = await transcribeWithGemini({ fileBuffer, mimeType, prompt, apiKey });
          let parsed;
          try { parsed = JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()); }
          catch (_) { return { ok: true, transcript: rawText, segments: [], note: 'No se pudo parsear como JSON.' }; }
          let srtFile = null;
          if (parsed.segments?.length > 0) {
            const fmt = s => { const h = String(Math.floor(s/3600)).padStart(2,'0'), m = String(Math.floor((s%3600)/60)).padStart(2,'0'), ss = String(Math.floor(s%60)).padStart(2,'0'), ms = String(Math.round((s%1)*1000)).padStart(3,'0'); return `${h}:${m}:${ss},${ms}`; };
            const srt = parsed.segments.map((seg, i) => `${i+1}\n${fmt(seg.startSec)} --> ${fmt(seg.endSec)}\n${seg.text}\n`).join('\n');
            fs.mkdirSync(rendersDir, { recursive: true });
            srtFile = path.join(rendersDir, `${path.basename(filePath, path.extname(filePath))}.srt`);
            fs.writeFileSync(srtFile, srt, 'utf-8');
          }
          return { ok: true, transcript: parsed.transcript || '', segments: parsed.segments || [], srtFile, chars: (parsed.transcript || '').length };
        } catch (err) { return { ok: false, error: err.message }; }
      }
    },

    // ── video.add_captions ──────────────────────────────────────────────────────
    {
      name: 'video.add_captions',
      description: 'Quemar subtítulos .srt en un video con ffmpeg. Input: { videoPath, srtPath, outputName?, style? }',
      input_schema: { type: 'object', properties: { videoPath: { type: 'string' }, srtPath: { type: 'string' }, outputName: { type: 'string' }, style: { type: 'string', enum: ['default', 'bold', 'minimal'] } }, required: ['videoPath', 'srtPath'] },
      riskLevel: 'medium',
      async execute(input) {
        const videoPath = path.isAbsolute(input.videoPath) ? input.videoPath : path.join(inboxDir, input.videoPath);
        const srtPath   = path.isAbsolute(input.srtPath)   ? input.srtPath   : path.join(rendersDir, input.srtPath);
        if (!fs.existsSync(videoPath)) return { ok: false, error: `Video no encontrado: ${videoPath}` };
        if (!fs.existsSync(srtPath))   return { ok: false, error: `SRT no encontrado: ${srtPath}` };
        const styleMap = { bold: 'FontSize=24,Bold=1,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2', minimal: 'FontSize=18,Bold=0,PrimaryColour=&Hffffff,OutlineColour=&H40000000,Outline=1', default: 'FontSize=20,Bold=1,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2' };
        const style = styleMap[input.style || 'default'];
        fs.mkdirSync(rendersDir, { recursive: true });
        const outFile = path.join(rendersDir, `${input.outputName || path.basename(videoPath, path.extname(videoPath)) + '_captioned'}.mp4`);
        const escapedSrt = srtPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
        try {
          await runFfmpeg(['-i', videoPath, '-vf', `subtitles='${escapedSrt}':force_style='${style}'`, '-c:a', 'copy', '-y', outFile]);
          return { ok: true, outputFile: outFile };
        } catch (err) {
          if (err.code === 'ENOENT') return { ok: false, error: 'ffmpeg no encontrado.' };
          if (err.message.includes('No such filter')) return { ok: false, error: 'Tu ffmpeg no tiene soporte libass. Descarga una build completa.' };
          return { ok: false, error: err.message };
        }
      }
    },

    // ── video.fetch_footage ─────────────────────────────────────────────────────
    {
      name: 'video.fetch_footage',
      description: 'Buscar y descargar clips de stock de Pexels. Requiere PEXELS_API_KEY en vault. Input: { query, count? (default 3), orientation? ("portrait"|"landscape", default "portrait"), minDuration? (segundos) }',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'number' }, orientation: { type: 'string', enum: ['portrait', 'landscape', 'square'] }, minDuration: { type: 'number' } }, required: ['query'] },
      riskLevel: 'low',
      async execute(input) {
        const apiKey = credentialVault?.get('PEXELS_API_KEY');
        if (!apiKey) return {
          ok: false, needsSetup: true,
          error: 'PEXELS_API_KEY no configurada.',
          instructions: ['1. Ve a https://www.pexels.com/api/ y crea una cuenta gratuita', '2. Copia tu API Key', '3. Ejecuta: credentials.set { key: "PEXELS_API_KEY", value: "tu-key" }']
        };
        const count = Math.min(Number(input.count) || 3, 10);
        const orientation = input.orientation || 'portrait';
        const minDur = Number(input.minDuration) || 5;
        try {
          const res = await fetch(
            `https://api.pexels.com/videos/search?query=${encodeURIComponent(input.query)}&per_page=${count * 3}&orientation=${orientation}`,
            { headers: { Authorization: apiKey } }
          );
          if (!res.ok) return { ok: false, error: `Pexels API error ${res.status}` };
          const data = await res.json();
          const videos = (data.videos || []).filter(v => v.duration >= minDur).slice(0, count);
          if (videos.length === 0) return { ok: false, error: `Sin resultados para "${input.query}" con duración mínima ${minDur}s.` };
          fs.mkdirSync(footageDir, { recursive: true });
          const downloaded = [];
          for (const video of videos) {
            const files = video.video_files.sort((a, b) => (b.width || 0) - (a.width || 0));
            const hd = files.find(f => f.width >= 720) || files[0];
            if (!hd?.link) continue;
            const ext = '.mp4';
            const slug = input.query.replace(/\s+/g, '_').slice(0, 20);
            const fileName = `${slug}_${video.id}${ext}`;
            const destPath = path.join(footageDir, fileName);
            if (!fs.existsSync(destPath)) await downloadFile(hd.link, destPath);
            downloaded.push({ file: destPath, duration: video.duration, width: hd.width, height: hd.height, pexelsId: video.id, url: video.url });
          }
          return { ok: true, query: input.query, count: downloaded.length, files: downloaded };
        } catch (err) { return { ok: false, error: err.message }; }
      }
    },

    // ── video.add_voiceover ─────────────────────────────────────────────────────
    {
      name: 'video.add_voiceover',
      description: 'Mezclar voiceover (MP3/WAV) con un video usando ffmpeg. Input: { videoPath, audioPath, outputName?, voiceVolume? (default 1.0), bgMusicPath?, bgVolume? (default 0.15) }',
      input_schema: { type: 'object', properties: { videoPath: { type: 'string' }, audioPath: { type: 'string' }, outputName: { type: 'string' }, voiceVolume: { type: 'number' }, bgMusicPath: { type: 'string' }, bgVolume: { type: 'number' } }, required: ['videoPath', 'audioPath'] },
      riskLevel: 'medium',
      async execute(input) {
        const videoPath = path.isAbsolute(input.videoPath) ? input.videoPath : path.join(inboxDir, input.videoPath);
        const audioPath = path.isAbsolute(input.audioPath) ? input.audioPath : path.join(inboxDir, input.audioPath);
        if (!fs.existsSync(videoPath)) return { ok: false, error: `Video no encontrado: ${videoPath}` };
        if (!fs.existsSync(audioPath)) return { ok: false, error: `Audio no encontrado: ${audioPath}` };
        fs.mkdirSync(rendersDir, { recursive: true });
        const outFile = path.join(rendersDir, `${input.outputName || path.basename(videoPath, path.extname(videoPath)) + '_voiced'}.mp4`);
        const voiceVol = Number(input.voiceVolume) || 1.0;
        const bgVol = Number(input.bgVolume) || 0.15;
        try {
          let filterComplex, inputs;
          if (input.bgMusicPath && fs.existsSync(input.bgMusicPath)) {
            inputs = ['-i', videoPath, '-i', audioPath, '-i', input.bgMusicPath];
            filterComplex = `[1:a]volume=${voiceVol}[vo];[2:a]volume=${bgVol},aloop=loop=-1:size=44100*60[bg];[vo][bg]amix=inputs=2:duration=first[outa]`;
          } else {
            inputs = ['-i', videoPath, '-i', audioPath];
            filterComplex = `[1:a]volume=${voiceVol}[outa]`;
          }
          await runFfmpeg([...inputs, '-filter_complex', filterComplex, '-map', '0:v', '-map', '[outa]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-y', outFile]);
          const stat = fs.statSync(outFile);
          return { ok: true, outputFile: outFile, sizeMb: (stat.size / 1e6).toFixed(1) };
        } catch (err) {
          if (err.code === 'ENOENT') return { ok: false, error: 'ffmpeg no encontrado.' };
          return { ok: false, error: err.message };
        }
      }
    },

    // ── video.setup_renderer ────────────────────────────────────────────────────
    {
      name: 'video.setup_renderer',
      description: 'Instalar el renderer Remotion en data/video/renderer/. Solo una vez. Tarda ~2 min. Requiere Node.js e internet.',
      input_schema: { type: 'object', properties: {} },
      riskLevel: 'medium',
      async execute() {
        if (isRendererReady()) return { ok: true, rendererDir, note: 'Renderer ya instalado.', templates: Object.keys(TEMPLATE_SCHEMAS) };
        fs.mkdirSync(rendererDir, { recursive: true });
        const pkg = {
          name: 'jarvis-video-renderer', version: '1.0.0', private: true,
          dependencies: {
            '@remotion/bundler': '^4.0.0', '@remotion/cli': '^4.0.0',
            '@remotion/renderer': '^4.0.0', '@remotion/media-utils': '^4.0.0',
            remotion: '^4.0.0', react: '^18.0.0', 'react-dom': '^18.0.0'
          },
          devDependencies: { '@babel/core': '^7.0.0', '@babel/preset-react': '^7.0.0', '@babel/preset-typescript': '^7.0.0' }
        };
        fs.writeFileSync(path.join(rendererDir, 'package.json'), JSON.stringify(pkg, null, 2));
        fs.writeFileSync(path.join(rendererDir, 'remotion.config.js'), `import { Config } from '@remotion/cli/config';\nConfig.setVideoImageFormat('jpeg');\nConfig.setOverwriteOutput(true);\n`);
        const compositionsDir = path.join(rendererDir, 'src', 'compositions');
        fs.mkdirSync(compositionsDir, { recursive: true });
        fs.mkdirSync(path.join(rendererDir, 'public'), { recursive: true });
        writeCompositions(compositionsDir);
        writeRoot(path.join(rendererDir, 'src'));
        return new Promise(resolve => {
          const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
          const proc = spawn(npm, ['install', '--prefer-offline'], { cwd: rendererDir, shell: false });
          const logs = [];
          proc.stdout.on('data', d => logs.push(d.toString()));
          proc.stderr.on('data', d => logs.push(d.toString()));
          proc.on('close', code => {
            if (code === 0) {
              fs.writeFileSync(readyFlag, new Date().toISOString());
              resolve({ ok: true, rendererDir, templates: Object.keys(TEMPLATE_SCHEMAS), note: 'Renderer instalado. Usa video.render para generar videos.' });
            } else {
              resolve({ ok: false, error: `npm install falló (exit ${code})`, log: logs.slice(-5).join('') });
            }
          });
        });
      }
    },

    // ── video.list_templates ────────────────────────────────────────────────────
    {
      name: 'video.list_templates',
      description: 'Listar los 16 templates de video disponibles con descripción y props.',
      input_schema: { type: 'object', properties: {} },
      riskLevel: 'low',
      async execute() {
        const notReady = requireRenderer();
        if (notReady) return notReady;
        return { ok: true, templates: Object.entries(TEMPLATE_SCHEMAS).map(([name, s]) => ({ name, description: s.description, props: s.props })) };
      }
    },

    // ── video.render ────────────────────────────────────────────────────────────
    {
      name: 'video.render',
      description: 'Generar un video MP4 con un template Remotion. Input: { template, props, outputName?, width? (default 1080), height? (default 1920), fps? (default 30) }',
      input_schema: { type: 'object', properties: { template: { type: 'string' }, props: { type: 'object' }, outputName: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, fps: { type: 'number' } }, required: ['template', 'props'] },
      riskLevel: 'medium',
      async execute(input) {
        const notReady = requireRenderer();
        if (notReady) return notReady;
        const template = String(input.template || '');
        if (!TEMPLATE_SCHEMAS[template]) return { ok: false, error: `Template "${template}" no existe. Disponibles: ${Object.keys(TEMPLATE_SCHEMAS).join(', ')}` };
        fs.mkdirSync(rendersDir, { recursive: true });
        const outName = input.outputName || `${template.toLowerCase()}_${Date.now().toString(36)}`;
        const outFile = path.join(rendersDir, `${outName}.mp4`);
        const propsStr = JSON.stringify(input.props || {});
        return new Promise(resolve => {
          const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
          const args = ['remotion', 'render', 'src/index.js', template, outFile, '--props', propsStr];
          if (input.width)  args.push('--width',  String(input.width));
          if (input.height) args.push('--height', String(input.height));
          if (input.fps)    args.push('--fps',    String(input.fps));
          const proc = spawn(npx, args, { cwd: rendererDir });
          const logs = [];
          proc.stderr.on('data', d => logs.push(d.toString()));
          proc.stdout.on('data', d => logs.push(d.toString()));
          proc.on('close', code => {
            if (code === 0 && fs.existsSync(outFile)) {
              const stat = fs.statSync(outFile);
              resolve({ ok: true, outputFile: outFile, template, sizeMb: (stat.size / 1e6).toFixed(1) });
            } else {
              resolve({ ok: false, error: `Render falló (exit ${code})`, log: logs.slice(-8).join('').slice(-600) });
            }
          });
        });
      }
    },

    // ── video.render_still ──────────────────────────────────────────────────────
    {
      name: 'video.render_still',
      description: 'Generar una imagen estática (PNG/JPEG/WEBP) desde un template Remotion. Útil para thumbnails, OG images, portadas de post. Input: { template, props, frame? (default 30), format? (default "png"), outputName? }',
      input_schema: { type: 'object', properties: { template: { type: 'string' }, props: { type: 'object' }, frame: { type: 'number' }, format: { type: 'string', enum: ['png', 'jpeg', 'webp'] }, outputName: { type: 'string' } }, required: ['template', 'props'] },
      riskLevel: 'low',
      async execute(input) {
        const notReady = requireRenderer();
        if (notReady) return notReady;
        const template = String(input.template || '');
        if (!TEMPLATE_SCHEMAS[template]) return { ok: false, error: `Template "${template}" no existe.` };
        fs.mkdirSync(rendersDir, { recursive: true });
        const fmt = input.format || 'png';
        const outName = input.outputName || `${template.toLowerCase()}_still_${Date.now().toString(36)}`;
        const outFile = path.join(rendersDir, `${outName}.${fmt}`);
        const propsStr = JSON.stringify(input.props || {});
        const frame = String(input.frame || 30);
        return new Promise(resolve => {
          const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
          const proc = spawn(npx, ['remotion', 'still', 'src/index.js', template, outFile, '--frame', frame, '--props', propsStr, '--image-format', fmt], { cwd: rendererDir });
          const logs = [];
          proc.stderr.on('data', d => logs.push(d.toString()));
          proc.stdout.on('data', d => logs.push(d.toString()));
          proc.on('close', code => {
            if (code === 0 && fs.existsSync(outFile)) {
              const stat = fs.statSync(outFile);
              resolve({ ok: true, outputFile: outFile, format: fmt, sizeKb: (stat.size / 1024).toFixed(0) });
            } else {
              resolve({ ok: false, error: `Still render falló (exit ${code})`, log: logs.slice(-5).join('').slice(-400) });
            }
          });
        });
      }
    },

    // ── video.compose ───────────────────────────────────────────────────────────
    {
      name: 'video.compose',
      description: 'Pipeline completo de video: busca footage en Pexels por escena, renderiza con MarketingReel, mezcla voiceover opcional. Input: { scenes: [{query, text, durationSecs}], brand, accentColor?, voiceoverPath?, bgMusicPath?, outputName? }',
      input_schema: {
        type: 'object',
        properties: {
          scenes: { type: 'array', description: 'Lista de escenas. Cada una con query para Pexels, texto para overlay y duración.', items: { type: 'object', properties: { query: { type: 'string' }, text: { type: 'string' }, durationSecs: { type: 'number' } } } },
          brand: { type: 'string', description: 'Nombre de la marca' },
          accentColor: { type: 'string' },
          voiceoverPath: { type: 'string', description: 'Ruta al MP3/WAV de voiceover (opcional)' },
          bgMusicPath: { type: 'string', description: 'Ruta a música de fondo (opcional)' },
          outputName: { type: 'string' }
        },
        required: ['scenes', 'brand']
      },
      riskLevel: 'high',
      async execute(input) {
        const notReady = requireRenderer();
        if (notReady) return notReady;
        const pexelsKey = credentialVault?.get('PEXELS_API_KEY');
        const accentColor = input.accentColor || '#7F77DD';
        const steps = [];
        const remotionScenes = [];

        for (const scene of (input.scenes || [])) {
          const dur = scene.durationSecs || 7;
          if (pexelsKey && scene.query) {
            try {
              const res = await fetch(
                `https://api.pexels.com/videos/search?query=${encodeURIComponent(scene.query)}&per_page=3&orientation=portrait`,
                { headers: { Authorization: pexelsKey } }
              );
              const data = await res.json();
              const video = (data.videos || []).find(v => v.duration >= dur - 1) || data.videos?.[0];
              if (video) {
                const hd = video.video_files.sort((a, b) => (b.width||0) - (a.width||0)).find(f => f.width >= 720) || video.video_files[0];
                if (hd?.link) {
                  fs.mkdirSync(footageDir, { recursive: true });
                  const destPath = path.join(footageDir, `compose_${video.id}.mp4`);
                  if (!fs.existsSync(destPath)) await downloadFile(hd.link, destPath);
                  const pubPath = path.join(rendererDir, 'public', `compose_${video.id}.mp4`);
                  if (!fs.existsSync(pubPath)) fs.copyFileSync(destPath, pubPath);
                  remotionScenes.push({ template: 'CaptionedClip', durationSecs: dur, props: { videoSrc: `compose_${video.id}.mp4`, captions: [{ text: scene.text || '', startSec: 0.5, endSec: dur - 0.5 }], brandName: input.brand, brandColor: accentColor } });
                  steps.push({ scene: scene.query, footage: 'ok', pexelsId: video.id });
                  continue;
                }
              }
            } catch (e) { steps.push({ scene: scene.query, footage: 'fallback', error: e.message }); }
          }
          remotionScenes.push({ template: 'KineticText', durationSecs: dur, props: { lines: (scene.text || scene.query || '').split(' · '), bgColor: '#0A0A0A', accentColor } });
          steps.push({ scene: scene.query || scene.text, footage: 'kinetic_fallback' });
        }

        if (remotionScenes.length === 0) return { ok: false, error: 'Sin escenas para renderizar.' };

        const outName = input.outputName || `compose_${Date.now().toString(36)}`;
        const renderResult = await this.execute ? null : null; // render via video.render below
        fs.mkdirSync(rendersDir, { recursive: true });
        const outFile = path.join(rendersDir, `${outName}.mp4`);
        const propsStr = JSON.stringify({ scenes: remotionScenes, brandName: input.brand, accentColor });
        const renderOk = await new Promise(resolve => {
          const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
          const proc = spawn(npx, ['remotion', 'render', 'src/index.js', 'MarketingReel', outFile, '--props', propsStr], { cwd: rendererDir });
          const logs = [];
          proc.stderr.on('data', d => logs.push(d.toString()));
          proc.stdout.on('data', d => logs.push(d.toString()));
          proc.on('close', code => resolve(code === 0 && fs.existsSync(outFile) ? { ok: true, log: '' } : { ok: false, log: logs.slice(-5).join('').slice(-400) }));
        });
        if (!renderOk.ok) return { ok: false, error: 'Render falló', log: renderOk.log, steps };

        // Mezclar voiceover si se proporcionó
        let finalFile = outFile;
        if (input.voiceoverPath && fs.existsSync(input.voiceoverPath)) {
          try {
            const voicedFile = outFile.replace('.mp4', '_voiced.mp4');
            const bgArgs = input.bgMusicPath && fs.existsSync(input.bgMusicPath)
              ? ['-i', input.bgMusicPath, '-filter_complex', '[1:a]volume=1.0[vo];[2:a]volume=0.15,aloop=loop=-1:size=44100*120[bg];[vo][bg]amix=inputs=2:duration=first[outa]']
              : ['-filter_complex', '[1:a]volume=1.0[outa]'];
            const voiceInputs = ['-i', outFile, '-i', input.voiceoverPath, ...bgArgs, '-map', '0:v', '-map', '[outa]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-y', voicedFile];
            await runFfmpeg(voiceInputs);
            finalFile = voicedFile;
            steps.push({ step: 'voiceover', ok: true });
          } catch (e) { steps.push({ step: 'voiceover', ok: false, error: e.message }); }
        }

        const stat = fs.statSync(finalFile);
        return { ok: true, outputFile: finalFile, scenes: remotionScenes.length, sizeMb: (stat.size / 1e6).toFixed(1), steps };
      }
    }
  ];
}

// ─── Root.jsx ────────────────────────────────────────────────────────────────

function writeRoot(srcDir) {
  const imports = Object.keys(TEMPLATE_SCHEMAS).map(name => `import { ${name} } from './compositions/${name}';`).join('\n');
  const compositions = Object.entries(TEMPLATE_SCHEMAS).map(([name]) => {
    if (name === 'MarketingReel') {
      return `    <Composition id="MarketingReel" component={MarketingReel}
      calculateMetadata={({ props }) => ({ durationInFrames: (props.scenes||[]).reduce((s,sc)=>s+Math.round((sc.durationSecs||6)*30),0)||180 })}
      fps={30} width={1080} height={1920} defaultProps={{ scenes: [], brandName: '', accentColor: '#7F77DD' }} />`;
    }
    if (name === 'StatsWrapped') {
      return `    <Composition id="StatsWrapped" component={StatsWrapped}
      calculateMetadata={({ props }) => ({ durationInFrames: (props.stats||[]).length * Math.round((props.durationPerStat||5)*30) + 90 })}
      fps={30} width={1080} height={1920} defaultProps={{ year: 2025, brandName: 'Marca', stats: [], bgColor: '#0A0A0A', durationPerStat: 5 }} />`;
    }
    if (name === 'ProductCatalog') {
      return `    <Composition id="ProductCatalog" component={ProductCatalog}
      calculateMetadata={({ props }) => ({ durationInFrames: (props.products||[]).length * Math.round((props.durationPerItem||6)*30) })}
      fps={30} width={1080} height={1920} defaultProps={{ products: [], brandColor: '#FF6B35', brandName: 'Marca', durationPerItem: 6, bgColor: '#FAFAFA' }} />`;
    }
    const defaults = {
      KineticText:     `{ lines: ['Texto de ejemplo'], bgColor: '#000000', accentColor: '#7F77DD', fontStyle: 'bold', durationSecs: 6 }`,
      StatsCard:       `{ value: 1000, label: 'Clientes satisfechos', suffix: '+', color: '#00C2FF', durationSecs: 5 }`,
      QuoteCard:       `{ quote: 'La mejor experiencia', author: 'Autor', brandColor: '#6C63FF', durationSecs: 7 }`,
      NewsTicker:      `{ headline: 'Noticia principal', value: '$980', context: '+2.3% hoy', accentColor: '#FF4444', durationSecs: 8 }`,
      ProductShowcase: `{ name: 'Producto', price: '$9.990', brandColor: '#FF6B35', imageUrl: '', durationSecs: 8 }`,
      CaptionedClip:   `{ videoSrc: '', captions: [], brandName: 'Marca', brandColor: '#000000' }`,
      DataViz:         `{ title: 'Comparativa', bars: [{ label: 'A', value: 80 }, { label: 'B', value: 60 }], accentColor: '#378ADD', bgColor: '#0A0A0A', durationSecs: 10 }`,
      Testimonial:     `{ quote: 'Excelente producto', author: 'Cliente', stars: 5, brandColor: '#D4537E', durationSecs: 9 }`,
      CodeExplainer:   `{ command: 'npx jarvis start', outputLines: [{ text: '✓ Jarvis iniciado', type: 'success' }], accentColor: '#5DCAA5', durationSecs: 10 }`,
      MusicVisualizer: `{ trackTitle: 'Mi Canción', artist: 'Artista', accentColor: '#FF6B9D', albumColor1: '#1a0533', albumColor2: '#FF6B9D', durationSecs: 8 }`,
      BeforeAfter:     `{ beforeSrc: '', afterSrc: '', beforeLabel: 'Antes', afterLabel: 'Después', wipeDir: 'right', brandColor: '#534AB7', durationSecs: 8 }`,
      TikTokCaptions:  `{ segments: [], bgColor: '#000000', accentColor: '#FACC15', fontSize: 72, durationSecs: 10 }`,
      Audiogram:       `{ trackTitle: 'Episodio 1', author: 'Podcast', accentColor: '#1D9E75', bgColor: '#050F08', durationSecs: 30 }`,
    };
    const dur = { KineticText: 180, StatsCard: 150, QuoteCard: 210, NewsTicker: 240, ProductShowcase: 240, CaptionedClip: 300, DataViz: 300, Testimonial: 270, CodeExplainer: 300, MusicVisualizer: 240, BeforeAfter: 240, TikTokCaptions: 300, Audiogram: 900 };
    return `    <Composition id="${name}" component={${name}} durationInFrames={${dur[name] || 180}} fps={30} width={1080} height={1920} defaultProps={${defaults[name] || '{}'}} />`;
  }).join('\n');

  fs.writeFileSync(path.join(srcDir, 'Root.jsx'), `import React from 'react';
import { Composition } from 'remotion';
${imports}

export const RemotionRoot = () => (
  <>
${compositions}
  </>
);
`);
  fs.writeFileSync(path.join(srcDir, 'index.js'), `import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\nregisterRoot(RemotionRoot);\n`);
}

// ─── Composiciones Remotion ──────────────────────────────────────────────────

function writeCompositions(dir) {

  // KineticText — word stagger con spring
  fs.writeFileSync(path.join(dir, 'KineticText.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';

export function KineticText({ lines = [], bgColor = '#000000', accentColor = '#7F77DD', fontStyle = 'bold', subtitle = '' }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fw = fontStyle === 'light' ? 300 : 800;
  const ff = fontStyle === 'mono' ? 'monospace' : 'sans-serif';
  return (
    <div style={{ width:'100%', height:'100%', background: bgColor, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'80px', boxSizing:'border-box' }}>
      {lines.map((line, li) => {
        const words = String(line).split(' ');
        return (
          <div key={li} style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', marginBottom: 12 }}>
            {words.map((word, wi) => {
              const delay = li * 14 + wi * 7;
              const p = spring({ frame: frame - delay, fps, config: { damping: 11, stiffness: 130 } });
              const isAccent = (li + wi) % 2 === 1;
              return (
                <span key={wi} style={{ color: isAccent ? accentColor : '#FFFFFF', fontFamily: ff, fontWeight: fw,
                  fontSize: lines.length <= 2 ? '100px' : '76px', lineHeight: 1.1, marginRight: '0.2em',
                  opacity: p, transform: \`translateY(\${(1-p)*50}px)\`, display:'inline-block' }}>{word}</span>
              );
            })}
          </div>
        );
      })}
      {subtitle && (() => {
        const sp = spring({ frame: frame - lines.length * 14 - 20, fps, config: { damping: 14 } });
        return <div style={{ color:'rgba(255,255,255,0.55)', fontFamily: ff, fontWeight: 300, fontSize:'40px', marginTop:28, opacity: sp, textAlign:'center', padding:'0 40px', lineHeight:1.4 }}>{subtitle}</div>;
      })()}
    </div>
  );
}
`);

  // StatsCard
  fs.writeFileSync(path.join(dir, 'StatsCard.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export function StatsCard({ value = 0, label = '', suffix = '', prefix = '', color = '#00C2FF', cta = '', durationSecs = 5 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const countEnd = Math.round(fps * durationSecs * 0.6);
  const displayValue = Math.round(interpolate(frame, [0, countEnd], [0, value], { extrapolateRight: 'clamp' }));
  const appear = spring({ frame, fps, config: { damping: 14 } });
  const ctaAppear = spring({ frame: frame - countEnd, fps, config: { damping: 10 } });
  return (
    <div style={{ width:'100%', height:'100%', background:'#0A0A0A', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center' }}>
      <div style={{ color, fontFamily:'sans-serif', fontWeight:900, fontSize:'180px', lineHeight:1, transform:\`scale(\${appear})\`, opacity:appear }}>
        {prefix}{displayValue.toLocaleString()}{suffix}
      </div>
      <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontSize:'48px', fontWeight:300, marginTop:24, opacity:appear, textAlign:'center', padding:'0 60px' }}>{label}</div>
      {cta && <div style={{ marginTop:60, color, fontSize:'36px', fontWeight:700, opacity:Math.max(0,ctaAppear), border:\`3px solid \${color}\`, padding:'20px 60px', borderRadius:'60px' }}>{cta}</div>}
    </div>
  );
}
`);

  // QuoteCard
  fs.writeFileSync(path.join(dir, 'QuoteCard.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';

export function QuoteCard({ quote = '', author = '', brandColor = '#6C63FF', logo = null, durationSecs = 7 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 16 } });
  const ap = spring({ frame: frame - 30, fps, config: { damping: 12 } });
  return (
    <div style={{ width:'100%', height:'100%', background:\`linear-gradient(135deg, \${brandColor}22 0%, #0A0A0A 60%)\`, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'80px', boxSizing:'border-box' }}>
      <div style={{ color: brandColor, fontSize:'96px', lineHeight:0.8, alignSelf:'flex-start', opacity:p, transform:\`translateY(\${(1-p)*-30}px)\` }}>"</div>
      <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontSize:'52px', fontWeight:300, lineHeight:1.4, textAlign:'center', marginTop:20, opacity:p, transform:\`translateY(\${(1-p)*30}px)\` }}>{quote}</div>
      <div style={{ color:brandColor, fontFamily:'sans-serif', fontSize:'36px', fontWeight:700, marginTop:48, opacity:ap }}>— {author}</div>
      {logo && <img src={logo} style={{ width:80, marginTop:60, opacity:ap }} alt="" />}
    </div>
  );
}
`);

  // NewsTicker
  fs.writeFileSync(path.join(dir, 'NewsTicker.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

export function NewsTicker({ headline = '', value = '', context = '', ticker = '', accentColor = '#FF4444', durationSecs = 8 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame, fps, config: { damping: 14 } });
  const tickerOffset = interpolate(frame, [0, durationSecs * fps], [0, -1800]);
  const tickerText = ticker || \`\${headline} · \${value} · \${context} · \`;
  return (
    <div style={{ width:'100%', height:'100%', background:'#000000', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', overflow:'hidden' }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'60px' }}>
        <div style={{ color:accentColor, fontFamily:'sans-serif', fontWeight:900, fontSize:'160px', lineHeight:1, opacity:appear, transform:\`scale(\${0.8+appear*0.2})\` }}>{value}</div>
        <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontSize:'44px', fontWeight:300, marginTop:24, opacity:appear, textAlign:'center' }}>{headline}</div>
        <div style={{ color:'#AAAAAA', fontFamily:'sans-serif', fontSize:'32px', marginTop:16, opacity:appear }}>{context}</div>
      </div>
      <div style={{ width:'100%', background:accentColor, padding:'20px 0', overflow:'hidden' }}>
        <div style={{ display:'flex', whiteSpace:'nowrap', transform:\`translateX(\${tickerOffset}px)\` }}>
          {[0,1,2,3,4].map(i => <span key={i} style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontSize:'28px', fontWeight:700, marginRight:80 }}>{tickerText}</span>)}
        </div>
      </div>
    </div>
  );
}
`);

  // ProductShowcase
  fs.writeFileSync(path.join(dir, 'ProductShowcase.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { Img } from 'remotion';

export function ProductShowcase({ imageUrl = '', name = '', price = '', badge = null, description = '', brandColor = '#FF6B35', durationSecs = 8 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const imgP = spring({ frame, fps, config: { damping: 18 } });
  const txtP = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  const badgeP = spring({ frame: frame - 10, fps, config: { damping: 8, stiffness: 200 } });
  return (
    <div style={{ width:'100%', height:'100%', background:'#FAFAFA', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ flex:'0 0 55%', position:'relative', overflow:'hidden', background:'#F0F0F0' }}>
        {imageUrl && <Img src={imageUrl} style={{ width:'100%', height:'100%', objectFit:'cover', transform:\`scale(\${1+(1-imgP)*0.1})\`, opacity:imgP }} />}
        {badge && <div style={{ position:'absolute', top:40, right:40, background:brandColor, color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:800, fontSize:'32px', padding:'12px 32px', borderRadius:'40px', transform:\`scale(\${badgeP})\`, opacity:badgeP }}>{badge}</div>}
      </div>
      <div style={{ flex:1, padding:'48px 56px', display:'flex', flexDirection:'column', justifyContent:'center', opacity:txtP }}>
        <div style={{ fontFamily:'sans-serif', fontWeight:800, fontSize:'72px', color:'#111111', lineHeight:1.1 }}>{name}</div>
        {description && <div style={{ fontFamily:'sans-serif', fontSize:'36px', color:'#666666', marginTop:16, lineHeight:1.4 }}>{description}</div>}
        <div style={{ fontFamily:'sans-serif', fontWeight:900, fontSize:'96px', color:brandColor, marginTop:32 }}>{price}</div>
      </div>
    </div>
  );
}
`);

  // CaptionedClip
  fs.writeFileSync(path.join(dir, 'CaptionedClip.jsx'), `import React from 'react';
import { useCurrentFrame, spring } from 'remotion';
import { Video, staticFile } from 'remotion';

export function CaptionedClip({ videoSrc = '', captions = [], brandName = '', brandColor = '#000000' }) {
  const frame = useCurrentFrame();
  const fps = 30;
  const currentCaption = captions.find(c => frame >= c.startSec * fps && frame < c.endSec * fps);
  const brandAppear = spring({ frame, fps, config: { damping: 14 } });
  const src = videoSrc.startsWith('http') ? videoSrc : staticFile(videoSrc);
  return (
    <div style={{ width:'100%', height:'100%', position:'relative', background:'#000' }}>
      {videoSrc && <Video src={src} style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
      {currentCaption && (
        <div style={{ position:'absolute', bottom:'18%', left:'5%', right:'5%', textAlign:'center', color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:800, fontSize:'56px', textShadow:'0 2px 16px rgba(0,0,0,0.95)', lineHeight:1.3, background:'rgba(0,0,0,0.55)', padding:'12px 20px', borderRadius:'12px' }}>
          {currentCaption.text}
        </div>
      )}
      {brandName && (
        <div style={{ position:'absolute', bottom:40, left:0, right:0, display:'flex', justifyContent:'center', opacity:brandAppear }}>
          <div style={{ background:brandColor, color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:700, fontSize:'28px', padding:'10px 40px', borderRadius:'4px' }}>{brandName}</div>
        </div>
      )}
    </div>
  );
}
`);

  // DataViz — bar chart horizontal con spring
  fs.writeFileSync(path.join(dir, 'DataViz.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

export function DataViz({ title = '', subtitle = '', bars = [], accentColor = '#378ADD', bgColor = '#0A0A0A', unit = '', durationSecs = 10 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const maxValue = Math.max(...bars.map(b => b.value), 1);
  const titleP = spring({ frame, fps, config: { damping: 14 } });
  return (
    <div style={{ width:'100%', height:'100%', background:bgColor, display:'flex', flexDirection:'column', justifyContent:'center', padding:'80px 70px', boxSizing:'border-box' }}>
      <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:800, fontSize:'64px', lineHeight:1.1, marginBottom:subtitle?12:40, opacity:titleP, transform:\`translateY(\${(1-titleP)*20}px)\` }}>{title}</div>
      {subtitle && <div style={{ color:'rgba(255,255,255,0.5)', fontFamily:'sans-serif', fontSize:'32px', marginBottom:48, opacity:titleP }}>{subtitle}</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:28 }}>
        {bars.slice(0,8).map((bar, i) => {
          const delay = i * 8 + 12;
          const p = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 100 } });
          const width = (bar.value / maxValue) * 100 * p;
          const countVal = Math.round(interpolate(frame, [delay, delay + fps * 1.2], [0, bar.value], { extrapolateLeft:'clamp', extrapolateRight:'clamp' }));
          const barColor = bar.color || accentColor;
          return (
            <div key={i}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ color:'rgba(255,255,255,0.7)', fontFamily:'sans-serif', fontSize:'30px', fontWeight:500 }}>{bar.label}</span>
                <span style={{ color:barColor, fontFamily:'sans-serif', fontSize:'30px', fontWeight:700 }}>{countVal.toLocaleString()}{unit ? ' '+unit : ''}</span>
              </div>
              <div style={{ height:28, background:'rgba(255,255,255,0.08)', borderRadius:14, overflow:'hidden' }}>
                <div style={{ height:'100%', width:\`\${width}%\`, background:barColor, borderRadius:14, transition:'none' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
`);

  // Testimonial — type-on + stars spring + clip-mask foto
  fs.writeFileSync(path.join(dir, 'Testimonial.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { Img } from 'remotion';

export function Testimonial({ quote = '', author = '', role = '', stars = 5, photoUrl = '', brandColor = '#D4537E', brandName = '', durationSecs = 9 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const totalChars = quote.length;
  const typeEnd = Math.round(fps * durationSecs * 0.55);
  const visibleChars = Math.round(interpolate(frame, [10, typeEnd], [0, totalChars], { extrapolateLeft:'clamp', extrapolateRight:'clamp' }));
  const authorP = spring({ frame: frame - typeEnd - 5, fps, config: { damping: 14 } });
  return (
    <div style={{ width:'100%', height:'100%', background:'#0A0A0A', display:'flex', flexDirection:'column', justifyContent:'center', padding:'80px', boxSizing:'border-box' }}>
      <div style={{ display:'flex', gap:6, marginBottom:32 }}>
        {Array.from({ length: 5 }).map((_, i) => {
          const sp = spring({ frame: frame - i * 6, fps, config: { damping: 8, stiffness: 200 } });
          return <span key={i} style={{ fontSize:'52px', opacity: i < stars ? sp : 0.2, transform:\`scale(\${i < stars ? sp : 1})\`, display:'inline-block', color:'#FACC15' }}>★</span>;
        })}
      </div>
      <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:300, fontSize:'52px', lineHeight:1.5, minHeight:'300px', marginBottom:48 }}>
        <span style={{ color:brandColor, fontWeight:700, fontSize:'64px' }}>"</span>
        {quote.slice(0, visibleChars)}
        <span style={{ opacity: visibleChars < totalChars ? 1 : 0, animation:'none', color:brandColor }}>|</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:24, opacity:authorP }}>
        {photoUrl && (
          <div style={{ width:80, height:80, borderRadius:'50%', overflow:'hidden', border:\`3px solid \${brandColor}\`, flexShrink:0 }}>
            <Img src={photoUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          </div>
        )}
        <div>
          <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:700, fontSize:'36px' }}>{author}</div>
          {role && <div style={{ color:'rgba(255,255,255,0.5)', fontFamily:'sans-serif', fontSize:'28px', marginTop:4 }}>{role}</div>}
        </div>
      </div>
      {brandName && (
        <div style={{ position:'absolute', bottom:48, left:0, right:0, display:'flex', justifyContent:'center' }}>
          <div style={{ color:brandColor, fontFamily:'sans-serif', fontSize:'24px', fontWeight:700, letterSpacing:'2px', textTransform:'uppercase', opacity:authorP }}>{brandName}</div>
        </div>
      )}
    </div>
  );
}
`);

  // CodeExplainer — terminal macOS con typing
  fs.writeFileSync(path.join(dir, 'CodeExplainer.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

const SYNTAX_COLORS = { success: '#5DCAA5', error: '#E24B4A', info: '#378ADD', muted: 'rgba(255,255,255,0.4)' };

export function CodeExplainer({ title = '', command = '', outputLines = [], accentColor = '#5DCAA5', durationSecs = 10 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cmdChars = Math.round(interpolate(frame, [15, 15 + command.length * 2], [0, command.length], { extrapolateLeft:'clamp', extrapolateRight:'clamp' }));
  const cmdDone = frame >= 15 + command.length * 2 + 10;
  const windowP = spring({ frame, fps, config: { damping: 16 } });
  return (
    <div style={{ width:'100%', height:'100%', background:'#0A0A0A', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'60px' }}>
      {title && <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontSize:'48px', fontWeight:700, marginBottom:40, opacity:windowP, textAlign:'center' }}>{title}</div>}
      <div style={{ width:'100%', background:'#1C1C1E', borderRadius:'16px', overflow:'hidden', opacity:windowP, transform:\`scale(\${0.95+windowP*0.05})\` }}>
        <div style={{ background:'#2C2C2E', padding:'14px 20px', display:'flex', alignItems:'center', gap:8 }}>
          {['#FF5F57','#FFBD2E','#28C840'].map((c, i) => <div key={i} style={{ width:14, height:14, borderRadius:'50%', background:c }} />)}
          <span style={{ color:'rgba(255,255,255,0.4)', fontSize:'22px', fontFamily:'monospace', marginLeft:12 }}>zsh</span>
        </div>
        <div style={{ padding:'24px 28px', minHeight:'240px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
            <span style={{ color:accentColor, fontFamily:'monospace', fontSize:'28px', fontWeight:700 }}>$</span>
            <span style={{ color:'#FFFFFF', fontFamily:'monospace', fontSize:'28px' }}>{command.slice(0, cmdChars)}</span>
            {!cmdDone && <span style={{ color:accentColor, fontFamily:'monospace', fontSize:'28px', opacity: frame % 30 < 15 ? 1 : 0 }}>▌</span>}
          </div>
          {cmdDone && outputLines.map((line, i) => {
            const lineP = spring({ frame: frame - (15 + command.length * 2 + 15 + i * 10), fps, config: { damping: 14 } });
            const color = SYNTAX_COLORS[line.type] || '#FFFFFF';
            return (
              <div key={i} style={{ color, fontFamily:'monospace', fontSize:'26px', lineHeight:1.6, opacity:lineP, transform:\`translateY(\${(1-lineP)*10}px)\` }}>
                {line.type === 'success' ? '✓ ' : line.type === 'error' ? '✗ ' : line.type === 'info' ? '→ ' : ''}{line.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
`);

  // MusicVisualizer — Now Playing card con barras
  fs.writeFileSync(path.join(dir, 'MusicVisualizer.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

export function MusicVisualizer({ trackTitle = '', artist = '', accentColor = '#FF6B9D', albumColor1 = '#1a0533', albumColor2 = '#FF6B9D', durationSecs = 8 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardP = spring({ frame, fps, config: { damping: 16 } });
  const numBars = 18;
  const bars = Array.from({ length: numBars }).map((_, i) => {
    const phase = (frame / 4 + i * 1.8) % (Math.PI * 2);
    const base = 0.3 + 0.7 * Math.abs(Math.sin(phase + i * 0.4)) * Math.abs(Math.cos(frame / 7 + i));
    return Math.max(0.15, base);
  });
  const progress = interpolate(frame, [0, durationSecs * fps], [0, 100], { extrapolateRight: 'clamp' });
  const elapsed = Math.floor(frame / fps);
  const fmt = s => \`\${Math.floor(s/60)}:\${String(s%60).padStart(2,'0')}\`;
  return (
    <div style={{ width:'100%', height:'100%', background:'#0A0A0A', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'60px' }}>
      <div style={{ width:'100%', background:'#1C1C1E', borderRadius:'24px', padding:'40px', opacity:cardP, transform:\`scale(\${0.9+cardP*0.1})\` }}>
        <div style={{ display:'flex', alignItems:'center', gap:32, marginBottom:36 }}>
          <div style={{ width:110, height:110, borderRadius:'16px', background:\`linear-gradient(135deg, \${albumColor1}, \${albumColor2})\`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:50 }}>
              {bars.slice(0,5).map((h, i) => (
                <div key={i} style={{ width:8, background:'rgba(255,255,255,0.8)', borderRadius:'4px 4px 0 0', height:\`\${h*50}px\` }} />
              ))}
            </div>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:'rgba(255,255,255,0.5)', fontFamily:'sans-serif', fontSize:'20px', fontWeight:700, letterSpacing:'3px', textTransform:'uppercase', marginBottom:8 }}>Now Playing</div>
            <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontSize:'44px', fontWeight:800, lineHeight:1.1, marginBottom:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{trackTitle}</div>
            <div style={{ color:'rgba(255,255,255,0.5)', fontFamily:'sans-serif', fontSize:'30px' }}>{artist}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', gap:5, height:64, marginBottom:32, justifyContent:'center' }}>
          {bars.map((h, i) => (
            <div key={i} style={{ flex:1, background:accentColor, borderRadius:'4px 4px 0 0', height:\`\${h*64}px\`, opacity:0.7+h*0.3 }} />
          ))}
        </div>
        <div style={{ height:6, background:'rgba(255,255,255,0.1)', borderRadius:3, overflow:'hidden', marginBottom:10 }}>
          <div style={{ height:'100%', width:\`\${progress}%\`, background:accentColor, borderRadius:3 }} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', color:'rgba(255,255,255,0.4)', fontFamily:'sans-serif', fontSize:'22px' }}>
          <span>{fmt(elapsed)}</span>
          <span>{fmt(durationSecs)}</span>
        </div>
      </div>
    </div>
  );
}
`);

  // StatsWrapped — Series de tarjetas data-driven
  fs.writeFileSync(path.join(dir, 'StatsWrapped.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Series } from 'remotion';

function StatScene({ value, label, context = '', accentColor = '#7F77DD', bgColor = '#0A0A0A', year = 2025, durationFrames = 150 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isNum = typeof value === 'number' || !isNaN(Number(value));
  const numVal = isNum ? Number(value) : 0;
  const countEnd = Math.round(durationFrames * 0.6);
  const displayValue = isNum ? Math.round(interpolate(frame, [10, countEnd], [0, numVal], { extrapolateLeft:'clamp', extrapolateRight:'clamp' })) : value;
  const p = spring({ frame, fps, config: { damping: 14 } });
  const ctxP = spring({ frame: frame - countEnd, fps, config: { damping: 12 } });
  return (
    <div style={{ width:'100%', height:'100%', background:bgColor, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'80px', boxSizing:'border-box' }}>
      <div style={{ color:'rgba(255,255,255,0.2)', fontFamily:'sans-serif', fontSize:'32px', fontWeight:700, letterSpacing:'4px', marginBottom:40, opacity:p }}>{year}</div>
      <div style={{ color:accentColor, fontFamily:'sans-serif', fontWeight:900, fontSize: isNum ? '160px' : '96px', lineHeight:1, textAlign:'center', opacity:p, transform:\`scale(\${0.8+p*0.2})\` }}>
        {isNum ? displayValue.toLocaleString() : String(value)}
      </div>
      <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontSize:'48px', fontWeight:300, marginTop:28, textAlign:'center', opacity:p }}>{label}</div>
      {context && <div style={{ color:'rgba(255,255,255,0.45)', fontFamily:'sans-serif', fontSize:'32px', marginTop:16, textAlign:'center', opacity:ctxP }}>{context}</div>}
    </div>
  );
}

export function StatsWrapped({ year = 2025, brandName = '', stats = [], bgColor = '#0A0A0A', durationPerStat = 5 }) {
  const dF = Math.round(durationPerStat * 30);
  return (
    <Series>
      <Series.Sequence durationInFrames={90}>
        {(() => {
          const frame = 0;
          return (
            <div style={{ width:'100%', height:'100%', background:bgColor, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center' }}>
              <div style={{ color:'rgba(255,255,255,0.3)', fontFamily:'sans-serif', fontSize:'36px', letterSpacing:'6px', textTransform:'uppercase', marginBottom:20 }}>{brandName}</div>
              <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:900, fontSize:'120px', lineHeight:1 }}>{year}</div>
              <div style={{ color:'rgba(255,255,255,0.3)', fontFamily:'sans-serif', fontSize:'36px', letterSpacing:'4px', marginTop:20 }}>EN NÚMEROS</div>
            </div>
          );
        })()}
      </Series.Sequence>
      {stats.map((stat, i) => (
        <Series.Sequence key={i} durationInFrames={dF}>
          <StatScene {...stat} bgColor={bgColor} year={year} durationFrames={dF} />
        </Series.Sequence>
      ))}
    </Series>
  );
}
`);

  // ProductCatalog — Series por producto con clip-mask
  fs.writeFileSync(path.join(dir, 'ProductCatalog.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, Series } from 'remotion';
import { Img } from 'remotion';

function ProductScene({ name = '', price = '', imageUrl = '', badge = '', description = '', brandColor = '#FF6B35', bgColor = '#FAFAFA', durationFrames = 180 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const imgP = spring({ frame, fps, config: { damping: 20 } });
  const txtP = spring({ frame: frame - 18, fps, config: { damping: 14 } });
  const badgeP = spring({ frame: frame - 8, fps, config: { damping: 8, stiffness: 200 } });
  return (
    <div style={{ width:'100%', height:'100%', background:bgColor, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ flex:'0 0 58%', position:'relative', overflow:'hidden', background:'#EBEBEB' }}>
        <div style={{ width:'100%', height:'100%', transform:\`scale(\${1+(1-imgP)*0.08})\`, opacity:imgP }}>
          {imageUrl && <Img src={imageUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
        </div>
        {badge && <div style={{ position:'absolute', top:36, left:36, background:brandColor, color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:800, fontSize:'30px', padding:'10px 28px', borderRadius:'40px', transform:\`scale(\${badgeP})\`, opacity:badgeP }}>{badge}</div>}
      </div>
      <div style={{ flex:1, padding:'44px 52px', display:'flex', flexDirection:'column', justifyContent:'center', opacity:txtP, transform:\`translateY(\${(1-txtP)*24}px)\` }}>
        <div style={{ fontFamily:'sans-serif', fontWeight:800, fontSize:'68px', color:'#111', lineHeight:1.1 }}>{name}</div>
        {description && <div style={{ fontFamily:'sans-serif', fontSize:'34px', color:'#777', marginTop:12, lineHeight:1.4 }}>{description}</div>}
        <div style={{ fontFamily:'sans-serif', fontWeight:900, fontSize:'88px', color:brandColor, marginTop:24 }}>{price}</div>
      </div>
    </div>
  );
}

export function ProductCatalog({ products = [], brandColor = '#FF6B35', brandName = '', durationPerItem = 6, bgColor = '#FAFAFA' }) {
  const dF = Math.round(durationPerItem * 30);
  return (
    <Series>
      {products.map((product, i) => (
        <Series.Sequence key={i} durationInFrames={dF}>
          <ProductScene {...product} brandColor={brandColor} bgColor={bgColor} durationFrames={dF} />
        </Series.Sequence>
      ))}
    </Series>
  );
}
`);

  // BeforeAfter — wipe reveal
  fs.writeFileSync(path.join(dir, 'BeforeAfter.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { Img } from 'remotion';

export function BeforeAfter({ beforeSrc = '', afterSrc = '', beforeLabel = 'Antes', afterLabel = 'Después', wipeDir = 'right', brandColor = '#534AB7', durationSecs = 8 }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const holdFrames = Math.round(fps * 1.5);
  const wipeStart = holdFrames;
  const wipeEnd = Math.round(fps * durationSecs * 0.7);
  const wipeProgress = interpolate(frame, [wipeStart, wipeEnd], [0, 100], { extrapolateLeft:'clamp', extrapolateRight:'clamp' });
  const labelP = spring({ frame, fps, config: { damping: 14 } });
  const afterLabelP = spring({ frame: frame - wipeStart, fps, config: { damping: 14 } });
  const isHorizontal = wipeDir !== 'top';
  const clipBefore = isHorizontal ? \`inset(0 \${wipeProgress}% 0 0)\` : \`inset(0 0 \${wipeProgress}% 0)\`;
  const clipAfter  = isHorizontal ? \`inset(0 0 0 \${100-wipeProgress}%)\` : \`inset(\${100-wipeProgress}% 0 0 0)\`;
  return (
    <div style={{ width:'100%', height:'100%', position:'relative', background:'#111', overflow:'hidden' }}>
      <div style={{ position:'absolute', inset:0, clipPath: clipAfter }}>
        {afterSrc && <Img src={afterSrc} style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
        <div style={{ position:'absolute', top:40, left:0, right:0, display:'flex', justifyContent:'center', opacity:afterLabelP }}>
          <div style={{ background:brandColor, color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:700, fontSize:'36px', padding:'10px 36px', borderRadius:'40px' }}>{afterLabel}</div>
        </div>
      </div>
      <div style={{ position:'absolute', inset:0, clipPath: clipBefore }}>
        {beforeSrc && <Img src={beforeSrc} style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
        <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.25)' }} />
        <div style={{ position:'absolute', top:40, left:0, right:0, display:'flex', justifyContent:'center', opacity:labelP }}>
          <div style={{ background:'rgba(0,0,0,0.6)', color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:700, fontSize:'36px', padding:'10px 36px', borderRadius:'40px', border:'1px solid rgba(255,255,255,0.3)' }}>{beforeLabel}</div>
        </div>
      </div>
      {wipeProgress > 1 && wipeProgress < 99 && (
        <div style={{ position:'absolute', top:0, bottom:0, left: isHorizontal ? \`\${wipeProgress}%\` : 0, right: isHorizontal ? 'auto' : 0, top: isHorizontal ? 0 : \`\${100-wipeProgress}%\`, width: isHorizontal ? '3px' : '100%', height: isHorizontal ? '100%' : '3px', background:brandColor, opacity:0.9 }} />
      )}
    </div>
  );
}
`);

  // TikTokCaptions — palabra por palabra
  fs.writeFileSync(path.join(dir, 'TikTokCaptions.jsx'), `import React from 'react';
import { useCurrentFrame, spring } from 'remotion';
import { Video, staticFile } from 'remotion';

function segmentsToWords(segments) {
  const words = [];
  for (const seg of segments) {
    const ws = seg.text.trim().split(/\\s+/);
    const dur = (seg.endSec - seg.startSec) / ws.length;
    ws.forEach((w, i) => words.push({ text: w, startSec: seg.startSec + i * dur, endSec: seg.startSec + (i + 1) * dur }));
  }
  return words;
}

export function TikTokCaptions({ segments = [], videoSrc = '', bgColor = '#000000', accentColor = '#FACC15', fontSize = 72, durationSecs = 10 }) {
  const frame = useCurrentFrame();
  const fps = 30;
  const currentSec = frame / fps;
  const words = segmentsToWords(segments);
  const activeWord = words.find(w => currentSec >= w.startSec && currentSec < w.endSec);
  const recentWords = words.filter(w => currentSec >= w.startSec - 0.1 && currentSec < w.startSec + 2.5);
  const src = videoSrc ? (videoSrc.startsWith('http') ? videoSrc : staticFile(videoSrc)) : null;
  return (
    <div style={{ width:'100%', height:'100%', position:'relative', background:bgColor, overflow:'hidden' }}>
      {src && <Video src={src} style={{ width:'100%', height:'100%', objectFit:'cover', position:'absolute', inset:0 }} />}
      {src && <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.45)' }} />}
      <div style={{ position:'absolute', bottom:'15%', left:'5%', right:'5%', display:'flex', flexWrap:'wrap', justifyContent:'center', gap:8 }}>
        {recentWords.map((word, i) => {
          const isActive = word === activeWord;
          const wordFrame = Math.max(0, frame - Math.round(word.startSec * fps));
          const p = spring({ frame: wordFrame, fps, config: { damping: 10, stiffness: 180 } });
          return (
            <span key={word.startSec + i} style={{
              color: isActive ? accentColor : '#FFFFFF',
              fontFamily:'sans-serif', fontWeight:800,
              fontSize: \`\${isActive ? fontSize * 1.08 : fontSize}px\`,
              textShadow:'0 3px 20px rgba(0,0,0,0.9)',
              opacity: p, transform:\`scale(\${0.8+p*0.2})\`, display:'inline-block',
              transition:'color 0.1s, font-size 0.1s'
            }}>{word.text}</span>
          );
        })}
      </div>
    </div>
  );
}
`);

  // Audiogram — waveform generativa (sin audio real para evitar dependencia de staticFile en setup)
  fs.writeFileSync(path.join(dir, 'Audiogram.jsx'), `import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

export function Audiogram({ trackTitle = '', author = '', accentColor = '#1D9E75', bgColor = '#050F08', coverGradient = null, durationSecs = 30 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardP = spring({ frame, fps, config: { damping: 16 } });
  const numBars = 48;
  const bars = Array.from({ length: numBars }).map((_, i) => {
    const t = frame / fps;
    const freq1 = Math.sin(t * 2.1 + i * 0.4) * 0.5 + 0.5;
    const freq2 = Math.sin(t * 3.7 + i * 0.8) * 0.3 + 0.3;
    const freq3 = Math.sin(t * 1.3 + i * 0.2) * 0.2 + 0.2;
    return Math.max(0.05, freq1 * 0.5 + freq2 * 0.3 + freq3 * 0.2);
  });
  const progress = interpolate(frame, [0, durationSecs * fps], [0, 100], { extrapolateRight:'clamp' });
  const elapsed = Math.floor(frame / fps);
  const fmt = s => \`\${Math.floor(s/60)}:\${String(s%60).padStart(2,'0')}\`;
  const g1 = coverGradient?.[0] || accentColor;
  const g2 = coverGradient?.[1] || '#000000';
  return (
    <div style={{ width:'100%', height:'100%', background:bgColor, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', padding:'60px', boxSizing:'border-box' }}>
      <div style={{ width:180, height:180, borderRadius:'24px', background:\`linear-gradient(135deg, \${g1}, \${g2})\`, marginBottom:48, opacity:cardP, transform:\`scale(\${0.8+cardP*0.2})\`, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ color:'rgba(255,255,255,0.7)', fontSize:'64px' }}>🎙</div>
      </div>
      <div style={{ color:'#FFFFFF', fontFamily:'sans-serif', fontWeight:700, fontSize:'52px', textAlign:'center', lineHeight:1.2, marginBottom:12, opacity:cardP }}>{trackTitle}</div>
      <div style={{ color:'rgba(255,255,255,0.5)', fontFamily:'sans-serif', fontSize:'34px', marginBottom:48, opacity:cardP }}>{author}</div>
      <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:80, width:'100%', marginBottom:28 }}>
        {bars.map((h, i) => (
          <div key={i} style={{ flex:1, background:accentColor, borderRadius:'3px 3px 0 0', height:\`\${h*80}px\`, opacity:0.5+h*0.5 }} />
        ))}
      </div>
      <div style={{ width:'100%', height:6, background:'rgba(255,255,255,0.1)', borderRadius:3, overflow:'hidden', marginBottom:10 }}>
        <div style={{ height:'100%', width:\`\${progress}%\`, background:accentColor, borderRadius:3 }} />
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', width:'100%', color:'rgba(255,255,255,0.4)', fontFamily:'sans-serif', fontSize:'26px' }}>
        <span>{fmt(elapsed)}</span><span>{fmt(durationSecs)}</span>
      </div>
    </div>
  );
}
`);

  // MarketingReel — compositor con Series dinámico
  fs.writeFileSync(path.join(dir, 'MarketingReel.jsx'), `import React from 'react';
import { Series } from 'remotion';
import { KineticText } from './KineticText';
import { StatsCard } from './StatsCard';
import { QuoteCard } from './QuoteCard';
import { NewsTicker } from './NewsTicker';
import { ProductShowcase } from './ProductShowcase';
import { CaptionedClip } from './CaptionedClip';
import { DataViz } from './DataViz';
import { Testimonial } from './Testimonial';
import { CodeExplainer } from './CodeExplainer';
import { MusicVisualizer } from './MusicVisualizer';
import { ProductCatalog } from './ProductCatalog';
import { BeforeAfter } from './BeforeAfter';
import { TikTokCaptions } from './TikTokCaptions';
import { Audiogram } from './Audiogram';

const TEMPLATES = {
  KineticText, StatsCard, QuoteCard, NewsTicker, ProductShowcase,
  CaptionedClip, DataViz, Testimonial, CodeExplainer, MusicVisualizer,
  ProductCatalog, BeforeAfter, TikTokCaptions, Audiogram
};

export function MarketingReel({ scenes = [], brandName = '', accentColor = '#7F77DD' }) {
  if (scenes.length === 0) {
    return (
      <div style={{ width:'100%', height:'100%', background:'#0A0A0A', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ color:'rgba(255,255,255,0.3)', fontFamily:'sans-serif', fontSize:'40px' }}>Sin escenas configuradas</div>
      </div>
    );
  }
  return (
    <Series>
      {scenes.map((scene, i) => {
        const Component = TEMPLATES[scene.template] || KineticText;
        const durationFrames = Math.round((scene.durationSecs || 6) * 30);
        const props = { ...scene.props };
        if (brandName && !props.brandName) props.brandName = brandName;
        if (accentColor && !props.accentColor && !props.color && !props.brandColor) props.accentColor = accentColor;
        return (
          <Series.Sequence key={i} durationInFrames={durationFrames}>
            <Component {...props} />
          </Series.Sequence>
        );
      })}
    </Series>
  );
}
`);
}

module.exports = { createVideoTools };
