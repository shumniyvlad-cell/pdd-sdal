// Модели: машины, транспорт, люди, знаки, светофор, стрелки, утка.
// Локально всё смотрит на -Z (rotation.y = 0 → едет на север).
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });
const glass = () => std(0x1d2a3a, { roughness: 0.15, metalness: 0.3 });

function shadowAll(g) {
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function rbox(w, h, d, r, material) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), material);
}

function wheel(r = 0.36, w = 0.26) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), std(0x1b1b1b, { roughness: 0.9 }));
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12), std(0xc8ccd2, { metalness: 0.6, roughness: 0.3 }));
  hub.rotation.z = Math.PI / 2;
  g.add(tire, hub);
  return g;
}

function lamp(color, w = 0.32, h = 0.14) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), std(color, { emissive: color, emissiveIntensity: 0.15 }));
}

export function car({ color = '#ffcc00', taxi = false, length = 4.3 } = {}) {
  const g = new THREE.Group();
  const paint = std(color, { roughness: 0.35, metalness: 0.15 });
  const body = rbox(1.85, 0.7, length, 0.18, paint);
  body.position.y = 0.62;
  const cabin = rbox(1.6, 0.62, length * 0.48, 0.2, paint);
  cabin.position.set(0, 1.22, length * 0.04);
  const win = rbox(1.64, 0.44, length * 0.44, 0.12, glass());
  win.position.set(0, 1.25, length * 0.04);
  g.add(body, cabin, win);
  const wz = length / 2 - 0.85;
  for (const [x, z] of [[-0.86, -wz], [0.86, -wz], [-0.86, wz], [0.86, wz]]) {
    const w = wheel(); w.position.set(x, 0.36, z); g.add(w);
  }
  // фары/фонари
  for (const sx of [-0.6, 0.6]) {
    const f = lamp(0xfff6d8); f.position.set(sx, 0.72, -length / 2 - 0.01); g.add(f);
    const b = lamp(0xd8262b); b.position.set(sx, 0.75, length / 2 + 0.01); g.add(b);
  }
  // поворотники: 4 угла
  const sig = {};
  for (const [k, x, z] of [['FL', -0.84, -length / 2], ['FR', 0.84, -length / 2], ['RL', -0.84, length / 2], ['RR', 0.84, length / 2]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.14), std(0xff9a1f, { emissive: 0xff8a00, emissiveIntensity: 0 }));
    s.position.set(x, 0.72, z);
    g.add(s); sig[k] = s;
  }
  if (taxi) {
    const t = rbox(0.6, 0.2, 0.3, 0.05, std(0xffffff, { emissive: 0xffe066, emissiveIntensity: 0.3 }));
    t.position.set(0, 1.62, 0.1); g.add(t);
    const chk = new THREE.Mesh(new THREE.BoxGeometry(1.87, 0.12, length * 0.7), std(0x111111));
    chk.position.set(0, 0.8, 0); chk.scale.set(1.002, 1, 1); g.add(chk);
  }
  g.userData.signals = sig;
  g.userData.length = length;
  return shadowAll(g);
}

export function truck({ color = '#e8e8e8', cab = '#d23b2b' } = {}) {
  const g = new THREE.Group();
  const c = rbox(2.4, 2.2, 2.2, 0.2, std(cab));
  c.position.set(0, 1.6, -4.2);
  const w = rbox(2.3, 0.8, 0.1, 0.05, glass()); w.position.set(0, 2.1, -5.31);
  const box = rbox(2.5, 2.8, 7.2, 0.1, std(color));
  box.position.set(0, 1.95, 0.6);
  g.add(c, w, box);
  for (const z of [-4.2, -0.6, 2.8]) for (const x of [-1.1, 1.1]) {
    const wh = wheel(0.5, 0.35); wh.position.set(x, 0.5, z); g.add(wh);
  }
  g.userData.signals = {};
  return shadowAll(g);
}

