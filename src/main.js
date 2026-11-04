import * as THREE from '../vendor/three.module.js';
import { COLORS, PRESETS, WARM_MESSAGES, cleanMessage } from './data.js';
import { Audio } from './audio.js';
import { Net, invitedLake } from './net.js';
import { makeCoverDemos } from './cover-shot.js';
import { installStudio } from './studio.js';
import * as shore from './shore.js';
import { createWalker } from './walker.js';
import { createAtmosphere, fetchSeoulWeather, WEATHER, WEATHER_KINDS } from './weather.js';
import { seoulSeason, SEASONS, SEASON_NAMES } from './season.js';

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
    return { launched: s.launched | 0, hearts: s.hearts | 0, received: s.received | 0, wishes: s.wishes | 0, hidden: s.hidden || [], hearted: s.hearted || [], mine: s.mine || [] };
  } catch { return { launched: 0, hearts: 0, received: 0, wishes: 0, hidden: [], hearted: [], mine: [] }; }
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
const FOG_NIGHT = new THREE.Color(0x15122c), FOG_MIST = new THREE.Color(0x2c2a44);   // mist rolls in lighter than the night
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1200);
const CAM_BASE = new THREE.Vector3(0, 3.4, 25);
const CAM_TARGET = new THREE.Vector3(0, 5.5, -60);
camera.position.copy(CAM_BASE);

// the lake and its walkable shore live in shore.js; these aliases keep the lantern code unchanged
const LAKE = { cx: shore.LAKE.cx, cz: shore.LAKE.cz, rx: shore.LAKE.r, rz: shore.LAKE.r };
const lakeE = shore.lakeE;

// nightK: 0 = early evening (warm dusk glow on the horizon) .. 1 = deep night (dark horizon, brighter stars and Milky Way)
// weather and season (src/weather.js, src/season.js) drive the rest: cloudK hides the stars, rainK darkens the sky
// and rings the lake with raindrops, fogK pulls mist over the far shore; snowCover/leaf* tint the beach (shore.js)
const uniforms = { time: { value: 0 }, camPos: { value: new THREE.Vector3() }, nightK: { value: 0 },
  cloudK: { value: 0 }, rainK: { value: 0 }, fogK: { value: 0 }, ffAmt: { value: 0.45 },
  snowCover: { value: 0 }, season: { value: new THREE.Vector4(0, 0, 1, 0) } };   // season: spring, summer, autumn, winter weights

