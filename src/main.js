import * as THREE from '../vendor/three.module.js';
import { COLORS, PRESETS, WARM_MESSAGES, cleanMessage } from './data.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { makeCoverDemos } from './cover-shot.js';
import { installStudio } from './studio.js';

// ---------------------------------------------------------------- rng
let rngState = 1;
function reseed(seed) { rngState = (seed >>> 0) || 1; }
function rng() { // mulberry32
  rngState = (rngState + 0x6D2B79F5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rng();

// ---------------------------------------------------------------- persistence
const SAVE_KEY = 'wishLanterns.v1';
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { launched: s.launched | 0, hearts: s.hearts | 0, received: s.received | 0, hidden: s.hidden || [], hearted: s.hearted || [], mine: s.mine || [] };
  } catch { return { launched: 0, hearts: 0, received: 0, hidden: [], hearted: [], mine: [] }; }
}
let save = loadSave();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x15122c, 0.0042);
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1200);
const CAM_BASE = new THREE.Vector3(0, 3.4, 25);
const CAM_TARGET = new THREE.Vector3(0, 5.5, -60);
camera.position.copy(CAM_BASE);

const LAKE = { cx: 0, cz: -70, rx: 76, rz: 88 };
function lakeE(x, z) { const a = (x - LAKE.cx) / LAKE.rx, b = (z - LAKE.cz) / LAKE.rz; return a * a + b * b; }

const uniforms = { time: { value: 0 }, camPos: { value: new THREE.Vector3() } };

const GLSL_COMMON = /* glsl */`
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*noise3(p); p *= 2.03; a *= 0.5; } return s; }
vec3 skyColor(vec3 dir, float t, float starAmt){
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 zen = vec3(0.010, 0.016, 0.060);
  vec3 mid = vec3(0.040, 0.048, 0.150);
  vec3 hor = vec3(0.260, 0.140, 0.230);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.16, h));
  col = mix(col, zen, smoothstep(0.14, 0.75, h));
  vec2 hz = normalize(vec2(dir.x, dir.z) + 1e-5);
  float g = pow(max(0.0, -hz.y), 3.0) * exp(-h * 10.0);
  col += vec3(0.40, 0.18, 0.08) * g * 0.55;
  vec3 bn = normalize(vec3(0.62, 0.30, 0.72));
  float bd = dot(dir, bn);
  float band = exp(-bd*bd / 0.025) * smoothstep(0.0, 0.25, h);
  float n = fbm(dir * 5.0);
  float n2 = fbm(dir * 16.0 + 3.0);
  col += vec3(0.15, 0.13, 0.26) * band * smoothstep(0.30, 0.85, n) * 1.3;
  col += vec3(0.20, 0.12, 0.10) * band * smoothstep(0.60, 0.95, n) * 0.6;
  col *= 1.0 - 0.45 * band * smoothstep(0.52, 0.72, n2);
  vec3 p = dir * 230.0;
  vec3 c = floor(p);
  float hs = hash13(c);
  float thr = 0.982 - band * 0.02;
  if (hs > thr) {
    vec3 sp = c + 0.5 + (vec3(hash13(c+1.7), hash13(c+2.3), hash13(c+3.1)) - 0.5) * 0.5;
    float d = length(p - sp);
    float s = (hs - thr) / (1.0 - thr);
    float tw = 0.65 + 0.35 * sin(t * (1.0 + s * 3.0) + hs * 50.0);
    col += vec3(1.0, 0.94, 0.84) * smoothstep(0.42, 0.0, d) * tw * (0.35 + s * 2.2) * starAmt * smoothstep(0.0, 0.08, h);
  }
  return max(col, 0.0);
}`;

