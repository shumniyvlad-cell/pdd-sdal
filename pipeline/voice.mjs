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

// Настройки голоса: v3 живее всех, но принимает stability только 0 / 0.5 / 1.
export function voiceSettings(model, o = {}) {
  const st = +(o.stability ?? env.ELEVENLABS_STABILITY ?? (model === 'eleven_v3' ? 0.5 : 0.35));
  if (model === 'eleven_v3') return { stability: st <= 0.25 ? 0 : st >= 0.75 ? 1 : 0.5, similarity_boost: 0.8, speed: +(env.ELEVENLABS_SPEED || 1) };
  return { stability: st, similarity_boost: 0.8, style: +(o.style ?? env.ELEVENLABS_STYLE ?? 0.45), use_speaker_boost: true, speed: +(env.ELEVENLABS_SPEED || 1) };
}

export async function lineEleven(text, out, o = {}) {
  const id = env.ELEVENLABS_VOICE_ID;
  if (!id) throw new Error('В .env нет ELEVENLABS_VOICE_ID');
  const model = o.model || env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
  const body = JSON.stringify({ text, model_id: model, voice_settings: voiceSettings(model, o) });
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${id}/with-timestamps?output_format=mp3_44100_128`;
  let j;
  if (env.ELEVENLABS_SOCKS) {
    // из РФ ElevenLabs закрыт: идём через SOCKS-туннель (ssh -D на зарубежный сервер)
    const raw = execFileSync('curl', ['-s', '-m', '120', '--socks5-hostname', env.ELEVENLABS_SOCKS, '-X', 'POST', url,
      '-H', 'Content-Type: application/json', '-H', '@-', '--data-binary', body], { input: `xi-api-key: ${env.ELEVENLABS_API_KEY}\n`, maxBuffer: 64 << 20 }).toString();
    j = JSON.parse(raw);
    if (!j.audio_base64) throw new Error('ElevenLabs: ' + raw.slice(0, 300));
  } else {
    const r = await fetch(url, { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, body });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
    j = await r.json();
  }
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

// Доля слов текста, которые Whisper услышал в том же порядке (null — Whisper не установлен)
const WHISPER_MODEL = env.WHISPER_MODEL || path.join(process.env.HOME || '', '.whisper-models/ggml-small.bin');
function heard(mp3, text) {
  if (!fs.existsSync(WHISPER_MODEL)) return null;
  try {
    const wav = mp3.replace(/\.mp3$/, '.wav');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-ar', '16000', '-ac', '1', wav]);
    const got = execFileSync('whisper-cli', ['-m', WHISPER_MODEL, '-t', '4', '-l', 'ru', '-nt', '-np', '-f', wav], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const norm = s => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const a = norm(text), b = norm(got);
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return Math.max(0, 1 - d[a.length][b.length] / a.length);
  } catch { return null; }
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
  // ElevenLabs читает весь текст одним куском: интонация идёт через фразы, а не сбрасывается на каждой.
  // Потом режем слова по фразам по выравниванию. ELEVENLABS_WHOLE=0 — старый режим по фразе.
  if (useEleven && env.ELEVENLABS_WHOLE !== '0') {
    const f = path.join(tmp, 'all.mp3');
    const full = scene.lines.join(' ');
    let words, score = null;
    // v3 в творческом режиме иногда глотает или путает слова: сверяем Whisper'ом и перегенерируем
    for (let a = 1; a <= 3; a++) {
      words = await lineEleven(full, f);
      score = heard(f, full);
      if (score === null || score >= 0.82) break;
      console.warn(`  ${id}: Whisper узнал ${Math.round(score * 100)}% текста, дубль ${a + 1}`);
    }
    if (score !== null) console.log(`  ${id}: сверка Whisper ${Math.round(score * 100)}%`);
    let k = 0;
    for (const text of scene.lines) {
      const n = text.split(/\s+/).filter(Boolean).length;
      const ws = words.slice(k, k + n); k += n;
      lines.push({ text, start: +(t0 + ws[0].s).toFixed(3), end: +(t0 + ws.at(-1).e).toFixed(3),
        words: ws.map(w => ({ w: w.w, s: +(t0 + w.s).toFixed(3), e: +(t0 + w.e).toFixed(3) })) });
    }
    parts.push(f);
  } else for (const [i, text] of scene.lines.entries()) {
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