const GLSL_COMMON = /* glsl */`
uniform float nightK; uniform float cloudK; uniform float rainK; uniform float fogK;
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*noise3(p); p *= 2.03; a *= 0.5; } return s; }
vec3 skyColor(vec3 dir, float t, float starAmt){
  float h = clamp(dir.y, 0.0, 1.0);
  // the night deepens: the dusk glow sinks away, the zenith darkens, the stars come out stronger
  vec3 zen = mix(vec3(0.010, 0.016, 0.060), vec3(0.006, 0.009, 0.040), nightK);
  vec3 mid = mix(vec3(0.040, 0.048, 0.150), vec3(0.022, 0.030, 0.105), nightK);
  vec3 hor = mix(vec3(0.260, 0.140, 0.230), vec3(0.090, 0.075, 0.170), nightK);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.16, h));
  col = mix(col, zen, smoothstep(0.14, 0.75, h));
  vec2 hz = normalize(vec2(dir.x, dir.z) + 1e-5);
  float g = pow(max(0.0, -hz.y), 3.0) * exp(-h * 10.0);
  col += vec3(0.40, 0.18, 0.08) * g * 0.55 * (1.0 - 0.85 * nightK);
  vec3 bn = normalize(vec3(0.62, 0.30, 0.72));
  float bd = dot(dir, bn);
  float band = exp(-bd*bd / 0.025) * smoothstep(0.0, 0.25, h);
  float n = fbm(dir * 5.0);
  float n2 = fbm(dir * 16.0 + 3.0);
  col += vec3(0.15, 0.13, 0.26) * band * smoothstep(0.30, 0.85, n) * (1.3 + 0.6 * nightK);
  col += vec3(0.20, 0.12, 0.10) * band * smoothstep(0.60, 0.95, n) * 0.6;
  col *= 1.0 - 0.45 * band * smoothstep(0.52, 0.72, n2);
  // clouds: soft banks drifting slowly, thicker toward the horizon; they hide the stars and the Milky Way
  float cl = 0.0;
  if (cloudK > 0.001) {
    vec3 cd = vec3(dir.x, dir.y * 2.6, dir.z) * 2.2 + vec3(t * 0.006, 0.0, t * 0.003);
    float cn = fbm(cd) * 0.75 + fbm(cd * 2.7 + 5.0) * 0.25;
    cl = smoothstep(0.62 - 0.44 * cloudK, 0.86 - 0.26 * cloudK, cn) * smoothstep(-0.02, 0.06, h);
    cl = min(1.0, cl * (0.45 + 0.75 * cloudK) + cloudK * (0.22 + 0.3 * smoothstep(0.7, 1.0, cloudK)) * (1.0 - 0.5 * smoothstep(0.0, 0.6, h)));
    col *= 1.0 - 0.6 * cl * band;
  }
  vec3 p = dir * 230.0;
  vec3 c = floor(p);
  float hs = hash13(c);
  float thr = 0.982 - band * 0.02 - 0.006 * nightK;
  if (hs > thr) {
    vec3 sp = c + 0.5 + (vec3(hash13(c+1.7), hash13(c+2.3), hash13(c+3.1)) - 0.5) * 0.5;
    float d = length(p - sp);
    float s = (hs - thr) / (1.0 - thr);
    float tw = 0.65 + 0.35 * sin(t * (1.0 + s * 3.0) + hs * 50.0);
    col += vec3(1.0, 0.94, 0.84) * smoothstep(0.42, 0.0, d) * tw * (0.35 + s * 2.2) * (1.0 + 0.5 * nightK) * (1.0 - cl) * (1.0 - 0.6 * rainK) * starAmt * smoothstep(0.0, 0.08, h);
  }
  // cloud undersides catch a little of the dusk glow and the lantern-lit lake below
  // moonlit tops lighter than the sky behind, edges catching more than the dense middles
  vec3 cloudCol = mix(vec3(0.085, 0.080, 0.135), vec3(0.15, 0.10, 0.13), (1.0 - nightK) * (1.0 - smoothstep(0.0, 0.35, h)));
  cloudCol *= 0.8 + 0.45 * (1.0 - cl);
  col = mix(col, cloudCol * (1.0 - 0.35 * rainK), cl * 0.92);
  col *= 1.0 - 0.3 * rainK;
  // mist: the horizon washes into a soft grey-violet haze
  col = mix(col, vec3(0.13, 0.12, 0.20), fogK * (1.0 - smoothstep(0.0, 0.32, h)) * 0.95);
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
      // swells in a few slanted directions (axis-aligned ones lined up into bands across the lake), each
      // fading out with distance before it can alias at grazing angles
      float kf = 1.0 / (1.0 + dist * 0.045);
      vec2 d1 = vec2(0.80, 0.60), d2 = vec2(-0.55, 0.83), d3 = vec2(0.28, -0.96);
      g += d1 * cos(dot(p, d1) * 0.37 + t * 0.55) * 0.026 * kf;
      g += d2 * cos(dot(p, d2) * 0.53 - t * 0.47) * 0.022 * kf;
      g += d3 * cos(dot(p, d3) * 1.11 + t * 0.95) * 0.014 * k * kf;
      g += (vec2(noise3(vec3(p*0.6, t*0.3)), noise3(vec3(p*0.6 + 9.0, t*0.3))) - 0.5) * 0.07 * k;
      g += (vec2(noise3(vec3(p*1.7, t*0.5)), noise3(vec3(p*1.7 + 4.0, t*0.5))) - 0.5) * 0.035 * k * kf;
      // raindrops: rings opening on a jittered grid, only near enough to read
      if (rainK > 0.001 && dist < 45.0) {
        for (int j = 0; j < 2; j++) {
          vec2 q = p * (j == 0 ? 0.9 : 1.37) + float(j) * 7.3;
          vec2 ci = floor(q), cf = fract(q) - 0.5;
          float ph = hash13(vec3(ci, float(j)));
          vec2 o = (vec2(hash13(vec3(ci, 3.1)), hash13(vec3(ci, 5.7))) - 0.5) * 0.5;
          float lt = fract(t * (0.55 + ph * 0.5) + ph * 7.0);
          float rr = length(cf - o);
          float ring = exp(-pow((rr - lt * 0.45) / 0.05, 2.0)) * (1.0 - lt) * (1.0 - lt) * step(ph, 0.12 + 0.2 * rainK);
          g += (cf - o) / max(rr, 1e-3) * ring * 0.45 * rainK * (1.0 - dist / 45.0);
        }
      }
      vec3 n = normalize(vec3(g.x, 1.0, g.y));
      vec3 r = reflect(-v, n); r.y = abs(r.y);
      vec3 refl = skyColor(normalize(r), t, 0.8);
      float fres = 0.05 + 0.95 * pow(1.0 - max(dot(v, n), 0.0), 5.0);
      vec3 deep = vec3(0.004, 0.009, 0.026);
      vec3 col = mix(deep, refl * 0.8, clamp(fres * 0.85 + 0.1, 0.0, 1.0));
      col = mix(col, vec3(0.13, 0.12, 0.20), fogK * (1.0 - exp(-pow(dist * 0.011, 2.0))) * 0.92);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
water.rotation.x = -Math.PI / 2;
water.renderOrder = -10;
scene.add(water);

// ---------------------------------------------------------------- static world (built once, fixed seed)
let beach = null;
function buildWorld() {
  reseed(7);
  // the walkable moonlit beach ring around the lake (shore.js)
  beach = shore.buildShore(scene, uniforms);

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
      if (shore.waterDist(x, z) < 34 && z > -45) continue; // keep the walkable beach and the follow camera clear
    } else { // far shore crowd
      const a = rr(-Math.PI * 0.95, -Math.PI * 0.05), rad = rr(150, 195);
      x = LAKE.cx + Math.cos(a) * rad; z = LAKE.cz + Math.sin(a) * rad;
    }
    const h = rr(5, 12) * (n >= 380 ? 1.6 : 1), r = h * rr(0.22, 0.3);
    p.set(x, shore.groundY(x, z) - 0.3, z); s.set(r, h, r);
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
    p.set(x, Math.max(-0.2, shore.groundY(x, z)) - 0.05, z); s.set(rr(0.8, 1.4), rr(0.8, 2.4) * near, 1);
    m4.compose(p, q, s); reeds.setMatrixAt(nReeds - 1, m4);
  }
  reeds.count = nReeds;
  scene.add(reeds);

  // fireflies
  const FF = 260;   // shown by season: uniforms.ffAmt is the share lit (summer all, winter none)
  const fpos = new Float32Array(FF * 3), fseed = new Float32Array(FF * 4);
  for (let i = 0; i < FF; i++) {
    const a = rr(Math.PI * 0.05, Math.PI * 0.95), k = rr(0.85, 1.25);
    fpos[i * 3] = LAKE.cx + Math.cos(a) * LAKE.rx * k;
    fpos[i * 3 + 1] = Math.max(0, shore.groundY(fpos[i * 3], LAKE.cz + Math.sin(a) * LAKE.rz * k)) + rr(0.4, 3.5);
    fpos[i * 3 + 2] = LAKE.cz + Math.sin(a) * LAKE.rz * k;
    for (let j = 0; j < 4; j++) fseed[i * 4 + j] = rng();
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fg.setAttribute('aSeed', new THREE.BufferAttribute(fseed, 4));
  const ff = new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float time; uniform float ffAmt; attribute vec4 aSeed; varying float vB;
      void main(){
        vec3 p = position;
        p += vec3(sin(time*0.3*(0.5+aSeed.x) + aSeed.y*6.28)*1.8, sin(time*0.5*(0.5+aSeed.z) + aSeed.w*6.28)*0.6, cos(time*0.27*(0.5+aSeed.y) + aSeed.x*6.28)*1.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vB = pow(0.5 + 0.5*sin(time*(0.8 + aSeed.z*1.5) + aSeed.x*40.0), 3.0);
        gl_PointSize = step(aSeed.w, ffAmt) * (70.0 / -mv.z) * (0.4 + vB) * ${renderer.getPixelRatio().toFixed(1)};
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vB; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a*a;
      gl_FragColor = vec4(vec3(1.0, 0.92, 0.45) * a * (0.25 + vB*1.2), 1.0); }`,
  }));
  scene.add(ff);
}
buildWorld();

