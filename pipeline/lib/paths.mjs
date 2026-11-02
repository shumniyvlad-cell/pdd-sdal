import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SITE = path.join(ROOT, 'site');
export const OUT = path.join(ROOT, 'out');
export const pad = n => String(n).padStart(2, '0');
export const qid = (t, q) => `t${pad(t)}/q${pad(q)}`;