// sky dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
  uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float time; varying vec3 vDir; ${GLSL_COMMON}
    void main(){ gl_FragColor = vec4(skyColor(normalize(vDir), time, 1.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -20;
scene.add(sky);

// water
const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), new THREE.ShaderMaterial({
  uniforms, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float time; uniform vec3 camPos; varying vec3 vW; ${GLSL_COMMON}
    void main(){
      vec3 v = normalize(camPos - vW);
      vec2 p = vW.xz; float t = time;
      float dist = length(vW - camPos);
      float k = 1.0 / (1.0 + dist * 0.02);
      vec2 g = vec2(0.0);
      g += vec2(cos(p.x*0.31 + t*0.55), cos(p.y*0.47 + t*0.42)) * 0.035;
      g += vec2(cos(p.x*1.05 - p.y*0.66 + t*1.05), cos(p.y*1.27 + p.x*0.41 - t*0.86)) * 0.022 * k;
      g += (vec2(noise3(vec3(p*0.9, t*0.35)), noise3(vec3(p*0.9 + 9.0, t*0.35))) - 0.5) * 0.06 * k;
      vec3 n = normalize(vec3(g.x, 1.0, g.y));
      vec3 r = reflect(-v, n); r.y = abs(r.y);
      vec3 refl = skyColor(normalize(r), t, 0.8);
      float fres = 0.05 + 0.95 * pow(1.0 - max(dot(v, n), 0.0), 5.0);
      vec3 deep = vec3(0.004, 0.009, 0.026);
      vec3 col = mix(deep, refl * 0.8, clamp(fres * 0.85 + 0.1, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
water.rotation.x = -Math.PI / 2;
water.renderOrder = -10;
scene.add(water);

// ---------------------------------------------------------------- static world (built once, fixed seed)
function buildWorld() {
  reseed(7);
  // ground with a lake-shaped hole
  const outer = new THREE.Shape();
  outer.moveTo(-700, -700); outer.lineTo(700, -700); outer.lineTo(700, 700); outer.lineTo(-700, 700); outer.lineTo(-700, -700);
  const hole = new THREE.Path();
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const w = 1 + 0.035 * Math.sin(a * 5 + 1.3) + 0.02 * Math.sin(a * 11 + 0.4);
    const x = LAKE.cx + Math.cos(a) * LAKE.rx * w;
    const z = LAKE.cz + Math.sin(a) * LAKE.rz * w;
    if (i === 0) hole.moveTo(x, -z); else hole.lineTo(x, -z);
  }
  outer.holes.push(hole);
  const ground = new THREE.Mesh(new THREE.ShapeGeometry(outer, 2), new THREE.MeshBasicMaterial({ color: 0x080a16 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = 0.12;
  scene.add(ground);

  // hill rings
  function ring(radius, hBase, hAmp, color, seg) {
    const pos = [], idx = [];
    const ph = [rr(0, 6), rr(0, 6), rr(0, 6), rr(0, 6)];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const h = hBase + hAmp * (0.5 * Math.sin(a * 3 + ph[0]) + 0.3 * Math.sin(a * 7 + ph[1]) + 0.15 * Math.sin(a * 17 + ph[2]) + 0.08 * Math.sin(a * 41 + ph[3]));
      const rad = radius * (1 + 0.06 * Math.sin(a * 4 + ph[1]));
      const x = LAKE.cx + Math.cos(a) * rad, z = LAKE.cz + Math.sin(a) * rad;
      pos.push(x, -2, z, x, Math.max(1, h), z);
      if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    scene.add(m);
    return m;
  }
  ring(300, 34, 30, 0x0d1230, 160);
  ring(200, 16, 16, 0x090d22, 140);

  // pines
  const treeGeo = new THREE.ConeGeometry(1, 1, 6); treeGeo.translate(0, 0.5, 0);
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshBasicMaterial({ color: 0x05070f }), 520);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  while (n < 520) {
    let x, z;
    if (n < 380) { // ring around the lake shore
      const a = rng() * Math.PI * 2, k = rr(1.12, 1.9);
      x = LAKE.cx + Math.cos(a) * LAKE.rx * k; z = LAKE.cz + Math.sin(a) * LAKE.rz * k;
      if (z > 6 && Math.abs(x) < 26) continue; // keep the view open in front of the camera
      if (z > 14) continue;
    } else { // far shore crowd
      const a = rr(-Math.PI * 0.95, -Math.PI * 0.05), rad = rr(150, 195);
      x = LAKE.cx + Math.cos(a) * rad; z = LAKE.cz + Math.sin(a) * rad;
    }
    const h = rr(5, 12) * (n >= 380 ? 1.6 : 1), r = h * rr(0.22, 0.3);
    p.set(x, 0, z); s.set(r, h, r);
    m4.compose(p, q, s); trees.setMatrixAt(n++, m4);
  }
  scene.add(trees);

  // reeds along the near shore, swaying
  const reedGeo = new THREE.PlaneGeometry(0.09, 1, 1, 4); reedGeo.translate(0, 0.5, 0);
  const REEDS = 900;
  const reeds = new THREE.InstancedMesh(reedGeo, new THREE.ShaderMaterial({
    uniforms, side: THREE.DoubleSide,
    vertexShader: `uniform float time; void main(){
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      float h = position.y;
      w.x += sin(time * 1.1 + w.x * 0.6 + w.z * 0.3) * 0.18 * h * h;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `void main(){ gl_FragColor = vec4(0.012, 0.016, 0.03, 1.0); }`,
  }), REEDS);
  let nReeds = 0;
  for (let i = 0; i < REEDS; i++) {
    const a = rr(Math.PI * 0.12, Math.PI * 0.88);
    const k = rr(0.97, 1.08);
    const x = LAKE.cx + Math.cos(a) * LAKE.rx * k, z = LAKE.cz + Math.sin(a) * LAKE.rz * k;
    if (Math.abs(x) < 12 || (Math.abs(x) < 20 && rng() < 0.8)) continue;
    const near = z > 5 ? 1 : 0.6; nReeds++;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, Math.PI));
    p.set(x, 0, z); s.set(rr(0.8, 1.4), rr(0.8, 2.4) * near, 1);
    m4.compose(p, q, s); reeds.setMatrixAt(nReeds - 1, m4);
  }
  reeds.count = nReeds;
  scene.add(reeds);

  // fireflies
  const FF = 110;
  const fpos = new Float32Array(FF * 3), fseed = new Float32Array(FF * 4);
  for (let i = 0; i < FF; i++) {
    const a = rr(Math.PI * 0.05, Math.PI * 0.95), k = rr(0.85, 1.25);
    fpos[i * 3] = LAKE.cx + Math.cos(a) * LAKE.rx * k;
    fpos[i * 3 + 1] = rr(0.4, 3.5);
    fpos[i * 3 + 2] = LAKE.cz + Math.sin(a) * LAKE.rz * k;
    for (let j = 0; j < 4; j++) fseed[i * 4 + j] = rng();
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fg.setAttribute('aSeed', new THREE.BufferAttribute(fseed, 4));
  const ff = new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float time; attribute vec4 aSeed; varying float vB;
      void main(){
        vec3 p = position;
        p += vec3(sin(time*0.3*(0.5+aSeed.x) + aSeed.y*6.28)*1.8, sin(time*0.5*(0.5+aSeed.z) + aSeed.w*6.28)*0.6, cos(time*0.27*(0.5+aSeed.y) + aSeed.x*6.28)*1.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vB = pow(0.5 + 0.5*sin(time*(0.8 + aSeed.z*1.5) + aSeed.x*40.0), 3.0);
        gl_PointSize = (70.0 / -mv.z) * (0.4 + vB) * ${renderer.getPixelRatio().toFixed(1)};
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vB; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a*a;
      gl_FragColor = vec4(vec3(1.0, 0.92, 0.45) * a * (0.25 + vB*1.2), 1.0); }`,
  }));
  scene.add(ff);
}
buildWorld();

// ---------------------------------------------------------------- lanterns
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW = glowTexture();

function gradientColors(geo, color, top, bottom) {
  const pos = geo.attributes.position; const cols = new Float32Array(pos.count * 3);
  geo.computeBoundingBox(); const y0 = geo.boundingBox.min.y, y1 = geo.boundingBox.max.y;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) - y0) / (y1 - y0 || 1);
    c.copy(color).multiplyScalar(bottom + (top - bottom) * k);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

const GEO = {
  box: new THREE.BoxGeometry(0.62, 0.62, 0.62, 1, 3, 1).translate(0, 0.42, 0),
  base: new THREE.BoxGeometry(0.86, 0.1, 0.86).translate(0, 0.06, 0),
  frame: new THREE.BoxGeometry(0.7, 0.05, 0.7).translate(0, 0.75, 0),
  sky: new THREE.LatheGeometry([
    new THREE.Vector2(0.0, 1.05), new THREE.Vector2(0.3, 1.02), new THREE.Vector2(0.43, 0.8), new THREE.Vector2(0.47, 0.5),
    new THREE.Vector2(0.42, 0.2), new THREE.Vector2(0.34, 0.0),
  ], 10),
};
const darkMat = new THREE.MeshBasicMaterial({ color: 0x1a0f08 });

const lanterns = [];
const lanternGroup = new THREE.Group(); scene.add(lanternGroup);

function makeLantern(opts) {
  const col = COLORS.find(c => c.id === opts.color) || COLORS[0];
  const color = new THREE.Color(col.hex);
  const g = new THREE.Group();
  const paper = (opts.mode === 'water' ? GEO.box : GEO.sky).clone();
  gradientColors(paper, color.clone().lerp(new THREE.Color(0xffd9a0), 0.12), 0.55, opts.mode === 'water' ? 1.2 : 1.1);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.96, side: THREE.DoubleSide, fog: false });
  g.add(new THREE.Mesh(paper, mat));
  if (opts.mode === 'water') { g.add(new THREE.Mesh(GEO.base, darkMat)); g.add(new THREE.Mesh(GEO.frame, darkMat)); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 }));
  glow.scale.setScalar(4.2); glow.position.y = 0.45;
  g.scale.setScalar(opts.mode === 'water' ? 1.5 : 1.7);
  g.add(glow);
  const refl = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.45 }));
  lanternGroup.add(g); lanternGroup.add(refl);
  const L = {
    id: opts.id, mine: !!opts.mine, who: opts.who || '', text: opts.text || '', color: col.id, mode: opts.mode,
    hearts: opts.hearts | 0, group: g, mat, glow, refl,
    x: opts.x, y: opts.y, z: opts.z, vx: opts.vx || 0, vz: opts.vz || 0, vy: opts.vy || 0,
    ph: rng() * 100, ph2: rng() * 100, speed: rr(0.5, 1), alpha: opts.alpha ?? 1, fadeIn: opts.fadeIn || 0,
    rot: rng() * Math.PI * 2, selected: 0, fresh: opts.fresh || 0,
  };
  g.rotation.y = L.rot;
  lanterns.push(L);
  return L;
}