// ---------------------------------------------------------------- Seoul weather + season
// the season comes from today's date in Seoul; the weather is fetched once per visit (clear night of the
// season if the weather service does not answer within a few seconds)
const atmos = createAtmosphere(scene, uniforms, { pixelRatio: renderer.getPixelRatio(),
  coarse: !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) });
const seoul = { season: seoulSeason(), weather: null, temp: null, tried: false };
let forcedWeather = null, forcedSeason = null, weatherNoticed = false;
function applyAtmos(instant) {
  atmos.set({ season: forcedSeason || seoul.season, weather: forcedWeather || seoul.weather || 'clear', instant });
}
applyAtmos(true);
fetchSeoulWeather(4000).then((w) => {
  seoul.tried = true;
  if (w) { seoul.weather = w.kind; seoul.temp = w.temp; }
  // on the title the lake keeps a clear night of the season; the real weather rolls in once you are on the beach
  if (screen !== 'title') { applyAtmos(false); noticeWeather(); }
});
const ATMOS_VIEW = { pos: [-6, 3.2, 24], target: [2, 3.5, -40] };
function forceAtmos(w, s) { forcedWeather = w; forcedSeason = s; applyAtmos(true); }
function realAtmos() { if (forcedWeather || forcedSeason) forceAtmos(null, null); }
function weatherLine() {
  const S = SEASONS[seoul.season];
  if (!seoul.weather) return `${S.emoji} ${S.name}밤의 호수예요`;
  const W = WEATHER[seoul.weather];
  const t = typeof seoul.temp === 'number' ? ` · ${Math.round(seoul.temp)}°` : '';
  return `${W.emoji} ${S.name}밤, ${W.line}${t}`;
}
function noticeWeather() {
  if (weatherNoticed || !seoul.tried) return;
  weatherNoticed = true;
  applyAtmos(false);                   // rain rings spread, clouds gather, snow starts to fall, over a few seconds
  setTimeout(() => toast(weatherLine(), 5200), invitedLake() ? 5200 : 1600);
}

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
const walker = createWalker(scene, shore, GLOW);
const START = { x: 0, z: 16 };
walker.reset(START.x, START.z);
const keys = new Set();
// on a touch screen the tip speaks of taps and drags, not keys
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  document.getElementById('tip').textContent = '땅을 눌러 걸어요 · 화면을 끌어 둘러봐요 · 등불을 누르면 한마디가 보여요';
}

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
  gradientColors(paper, new THREE.Color(col.lamp ?? col.hex).lerp(new THREE.Color(0xffd9a0), 0.1), 0.5, opts.mode === 'water' ? 1.1 : 1.0);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.96, side: THREE.DoubleSide, fog: false });
  g.add(new THREE.Mesh(paper, mat));
  if (opts.mode === 'water') { g.add(new THREE.Mesh(GEO.base, darkMat)); g.add(new THREE.Mesh(GEO.frame, darkMat)); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 }));
  glow.scale.setScalar(4.2); glow.position.y = 0.45;
  const baseScale = opts.mode === 'water' ? 1.5 : 1.7;
  g.scale.setScalar(baseScale);
  g.add(glow);
  const refl = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.45 }));
  lanternGroup.add(g); lanternGroup.add(refl);
  const L = {
    id: opts.id, mine: !!opts.mine, who: opts.who || '', text: opts.text || '', color: col.id, mode: opts.mode,
    hearts: opts.hearts | 0, group: g, mat, glow, refl,
    x: opts.x, y: opts.y, z: opts.z, vx: opts.vx || 0, vz: opts.vz || 0, vy: opts.vy || 0,
    ph: rng() * 100, ph2: rng() * 100, speed: rr(0.5, 1), alpha: opts.alpha ?? 1, fadeIn: opts.fadeIn || 0,
    rot: rng() * Math.PI * 2, selected: 0, fresh: opts.fresh || 0, baseScale,
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
const starHead = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xfff1d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
starHead.visible = false; starHead.scale.setScalar(9); scene.add(starHead);
let star = null, nextStar = 8;
// a shooting star crosses the sky where you are looking; for a few seconds you can make a wish on it
let wishOpen = 0, lastStarHead = new THREE.Vector3(), lastStarNdc = [0, 0.6];
function spawnStar() {
  // pick the streak in screen space (upper sky of the current view), then put it far out along those rays,
  // so it is always seen whatever way the camera is turned or tilted
  const sx = rr(-0.75, 0.75), sy = rr(0.62, 0.86);
  const ex = sx + (sx > 0 ? -1 : 1) * rr(0.35, 0.55), ey = sy - rr(0.18, 0.3);
  const ray = (x, y) => new THREE.Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(320).add(camera.position);
  const start = ray(sx, sy), end = ray(ex, ey);
  const dir = end.clone().sub(start); const len = dir.length(); dir.normalize();
  star = { p: start, d: dir, t: 0, life: 1.1, speed: len / 1.1, ndc: [ex, ey] };
  nextStar = rr(16, 34) * (1 - 0.45 * uniforms.nightK.value);
  if (screen === 'lake' || screen === 'card') { wishOpen = 5; $('wishBtn').classList.remove('hidden'); audio.chime([1567.98], 0, 0.05); }
}
function makeWish() {
  if (wishOpen <= 0) return;
  wishOpen = 0; $('wishBtn').classList.add('hidden');
  save.wishes++; persist(); updateStats();
  audio.chime([783.99, 987.77, 1174.66, 1567.98], 0.11);
  // a fall of gold sparks from where the star went out
  // from where the star went out, brought near enough to see the sparks fall
  const base = new THREE.Vector3(lastStarNdc[0], lastStarNdc[1], 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(40).add(camera.position);
  for (let i = 0; i < 30; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: i % 3 ? 0xffe3a0 : 0xfff6dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sp.position.copy(base); sp.scale.setScalar(2.2);
    const a = rng() * Math.PI * 2, e = rr(-0.4, 1);
    sp.userData = { v: new THREE.Vector3(Math.cos(a) * 9, 4 + e * 8, Math.sin(a) * 9), life: 1.8 + rng(), t: 0 };
    scene.add(sp); sparks.push(sp);
  }
  toast('🌠 소원이 별에 닿았어요');
}
function updateStar(dt) {
  nextStar -= dt;
  if (!star && nextStar <= 0) spawnStar();
  if (wishOpen > 0) { wishOpen -= dt; if (wishOpen <= 0) $('wishBtn').classList.add('hidden'); }
  if (star) {
    star.t += dt;
    const head = star.p.clone().addScaledVector(star.d, star.t * (star.speed || 260));
    const tail = head.clone().addScaledVector(star.d, -60 * Math.min(1, star.t * 4));
    const pa = starGeo.attributes.position.array;
    pa[0] = head.x; pa[1] = head.y; pa[2] = head.z; pa[3] = tail.x; pa[4] = tail.y; pa[5] = tail.z;
    starGeo.attributes.position.needsUpdate = true;
    shootingStar.visible = true; starHead.visible = true; starHead.position.copy(head);
    shootingStar.material.opacity = Math.sin(Math.PI * Math.min(1, star.t / star.life));
    starHead.material.opacity = shootingStar.material.opacity;
    lastStarHead.copy(head); if (star.ndc) lastStarNdc = star.ndc;
    if (star.t >= star.life) { star = null; shootingStar.visible = false; starHead.visible = false; }
  }
}

// ---------------------------------------------------------------- simulation
let T = 0;
let nightOverride = null;
// a lantern still in the character's hands during the launch pose
const _hands = new THREE.Vector3();
function holdLantern(L, dt) {
  const H = L.held; H.t += dt;
  if (L.fadeIn > 0) { L.alpha = Math.min(1, L.alpha + dt / L.fadeIn); if (L.alpha >= 1) L.fadeIn = 0; }
  walker.hands(_hands);
  const sc = L.mode === 'water' ? 0.45 : 0.24;
  let x = _hands.x, y = _hands.y - 0.12, z = _hands.z;
  if (L.mode === 'water') {           // after the kneel, it is lowered out onto the water
    const k = Math.max(0, Math.min(1, (H.t - 0.85) / (H.release - 0.85))), e = k * k * (3 - 2 * k);
    x += (H.to.x - x) * e; z += (H.to.z - z) * e; y += (0.03 - y) * e;
  } else y += 0.3;
  L.x = x; L.y = y; L.z = z;
  L.group.position.set(x, y, z);
  L.group.scale.setScalar(L.baseScale * sc);
  L.group.rotation.set(0, L.rot, 0);
  const flick = 0.88 + 0.08 * Math.sin(T * 7.3 + L.ph);
  L.mat.opacity = 0.96 * L.alpha;
  L.glow.material.opacity = 0.8 * flick * L.alpha;
  L.glow.scale.setScalar(3.4 * (1 + L.fresh * 0.25));
  L.refl.material.opacity = L.mode === 'water' ? 0.6 * flick * L.alpha * Math.max(0, 1 - (y - 0.03) * 3) : 0;
  L.refl.position.set(x, -2.2, z);
  if (H.t >= H.release) {             // let go
    L.held = null; L.vx = H.v.x; L.vz = H.v.z; L.vy = H.v.y; L.grow = 0;
  }
}

function updateLanterns(dt) {
  for (const L of lanterns) {
    if (L.held) { holdLantern(L, dt); continue; }
    if (L.grow !== undefined && L.grow < 1) { L.grow = Math.min(1, L.grow + dt / (L.mode === 'water' ? 1.6 : 9)); const g0 = L.mode === 'water' ? 0.45 : 0.24; L.group.scale.setScalar(L.baseScale * (g0 + (1 - g0) * L.grow)); if (L.grow >= 1) delete L.grow; }
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
    const sel = L.selected ? 1 + 0.25 * Math.sin(T * 5) + 0.4 : L === hovered ? 1.35 : 1;
    const fresh = 1 + L.fresh * 0.25;
    L.group.position.set(L.x, L.y, L.z);
    // never let a lantern fill the lens: fade it out as it comes right up to the camera
    const dc = L.held ? 9 : Math.hypot(L.x - camera.position.x, L.y + 0.4 - camera.position.y, L.z - camera.position.z);
    const near = Math.max(0, Math.min(1, (dc - 1.6) / 2.4));
    L.mat.opacity = 0.96 * L.alpha * near;
    L.glow.material.opacity = 0.8 * flick * L.alpha * Math.min(1.6, sel) * near;
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

// launch cinematic: the camera eases back and follows your own lantern as it leaves, then hands control back
let cine = null;
const _cp = new THREE.Vector3(), _cl = new THREE.Vector3();
function applyCine(dt) {
  const C = cine; C.t += dt;
  const L = C.L;
  if (!lanterns.includes(L)) { cine = null; return; }
  // moving again ends it early (a softer, quicker hand-back)
  if (!walker.busy() && heldKeys().size && C.t < C.dur - 1.0) C.t = C.dur - 1.0;
  const sm = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  const b = sm(0, 1.4, C.t) * (1 - sm(C.dur - 1.6, C.dur, C.t));
  const f = walker.lakeDir(), p = walker.pos, rx = -f.z, rz = f.x;
  // first a close three-quarter view from the left (the kneel / the lift, the lantern in its hands),
  // then, from the release, the follow shot after the lantern
  const rel = C.mode === 'water' ? 1.7 : 1.35;
  const q = sm(rel - 0.2, rel + 1.6, C.t);
  if (C.side === undefined) {          // from the left, unless the pier lamp would stand between camera and lantern
    const onPier = shore.pierLaunchPoint(p.x, p.z);
    C.side = onPier && ((shore.PIER_LAMP.x - p.x) * rx + (shore.PIER_LAMP.z - p.z) * rz) < 0 ? 1 : -1;
  }
  const sx = p.x + C.side * rx * 3.0 - f.x * 2.6, sz = p.z + C.side * rz * 3.0 - f.z * 2.6;
  const side = { x: sx, y: p.y + (C.mode === 'water' ? 1.5 : 1.2), z: sz };
  const sideLook = { x: p.x + f.x * 0.9, y: p.y + (C.mode === 'water' ? 0.55 : 1.5), z: p.z + f.z * 0.9 };
  if (C.mode === 'water') {           // back and up, looking out at the lantern on the water
    const lx = L.x - p.x, lz = L.z - p.z, out = Math.min(14, Math.hypot(lx, lz));
    _cp.set(p.x - f.x * (8 + out * 0.15), p.y + 4.6 + out * 0.12, p.z - f.z * (8 + out * 0.15));
    _cl.set(p.x * 0.35 + L.x * 0.65, L.y + 0.2, p.z * 0.35 + L.z * 0.65);
  } else {                            // low behind the character, tilting up after the rising lantern
    _cp.set(p.x - f.x * 7.5, p.y + 1.7, p.z - f.z * 7.5);
    _cl.set(p.x * 0.3 + L.x * 0.7, Math.min(L.y, p.y + 9) * 0.85 + p.y * 0.15, p.z * 0.3 + L.z * 0.7);
  }
  _cp.set(side.x + (_cp.x - side.x) * q, side.y + (_cp.y - side.y) * q, side.z + (_cp.z - side.z) * q);
  _cl.set(sideLook.x + (_cl.x - sideLook.x) * q, sideLook.y + (_cl.y - sideLook.y) * q, sideLook.z + (_cl.z - sideLook.z) * q);
  _cp.y = Math.max(_cp.y, shore.groundY(_cp.x, _cp.z) + 1.0);
  const k = 1 - Math.exp(-dt * 2.5);
  C.pos.lerp(_cp, k); C.look.lerp(_cl, 1 - Math.exp(-dt * 3));
  camera.position.lerp(C.pos, b);
  _cp.copy(walker.camLook).lerp(C.look, b);
  camera.lookAt(_cp);
  if (C.t >= C.dur) cine = null;
}

const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
let debugCam = null;
function updateCamera(dt) {
  if (debugCam) {
    camera.position.copy(debugCam.pos); camera.lookAt(debugCam.target);
  } else {
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 1.5);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 1.5);
    const dy = pointer.sy > 0 ? pointer.sy * 0.35 : pointer.sy; // looking down is gentler than looking up
    // no mouse parallax on the follow camera: it made lanterns slide away from the cursor reaching for them
    const hk = heldKeys();
    if (hk.has('KeyQ')) walker.turnView(dt * 1.6);
    if (hk.has('KeyE')) walker.turnView(-dt * 1.6);
    walker.updateCamera(camera, dt, { x: 0, y: 0 });
    if (cine) applyCine(dt);
    followPos.copy(camera.position);
  }
  sky.position.copy(camera.position);
  uniforms.camPos.value.copy(camera.position);
}

const NO_KEYS = new Set();
// keys from real key events plus any the studio's harness injected (paused, scripted playthroughs)
const merged = new Set();
const KEY_ALIAS = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD' };
function heldKeys() {
  merged.clear();
  for (const k of keys) merged.add(k);
  try { const inj = window.__studio?.injectInput?.({}); if (inj) for (const k of inj.keys) { const c = KEY_ALIAS[k] || k; if (MOVE_KEYS.has(c) || TURN_KEYS.has(c)) merged.add(c); } } catch {}
  return merged;
}
// where the follow camera stands: the "player eyes" for the studio's eye cameras in this third-person game
const followPos = new THREE.Vector3();
// a soft ring where a tap sent the character
const tapMark = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 24), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, fog: false }));
tapMark.rotation.x = -Math.PI / 2; scene.add(tapMark);
let tapT = 0;
function showTapMark(x, z) { tapMark.position.set(x, shore.groundY(x, z) + 0.05, z); tapT = 1; }
function updateTapMark(dt) { tapT = Math.max(0, tapT - dt * 1.2); tapMark.material.opacity = tapT * 0.7; tapMark.scale.setScalar(1 + (1 - tapT) * 0.8); }