export function bus({ color = '#4caf50' } = {}) {
  const g = new THREE.Group();
  const b = rbox(2.5, 2.7, 11, 0.3, std(color));
  b.position.y = 1.75;
  const win = rbox(2.54, 0.9, 9.6, 0.1, glass()); win.position.set(0, 2.25, 0.2);
  const front = rbox(2.2, 1.5, 0.1, 0.05, glass()); front.position.set(0, 2.1, -5.52);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.3, 10.9), std(0xffffff));
  stripe.position.set(0, 1.25, 0);
  g.add(b, win, front, stripe);
  for (const z of [-3.6, 3.4]) for (const x of [-1.1, 1.1]) {
    const wh = wheel(0.5, 0.32); wh.position.set(x, 0.5, z); g.add(wh);
  }
  g.userData.signals = {};
  return shadowAll(g);
}

export function tram({ color = '#e8572a' } = {}) {
  const g = new THREE.Group();
  const p = std(color);
  for (const [z, len] of [[-4.2, 8.6], [4.6, 8.6]]) {
    const s = rbox(2.5, 2.9, len, 0.35, p); s.position.set(0, 1.85, z);
    const w = rbox(2.54, 1.0, len - 1.2, 0.1, glass()); w.position.set(0, 2.3, z);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.4, len - 0.4), std(0x333840));
    skirt.position.set(0, 0.55, z);
    g.add(s, w, skirt);
  }
  const front = rbox(2.2, 1.6, 0.1, 0.05, glass()); front.position.set(0, 2.3, -8.52); g.add(front);
  const pant = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 2.2), std(0x222222));
  pant.position.set(0, 3.9, -2); pant.rotation.x = 0.5; g.add(pant);
  g.userData.signals = {};
  return shadowAll(g);
}

export function person({ shirt = '#3a7bd5', pants = '#2b2f3a', skin = '#f1c7a5' } = {}) {
  const g = new THREE.Group();
  const legs = new THREE.Group();
  for (const x of [-0.13, 0.13]) {
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.62, 4, 8), std(pants));
    l.position.set(x, 0.42, 0); legs.add(l);
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 4, 10), std(shirt));
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), std(skin));
  head.position.y = 1.72;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x3b2a1e));
  hair.position.y = 1.75;
  g.add(legs, torso, head, hair);
  g.userData.legs = legs.children;
  return shadowAll(g);
}

export function bicycle({ shirt = '#e5484d' } = {}) {
  const g = new THREE.Group();
  const frame = std(0x2a6fdb, { metalness: 0.4 });
  for (const z of [-0.55, 0.55]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 24), std(0x1b1b1b));
    w.rotation.y = Math.PI / 2; w.position.set(0, 0.36, z); g.add(w);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), frame); bar.position.set(0, 0.7, 0); g.add(bar);
  const rider = person({ shirt });
  rider.scale.setScalar(0.92);
  rider.position.set(0, 0.25, 0.05);
  rider.children[0].children.forEach(l => { l.rotation.x = -0.9; l.position.z = -0.2; });
  g.add(rider);
  g.userData.signals = {};
  return shadowAll(g);
}

export function moto({ color = '#222', passenger = false } = {}) {
  const g = new THREE.Group();
  for (const z of [-0.75, 0.75]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 10, 24), std(0x151515));
    w.rotation.y = Math.PI / 2; w.position.set(0, 0.42, z); g.add(w);
  }
  const body = rbox(0.4, 0.45, 1.5, 0.12, std(color, { metalness: 0.3 })); body.position.set(0, 0.8, 0); g.add(body);
  const rider = person({ shirt: '#111' }); rider.position.set(0, 0.3, 0.1); g.add(rider);
  rider.children[0].children.forEach(l => { l.rotation.x = -1.1; l.position.z = -0.25; });
  if (passenger) {
    const p = person({ shirt: '#ff7a1a' }); p.position.set(0, 0.35, 0.65); g.add(p);
    p.children[0].children.forEach(l => { l.rotation.x = -1.1; l.position.z = -0.25; });
  }
  g.userData.signals = {};
  return shadowAll(g);
}

// ---------- знаки ----------
const texCache = new Map();
// у части SVG рядом со знаком нарисована подпись — берём только сам знак
const CROP = { '5.19.1': [0, 3, 85, 85], '5.19.2': [0, 3, 85, 85] };
function loadImageTexture(url, crop) {
  if (texCache.has(url)) return texCache.get(url);
  const p = new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const [sx, sy, sw, sh] = crop || [0, 0, img.naturalWidth || 100, img.naturalHeight || 100];
      const k = 512 / Math.max(sw, sh);
      c.width = Math.round(sw * k); c.height = Math.round(sh * k);
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      res({ tex: t, aspect: c.width / c.height });
    };
    img.onerror = () => res(null);
    img.src = url;
  });
  texCache.set(url, p);
  return p;
}

