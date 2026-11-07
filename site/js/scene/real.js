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
        // стекло без цвета в glTF приходит белым — тонируем в тёмный, иначе «белые стёкла»
        if (m.color && m.color.r + m.color.g + m.color.b > 1.2) m.color.setHex(0x1b232b);
        m.envMapIntensity = 1.4;
      }
      if (/^vehiclelights128(\.004)?$/.test(m.name || '')) { m.color = new THREE.Color(0xd9dde2); m.metalness = 0.85; m.roughness = 0.18; }
      if (/sunny yellow enamel/.test(n)) { m.metalness = 0.06; m.roughness = 0.3; m.envMapIntensity = 1.1; }
      if (/conifer foliage/.test(n)) {
        // хвоя в Blender процедурная: запечённая карта 64 px без альфы, красим сами
        m.alphaTest = 0; m.transparent = false; m.side = THREE.DoubleSide;
        m.color = new THREE.Color(0x4f6b3c); m.roughness = 0.9;
        continue;
      }
      if (/grass/.test(n)) {
        // трава Poly Haven: обе стороны, мягче нормали, светлее — иначе на просвет чернеет
        m.side = THREE.DoubleSide; if (m.normalScale) m.normalScale.set(0.35, 0.35);
        m.color = new THREE.Color(0xc4ec86); m.roughness = 0.95; m.envMapIntensity = 0.8;
        m.emissive = new THREE.Color(0x8cc054); m.emissiveMap = m.map; m.normalMap = null;
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
// variants: в файле несколько кустиков в ряд со смещением в метры (Poly Haven) — каждый ставим как отдельный вариант
// в точку инстанса, иначе пучки травы съезжают на асфальт
async function scatterModel(group, base, name, mats4, { variants = false, minH = 0, skip = null } = {}) {
  if (!mats4.length) return;
  const src = await loadGLB(base, name);
  src.updateMatrixWorld(true);
  const meshes = [];
  src.traverse(o => {
    if (!o.isMesh) return;
    if (variants) { o.geometry.computeBoundingBox(); if (o.geometry.boundingBox.max.y < minH || skip?.test(o.name)) return; }
    meshes.push(o);
  });
  meshes.forEach((o, k) => {
    const mine = variants ? mats4.filter((_, i) => i % meshes.length === k) : mats4;
    if (!mine.length) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, mine.length);
    const local = o.matrixWorld.clone();
    if (variants) local.setPosition(0, 0, 0);
    const m = new THREE.Matrix4();
    mine.forEach((M, i) => { m.multiplyMatrices(M, local); im.setMatrixAt(i, m); });
    im.castShadow = o.castShadow; im.receiveShadow = true;
    im.frustumCulled = false;
    im.userData.veg = name;   // для check.mjs: растительность не должна заходить на асфальт
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

// материалы домов: бревно, крашеная вагонка, кирпич; крыши — профнастил и шифер (Poly Haven 2k)
const _texCache = new Map();
function ptex(base, name, srgb) {
  const k = base + name;
  if (!_texCache.has(k)) {
    const t = texLoader.load(`${base}assets/tex/${name}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    _texCache.set(k, t);
  }
  return _texCache.get(k);
}
function pbr(base, id, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: ptex(base, `${id}_diff.jpg`, true), normalMap: ptex(base, `${id}_nor.jpg`), roughnessMap: ptex(base, `${id}_rough.jpg`),
    roughness: 1, ...extra,
  });
}
// UV куба в метрах / tile: текстура одного масштаба на всех гранях
function boxUV(geo, w, h, d, tile, rot = false) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k; let u = uv.getX(i) * dims[f][0] / tile, v = uv.getY(i) * dims[f][1] / tile;
    if (rot) [u, v] = [v, u];
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}
function scaleUV(geo, k, rot = false) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) { let u = uv.getX(i) * k, v = uv.getY(i) * k; if (rot) [u, v] = [v, u]; uv.setXY(i, u, v); }
  uv.needsUpdate = true; return geo;
}
function house(r, base) {
  const g = new THREE.Group();
  const w = 6 + r() * 3, d = 7 + r() * 3, h = 3 + r() * 0.6;
  const kind = Math.floor(r() * 3);
  const paint = ['#9ec4dc', '#b9d79a', '#f2d98a', '#f1ece0', '#d9b4a0'][Math.floor(r() * 5)];
  const WALL = [
    { id: 'weathered_plank_siding', tile: 2.2, color: '#d8c6ae', rot: false },      // бревенчатый сруб
    { id: 'white_planks_clean', tile: 2.0, color: paint, rot: true },              // крашеная вагонка (доски горизонтально)
    { id: 'brick_wall_001', tile: 1.6, color: '#ffffff', rot: false },              // кирпич
  ][kind];
  const wallMat = pbr(base, WALL.id, { color: WALL.color });
  const body = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, WALL.tile, WALL.rot), wallMat);
  body.position.y = h / 2 + 0.45;
  // цоколь
  const plinthMat = pbr(base, 'brick_wall_001', { color: '#9a9590' });
  const plinth = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w + 0.12, 0.5, d + 0.12), w + 0.12, 0.5, d + 0.12, 1.6), plinthMat);
  plinth.position.y = 0.25;
  // крыша: скаты — профнастил/шифер, фронтоны — стена
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2 - 0.45, 0); roofShape.lineTo(w / 2 + 0.45, 0); roofShape.lineTo(0, 2.3); roofShape.lineTo(-w / 2 - 0.45, 0);
  const roofKind = r() < 0.55 ? 'corrugated_iron' : 'grey_roof_01';
  const roofCol = roofKind === 'corrugated_iron' ? ['#3f7d4a', '#8e3a2e', '#5b5f66', '#2f5d84'][Math.floor(r() * 4)] : '#d0d0cc';
  const roofMat = pbr(base, roofKind, { color: roofCol, metalness: roofKind === 'corrugated_iron' ? 0.35 : 0, side: THREE.DoubleSide });
  const gableMat = wallMat;
  const rg = new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.7, bevelEnabled: false });
  scaleUV(rg, 1 / 2.0);
  const roof = new THREE.Mesh(rg, [gableMat, roofMat]);
  roof.position.set(0, h + 0.45, -d / 2 - 0.35);
  // окна: стекло, белая рама с переплётом, наличник, подоконник, ставни
  const glass = new THREE.MeshStandardMaterial({ color: '#25343f', roughness: 0.06, metalness: 0.4, envMapIntensity: 1.6 });
  const white = new THREE.MeshStandardMaterial({ color: '#f5f2ea', roughness: 0.55 });
  const shutterCol = ['#2f6b4f', '#7a3b2c', '#3e5f8a', '#f2f0ea'][Math.floor(r() * 4)];
  const shut = pbr(base, 'white_planks_clean', { color: shutterCol });
  const win = (x, z, ry) => {
    const wg = new THREE.Group();
    const gl = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.04), glass);
    const fr = [[1.25, 0.1, 0, 0.62], [1.25, 0.1, 0, -0.62], [0.1, 1.34, 0.58, 0], [0.1, 1.34, -0.58, 0], [0.06, 1.15, 0, 0], [1.05, 0.06, 0, 0.18]]
      .map(([bw, bh, x0, y0]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.09), white); m.position.set(x0, y0, 0.03); return m; });
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.07, 0.24), white); sill.position.set(0, -0.7, 0.1);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.08), white); top.position.set(0, 0.76, 0.04);
    wg.add(gl, ...fr, sill, top);
    for (const sx of [-1, 1]) { const s = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.55, 1.3, 0.04), 0.55, 1.3, 0.04, 1.2), shut); s.position.set(sx * 0.92, 0, 0.03); wg.add(s); }
    wg.position.set(x, 0.45 + 1.65, z); wg.rotation.y = ry;
    g.add(wg);
  };
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) win(sx * (w / 2 + 0.01), -d / 4 + k * d / 2, sx * Math.PI / 2);
  win(-w * 0.2, d / 2 + 0.01, 0);
  // дверь с крыльцом и козырьком, труба
  const door = new THREE.Mesh(boxUV(new THREE.BoxGeometry(1.0, 2.05, 0.06), 1, 2.05, 0.06, 1.2, true),
    pbr(base, 'white_planks_clean', { color: ['#6b4a2f', '#3f5b3a', '#7a2f2a'][Math.floor(r() * 3)] }));
  door.position.set(w * 0.22, 0.45 + 1.02 + 0.05, d / 2 + 0.03);
  const porch = new THREE.Mesh(boxUV(new THREE.BoxGeometry(1.8, 0.5, 1.1), 1.8, 0.5, 1.1, 1.2), pbr(base, 'weathered_plank_siding', { color: '#b8a58c' }));
  porch.position.set(w * 0.22, 0.25, d / 2 + 0.55);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.2), roofMat); canopy.position.set(w * 0.22, 0.45 + 2.45, d / 2 + 0.55); canopy.rotation.x = 0.18;
  const chim = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.55, 1.6, 0.55), 0.55, 1.6, 0.55, 1.6), pbr(base, 'brick_wall_001'));
  chim.position.set(-w * 0.2, h + 0.45 + 1.5, -d * 0.15);
  g.add(body, plinth, roof, door, porch, canopy, chim);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.size = { w, d };
  return g;
}

// деревянный забор вдоль X длиной len (штакетник)
function fence(len, r) {
  const g = new THREE.Group();
  const col = ['#8b6a45', '#6f8a5a', '#a9a39a'][Math.floor(r() * 3)];
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
  const n = Math.floor(len / 0.16);
  const pick = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1.25, 0.025), mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { m.makeTranslation(-len / 2 + i * 0.16, 0.62 + (r() - 0.5) * 0.04, 0); pick.setMatrixAt(i, m); }
  for (const y of [0.35, 0.95]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.04), mat); rail.position.set(0, y, -0.03); g.add(rail); }
  g.add(pick);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// столбы ЛЭП вдоль дороги с провисающими проводами
function powerLine(g, x, z0, z1, step = 34) {
  const wood = new THREE.MeshStandardMaterial({ color: '#5f4a36', roughness: 0.9 });
  const wire = new THREE.MeshStandardMaterial({ color: '#1d1d1d', roughness: 0.6 });
  const tops = [];
  for (let z = z0; z <= z1; z += step) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 8.5, 8), wood);
    pole.position.set(x, 4.25, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), wood);
    arm.position.set(x, 8.1, z);
    for (const o of [pole, arm]) { o.castShadow = true; g.add(o); }
    tops.push(z);
  }
  for (const dx of [-0.7, 0, 0.7]) for (let i = 0; i + 1 < tops.length; i++) {
    const a = new THREE.Vector3(x + dx, 8.2, tops[i]), b = new THREE.Vector3(x + dx, 8.2, tops[i + 1]);
    const mid = a.clone().lerp(b, 0.5); mid.y -= 0.9;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 16, 0.012, 4), wire);
    g.add(tube);
  }
}

// сигнальные столбики по краю обочины (белые с чёрной полосой)
function delineators(g, x, z0, z1, step = 25, skip = () => false) {
  const n = Math.ceil((z1 - z0) / step);
  const white = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 }), n);
  const band = new THREE.InstancedMesh(new THREE.BoxGeometry(0.125, 0.18, 0.125), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.5 }), n);
  const m = new THREE.Matrix4(); let k = 0;
  for (let z = z0; z < z1 && k < n; z += step) {
    if (skip(z)) continue;
    m.makeTranslation(x, 0.4, z); white.setMatrixAt(k, m);
    m.makeTranslation(x, 0.62, z); band.setMatrixAt(k, m); k++;
  }
  white.count = band.count = k;
  for (const o of [white, band]) { o.castShadow = true; g.add(o); }
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
    map: tex(base, 'grass_summer_diff.jpg', [350, 350], true), normalMap: tex(base, 'grass_ground_nor.jpg', [350, 350]),
    roughness: 1, color: 0xffffff,
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
      map: tex(base, 'gravel_grey_diff.jpg', [sh / 2, L], true), normalMap: tex(base, 'gravel_nor.jpg', [sh / 2, L]), roughness: 1,
      color: 0xd8d6cc,   // щебёнка серо-бежевая (текстура обесцвечена), без розового
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
        map: tex(base, 'gravel_grey_diff.jpg', [7, 1.1], true), roughness: 1, color: 0xcfc8b8 }));
      p.rotation.x = -Math.PI / 2; p.position.set(sx * (half + sh + 7), 0.006, o.crosswalkAt); p.receiveShadow = true;
      g.add(p);
    }
  }

  // растительность: трава у дороги, кусты, сосны и ели дальше, камни
  const keepOut = (x, z) => o.crosswalkAt !== undefined && Math.abs(z - o.crosswalkAt) < 3.5 && Math.abs(x) < half + sh + 15;
  const grass = [], bermuda = [], shrubs = [], bushes = [], pines = [], spruces = [], broad = [], rocks = [];
  const span = o.vegSpan || 160;
  const side = () => (r() < 0.5 ? -1 : 1);
  // трава ровным плотным ковром: сетка с джиттером, ближе к дороге чаще; пучок не заходит на обочину
  const edge = half + sh;
  const gs = o.grassStep ?? 0.32;
  for (const [x0, x1, step] of [[0, 10, gs], [10, 22, gs * 1.5], [22, 42, gs * 2.6]]) {
    for (let z = -span; z < span; z += step) for (let dx = x0; dx < x1; dx += step) for (const sx of [-1, 1]) {
      const sc = 1.5 + r() * 1.1;
      const x = sx * (edge + 0.12 * sc + dx + r() * step), zz = z + r() * step;
      if (!keepOut(x, zz)) grass.push(M4(x, 0, zz, r() * 6.28, sc));
    }
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
    scatterModel(g, base, 'ph/grass_medium_01/grass_medium_01_1k.gltf', grass, { variants: true, minH: 0.09, skip: /tall/ }),
    scatterModel(g, base, 'ph/grass_bermuda_01/grass_bermuda_01_1k.gltf', bermuda, { variants: true }),
    scatterModel(g, base, 'shrub', shrubs),
    scatterImpostor(g, base, 'pine', pines), scatterImpostor(g, base, 'spruce', spruces), scatterImpostor(g, base, 'broadleaf', broad),
    scatterModel(g, base, 'ph/boulder_01/boulder_01_1k.gltf', rocks),
  ]);

  // посёлок у перехода
  if (o.houses !== false && o.crosswalkAt !== undefined) {
    for (const [x, z, ry] of o.housesAt || [[-19, o.crosswalkAt - 16, 0.1], [21, o.crosswalkAt + 14, -0.15], [-22, o.crosswalkAt + 22, 0.05], [24, o.crosswalkAt - 26, 0.2]]) {
      const h = house(r, base); h.position.set(x, 0, z); h.rotation.y = ry; g.add(h);
      // забор между домом и дорогой
      if (o.fences !== false) {
        const f = fence(h.userData.size.d + 6, r);
        f.rotation.y = Math.PI / 2 + ry; f.position.set(x - Math.sign(x) * (h.userData.size.w / 2 + 2.5), 0, z); g.add(f);
      }
    }
  }
  if (o.details !== false) {
    const nearCross = z => o.crosswalkAt !== undefined && Math.abs(z - o.crosswalkAt) < 14;
    powerLine(g, -(half + sh + 4.5), -L * 0.8, L * 0.8);
    for (const sx of [-1, 1]) delineators(g, sx * (half + sh - 0.25), -L * 0.8 + (sx > 0 ? 12 : 0), L * 0.8, 25, nearCross);
  }

  g.userData = { ...g.userData, kind: 'real', half };
  return g;
}

// ---------- машины из Blender ----------
// Перед модели должен смотреть в −Z. У кого в файле иначе — доворачиваем здесь,
// иначе машина «едет задом» (фургон из scene.blend экспортирован передом в +Z).
export const MODEL_YAW = { van: Math.PI };
// треугольник «У» учебной машины на крышу
function schoolSign(size) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const tri = (pad) => { x.beginPath(); x.moveTo(128, pad); x.lineTo(256 - pad * 0.9, 236 - pad * 0.45); x.lineTo(pad * 0.9, 236 - pad * 0.45); x.closePath(); };
  x.fillStyle = '#d4161c'; tri(8); x.fill();
  x.fillStyle = '#ffffff'; tri(40); x.fill();
  x.fillStyle = '#111'; x.font = '900 112px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('У', 128, 160);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5 }));
  face.position.y = 0.26; face.castShadow = true;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.6 }));
  stand.position.y = 0.025;
  g.add(face, stand);
  g.position.set(0, size.y + 0.0, 0.25);
  return g;
}

// колёса: в Гранте узлы wheel_FL…/steer_F*, у остальных собираем шины и диски в кластеры по углам
const WHEEL_RE = /wheelmesh|wheel_?mesh|tyre|tire|_rim|rim_|rim$/i;
const NOT_WHEEL_RE = /house|arch|steering|perimeter|outlet|column|hub|spoke/i;
function rigWheels(car, yaw) {
  car.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(car.matrixWorld).invert();
  const list = [];
  const named = ['FL', 'FR', 'RL', 'RR'].map(k => car.getObjectByName('wheel_' + k)).filter(Boolean);
  if (named.length === 4) {
    for (const w of named) {
      const b = new THREE.Box3().setFromObject(w).applyMatrix4(inv);
      const st = /^steer_/.test(w.parent?.name || '') ? w.parent : null;
      list.push({ node: w, steer: st, r: b.getSize(new THREE.Vector3()).y / 2 });
    }
    return { list, sign: 1 };
  }
  const parts = [];
  car.traverse(o => { if (o.isMesh && WHEEL_RE.test(o.name) && !NOT_WHEEL_RE.test(o.name)) parts.push(o); });
  const cl = [];
  for (const p of parts) {
    const b = new THREE.Box3().setFromObject(p).applyMatrix4(inv);
    const c = b.getCenter(new THREE.Vector3());
    let k = cl.find(q => q.c.distanceTo(c) < 0.4);
    if (!k) cl.push(k = { c, box: b.clone(), meshes: [] }); else k.box.union(b);
    k.meshes.push(p);
  }
  if (cl.length < 2 || cl.length > 6) return { list, sign: 1 };
  for (const k of cl) {
    const pivot = new THREE.Group(); pivot.name = 'wheelPivot';
    pivot.position.copy(k.box.getCenter(new THREE.Vector3()));
    car.add(pivot); pivot.updateMatrixWorld(true);
    for (const m of k.meshes) pivot.attach(m);
    list.push({ node: pivot, steer: null, r: k.box.getSize(new THREE.Vector3()).y / 2 });
  }
  return { list, sign: Math.abs(yaw) > 1 ? -1 : 1 };
}

export async function carModel(base, { model = 'priora', color, duck, school } = {}) {
  const src = await loadGLB(base, model);
  const car = src.clone(true);
  car.rotation.y += MODEL_YAW[model] || 0;
  const wheels = rigWheels(car, MODEL_YAW[model] || 0);
  // перекраска кузова, если задан цвет
  // у Гранты свой цвет эмали из Blender; «Factory silver painted steel» — это диски, их не трогаем
  if (color && model !== 'granta') car.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map(m => {
      // только кузов: у Приоры «Silver saloon paint», а «M_0131_Silver» — это диски
      if (/paint|body|kuzov/i.test(m.name || '')) {
        const c = m.clone(); c.color = new THREE.Color(color);
        c.metalness = Math.min(c.metalness ?? 0, 0.25); c.roughness = Math.max(c.roughness ?? 0.3, 0.32); // яркая эмаль, а не горчичный металлик
        return c;
      }
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
  // свои фонари поворотников в модели (Гранта: ind_L_front, ind_R_rear…) — светим ими, шар прячем
  const own = {};
  car.traverse(o => {
    const m = /^ind_([LR])_(front|rear|mirror)/.exec(o.name || ''); if (!m || !o.isMesh) return;
    o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff7a00); o.material.emissiveIntensity = 0;
    const k = (m[2] === 'rear' ? 'R' : 'F') + m[1];
    (own[k] ||= []).push(o);
  });
  car.updateMatrixWorld(true);
  for (const [k, list] of Object.entries(own)) {
    const lamp = sig[k]; if (!lamp) continue;
    const main = list.find(o => !/mirror/.test(o.name)) || list[0];
    const c = new THREE.Box3().setFromObject(main).getCenter(new THREE.Vector3());
    lamp.position.copy(g.worldToLocal(c));
    lamp.scale.setScalar(0.35); lamp.userData.glow.scale.setScalar(0.9 / 0.35 * 0.55);
    lamp.userData.extra = list;
  }
  g.userData.signals = sig;
  g.userData.size = size;
  g.userData.wheels = wheels;
  let ownSticker = false; car.traverse(o => { if (/learner/i.test(o.name || '')) ownSticker = true; });
  if (school && !ownSticker) g.add(schoolSign(size));
  // место водителя: у Гранты утка в Blender сидела в x −0.35, низ 0.66 м, центр 0.96 м
  if (duck) g.userData.duckSeat = model === 'granta' ? new THREE.Vector3(-0.35, 0.95, -0.04) : new THREE.Vector3(-0.36, size.y * 0.62, -0.05);
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
  // без тонмаппинга и тумана: утка остаётся яркой, как в стикере
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.05, toneMapped: false, fog: false });
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
