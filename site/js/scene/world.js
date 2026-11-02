// Сеты сцен: перекрёсток, прямая дорога, студия.
// Мир в метрах, Y вверх, север = -Z. Правостороннее движение:
// машина, едущая на север, держится x > 0.
import * as THREE from 'three';

export const LW = 3.5; // ширина полосы

const C = {
  asphalt: 0x3a3f47, dirt: 0x9a7b55, mark: 0xf4f4f0, curb: 0xc9c4b8,
  walk: 0xb9b3a6, grass: 0x6fbf4a, grassDark: 0x5aa83c, rail: 0x8d949c,
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });

function plane(w, d, color, y = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

// Разметка: плоская полоса от (x1,z1) до (x2,z2)
function stripe(g, x1, z1, x2, z2, w = 0.15, color = C.mark) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = plane(w, len, color, 0.012);
  m.position.x = (x1 + x2) / 2;
  m.position.z = (z1 + z2) / 2;
  m.rotation.z = -Math.atan2(x2 - x1, z2 - z1);
  m.material.roughness = 0.6;
  g.add(m);
}

function dashed(g, x1, z1, x2, z2, dash = 3, gap = 6, w = 0.15) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(s + dash, len);
    stripe(g, x1 + ux * s, z1 + uz * s, x1 + ux * e, z1 + uz * e, w);
  }
}

function windowsTexture(base) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 128, 256);
  for (let r = 0; r < 8; r++) for (let k = 0; k < 4; k++) {
    x.fillStyle = (r * 7 + k * 3) % 5 === 0 ? '#ffe9a8' : '#5d7ea6';
    x.fillRect(10 + k * 30, 14 + r * 30, 18, 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const PALETTE = ['#f2d6b3', '#e8b4a0', '#cfe0ef', '#f6e7a1', '#d9c7e8', '#bfe3cf', '#f0c38e'];

function building(r, w, d, h) {
  const tex = windowsTexture(PALETTE[Math.floor(r() * PALETTE.length)]);
  tex.repeat.set(Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(h / 9)));
  const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const roof = mat(0x8a8f99);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roof, roof, side, side]);
  m.position.y = h / 2;
  m.castShadow = m.receiveShadow = true;
  return m;
}

function tree(r) {
  const g = new THREE.Group();
  const h = 1.6 + r() * 1.2;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, h, 6), mat(0x7a5532));
  trunk.position.y = h / 2;
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + r() * 0.8, 1),
    mat(r() > 0.5 ? 0x4f9e3a : 0x3f8a33, { flatShading: true }));
  crown.position.y = h + 1.1;
  trunk.castShadow = crown.castShadow = true;
  g.add(trunk, crown);
  return g;
}

// Заполнить прямоугольник [x1..x2]×[z1..z2] деревьями и домами
function scatter(g, r, x1, x2, z1, z2, { houses = true, density = 1 } = {}) {
  const area = Math.abs((x2 - x1) * (z2 - z1));
  const n = Math.floor(area / 90 * density);
  for (let i = 0; i < n; i++) {
    const x = x1 + r() * (x2 - x1), z = z1 + r() * (z2 - z1);
    const t = tree(r); t.position.set(x, 0, z); g.add(t);
  }
  if (!houses) return;
  const along = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const span = along ? [x1, x2] : [z1, z2];
  const lo = Math.min(...span), hi = Math.max(...span);
  for (let s = lo + 4; s < hi - 8; s += 16 + r() * 10) {
    const w = 10 + r() * 6, d = 9 + r() * 4, h = 9 + r() * 18;
    const b = building(r, along ? w : d, along ? d : w, h);
    const off = 0.7;
    if (along) b.position.set(s + w / 2, b.position.y, z1 + (z2 - z1) * off);
    else b.position.set(x1 + (x2 - x1) * off, b.position.y, s + w / 2);
    g.add(b);
  }
}

