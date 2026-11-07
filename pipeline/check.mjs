// Автопроверка сцены на баги: гоняет плеер по таймлайну и ищет то, что режет глаз.
// node check.mjs 1 [1 2 3]          → отчёт в консоль, код выхода 1 при ошибках
// node check.mjs 1 1 --vision       → ещё и сетку кадров глазами модели (ANTHROPIC_API_KEY или OPENAI_API_KEY)
//
// Что ловит без нейросети:
//  - машина едет задом (скорость против направления кузова), если в move нет "reverse": true
//  - встречка: правостороннее движение, на прямой дороге машина должна быть справа от осевой
//  - машины въехали друг в друга, машина проехала сквозь пешехода
//  - выноска висит над объектом, которого нет в кадре
//  - подписи и плашки наезжают друг на друга или текст не влезает
//  - биты на несуществующие объекты и за пределами ролика
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { serveSite } from './lib/serve.mjs';
import { openScene } from './lib/browser.mjs';
import { loadEnv } from './lib/env.mjs';
import { OUT, SITE, pad, qid } from './lib/paths.mjs';

const VEHICLES = ['model', 'car', 'truck', 'bus', 'tram', 'moto', 'bike'];

// выполняется в странице студии (?render=1)
function probe({ step, vehicles }) {
  const p = window.__player, out = [];
  const add = (t, kind, msg) => out.push({ t: +t.toFixed(2), kind, msg });
  const sc = p.sceneDef, ids = new Set(Object.keys(p.objs));
  for (const b of p.beats) {
    if (b.id && !ids.has(b.id) && !['note', 'answer', 'sfx'].includes(b.do)) add(b.t0, 'beat', `бит ${b.do} ссылается на несуществующий объект «${b.id}»`);
    if (b.t0 > p.duration + 0.05) add(b.t0, 'beat', `бит ${b.do}${b.id ? ' ' + b.id : ''} позже конца ролика (${p.duration.toFixed(1)} с)`);
  }
  const cars = Object.entries(p.objs).filter(([, o]) => vehicles.includes(o.userData.def?.type) || o.userData.signals);
  const peds = Object.entries(p.objs).filter(([, o]) => /duck2d|ped/.test(o.userData.def?.type || ''));
  const moveOf = (id, t) => (p.moves[id] || []).filter(m => t >= m.t0 && t <= m.t0 + m.dur).at(-1);
  const box = o => { const s = o.userData.size; return s ? { w: s.x, l: s.z } : { w: 1.8, l: 4.2 }; };
  const corners = (o, w, l) => {
    const c = Math.cos(o.rotation.y), s = Math.sin(o.rotation.y);
    return [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]]
      .map(([x, z]) => [o.position.x + x * c + z * s, o.position.z - x * s + z * c]);
  };
  const sat = (A, B) => {
    for (const P of [A, B]) for (let i = 0; i < 4; i++) {
      const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % 4], nx = z1 - z2, nz = x2 - x1;
      const pa = A.map(([x, z]) => x * nx + z * nz), pb = B.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
    return true;
  };
  const seen = new Set();
  const once = (key, t, kind, msg) => { if (!seen.has(key)) { seen.add(key); add(t, kind, msg); } };
  let prev = {};
  for (let t = 0; t <= p.duration; t += step) {
    p.seek(t);
    const pos = {};
    for (const [id, o] of cars) {
      pos[id] = { x: o.position.x, z: o.position.z };
      const a = prev[id];
      if (!a) continue;
      const vx = (o.position.x - a.x) / step, vz = (o.position.z - a.z) / step, sp = Math.hypot(vx, vz);
      if (sp < 0.6 || !o.visible) continue;
      const m = moveOf(id, t);
      const fx = -Math.sin(o.rotation.y), fz = -Math.cos(o.rotation.y);
      if ((vx * fx + vz * fz) / sp < -0.3 && !m?.reverse) once(id + 'back', t, 'motion', `«${id}» едет задом (кузов смотрит против движения)`);
      // правостороннее: правый вектор от направления движения
      const rx = -vz / sp, rz = vx / sp;
      const alongZ = Math.abs(vz) > Math.abs(vx) * 2, alongX = Math.abs(vx) > Math.abs(vz) * 2;
      const inCross = sc.set !== 'straight' && sc.set !== 'real' ? Math.abs(o.position.x) < 8 && Math.abs(o.position.z) < 8 : false;
      const off = alongZ ? o.position.x * rx : alongX ? o.position.z * rz : 0;
      if ((alongZ || alongX) && !inCross && off < -0.4 && m?.lane !== false) once(id + 'lane', t, 'lane', `«${id}» едет по встречной полосе`);
    }
    // столкновения машин
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const [ia, a] = cars[i], [ib, b] = cars[j];
      if (!a.visible || !b.visible) continue;
      const ba = box(a), bb = box(b);
      if (sat(corners(a, ba.w * 0.92, ba.l * 0.92), corners(b, bb.w * 0.92, bb.l * 0.92))) once(ia + ib + 'hit', t, 'collision', `«${ia}» и «${ib}» въехали друг в друга`);
    }
    // наезд на пешехода
    for (const [ic, c] of cars) for (const [ip, pd] of peds) {
      if (!c.visible || !pd.visible || !prev[ic]) continue;
      const moving = Math.hypot(c.position.x - prev[ic].x, c.position.z - prev[ic].z) / step > 0.6;
      const bc = box(c);
      const inside = corners(c, bc.w + 0.5, bc.l + 0.5);
      if (moving && sat(inside, corners(pd, 0.5, 0.5))) once(ic + ip + 'ped', t, 'collision', `«${ic}» проехал сквозь «${ip}»`);
    }
    prev = pos;
    // оверлей: выноски вне кадра, наезды плашек, вылезающий текст
    const root = p.el.querySelector('.pl-ov'), R = root.getBoundingClientRect();
    const shown = [...root.querySelectorAll('.ov-note, .co, .ov-plaques, .ov-q, .ov-chip, .ov-tags .tg')]
      .filter(e => +getComputedStyle(e).opacity > 0.5 && getComputedStyle(e).visibility !== 'hidden' && e.offsetParent !== null);
    for (const b of p.beats.filter(b => b.do === 'callout' && t >= b.t0 + 0.3 && t < b.t0 + (b.dur ?? 2.6) - 0.3)) {
      const el = root.querySelector(`.co[data-i="${b.i}"]`);
      if (el && +el.style.opacity < 0.05) once('co' + b.i, t, 'callout', `выноска «${b.text}» висит над «${b.id}», которого нет в кадре`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.left < R.left || r.right > R.right || r.top < R.top) once('cob' + b.i, t, 'callout', `выноска «${b.text}» вылезает за край кадра`);
      }
    }
    for (let i = 0; i < shown.length; i++) {
      const a = shown[i];
      if (a.scrollWidth > a.clientWidth + 2 && !a.classList.contains('ov-plaques')) once('ovf' + a.className, t, 'text', `текст не влезает: «${a.textContent.slice(0, 40)}»`);
      for (let j = i + 1; j < shown.length; j++) {
        const b = shown[j];
        if (a.contains(b) || b.contains(a)) continue;
        const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
        const ix = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left), iy = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
        if (ix > 6 && iy > 6) once('ov' + a.className + b.className, t, 'overlay', `наезжают: «${a.textContent.trim().slice(0, 30)}» и «${b.textContent.trim().slice(0, 30)}»`);
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const VISION_PROMPT = `Ты — придирчивый монтажёр роликов-разборов ПДД. Перед тобой сетка кадров одного ролика (по кадру на фразу озвучки) и текст озвучки.
Найди визуальные баги: машина едет задом или боком, машина на встречке, объекты висят в воздухе или проваливаются в землю,
утка-пешеход или машина не там, где о ней говорит текст, подпись не совпадает со сказанным, перекрытые или обрезанные надписи,
чёрные/белые артефакты, пустой кадр. Не придумывай: только то, что видно. Ответ — JSON {"issues":[{"frame":N,"problem":"..."}]}, пустой список, если всё чисто.`;

async function vision(img, text) {
  const env = loadEnv();
  const data = fs.readFileSync(img).toString('base64');
  if (env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 2000, system: VISION_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }, { type: 'text', text }] }] }),
    });
    const j = await r.json();
    return j.content?.map(c => c.text || '').join('') || JSON.stringify(j);
  }
  if (env.OPENAI_API_KEY) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-5', response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: VISION_PROMPT }, { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } }] }] }),
    });
    return (await r.json()).choices?.[0]?.message?.content;
  }
  return null;
}