function update(dt) {
  T += dt;
  uniforms.time.value = T;
  // the night slowly deepens and lifts again: a 20-minute swell from evening to deep night and back
  uniforms.nightK.value = nightOverride ?? (0.5 - 0.5 * Math.cos(Math.PI * 2 * T / 1200));
  const wasBusy = walker.busy();
  walker.update(dt, (screen === 'lake' || screen === 'card') && !wasBusy ? heldKeys() : NO_KEYS, T);
  if (wasBusy && !walker.busy() && (screen === 'lake' || screen === 'card')) { $('launchBtn').classList.remove('hidden'); $('tip').classList.remove('hidden'); }
  if (beach) beach.update(dt, walker.pos);
  updateTapMark(dt);
  updateLanterns(dt);
  updateSparks(dt);
  updateStar(dt);
  atmos.update(dt);
  scene.fog.density = 0.0042 + uniforms.fogK.value * 0.0095;
  scene.fog.color.copy(FOG_NIGHT).lerp(FOG_MIST, uniforms.fogK.value);
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
let lakeNo = null;
function updateStats() {
  const people = lakeNo ? `🌙 호수 ${lakeNo}${online > 1 ? ` · 지금 ${online}명` : ''} · ` : (online > 1 ? `🌙 지금 호수에 ${online}명 · ` : '');
  const got = (save.received ? ` · 받은 반짝임 ${save.received}` : '') + (save.wishes ? ` · 별똥별 소원 ${save.wishes}` : '');
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
      // somewhere along the near shore, but out over the water and never right beside you (it used to rise
      // up on the sand, sometimes right in front of the camera)
      // prefer a spot you can see (inside the middle of the frame), 12-40 m away, so you catch it setting off
      let e2 = null, far = null;
      const sp = new THREE.Vector3();
      for (let i = 0; i < 40 && !e2; i++) {
        const a = Math.PI / 2 + (nrnd() - 0.5) * 1.3;
        const c = shore.nearestShore(LAKE.cx + Math.cos(a) * 50, LAKE.cz + Math.sin(a) * 50, (water ? -1.5 : -3.5) - nrnd() * 6);
        const d = Math.hypot(c.x - walker.pos.x, c.z - walker.pos.z);
        if (d < 12) continue;
        if (!far) far = c;
        sp.set(c.x, water ? 0.3 : 3, c.z).project(camera);
        if (d < 40 && sp.z < 1 && Math.abs(sp.x) < 0.75 && Math.abs(sp.y) < 0.8) e2 = c;
      }
      e2 = e2 || far || shore.nearestShore(LAKE.cx, LAKE.cz + 50, -4);
      x = e2.x; z = e2.z; y = water ? 0 : 1.6;
    } else {
      for (let i = 0; i < 30; i++) {
        x = (nrnd() * 2 - 1) * LAKE.rx; z = LAKE.cz + (nrnd() * 2 - 1) * LAKE.rz;
        if (lakeE(x, z) < 0.8 && z < 0) break;
      }
      y = water ? 0 : 6 + nrnd() * 50;
    }
    makeLantern({ id: e.netId, who, text, color: e.color, mode: e.mode, x, y, z,
      vx: 0, vz: fresh ? (water ? -1.6 : -0.4) : 0, vy: water ? 0 : 0.5, alpha: 0, fadeIn: 2, fresh: fresh ? 5 : 0, hearts: 0 });
    if (fresh) lanterns[lanterns.length - 1].grow = 0;   // starts small, like one just let go of
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
  onLake(n) { // moved to another lake: drop the previous lake's people and their lanterns
    for (const L of [...lanterns]) if (!L.mine && L.id.includes(':')) { if (selected === L) closeCard(); removeLantern(L); }
    lakeNo = n; online = 1; updateStats();
  },
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
  const inv = invitedLake();
  if (inv) setTimeout(() => toast(`초대받은 호수 ${inv}에 들어왔어요`, 3500), 1400);
  noticeWeather();
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
  $('toast').classList.add('hidden');   // the weather / arrival line never sits over the panel
  $('compose').classList.remove('hidden');
  $('launchBtn').classList.add('hidden'); $('tip').classList.add('hidden');
  screen = 'compose';
  setTimeout(() => $('msg').focus(), 50);
}
function closePanel(which) {
  if (which === 'compose') { $('compose').classList.add('hidden'); $('launchBtn').classList.remove('hidden'); $('tip').classList.remove('hidden'); screen = 'lake'; }
  else closeCard();
}
$('launchBtn').onclick = () => {
  audio.start();
  if (walker.state().nearWater) { openCompose(); return; }
  const e = shore.nearestShore(walker.pos.x, walker.pos.z, 1.2);
  walker.walkTo(e.x, e.z, () => { if (screen === 'lake') openCompose(); });
  showTapMark(e.x, e.z);
  toast('물가로 걸어가는 중…', 1800);
};
let nearWaterShown = null;
function updateLaunchLabel() {
  const near = walker.state().nearWater;
  if (near === nearWaterShown) return;
  nearWaterShown = near;
  $('launchBtn').textContent = near ? '🏮 여기서 등불 띄우기' : '🏮 물가로 가서 등불 띄우기';
}
setInterval(updateLaunchLabel, 200);
$('send').onclick = () => sendLantern();

