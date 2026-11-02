// .env из корня проекта (секреты только тут, в git не идёт)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

export function loadEnv() {
  const env = { ...process.env };
  const f = path.join(ROOT, '.env');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
