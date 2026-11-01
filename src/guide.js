import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FORMAT_GUIDE = fs.readFileSync(path.join(ROOT, 'skills', 'rigpop', 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