function sendLantern() {
  const text = cleanMessage($('msg').value);
  const id = 'm' + Date.now().toString(36);
  const water = composeMode === 'water';
  // set it down from where the character stands: on the water at its feet, or up from its hands
  const dir = walker.lakeDir();
  const fromPier = water && shore.pierLaunchPoint(walker.pos.x, walker.pos.z);
  const at = fromPier || (water ? shore.nearestShore(walker.pos.x, walker.pos.z, -1.4) : { x: walker.pos.x + dir.x * 0.7, z: walker.pos.z + dir.z * 0.7 });
  // the character kneels (water) or lifts it overhead (sky); the lantern sits in its hands until the release
  const timing = walker.ceremony(composeMode);
  const h = walker.hands(new THREE.Vector3());
  const L = makeLantern({
    id, mine: true, text, color: composeColor, mode: composeMode,
    x: h.x, y: h.y, z: h.z, alpha: 0, fadeIn: 0.5, fresh: 6 + timing.release,
  });
  L.held = { t: 0, release: timing.release, to: { x: at.x, z: at.z },
    v: { x: dir.x * (water ? 2.2 : 0.5), z: dir.z * (water ? 2.2 : 0.5) + (water ? 0 : 0.2), y: water ? 0 : 0.7 } };
  L.grow = 0;
  cine = { L, t: 0, mode: composeMode, dur: water ? 7.5 : 7, pos: camera.position.clone(), look: walker.camLook.clone() };
  save.mine.push({ id, text, color: composeColor, mode: composeMode });
  if (save.mine.length > 12) save.mine.shift();
  save.launched++;
  persist(); updateStats(); net.setMine(save.mine);
  $('compose').classList.add('hidden'); screen = 'lake';   // the button and tip come back when the pose ends
  $('launchBtn').classList.add('hidden'); $('tip').classList.add('hidden'); closeCard();
  $('msg').value = ''; onMsgInput();
  setTimeout(() => audio.plop(), timing.release * 1000);
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
$('wishBtn').addEventListener('click', (e) => { e.stopPropagation(); makeWish(); });
$('invite').onclick = async () => {
  const url = net.inviteUrl();
  try { await navigator.clipboard.writeText(url); toast(`호수 ${lakeNo || 1} 초대 링크를 복사했어요 · 친구에게 보내 보세요`, 3500); }
  catch { toast(url, 8000); }
  audio.tick();
};
$('mute').onclick = () => { audio.setMuted(!audio.muted); $('mute').textContent = audio.muted ? '🔇' : '🔊'; };

// picking
const tmpV = new THREE.Vector3();
let hovered = null;
function pickLantern(clientX, clientY) {
  // Hit test against each lantern's real on-screen size, so a tap lands on the lantern under the finger.
  const w = window.innerWidth, h = window.innerHeight;
  const focalPx = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  let best = null, bestScore = Infinity, bestDist = Infinity;
  for (const L of lanterns) {
    if (L.alpha < 0.3) continue;
    const water = L.mode === 'water';
    tmpV.set(L.x, L.y + (water ? 0.63 : 0.85), L.z);
    const dist = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    if (tmpV.z > 1) continue;
    const sx = (tmpV.x * 0.5 + 0.5) * w, sy = (-tmpV.y * 0.5 + 0.5) * h;
    const d = Math.hypot(sx - clientX, sy - clientY);
    const radius = Math.min(90, Math.max(12, ((water ? 0.62 : 0.8) * focalPx) / dist + 8));
    if (d > radius) continue;
    const score = d / radius;
    if (score < bestScore - 0.15 || (Math.abs(score - bestScore) <= 0.15 && dist < bestDist)) {
      best = L; bestScore = score; bestDist = dist;
    }
  }
  return best;
}
// a short press is a tap (open a lantern / walk there); pressing and dragging turns the view instead
let press = null;
const DRAG_PX = 8;
function tapAt(cx, cy) {
  const L = pickLantern(cx, cy);
  if (L) { openCard(L); return; }
  if (screen === 'card') closeCard();
  walkToScreenPoint(cx, cy);
}
canvas.addEventListener('pointerdown', (e) => {
  if (screen === 'title') { startGame(); return; }
  if (screen === 'compose') { closePanel('compose'); return; }
  if (press) return;                                   // a second finger: ignore
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, drag: false };
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});
canvas.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.id) return;
  if (!press.drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) { press.drag = true; canvas.style.cursor = 'grabbing'; }
  if (press.drag) {
    const k = 3.2 / Math.max(600, window.innerWidth);   // a full-width drag turns the view about half round
    walker.turnView(-(e.clientX - press.lx) * k, (e.clientY - press.ly) * k * 0.8);
  }
  press.lx = e.clientX; press.ly = e.clientY;
});
function endPress(e, cancel) {
  if (!press || e.pointerId !== press.id) return;
  const p = press; press = null;
  canvas.style.cursor = 'default';
  if (!p.drag && !cancel && (screen === 'lake' || screen === 'card')) tapAt(p.x, p.y);
}
canvas.addEventListener('pointerup', (e) => endPress(e, false));
canvas.addEventListener('pointercancel', (e) => endPress(e, true));
canvas.addEventListener('dblclick', () => walker.turnView(null));   // double-click: back behind the character
const raycaster = new THREE.Raycaster();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const deckPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -shore.PIER_DECK);
function walkToScreenPoint(cx, cy) {
  if (walker.busy()) return;
  const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = beach && raycaster.intersectObject(beach.mesh, false)[0];
  const deck = new THREE.Vector3();
  let x, z;
  if (raycaster.ray.intersectPlane(deckPlane, deck) && shore.pierLaunchPoint(deck.x, deck.z) && shore.walkable(deck.x, deck.z)
      && (!hit || hit.distance > deck.distanceTo(raycaster.ray.origin))) { x = deck.x; z = deck.z; }  // tapped the pier deck
  else if (hit && hit.point.y > -0.02) { x = hit.point.x; z = hit.point.z; }
  else { // tapped the water: walk to the water's edge in that direction
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(waterPlane, p)) return;
    if (shore.pierLaunchPoint(walker.pos.x, walker.pos.z)) { x = p.x; z = p.z; }  // on the pier: walkTo clamps it onto the deck
    else { const e = shore.nearestShore(p.x, p.z, 1.0); x = e.x; z = e.z; }
  }
  walker.walkTo(x, z);
  showTapMark(x, z);
}
window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  if ((screen === 'lake' || screen === 'card') && !(press && press.drag)) { hovered = pickLantern(e.clientX, e.clientY); if (!press) canvas.style.cursor = hovered ? 'pointer' : 'default'; }
  else hovered = null;
});
const TURN_KEYS = new Set(['KeyQ', 'KeyE']);
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (MOVE_KEYS.has(e.code)) { keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); }
  if (TURN_KEYS.has(e.code)) keys.add(e.code);
  if (e.code === 'KeyR' && screen !== 'title') walker.turnView(null);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeCard(); if (screen === 'compose') closePanel('compose'); }
  else if ((e.key === 'Enter' || e.key === ' ') && screen === 'title') startGame();
});