// Знаки с числом рисуем сами: 3.24:40, 4.6:50
function numberSign(code, num) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(256, 256, 250, 0, Math.PI * 2);
  if (code === '4.6') {
    x.fillStyle = '#fff'; x.fill();
    x.beginPath(); x.arc(256, 256, 236, 0, Math.PI * 2); x.fillStyle = '#1f5fbf'; x.fill();
    x.fillStyle = '#fff';
  } else {
    x.fillStyle = '#d42a2a'; x.fill();
    x.beginPath(); x.arc(256, 256, 190, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
    x.fillStyle = '#111';
  }
  x.font = `bold ${String(num).length > 2 ? 190 : 240}px Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(num), 256, 270);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: 1 };
}

function plateText(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 256);
  x.strokeStyle = '#111'; x.lineWidth = 14; x.strokeRect(10, 10, 492, 236);
  x.fillStyle = '#111'; x.font = 'bold 130px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: 2 };
}

async function signFace(code, base) {
  const m = /^(3\.24|4\.6):(\d+)$/.exec(code);
  if (m) return numberSign(m[1], m[2]);
  if (code.startsWith('txt:')) return plateText(code.slice(4));
  return loadImageTexture(`${base}img/signs/${code}.svg`, CROP[code]);
}

export async function sign({ codes = ['2.4'], size = 1.25, h = 2.3, overhead = false, span = 8, base = './' } = {}) {
  const g = new THREE.Group();
  const metal = std(0x9aa3ad, { metalness: 0.6, roughness: 0.35 });
  let y = h + size;
  const faces = [];
  for (const code of codes) {
    const f = await signFace(code, base);
    if (!f) continue;
    const w = f.aspect >= 1 ? size * Math.min(f.aspect, 2) : size * f.aspect;
    const hh = f.aspect >= 1 ? w / f.aspect : size;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshStandardMaterial({ map: f.tex, transparent: true, roughness: 0.5, side: THREE.DoubleSide }));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.98, hh * 0.98), std(0xb0b6bd, { side: THREE.DoubleSide }));
    back.position.z = -0.02; back.rotation.y = Math.PI;
    y -= hh / 2;
    face.position.set(0, y, 0.03); back.position.y = y;
    y -= hh / 2 + 0.06;
    faces.push(face, back);
  }
  const top = h + size + 0.1;
  if (overhead) {
    for (const x of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, top + 1.2, 10), metal);
      post.position.set(x, (top + 1.2) / 2, -0.15); g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.25, 0.25), metal);
    beam.position.set(0, top + 1.1, -0.15); g.add(beam);
    const holder = new THREE.Group();
    faces.forEach(f => { f.position.y += 1.2; holder.add(f); });
    g.add(holder);
    g.userData.face = holder;
  } else {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top, 10), metal);
    pole.position.set(0, top / 2, -0.08);
    g.add(pole, ...faces);
  }
  // знак смотрит на +Z (навстречу водителю, едущему на север)
  return shadowAll(g);
}

export function trafficLight({ h = 3.2 } = {}) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h, 10), std(0x3b4048));
  pole.position.y = h / 2;
  const box = rbox(0.5, 1.4, 0.4, 0.08, std(0x22262c));
  box.position.y = h + 0.6;
  g.add(pole, box);
  const lamps = {};
  for (const [k, col, y] of [['red', 0xff2a2a, 1.05], ['yellow', 0xffc400, 0.6], ['green', 0x1fe06b, 0.15]]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), std(col, { emissive: col, emissiveIntensity: 0 }));
    l.position.set(0, h + y, 0.2);
    g.add(l); lamps[k] = l;
  }
  g.userData.lamps = lamps;
  return shadowAll(g);
}

// ---------- стрелки по земле ----------
function smoothPath(pts, n = 120) {
  const v = pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
  if (v.length === 2) v.splice(1, 0, v[0].clone().lerp(v[1], 0.5));
  const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
  return curve.getSpacedPoints(n);
}

export function groundArrow({ path, color = '#22d36b', width = 0.9, y = 0.06, opacity = 0.95 }) {
  const g = new THREE.Group();
  const P = smoothPath(path);
  const pos = [], idx = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * width / 2, nz = dx / l * width / 2;
    pos.push(P[i].x + nx, y, P[i].z + nz, P[i].x - nx, y, P[i].z - nz);
    if (i < P.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity, depthWrite: false });
  const ribbon = new THREE.Mesh(geo, m);
  ribbon.renderOrder = 2;
  // наконечник: конус вдоль +Y кладём на -Z и поворачиваем по касательной
  const head = new THREE.Mesh(new THREE.ConeGeometry(width * 1.1, width * 2, 3), m);
  head.rotation.x = -Math.PI / 2;
  head.scale.set(1, 1, 0.05);
  const last = P[P.length - 1], prev = P[P.length - 3];
  const hp = new THREE.Group(); hp.add(head);
  hp.position.set(last.x, y, last.z);
  hp.rotation.y = Math.atan2(-(last.x - prev.x), -(last.z - prev.z));
  g.add(ribbon, hp);
  g.userData.arrow = { ribbon, head: hp, total: idx.length, P };
  return g;
}

// ---------- метки-буквы (спрайты) ----------
export function label({ text = 'А', bg = '#ffd21f', fg = '#111', size = 1.6 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(128, 128, 118, 0, Math.PI * 2); x.fillStyle = bg; x.fill();
  x.lineWidth = 12; x.strokeStyle = '#111'; x.stroke();
  x.fillStyle = fg; x.font = `900 ${text.length > 2 ? 70 : 140}px "Fira Sans Extra Condensed", Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 138);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.setScalar(size); s.renderOrder = 10;
  return s;
}

