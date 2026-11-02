// Кадры сцены для проверки: node shot.mjs 1 5 [9:16] 1 4 8 12 → out/shots/t01-q05-1.jpg …
import fs from 'node:fs';
import path from 'node:path';
import { serveSite } from './lib/serve.mjs';
import { openScene } from './lib/browser.mjs';
import { OUT, pad } from './lib/paths.mjs';

const [t, q, ...rest] = process.argv.slice(2);
const aspect = rest[0]?.includes(':') ? rest.shift() : '16:9';
const srv = await serveSite();
const sc = await openScene(srv.url, { t: +t, q: +q, aspect, width: aspect === '9:16' ? 540 : 1280 });
const dir = path.join(OUT, 'shots'); fs.mkdirSync(dir, { recursive: true });
const times = rest.length ? rest.map(Number) : [1, sc.duration * 0.3, sc.duration * 0.55, sc.duration * 0.8];
for (const s of times) {
  const f = path.join(dir, `t${pad(t)}-q${pad(q)}${aspect === '9:16' ? '-v' : ''}-${s.toFixed(1)}.jpg`);
  fs.writeFileSync(f, await sc.frame(s));
  console.log(f);
}
console.log('duration', sc.duration.toFixed(1));
await sc.browser.close(); srv.close();
