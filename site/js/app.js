// ПДД СДАЛ: главная, билеты, вопрос с 3D-разбором, экзамен. Роутинг на хэше.
import { Player } from './scene/player.js';
import { tickets, loadExplainer, sceneIndex } from './data.js';

const view = document.getElementById('view');
const BOT = 'https://t.me/PDDStartBot';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// прогресс ученика живёт в браузере
const store = {
  get() { try { return JSON.parse(localStorage.getItem('pdd.progress') || '{}'); } catch { return {}; } },
  set(t, q, ok) { const p = this.get(); p[`${t}-${q}`] = ok; try { localStorage.setItem('pdd.progress', JSON.stringify(p)); } catch { /* приватный режим */ } },
};

let players = [];
let examTimer = null;
function cleanup() {
  players.forEach(p => p.dispose());
  players = [];
  clearInterval(examTimer);
}

async function route() {
  cleanup();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  window.scrollTo(0, 0);
  if (parts[0] === 'tickets') return home('tickets');
  if (parts[0] === 't' && parts[2]) return questionPage(+parts[1], +parts[2]);
  if (parts[0] === 't') return ticketPage(+parts[1]);
  if (parts[0] === 'exam') return examPage(+parts[1] || 1);
  return home();
}
window.addEventListener('hashchange', route);
route();

// ---------- главная ----------
async function home(anchor) {
  const [all, idx] = await Promise.all([tickets(), sceneIndex()]);
  const prog = store.get();
  const ready3d = Object.keys(idx).length;
  view.innerHTML = `
  <section class="hero">
    <div class="wrap">
      <div>
        <div class="kicker">Экзамен ПДД · категории A, B, M</div>
        <h1 class="h-xl" style="margin-top:14px"><span class="outline">Все 800</span><br><span class="outline">вопросов</span> <span class="plate">в 3D</span></h1>
        <p class="hero-lead">Каждый вопрос экзамена — <b>3D-ролик на 30 секунд</b>. Утка в фуражке показывает на машинках, почему ответ именно такой. <b>Без зубрёжки и без умных слов</b> — как другу.</p>
        <div class="hero-cta">
          <a class="btn btn-y" href="#/t/1/1">Начать с билета 1 →</a>
          <a class="btn btn-ghost" href="#/exam/1">Экзамен на время</a>
        </div>
        <div class="hero-stats">
          <div>40<span>билетов</span></div>
          <div>800<span>вопросов</span></div>
          <div>30 с<span>на разбор</span></div>
          <div>10 мин<span>ролик на билет</span></div>
        </div>
      </div>
      <div class="phone"><div id="hero-pl"></div><button class="phone-sound" title="Со звуком">🔇</button><div class="phone-badge">билет 1 · вопрос 5</div></div>
    </div>
  </section>
  <div class="road"></div>
  <section class="sec">
    <div class="wrap">
      <div class="sec-head"><h2 class="h-l">Как это<br>работает</h2><p>Тот же экзамен, что в ГИБДД, только каждый вопрос можно посмотреть в 3D, а не читать сухое пояснение.</p></div>
      <div class="how">
        <div class="how-card"><div class="n">01</div><h3>Решаешь билет</h3><p>Официальные 20 вопросов с картинками. Ответил — сразу видно, прав или нет.</p></div>
        <div class="how-card"><div class="n">02</div><h3>Смотришь 3D</h3><p>Полминуты: знак, разметка, машины едут — и в конце фишка, как запомнить.</p></div>
        <div class="how-card"><div class="n">03</div><h3>Сдаёшь на время</h3><p>Режим экзамена: 20 минут, 20 вопросов, ошибки сразу в разбор.</p></div>
      </div>
    </div>
  </section>
  <section class="sec" id="tickets" style="padding-top:0">
    <div class="wrap">
      <div class="sec-head"><h2 class="h-l">Билеты</h2><p>${ready3d ? `3D-разборы готовы для ${ready3d} вопросов, остальные выходят каждый день.` : ''} Прогресс сохраняется в этом браузере.</p></div>
      <div class="tickets">${all.map(tk => {
        const ok = tk.qs.filter((_, i) => prog[`${tk.n}-${i + 1}`] === true).length;
        const bad = tk.qs.filter((_, i) => prog[`${tk.n}-${i + 1}`] === false).length;
        const has3d = tk.qs.some((_, i) => idx[`t${String(tk.n).padStart(2, '0')}/q${String(i + 1).padStart(2, '0')}`]);
        return `<a class="tk" href="#/t/${tk.n}"><div class="tk-l">Билет</div><div class="tk-n">${tk.n}</div>${has3d ? '<span class="tk-3d">3D</span>' : ''}
          <div class="tk-bar"><i class="ok" style="width:${ok * 5}%"></i><i class="bad" style="width:${bad * 5}%"></i></div></a>`;
      }).join('')}</div>
    </div>
  </section>
  <section class="sec" style="padding-top:0">
    <div class="wrap">
      <div class="sec-head"><h2 class="h-l">Нас смотрят</h2><p>Те же разборы, что в Reels и Shorts у @pdd_duck. Подписывайся, там новые каждый день.</p></div>
      <div class="proof">
        <div><b>25 тыс.</b><span>подписчиков в Instagram за первый месяц</span></div>
        <div><b>1,3 млн</b><span>просмотров у одного ролика</span></div>
        <div><b>800</b><span>видеоразборов уже лежат в боте</span></div>
      </div>
      <div class="reels">${[
        ['Ky60t1D6-pg', '345 тыс.'], ['BOwfZ6Lonwc', '18 тыс.'], ['saMX3OHgf4w', '14 тыс.'],
        ['Kr8vhO62rFc', '20 тыс.'], ['oc_qb-7UmUg', '21 тыс.'], ['8gOUAJggd1E', '16 тыс.'],
      ].map(([id, v]) => `<a class="reel" href="https://youtube.com/shorts/${id}" target="_blank" rel="noopener"><img src="img/reels/${id}.jpg" alt="" loading="lazy"><span>▶ ${v}</span></a>`).join('')}</div>
    </div>
  </section>
  <section class="sec" style="padding-top:0">
    <div class="wrap">
      <div class="cta-bot">
        <div><h2 class="h-l">Все разборы — в боте</h2><p>Видео по всем 800 вопросам, подборки сложных билетов и билеты-близнецы. Заходи в Telegram, бот всё выдаст.</p></div>
        <a class="btn" href="${BOT}" target="_blank" rel="noopener">Открыть @PDDStartBot</a>
      </div>
    </div>
  </section>`;
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  heroPlayer();
}