export function tag({ text = '5 м', bg = '#111', fg = '#ffd21f', h = 0.9 } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.font = '900 100px "Fira Sans Extra Condensed", Arial, sans-serif';
  const w = Math.min(500, x.measureText(text).width + 70);
  c.width = Math.ceil(w);
  const y = c.getContext('2d');
  y.fillStyle = bg; y.beginPath(); y.roundRect(0, 0, c.width, 160, 40); y.fill();
  y.fillStyle = fg; y.font = '900 100px "Fira Sans Extra Condensed", Arial, sans-serif';
  y.textAlign = 'center'; y.textBaseline = 'middle'; y.fillText(text, c.width / 2, 86);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(h * c.width / 160, h, 1); s.renderOrder = 11;
  return s;
}

// размер на земле: линия со стрелками + подпись
export function measure({ from, to, text, color = '#ffd21f' }) {
  const g = new THREE.Group();
  const a = new THREE.Vector3(from[0], 0.08, from[1]), b = new THREE.Vector3(to[0], 0.08, to[1]);
  const len = a.distanceTo(b);
  const m = new THREE.MeshBasicMaterial({ color, depthWrite: false });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, len), m);
  bar.position.copy(a).lerp(b, 0.5);
  bar.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  g.add(bar);
  for (const [p, q] of [[a, b], [b, a]]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 3), m);
    c.position.copy(p);
    c.rotation.set(Math.PI / 2, 0, 0);
    const holder = new THREE.Group(); holder.position.copy(p); c.position.set(0, 0, 0);
    holder.rotation.y = Math.atan2(p.x - q.x, p.z - q.z);
    holder.add(c); g.add(holder);
  }
  const t = tag({ text, bg: '#111', fg: color, h: 1.0 });
  t.position.copy(a).lerp(b, 0.5); t.position.y = 1.2;
  g.add(t);
  return g;
}

// подсветка: пульсирующее кольцо под объектом
export function ring({ r = 3, color = '#ffd21f' } = {}) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.08; m.renderOrder = 3;
  return m;
}

export function cross({ size = 2.2 } = {}) {
  return label({ text: '✕', bg: '#ff3b30', fg: '#fff', size });
}

export function check({ size = 2.2 } = {}) {
  return label({ text: '✓', bg: '#22d36b', fg: '#fff', size });
}

export function smoke() {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.7, roughness: 1 }));
    s.userData.phase = i / 7;
    g.add(s);
  }
  g.userData.smoke = true;
  return g;
}

