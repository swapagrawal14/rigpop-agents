#!/usr/bin/env node
// rigpop: turn a dialogue script into a voiced, lip-synced doodle video.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScript } from '../src/script.js';
import { render, still } from '../src/render.js';
import { listCharacters } from '../src/characters.js';
import { VOICES } from '../src/audio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const HELP = `rigpop ${VERSION}: scripts in, talking doodle videos out.

Usage
  rigpop render <script.md> [-o out.mp4] [--silent] [--json] [--fast]
  rigpop still  <script.md> [-o frame.png] [--at 2.5]   preview one frame
  rigpop check  <script.md>                             validate a script
  rigpop init   [file.md]                               write a starter script
  rigpop characters [--json]                            bundled characters
  rigpop voices [--json]                                suggested voices
  rigpop mcp                                            start the MCP server (stdio)

Flags
  -o, --out     output path (default: <script>.mp4)
  --silent      no TTS; mouths move to a synthetic hum (offline / CI)
  --json        print a machine-readable result (for agents)
  --fast        faster x264 preset
  --quiet       no progress logs`;

function args(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '-o' || x === '--out') a.out = argv[++i];
    else if (x === '--at') a.at = parseFloat(argv[++i]);
    else if (x.startsWith('--')) a[x.slice(2)] = true;
    else a._.push(x);
  }
  return a;
}

const a = args(process.argv.slice(2));
const cmd = a._[0];
const print = (obj, text) => console.log(a.json ? JSON.stringify(obj, null, 2) : text);

try {
  if (!cmd || cmd === 'help' || a.help) console.log(HELP);
  else if (cmd === '--version' || a.version || cmd === 'version') console.log(VERSION);
  else if (cmd === 'characters') {
    const cs = listCharacters();
    print(cs, cs.map((c) => `${c.id.padEnd(16)} ${c.description}  (voice ${c.voice}${c.gestures.length ? `, gestures: ${c.gestures.join(' ')}` : ''})`).join('\n'));
  } else if (cmd === 'voices') {
    print(VOICES.map(([id, d]) => ({ id, description: d })), VOICES.map(([id, d]) => `${id.padEnd(30)} ${d}`).join('\n') + '\n\nAny Microsoft Edge neural voice id works.');
  } else if (cmd === 'init') {
    const dst = a._[1] || 'script.md';
    if (fs.existsSync(dst)) throw new Error(`${dst} already exists`);
    fs.copyFileSync(path.join(ROOT, 'examples', 'doctors-orders.md'), dst);
    console.log(`wrote ${dst}. Next: rigpop render ${dst}`);
  } else if (cmd === 'check') {
    const plan = loadScript(req(a._[1]));
    const ok = !plan.errors.length;
    print({ ok, errors: plan.errors, lines: plan.lines.length, speakers: [...new Set(plan.lines.map((l) => l.speaker))] },
      ok ? `ok: ${plan.lines.length} lines, speakers ${[...new Set(plan.lines.map((l) => l.speaker))].join(', ')}` : plan.errors.join('\n'));
    if (!ok) process.exitCode = 1;
  } else if (cmd === 'render') {
    const file = req(a._[1]);
    const out = a.out || file.replace(/\.\w+$/, '') + '.mp4';
    const r = await render(loadScript(file), out, { silent: a.silent, quiet: a.quiet || a.json, preset: a.fast ? 'veryfast' : undefined });
    print(r, `done: ${r.output} (${r.duration}s, ${r.frames} frames, rendered in ${r.seconds}s)`);
  } else if (cmd === 'still') {
    const file = req(a._[1]);
    const r = await still(loadScript(file), a.out || file.replace(/\.\w+$/, '') + '.png', a.at ?? 2, { silent: a.silent, quiet: true });
    print(r, `wrote ${r.output} at ${r.time.toFixed(2)}s`);
  } else if (cmd === 'mcp') {
    await import('../src/mcp.js');
  } else { console.error(`unknown command "${cmd}"\n\n${HELP}`); process.exitCode = 2; }
} catch (e) {
  if (a.json) console.log(JSON.stringify({ ok: false, error: e.message }));
  else console.error('rigpop: ' + e.message);
  process.exitCode = 1;
}

function req(f) {
  if (!f) throw new Error('missing script path');
  if (!fs.existsSync(f)) throw new Error(`no such file: ${f}`);
  return f;
}
