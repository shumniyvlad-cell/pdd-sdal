// Студия: конвейер по билетам + просмотр сцены. ?render=1 — чистый кадр для pipeline/render.mjs
import { Player } from './scene/player.js';
import { tickets, sceneIndex, loadExplainer } from './data.js';

const qs = new URLSearchParams(location.search);
const T = +(qs.get('t') || 1), Q = +(qs.get('q') || 1);
const aspect = qs.get('aspect') === '9:16' ? '9:16' : '16:9';
const app = document.getElementById('app');

if (qs.get('render')) renderMode(); else studio();

async function renderMode() {
  document.body.className = 'render';
  const w = +(qs.get('w') || (aspect === '9:16' ? 1080 : 1920));
  const h = Math.round(aspect === '9:16' ? w * 16 / 9 : w * 9 / 16);
  app.innerHTML = `<div id="pl" style="width:${w}px;height:${h}px"></div>`;
  await document.fonts.ready;
  const ex = await loadExplainer(T, Q);
  const p = new Player(document.getElementById('pl'), { aspect });
  p.renderer.setPixelRatio(1);
  await p.load(ex.scene, ex.timing, ex.meta);
  window.__duration = p.duration;
  window.__seek = t => { p.seek(t); return true; };
  window.__player = p;
  window.__ready = true;
}

async function studio() {
  document.body.className = 'studio';
  const [all, idx] = await Promise.all([tickets(), sceneIndex()]);
  app.innerHTML = `
    <aside class="st-side">
      <a class="st-logo" href="./">ПДД <b>СДАЛ</b><small>студия разборов</small></a>
      <div class="st-legend"><i class="s1"></i>сценарий <i class="s2"></i>озвучка <i class="s3"></i>видео</div>
      <div class="st-tickets"></div>
    </aside>
    <main class="st-main">
      <header class="st-head">
        <div><div class="st-kicker">Билет ${T} · вопрос ${Q}</div><h1 class="st-q"></h1></div>
        <div class="st-switch"><button data-a="16:9">16:9 YouTube</button><button data-a="9:16">9:16 Reels</button></div>
      </header>
      <div class="st-stage ${aspect === '9:16' ? 'v' : ''}"><div id="pl"></div><div class="st-empty" hidden></div></div>
      <div class="st-bar"><button class="st-play">▶</button><input type="range" min="0" max="1000" value="0"><span class="st-time">0:00</span></div>
      <section class="st-panels">
        <div class="st-panel"><h3>Сценарий для озвучки</h3><ol class="st-lines"></ol></div>
        <div class="st-panel"><h3>Конвейер</h3><ol class="st-steps"></ol></div>
      </section>
    </main>`;
  const side = app.querySelector('.st-tickets');
  side.innerHTML = all.map(tk => `
    <div class="st-t ${tk.n === T ? 'open' : ''}"><div class="st-tn">Билет ${tk.n}<span>${tk.qs.filter((_, i) => idx[key(tk.n, i + 1)]).length}/20</span></div>
    <div class="st-qs">${tk.qs.map((q, i) => {
      const s = idx[key(tk.n, i + 1)] || {};
      const lvl = s.clip ? 3 : s.voice ? 2 : s.script ? 1 : 0;
      return `<a href="?t=${tk.n}&q=${i + 1}&aspect=${aspect}" class="l${lvl} ${tk.n === T && i + 1 === Q ? 'cur' : ''}" title="${(q.q || '').replace(/"/g, '')}">${i + 1}</a>`;
    }).join('')}</div></div>`).join('');
  side.querySelectorAll('.st-tn').forEach(el => el.onclick = () => el.parentElement.classList.toggle('open'));
  app.querySelectorAll('.st-switch button').forEach(b => {
    b.classList.toggle('on', b.dataset.a === aspect);
    b.onclick = () => { qs.set('aspect', b.dataset.a); location.search = qs.toString(); };
  });
  const q = all[T - 1].qs[Q - 1];
  app.querySelector('.st-q').textContent = q.q;
  const st = idx[key(T, Q)] || {};
  app.querySelector('.st-steps').innerHTML = [
    ['Билет и картинка', true, 'data/tickets.json'],
    ['Сценарий «для чайника» + 3D-раскадровка', !!st.script, 'pipeline/script.mjs'],
    ['Озвучка ElevenLabs с таймингом слов', !!st.voice, 'pipeline/voice.mjs'],
    ['Рендер 3D-сцены в mp4', !!st.clip, 'pipeline/render.mjs'],
    ['Склейка билета в 10 минут + музыка', !!st.ticket, 'pipeline/stitch.mjs'],
  ].map(([n, ok, f]) => `<li class="${ok ? 'ok' : ''}"><b>${n}</b><code>${f}</code></li>`).join('');

  const ex = await loadExplainer(T, Q);
  if (!ex) {
    const e = app.querySelector('.st-empty');
    e.hidden = false;
    e.innerHTML = `<div><b>Разбора ещё нет</b><p>Запусти конвейер:</p><code>node pipeline/run.mjs --ticket ${T} --q ${Q}</code>${q.img ? `<img src="img/q/${q.img}" alt="">` : ''}</div>`;
    app.querySelector('.st-bar').hidden = true;
    return;
  }
  app.querySelector('.st-lines').innerHTML = ex.scene.lines.map(l => `<li>${l}</li>`).join('') +
    (ex.scene.fishka ? `<li class="fk"><b>Фишка:</b> ${ex.scene.fishka}</li>` : '');
  const p = new Player(app.querySelector('#pl'), { aspect });
  p.setAudio(ex.audio);
  await p.load(ex.scene, ex.timing, ex.meta);
  window.__player = p;
  const range = app.querySelector('.st-bar input'), time = app.querySelector('.st-time'), play = app.querySelector('.st-play');
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  p.on((t, playing) => {
    range.value = Math.round(t / p.duration * 1000);
    time.textContent = `${fmt(t)} / ${fmt(p.duration)}`;
    play.textContent = playing ? '❚❚' : '▶';
    app.querySelectorAll('.st-lines li').forEach((li, i) => {
      const ln = ex.timing.lines[i];
      li.classList.toggle('now', !!ln && t >= ln.start && t <= ln.end + 0.3);
    });
  });
  range.oninput = () => p.seek(range.value / 1000 * p.duration);
  play.onclick = () => (p.playing ? p.pause() : p.play());
  if (qs.has('at')) p.seek(+qs.get('at'));
}

function key(t, q) { return `t${String(t).padStart(2, '0')}/q${String(q).padStart(2, '0')}`; }