async function heroPlayer() {
  const el = document.getElementById('hero-pl');
  const ex = await loadExplainer(1, 5);
  if (!ex || !el.isConnected) return;
  const p = new Player(el, { aspect: '9:16' });
  players.push(p);
  await p.load(ex.scene, ex.timing, ex.meta);
  const btn = document.querySelector('.phone-sound');
  // без звука по кругу; кнопка включает звук с текущего места
  p.on((t, playing) => { if (!playing && t >= p.duration - 0.01 && !p.audio) { p.seek(0); p.play(); } });
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) p.play(); else p.pause(); });
  io.observe(el);
  btn.onclick = () => {
    if (p.audio) { p.pause(); p.setAudio(null); btn.textContent = '🔇'; p.play(); return; }
    p.pause(); p.setAudio(ex.audio); btn.textContent = '🔊'; p.seek(0); p.play();
  };
}

// ---------- билет ----------
async function ticketPage(t) {
  const [all, idx] = await Promise.all([tickets(), sceneIndex()]);
  const tk = all[t - 1];
  if (!tk) { location.hash = '#/'; return; }
  const prog = store.get();
  const ok = tk.qs.filter((_, i) => prog[`${t}-${i + 1}`] === true).length;
  view.innerHTML = `
  <div class="page"><div class="wrap">
    <div class="crumbs"><a href="#/tickets">Все билеты</a> / Билет ${t}</div>
    <h1 class="h-l"><span class="outline">Билет</span> <span class="plate">${t}</span></h1>
    <p style="color:var(--mut);margin:10px 0 0">Решено верно: ${ok} из 20</p>
    <div class="qgrid">${tk.qs.map((q, i) => {
      const st = prog[`${t}-${i + 1}`];
      const has = idx[`t${String(t).padStart(2, '0')}/q${String(i + 1).padStart(2, '0')}`];
      return `<a href="#/t/${t}/${i + 1}" class="${st === true ? 'ok' : st === false ? 'bad' : ''} ${has ? 'has3d' : ''}">${i + 1}</a>`;
    }).join('')}</div>
    <div class="tk-actions">
      <a class="btn btn-y" href="#/t/${t}/1">Решать по порядку</a>
      <a class="btn btn-ghost" href="#/exam/${t}">Экзамен на 20 минут</a>
      ${t < 40 ? `<a class="btn btn-ghost" href="#/t/${t + 1}">Билет ${t + 1} →</a>` : ''}
    </div>
  </div></div>`;
}

