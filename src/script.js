// Parses a Rigpop script (Markdown with YAML front matter) into a render plan.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const GESTURES = ['wave', 'point', 'open', 'thumbs'];
export const MOODS = {
  neutral: { rate: 0, pitch: 0, bounce: 1 },
  happy: { rate: 5, pitch: 6, bounce: 1.3 },
  excited: { rate: 12, pitch: 12, bounce: 1.7 },
  calm: { rate: -8, pitch: -2, bounce: 0.6 },
  sad: { rate: -14, pitch: -10, bounce: 0.4 },
  angry: { rate: 6, pitch: -4, bounce: 1.5 },
  whisper: { rate: -10, pitch: -6, bounce: 0.5 },
};

const LINE_RE = /^([A-Za-z0-9_\-]+)\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/;

export function parseScript(src, baseDir = process.cwd()) {
  let meta = {};
  let body = src;
  const fm = src.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fm) {
    meta = YAML.parse(fm[1]) || {};
    body = src.slice(fm[0].length);
  }
  const cast = meta.cast || {};
  const lines = [];
  const errors = [];
  body.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('<!--') || t.startsWith('>')) return;
    const m = t.match(LINE_RE);
    if (!m) { errors.push(`line ${i + 1}: expected "SPEAKER: text" or "SPEAKER (mood): text"`); return; }
    const [, who, moodRaw, rest] = m;
    if (!cast[who]) {
      // auto-cast: if the speaker key is a bundled character id, use it directly
      cast[who] = { character: who };
    }
    const mood = (moodRaw || 'neutral').trim().toLowerCase();
    if (!MOODS[mood]) errors.push(`line ${i + 1}: unknown mood "${mood}" (use ${Object.keys(MOODS).join(', ')})`);
    // pull out [gesture] and [pause 0.5] tags, remembering which word they sit before
    const words = [];
    const gestures = [];
    let pauseAfter = 0;
    for (const tok of rest.replace(/\[\s*pause\s*([\d.]*)\s*\]/gi, (_, n) => ` [pause:${n || '0.5'}] `).trim().split(/\s+/)) {
      const g = tok.match(/^\[(\w+)(?::([\d.]+))?\]$/);
      if (g) {
        const name = g[1].toLowerCase();
        if (name === 'pause') pauseAfter += parseFloat(g[2] || '0.5');
        else if (GESTURES.includes(name)) gestures.push({ word: words.length, gesture: name });
        else errors.push(`line ${i + 1}: unknown tag [${name}] (use ${GESTURES.join(', ')}, pause)`);
        continue;
      }
      // tags glued to words, e.g. "Hello[wave]"
      const glued = tok.match(/^(.*?)\[(\w+)\](.*)$/);
      if (glued && GESTURES.includes(glued[2].toLowerCase())) {
        if (glued[1]) words.push(glued[1]);
        gestures.push({ word: words.length, gesture: glued[2].toLowerCase() });
        if (glued[3]) words.push(glued[3]);
        continue;
      }
      words.push(tok);
    }
    if (!words.length) { errors.push(`line ${i + 1}: no spoken words`); return; }
    lines.push({ speaker: who, mood: MOODS[mood] ? mood : 'neutral', text: words.join(' '), words, gestures, pauseAfter });
  });
  if (!lines.length) errors.push('script has no dialogue lines');
  const [w, h] = String(meta.size || '720x1280').split('x').map(Number);
  return {
    title: meta.title || '',
    subtitle: meta.subtitle || '',
    outro: meta.outro || '',
    background: meta.background || 'dots',
    music: meta.music ? path.resolve(baseDir, meta.music) : null,
    musicVolume: meta.music_volume ?? 0.12,
    captions: meta.captions !== false,
    autoGestures: meta.auto_gestures !== false,
    gap: meta.gap ?? 0.35,
    seed: meta.seed ?? 7,
    fps: meta.fps || 30,
    width: w || 720,
    height: h || 1280,
    cast,
    lines,
    errors,
    baseDir,
  };
}

export function loadScript(file) {
  return parseScript(fs.readFileSync(file, 'utf8'), path.dirname(path.resolve(file)));
}
