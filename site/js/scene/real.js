// Реалистичный сет в стиле роликов утки: PBR-асфальт, обочины, лес, горы, небо, машины из Blender.
// Ассеты лежат в site/assets (в публичный git не идут). Нет ассетов — плеер откатывается на простой сет.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { Sky } from '../../vendor/jsm/objects/Sky.js';
import { RGBELoader } from '../../vendor/jsm/loaders/RGBELoader.js';

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const glbCache = new Map();

export function loadGLB(base, name) {
  const url = name.endsWith('.gltf') ? `${base}assets/${name}` : `${base}assets/models/${name}.glb`;
  if (!glbCache.has(url)) glbCache.set(url, loader.loadAsync(url).then(g => { prepModel(g.scene); return g.scene; }));
  return glbCache.get(url);
}

export async function assetsAvailable(base) {
  try { const r = await fetch(`${base}assets/models/priora.glb`, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

// стекло прозрачное, листва с отсечкой по альфе, всё отбрасывает тени
function prepModel(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const n = (m.name || '').toLowerCase();
      if (/stek|glass|glazing|window|lens|optic|clearlens|стекл/.test(n)) {
        m.transparent = true; m.opacity = Math.min(m.opacity ?? 1, 0.32); m.depthWrite = false;
        m.roughness = 0.05; m.metalness = 0.2; o.castShadow = false;
      }
      if (/conifer foliage/.test(n)) {
        // хвоя в Blender процедурная: запечённая карта 64 px без альфы, красим сами
        m.alphaTest = 0; m.transparent = false; m.side = THREE.DoubleSide;
        m.color = new THREE.Color(0x4f6b3c); m.roughness = 0.9;
        continue;
      }
      if (/grass/.test(n)) {
        // трава Poly Haven: обе стороны, мягче нормали, светлее — иначе на просвет чернеет
        m.side = THREE.DoubleSide; if (m.normalScale) m.normalScale.set(0.35, 0.35);
        m.color = new THREE.Color(0x9cc06a); m.roughness = 0.95; m.envMapIntensity = 0.7;
        m.emissive = new THREE.Color(0x24401a); m.emissiveMap = m.map; m.normalMap = null;
      }
      if (/leaf|leaves|foliage|needle|grass|branch/.test(n) || (m.map && m.alphaTest === 0 && m.transparent)) {
        m.transparent = false; m.alphaTest = 0.45; m.side = THREE.DoubleSide; m.depthWrite = true;
      }
      if (m.map) m.map.anisotropy = 8;
    }
  });
}