// ---------- вопрос ----------
async function questionPage(t, n) {
  const all = await tickets();
  const q = all[t - 1]?.qs[n - 1];
  if (!q) { location.hash = '#/'; return; }
  const prog = store.get();
  view.innerHTML = `
  <div class="page"><div class="wrap">
    <div class="crumbs"><a href="#/tickets">Все билеты</a> / <a href="#/t/${t}">Билет ${t}</a> / Вопрос ${n}</div>
    <div class="dots">${all[t - 1].qs.map((_, i) => {
      const st = prog[`${t}-${i + 1}`];
      return `<a href="#/t/${t}/${i + 1}" class="${i + 1 === n ? 'cur' : ''} ${st === true ? 'ok' : st === false ? 'bad' : ''}">${i + 1}</a>`;
    }).join('')}</div>
    <div class="q-layout">
      <div>
        <div class="q-card">
          ${q.img ? `<div class="q-img"><img src="img/q/${q.img}" alt=""></div>` : ''}
          <div class="q-body">
            <div class="q-num"><span class="kicker">Билет ${t} · вопрос ${n}</span><span style="color:var(--mut);font-size:13px">${esc(q.topic?.[0] || '')}</span></div>
            <h1 class="q-text">${esc(q.q)}</h1>
            <div class="answers">${q.a.map((a, i) => `<button class="ans" data-i="${i}"><i>${i + 1}</i><span>${esc(a)}</span></button>`).join('')}</div>
            <div class="tip" hidden></div>
          </div>
        </div>
      </div>
      <div class="q-side"><div class="xp" id="xp"></div></div>
    </div>
    <div class="q-nav">
      ${n > 1 ? `<a class="btn btn-ghost" href="#/t/${t}/${n - 1}">← Назад</a>` : '<span></span>'}
      ${n < 20 ? `<a class="btn btn-y" href="#/t/${t}/${n + 1}">Следующий →</a>` : `<a class="btn btn-y" href="#/t/${t}">К билету</a>`}
    </div>
  </div></div>`;
  const tip = view.querySelector('.tip');
  view.querySelectorAll('.ans').forEach(b => b.onclick = () => {
    const i = +b.dataset.i, ok = i === q.c;
    view.querySelectorAll('.ans').forEach(x => { x.disabled = true; if (+x.dataset.i === q.c) x.classList.add('right'); });
    if (!ok) b.classList.add('wrong');
    store.set(t, n, ok);
    tip.hidden = false;
    tip.innerHTML = `<b>${ok ? 'Верно!' : `Правильный ответ: ${q.c + 1}.`}</b> ${esc(q.tip)}`;
    view.querySelector(`.dots a.cur`)?.classList.add(ok ? 'ok' : 'bad');
  });
  explainer(document.getElementById('xp'), t, n);
}

async function explainer(box, t, n) {
  const ex = await loadExplainer(t, n);
  if (!box.isConnected) return;
  if (!ex) {
    box.innerHTML = `<div class="xp-lock"><div><div class="h-m">3D-разбор скоро</div>
      <p>Этот вопрос мы уже разобрали видео в боте. 3D-версия появится здесь, следи за билетами с плашкой 3D.</p>
      <a class="btn btn-y" href="${BOT}" target="_blank" rel="noopener">Смотреть в боте</a></div></div>`;
    return;
  }
  box.innerHTML = `<div class="xp-head"><b>3D-разбор</b><span>${Math.round(ex.timing.duration)} сек · со звуком</span></div>
    <div style="position:relative"><div id="xp-pl"></div><button class="xp-cover"><span>▶ Смотреть разбор</span></button></div>
    <div class="xp-bar"><button class="xp-play">▶</button><input type="range" min="0" max="1000" value="0"><span class="xp-time">0:00</span></div>`;
  const p = new Player(box.querySelector('#xp-pl'), { aspect: '16:9' });
  players.push(p);
  p.setAudio(ex.audio);
  await p.load(ex.scene, ex.timing, ex.meta);
  p.seek(Math.min(ex.timing.lines[1]?.start + 1.5 || 2, p.duration));
  const range = box.querySelector('input'), time = box.querySelector('.xp-time'), play = box.querySelector('.xp-play'), cover = box.querySelector('.xp-cover');
  p.on((tt, playing) => {
    range.value = Math.round(tt / p.duration * 1000);
    time.textContent = `${fmt(tt)} / ${fmt(p.duration)}`;
    play.textContent = playing ? '❚❚' : '▶';
  });
  const start = () => { cover.remove(); p.seek(0); p.play(); };
  cover.onclick = start;
  play.onclick = () => { if (cover.isConnected) return start(); p.playing ? p.pause() : p.play(); };
  range.oninput = () => { cover.remove(); p.seek(range.value / 1000 * p.duration); };
}

