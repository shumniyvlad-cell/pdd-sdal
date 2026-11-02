// Загрузка билетов, сцен и таймингов озвучки
import { estimateTiming } from './scene/player.js';

let ticketsP;
export function tickets() {
  ticketsP ||= fetch('data/tickets.json').then(r => r.json());
  return ticketsP;
}

const pad = n => String(n).padStart(2, '0');
export const sceneId = (t, q) => `t${pad(t)}/q${pad(q)}`;

let indexP;
export function sceneIndex() {
  indexP ||= fetch('data/scenes/index.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  return indexP;
}

export async function question(t, q) {
  const all = await tickets();
  return all[t - 1]?.qs[q - 1];
}

// Сцена + тайминг; null, если разбора ещё нет
export async function loadExplainer(t, q) {
  const id = sceneId(t, q);
  const idx = await sceneIndex();
  if (Object.keys(idx).length && !idx[id]) return null;
  const r = await fetch(`data/scenes/${id}.json`);
  if (!r.ok) return null;
  const scene = await r.json();
  let timing = null;
  try {
    const v = await fetch(`data/voice/${id}.json`);
    if (v.ok) timing = await v.json();
  } catch { /* нет озвучки — оценим */ }
  if (!timing) timing = estimateTiming(scene.lines);
  const qq = await question(t, q);
  const meta = { ticket: t, q, question: qq.q, answers: qq.a, correct: qq.c };
  return { scene, timing, meta, audio: timing.audio ? `data/voice/${timing.audio}` : null };
}