function removeLantern(L) {
  lanternGroup.remove(L.group); lanternGroup.remove(L.refl);
  L.mat.dispose(); L.glow.material.dispose(); L.refl.material.dispose();
  L.group.children[0].geometry.dispose();
  lanterns.splice(lanterns.indexOf(L), 1);
}

function randomLakePoint(margin = 0.86, zMax = 6) {
  for (let i = 0; i < 50; i++) {
    const x = rr(-LAKE.rx, LAKE.rx), z = LAKE.cz + LAKE.rz - Math.pow(rng(), 1.6) * 2 * LAKE.rz;
    if (lakeE(x, z) < margin && z < zMax) return [x, z];
  }
  return [0, -70];
}

function pickColor() { // warm-heavy mix
  const r = rng();
  return r < 0.46 ? 'amber' : r < 0.66 ? 'rose' : r < 0.78 ? 'sky' : r < 0.89 ? 'mint' : 'lilac';
}

function populate() {
  for (const L of [...lanterns]) removeLantern(L);
  const msgs = WARM_MESSAGES;
  for (let i = 0; i < msgs.length; i++) {
    const id = 'v' + i;
    if (save.hidden.includes(id)) continue;
    const mode = i % 3 === 2 ? 'sky' : 'water';
    const color = pickColor();
    if (mode === 'water') {
      const [x, z] = randomLakePoint();
      makeLantern({ id, text: msgs[i], color, mode, x, y: 0, z, hearts: 1 + Math.floor(rng() * 14) });
    } else {
      const [x, z] = randomLakePoint(0.9, -15);
      makeLantern({ id, text: msgs[i], color, mode, x, y: rr(4, 90), z, hearts: 1 + Math.floor(rng() * 14) });
    }
  }
  // extra wordless background lanterns so the lake always feels full
  for (let i = 0; i < 16; i++) {
    const id = 'b' + i;
    if (save.hidden.includes(id)) continue;
    const mode = i % 2 ? 'sky' : 'water';
    const color = pickColor();
    const [x, z] = randomLakePoint(0.9, mode === 'sky' ? -30 : -20);
    makeLantern({ id, text: '', color, mode, x, y: mode === 'sky' ? rr(10, 120) : 0, z, hearts: Math.floor(rng() * 6) });
  }
  for (const m of save.mine) {
    if (save.hidden.includes(m.id)) continue;
    const [x, z] = randomLakePoint(0.8, -5);
    makeLantern({ ...m, mine: true, x, y: m.mode === 'sky' ? rr(6, 60) : 0, z });
  }
}