function tex(base, name, repeat, srgb = false) {
  const t = texLoader.load(`${base}assets/tex/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Инстансинг модели: на каждый меш внутри — свой InstancedMesh
async function scatterModel(group, base, name, mats4) {
  if (!mats4.length) return;
  const src = await loadGLB(base, name);
  src.updateMatrixWorld(true);
  src.traverse(o => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, mats4.length);
    const local = o.matrixWorld;
    const m = new THREE.Matrix4();
    mats4.forEach((M, i) => { m.multiplyMatrices(M, local); im.setMatrixAt(i, m); });
    im.castShadow = o.castShadow; im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
  });
}

// Деревья-импостеры: два перекрещённых полотна с отрендеренным в Cycles деревом (tools: out/blend/impostor.py)
const IMP = { pine: [11.63, 18.54], spruce: [9.42, 16.48], broadleaf: [6.34, 4.69] };
async function scatterImpostor(group, base, name, mats4) {
  if (!mats4.length) return;
  const [w, h] = IMP[name];
  for (const k of [0, 1]) {
    const map = await texLoader.loadAsync(`${base}assets/impostors/${name}_${k}.png`);
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
    if (k === 1) geo.rotateY(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xe8ece4 });
    const im = new THREE.InstancedMesh(geo, mat, mats4.length);
    mats4.forEach((M, i) => im.setMatrixAt(i, M));
    im.castShadow = true; im.frustumCulled = false;
    im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    group.add(im);
  }
}

const M4 = (x, y, z, ry = 0, s = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));

function paint(g, x1, z1, x2, z2, w, color = 0xf2f2ee) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -Math.atan2(x2 - x1, z2 - z1);
  m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
  m.receiveShadow = true;
  g.add(m);
}

function house(r) {
  const g = new THREE.Group();
  const w = 6 + r() * 3, d = 7 + r() * 3, h = 3 + r() * 0.6;
  const walls = ['#d9d2c3', '#c9b79c', '#e3ddd0', '#b9c4c9', '#d6c2a8'][Math.floor(r() * 5)];
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: walls, roughness: 0.9 }));
  body.position.y = h / 2;
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2 - 0.4, 0); roofShape.lineTo(w / 2 + 0.4, 0); roofShape.lineTo(0, 2.2); roofShape.lineTo(-w / 2 - 0.4, 0);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.6, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: ['#6d3b2c', '#4a5560', '#3d4a3a'][Math.floor(r() * 3)], roughness: 0.75 }));
  roof.position.set(0, h, -d / 2 - 0.3);
  const winMat = new THREE.MeshStandardMaterial({ color: '#2b3a46', roughness: 0.15, metalness: 0.3 });
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 1.2), winMat);
    win.position.set(sx * (w / 2 + 0.01), 1.6, -d / 4 + k * d / 2);
    g.add(win);
  }
  g.add(body, roof);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// Сет «дорога через посёлок»: две полосы вдоль Z, обочины, лес, горы на горизонте
export async function buildReal(o, base, renderer, scene) {
  const g = new THREE.Group();
  const r = rng(o.seed || 21);
  const L = o.len || 260;
  const half = (o.lanes || 1) * 3.5;
  const sh = 1.6;

  // небо: HDRI с облаками (Poly Haven), солнце ставим в самую яркую точку; без HDRI — физическое небо
  let sunDir;
  if (o.hdri !== false) {
    const hdr = await new RGBELoader().setDataType(THREE.FloatType).loadAsync(`${base}assets/hdri/${o.hdri || 'kloofendal_48d_partly_cloudy_puresky'}.hdr`);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const { data, width: W, height: H } = hdr.image;
    let best = -1, bi = 0;
    for (let i = 0; i < W * H; i++) { const l = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]; if (l > best) { best = l; bi = i; } }
    const u = (bi % W + 0.5) / W, v = 1 - (Math.floor(bi / W) + 0.5) / H;
    const th = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
    sunDir = new THREE.Vector3(Math.cos(th) * Math.cos(lat), Math.sin(lat), Math.sin(th) * Math.cos(lat));
    if (sunDir.y < 0.25) sunDir.y = 0.25;
    sunDir.normalize();
    // поворот неба, чтобы солнце светило сбоку-сзади типичной камеры
    const rot = THREE.MathUtils.degToRad(o.skyRotation ?? 0);
    sunDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    scene.background = hdr; scene.environment = hdr;
    scene.backgroundRotation.set(0, rot, 0); scene.environmentRotation.set(0, rot, 0);
    scene.environmentIntensity = o.envIntensity ?? 0.9;
    scene.backgroundIntensity = o.skyIntensity ?? 1.0;
  } else {
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = o.turbidity ?? 5.5; u.rayleigh.value = o.rayleigh ?? 1.6;
    u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.82;
    const elev = THREE.MathUtils.degToRad(o.sunElevation ?? 38), azim = THREE.MathUtils.degToRad(o.sunAzimuth ?? 215);
    sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
    u.sunPosition.value.copy(sunDir);
    const pm = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene(); skyScene.add(sky.clone());
    scene.environment = pm.fromScene(skyScene, 0.02).texture;
    scene.environmentIntensity = 0.85;
    g.add(sky);
  }
  g.userData.sunDir = sunDir;

  // земля
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({
    map: tex(base, 'grass_diff.jpg', [280, 280], true), normalMap: tex(base, 'grass_nor.jpg', [280, 280]),
    roughness: 1, color: 0x9db27c,
  }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
  g.add(ground);

  // асфальт и обочины
  const road = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, L * 2), new THREE.MeshStandardMaterial({
    map: tex(base, 'asphalt_diff.jpg', [half * 2 / 4, L * 2 / 4], true), normalMap: tex(base, 'asphalt_nor.jpg', [half * 2 / 4, L * 2 / 4]),
    roughnessMap: tex(base, 'asphalt_rough.jpg', [half * 2 / 4, L * 2 / 4]), roughness: 1, color: 0xb8b8b8,
  }));
  road.rotation.x = -Math.PI / 2; road.receiveShadow = true;
  g.add(road);
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(sh, L * 2), new THREE.MeshStandardMaterial({
      map: tex(base, 'gravel_diff.jpg', [sh / 2, L], true), normalMap: tex(base, 'gravel_nor.jpg', [sh / 2, L]), roughness: 1,
    }));
    s.rotation.x = -Math.PI / 2; s.position.set(sx * (half + sh / 2), 0.004, 0); s.receiveShadow = true;
    g.add(s);
  }

  // разметка: края и прерывистая осевая
  for (const sx of [-1, 1]) paint(g, sx * (half - 0.25), -L, sx * (half - 0.25), L, 0.12);
  for (let z = -L; z < L; z += 9) {
    if (o.crosswalkAt !== undefined && Math.abs(z + 1.5 - o.crosswalkAt) < 6) continue;
    paint(g, 0, z, 0, z + 3, 0.12);
  }
  // пешеходный переход: широкие полосы вдоль дороги
  if (o.crosswalkAt !== undefined) {
    for (let x = -half + 0.5; x < half - 0.3; x += 1.0) paint(g, x + 0.25, o.crosswalkAt - 2, x + 0.25, o.crosswalkAt + 2, 0.5, 0xf7f7f2);
    // тропинки к переходу
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), new THREE.MeshStandardMaterial({
        map: tex(base, 'gravel_diff.jpg', [7, 1.1], true), roughness: 1, color: 0xc9c2b4 }));
      p.rotation.x = -Math.PI / 2; p.position.set(sx * (half + sh + 7), 0.006, o.crosswalkAt); p.receiveShadow = true;
      g.add(p);
    }
  }

  // растительность: трава у дороги, кусты, сосны и ели дальше, камни
  const keepOut = (x, z) => o.crosswalkAt !== undefined && Math.abs(z - o.crosswalkAt) < 3.5 && Math.abs(x) < half + sh + 15;
  const grass = [], bermuda = [], shrubs = [], bushes = [], pines = [], spruces = [], broad = [], rocks = [];
  const span = o.vegSpan || 160;
  const side = () => (r() < 0.5 ? -1 : 1);
  for (let i = 0; i < (o.grass ?? 9000); i++) {
    const sx = side(), x = sx * (half + sh + 0.4 + Math.pow(r(), 1.8) * 34), z = (r() * 2 - 1) * span;
    if (!keepOut(x, z)) grass.push(M4(x, 0, z, r() * 6.28, 0.9 + r() * 1.1));
  }
  for (let i = 0; i < (o.bermuda ?? 1600); i++) {
    const sx = side(), x = sx * (half + sh + Math.pow(r(), 1.3) * 22), z = (r() * 2 - 1) * span;
    if (!keepOut(x, z)) bermuda.push(M4(x, 0, z, r() * 6.28, 1 + r() * 1.4));
  }
  for (let i = 0; i < (o.shrubs ?? 520); i++) {
    const sx = side(), x = sx * (half + sh + 3 + r() * 30), z = (r() * 2 - 1) * span;
    if (keepOut(x, z)) continue;
    shrubs.push(M4(x, 0, z, r() * 6.28, 0.9 + r() * 1.3));
  }
  for (let i = 0; i < (o.trees ?? 260); i++) {
    const sx = side(), x = sx * (half + sh + 9 + Math.pow(r(), 0.9) * 110), z = (r() * 2 - 1) * span * 1.4;
    if (keepOut(x, z)) continue;
    const k = r();
    if (k < 0.62) broad.push(M4(x, 0, z, r() * 6.28, 0.9 + r() * 0.8));
    else (k < 0.85 ? pines : spruces).push(M4(x, 0, z, r() * 6.28, 0.6 + r() * 0.45));
  }
  for (let i = 0; i < (o.rocks ?? 36); i++) {
    const sx = side(), x = sx * (half + sh + 1.5 + r() * 22), z = (r() * 2 - 1) * span;
    if (!keepOut(x, z)) rocks.push(M4(x, -0.1, z, r() * 6.28, 0.25 + r() * 0.5));
  }
  await Promise.all([
    scatterModel(g, base, 'ph/grass_medium_01/grass_medium_01_1k.gltf', grass),
    scatterModel(g, base, 'ph/grass_bermuda_01/grass_bermuda_01_1k.gltf', bermuda),
    scatterModel(g, base, 'shrub', shrubs),
    scatterImpostor(g, base, 'pine', pines), scatterImpostor(g, base, 'spruce', spruces), scatterImpostor(g, base, 'broadleaf', broad),
    scatterModel(g, base, 'ph/boulder_01/boulder_01_1k.gltf', rocks),
  ]);

  // посёлок у перехода
  if (o.houses !== false && o.crosswalkAt !== undefined) {
    for (const [x, z, ry] of o.housesAt || [[-19, o.crosswalkAt - 16, 0.1], [21, o.crosswalkAt + 14, -0.15], [-22, o.crosswalkAt + 22, 0.05], [24, o.crosswalkAt - 26, 0.2]]) {
      const h = house(r); h.position.set(x, 0, z); h.rotation.y = ry; g.add(h);
    }
  }

  g.userData = { ...g.userData, kind: 'real', half };
  return g;
}

// ---------- машины из Blender ----------
export async function carModel(base, { model = 'priora', color, duck } = {}) {
  const src = await loadGLB(base, model);
  const car = src.clone(true);
  // перекраска кузова, если задан цвет
  if (color) car.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map(m => {
      if (/paint|silver|body|kuzov/i.test(m.name || '')) { const c = m.clone(); c.color = new THREE.Color(color); return c; }
      return m;
    });
    if (!Array.isArray(mats) || mats.length === 1) o.material = o.material[0];
  });
  const box = new THREE.Box3().setFromObject(car);
  const size = box.getSize(new THREE.Vector3());
  const g = new THREE.Group();
  g.add(car);
  // поворотники/аварийка: огоньки по углам + свечение
  const sig = {};
  const glowTex = glowTexture();
  for (const [k, sx, sz] of [['FL', -1, -1], ['FR', 1, -1], ['RL', -1, 1], ['RR', 1, 1]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff9a1f, emissive: 0xff8a00, emissiveIntensity: 0 }));
    lamp.position.set(sx * (size.x / 2 - 0.12), size.y * 0.52, sz * (size.z / 2 - 0.05));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa21f, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.scale.setScalar(0.9); lamp.add(glow);
    lamp.userData.glow = glow;
    g.add(lamp); sig[k] = lamp;
  }
  g.userData.signals = sig;
  g.userData.size = size;
  if (duck) g.userData.duckSeat = new THREE.Vector3(-0.36, size.y * 0.62, -0.05);
  return g;
}

let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,200,120,0.8)'); gr.addColorStop(1, 'rgba(255,140,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

// ---------- 2D-утки (анимированные стикеры) ----------
const duckMeta = new Map();
export async function duckSprite(base, id, { size = 1.2, ground = true } = {}) {
  if (!duckMeta.has(base)) duckMeta.set(base, fetch(`${base}assets/ducks/index.json`).then(r => r.json()));
  const meta = (await duckMeta.get(base))[id];
  const t = await texLoader.loadAsync(`${base}assets/ducks/${id}.webp`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / meta.cols, 1 / meta.rows);
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.05 });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  if (ground) s.center.set(0.5, 0.04);
  s.userData.duckAnim = { meta, tex: t };
  return s;
}

export function setDuckFrame(sprite, t) {
  const { meta, tex } = sprite.userData.duckAnim;
  const f = Math.floor(t * meta.fps) % meta.frames;
  tex.offset.set((f % meta.cols) / meta.cols, 1 - (Math.floor(f / meta.cols) + 1) / meta.rows);
}

// ---------- дым из-под капота ----------
let _smokeTex;
function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const r = rng(5);
  for (let i = 0; i < 14; i++) {
    const cx = 40 + r() * 48, cy = 40 + r() * 48, rad = 20 + r() * 26;
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gr.addColorStop(0, 'rgba(240,240,240,0.35)'); gr.addColorStop(1, 'rgba(240,240,240,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  }
  _smokeTex = new THREE.CanvasTexture(c);
  return _smokeTex;
}

export function realSmoke() {
  const g = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color: 0xdedede, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData.phase = i / 26;
    s.userData.seed = Math.sin(i * 12.9898) * 43758.5453 % 1;
    g.add(s);
  }
  g.userData.realSmoke = true;
  return g;
}

export function updateRealSmoke(g, t, on) {
  g.children.forEach(s => {
    const ph = (t * 0.45 + s.userData.phase) % 1;
    const k = Math.abs(s.userData.seed);
    s.position.set((k - 0.5) * 0.8 + ph * 0.6, 0.15 + ph * 3.4, (k * 7 % 1 - 0.5) * 0.8 - ph * 0.4);
    s.scale.setScalar(0.5 + ph * 2.6);
    s.material.rotation = k * 6 + ph;
    s.material.opacity = on * 0.85 * Math.sin(Math.PI * Math.min(1, ph * 1.4)) * (1 - ph * 0.6);
  });
}

// ---------- знак аварийной остановки ----------
export function realTriangle() {
  const g = new THREE.Group();
  const outer = new THREE.Shape();
  outer.moveTo(-0.24, 0); outer.lineTo(0.24, 0); outer.lineTo(0, 0.42); outer.lineTo(-0.24, 0);
  const hole = new THREE.Path();
  hole.moveTo(-0.15, 0.05); hole.lineTo(0.15, 0.05); hole.lineTo(0, 0.31); hole.lineTo(-0.15, 0.05);
  outer.holes.push(hole);
  const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.02, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: 0xd8141a, emissive: 0x5a0000, roughness: 0.35, metalness: 0.1 }));
  tri.position.set(0, 0.06, 0);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.22), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
  stand.position.y = 0.01;
  g.add(tri, stand);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------- контактная тень под плоской уткой ----------
let _shadowTex;
export function contactShadow(size = 1.3) {
  if (!_shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    _shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.8, size * 0.42),
    new THREE.MeshBasicMaterial({ map: _shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

// ---------- цветная зона на асфальте (как в эталонах: дорога салатовая, территория оранжевая) ----------
export function zone({ from, to, points, color = '#8fe36b', opacity = 0.72 }) {
  const pts = points || [[from[0], from[1]], [to[0], from[1]], [to[0], to[1]], [from[0], to[1]]];
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, fog: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.03; m.renderOrder = 2;
  m.userData.zone = true;
  return m;
}
