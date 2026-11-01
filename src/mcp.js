// MCP server: lets any MCP client (Claude Desktop, Claude Code, Cursor, Codex...) render doodle videos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseScript, loadScript } from './script.js';
import { render, still } from './render.js';
import { listCharacters } from './characters.js';
import { VOICES } from './audio.js';
import { FORMAT_GUIDE } from './guide.js';

const server = new McpServer({ name: 'rigpop', version: '0.1.0' });
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const planFrom = ({ script, script_path }) => {
  if (script_path) return loadScript(script_path);
  if (script) return parseScript(script, process.cwd());
  throw new Error('pass script (text) or script_path');
};

server.registerTool('rigpop_guide', { description: 'How to write a Rigpop script: format, moods, gestures, cast options. Read this before writing your first script.', inputSchema: {} }, async () => text(FORMAT_GUIDE));

server.registerTool('rigpop_characters', { description: 'List bundled doodle characters with their default voices and gestures.', inputSchema: {} }, async () => text(listCharacters()));

server.registerTool('rigpop_voices', { description: 'List suggested TTS voices (any Microsoft Edge neural voice id works).', inputSchema: {} }, async () => text(VOICES.map(([id, d]) => ({ id, description: d }))));

server.registerTool('rigpop_check', {
  description: 'Validate a Rigpop script without rendering. Returns errors, line count, speakers.',
  inputSchema: { script: z.string().optional(), script_path: z.string().optional() },
}, async (a) => { const p = planFrom(a); return text({ ok: !p.errors.length, errors: p.errors, lines: p.lines.length, speakers: [...new Set(p.lines.map((l) => l.speaker))] }); });

server.registerTool('rigpop_render', {
  description: 'Render a Rigpop dialogue script to a voiced, lip-synced, captioned MP4. Returns the output path and duration.',
  inputSchema: {
    script: z.string().optional().describe('Full script text (markdown with YAML front matter)'),
    script_path: z.string().optional().describe('Path to a script .md file'),
    output: z.string().optional().describe('Output .mp4 path (default: a temp file)'),
    silent: z.boolean().optional().describe('Skip TTS; for offline previews'),
  },
}, async (a) => {
  const out = a.output || path.join(os.tmpdir(), `rigpop-${Date.now()}.mp4`);
  const r = await render(planFrom(a), out, { quiet: true, silent: a.silent });
  return text(r);
});

server.registerTool('rigpop_still', {
  description: 'Render a single PNG frame of a script at a given time, to check the look before a full render. Returns the image.',
  inputSchema: { script: z.string().optional(), script_path: z.string().optional(), at: z.number().optional(), output: z.string().optional() },
}, async (a) => {
  const out = a.output || path.join(os.tmpdir(), `rigpop-${Date.now()}.png`);
  const r = await still(planFrom(a), out, a.at ?? 2, { quiet: true, silent: true });
  return { content: [{ type: 'text', text: JSON.stringify(r) }, { type: 'image', data: fs.readFileSync(out).toString('base64'), mimeType: 'image/png' }] };
});

await server.connect(new StdioServerTransport());