// Калибровка моделей: каждая машина едет на камеру, в кадре должна быть морда.
// Ловит модели, экспортированные задом наперёд (как фургон из scene.blend).
export async function modelsSheet(srv, models) {
  const sc = await openScene(srv.url, { t: 1, q: 1, width: 640 });
  const files = [];
  try {
    for (const m of models) {
      await sc.page.evaluate(async model => {
        const p = window.__player;
        const scene = { ...p.sceneDef, lines: ['x'], props: [{ id: 'm', type: 'model', model, at: [1.75, 12], dir: 'n' }],
          beats: [{ at: 0, do: 'move', id: 'm', path: [[1.75, -12]], dur: 2, ease: 'linear' },
            { at: 0, do: 'cam', pos: [-3, 2.2, -9], look: [1.75, 0.8, 0] }], style: 'ref', questionUntil: -1, plaquesFrom: 999 };
        await p.load(scene, { lines: [{ start: 0, end: 2, words: [] }], duration: 2 }, {});
        p.seek(1);
      }, m);
      const f = path.join(OUT, 'review', `_m_${m}.jpg`);
      fs.writeFileSync(f, await sc.page.screenshot({ type: 'jpeg', quality: 85 }));
      files.push(f);
    }
  } finally { await sc.browser.close(); }
  const out = path.join(OUT, 'review', 'models-front.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex',
    `${files.map((_, i) => `[${i}:v]drawtext=text='${models[i]}':x=12:y=12:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6[v${i}]`).join(';')};${files.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${files.length}`,
    '-frames:v', '1', out]);
  files.forEach(f => fs.rmSync(f));
  return out;
}