// ---------------------------------------------------------------- loop + studio hooks
let running = true;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (frozen) { requestAnimationFrame(frame); return; }
  if (running) update(dt);
  render(dt);
  requestAnimationFrame(frame);
}

function stepFrames(n) { for (let i = 0; i < n; i++) update(1 / 60); render(1 / 60); }

function reset(seed = 1) {
  reseed(seed);
  T = 0; star = null; nextStar = 8; shootingStar.visible = starHead.visible = false; wishOpen = 0; $('wishBtn').classList.add('hidden');
  for (const s of sparks) { scene.remove(s); s.material.dispose(); } sparks.length = 0;
  closeCard();
  walker.reset(START.x, START.z);
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
      screen, time: +T.toFixed(3), lanterns: lanterns.length, walker: walker.state(), atmos: { ...atmos.state(), seoulWeather: seoul.weather, seoulSeason: seoul.season, line: seoul.tried ? weatherLine() : null },
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
  input: { pointerLock: false }, // a point-and-tap game: never capture the cursor
  // third person: the studio's "player eyes" are the follow camera behind the character, facing the lake
  eyeHeight: 1.6,
  player: () => {
    const f = walker.lakeDir();
    const p = followPos.lengthSq() ? followPos : walker.pos;
    return { x: p.x, y: p.y - 1.6, z: p.z, yaw: Math.atan2(-f.x, -f.z) };
  },
  reset(seed) { reset(seed | 0); },
  probes: ext.probes,
  demos,
  cameras: {
    lake() { realAtmos(); setCam({ pos: [0, 16, 42], target: [0, 0, -60] }); }, // a high view over the beach and the whole lake
    low() { realAtmos(); setCam({ pos: [0, 2.3, 23], target: [0, 5.8, -60] }); },
    sky() { realAtmos(); setCam({ pos: [0, 1.5, 22], target: [0, 30, -60] }); },
    // every weather and season, forced, from a view that shows sky, lake and beach together
    'wx-cloudy'() { forceAtmos('cloudy', null); setCam(ATMOS_VIEW); },
    'wx-rain'() { forceAtmos('rain', null); setCam(ATMOS_VIEW); },
    'wx-snow'() { forceAtmos('snow', 'winter'); setCam(ATMOS_VIEW); },
    'wx-fog'() { forceAtmos('fog', null); setCam(ATMOS_VIEW); },
    'season-spring'() { forceAtmos('clear', 'spring'); setCam(ATMOS_VIEW); },
    'season-summer'() { forceAtmos('clear', 'summer'); setCam(ATMOS_VIEW); },
    'season-autumn'() { forceAtmos('clear', 'autumn'); setCam(ATMOS_VIEW); },
    'season-winter'() { forceAtmos('clear', 'winter'); setCam(ATMOS_VIEW); },
  },
  flow: () => (screen === 'title' ? 'menu' : 'playing'),
  begin() { startGame(); $('title').classList.add('hidden'); }, // the studio's clock may be frozen: skip the fade
});
// keep our extra helpers next to the contract's own verbs
window.__studio.screenOf = (id) => { const L = lanterns.find(l => l.id === id); if (!L) return null; const v = new THREE.Vector3(L.x, L.y + (L.mode === 'water' ? 0.63 : 0.85), L.z).project(camera); return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, dist: +camera.position.distanceTo(new THREE.Vector3(L.x, L.y, L.z)).toFixed(1) }; };
// force a weather / season for looking at it (null: back to today's Seoul); instant=true skips the easing
window.__studio.weather = (kind, instant) => { forcedWeather = WEATHER_KINDS.includes(kind) ? kind : null; applyAtmos(!!instant); return atmos.state(); };
window.__studio.season = (name, instant) => { forcedSeason = SEASON_NAMES.includes(name) ? name : null; applyAtmos(!!instant); return atmos.state(); };
window.__studio.atmos = () => ({ ...atmos.state(), seoul: { ...seoul }, line: weatherLine() });
window.__studio.view = () => ({ ...walker.view, dir: walker.viewDir(), st: walker.state() });
window.__studio.swatch = () => { COLORS.forEach((c, i) => { makeLantern({ id: 'sw' + i, color: c.id, mode: 'water', x: (i - 2) * 2.2, y: 0, z: 4 }); makeLantern({ id: 'sv' + i, color: c.id, mode: 'sky', x: (i - 2) * 2.2, y: 4.5, z: 2 }); });
  lanterns.filter(l => /^s[wv]/.test(l.id)).forEach(l => { l.vx = l.vz = l.vy = 0; l.speed = 0; }); return true; };
