// Конвейер целиком: билет → сценарий → озвучка → 3D-рендер → склейка.
//   node run.mjs --ticket 2              весь билет: сценарии, озвучка, клипы, ролик на 10 минут
//   node run.mjs --ticket 2 --q 7        один вопрос
//   node run.mjs --ticket 2 --no-render  только сценарии и озвучка (сайт показывает 3D вживую)
//   node run.mjs --ticket 2 --vertical   ещё и вертикальные клипы для Reels
import fs from 'node:fs';
import path from 'node:path';
import { writeScene } from './script.mjs';
import { voiceScene } from './voice.mjs';
import { renderClip } from './render.mjs';
import { stitchTicket } from './stitch.mjs';
import { buildIndex } from './index.mjs';
import { serveSite } from './lib/serve.mjs';
import { SITE, qid } from './lib/paths.mjs';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const t = +opt('--ticket');
if (!t) { console.log('node run.mjs --ticket N [--q M] [--force] [--no-render] [--vertical]'); process.exit(1); }
const qs = opt('--q') ? [+opt('--q')] : Array.from({ length: 20 }, (_, i) => i + 1);
const force = argv.includes('--force');

for (const q of qs) {
  process.stdout.write(`${qid(t, q)} сценарий… `);
  await writeScene(t, q, { force });
  const voiced = fs.existsSync(path.join(SITE, 'data/voice', qid(t, q) + '.json'));
  if (!voiced || force) { process.stdout.write('озвучка… '); await voiceScene(t, q); }
  console.log('ок');
}
buildIndex();
if (!argv.includes('--no-render')) {
  const srv = await serveSite();
  for (const q of qs) {
    await renderClip(srv.url, t, q);
    if (argv.includes('--vertical')) await renderClip(srv.url, t, q, { vertical: true });
  }
  srv.close();
  if (qs.length === 20) console.log(stitchTicket(t).out);
  buildIndex();
}