// ---------------------------------------------------------------- particles (heart sparkle) + shooting star
const sparks = [];
function burst(L) {
  const base = new THREE.Vector3(L.x, L.y + 0.5, L.z);
  for (let i = 0; i < 22; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: i % 2 ? 0xffb3c6 : 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.copy(base); s.scale.setScalar(0.6);
    const a = rng() * Math.PI * 2, e = rr(-0.3, 1);
    s.userData = { v: new THREE.Vector3(Math.cos(a) * 1.6, 1.2 + e * 1.4, Math.sin(a) * 1.6), life: 1.4 + rng() * 0.6, t: 0 };
    scene.add(s); sparks.push(s);
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i], u = s.userData;
    u.t += dt; s.position.addScaledVector(u.v, dt); u.v.multiplyScalar(1 - dt * 1.5); u.v.y += dt * 0.3;
    const k = 1 - u.t / u.life; s.material.opacity = Math.max(0, k);
    if (u.t >= u.life) { scene.remove(s); s.material.dispose(); sparks.splice(i, 1); }
  }
}

const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 0.95, 0.85, 0, 0, 0]), 3));
const shootingStar = new THREE.Line(starGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
shootingStar.visible = false; shootingStar.frustumCulled = false;
scene.add(shootingStar);
let star = null, nextStar = 8;
function updateStar(dt) {
  nextStar -= dt;
  if (!star && nextStar <= 0) {
    const a = rr(-0.9, 0.9);
    const start = new THREE.Vector3(Math.sin(a) * 300, rr(110, 200), -260 + rr(-40, 40));
    const dir = new THREE.Vector3(rr(-1, 1), rr(-0.55, -0.25), rr(-0.2, 0.2)).normalize();
    star = { p: start, d: dir, t: 0, life: 0.9 };
    nextStar = rr(14, 30);
  }
  if (star) {
    star.t += dt;
    const head = star.p.clone().addScaledVector(star.d, star.t * 260);
    const tail = head.clone().addScaledVector(star.d, -40 * Math.min(1, star.t * 4));
    const pa = starGeo.attributes.position.array;
    pa[0] = head.x; pa[1] = head.y; pa[2] = head.z; pa[3] = tail.x; pa[4] = tail.y; pa[5] = tail.z;
    starGeo.attributes.position.needsUpdate = true;
    shootingStar.visible = true;
    shootingStar.material.opacity = Math.sin(Math.PI * Math.min(1, star.t / star.life));
    if (star.t >= star.life) { star = null; shootingStar.visible = false; }
  }
}

// ---------------------------------------------------------------- simulation
let T = 0;
function updateLanterns(dt) {
  for (const L of lanterns) {
    if (L.fadeIn > 0) { L.alpha = Math.min(1, L.alpha + dt / L.fadeIn); if (L.alpha >= 1) L.fadeIn = 0; }
    if (L.fresh > 0) L.fresh = Math.max(0, L.fresh - dt);
    if (L.mode === 'water') {
      const wx = Math.sin(T * 0.06 + L.ph) * 0.22 + Math.sin(L.z * 0.04 + T * 0.03) * 0.12;
      const wz = Math.cos(T * 0.05 + L.ph2) * 0.22 - 0.04;
      L.vx += (wx - L.vx) * dt * 0.25; L.vz += (wz - L.vz) * dt * 0.25;
      const e = lakeE(L.x, L.z);
      if (e > 0.78) {
        const k = (e - 0.78) * 1.4;
        L.vx -= (L.x - LAKE.cx) / LAKE.rx * k * dt * 2; L.vz -= (L.z - LAKE.cz) / LAKE.rz * k * dt * 2;
      }
      L.x += L.vx * dt; L.z += L.vz * dt;
      L.y = 0.03 + Math.sin(T * 1.3 + L.ph) * 0.05;
      L.group.rotation.set(Math.sin(T * 1.1 + L.ph) * 0.05, L.rot + T * 0.02, Math.cos(T * 0.9 + L.ph2) * 0.05);
    } else {
      L.vy += ((0.35 + L.speed * 0.45) - L.vy) * dt * 0.5;
      L.y += L.vy * dt;
      L.x += (Math.sin(T * 0.2 + L.ph) * 0.25 + L.vx) * dt;
      L.z += (-0.25 + L.vz) * dt;
      L.vx *= 1 - dt * 0.3; L.vz *= 1 - dt * 0.3;
      L.group.rotation.set(Math.sin(T * 0.7 + L.ph) * 0.06, L.rot + T * 0.05, Math.cos(T * 0.6 + L.ph2) * 0.06);
      if (L.y > 160) { // drifted out of sight: recycle low over the lake
        const [x, z] = randomLakePoint(0.9, -25);
        L.x = x; L.z = z; L.y = rr(3, 8); L.vy = 0.2; L.alpha = 0; L.fadeIn = 4;
      }
    }
    const flick = 0.88 + 0.08 * Math.sin(T * 7.3 + L.ph) + 0.05 * Math.sin(T * 13.1 + L.ph2);
    const sel = L.selected ? 1 + 0.25 * Math.sin(T * 5) + 0.4 : 1;
    const fresh = 1 + L.fresh * 0.25;
    L.group.position.set(L.x, L.y, L.z);
    L.mat.opacity = 0.96 * L.alpha;
    L.glow.material.opacity = 0.8 * flick * L.alpha * Math.min(1.6, sel);
    L.glow.scale.setScalar((L.mode === 'water' ? 3.4 : 3.6) * sel * fresh);
    if (L.mode === 'water') {
      L.refl.position.set(L.x, -2.2, L.z);
      L.refl.scale.set(3.2 + Math.sin(T * 2 + L.ph) * 0.4, 8, 1);
      L.refl.material.opacity = 0.6 * flick * L.alpha;
    } else {
      L.refl.position.set(L.x, -L.y - 0.5, L.z);
      L.refl.scale.set(3.4, 6, 1);
      L.refl.material.opacity = 0.22 * flick * L.alpha * (lakeE(L.x, L.z) < 1 ? 1 : 0);
    }
  }
}

const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
let debugCam = null;
function updateCamera(dt) {
  if (debugCam) {
    camera.position.copy(debugCam.pos); camera.lookAt(debugCam.target);
  } else {
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 1.5);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 1.5);
    camera.position.set(CAM_BASE.x + pointer.sx * 1.4 + Math.sin(T * 0.13) * 0.3, CAM_BASE.y - pointer.sy * 0.5 + Math.sin(T * 0.21) * 0.08, CAM_BASE.z);
    camera.lookAt(CAM_TARGET.x + pointer.sx * 3, CAM_TARGET.y - pointer.sy * 2, CAM_TARGET.z);
  }
  sky.position.copy(camera.position);
  uniforms.camPos.value.copy(camera.position);
}

