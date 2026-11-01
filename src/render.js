// Headless renderer: script plan -> voiced, lip-synced, captioned MP4.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { loadCharacter } from './characters.js';
import { speak, decode, tighten, synthBabble, SR, FFMPEG, parseHz } from './audio.js';
import { MOODS } from './script.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
GlobalFonts.registerFromPath(path.join(ROOT, 'fonts', 'DejaVuSans-Bold.ttf'), 'RigpopSans');
const FONT = 'RigpopSans';
const COLORS = ['#e85a6e', '#5078dc', '#2fa36b', '#e8963a', '#8a5cd6'];
const AUTO_WORDS = {
  wave: ['hello', 'hi', 'hey', 'bye', 'namaste', 'welcome'],
  point: ['tip', 'listen', 'look', 'this', 'here', 'remember', 'wait', 'first'],
  thumbs: ['great', 'yes', 'awesome', 'perfect', 'okay', 'nice', 'done', 'badhiya'],
  open: ['why', 'what', 'how', 'so', 'but', 'guess', 'imagine'],
};

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const log = (opts, ...a) => { if (!opts.quiet) console.error('[rigpop]', ...a); };

export async function prepare(plan, opts = {}) {
  if (plan.errors.length) throw new Error('Script errors:\n  ' + plan.errors.join('\n  '));
  const cacheDir = opts.cacheDir || path.join(os.homedir(), '.cache', 'rigpop', 'tts');
  // cast
  const speakers = [...new Set(plan.lines.map((l) => l.speaker))];
  const cast = {};
  for (const [i, s] of speakers.entries()) {
    const c = plan.cast[s] || {};
    const ch = await loadCharacter(c.character || s, plan.baseDir);
    cast[s] = {
      key: s, ch, index: i,
      name: c.name || ch.name,
      voice: c.voice || ch.voice || 'en-US-AriaNeural',
      pitchHz: parseHz(c.pitch ?? ch.pitch),
      ratePct: parseFloat(String(c.rate || '0').replace('%', '')) || 0,
      color: c.color || COLORS[i % COLORS.length],
    };
  }
  // audio per line
  const segs = [];
  let t = 0.6;
  const chunks = [new Float32Array(Math.floor(SR * 0.6))];
  for (const [i, line] of plan.lines.entries()) {
    const cm = cast[line.speaker];
    const md = MOODS[line.mood];
    let pcm;
    if (opts.silent) pcm = synthBabble(line.text, cm.ratePct + md.rate);
    else {
      log(opts, `voice ${i + 1}/${plan.lines.length} ${cm.name}: ${line.text.slice(0, 50)}`);
      const f = await speak(line.text, { voice: cm.voice, pitchHz: cm.pitchHz + md.pitch, ratePct: cm.ratePct + md.rate, cacheDir });
      pcm = tighten(decode(f));
    }
    const dur = pcm.length / SR;
    segs.push({ ...line, a: t, b: t + dur, idx: i });
    chunks.push(pcm);
    const gap = plan.gap + (line.pauseAfter || 0);
    chunks.push(new Float32Array(Math.floor(SR * gap)));
    t += dur + gap;
  }
  chunks.push(new Float32Array(Math.floor(SR * (plan.outro ? 1.6 : 0.8))));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const voice = new Float32Array(total);
  let o = 0; for (const c of chunks) { voice.set(c, o); o += c.length; }
  const mix = voice.slice();
  if (plan.music && fs.existsSync(plan.music)) {
    const m = decode(plan.music);
    for (let i = 0; i < mix.length; i++) {
      const fade = Math.min(1, i / SR, (mix.length - i) / SR / 1.5);
      mix[i] += m[i % m.length] * plan.musicVolume * fade;
    }
  }
  return { plan, cast, segs, voice, mix, duration: total / SR };
}

function mouthTrack(voice, fps, nf) {
  const N = 1024;
  let peak = 0.05, lv = 0;
  const raw = [];
  for (let f = 0; f < nf; f++) {
    const st = Math.max(0, Math.floor((f / fps) * SR) - N);
    let s2 = 0, zc = 0, prev = 0;
    for (let i = 0; i < N; i++) {
      const x = voice[st + i] || 0; s2 += x * x;
      if ((x >= 0) !== (prev >= 0)) zc++; prev = x;
    }
    const rms = Math.sqrt(s2 / N);
    peak = Math.max(rms, peak * 0.995, 0.02);
    lv = lv * 0.4 + Math.min(1, (rms / peak) * 0.9) * 0.6;
    raw.push({ lv, zc });
  }
  const voiced = raw.filter((r) => r.lv > 0.2).map((r) => r.zc).sort((a, b) => a - b);
  const med = voiced[Math.floor(voiced.length / 2)] || 40;
  return raw.map(({ lv, zc }) => {
    let shape = 'rest';
    if (lv >= 0.16) {
      if (zc > med * 1.35 && lv < 0.6) shape = 'E';
      else if (zc < med * 0.75 && lv > 0.25 && lv < 0.6) shape = 'O';
      else shape = lv > 0.38 ? 'A' : 'E';
    }
    return { lv, shape };
  });
}