window.__studio.night = (k) => { nightOverride = k; return uniforms.nightK.value; };
window.__studio.star = () => { nextStar = 0; return true; };
window.__studio.wish = () => { const b = !$('wishBtn').classList.contains('hidden'); makeWish(); return b; };
window.__studio.ids = () => lanterns.map(l => l.id);
window.__studio.dbg = () => { const L = lanterns[lanterns.length - 1]; const h = walker.hands(); return { busy: walker.busy(), held: !!L.held, t: L.held && L.held.t, L: [L.x, L.y, L.z].map(v => +v.toFixed(2)), a: +L.alpha.toFixed(2), sc: +L.group.scale.x.toFixed(2), hands: [h.x, h.y, h.z].map(v => +v.toFixed(2)), cam: camera.position.toArray().map(v => +v.toFixed(1)), cine: !!cine }; };
// test hooks: freeze the live loop and advance it in fixed 1/60 s steps (camera included)
let frozen = false;
window.__studio.freeze = (on = true) => { frozen = on; };
window.__studio.advance = (ms) => { for (let i = 0, n = Math.round(ms / (1000 / 60)); i < n; i++) { update(1 / 60); render(1 / 60); } };
window.__studio.fakeArrival = (mode = 'sky') => { net.hooks.onLantern({ netId: 'x:' + Date.now(), text: 'test', color: 'amber', mode }, 'tester', true); return lanterns[lanterns.length - 1].id; };
window.__studio.heartRemote = () => { const L = lanterns.find(l => l.id.includes(':')); if (!L) return false; openCard(L); $('heartBtn').click(); return L.id; };
for (const k of ['setCam', 'hudShow', 'launch', 'openNearest']) if (!(k in window.__studio)) window.__studio[k] = ext[k];

requestAnimationFrame(frame);