function update(dt) {
  T += dt;
  uniforms.time.value = T;
  updateLanterns(dt);
  updateSparks(dt);
  updateStar(dt);
}

function render(dt = 0) {
  updateCamera(dt);
  renderer.render(scene, camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 68 : 52;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const audio = new Audio();
let screen = 'title';
let selected = null;
let composeColor = COLORS[0].id, composeMode = 'water';

let online = 0;
function updateStats() {
  const people = online > 1 ? `🌙 지금 호수에 ${online}명 · ` : '';
  const got = save.received ? ` · 받은 반짝임 ${save.received}` : '';
  $('stats').textContent = `${people}띄운 등불 ${save.launched} · 보낸 반짝임 ${save.hearts}${got}`;
}

// ---------------------------------------------------------------- multiplayer
let netSeed = 99991;
const nrnd = () => { netSeed = (netSeed * 1664525 + 1013904223) >>> 0; return netSeed / 4294967296; };
let lastArrivalToast = 0;
const net = new Net({
  onLantern(e, who, fresh) {
    if (save.hidden.includes(e.netId) || lanterns.some(l => l.id === e.netId)) return;
    const text = cleanMessage(e.text);
    const water = e.mode === 'water';
    let x, z, y;
    if (fresh) { // launched just now by someone on the shore: comes in from the near edge
      x = (nrnd() - 0.5) * 50; z = water ? 12 : 2; y = water ? 0 : 1;
    } else {
      for (let i = 0; i < 30; i++) {
        x = (nrnd() * 2 - 1) * LAKE.rx; z = LAKE.cz + (nrnd() * 2 - 1) * LAKE.rz;
        if (lakeE(x, z) < 0.8 && z < 0) break;
      }
      y = water ? 0 : 6 + nrnd() * 50;
    }
    makeLantern({ id: e.netId, who, text, color: e.color, mode: e.mode, x, y, z,
      vx: 0, vz: fresh ? (water ? -1.6 : -0.4) : 0, vy: water ? 0 : 0.5, alpha: 0, fadeIn: 2, fresh: fresh ? 5 : 0, hearts: 0 });
    if (fresh && screen !== 'title' && T - lastArrivalToast > 4) {
      lastArrivalToast = T;
      toast(text ? `누군가 「${text}」 등불을 띄웠어요` : '누군가 조용히 등불을 띄웠어요');
      audio.chime([659.25, 880], 0.12);
    }
  },
  onHeart(netId) {
    const mineKey = net.myKey ? net.myKey + ':' : null;
    const localId = mineKey && netId.startsWith(mineKey) ? netId.slice(mineKey.length) : netId;
    const L = lanterns.find(l => l.id === localId);
    if (L) { burst(L); L.hearts++; if (selected === L) refreshHeart(); }
    if (L && L.mine) {
      save.received++; persist(); updateStats();
      toast(L.text ? `누군가 「${L.text}」 등불에 ♡를 보냈어요` : '누군가 내 등불에 ♡를 보냈어요');
      audio.chime([783.99, 987.77, 1174.66]);
    }
  },
  onPresence(n) { if (n !== online) { online = n; updateStats(); } },
  onJoin() { if (screen !== 'title') toast('누군가 호숫가에 왔어요', 2400); },
  onStatus(msg) { toast(msg, 4000); },
});
net.setMine(save.mine);
setInterval(() => { net.poll(); const d = $('netline'); if (d) d.textContent = net.statusLine(); }, 250);
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function startGame() {
  if (screen !== 'title') return;
  screen = 'lake';
  audio.start();
  $('title').classList.add('fade');
  setTimeout(() => $('title').classList.add('hidden'), 1200);
  $('hud').classList.remove('hidden');
  updateStats();
  net.start();
}
$('title').addEventListener('pointerdown', startGame);

// compose panel
COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'sw' + (i === 0 ? ' on' : ''); b.style.setProperty('--c', c.css); b.title = c.name;
  b.onclick = () => { composeColor = c.id; document.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b)); audio.tick(); };
  $('swatches').appendChild(b);
});
PRESETS.forEach(p => {
  const b = document.createElement('button'); b.className = 'chip'; b.textContent = p;
  b.onclick = () => { $('msg').value = p; onMsgInput(); audio.tick(); };
  $('presets').appendChild(b);
});
function onMsgInput() { $('count').textContent = `${[...$('msg').value].length}/30`; }
$('msg').addEventListener('input', onMsgInput);
$('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendLantern(); e.stopPropagation(); });
document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
  composeMode = b.dataset.mode; document.querySelectorAll('.mode').forEach(x => x.classList.toggle('on', x === b)); audio.tick();
});
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closePanel(b.dataset.close));

