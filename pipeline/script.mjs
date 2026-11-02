// Сценарий + 3D-раскадровка вопроса нейросетью. Правила и словарь сцены — в AGENTS.md (тот же текст читает Codex).
// Claude (ANTHROPIC_API_KEY) или OpenAI (OPENAI_API_KEY). Картинку билета модель видит.
// node script.mjs 1 7 [--force] → site/data/scenes/t01/q07.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, SITE, qid } from './lib/paths.mjs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv();
const SPEC = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
const EXAMPLES = ['t01/q05', 't01/q13', 't01/q18'].map(id => ({ id, json: fs.readFileSync(path.join(SITE, 'data/scenes', id + '.json'), 'utf8') }));

function prompt(t, q, Q) {
  return `Билет ${t}, вопрос ${q}.
Вопрос: ${Q.q}
Ответы:
${Q.a.map((a, i) => `${i + 1}. ${a}${i === Q.c ? '  ← ПРАВИЛЬНЫЙ' : ''}`).join('\n')}
Официальное пояснение: ${Q.tip}
${Q.img ? 'Картинка билета приложена — повтори в 3D ту же ситуацию (дорога, знаки, кто где стоит).' : 'Картинки нет — это вопрос-теория, бери сет studio или простую дорогу.'}

Примеры готовых сцен из этого же проекта:
${EXAMPLES.map(e => `--- ${e.id}\n${e.json}`).join('\n')}

Верни ТОЛЬКО JSON сцены, без пояснений и без markdown.`;
}

async function askClaude(system, text, img) {
  const content = [];
  if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
  content.push({ type: 'text', text });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 8000, system, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.content.filter(c => c.type === 'text').map(c => c.text).join('');
}

async function askOpenAI(system, text, img) {
  const content = [{ type: 'text', text }];
  if (img) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } });
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-5', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  return (await r.json()).choices[0].message.content;
}

// Проверка сцены до озвучки: ловим то, что сломает плеер
export function validate(s) {
  const err = [];
  if (!Array.isArray(s.lines) || s.lines.length < 3 || s.lines.length > 7) err.push('lines: нужно 3–7 фраз');
  const words = (s.lines || []).join(' ').split(/\s+/).length;
  if (words < 35 || words > 75) err.push(`текст ${words} слов, нужно 40–70 (≈30 секунд)`);
  if (!s.fishka) err.push('нет fishka');
  if (!['crossroad', 'straight', 'studio', 'real'].includes(s.set)) err.push('set: crossroad | straight | studio | real');
  const ids = new Set((s.props || []).map(p => p.id));
  if (!ids.size) err.push('нет props');
  const TYPES = ['model', 'duck2d', 'rsmoke', 'rtriangle', 'car', 'truck', 'bus', 'tram', 'ped', 'bike', 'moto', 'sign', 'light', 'arrow', 'label', 'tag', 'measure', 'smoke', 'triangle', 'cone', 'ball', 'duck'];
  for (const p of s.props || []) if (!TYPES.includes(p.type)) err.push(`prop ${p.id}: тип ${p.type} неизвестен`);
  const DO = ['title', 'tag', 'face', 'cam', 'move', 'show', 'hide', 'signal', 'light', 'draw', 'pulse', 'mark', 'smoke', 'big', 'card', 'answer', 'duck', 'turn'];
  for (const b of s.beats || []) {
    if (!DO.includes(b.do)) err.push(`beat ${b.do} неизвестен`);
    if (b.id && !ids.has(b.id)) err.push(`beat ${b.do} ссылается на несуществующий id ${b.id}`);
    for (const k of ['at', 'until']) {
      const m = /^L(\d+)/.exec(String(b[k] ?? ''));
      if (m && +m[1] > s.lines.length) err.push(`${k}=${b[k]}: фраз всего ${s.lines.length}`);
    }
  }
  if (!(s.beats || []).some(b => b.do === 'answer')) err.push('нет бита answer');
  return err;
}

export async function writeScene(t, q, { force = false } = {}) {
  const file = path.join(SITE, 'data/scenes', qid(t, q) + '.json');
  if (fs.existsSync(file) && !force) return { file, skipped: true };
  const Q = JSON.parse(fs.readFileSync(path.join(SITE, 'data/tickets.json'), 'utf8'))[t - 1].qs[q - 1];
  const img = Q.img ? fs.readFileSync(path.join(SITE, 'img/q', Q.img)).toString('base64') : null;
  const ask = env.ANTHROPIC_API_KEY ? askClaude : env.OPENAI_API_KEY ? askOpenAI : null;
  if (!ask) throw new Error('Нужен ANTHROPIC_API_KEY или OPENAI_API_KEY в .env');
  let text = prompt(t, q, Q), scene, errors = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await ask(SPEC, text, img);
    try {
      scene = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      errors = validate(scene);
    } catch (e) { errors = ['JSON не парсится: ' + e.message]; }
    if (!errors.length) break;
    text = `${prompt(t, q, Q)}\n\nПрошлая попытка не прошла проверку:\n- ${errors.join('\n- ')}\nИсправь и верни JSON целиком.`;
  }
  if (errors.length) throw new Error(`${qid(t, q)}: ${errors.join('; ')}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(scene));
  execFileSync('python3', ['-I', path.join(ROOT, 'pipeline/lib/fmt.py'), file]);
  return { file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const [t, q] = args.filter(a => !a.startsWith('--')).map(Number);
  const r = await writeScene(t, q, { force: args.includes('--force') });
  console.log(r.skipped ? `${qid(t, q)} уже есть (--force, чтобы переписать)` : `${qid(t, q)} → ${path.relative(ROOT, r.file)}`);
}
