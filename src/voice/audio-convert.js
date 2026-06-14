const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Telegram y WhatsApp solo muestran la burbuja nativa de nota de voz si el
// audio es OGG/Opus. Nuestro TTS (edge-tts) produce MP3, así que esta pieza
// convierte entre medio: 48kHz mono Opus a 32kbps, el formato de nota de voz.
// ffmpeg-static trae el binario incluido — el white-label no puede asumir que
// el cliente tiene ffmpeg instalado.
function mp3ToVoiceOgg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-ar', '48000',
      '-ac', '1',
      '-application', 'voip',
      outputPath
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFMPEG_FAILED (${code}): ${stderr.slice(-300)}`));
    });
  });
}

module.exports = { mp3ToVoiceOgg };