function openCompose() {
  closeCard();
  $('compose').classList.remove('hidden');
  $('launchBtn').classList.add('hidden'); $('tip').classList.add('hidden');
  screen = 'compose';
  setTimeout(() => $('msg').focus(), 50);
}
function closePanel(which) {
  if (which === 'compose') { $('compose').classList.add('hidden'); $('launchBtn').classList.remove('hidden'); $('tip').classList.remove('hidden'); screen = 'lake'; }
  else closeCard();
}
$('launchBtn').onclick = () => { audio.start(); openCompose(); };
$('send').onclick = () => sendLantern();

function sendLantern() {
  const text = cleanMessage($('msg').value);
  const id = 'm' + Date.now().toString(36);
  const water = composeMode === 'water';
  const L = makeLantern({
    id, mine: true, text, color: composeColor, mode: composeMode,
    x: 0, y: water ? 0 : 0.6, z: water ? 15 : 9, vx: 0, vz: water ? -2.2 : -0.6, vy: water ? 0 : 0.9,
    alpha: 0, fadeIn: 1.2, fresh: 6,
  });
  save.mine.push({ id, text, color: composeColor, mode: composeMode });
  if (save.mine.length > 12) save.mine.shift();
  save.launched++;
  persist(); updateStats(); net.setMine(save.mine);
  $('compose').classList.add('hidden'); $('launchBtn').classList.remove('hidden'); $('tip').classList.remove('hidden'); screen = 'lake';
  $('msg').value = ''; onMsgInput();
  audio.plop();
  toast(text ? `「${text}」 등불이 천천히 떠나가요` : '등불이 조용히 떠나가요');
  return L;
}