function crosswalk(g, cx, cz, alongX, width) {
  // зебра поперёк дороги; alongX — дорога идёт вдоль X
  const n = Math.floor(width / 1.0);
  for (let i = 0; i < n; i++) {
    const o = -width / 2 + 0.5 + i * 1.0;
    if (alongX) stripe(g, cx - 2, cz + o, cx + 2, cz + o, 0.5);
    else stripe(g, cx + o, cz - 2, cx + o, cz + 2, 0.5);
  }
}

function teeth(g, x1, x2, z, dirSign) {
  // 1.13: треугольники остриём к водителю
  const step = 1.15;
  const shape = new THREE.Shape();
  shape.moveTo(-0.45, 0); shape.lineTo(0.45, 0); shape.lineTo(0, -1.0 * dirSign); shape.lineTo(-0.45, 0);
  for (let x = Math.min(x1, x2) + 0.6; x < Math.max(x1, x2) - 0.3; x += step) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(C.mark));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.013, z);
    g.add(m);
  }
}

function rails(g, x1, z1, x2, z2) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const ang = Math.atan2(x2 - x1, z2 - z1);
  for (const o of [-0.76, 0.76]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, len), mat(C.rail, { metalness: 0.6, roughness: 0.4 }));
    const nx = Math.cos(ang) * o, nz = -Math.sin(ang) * o;
    m.position.set((x1 + x2) / 2 + nx, 0.02, (z1 + z2) / 2 + nz);
    m.rotation.y = ang;
    g.add(m);
  }
}

function slab(g, x1, x2, z1, z2, color, h) {
  const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
  if (w < 0.01 || d < 0.01) return;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
  m.receiveShadow = true;
  g.add(m);
}

