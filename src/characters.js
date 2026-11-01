// Bundled + custom character loading.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadImage } from '@napi-rs/canvas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHAR_DIR = path.join(ROOT, 'characters');
const BUNDLED = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, 'characters.json'), 'utf8'));

export function listCharacters() {
  return Object.entries(BUNDLED).map(([id, c]) => ({
    id, name: c.name, description: c.description, voice: c.voice, gestures: c.poses,
  }));
}

// A cast entry's `character` can be:
//  - a bundled id ("aarav")
//  - a folder with character.json + <name>_base.png etc. (same layout as bundled)
//  - a single PNG/JPG doodle (no mouth patches: it bounces + squashes while talking)
export async function loadCharacter(ref, baseDir) {
  if (BUNDLED[ref]) {
    const c = BUNDLED[ref];
    return build(c, (n) => path.join(CHAR_DIR, `${c.file}_${n}.png`), ref);
  }
  const p = path.resolve(baseDir, ref);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    const cfg = JSON.parse(fs.readFileSync(path.join(p, 'character.json'), 'utf8'));
    const file = cfg.file || path.basename(p);
    return build(cfg, (n) => path.join(p, `${file}_${n}.png`), ref);
  }
  if (fs.existsSync(p) && /\.(png|jpe?g|webp)$/i.test(p)) {
    const base = await loadImage(p);
    return { id: ref, name: path.basename(p).replace(/\.\w+$/, ''), w: base.width, h: base.height, base, patches: {}, patchImg: {}, poses: {}, voice: null, pitch: '+0Hz', simple: true };
  }
  throw new Error(`Unknown character "${ref}". Bundled: ${Object.keys(BUNDLED).join(', ')}; or give a path to a PNG or character folder.`);
}

async function build(c, file, id) {
  const base = await loadImage(file('base'));
  const patchImg = {};
  for (const k of ['A', 'O', 'E', 'blink']) if (c.patches?.[k] && fs.existsSync(file(k))) patchImg[k] = await loadImage(file(k));
  const poses = {};
  for (const p of c.poses || []) if (fs.existsSync(file(`pose_${p}`))) poses[p] = await loadImage(file(`pose_${p}`));
  return { id, name: c.name || id, w: c.w || base.width, h: c.h || base.height, base, patches: c.patches || {}, patchImg, poses, voice: c.voice, pitch: c.pitch || '+0Hz', simple: false };
}