function captions(segs) {
  const caps = [];
  for (const s of segs) {
    const ws = s.words; const tot = ws.reduce((n, w) => n + w.length + 2, 0);
    let acc = 0; const times = [];
    for (const w of ws) { times.push(s.a + ((s.b - s.a) * acc) / tot); acc += w.length + 2; }
    times.push(s.b);
    s.wordTimes = times;
    for (let i = 0; i < ws.length; i += 4) caps.push({ a: times[i], b: times[Math.min(ws.length, i + 4)], seg: s, start: i, words: ws.slice(i, i + 4), times: times.slice(i, Math.min(ws.length, i + 4) + 1) });
  }
  return caps;
}

async function background(plan, W, H) {
  const c = createCanvas(W, H); const g = c.getContext('2d');
  const bgv = String(plan.background);
  if (/\.(png|jpe?g|webp)$/i.test(bgv)) {
    const img = await loadImage(path.resolve(plan.baseDir, bgv));
    const s = Math.max(W / img.width, H / img.height);
    g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  } else if (bgv.startsWith('#')) { g.fillStyle = bgv; g.fillRect(0, 0, W, H); }
  else {
    g.fillStyle = '#f4ece2'; g.fillRect(0, 0, W, H);
    if (bgv === 'grid') {
      g.strokeStyle = 'rgba(80,120,220,0.18)'; g.lineWidth = 2;
      for (let x = 0; x < W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    } else if (bgv !== 'plain') {
      g.fillStyle = 'rgba(230,140,150,0.28)';
      for (let y = 20; y < H; y += 54) for (let x = 20 + ((y / 54) % 2 ? 27 : 0); x < W; x += 54) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    }
  }
  if (plan.title) {
    const k = Math.min(W, H) / 720, wide = H / W < 1.4;
    const bh = (plan.subtitle ? 166 : 110) * k * (wide ? 0.7 : 1);
    const bw = wide ? Math.min(W * 0.6, 760 * k) : W - 90 * k;
    g.save(); g.translate(W / 2, wide ? 24 * k + bh / 2 : 150 * k); g.rotate(-0.02);
    g.fillStyle = '#141414'; roundRect(g, -bw / 2 + 12 * k, -bh / 2 + 12 * k, bw, bh, 30 * k); g.fill();
    g.fillStyle = '#fff'; g.strokeStyle = '#141414'; g.lineWidth = 6 * k; roundRect(g, -bw / 2, -bh / 2, bw, bh, 30 * k); g.fill(); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, plan.title, bw - 40 * k, (wide ? 34 : 44) * k); g.fillStyle = '#e85a6e';
    g.fillText(plan.title, 0, plan.subtitle ? -bh * 0.2 : 0);
    if (plan.subtitle) { fitText(g, plan.subtitle, bw - 40 * k, (wide ? 30 : 40) * k); g.fillStyle = '#141414'; g.fillText(plan.subtitle, 0, bh * 0.2); }
    g.restore();
  }
  return c;
}

