// Индекс готовности: какие вопросы прошли какие шаги конвейера → site/data/scenes/index.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE, OUT } from './lib/paths.mjs';

export function buildIndex() {
  const idx = {};
  const root = path.join(SITE, 'data/scenes');
  for (const td of fs.readdirSync(root).filter(d => /^t\d\d$/.test(d)).sort()) {
    for (const f of fs.readdirSync(path.join(root, td)).filter(f => /^q\d\d\.json$/.test(f)).sort()) {
      const id = `${td}/${f.replace('.json', '')}`;
      idx[id] = {
        script: true,
        voice: fs.existsSync(path.join(SITE, 'data/voice', id + '.json')),
        clip: fs.existsSync(path.join(OUT, 'clips', id + '.mp4')),
        ticket: fs.existsSync(path.join(OUT, 'clips', td + '.mp4')),
      };
    }
  }
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(idx));
  return idx;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(Object.keys(buildIndex()).length, 'сцен в индексе');