// ---------- Перекрёсток (и Т-образный, если нет одного из рукавов) ----------
export function buildCrossroad(o = {}) {
  const g = new THREE.Group();
  const r = rng(o.seed || 7);
  const arms = o.arms || { n: {}, s: {}, e: {}, w: {} };
  const ns = { lanes: o.nsLanes || 1, median: o.nsMedian || 0 };
  const ew = { lanes: o.ewLanes || 1, median: o.ewMedian || 0 };
  const HX = ns.lanes * LW + ns.median / 2; // полуширина дороги С-Ю (по X)
  const HZ = ew.lanes * LW + ew.median / 2; // полуширина дороги З-В (по Z)
  const L = o.len || 90;
  const city = o.city !== false;
  const walk = city ? 3 : 0;

  g.add(plane(600, 600, C.grass, -0.01));

  // центр перекрёстка
  g.add(plane(HX * 2, HZ * 2, C.asphalt, 0.005));
  const armDefs = {
    n: { x1: -HX, x2: HX, z1: -HZ - L, z2: -HZ },
    s: { x1: -HX, x2: HX, z1: HZ, z2: HZ + L },
    w: { x1: -HX - L, x2: -HX, z1: -HZ, z2: HZ },
    e: { x1: HX, x2: HX + L, z1: -HZ, z2: HZ },
  };
  for (const [k, a] of Object.entries(armDefs)) {
    if (!arms[k]) continue;
    const surf = arms[k].surface === 'dirt' ? C.dirt : C.asphalt;
    const p = plane(a.x2 - a.x1, a.z2 - a.z1, surf, 0.004);
    p.position.set((a.x1 + a.x2) / 2, 0.004, (a.z1 + a.z2) / 2);
    g.add(p);
  }

  // разметка по рукавам
  for (const [k, cfg] of Object.entries(arms)) {
    if (!cfg || cfg.surface === 'dirt') continue;
    const vertical = k === 'n' || k === 's';
    const sign = k === 'n' || k === 'w' ? -1 : 1;
    const H = vertical ? HZ : HX;            // где кончается перекрёсток по оси рукава
    const halfW = vertical ? HX : HZ;
    const lanes = vertical ? ns.lanes : ew.lanes;
    const med = vertical ? ns.median : ew.median;
    const cwAt = cfg.crosswalkAt ?? H + 3;
    const from = cfg.crosswalk && !cfg.crosswalkAt ? H + 6 : H + 0.5, to = H + L;
    const P = (across, along) => vertical ? [across, sign * along] : [sign * along, across];
    // осевая
    const center = cfg.center || (lanes > 1 ? 'solid' : 'dashed');
    if (med > 0) {
      const [x1, z1] = P(-med / 2, from), [x2, z2] = P(med / 2, to);
      slab(g, Math.min(x1, x2), Math.max(x1, x2), Math.min(z1, z2), Math.max(z1, z2), C.grassDark, 0.18);
    } else if (center === 'dashed') {
      dashed(g, ...P(0, from), ...P(0, to));
    } else if (center === 'double') {
      stripe(g, ...P(-0.15, from), ...P(-0.15, to)); stripe(g, ...P(0.15, from), ...P(0.15, to));
    } else stripe(g, ...P(0, from), ...P(0, to));
    // полосы внутри направления
    for (let i = 1; i < lanes; i++) for (const sd of [-1, 1]) {
      const a = sd * (med / 2 + i * LW);
      dashed(g, ...P(a, from), ...P(a, to));
    }
    // въездная сторона: справа по ходу к центру
    const inSide = { n: -1, s: 1, e: -1, w: 1 }[k] * (vertical ? 1 : -1);
    const inA = inSide * med / 2, inB = inSide * halfW;
    if (cfg.crosswalk) crosswalk(g, ...P(0, cwAt), !vertical, halfW * 2);
    const stopAt = cfg.crosswalk ? cwAt + 3.5 : H + 1.0;
    if (cfg.stop) stripe(g, ...P(inA, stopAt), ...P(inB, stopAt), 0.4);
    if (cfg.teeth) {
      if (vertical) teeth(g, inA, inB, sign * stopAt, sign);
      else for (let a = Math.min(inA, inB) + 0.6; a < Math.max(inA, inB) - 0.3; a += 1.0) {
        const sh = new THREE.Shape();
        sh.moveTo(0, -0.35); sh.lineTo(0, 0.35); sh.lineTo(0.7 * sign, 0); sh.lineTo(0, -0.35);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat(C.mark));
        m.rotation.x = -Math.PI / 2; m.position.set(sign * stopAt, 0.013, a); g.add(m);
      }
    }
  }

  // трамвайные пути по центрам полос
  for (const road of o.tram || []) {
    for (const sd of [-1, 1]) {
      const a = sd * LW / 2;
      if (road === 'ns') rails(g, a, -HZ - L, a, HZ + L);
      else rails(g, -HX - L, a, HX + L, a);
    }
  }

  // кварталы: тротуар + газон + застройка
  const quads = [
    [HX, HX + L, -HZ - L, -HZ, 'ne'], [-HX - L, -HX, -HZ - L, -HZ, 'nw'],
    [HX, HX + L, HZ, HZ + L, 'se'], [-HX - L, -HX, HZ, HZ + L, 'sw'],
  ];
  for (const [X1, X2, Z1, Z2, q] of quads) {
    if (walk) slab(g, X1, X2, Z1, Z2, C.walk, 0.15);
    const gx = q.includes('e') ? [X1 + walk, X2] : [X1, X2 - walk];
    const gz = q.startsWith('n') ? [Z1, Z2 - walk] : [Z1 + walk, Z2];
    slab(g, gx[0], gx[1], gz[0], gz[1], C.grass, 0.17);
    const sx = q.includes('e') ? [X1 + walk + 4, X2] : [X1, X2 - walk - 4];
    const sz = q.startsWith('n') ? [Z1, Z2 - walk - 4] : [Z1 + walk + 4, Z2];
    scatter(g, r, sx[0], sx[1], sz[0], sz[1], { houses: city, density: city ? 0.6 : 1.2 });
  }
  // асфальт отсутствующего рукава заменён газоном выше; тротуар вдоль
  for (const k of ['n', 's', 'e', 'w']) {
    if (arms[k]) continue;
    const a = armDefs[k];
    slab(g, a.x1, a.x2, a.z1, a.z2, walk ? C.walk : C.grass, 0.15);
    const insetX = k === 'e' || k === 'w';
    if (walk) slab(g, a.x1 + (insetX ? (k === 'e' ? walk : 0) : 0), a.x2 - (insetX ? (k === 'w' ? walk : 0) : 0),
      a.z1 + (!insetX ? (k === 's' ? walk : 0) : 0), a.z2 - (!insetX ? (k === 'n' ? walk : 0) : 0), C.grass, 0.17);
  }

  g.userData = { HX, HZ, kind: 'crossroad' };
  return g;
}

