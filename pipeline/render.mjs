// Рендер разбора в mp4: headless Chrome листает сцену покадрово, ffmpeg кладёт сверху озвучку.
// node render.mjs 1 5                → out/clips/t01/q05.mp4 (16:9, 1920×1080, 30 к/с)
// node render.mjs 1 5 --vertical     → out/clips/t01/q05-v.mp4 (9:16 для Reels/Shorts, с музыкой из MUSIC_PATH)
// node render.mjs 1                  → весь билет
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { serveSite } from './lib/serve.mjs';
import { openScene } from './lib/browser.mjs';
import { SITE, OUT, pad, qid } from './lib/paths.mjs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv();
const FPS = +(env.RENDER_FPS || 30);

export async function renderClip(base, t, q, { vertical = false, width } = {}) {
  const aspect = vertical ? '9:16' : '16:9';
  const sc = await openScene(base, { t, q, aspect, width: width || (vertical ? 1080 : 1920) });
  const voice = path.join(SITE, 'data/voice', qid(t, q) + '.mp3');
  const out = path.join(OUT, 'clips', `t${pad(t)}`, `q${pad(q)}${vertical ? '-v' : ''}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const music = vertical && env.MUSIC_PATH && fs.existsSync(env.MUSIC_PATH) ? env.MUSIC_PATH : null;
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
  if (fs.existsSync(voice)) args.push('-i', voice);
  if (music) args.push('-stream_loop', '-1', '-i', music);
  const hasVoice = fs.existsSync(voice);
  if (music && hasVoice) args.push('-filter_complex', `[2:a]volume=${env.MUSIC_VOLUME || 0.14}[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`, '-map', '0:v', '-map', '[a]');
  else if (hasVoice) args.push('-map', '0:v', '-map', '1:a');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-af', 'apad', '-shortest', '-movflags', '+faststart', out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c ? rej(new Error('ffmpeg ' + c)) : res())));
  const frames = Math.ceil(sc.duration * FPS);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const buf = await sc.frame(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % (FPS * 5) === 0) process.stdout.write(`\r${qid(t, q)} ${Math.round(i / frames * 100)}%`);
  }
  ff.stdin.end();
  await done;
  await sc.browser.close();
  process.stdout.write(`\r${qid(t, q)} готово за ${Math.round((Date.now() - t0) / 1000)} с → ${path.relative(OUT, out)}\n`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const vertical = args.includes('--vertical');
  const [t, q] = args.filter(a => !a.startsWith('--')).map(Number);
  const list = q ? [q] : Array.from({ length: 20 }, (_, i) => i + 1);
  const srv = await serveSite();
  for (const n of list) {
    if (!fs.existsSync(path.join(SITE, 'data/scenes', qid(t, n) + '.json'))) continue;
    await renderClip(srv.url, t, n, { vertical });
  }
  srv.close();
}