function fitText(g, s, maxW, size) {
  let px = size; g.font = `${px}px ${FONT}`;
  while (g.measureText(s).width > maxW && px > 14) { px -= 2; g.font = `${px}px ${FONT}`; }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

export function createRenderer(prep) {
  const { plan, cast, segs } = prep;
  const W = plan.width, H = plan.height, FPS = plan.fps, k = Math.min(W, H) / 720;
  const wide = H / W < 1.4; // landscape/square: captions go to the bottom
  const nf = Math.ceil(prep.duration * FPS);
  const track = mouthTrack(prep.voice, FPS, nf);
  const caps = captions(segs);
  const speakers = Object.values(cast);
  const n = speakers.length;
  const xs = n === 1 ? [0.5] : n === 2 ? [0.27, 0.73] : speakers.map((_, i) => (i + 0.5) / n);
  const rand = rng(plan.seed);
  const G = {}, B = {};
  speakers.forEach((s, i) => { G[s.key] = { pose: null, until: 0, next: 0.5, fired: new Set() }; B[s.key] = { until: 0, next: 1.5 + i }; });
  let shape = 'rest', shapeT = 0;
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d');
  let bg = null;

  function poseFor(s, word) {
    const ch = s.ch; if (!Object.keys(ch.poses).length) return null;
    if (word) for (const [p, ws] of Object.entries(AUTO_WORDS)) if (ws.includes(word) && ch.poses[p]) return p;
    return null;
  }

  async function frame(f) {
    if (!bg) bg = await background(plan, W, H);
    const t = f / FPS; const { lv, shape: sh } = track[f] || { lv: 0, shape: 'rest' };
    const seg = segs.find((s) => s.a - 0.05 <= t && t <= s.b + 0.1);
    const spk = seg?.speaker;
    if (sh !== shape && t - shapeT > 0.07) { shape = sh; shapeT = t; }
    const cap = caps.find((c) => c.a <= t && t < c.b + 0.2);
    let wordIdx = -1, word = null;
    if (seg && seg.wordTimes) {
      wordIdx = Math.max(0, seg.wordTimes.slice(0, -1).filter((x) => x <= t).length - 1);
      word = seg.words[wordIdx].replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
    }
    for (const s of speakers) {
      const st = G[s.key]; const ch = s.ch;
      if (st.pose && t > st.until) st.pose = null;
      if (spk === s.key && Object.keys(ch.poses).length) {
        // explicit [gesture] tags win
        const tag = seg.gestures.find((x) => x.word <= wordIdx && !st.fired.has(`${seg.idx}:${x.word}:${x.gesture}`));
        if (tag && ch.poses[tag.gesture]) {
          st.fired.add(`${seg.idx}:${tag.word}:${tag.gesture}`);
          st.pose = tag.gesture; st.until = t + 1.3; st.next = st.until + 1.2;
        } else if (!st.pose && plan.autoGestures !== false) {
          let pk = poseFor(s, word);
          if (pk === 'wave' && st.fired.has(`w${seg.idx}`)) pk = null;
          if (pk === 'wave') st.fired.add(`w${seg.idx}`);
          if (!pk && t > st.next) { const r = rand(); const avail = Object.keys(ch.poses).filter((p) => p !== 'wave'); pk = avail[Math.floor(r * avail.length)] || null; }
          if (pk) { st.pose = pk; st.until = t + 1.0 + rand() * 0.9; st.next = st.until + 0.9 + rand() * 1.6; }
        }
      }
      if (spk !== s.key && st.pose && t > st.until - 0.5) st.pose = null;
      const b = B[s.key]; if (t > b.next) { b.until = t + 0.12; b.next = t + 2 + rand() * 3; }
    }
    g.drawImage(bg, 0, 0);
    const order = speakers.map((s, i) => ({ s, i })).sort((a, b) => (a.s.key === spk) - (b.s.key === spk));
    for (const { s, i } of order) {
      const ch = s.ch; const talking = spk === s.key;
      const mood = talking ? MOODS[seg.mood] : MOODS.neutral;
      const L2 = talking ? lv : 0;
      const fitW = n === 1 ? 0.85 : n === 2 ? 0.6 : 0.95 / n * 1.6;
      const hf = wide ? (plan.title ? 0.7 : 0.8) : n === 1 ? 0.62 : 0.68;
      const base = Math.min((W * (wide ? Math.min(fitW, 0.9 / n) : fitW)) / ch.w, (H * hf) / ch.h);
      const sc = base * (talking ? 1.05 : 1) * (1 + Math.sin(t * 2.1 + i) * 0.006 + L2 * 0.025 * mood.bounce);
      const rot = Math.sin(t * 1.3 + i * 1.7) * 0.012 + Math.sin(t * 7.3) * L2 * 0.025 * mood.bounce;
      const lift = Math.sin(t * 1.7 + i) * 4 * k + L2 * 14 * k * mood.bounce;
      const squash = ch.simple && talking ? 1 + L2 * 0.06 : 1;
      g.save();
      g.translate(W * xs[i], H + ch.h * sc * 0.04 - lift * 0.4);
      g.rotate(rot); g.scale(sc / squash, sc * squash);
      g.translate(-ch.w / 2, -ch.h);
      const pose = G[s.key].pose;
      g.drawImage(pose && ch.poses[pose] ? ch.poses[pose] : ch.base, 0, 0, ch.w, ch.h);
      if (talking && shape !== 'rest' && ch.patchImg[shape]) { const q = ch.patches[shape]; g.drawImage(ch.patchImg[shape], q.x, q.y, q.w, q.h); }
      if (t < B[s.key].until && ch.patchImg.blink) { const q = ch.patches.blink; g.drawImage(ch.patchImg.blink, q.x, q.y, q.w, q.h); }
      g.restore();
    }
    if (cap && plan.captions) {
      const s = cast[cap.seg.speaker];
      const act = Math.max(0, cap.times.slice(0, -1).filter((x) => x <= t).length - 1);
      g.font = `${48 * k}px ${FONT}`;
      const rows = [[]];
      for (const w of cap.words) { if (g.measureText([...rows.at(-1), w].join(' ')).width > W * 0.86 && rows.at(-1).length) rows.push([w]); else rows.at(-1).push(w); }
      const y0 = wide ? H - (rows.length * 60 + 70) * k : (plan.title ? 330 : 200) * k;
      g.font = `${30 * k}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      const nw = g.measureText(s.name).width;
      let nx = W * xs[s.index] - nw / 2 - 18 * k; nx = Math.max(12 * k, Math.min(W - nw - 48 * k, nx));
      g.fillStyle = s.color; roundRect(g, nx, y0 - 24 * k, nw + 36 * k, 48 * k, 24 * k); g.fill();
      g.fillStyle = '#fff'; g.fillText(s.name, nx + 18 * k, y0 + 2 * k);
      g.font = `${48 * k}px ${FONT}`;
      let y = y0 + 75 * k, wi = 0;
      g.lineJoin = 'round'; g.lineWidth = 14 * k; g.strokeStyle = '#141414';
      for (const r of rows) {
        let x = (W - g.measureText(r.join(' ')).width) / 2;
        for (const w of r) { g.strokeText(w, x, y); g.fillStyle = wi === act ? '#ffd94a' : '#fff'; g.fillText(w, x, y); x += g.measureText(w + ' ').width; wi++; }
        y += 60 * k;
      }
    }
    if (plan.outro && t > prep.duration - 1.6) {
      g.font = `${30 * k}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(plan.outro).width;
      g.fillStyle = '#141414'; const oy = wide ? H * 0.45 : 560 * k;
      roundRect(g, (W - tw) / 2 - 20 * k, oy, tw + 40 * k, 52 * k, 26 * k); g.fill();
      g.fillStyle = '#fff'; g.fillText(plan.outro, W / 2, oy + 27 * k);
    }
    return canvas;
  }
  return { frame, nf, W, H, FPS };
}

function wavBuffer(pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  return b;
}

export async function render(plan, out, opts = {}) {
  const t0 = Date.now();
  const prep = await prepare(plan, opts);
  const R = createRenderer(prep);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rigpop-'));
  const wav = path.join(tmp, 'audio.wav');
  fs.writeFileSync(wav, wavBuffer(prep.mix));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const ff = spawn(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${R.W}x${R.H}`, '-r', String(R.FPS), '-i', '-', '-i', wav,
    '-c:v', 'libx264', '-preset', opts.preset || 'medium', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed: ' + err)))));
  log(opts, `rendering ${R.nf} frames (${prep.duration.toFixed(1)}s) at ${R.W}x${R.H}`);
  for (let f = 0; f < R.nf; f++) {
    const c = await R.frame(f);
    const px = c.getContext('2d').getImageData(0, 0, R.W, R.H).data;
    if (!ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength))) await new Promise((r) => ff.stdin.once('drain', r));
    if (!opts.quiet && f % 150 === 0) process.stderr.write(`\r[rigpop] frame ${f}/${R.nf}`);
  }
  ff.stdin.end(); await done;
  if (!opts.quiet) process.stderr.write('\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  return { output: path.resolve(out), duration: +prep.duration.toFixed(2), frames: R.nf, width: R.W, height: R.H, lines: prep.segs.length, speakers: Object.values(prep.cast).map((s) => ({ key: s.key, character: s.ch.id, name: s.name, voice: s.voice })), seconds: +((Date.now() - t0) / 1000).toFixed(1) };
}

// Render one PNG at time t (seconds) for a quick visual check.
export async function still(plan, out, t = 1, opts = {}) {
  const prep = await prepare(plan, opts);
  const R = createRenderer(prep);
  const target = Math.min(R.nf - 1, Math.floor(t * R.FPS));
  let c; for (let f = 0; f <= target; f++) c = await R.frame(f); // run state machine up to t
  fs.writeFileSync(out, await c.encode('png'));
  return { output: path.resolve(out), time: target / R.FPS, duration: prep.duration };
}