// ---------- экзамен ----------
async function examPage(t) {
  const all = await tickets();
  const tk = all[t - 1];
  if (!tk) { location.hash = '#/'; return; }
  const answers = [];
  let i = 0, left = 20 * 60;
  const draw = () => {
    const q = tk.qs[i];
    view.innerHTML = `
    <div class="page"><div class="wrap" style="max-width:820px">
      <div class="exam-top"><div><div class="kicker">Экзамен · билет ${t}</div><div class="ex-dots" style="margin-top:8px">${tk.qs.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'cur' : ''}"></i>`).join('')}</div></div><div class="timer">${fmt(left)}</div></div>
      <div class="q-card">
        ${q.img ? `<div class="q-img"><img src="img/q/${q.img}" alt=""></div>` : ''}
        <div class="q-body">
          <div class="q-num"><span class="kicker">Вопрос ${i + 1} из 20</span></div>
          <h1 class="q-text">${esc(q.q)}</h1>
          <div class="answers">${q.a.map((a, k) => `<button class="ans" data-i="${k}"><i>${k + 1}</i><span>${esc(a)}</span></button>`).join('')}</div>
        </div>
      </div>
    </div></div>`;
    view.querySelectorAll('.ans').forEach(b => b.onclick = () => {
      answers[i] = +b.dataset.i;
      store.set(t, i + 1, answers[i] === q.c);
      i++;
      if (i < 20) draw(); else finish();
    });
  };
  const finish = (timeout) => {
    clearInterval(examTimer);
    const wrong = tk.qs.map((q, k) => ({ q, k })).filter(({ q, k }) => answers[k] !== q.c);
    const verdict = timeout ? ['Время вышло', 'bad'] : wrong.length === 0 ? ['Сдал!', 'ok'] : wrong.length <= 2 ? ['Почти', 'mid'] : ['Не сдал', 'bad'];
    view.innerHTML = `
    <div class="page"><div class="wrap" style="max-width:820px">
      <div class="result">
        <div class="kicker">Билет ${t} · ошибок: ${wrong.length}</div>
        <h1 class="h-xl"><span class="${verdict[1] === 'ok' ? 'plate' : 'outline'}">${verdict[0]}</span></h1>
        <p>${wrong.length === 0 ? 'Ноль ошибок. Так и на экзамене.' : wrong.length <= 2
          ? 'На настоящем экзамене за каждую ошибку дадут ещё 5 вопросов, и там уже без права на ошибку. Посмотри разборы ниже.'
          : 'Больше двух ошибок — экзамен не сдан. Разбери ошибки в 3D и попробуй ещё раз.'}</p>
        <div class="tk-actions" style="justify-content:center"><a class="btn btn-y" href="#/exam/${t}" onclick="setTimeout(()=>dispatchEvent(new HashChangeEvent('hashchange')))">Ещё раз</a>${t < 40 ? `<a class="btn btn-ghost" href="#/exam/${t + 1}">Билет ${t + 1}</a>` : ''}</div>
        <div class="mist">${wrong.map(({ q, k }) => `<a href="#/t/${t}/${k + 1}"><b>${k + 1}</b><span>${esc(q.q)}</span><em>Разбор →</em></a>`).join('')}</div>
      </div>
    </div></div>`;
  };
  draw();
  examTimer = setInterval(() => {
    left--;
    const el = view.querySelector('.timer');
    if (el) { el.textContent = fmt(left); el.classList.toggle('low', left < 120); }
    if (left <= 0) finish(true);
  }, 1000);
}