// lantern card
function openCard(L) {
  if (selected) selected.selected = 0;
  selected = L; L.selected = 1;
  $('cardWho').textContent = L.mine ? '내가 띄운 등불' : L.who ? `${L.who}님의 등불` : '누군가의 등불';
  const m = $('cardMsg');
  if (L.text) { m.textContent = L.text; m.style.fontStyle = 'normal'; m.style.opacity = 1; }
  else { m.textContent = '말없이 띄운 등불이에요\n그 마음도 닿기를'; m.style.whiteSpace = 'pre-line'; m.style.opacity = 0.75; }
  refreshHeart();
  $('hideBtn').classList.toggle('hidden', L.mine);
  $('card').classList.remove('hidden');
  $('tip').style.opacity = 0;
  screen = 'card';
  audio.tick();
}
function refreshHeart() {
  const on = save.hearted.includes(selected.id);
  $('heartCount').textContent = selected.hearts + (on ? 1 : 0);
  $('heartBtn').classList.toggle('on', on);
  $('heartBtn').firstChild.textContent = on ? '♥ ' : '♡ ';
}
function closeCard() {
  if (selected) selected.selected = 0;
  selected = null;
  $('card').classList.add('hidden');
  if (screen === 'card') screen = 'lake';
}
$('heartBtn').onclick = () => {
  if (!selected) return;
  if (!save.hearted.includes(selected.id)) {
    save.hearted.push(selected.id); save.hearts++;
    persist(); updateStats(); refreshHeart();
    burst(selected); audio.chime([783.99, 987.77, 1174.66]);
    net.sendHeart(selected.mine ? net.netIdFor(selected.id) || selected.id : selected.id);
  } else {
    burst(selected); audio.tick();
  }
};
$('hideBtn').onclick = () => {
  if (!selected || selected.mine) return;
  save.hidden.push(selected.id); persist();
  const L = selected; closeCard(); removeLantern(L);
  toast('이 등불은 내 화면에서 숨겼어요', 2200);
};
$('mute').onclick = () => { audio.setMuted(!audio.muted); $('mute').textContent = audio.muted ? '🔇' : '🔊'; };

