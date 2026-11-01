// Text-to-speech (free Microsoft Edge voices) + decoding to PCM via bundled ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const SR = 48000;
export const FFMPEG = process.env.RIGPOP_FFMPEG || ffmpegPath || 'ffmpeg';

export const VOICES = [
  ['en-IN-NeerjaExpressiveNeural', 'English (India), female, expressive'],
  ['en-IN-NeerjaNeural', 'English (India), female'],
  ['en-IN-PrabhatNeural', 'English (India), male'],
  ['hi-IN-SwaraNeural', 'Hindi, female'],
  ['hi-IN-MadhurNeural', 'Hindi, male'],
  ['en-US-AriaNeural', 'English (US), female'],
  ['en-US-GuyNeural', 'English (US), male'],
  ['en-US-AnaNeural', 'English (US), child'],
  ['en-GB-SoniaNeural', 'English (UK), female'],
  ['en-GB-RyanNeural', 'English (UK), male'],
  ['es-ES-ElviraNeural', 'Spanish, female'],
  ['fr-FR-DeniseNeural', 'French, female'],
  ['de-DE-KatjaNeural', 'German, female'],
  ['ja-JP-NanamiNeural', 'Japanese, female'],
  ['ta-IN-PallaviNeural', 'Tamil, female'],
  ['bn-IN-TanishaaNeural', 'Bengali, female'],
];

const sign = (n, unit) => `${n >= 0 ? '+' : ''}${Math.round(n)}${unit}`;
const parseHz = (s) => parseFloat(String(s || '0').replace(/Hz$/i, '')) || 0;

// Edge TTS needs a direct websocket; corporate/sandbox proxies break it.
function withoutProxy(fn) {
  const keys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  if (!process.env.RIGPOP_KEEP_PROXY) keys.forEach((k) => delete process.env[k]);
  return fn().finally(() => keys.forEach((k) => { if (saved[k] !== undefined) process.env[k] = saved[k]; }));
}

export async function speak(text, { voice, pitchHz = 0, ratePct = 0, cacheDir }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = crypto.createHash('sha1').update([voice, pitchHz, ratePct, text].join('|')).digest('hex').slice(0, 16);
  const out = path.join(cacheDir, `${key}.mp3`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  await withoutProxy(async () => {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const tmp = fs.mkdtempSync(path.join(cacheDir, 'tts-'));
    const { audioFilePath } = await tts.toFile(tmp, text, { pitch: sign(pitchHz, 'Hz'), rate: sign(ratePct, '%') });
    fs.renameSync(audioFilePath, out);
    fs.rmSync(tmp, { recursive: true, force: true });
    tts.close?.();
  });
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(`TTS returned no audio for voice ${voice}`);
  return out;
}

export function decode(file) {
  const r = spawnSync(FFMPEG, ['-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
}

// Silent "voice" for offline/dry runs: a syllable-shaped hum so the mouth still moves.
export function synthBabble(text, ratePct = 0) {
  const syll = Math.max(1, (text.match(/[aeiouy]+/gi) || []).length);
  const dur = (syll * 0.19) / (1 + ratePct / 100) + 0.2;
  const n = Math.floor(dur * SR);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.max(0, Math.sin(Math.PI * t / 0.19)) ** 2;
    a[i] = env * 0.25 * (Math.sin(2 * Math.PI * 180 * t) + 0.4 * Math.sin(2 * Math.PI * 900 * t * (1 + 0.3 * Math.sin(t * 7))));
  }
  return a;
}

export { parseHz };

// Edge TTS pads ~0.8 s of silence after each clip and ~0.9 s between sentences.
// Trim the ends and squeeze long internal pauses so dialogue feels snappy.
export function tighten(pcm, { maxPause = 0.28, thresh = 0.01 } = {}) {
  const hop = Math.floor(SR * 0.01);
  const n = Math.floor(pcm.length / hop);
  const loud = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = 0; j < hop; j++) { const x = pcm[i * hop + j]; s += x * x; }
    loud[i] = Math.sqrt(s / hop) > thresh ? 1 : 0;
  }
  let first = loud.indexOf(1), last = loud.lastIndexOf(1);
  if (first < 0) return pcm;
  first = Math.max(0, first - 3); last = Math.min(n - 1, last + 8);
  const keep = []; let run = 0; const maxRun = Math.round(maxPause / 0.01);
  for (let i = first; i <= last; i++) { run = loud[i] ? 0 : run + 1; if (run <= maxRun) keep.push(i); }
  const out = new Float32Array(keep.length * hop);
  keep.forEach((fi, k) => out.set(pcm.subarray(fi * hop, fi * hop + hop), k * hop));
  // 5 ms fades at each splice are handled implicitly: cuts happen only in near-silence.
  return out;
}
