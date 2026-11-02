// Озвучка сцены: по фразе из scene.lines → один mp3 + тайминги слов для субтитров и утки.
// ElevenLabs, если в .env есть ELEVENLABS_API_KEY (и ELEVENLABS_VOICE_ID), иначе бесплатный Edge TTS.
// node voice.mjs 1 5        → site/data/voice/t01/q05.{mp3,json}
// node voice.mjs 1          → весь билет
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SITE, ROOT, pad, qid } from './lib/paths.mjs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv();
const GAP = 0.32; // пауза между фразами, с
const EDGE_VOICE = env.EDGE_VOICE || 'ru-RU-SvetlanaNeural' // DmitryNeural в Edge отдаёт пустой поток;
const EDGE_RATE = env.EDGE_RATE || '+6%';
const PY = path.join(ROOT, 'pipeline/.venv/bin/python');

const probe = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();

// Склеиваем «слова» ElevenLabs из посимвольного выравнивания
function wordsFromAlignment(a) {
  const out = [];
  let cur = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) out.push(cur); cur = null; return; }
    if (!cur) cur = { w: '', s: a.character_start_times_seconds[i], e: 0 };
    cur.w += ch; cur.e = a.character_end_times_seconds[i];
  });
  if (cur) out.push(cur);
  return out.map(w => ({ ...w, s: +w.s.toFixed(3), e: +w.e.toFixed(3) }));
}

async function lineEleven(text, out) {
  const id = env.ELEVENLABS_VOICE_ID;
  if (!id) throw new Error('В .env нет ELEVENLABS_VOICE_ID');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text, model_id: env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, speed: 1.05 },
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
  const j = await r.json();
  fs.writeFileSync(out, Buffer.from(j.audio_base64, 'base64'));
  return wordsFromAlignment(j.alignment);
}

function lineEdge(text, out) {
  const raw = execFileSync(PY, ['-I', path.join(ROOT, 'pipeline/lib/edge_line.py'), EDGE_VOICE, EDGE_RATE, text, out]).toString();
  // Edge отдаёт слова без пунктуации — возвращаем её из текста для субтитров
  const words = JSON.parse(raw);
  const tokens = text.split(/\s+/).filter(Boolean);
  let k = 0;
  for (const w of words) {
    const bare = s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    while (k < tokens.length && bare(tokens[k]) !== bare(w.w) && !bare(tokens[k]).startsWith(bare(w.w))) k++;
    if (k < tokens.length) { w.w = tokens[k]; k++; }
  }
  return words;
}

export async function voiceScene(t, q) {
  const id = qid(t, q);
  const scene = JSON.parse(fs.readFileSync(path.join(SITE, 'data/scenes', id + '.json'), 'utf8'));
  const dir = path.join(SITE, 'data/voice', `t${pad(t)}`);
  const tmp = fs.mkdtempSync(path.join(ROOT, 'out/.voice-'));
  fs.mkdirSync(dir, { recursive: true });
  const useEleven = !!env.ELEVENLABS_API_KEY;
  const lines = [];
  const parts = [];
  let t0 = 0.25;
  for (const [i, text] of scene.lines.entries()) {
    const f = path.join(tmp, `l${i}.mp3`);
    const words = useEleven ? await lineEleven(text, f) : lineEdge(text, f);
    const d = probe(f);
    lines.push({ text, start: +(t0 + (words[0]?.s ?? 0)).toFixed(3), end: +(t0 + (words.at(-1)?.e ?? d)).toFixed(3),
      words: words.map(w => ({ w: w.w, s: +(t0 + w.s).toFixed(3), e: +(t0 + w.e).toFixed(3) })) });
    parts.push(f);
    t0 += d + GAP;
  }
  // склейка: тишина в начале + фразы с паузами
  const list = path.join(tmp, 'list.txt');
  const sil = path.join(tmp, 'gap.mp3'), lead = path.join(tmp, 'lead.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(GAP), '-c:a', 'libmp3lame', '-b:a', '64k', sil]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.25', '-c:a', 'libmp3lame', '-b:a', '64k', lead]);
  fs.writeFileSync(list, [lead, ...parts.flatMap((p, i) => (i < parts.length - 1 ? [p, sil] : [p]))].map(p => `file '${p}'`).join('\n'));
  const mp3 = path.join(dir, `q${pad(q)}.mp3`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', mp3]);
  const timing = { audio: `t${pad(t)}/q${pad(q)}.mp3`, engine: useEleven ? 'elevenlabs' : `edge:${EDGE_VOICE}`, duration: +probe(mp3).toFixed(3), lines };
  fs.writeFileSync(path.join(dir, `q${pad(q)}.json`), JSON.stringify(timing));
  fs.rmSync(tmp, { recursive: true, force: true });
  return timing;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [t, q] = process.argv.slice(2).map(Number);
  const qsList = q ? [q] : Array.from({ length: 20 }, (_, i) => i + 1);
  for (const n of qsList) {
    if (!fs.existsSync(path.join(SITE, 'data/scenes', qid(t, n) + '.json'))) continue;
    const r = await voiceScene(t, n);
    console.log(qid(t, n), r.engine, r.duration + 's');
  }
}
