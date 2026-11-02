// Плеер разбора: строит 3D-сцену из JSON и проигрывает её по таймингу озвучки.
// Всё состояние — чистая функция от времени t, поэтому тот же плеер
// рендерит видео покадрово (pipeline/render.mjs зовёт window.__seek).
import * as THREE from 'three';
import { buildSet } from './world.js';
import * as P from './props.js';

const DIR = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2 };
const FACE = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
const clamp01 = v => Math.max(0, Math.min(1, v));
const EASE = {
  linear: u => u,
  in: u => u * u,
  out: u => 1 - (1 - u) * (1 - u),
  inout: u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
};
const backOut = u => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const ang = v => (typeof v === 'number' ? v * Math.PI / 180 : DIR[v] ?? 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Оценка таймингов, если озвучки ещё нет: ~2.7 слова в секунду
export function estimateTiming(lines) {
  let t = 0.3;
  return {
    audio: null,
    lines: lines.map(text => {
      const words = text.split(/\s+/).filter(Boolean).map(w => {
        const d = Math.max(0.22, w.length * 0.065);
        const o = { w, s: t, e: t + d }; t += d + 0.05; return o;
      });
      const line = { text, start: words[0]?.s ?? t, end: t, words };
      t += 0.35;
      return line;
    }),
    get duration() { return t; },
  };
}

export class Player {
  constructor(el, { aspect = '16:9', base = './' } = {}) {
    this.el = el;
    this.base = base;
    this.aspect = aspect;
    this.t = 0;
    this.playing = false;
    this.listeners = [];
    el.classList.add('pl', aspect === '9:16' ? 'pl-v' : 'pl-h');
    el.innerHTML = `
      <div class="pl-stage"><canvas></canvas>
        <div class="pl-ov">
          <div class="ov-chip"></div>
          <div class="ov-q"><div class="ov-q-badge"></div><div class="ov-q-text"></div><ol class="ov-q-ans"></ol></div>
          <div class="ov-big"></div>
          <div class="ov-card"><div class="ov-card-title"></div><ul></ul></div>
          <div class="ov-fishka"><b>ФИШКА</b><span></span></div>
          <div class="ov-sub"></div>
        </div>
      </div>`;
    this.canvas = el.querySelector('canvas');
    this.ov = {
      chip: el.querySelector('.ov-chip'), q: el.querySelector('.ov-q'), big: el.querySelector('.ov-big'),
      card: el.querySelector('.ov-card'), fishka: el.querySelector('.ov-fishka'), sub: el.querySelector('.ov-sub'),
    };
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(aspect === '9:16' ? 68 : 48, 16 / 9, 0.1, 900);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
  }

  resize() {
    const r = this.el.querySelector('.pl-stage').getBoundingClientRect();
    if (!r.width) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.el.style.setProperty('--u', (Math.min(r.width, r.height * (this.aspect === '9:16' ? 0.5625 : 1.7778)) / 100) + 'px');
    this.draw();
  }

  async load(scene, timing, meta = {}) {
    this.sceneDef = scene;
    this.timing = timing;
    this.meta = meta;
    this.duration = (timing.duration || timing.lines.at(-1).end) + (scene.tail ?? 1.6);
    const s = this.scene = new THREE.Scene();
    const studio = scene.set === 'studio';
    s.background = new THREE.Color(studio ? 0xbfe0ff : 0x9fd3ff);
    s.fog = new THREE.Fog(studio ? 0xd6ebff : 0xc9e6ff, studio ? 50 : 90, studio ? 160 : 320);
    s.add(new THREE.HemisphereLight(0xdff1ff, 0x5c7a3a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(-40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 220 });
    sun.shadow.bias = -0.0004;
    s.add(sun, sun.target);
    this.sun = sun;
    this.world = buildSet(scene.set, scene.opts || {});
    s.add(this.world);
    this.floorY = this.world.userData.floorY || 0;

    // объекты
    this.objs = {};
    for (const d of scene.props || []) {
      const o = await this.makeProp(d);
      if (!o) continue;
      o.userData.def = d;
      const lifted = d.type === 'label' || d.type === 'tag';
      if (d.at) o.position.set(d.at[0], lifted ? this.floorY + (d.y ?? 3) : this.floorY + (d.y ?? 0), d.at[1]);
      if (d.type === 'sign') o.rotation.y = FACE[d.face || 's'] ?? ang(d.face);
      else if (d.dir !== undefined) o.rotation.y = ang(d.dir);
      o.userData.base = { pos: o.position.clone(), rot: o.rotation.y, visible: !d.hidden };
      this.objs[d.id] = o;
      s.add(o);
    }

    // разбор таймлайна
    this.beats = (scene.beats || []).map((b, i) => {
      const t0 = this.time(b.at);
      // until: длительность до метки ("L3", "L2+1.5")
      return { ...b, i, t0, ...(b.until !== undefined ? { dur: Math.max(0.1, this.time(b.until) - t0) } : {}) };
    }).sort((a, b) => a.t0 - b.t0 || a.i - b.i);
    this.moves = {};
    for (const b of this.beats.filter(b => b.do === 'move')) (this.moves[b.id] ||= []).push(b);
    for (const [id, list] of Object.entries(this.moves)) {
      const o = this.objs[id]; if (!o) continue;
      let cur = new THREE.Vector3(o.userData.base.pos.x, 0, o.userData.base.pos.z);
      for (const m of list) {
        const pts = [cur.clone(), ...m.path.map(([x, z]) => new THREE.Vector3(x, 0, z))];
        if (pts.length === 2) pts.splice(1, 0, pts[0].clone().lerp(pts[1], 0.5));
        m.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        m.dur = m.dur ?? 3;
        cur = pts.at(-1);
      }
    }
    // кольца и метки создаются под биты
    for (const b of this.beats) {
      if (b.do === 'pulse') { b.obj = P.ring({ r: b.r || 3, color: b.color || '#ffd21f' }); s.add(b.obj); }
      if (b.do === 'mark') { b.obj = b.kind === 'check' ? P.check({}) : P.cross({}); s.add(b.obj); }
    }
    this.duck = Object.values(this.objs).find(o => o.userData.duck);
    this.buildOverlay();
    this.resize();
    this.seek(0);
  }

  async makeProp(d) {
    switch (d.type) {
      case 'car': return P.car({ color: d.color, taxi: d.taxi, length: d.length });
      case 'truck': return P.truck(d);
      case 'bus': return P.bus(d);
      case 'tram': return P.tram(d);
      case 'ped': return P.person(d);
      case 'bike': return P.bicycle(d);
      case 'moto': return P.moto(d);
      case 'sign': return P.sign({ ...d, base: this.base });
      case 'light': return P.trafficLight(d);
      case 'arrow': return P.groundArrow(d);
      case 'label': return P.label(d);
      case 'tag': return P.tag({ ...d, h: d.size });
      case 'measure': return P.measure(d);
      case 'smoke': return P.smoke();
      case 'triangle': return P.warnTriangle();
      case 'cone': return P.cone();
      case 'ball': return P.ball();
      case 'duck': return P.duck(d);
      default: return null;
    }
  }

  // "L3" — начало 3-й фразы, "L3e" — конец, "L3+1.2", "end-2", число — секунды
  time(at) {
    if (typeof at === 'number') return at;
    if (!at) return 0;
    const m = /^(L(\d+)(e?)|end)([+-][\d.]+)?$/.exec(String(at).trim());
    if (!m) return 0;
    let t;
    if (m[1] === 'end') t = this.duration;
    else {
      const line = this.timing.lines[Math.min(+m[2], this.timing.lines.length) - 1];
      t = m[3] ? line.end : line.start;
    }
    return t + (m[4] ? parseFloat(m[4]) : 0);
  }

  buildOverlay() {
    const m = this.meta;
    this.ov.chip.textContent = m.ticket ? `БИЛЕТ ${m.ticket} · ВОПРОС ${m.q}` : '';
    this.ov.q.querySelector('.ov-q-badge').textContent = m.ticket ? `БИЛЕТ ${m.ticket} · ВОПРОС ${m.q}` : '';
    this.ov.q.querySelector('.ov-q-text').textContent = m.question || '';
    const len = (m.question || '').length + (m.answers || []).join('').length;
    this.ov.q.classList.toggle('long', len > 230);
    this.ov.q.classList.toggle('xlong', len > 380);
    this.ov.q.querySelector('.ov-q-ans').innerHTML = (m.answers || []).map((a, i) => `<li data-i="${i}">${esc(a)}</li>`).join('');
    // субтитры: куски по 4–5 слов
    this.chunks = [];
    const weak = /^(не|ни|и|а|в|во|на|по|с|со|к|ко|у|о|об|за|до|из|от|что|как|но|же|ли|бы)$/i;
    this.timing.lines.forEach((ln, li) => {
      const ws = ln.words;
      let i = 0;
      while (i < ws.length) {
        let n = Math.min(5, ws.length - i);
        if (ws.length - (i + n) === 1) n += 1;               // не оставляем одно слово в хвосте
        while (n > 2 && i + n < ws.length && weak.test(ws[i + n - 1].w.replace(/[^\p{L}]/gu, ''))) n -= 1;
        const part = ws.slice(i, i + n);
        this.chunks.push({ li, words: part, s: part[0].s, e: part.at(-1).e });
        i += n;
      }
    });
    this.lastChunk = -1;
  }

  // ---------- время ----------
  on(fn) { this.listeners.push(fn); }

  play() {
    if (this.playing) return;
    if (this.t >= this.duration - 0.05) this.t = 0;
    this.playing = true;
    const a = this.audio;
    if (a) { a.currentTime = this.t; a.play().catch(() => {}); }
    let last = performance.now();
    const tick = now => {
      if (!this.playing) return;
      const dt = (now - last) / 1000; last = now;
      if (a && !a.paused && !a.ended && a.currentTime < (a.duration || 1e9) - 0.02) this.t = a.currentTime;
      else this.t += dt;
      if (this.t >= this.duration) { this.t = this.duration; this.pause(); }
      this.seek(this.t, true);
      if (this.playing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    this.audio?.pause();
    this.listeners.forEach(f => f(this.t, false));
  }

  setAudio(url) {
    this.audio = url ? new Audio(url) : null;
    if (this.audio) this.audio.preload = 'auto';
  }

  seek(t, fromTick = false) {
    this.t = Math.max(0, Math.min(t, this.duration));
    if (!fromTick && this.audio && this.playing) this.audio.currentTime = this.t;
    this.apply(this.t);
    this.draw();
    this.listeners.forEach(f => f(this.t, this.playing));
  }

  draw() { if (this.scene) this.renderer.render(this.scene, this.camera); }

  // ---------- состояние сцены в момент t ----------
  apply(t) {
    const before = b => b.t0 <= t;
    // базовое состояние
    for (const o of Object.values(this.objs)) {
      const b = o.userData.base;
      o.position.copy(b.pos); o.rotation.y = b.rot; o.visible = b.visible; o.scale.setScalar(o.userData.def.scale || 1);
      if (o.userData.duck) o.scale.setScalar(o.userData.def.scale || 1);
    }
    // движения
    for (const [id, list] of Object.entries(this.moves)) {
      const o = this.objs[id]; if (!o) continue;
      for (const m of list) {
        if (t < m.t0) break;
        const u = (EASE[m.ease || 'inout'] || EASE.inout)(clamp01((t - m.t0) / m.dur));
        const p = m.curve.getPointAt(u);
        o.position.x = p.x; o.position.z = p.z;
        if (!m.keepDir && !o.userData.duck) {
          const tg = m.curve.getTangentAt(Math.min(u, 0.999));
          if (Math.hypot(tg.x, tg.z) > 1e-4) o.rotation.y = Math.atan2(-tg.x, -tg.z) + (m.reverse ? Math.PI : 0);
        }
        // шаг у пешеходов
        if (o.userData.legs && u > 0 && u < 1) o.userData.legs.forEach((l, k) => { l.rotation.x = Math.sin(t * 9 + k * Math.PI) * 0.5; });
      }
    }
    // повороты на месте (занос, разворот модели): {do:'turn', id, deg, dur}
    for (const b of this.beats) {
      if (b.do !== 'turn' || t < b.t0) continue;
      const o = this.objs[b.id]; if (!o) continue;
      o.rotation.y += (b.deg * Math.PI / 180) * EASE[b.ease || 'out'](clamp01((t - b.t0) / (b.dur ?? 1)));
    }
    // показать/скрыть + появление с пружинкой
    for (const b of this.beats) {
      if (!before(b)) continue;
      const o = this.objs[b.id];
      if (!o) continue;
      if (b.do === 'show' || b.do === 'draw') {
        o.visible = true;
        const u = clamp01((t - b.t0) / 0.4);
        if (b.do === 'show' && !o.isSprite) o.scale.setScalar((o.userData.def.scale || 1) * Math.max(0.001, backOut(u)));
        if (b.do === 'show' && o.isSprite) o.material.opacity = u;
      }
      if (b.do === 'hide') o.visible = false;
    }
    // стрелки: прорисовка
    for (const o of Object.values(this.objs)) {
      const a = o.userData.arrow; if (!a) continue;
      const db = this.beats.find(b => b.do === 'draw' && b.id === o.userData.def.id);
      let k = 1;
      if (db) { k = clamp01((t - db.t0) / (db.dur || 1.2)); if (t < db.t0) o.visible = false; }
      const tri = Math.floor(a.total / 3 * k) * 3;
      a.ribbon.geometry.setDrawRange(0, tri);
      a.head.visible = k > 0.97;
    }
    // поворотники
    for (const o of Object.values(this.objs)) {
      const sig = o.userData.signals; if (!sig) continue;
      const last = this.beats.filter(b => b.do === 'signal' && b.id === o.userData.def.id && before(b)).at(-1);
      const side = last?.side || 'off';
      const on = Math.floor((t - (last?.t0 || 0)) * 3) % 2 === 0;
      for (const [k, m] of Object.entries(sig)) {
        const L = k.endsWith('L'), R = k.endsWith('R');
        const lit = on && (side === 'hazard' || (side === 'left' && L) || (side === 'right' && R));
        m.material.emissiveIntensity = lit ? 3 : 0;
      }
    }
    // светофоры
    for (const o of Object.values(this.objs)) {
      const lamps = o.userData.lamps; if (!lamps) continue;
      const last = this.beats.filter(b => b.do === 'light' && b.id === o.userData.def.id && before(b)).at(-1);
      const st = last?.state || o.userData.def.state || 'green';
      const blinkOn = Math.floor(t * 2.5) % 2 === 0;
      lamps.red.material.emissiveIntensity = st === 'red' || st === 'red-yellow' ? 2.5 : 0;
      lamps.yellow.material.emissiveIntensity = st === 'yellow' || st === 'red-yellow' ? 2.5 : 0;
      lamps.green.material.emissiveIntensity = st === 'green' || (st === 'green-blink' && blinkOn) ? 2.5 : 0;
    }
    // дым
    for (const o of Object.values(this.objs)) {
      if (!o.userData.smoke) continue;
      const on = this.beats.find(b => b.do === 'smoke' && b.id === o.userData.def.id);
      o.visible = on ? t >= on.t0 : o.visible;
      o.children.forEach(s => {
        const ph = (t * 0.6 + s.userData.phase) % 1;
        s.position.set(Math.sin(ph * 9) * 0.3, 0.8 + ph * 3.2, Math.cos(ph * 7) * 0.3);
        s.scale.setScalar(0.5 + ph * 1.6);
        s.material.opacity = 0.75 * (1 - ph);
      });
    }
    // кольца и метки следуют за целью
    for (const b of this.beats) {
      if (!b.obj) continue;
      const dur = b.dur ?? (b.do === 'pulse' ? 3 : 1e9);
      const on = t >= b.t0 && t < b.t0 + dur;
      b.obj.visible = on;
      if (!on) continue;
      const tgt = this.objs[b.id];
      const p = tgt ? tgt.position : new THREE.Vector3(b.point?.[0] || 0, 0, b.point?.[1] || 0);
      const u = clamp01((t - b.t0) / 0.35);
      if (b.do === 'pulse') {
        b.obj.position.set(p.x, this.floorY + 0.08, p.z);
        b.obj.scale.setScalar(Math.max(0.01, backOut(u)) * (1 + 0.08 * Math.sin(t * 7)));
      } else {
        b.obj.position.set(p.x + (b.dx || 0), p.y + (b.y ?? 3.6), p.z);
        b.obj.scale.setScalar(Math.max(0.01, backOut(u)) * (b.size || 2.2));
      }
    }
    this.applyCamera(t);
    this.applyDuck(t);
    this.applyOverlay(t);
    // тень ходит за камерой
    const c = this.camTarget || new THREE.Vector3();
    this.sun.position.set(c.x - 40, 70, c.z + 30);
    this.sun.target.position.set(c.x, 0, c.z);
  }

  targetOf(b) {
    if (Array.isArray(b.target)) return { pos: new THREE.Vector3(b.target[0], this.floorY, b.target[1]), rot: ang(b.dir ?? 'n') };
    const o = this.objs[b.target || 'me'] || this.duck;
    if (!o) return { pos: new THREE.Vector3(), rot: 0 };
    return { pos: o.position.clone(), rot: b.dir !== undefined ? ang(b.dir) : o.rotation.y };
  }

  shot(b, t) {
    const { pos: T, rot } = this.targetOf(b);
    const fwd = new THREE.Vector3(-Math.sin(rot), 0, -Math.cos(rot));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const up = new THREE.Vector3(0, 1, 0);
    const z = b.zoom || 1;
    const V = (f, r, u) => T.clone().addScaledVector(fwd, f * z).addScaledVector(right, r * z).addScaledVector(up, u * z);
    switch (b.shot) {
      case 'driver': return { pos: T.clone().addScaledVector(fwd, 0.4).addScaledVector(up, 1.5).addScaledVector(right, -0.3), look: T.clone().addScaledVector(fwd, 25).addScaledVector(up, 0.6) };
      case 'chase': return { pos: V(-9, 0, 4.2), look: V(9, 0, 0.5) };
      case 'hero': return { pos: V(-13, 9, 11), look: V(5, 0, 0) };
      case 'top': return { pos: V(-9, 0, 40), look: V(3, 0, 0) };
      case 'side': return { pos: V(0, 15, 4), look: V(0, 0, 0.8) };
      case 'front': return { pos: V(13, 0, 3.5), look: V(0, 0, 1) };
      case 'orbit': {
        const a = (b.angle || 0) * Math.PI / 180 + (t - b.t0) * (b.speed ?? 0.12);
        const R = 16 * z;
        return { pos: T.clone().add(new THREE.Vector3(Math.sin(a) * R, 9 * z, Math.cos(a) * R)), look: T.clone().addScaledVector(up, 0.5) };
      }
      case 'duck': {
        const d = this.duck ? this.duck.position : T;
        return { pos: d.clone().add(new THREE.Vector3(1.4 * z, 1.9 * z, 4.6 * z)), look: d.clone().add(new THREE.Vector3(0, 1.3, 0)) };
      }
      default:
        return {
          pos: new THREE.Vector3(...(b.pos || [20, 20, 20])),
          look: new THREE.Vector3(...(b.look || [0, 0, 0])),
        };
    }
  }

  applyCamera(t) {
    const cams = this.beats.filter(b => b.do === 'cam');
    if (!cams.length) cams.push({ do: 'cam', shot: 'hero', t0: 0 });
    let i = cams.findLastIndex(b => b.t0 <= t);
    if (i < 0) i = 0;
    const cur = this.shot(cams[i], t);
    let pos = cur.pos, look = cur.look;
    const d = cams[i].dur ?? 1.3;
    if (i > 0 && t < cams[i].t0 + d && !cams[i].cut) {
      const prev = this.shot(cams[i - 1], t);
      const u = EASE.inout(clamp01((t - cams[i].t0) / d));
      pos = prev.pos.lerp(cur.pos, u);
      look = prev.look.lerp(cur.look, u);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    // вид из-за руля: свою машину не рисуем, как на экзаменационной картинке
    const drv = cams[i].shot === 'driver' && (t >= cams[i].t0 + d * 0.6 || cams[i].cut);
    const me = this.objs[cams[i].target || 'me'];
    if (me && drv) me.visible = false;
    this.camTarget = look;
  }

  applyDuck(t) {
    const d = this.duck; if (!d) return;
    const { head, wings, beakL } = d.userData.duck;
    // утка всегда разворачивается к камере
    d.rotation.y = Math.atan2(-(this.camera.position.x - d.position.x), -(this.camera.position.z - d.position.z));
    const pose = this.beats.filter(b => b.do === 'duck' && b.t0 <= t).at(-1);
    const pt = pose ? t - pose.t0 : 0;
    const active = pose && pt < (pose.dur ?? 2.5);
    const kind = active ? pose.pose : 'idle';
    d.position.y = d.userData.base.pos.y + Math.abs(Math.sin(t * 2.2)) * 0.05 + (kind === 'jump' ? Math.abs(Math.sin(pt * 6)) * 0.8 : 0);
    head.rotation.z = Math.sin(t * 1.7) * 0.08;
    head.rotation.x = 0;
    wings[0].rotation.set(0, 0, 0); wings[1].rotation.set(0, 0, 0);
    if (kind === 'wave') wings[1].rotation.z = 2.3 + Math.sin(pt * 10) * 0.4;
    if (kind === 'point') { wings[1].rotation.z = 1.4; wings[1].rotation.y = -0.6; }
    if (kind === 'shrug') { wings[0].rotation.z = -1.2; wings[1].rotation.z = 1.2; head.rotation.z = 0.2; }
    if (kind === 'no') head.rotation.y = Math.sin(pt * 12) * 0.5;
    if (kind === 'yes') head.rotation.x = Math.sin(pt * 12) * 0.25;
    // клюв: говорит, пока звучит слово
    let talking = false;
    for (const ln of this.timing.lines) {
      if (t < ln.start || t > ln.end) continue;
      talking = ln.words.some(w => t >= w.s && t <= w.e);
    }
    beakL.rotation.x = talking ? Math.abs(Math.sin(t * 22)) * 0.35 : 0;
  }

  // ---------- оверлей ----------
  applyOverlay(t) {
    const o = this.ov, L1 = this.timing.lines[0];
    const fade = (el, on, u = 1) => { el.style.opacity = on ? u : 0; el.style.visibility = on ? 'visible' : 'hidden'; };
    // карточка вопроса в первой фразе и на бите answer
    const ans = this.beats.find(b => b.do === 'answer');
    const qEnd = this.sceneDef.questionUntil ? this.time(this.sceneDef.questionUntil) : (L1 ? L1.end + 0.6 : 3);
    const ansOn = ans && t >= ans.t0 && t < ans.t0 + (ans.dur ?? 3.2);
    const showQ = t < qEnd || ansOn;
    const qa = t < qEnd ? Math.min(1, (qEnd - t) / 0.3, t / 0.25 + 0.3)
      : ansOn ? Math.min(clamp01((t - ans.t0) / 0.3), clamp01((ans.t0 + (ans.dur ?? 3.2) - t) / 0.3)) : 0;
    fade(o.q, showQ, qa);
    o.q.classList.toggle('reveal', !!(ans && t >= ans.t0));
    o.q.querySelectorAll('li').forEach(li => li.classList.toggle('ok', ans && t >= ans.t0 && +li.dataset.i === this.meta.correct));
    fade(o.chip, !showQ && !!this.meta.ticket);
    // большой текст
    const big = this.beats.filter(b => b.do === 'big' && t >= b.t0 && t < b.t0 + (b.dur ?? 2.2)).at(-1);
    fade(o.big, !!big, big ? clamp01((t - big.t0) / 0.2) : 0);
    if (big) {
      if (o.big.dataset.k !== String(big.i)) { o.big.textContent = big.text; o.big.className = 'ov-big ' + (big.style || 'info'); o.big.dataset.k = big.i; }
      o.big.style.transform = `translate(-50%,-50%) scale(${0.6 + 0.4 * backOut(clamp01((t - big.t0) / 0.35))})`;
    }
    // карточка-список
    const card = this.beats.filter(b => b.do === 'card' && t >= b.t0 && t < b.t0 + (b.dur ?? 4)).at(-1);
    fade(o.card, !!card, card ? clamp01((t - card.t0) / 0.25) : 0);
    if (card) {
      if (o.card.dataset.k !== String(card.i)) {
        o.card.querySelector('.ov-card-title').textContent = card.title || '';
        o.card.querySelector('ul').innerHTML = card.items.map(it => `<li data-ok="${it.ok === undefined ? '' : it.ok}" data-at="${it.at ?? ''}">${it.t}</li>`).join('');
        o.card.dataset.k = card.i;
      }
      o.card.querySelectorAll('li').forEach(li => {
        const at = li.dataset.at === '' ? card.t0 : this.time(isNaN(+li.dataset.at) ? li.dataset.at : +li.dataset.at);
        li.classList.toggle('in', t >= at);
        li.classList.toggle('mark', t >= at + 0.6);
      });
    }
    // фишка — на фразе из scene.fishkaLine (по умолчанию последняя)
    const fl = this.sceneDef.fishka ? (this.sceneDef.fishkaLine || this.timing.lines.length) : 0;
    const flL = fl ? this.timing.lines[fl - 1] : null;
    const fStart = flL ? Math.max(flL.start - 0.2, ans ? ans.t0 + (ans.dur ?? 3.2) : 0) : 0;
    const showF = flL && t >= fStart;
    fade(o.fishka, showF, showF ? clamp01((t - fStart) / 0.3) : 0);
    if (showF) fade(o.chip, false);
    if (showF) o.fishka.querySelector('span').textContent = this.sceneDef.fishka;
    // субтитры
    const ci = this.chunks.findIndex(c => t >= c.s - 0.05 && t <= c.e + 0.25);
    if (ci !== this.lastChunk) {
      o.sub.innerHTML = ci < 0 ? '' : this.chunks[ci].words.map(w => `<span>${w.w}</span>`).join(' ');
      this.lastChunk = ci;
    }
    if (ci >= 0) {
      const spans = o.sub.children;
      this.chunks[ci].words.forEach((w, k) => spans[k]?.classList.toggle('hot', t >= w.s && t <= w.e + 0.08));
    }
    fade(o.sub, ci >= 0);
  }

  dispose() {
    this.pause();
    this.ro.disconnect();
    this.renderer.dispose();
  }
}