// ---------- Прямая дорога вдоль Z ----------
export function buildStraight(o = {}) {
  const g = new THREE.Group();
  const r = rng(o.seed || 11);
  const nb = o.north ?? o.lanes ?? 1, sb = o.south ?? o.lanes ?? 1;
  const med = o.median || 0;
  const L = o.len || 220;
  const xL = -(med / 2 + sb * LW), xR = med / 2 + nb * LW;
  const rural = !!o.rural;
  g.add(plane(800, 800, C.grass, -0.01));
  const road = plane(xR - xL, L * 2, C.asphalt, 0.004);
  road.position.x = (xL + xR) / 2;
  g.add(road);
  if (med > 0) {
    slab(g, -med / 2, med / 2, -L, L, C.grassDark, 0.18);
  } else {
    const c = o.center || 'dashed';
    if (c === 'dashed') dashed(g, 0, -L, 0, L);
    else if (c === 'double') { stripe(g, -0.15, -L, -0.15, L); stripe(g, 0.15, -L, 0.15, L); }
    else stripe(g, 0, -L, 0, L);
  }
  for (let i = 1; i < nb; i++) dashed(g, med / 2 + i * LW, -L, med / 2 + i * LW, L);
  for (let i = 1; i < sb; i++) dashed(g, -med / 2 - i * LW, -L, -med / 2 - i * LW, L);
  if (rural) {
    stripe(g, xR - 0.3, -L, xR - 0.3, L); stripe(g, xL + 0.3, -L, xL + 0.3, L);
    if (o.shoulder !== false) {
      const sh = o.wetShoulder ? 0x6b5a45 : 0xa89878;
      const a = plane(2.5, L * 2, sh, 0.003); a.position.x = xR + 1.25; g.add(a);
      const b = plane(2.5, L * 2, sh, 0.003); b.position.x = xL - 1.25; g.add(b);
    }
    scatter(g, r, xR + 6, xR + 60, -L, L, { houses: false, density: 0.5 });
    scatter(g, r, xL - 60, xL - 6, -L, L, { houses: false, density: 0.5 });
  } else {
    slab(g, xR, xR + 4, -L, L, C.walk, 0.15);
    slab(g, xL - 4, xL, -L, L, C.walk, 0.15);
    slab(g, xR + 4, xR + 70, -L, L, C.grass, 0.16);
    slab(g, xL - 70, xL - 4, -L, L, C.grass, 0.16);
    scatter(g, r, xR + 8, xR + 50, -L, L, { houses: true, density: 0.4 });
    scatter(g, r, xL - 50, xL - 8, -L, L, { houses: true, density: 0.4 });
  }
  for (const z of o.crosswalks || []) crosswalk(g, (xL + xR) / 2, z, false, xR - xL);
  g.userData = { xL, xR, kind: 'straight' };
  return g;
}

// ---------- Студия для вопросов-теории ----------
export function buildStudio(o = {}) {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(200, 64), mat(o.floor || 0xdfe8f1, { roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  // круглая площадка-асфальт с жёлтым бортом
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.3, 0.36, 64), mat(0xffd21f, { roughness: 0.6 }));
  rim.position.y = 0.18; rim.receiveShadow = true;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(9.3, 9.3, 0.4, 64), mat(C.asphalt));
  disc.position.y = 0.2; disc.receiveShadow = true;
  g.add(rim, disc);
  if (o.road) {
    const p = plane(7, 120, C.asphalt, 0.41); p.position.x = 0; p.position.z = -40; g.add(p);
    dashed(g, 0, -100, 0, 9);
  }
  g.userData = { kind: 'studio', floorY: 0.4 };
  return g;
}

export function buildSet(name, opts) {
  if (name === 'straight') return buildStraight(opts);
  if (name === 'studio') return buildStudio(opts);
  return buildCrossroad(opts);
}
