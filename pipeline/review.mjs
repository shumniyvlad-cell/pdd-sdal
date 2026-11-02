// Контрольные кадры по всем фразам: node review.mjs 1 [5 6 7] → out/review/t01-q05.jpg (сетка кадров)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serveSite } from './lib/serve.mjs';
import { openScene } from './lib/browser.mjs';
import { OUT, SITE, pad, qid } from './lib/paths.mjs';

const [t, ...qs] = process.argv.slice(2).map(Number);
const list = qs.length ? qs : Array.from({ length: 20 }, (_, i) => i + 1);
const aspect = process.env.ASPECT || '16:9';
const srv = await serveSite();
const dir = path.join(OUT, 'review'); fs.mkdirSync(dir, { recursive: true });
for (const q of list) {
  const vf = path.join(SITE, 'data/voice', qid(t, q) + '.json');
  if (!fs.existsSync(vf)) continue;
  const timing = JSON.parse(fs.readFileSync(vf, 'utf8'));
  const sc = await openScene(srv.url, { t, q, aspect, width: aspect === '9:16' ? 360 : 640 });
  const times = [timing.lines[0].start + 1.2, ...timing.lines.slice(1).map(l => (l.start + l.end) / 2), sc.duration - 0.3];
  const files = [];
  for (const [i, s] of times.entries()) {
    const f = path.join(dir, `_f${i}.jpg`);
    fs.writeFileSync(f, await sc.frame(s));
    files.push(f);
  }
  await sc.browser.close();
  const out = path.join(dir, `t${pad(t)}-q${pad(q)}${aspect === '9:16' ? '-v' : ''}.jpg`);
  const cols = aspect === '9:16' ? 6 : 3;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap(f => ['-i', f]),
    '-filter_complex', `${files.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${aspect === '9:16' ? i * 360 : (i % cols) * 640}_${aspect === '9:16' ? 0 : Math.floor(i / cols) * 360}`).join('|')}:fill=white`,
    '-frames:v', '1', '-q:v', '3', out]);
  files.forEach(f => fs.rmSync(f));
  console.log(out);
}
srv.close();