export function warnTriangle() {
  const g = new THREE.Group();
  const sh = new THREE.Shape(); sh.moveTo(-0.35, 0); sh.lineTo(0.35, 0); sh.lineTo(0, 0.6); sh.lineTo(-0.35, 0);
  const hole = new THREE.Path(); hole.moveTo(-0.2, 0.08); hole.lineTo(0.2, 0.08); hole.lineTo(0, 0.42); hole.lineTo(-0.2, 0.08);
  sh.holes.push(hole);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), std(0xff2a2a, { emissive: 0xff2a2a, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
  m.position.y = 0.05;
  g.add(m);
  return shadowAll(g);
}

export function cone() {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 14), std(0xff6a00));
  m.position.y = 0.35;
  const g = new THREE.Group(); g.add(m);
  return shadowAll(g);
}

export function ball() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), std(0xff3b6b));
  m.position.y = 0.3;
  const g = new THREE.Group(); g.add(m);
  return shadowAll(g);
}

// ---------- УТКА ПДД: жёлтая, в фуражке и тёмных очках ----------
export function duck({ scale = 1 } = {}) {
  const g = new THREE.Group();
  const yellow = std(0xffd21f, { roughness: 0.45 });
  const orange = std(0xff8a1c, { roughness: 0.5 });
  const navy = std(0x1b2433, { roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.58, 28, 22), yellow);
  body.scale.set(1, 0.92, 1.08); body.position.y = 0.66;
  // грудь светлее + значок
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), std(0xffe98a, { roughness: 0.5 }));
  chest.scale.set(0.95, 0.85, 0.6); chest.position.set(0, 0.62, -0.32);
  const star = new THREE.Mesh(new THREE.CircleGeometry(0.09, 5), std(0xf2c230, { metalness: 0.8, roughness: 0.25, emissive: 0x6a4a00 }));
  star.position.set(-0.17, 0.8, -0.56); star.rotation.y = Math.PI + 0.3; star.rotation.z = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 12), yellow);
  tail.position.set(0, 0.85, 0.62); tail.rotation.x = -1.1;
  const head = new THREE.Group(); head.position.y = 1.4;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 22), yellow);
  const beakU = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), orange);
  beakU.scale.set(1.35, 0.4, 1.3); beakU.position.set(0, -0.08, -0.46);
  const beakL = beakU.clone(); beakL.scale.set(1.2, 0.32, 1.15); beakL.position.set(0, -0.15, -0.42);
  const glasses = new THREE.Group();
  for (const x of [-0.16, 0.16]) {
    const lens = rbox(0.26, 0.15, 0.06, 0.05, std(0x0a0a0a, { roughness: 0.1, metalness: 0.6 }));
    lens.position.set(x * 1.1, 0.08, -0.44); lens.rotation.y = x > 0 ? -0.25 : 0.25; glasses.add(lens);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), std(0x0a0a0a)); bridge.position.set(0, 0.11, -0.48); glasses.add(bridge);
  // фуражка
  const cap = new THREE.Group(); cap.position.y = 0.36;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.24, 28), navy); crown.position.y = 0.06;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.42, 0.06, 28), navy); top.position.y = 0.2;
  const bandC = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.08, 28), std(0xc81e2b)); bandC.position.y = -0.03;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24, 1, false, Math.PI / 2, Math.PI), std(0x0a0a0a, { roughness: 0.2 }));
  brim.position.set(0, -0.06, -0.26); brim.rotation.x = 0.15;
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), std(0xf2c230, { metalness: 0.8, roughness: 0.25, emissive: 0x6a4a00 }));
  badge.position.set(0, 0.07, -0.4); badge.rotation.y = Math.PI;
  cap.add(crown, top, bandC, brim, badge);
  head.add(skull, beakU, beakL, glasses, cap);
  const wings = [];
  for (const sx of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(0.54 * sx, 0.88, 0);
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), yellow);
    w.scale.set(0.35, 0.9, 0.7); w.position.set(0.06 * sx, -0.22, 0);
    piv.add(w); g.add(piv); wings.push(piv);
  }
  for (const sx of [-0.22, 0.22]) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), orange);
    f.scale.set(1, 0.3, 1.5); f.position.set(sx, 0.05, -0.12); g.add(f);
  }
  g.add(body, chest, star, tail, head);
  g.scale.setScalar(scale);
  g.userData.duck = { head, wings, beakL };
  return shadowAll(g);
}
