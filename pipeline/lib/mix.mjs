// Сведение звука разбора: голос + музыка (Metamorphosis) + фон дороги + звуки событий по таймлайну сцены.
// Уровни по эталону Veyron V13: голос −22 LUFS, музыка ≈ −36, фон ≈ −43, итог −17 LUFS.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, SITE } from './paths.mjs';

const SFX = path.join(SITE, 'assets/sfx');
const abs = p => (path.isAbsolute(p) ? p : path.join(ROOT, p));

// интегральная громкость файла, LUFS
function measureLUFS(file) {
  const res = execFileSync('sh', ['-c', 'ffmpeg -hide_banner -i "$0" -af loudnorm=print_format=json -f null - 2>&1 | grep input_i', file]).toString();
  return parseFloat(/"input_i"\s*:\s*"(-?[\d.]+)"/.exec(res)?.[1] ?? '-22');
}

// то же правило, что player.time(): "L3", "L3e", "L3+1.2", "end-2", секунды
function resolver(timing, duration) {
  return at => {
    if (typeof at === 'number') return at;
    const m = /^(L(\d+)(e?)|end)([+-][\d.]+)?$/.exec(String(at ?? 0).trim());
    if (!m) return 0;
    const line = m[1] === 'end' ? null : timing.lines[Math.min(+m[2], timing.lines.length) - 1];
    return (line ? (m[3] ? line.end : line.start) : duration) + (m[4] ? parseFloat(m[4]) : 0);
  };
}

// Список событий: явные биты sfx + автоматические к титрам, плашкам, карточкам, ответу, аварийке, дыму
export function sfxEvents(scene, timing, duration) {
  const T = resolver(timing, duration);
  const ev = [];
  const add = (name, at, gain, extra = {}) => ev.push({ name, at: Math.max(0, at), gain, ...extra });
  const beats = (scene.beats || []).map(b => ({ ...b, t0: T(b.at), end: b.until !== undefined ? T(b.until) : undefined }));
  for (const b of beats) {
    if (b.do === 'sfx') add(b.name, b.t0, b.gain ?? 0.3, { dur: b.dur ?? (b.end !== undefined ? b.end - b.t0 : undefined), fade: b.fade });
    if (b.do === 'title') add('whoosh-short', b.t0, 0.35);
    if (b.do === 'tag') add('pop', b.t0, 0.22);
    if (b.do === 'card') for (const it of b.items || []) add('click-soft', it.at !== undefined ? T(it.at) : b.t0, 0.32);
    if (b.do === 'answer') add('chime', b.t0, 0.3);
    if (b.do === 'show' && !/^(lbl|t[A-Z])/.test(b.id)) add('pop', b.t0, 0.2);
    if (b.do === 'smoke') add('hiss', b.t0, 0.16, { dur: duration - b.t0, fade: 1.5 });
    if (b.do === 'signal' && b.side === 'hazard') {
      for (let t = b.t0; t < duration - 0.1; t += 0.74) { add('tick', t, 0.2); add('tock', t + 0.37, 0.16); }
    }
  }
  const ans = beats.find(b => b.do === 'answer');
  if (scene.fishka && ans) add('sparkle', ans.t0 + (ans.dur ?? 3.2), 0.22);
  return ev.filter(e => fs.existsSync(path.join(SFX, e.name + '.wav')));
}

export function mixAudio({ scene, timing, duration, voice, out, env }) {
  const tmp = out.replace(/\.wav$/, '');
  const inputs = [];
  const chains = [];
  const labels = [];
  const add = (file, chain) => { inputs.push(file); const i = inputs.length - 1; chains.push(`[${i}:a]${chain}[a${i}]`); labels.push(`[a${i}]`); };
  const D = duration.toFixed(3);
  // голос к −22 LUFS
  if (voice && fs.existsSync(voice)) {
    const g = -22 - measureLUFS(voice);
    add(voice, `aresample=48000,aformat=channel_layouts=stereo,volume=${g.toFixed(2)}dB,apad=whole_dur=${D}`);
  }
  // музыка: стем Metamorphosis на своём уровне, мягкий вход и уход
  const music = env.MUSIC_PATH && fs.existsSync(abs(env.MUSIC_PATH)) ? abs(env.MUSIC_PATH) : null;
  if (music) add(music, `atrim=start=${scene.audio?.musicStart ?? 0}:duration=${D},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${scene.audio?.musicGain ?? 1.0},afade=t=in:d=0.6,afade=t=out:st=${(duration - 2).toFixed(2)}:d=2`);
  // фон дороги: ровный кусок стема эффектов
  const amb = env.AMBIENCE_PATH && fs.existsSync(abs(env.AMBIENCE_PATH)) ? abs(env.AMBIENCE_PATH) : null;
  if (amb) add(amb, `atrim=start=${scene.audio?.ambienceStart ?? 20}:duration=${D},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${scene.audio?.ambienceGain ?? 1.6},afade=t=in:d=0.4,afade=t=out:st=${(duration - 1.2).toFixed(2)}:d=1.2`);
  // события
  for (const e of sfxEvents(scene, timing, duration)) {
    const ms = Math.round(e.at * 1000);
    let ch = `aresample=48000,aformat=channel_layouts=stereo`;
    if (e.dur) ch += `,atrim=duration=${e.dur.toFixed(3)}${e.fade ? `,afade=t=out:st=${Math.max(0, e.dur - e.fade).toFixed(3)}:d=${e.fade}` : ''}`;
    ch += `,volume=${e.gain},adelay=${ms}|${ms}`;
    add(path.join(SFX, e.name + '.wav'), ch);
  }
  const graph = `${chains.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,atrim=duration=${D}[mix]`;
  const raw = tmp + '.raw.wav';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs.flatMap(f => ['-i', f]), '-filter_complex', graph, '-map', '[mix]', '-ar', '48000', '-ac', '2', raw]);
  // итог к −17 LUFS с лимитером
  const g = -17 - measureLUFS(raw);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `volume=${g.toFixed(2)}dB,alimiter=limit=0.89:level=false`, '-ar', '48000', out]);
  fs.rmSync(raw);
  return { out, events: sfxEvents(scene, timing, duration).length };
}