export async function checkScene(srv, t, q, { step = 0.1 } = {}) {
  const sc = await openScene(srv.url, { t, q, width: 960 });
  try {
    return await sc.page.evaluate(probe, { step, vehicles: VEHICLES });
  } finally { await sc.browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const useVision = args.includes('--vision');
  if (args.includes('--models')) {
    const srv = await serveSite();
    fs.mkdirSync(path.join(OUT, 'review'), { recursive: true });
    const models = fs.readdirSync(path.join(SITE, 'assets/models')).filter(f => /^(priora|van|granta|bugatti|car_)/.test(f)).map(f => f.replace('.glb', ''));
    const img = await modelsSheet(srv, models);
    console.log('Машины едут на камеру — у каждой должна быть видна морда (фары, решётка):', img);
    srv.close(); process.exit(0);
  }
  const [t, ...qs] = args.filter(a => !a.startsWith('--')).map(Number);
  const list = qs.length ? qs : Array.from({ length: 20 }, (_, i) => i + 1);
  const srv = await serveSite();
  let bad = 0;
  for (const q of list) {
    if (!fs.existsSync(path.join(SITE, 'data/voice', qid(t, q) + '.json'))) continue;
    const issues = await checkScene(srv, t, q);
    console.log(`\n${qid(t, q)}: ${issues.length ? issues.length + ' проблем' : 'чисто'}`);
    for (const i of issues) console.log(`  ${i.t.toFixed(1).padStart(5)} с  [${i.kind}] ${i.msg}`);
    bad += issues.length;
    if (useVision) {
      execFileSync('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'review.mjs'), String(t), String(q)], { stdio: 'ignore' });
      const img = path.join(OUT, 'review', `t${pad(t)}-q${pad(q)}.jpg`);
      const scene = JSON.parse(fs.readFileSync(path.join(SITE, 'data/scenes', qid(t, q) + '.json'), 'utf8'));
      const v = await vision(img, 'Озвучка по фразам:\n' + scene.lines.map((l, i) => `${i + 1}. ${l}`).join('\n'));
      console.log(v === null ? '  (vision: нет ANTHROPIC_API_KEY/OPENAI_API_KEY в .env — сетка кадров в ' + img + ')' : '  vision: ' + v);
    }
  }
  srv.close();
  process.exit(bad ? 1 : 0);
}