// picking
const tmpV = new THREE.Vector3();
function pickLantern(clientX, clientY) {
  const w = window.innerWidth, h = window.innerHeight;
  let best = null, bestD = Infinity;
  for (const L of lanterns) {
    if (L.alpha < 0.3) continue;
    tmpV.set(L.x, L.y + 0.45, L.z);
    const dist = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    if (tmpV.z > 1) continue;
    const sx = (tmpV.x * 0.5 + 0.5) * w, sy = (-tmpV.y * 0.5 + 0.5) * h;
    const d = Math.hypot(sx - clientX, sy - clientY);
    const radius = Math.max(26, Math.min(80, (h * 1.6) / dist));
    if (d < radius && d < bestD) { best = L; bestD = d; }
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  if (screen === 'title') { startGame(); return; }
  if (screen === 'compose') { closePanel('compose'); return; }
  const L = pickLantern(e.clientX, e.clientY);
  if (L) openCard(L); else if (screen === 'card') closeCard();
});
window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  if (screen === 'lake' || screen === 'card') canvas.style.cursor = pickLantern(e.clientX, e.clientY) ? 'pointer' : 'default';
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeCard(); if (screen === 'compose') closePanel('compose'); }
  else if ((e.key === 'Enter' || e.key === ' ') && screen === 'title') startGame();
});

// ---------------------------------------------------------------- loop + studio hooks
let running = true;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (running) update(dt);
  render(dt);
  requestAnimationFrame(frame);
}

function stepFrames(n) { for (let i = 0; i < n; i++) update(1 / 60); render(1 / 60); }

function reset(seed = 1) {
  reseed(seed);
  T = 0; star = null; nextStar = 8;
  for (const s of sparks) { scene.remove(s); s.material.dispose(); } sparks.length = 0;
  closeCard();
  populate();
  update(0);
}

function setCam(opts) {
  if (!opts) { debugCam = null; return; }
  debugCam = { pos: new THREE.Vector3(...opts.pos), target: new THREE.Vector3(...(opts.target || [0, 3, -60])) };
  render(0);
}
function hudShow(show) { document.body.classList.toggle('hud-off', !show); }

const ext = {
  probes() {
    return {
      screen, time: +T.toFixed(3), lanterns: lanterns.length,
      water: lanterns.filter(l => l.mode === 'water').length, sky: lanterns.filter(l => l.mode === 'sky').length,
      launched: save.launched, heartsSent: save.hearts, mine: lanterns.filter(l => l.mine).length,
      selected: selected ? { id: selected.id, text: selected.text } : null,
      net: net.status, online, build: net.statusLine().split(' · ')[0],
    };
  },
  setCam,
  hudShow,
  // test helpers
  launch(text = '오늘도 수고했어', color = 'amber', mode = 'water') {
    if (screen === 'title') startGame();
    $('msg').value = text; composeColor = color; composeMode = mode; return sendLantern().id;
  },
  openNearest() { const L = lanterns.filter(l => l.text).sort((a, b) => b.z - a.z)[0]; if (L) openCard(L); return L && L.text; },
};

// ---------------------------------------------------------------- cover / clip demos
const demos = makeCoverDemos({
  reset,
  enterLakeQuiet() {
    screen = 'lake';
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    closeCard(); $('compose').classList.add('hidden'); $('toast').classList.add('hidden');
  },
  hud(show) { hudShow(show); },
  pose(list) {
    list.forEach((o, i) => makeLantern({ id: 'cover' + i, text: '', color: o.color, mode: o.mode, x: o.x, y: o.y || 0, z: o.z }));
  },
  step(n) { stepFrames(n); },
  camera(c) { setCam(c); },
  launchQuiet(text, color, mode) {
    makeLantern({ id: 'clip0', text, color, mode, x: 0, y: mode === 'sky' ? 0.6 : 0, z: mode === 'sky' ? 14 : 15,
      vz: mode === 'sky' ? -0.6 : -2.2, vy: mode === 'sky' ? 0.9 : 0, alpha: 0, fadeIn: 1, fresh: 5 });
  },
  start() { running = true; },
});
installStudio({
  renderer, scene, camera, canvas,
  reset(seed) { reset(seed | 0); },
  probes: ext.probes,
  demos,
  cameras: {
    lake() { setCam(null); render(0); },
    low() { setCam({ pos: [0, 2.3, 23], target: [0, 5.8, -60] }); },
    sky() { setCam({ pos: [0, 1.5, 22], target: [0, 30, -60] }); },
  },
  flow: () => (screen === 'title' ? 'menu' : 'playing'),
  begin() { startGame(); },
});
// keep our extra helpers next to the contract's own verbs
window.__studio.heartRemote = () => { const L = lanterns.find(l => l.id.includes(':')); if (!L) return false; openCard(L); $('heartBtn').click(); return L.id; };
for (const k of ['setCam', 'hudShow', 'launch', 'openNearest']) if (!(k in window.__studio)) window.__studio[k] = ext[k];

requestAnimationFrame(frame);
