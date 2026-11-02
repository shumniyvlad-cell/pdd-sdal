// Склейка билета: 20 клипов → один ролик ~10 минут + музыка подложкой + главы для YouTube.
// node stitch.mjs 1 → out/clips/t01.mp4 и out/clips/t01-chapters.txt
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SITE, OUT, pad } from './lib/paths.mjs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv();
const probe = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const ts = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function stitchTicket(t) {
  const dir = path.join(OUT, 'clips', `t${pad(t)}`);
  const clips = Array.from({ length: 20 }, (_, i) => path.join(dir, `q${pad(i + 1)}.mp4`)).filter(f => fs.existsSync(f));
  if (!clips.length) throw new Error(`Нет клипов в ${dir}: сначала node render.mjs ${t}`);
  const tickets = JSON.parse(fs.readFileSync(path.join(SITE, 'data/tickets.json'), 'utf8'));
  const list = path.join(dir, 'concat.txt');
  fs.writeFileSync(list, clips.map(f => `file '${f}'`).join('\n'));
  const joined = path.join(dir, 'joined.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const out = path.join(OUT, 'clips', `t${pad(t)}.mp4`);
  const music = env.MUSIC_PATH && fs.existsSync(env.MUSIC_PATH) ? env.MUSIC_PATH : null;
  if (music) {
    const dur = probe(joined);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', joined, '-stream_loop', '-1', '-i', music,
      '-filter_complex', `[1:a]volume=${env.MUSIC_VOLUME || 0.12},afade=t=out:st=${Math.max(0, dur - 3)}:d=3[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
    fs.rmSync(joined);
  } else fs.renameSync(joined, out);
  fs.rmSync(list);
  // главы: таймкод начала каждого вопроса
  let acc = 0;
  const chapters = clips.map(f => {
    const q = +path.basename(f).slice(1, 3);
    const line = `${ts(acc)} Вопрос ${q}. ${tickets[t - 1].qs[q - 1].q.slice(0, 70)}`;
    acc += probe(f);
    return line;
  });
  fs.writeFileSync(path.join(OUT, 'clips', `t${pad(t)}-chapters.txt`), chapters.join('\n') + '\n');
  return { out, duration: acc, music: !!music };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = stitchTicket(+process.argv[2]);
  console.log(`${path.relative(OUT, r.out)} · ${ts(r.duration)} · музыка: ${r.music ? 'да' : 'нет (MUSIC_PATH в .env)'}`);
}
