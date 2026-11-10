import * as THREE from '../vendor/three.module.js';
import { COLORS, PRESETS, WARM_MESSAGES, cleanMessage, topicToday } from './data.js';
import { Audio, MUSIC_DEFAULTS } from './audio.js';
import { Net, invitedLake } from './net.js';
import { ServerNet } from './servernet.js';
import { serverUrl } from './config.js';
import { LITE, SOFTWARE_GPU } from './quality.js';
import { createCat } from './cat.js';
import { createStones, NOTES } from './stones.js';
import { createWhale } from './whale.js';
import { createWake } from './wake.js';
import { createCampfire } from './campfire.js';
import { createMelody, seoulDay, SONG_LEN } from './melody.js';
import { EN, L, setLang } from './i18n.js';
const T_ = L;   // the same, for code where L names a lantern
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
    return { launched: s.launched | 0, hearts: s.hearts | 0, received: s.received | 0, wishes: s.wishes | 0, hidden: s.hidden || [], hearted: s.hearted || [], mine: s.mine || [],
      log: Array.isArray(s.log) ? s.log : [], heartsBy: s.heartsBy || {}, lastVisit: s.lastVisit | 0, music: s.music !== false, starsSeen: s.starsSeen | 0, catBond: +s.catBond || 0, catMet: !!s.catMet, stonesPlayed: !!s.stonesPlayed, fireHint: !!s.fireHint,
      melody: s.melody && typeof s.melody === 'object' ? s.melody : null, songs: s.songs | 0, digHint: !!s.digHint,
      musicCfg: { ...MUSIC_DEFAULTS, ...(s.musicCfg && typeof s.musicCfg === 'object' ? s.musicCfg : {}) } };
  } catch { return { launched: 0, hearts: 0, received: 0, wishes: 0, hidden: [], hearted: [], mine: [], log: [], heartsBy: {}, lastVisit: 0, music: true, musicCfg: { ...MUSIC_DEFAULTS } }; }
}
let save = loadSave();
// a lantern's launch time is in its id ('m' + Date.now() in base 36): older saves had none recorded
const idTime = (id) => { const t = /^m[0-9a-z]+$/.test(id || '') ? parseInt(id.slice(1), 36) : 0; return t > 1.6e12 && t < Date.now() + 864e5 ? t : 0; };
if (!save.log.length && save.mine.length) save.log = save.mine.map(m => ({ id: m.id, text: m.text, color: m.color, mode: m.mode, at: idTime(m.id), lake: 0 }));
for (const e of save.log) if (!e.at) e.at = idTime(e.id);   // repair diaries made with at: 0
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('c');
// no preserveDrawingBuffer: the studio reads the canvas in the same turn it draws, and keeping the buffer costs
// an extra copy every frame (notably on Windows / ANGLE-D3D)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// adaptive resolution: the shaders here are per-pixel heavy (sky, water reflection, lit sand), so a weak GPU
// (a Windows laptop's integrated graphics at 125-150 % scaling) renders fewer pixels instead of stuttering.
// Starts at the screen's ratio (max 2, desktop max 1.5), steps down while frames miss the screen's refresh,
// back up after a few smooth seconds.
const RES_MAX = LITE ? 0.5 : Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 2 : 1.25);
const RES_MIN = Math.min(RES_MAX, LITE ? 0.45 : 0.6);   // lite: below this it only gets blurrier, not faster
// which GPU the browser gave us: a software renderer (graphics acceleration off, a blocked driver) cannot run this
// scene smoothly at any size, so start small and say how to turn acceleration back on
let resScale = RES_MAX, resT = 0, resN = 0, resSlow = 0, resGood = 0, vsync = 1 / 60;
let resCeil = RES_MAX, resWarm = 2, resLastUp = false;
renderer.setPixelRatio(resScale);
// judged by missed refreshes, not the average: a frame that takes two refreshes is the visible hitch
function adaptRes(dt) {
  if (window.__fixedRes || document.hidden || dt <= 0 || dt > 0.25) return;
  vsync = Math.min(vsync * 1.002, Math.max(1 / 240, dt));      // the screen's refresh: the shortest interval seen
  resT += dt; resN++; if (dt > Math.max(vsync, 1 / FPS_CAP) * 1.7) resSlow++;   // frames are capped at 60 (frame())
  if (resT < 1.2) return;                                         // judge over about a second
  const slow = resSlow / resN; resT = 0; resN = 0; resSlow = 0;
  if (resWarm > 0) { resWarm--; return; }                         // loading hitches are not the steady state
  let next = resScale;
  if (slow > 0.12 && resScale > RES_MIN) {
    if (resLastUp) resCeil = Math.max(RES_MIN, resScale * 0.97);  // that step up was too far: stay under it
    next = Math.max(RES_MIN, resScale * 0.9); resGood = 0;
  } else if (slow < 0.02) {
    if (++resGood >= 5 && resScale < resCeil) { next = Math.min(resCeil, resScale * 1.08); resGood = 0; }
  } else resGood = 0;
  if (Math.abs(next - resScale) > 0.01) {
    resLastUp = next > resScale; resScale = next; resWarm = 1;
    renderer.setPixelRatio(resScale); resize();
  } else resLastUp = false;
}
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
  snowCover: { value: 0 }, season: { value: new THREE.Vector4(0, 0, 1, 0) },
  // tonight's real moon: phase 0 new .. 0.5 full .. 1 new again, low over the far shore
  moonPhase: { value: 0.5 }, moonDir: { value: new THREE.Vector3(0.36, 0.115, -0.93).normalize() } };   // season: spring, summer, autumn, winter weights

const GLSL_COMMON = /* glsl */`
uniform float nightK; uniform float cloudK; uniform float rainK; uniform float fogK; uniform float moonPhase; uniform vec3 moonDir;
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*noise3(p); p *= 2.03; a *= 0.5; } return s; }
// three octaves: what the rippled reflection of the sky needs (its fine detail is broken up by the waves anyway)
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a*noise3(p); p *= 2.03; a *= 0.5; } return s + 0.125; }
#if defined(LITE)
#define SKYFBM(p) 0.5
#elif defined(SKY_LOW)
#define SKYFBM fbm3
#else
#define SKYFBM fbm
#endif
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
  float n = SKYFBM(dir * 5.0);
  float n2 = SKYFBM(dir * 16.0 + 3.0);
  col += vec3(0.15, 0.13, 0.26) * band * smoothstep(0.30, 0.85, n) * (1.3 + 0.6 * nightK);
  col += vec3(0.20, 0.12, 0.10) * band * smoothstep(0.60, 0.95, n) * 0.6;
  col *= 1.0 - 0.45 * band * smoothstep(0.52, 0.72, n2);
  // clouds: soft banks drifting slowly, thicker toward the horizon; they hide the stars and the Milky Way
  float cl = 0.0;
  if (cloudK > 0.001) {
    vec3 cd = vec3(dir.x, dir.y * 2.6, dir.z) * 2.2 + vec3(t * 0.006, 0.0, t * 0.003);
    float cn = SKYFBM(cd) * 0.75 + SKYFBM(cd * 2.7 + 5.0) * 0.25;
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
  // the moon: a lit disc in tonight's phase (terminator from a light that swings round it over the month),
  // faint earthshine on the dark part, a soft halo that grows with how much of it is lit; clouds cover it
  {
    float R = 0.032;
    vec3 rgt = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0))), upv = cross(rgt, moonDir);
    vec2 q = vec2(dot(dir, rgt), dot(dir, upv)) / R;
    float facing = dot(dir, moonDir);
    float lit = 0.5 - 0.5 * cos(6.2831853 * moonPhase);              // 0 new .. 1 full
    if (facing > 0.0) {
      float r2 = dot(q, q);
      if (r2 < 1.0) {
        float z = sqrt(1.0 - r2);
        float ph = 6.2831853 * moonPhase;
        vec3 L = vec3(sin(ph), 0.0, -cos(ph));
        float day = smoothstep(-0.06, 0.06, dot(vec3(q.x, q.y, z), L));   // waxing lit on the right, waning on the left
        float maria = 0.82 + 0.18 * smoothstep(0.35, 0.7, fbm(vec3(q * 2.3, 7.0)));
        vec3 mc = vec3(1.05, 0.98, 0.86) * maria * (0.75 + 0.25 * z);
        float edge = smoothstep(1.0, 0.92, r2);
        col = mix(col, mix(col * 0.8 + mc * 0.012, mc * 1.5, day), edge * (1.0 - cl));   // the dark part barely shows against the sky
      }
      float md = length(q) * R;
      col += vec3(0.32, 0.30, 0.38) * exp(-md * 26.0) * (0.15 + 0.85 * lit) * 0.55 * (1.0 - 0.8 * cl) * (1.0 - 0.6 * fogK);
    }
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
  fragmentShader: `${LITE ? '#define LITE' : ''}
    uniform float time; varying vec3 vDir; ${GLSL_COMMON}
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
  fragmentShader: `#define SKY_LOW
    ${LITE ? '#define LITE' : ''}
    uniform float time; uniform vec3 camPos; varying vec3 vW; ${GLSL_COMMON}
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
      #ifndef LITE
      g += (vec2(noise3(vec3(p*0.6, t*0.3)), noise3(vec3(p*0.6 + 9.0, t*0.3))) - 0.5) * 0.07 * k;
      g += (vec2(noise3(vec3(p*1.7, t*0.5)), noise3(vec3(p*1.7 + 4.0, t*0.5))) - 0.5) * 0.035 * k * kf;
      #endif
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
  beach = shore.buildShore(scene, uniforms, { lite: LITE });

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
// lite tier (quality.js): the small scatter on the sand is most of the scene's triangles; keep a share of each
if (LITE) {
  const KEEP = { pebbles: 0, twigs: 0, shells: 0, grass: 0.3, rock: 0.35, driftwood: 0.5, bush: 0.35, reeds: 0.6 };
  const dress = scene.children.find((o) => o.userData.tag === 'shore-dressing');
  if (dress) for (const m of dress.children) if (m.isInstancedMesh && m.userData.tag in KEEP) { m.count = Math.ceil(m.count * KEEP[m.userData.tag]); m.visible = m.count > 0; }
}

// ---------------------------------------------------------------- Seoul weather + season
// the season comes from today's date in Seoul; the weather is fetched once per visit (clear night of the
// season if the weather service does not answer within a few seconds)
const atmos = createAtmosphere(scene, uniforms, { pixelRatio: renderer.getPixelRatio(),
  coarse: LITE || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches), lite: LITE });
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
// the moon's phase from the date (mean synodic month from the new moon of 2000-01-06 18:14 UTC)
function moonPhaseNow(ms = Date.now()) {
  const syn = 29.530588853, age = ((ms - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % syn;
  return ((age + syn) % syn) / syn;
}
function moonName(p) {
  if (p < 0.03 || p > 0.97) return L('🌑 달 없는 밤', '🌑 moonless night');
  if (p < 0.22) return L('🌒 초승달', '🌒 crescent moon');
  if (p < 0.28) return L('🌓 상현달', '🌓 first quarter');
  if (p < 0.47) return L('🌔 차오르는 달', '🌔 waxing moon');
  if (p < 0.53) return L('🌕 보름달', '🌕 full moon');
  if (p < 0.72) return L('🌖 기우는 달', '🌖 waning moon');
  if (p < 0.78) return L('🌗 하현달', '🌗 last quarter');
  return L('🌘 그믐달', '🌘 old moon');
}
uniforms.moonPhase.value = moonPhaseNow();
const ATMOS_VIEW = { pos: [-6, 3.2, 24], target: [2, 3.5, -40] };
function forceAtmos(w, s) { forcedWeather = w; forcedSeason = s; applyAtmos(true); }
function realAtmos() { if (forcedWeather || forcedSeason) forceAtmos(null, null); }
function weatherLine() {
  const S = SEASONS[seoul.season];
  if (!seoul.weather) return L(`${S.emoji} ${S.name}밤의 호수예요`, `${S.emoji} An ${S.name} night on the lake`);
  const W = WEATHER[seoul.weather];
  const t = typeof seoul.temp === 'number' ? ` · ${Math.round(seoul.temp)}°` : '';
  const moon = seoul.weather === 'clear' || seoul.weather === 'cloudy' ? ` · ${moonName(uniforms.moonPhase.value)}` : '';
  return L(`${W.emoji} ${S.name}밤, ${W.line}${t}${moon}`, `${W.emoji} An ${S.name} night, ${W.line}${t}${moon}`);
}
function noticeWeather() {
  if (weatherNoticed || !seoul.tried) return;
  weatherNoticed = true;
  applyAtmos(false);                   // rain rings spread, clouds gather, snow starts to fall, over a few seconds
  const wait = invitedLake() ? 5200 : 1600;
  toastBusyUntil = Math.max(toastBusyUntil, Date.now() + wait + 5200);   // keep the queue clear for it
  setTimeout(() => toast(weatherLine(), 5200), wait);
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
// other players' characters, by peer id; their scarves avoid the player's own coral
const others = new Map();
const OTHER_SCARVES = [0x5fa6ee, 0x92d65c, 0xa66cf2, 0xf0c85a, 0x5fd6c8, 0xf0809c];
const START = { x: 0, z: 16 };
walker.reset(START.x, START.z);
const keys = new Set();
// on a touch screen the tip speaks of taps and drags, not keys
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  document.getElementById('tip').textContent = L('땅을 눌러 걸어요 · 화면을 끌어 둘러봐요 · 등불을 누르면 한마디가 보여요', 'Tap the ground to walk · drag to look around · tap a lantern to read it');
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
    liked: save.hearted.includes(opts.id), halo: null, motes: null,
    love: loveOf((opts.hearts | 0) + (save.hearted.includes(opts.id) ? 1 : 0)),
  };
  g.rotation.y = L.rot;
  lanterns.push(L);
  return L;
}

// how loved a lantern is, 0..1, from its hearts: 1 ♡ ≈ .27, 3 ≈ .54, 5 ≈ .7, 12+ = 1
const loveOf = (h) => (h > 0 ? Math.min(1, Math.log2(1 + h) / Math.log2(13)) : 0);
const HALO_COLOR = new THREE.Color(0xffe3a6);
// the halo's own texture: broad and even (GLOW is bright only at its centre, which the lantern itself hides)
const HALO = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.2)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function removeLantern(L) {
  lanternGroup.remove(L.group); lanternGroup.remove(L.refl);
  L.mat.dispose(); L.glow.material.dispose(); L.refl.material.dispose();
  if (L.halo) L.halo.material.dispose();
  if (L.motes) L.motes.forEach((m) => m.material.dispose());
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
      makeLantern({ id, text: msgs[i], color, mode, x, y: 0, z, hearts: Math.floor(Math.pow(rng(), 2.4) * 11) });
    } else {
      const [x, z] = randomLakePoint(0.9, -15);
      makeLantern({ id, text: msgs[i], color, mode, x, y: rr(4, 90), z, hearts: Math.floor(Math.pow(rng(), 2.4) * 11) });
    }
  }
  // extra wordless background lanterns so the lake always feels full
  for (let i = 0; i < (LITE ? 6 : 16); i++) {   // lite tier: fewer of them (each is several draw calls)
    const id = 'b' + i;
    if (save.hidden.includes(id)) continue;
    const mode = i % 2 ? 'sky' : 'water';
    const color = pickColor();
    const [x, z] = randomLakePoint(0.9, mode === 'sky' ? -30 : -20);
    makeLantern({ id, text: '', color, mode, x, y: mode === 'sky' ? rr(10, 120) : 0, z, hearts: Math.floor(Math.pow(rng(), 3) * 6) });
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
// ---- my constellation: every lantern you launched becomes a star from the next day (Seoul date), a dozen to a
// constellation joined by faint lines, above the far hills left of the moon; more hearts, a brighter star
const kstDay = (ms) => { const d = new Date(ms + 9 * 3600 * 1000); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
let starsForce = false;
const ripe = (e) => starsForce || (e.at && kstDay(e.at) < kstDay(Date.now()));
// everything you launched: the diary log, plus older lanterns from before the diary existed (only in save.mine;
// their launch time is in the id, 'm' + Date.now() in base 36)
function starEntries() {
  const seen = new Set(save.log.map((e) => e.id));
  const old = save.mine.filter((m) => !seen.has(m.id)).map((m) => ({ ...m, at: idTime(m.id) })).filter((m) => m.at);
  return old.concat(save.log).sort((a, b) => (a.at || 0) - (b.at || 0));
}
const myRipe = () => starEntries().filter(ripe);
const strHash = (s, k = 0) => { let h = 2166136261 ^ k; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 100000) / 100000; };
const myStarMat = new THREE.ShaderMaterial({
  uniforms: { time: uniforms.time, pr: { value: renderer.getPixelRatio() } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  vertexShader: `uniform float time; uniform float pr; attribute float aSize; attribute vec3 aCol; attribute float aBorn; varying vec3 vC; varying float vA;
    void main(){ vC = aCol; float tw = 0.82 + 0.18 * sin(time * (1.3 + fract(aSize * 7.1) * 2.0) + aSize * 13.0);
      float born = clamp((time - aBorn) / 2.5, 0.0, 1.0); float pulse = 1.0 + 1.6 * exp(-max(0.0, time - aBorn - 2.0) * 0.5) * step(0.0, time - aBorn);
      vA = tw * born; gl_PointSize = aSize * pr * (0.85 + 0.3 * tw) * pulse; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vC; varying float vA;
    void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q);
      float core = exp(-r * r * 60.0) * 1.6, halo = exp(-r * r * 12.0) * 0.6;
      float rays = (exp(-abs(q.x) * 70.0) * exp(-abs(q.y) * 7.0) + exp(-abs(q.y) * 70.0) * exp(-abs(q.x) * 7.0)) * 0.5;
      float a = (core + halo + rays) * vA; if (a < 0.004) discard; gl_FragColor = vec4(vC * a, a); }`,
});
const myStarLineMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
let myStars = null, myStarLines = null, myStarCount = 0;
function buildMyStars(bornNew = 0) {
  if (myStars) { scene.remove(myStars); myStars.geometry.dispose(); scene.remove(myStarLines); myStarLines.geometry.dispose(); }
  const list = myRipe().slice(-60);
  myStarCount = list.length;
  const pos = [], size = [], col = [], born = [], seg = [];
  let az = 0, el = 0, az0 = 0;
  list.forEach((e, i) => {
    const j = i % 12, g = Math.floor(i / 12);
    if (j === 0) { az0 = -0.3 - g * 0.55; az = az0 + (strHash(e.id, 1) - 0.5) * 0.06; el = 0.27 + strHash(e.id, 2) * 0.04; }
    else {
      const th = (strHash(e.id, 3) - 0.5) * Math.PI * 1.6 + (j % 2 ? 0.4 : -0.4), step = 0.045 + strHash(e.id, 4) * 0.035;
      az += Math.cos(th) * step; el += Math.sin(th) * step * 0.8;
      if (el < 0.21) el = 0.42 - el; if (el > 0.42) el = 0.84 - el;   // clear of the hills (they reach ~10°)
      if (Math.abs(az - az0) > 0.22) az = az0 + Math.sign(az - az0) * 0.22 - (az - az0 - Math.sign(az - az0) * 0.22);
    }
    const R = 430, ce = Math.cos(el);
    pos.push(Math.sin(az) * ce * R, Math.sin(el) * R, LAKE.cz - Math.cos(az) * ce * R);
    const h = save.heartsBy[e.id] | 0;
    size.push(16 + Math.min(1, Math.log2(1 + h) / 3) * 12 + strHash(e.id, 5) * 4);
    const tint = new THREE.Color((COLORS.find((c) => c.id === e.color) || COLORS[0]).hex).lerp(new THREE.Color(0xfff6e8), 0.6);
    col.push(tint.r, tint.g, tint.b);
    born.push(i >= list.length - bornNew ? uniforms.time.value + 1.5 + (i - (list.length - bornNew)) * 0.6 : -100);
    if (j > 0) seg.push(...pos.slice(-6, -3), ...pos.slice(-3));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aBorn', new THREE.Float32BufferAttribute(born, 1));
  myStars = new THREE.Points(g, myStarMat); myStars.frustumCulled = false; myStars.renderOrder = -15; scene.add(myStars);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  myStarLines = new THREE.LineSegments(lg, myStarLineMat); myStarLines.frustumCulled = false; myStarLines.renderOrder = -16; scene.add(myStarLines);
}
// on arrival: build them, and if some became stars since the last visit, let them appear one by one and say so
function arriveStars() {
  const n = myRipe().length, fresh = Math.max(0, n - (save.starsSeen | 0));
  buildMyStars(fresh);
  if (fresh > 0) {
    save.starsSeen = n; persist();
    const show = () => {
      if (screen === 'title' || !weatherNoticed || Date.now() < toastBusyUntil + 300) { setTimeout(show, 700); return; }
      toast(fresh === 1 ? L('⭐ 지난번에 띄운 등불이 별이 되었어요 · 하늘을 올려다보세요', '⭐ The lantern you launched last time became a star · look up') : L(`⭐ 지난번에 띄운 등불 ${fresh}개가 별이 되었어요 · 하늘을 올려다보세요`, `⭐ ${fresh} of your lanterns became stars · look up`), 5200);
      audio.chime([1046.5, 1318.5, 1567.98, 2093], 0.14);
      // the view lifts toward them for a few seconds, then settles back
      if (screen === 'lake') { walker.turnView(-0.3, -0.55); setTimeout(() => { if (screen === 'lake') walker.turnView(null); }, 6500); }
    };
    setTimeout(show, 1500);
  }
}
const starHead = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xfff1d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
starHead.visible = false; starHead.scale.setScalar(9); scene.add(starHead);
let star = null, nextStar = 1e9;   // nextStar: only for a forced star (tests); the real ones come from the clock
// shooting stars are shared: everyone computes the same schedule from the wall clock (a 24 s slot, about two
// in three slots carry a star at a moment set by the slot), so a lake sees the same star at the same time
const STAR_SLOT = 24;
let starSlot = -1, starAt = 0, starSide = 1, wishSlot = -1;
const slotHash = (n, k) => { let h = (n * 374761393 + k * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function scheduleStars(nowMs) {
  const slot = Math.floor(nowMs / 1000 / STAR_SLOT);
  if (slot === starSlot) return;
  starSlot = slot;
  starAt = slotHash(slot, 1) < 0.66 ? (slot * STAR_SLOT + 2 + slotHash(slot, 2) * (STAR_SLOT - 6)) * 1000 : 0;
  starSide = slotHash(slot, 3) < 0.5 ? -1 : 1;
}
// a shooting star crosses the sky where you are looking; for a few seconds you can make a wish on it
let wishOpen = 0, lastStarHead = new THREE.Vector3(), lastStarNdc = [0, 0.6];
function spawnStar(slot = starSlot) {
  // pick the streak in screen space (upper sky of the current view), then put it far out along those rays,
  // so it is always seen whatever way the camera is turned or tilted; its side and slope come from the slot,
  // so everyone sees it fall the same way
  const sx = starSide * (0.25 + 0.45 * slotHash(slot, 4)), sy = 0.62 + 0.24 * slotHash(slot, 5);
  const ex = sx - starSide * (0.35 + 0.2 * slotHash(slot, 6)), ey = sy - (0.18 + 0.12 * slotHash(slot, 7));
  wishSlot = slot;
  const ray = (x, y) => new THREE.Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(320).add(camera.position);
  const start = ray(sx, sy), end = ray(ex, ey);
  const dir = end.clone().sub(start); const len = dir.length(); dir.normalize();
  star = { p: start, d: dir, t: 0, life: 1.1, speed: len / 1.1, ndc: [ex, ey] };
  if (screen === 'lake' || screen === 'card') { wishOpen = 5; $('wishBtn').classList.remove('hidden'); audio.chime([1567.98], 0, 0.05); }
}
// someone else on the lake wished on the same star: a softer fall of sparks where it went out, and a line
const wishSeen = new Set(), wishesBySlot = new Map();
function othersWished(slot) { return wishesBySlot.get(slot) || 0; }
function otherWish(slot, h) {
  if (!h || wishSeen.has(h)) return; wishSeen.add(h);
  wishesBySlot.set(slot, othersWished(slot) + 1);
  if (screen === 'title' || Math.abs(slot - starSlot) > 1) return;
  sparkFall(14, 0.7);
  audio.chime([1174.66, 1567.98], 0.14);
  toast(othersWished(slot) > 1 ? L(`✨ ${othersWished(slot)}명이 같은 별똥별에 소원을 빌었어요`, `✨ ${othersWished(slot)} people wished on the same shooting star`) : L('✨ 누군가 같은 별똥별에 소원을 빌었어요', '✨ Someone wished on the same shooting star'), 2800);
}
function makeWish() {
  if (wishOpen <= 0) return;
  wishOpen = 0; $('wishBtn').classList.add('hidden');
  save.wishes++; persist(); updateStats();
  const h = net.myKey + 'w' + Date.now().toString(36);
  wishSeen.add(h); net.sendWish(wishSlot, h); board.wish(wishSlot, h);
  audio.chime([783.99, 987.77, 1174.66, 1567.98], 0.11);
  // a fall of gold sparks from where the star went out
  // from where the star went out, brought near enough to see the sparks fall
  sparkFall(30, 1);
  toast(othersWished(wishSlot) ? L(`🌠 소원이 별에 닿았어요 · ${othersWished(wishSlot)}명이 같은 별에 빌었어요`, `🌠 Your wish reached the star · ${othersWished(wishSlot)} others wished on it too`) : L('🌠 소원이 별에 닿았어요', '🌠 Your wish reached the star'));
}
// a fall of gold sparks from where the star went out, brought near enough to see them fall
function sparkFall(n, k) {
  const base = new THREE.Vector3(lastStarNdc[0], lastStarNdc[1], 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(40).add(camera.position);
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: i % 3 ? 0xffe3a0 : 0xfff6dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: k }));
    sp.position.copy(base); sp.scale.setScalar(2.2 * (0.6 + 0.4 * k));
    const a = rng() * Math.PI * 2, e = rr(-0.4, 1);
    sp.userData = { v: new THREE.Vector3(Math.cos(a) * 9, 4 + e * 8, Math.sin(a) * 9), life: 1.8 + rng(), t: 0 };
    scene.add(sp); sparks.push(sp);
  }
}
function updateStar(dt) {
  nextStar -= dt;
  const nowMs = Date.now();
  scheduleStars(nowMs);
  if (!star && starAt && nowMs >= starAt) { starAt = 0; spawnStar(); }
  if (!star && nextStar <= 0) { nextStar = 1e9; spawnStar(starSlot + 100000); }
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
    // loved lanterns burn brighter: a bigger, stronger glow, a lighter paper, and from about 4 ♡ a soft golden
    // halo that breathes; a new heart brightens it over a second or two
    L.love += (loveOf(L.hearts + (L.liked ? 1 : 0)) - L.love) * Math.min(1, dt * 1.5);
    const lv = L.love;
    L.mat.color.setScalar(1 + 0.4 * lv);
    L.glow.material.opacity = Math.min(1, 0.8 * flick * (1 + 0.45 * lv)) * L.alpha * Math.min(1.6, sel) * near;
    L.glow.scale.setScalar((L.mode === 'water' ? 3.4 : 3.6) * sel * fresh * (1 + 0.6 * lv));
    const hk = Math.max(0, (lv - 0.3) / 0.7);          // halo from 2 ♡, full at 12
    if (hk > 0.01 && !L.halo) {
      L.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: HALO, color: HALO_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
      L.halo.position.y = 0.8; L.group.add(L.halo);
    }
    if (L.halo) {
      const breathe = 0.5 + 0.5 * Math.sin(T * 1.6 + L.ph);
      L.halo.material.opacity = Math.min(1, hk * (0.62 + 0.25 * breathe)) * L.alpha * near;
      L.halo.scale.setScalar((L.mode === 'water' ? 3.0 : 3.1) * (0.94 + 0.1 * breathe) * (0.8 + 0.35 * hk));
    }
    // the most loved (about 7 ♡ and up): a few golden motes drift up around it
    const mk = Math.max(0, (lv - 0.75) / 0.25);
    if (mk > 0.01 && !L.motes) {
      L.motes = [];
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: HALO_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
        m.scale.setScalar(0.6); L.group.add(m); L.motes.push(m);
      }
    }
    if (L.motes) L.motes.forEach((m, i) => {
      const u = (T * 0.32 + i / 4 + L.ph) % 1, a = i * 1.57 + T * 0.6 + L.ph;
      m.position.set(Math.cos(a) * 0.6, 0.6 + u * 2.4, Math.sin(a) * 0.6);
      m.material.opacity = mk * Math.sin(u * Math.PI) * 0.95 * L.alpha * near;
    });
    if (L.mode === 'water') {
      L.refl.position.set(L.x, -2.2, L.z);
      L.refl.scale.set(3.2 + Math.sin(T * 2 + L.ph) * 0.4, 8, 1);
      L.refl.material.opacity = 0.6 * flick * L.alpha * (1 + 0.6 * lv);
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
  if (wasBusy && !walker.busy() && (screen === 'lake' || screen === 'card')) { $('launchBtn').classList.remove('hidden'); if ($('shareBtn').classList.contains('hidden')) $('tip').classList.remove('hidden'); }
  if (beach) beach.update(dt, walker.pos);
  updateTapMark(dt);
  updateLanterns(dt);
  updateWhale(dt);
  updateWakes(dt);
  updateFire(dt);
  updateMelody(dt);
  updateSparks(dt);
  updateStar(dt);
  for (const r of others.values()) r.w.update(dt, NO_KEYS, T);
  updateCat(dt);
  stones.update(dt, T);
  if (screen !== 'title') net.sendPos(walker.pos.x, walker.pos.z, null, myScarf, walker.sitting, walker.inBoat, rideHostId);
  updateBoatUI();
  atmos.update(dt);
  scene.fog.density = 0.0042 + uniforms.fogK.value * 0.0095;
  scene.fog.color.copy(FOG_NIGHT).lerp(FOG_MIST, uniforms.fogK.value);
}

function render(dt = 0) {
  myStarMat.uniforms.pr.value = renderer.getPixelRatio();
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
// English UI (i18n.js): the page's own words are swapped once at start; everything said later goes through L()
const MSG_MAX = EN ? 40 : 30;
// the 🌐 toggle on the title switches language (remembered)
$('langBtn').textContent = EN ? '🌐 한국어' : '🌐 English';
$('langBtn').addEventListener('pointerdown', (e) => e.stopPropagation());
$('langBtn').onclick = (e) => { e.stopPropagation(); setLang(EN ? 'ko' : 'en'); };
if (EN) {
  document.documentElement.lang = 'en'; document.title = 'Wish Lanterns';
  const set = (sel, how, v) => { const e = document.querySelector(sel); if (e) { if (how === 'text') e.textContent = v; else if (how === 'html') e.innerHTML = v; else e.setAttribute(how, v); } };
  [
    ['#title h1', 'text', 'Wish Lanterns'], ['#title p', 'text', 'Put today’s heart in a lantern and set it on the lake'], ['#title .hint', 'text', 'Tap to begin'],
    ['#stats', 'title', 'Go to another lake'], ['#lakePanel h2', 'text', 'Choose a lake'], ['#lakeSub', 'text', 'Tap a lake to go there'],
    ['#invite', 'title', 'Copy an invite link'], ['#mute', 'title', 'Sound'], ['#music', 'title', 'Music'], ['#diaryBtn', 'title', 'My lanterns'],
    ['#boatBtn', 'text', '⛵ Take the boat'], ['#digBtn', 'text', '✋ Dig in the sand'], ['#noteOk', 'text', 'Fold it away'], ['.note-title', 'text', '📜 A note from the sand'], ['#emoteBtn', 'title', 'Actions (1-5)'],
    ['[data-emote=wave]', 'html', '👋<span>Wave</span>'], ['[data-emote=bow]', 'html', '🙇<span>Bow</span>'], ['[data-emote=jump]', 'html', '🎉<span>Hop</span>'],
    ['[data-emote=heart]', 'html', '💕<span>Heart</span>'], ['[data-emote=sit]', 'html', '🪑<span>Sit</span>'],
    ['[data-emote=wave]', 'title', 'Wave (1)'], ['[data-emote=bow]', 'title', 'Bow (2)'], ['[data-emote=jump]', 'title', 'Hop (3)'], ['[data-emote=heart]', 'title', 'Heart (4)'], ['[data-emote=sit]', 'title', 'Sit (5)'],
    ['#shareBtn', 'text', '📸 Keep this moment'], ['#wishBtn', 'text', '🌠 Make a wish'],
    ['#launchBtn', 'text', '🏮 Go to the water and launch'],
    ['#compose h2', 'text', 'My lantern'], ['#compose .label:not(.where)', 'text', 'Colour'],
    ['#compose .label:nth-of-type(3)', 'html', 'A few words <span class="sub">(or none at all)</span>'],
    ['#compose .label.where', 'text', 'Where should it go?'], ['#topic', 'title', 'Start from today’s topic'],
    ['#msg', 'placeholder', 'A few words from your heart'], ['#msg', 'maxlength', '40'], ['#count', 'text', '0/40'],
    ['[data-mode=water]', 'text', '🌊 On the water'], ['[data-mode=sky]', 'text', '✨ To the sky'], ['#send', 'text', 'Launch'],
    ['#hideBtn', 'text', 'Hide'], ['#reportBtn', 'text', '🚩 Report'], ['#photoBtn', 'text', '📸 Picture'],
    ['#diary h2', 'text', 'My lanterns'], ['#seeStars', 'text', '⭐ See my constellation'],
    ['#musicPanel h2', 'text', 'Music'], ['[data-mood=calm]', 'text', '🌙 Calm'], ['[data-mood=warm]', 'text', '🕯️ Warm'],
    ['[data-mood=dreamy]', 'text', '🫧 Dreamy'], ['[data-mood=starry]', 'text', '✨ Starry'], ['#musicReset', 'text', 'Reset'],
    ['#sharePanel h2', 'text', 'Keep this moment'], ['#shareImg', 'alt', 'Lantern picture card'], ['#shareGo', 'text', 'Share'], ['#shareSave', 'text', 'Save'],
  ].forEach(([sel, how, v]) => set(sel, how, v));
  if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) set('#tip', 'text', 'WASD/arrows or tap the ground to walk · drag or Q/E to look around · tap a lantern to read it');
}
const audio = new Audio();
let screen = 'title';
let selected = null;
let composeColor = COLORS[0].id, composeMode = 'water';

let online = 0;
let lakeNo = null;
function updateStats() {
  const people = lakeNo ? L(`🌙 호수 ${lakeNo}${online > 1 ? ` · 지금 ${online}명` : ''} · `, `🌙 Lake ${lakeNo}${online > 1 ? ` · ${online} here` : ''} · `) : (online > 1 ? L(`🌙 지금 호수에 ${online}명 · `, `🌙 ${online} on the lake · `) : '');
  const got = (save.received ? L(` · 받은 반짝임 ${save.received}`, ` · hearts received ${save.received}`) : '') + (save.wishes ? L(` · 별똥별 소원 ${save.wishes}`, ` · wishes ${save.wishes}`) : '');
  $('stats').textContent = L(`${people}띄운 등불 ${save.launched} · 보낸 반짝임 ${save.hearts}${got}`, `${people}lanterns ${save.launched} · hearts sent ${save.hearts}${got}`);
  if (lakeNo) $('stats').insertAdjacentHTML('beforeend', ' <span class="lake-caret">▾</span>');
}

// ---------------------------------------------------------------- multiplayer
let netSeed = 99991;
const nrnd = () => { netSeed = (netSeed * 1664525 + 1013904223) >>> 0; return netSeed / 4294967296; };
let lastArrivalToast = 0;
const netHooks = {
  onLantern(e, who, fresh, peerId) {
    if (save.hidden.includes(e.netId) || lanterns.some(l => l.id === e.netId)) return;
    const text = cleanMessage(e.text);
    const water = e.mode === 'water';
    let x, z, y;
    const by = fresh && peerId && others.get(peerId);
    if (by) {      // launched by someone we can see: it sets off from where their character kneels or stands
      const afloatBy = by.w.inBoat || by.w.riding, hy = by.w.yaw;
      const at = afloatBy ? { x: by.w.pos.x + Math.cos(hy) * 1.35 * (water ? 1 : 0.3), z: by.w.pos.z - Math.sin(hy) * 1.35 * (water ? 1 : 0.3) } : water ? shore.nearestShore(by.w.pos.x, by.w.pos.z, -1.4) : { x: by.w.pos.x, z: by.w.pos.z };
      x = at.x; z = at.z; y = water ? 0 : 2.4;
    } else if (fresh) { // launched just now by someone on the shore: comes in from the near edge
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
      vx: by ? by.w.lakeDir().x * (water ? 1.6 : 0.4) : 0, vz: by ? by.w.lakeDir().z * (water ? 1.6 : 0.4) : fresh ? (water ? -1.6 : -0.4) : 0,
      vy: water ? 0 : 0.5, alpha: 0, fadeIn: by ? 2.6 : 2, fresh: fresh ? 5 : 0, hearts: e.hearts | 0 });
    if (fresh) lanterns[lanterns.length - 1].grow = 0;   // starts small, like one just let go of
    if (fresh && screen !== 'title' && T - lastArrivalToast > 4) {
      lastArrivalToast = T;
      toast(text ? L(`누군가 「${text}」 등불을 띄웠어요`, `Someone launched “${text}”`) : L('누군가 조용히 등불을 띄웠어요', 'Someone quietly launched a lantern'));
      audio.chime([659.25, 880], 0.12);
    }
  },
  onHeart(netId, h) {
    if (h) { if (heartSeen.has(h)) return; heartSeen.add(h); }   // the same heart can arrive directly and via the relays
    const mineKey = net.myKey ? net.myKey + ':' : null;
    const localId = mineKey && netId.startsWith(mineKey) ? netId.slice(mineKey.length) : netId;
    const L = lanterns.find(l => l.id === localId);
    if (L) { burst(L); L.hearts++; if (selected === L) refreshHeart(); }
    if (L && L.mine) {
      save.received++; save.heartsBy[L.id] = (save.heartsBy[L.id] | 0) + 1; persist(); updateStats();
      toast(L.text ? T_(`누군가 「${L.text}」 등불에 ♡를 보냈어요`, `Someone sent ♡ to “${L.text}”`) : T_('누군가 내 등불에 ♡를 보냈어요', 'Someone sent ♡ to your lantern'));
      audio.chime([783.99, 987.77, 1174.66]);
    }
  },
  onPresence(n) { if (n !== online) { online = n; updateStats(); } },
  onLake(n) { // moved to another lake: drop the previous lake's people and their lanterns
    for (const L of [...lanterns]) if (!L.mine && L.id.includes(':')) { if (selected === L) closeCard(); removeLantern(L); }
    lakeNo = n; online = 1; updateStats();
    for (const r of others.values()) r.w.dispose();
    others.clear();
    joinBoard(n);                      // the lanterns left on this lake today, and new ones live through the relays
  },
  onJoin() { if (screen !== 'title') toast(L('누군가 호숫가에 왔어요', 'Someone came to the shore'), 2400); },
  // the other people on this lake walk the shore as characters of their own (scarf colour by person)
  onPos(id, d) {
    let r = others.get(id);
    if (!r) {
      if (others.size >= 9) return;
      r = { w: createWalker(scene, shore, GLOW, { remote: true, scarf: OTHER_SCARVES[d.s % OTHER_SCARVES.length] }) };
      r.w.reset(d.x, d.z); others.set(id, r);
    }
    // a passenger: sits in their host's boat (the host may be us)
    const wasMine = r.rd && r.rd === net.myId;
    r.rd = d.rd || '';
    if (r.rd) {
      const host = r.rd === net.myId ? walker : others.get(r.rd) && others.get(r.rd).w;
      if (host && host.inBoat) {
        r.w.setRide(host);
        if (r.rd === net.myId && !wasMine && screen !== 'title') toast(L('⛵ 누군가 내 배에 함께 탔어요', '⛵ Someone joined you in your boat'), 3000);
        return;
      }
    }
    if (r.w.riding) r.w.setRide(null);
    if (Math.hypot(d.x - r.w.pos.x, d.z - r.w.pos.z) > 8) r.w.reset(d.x, d.z);   // jumped (reload, another path): no long walk
    if (d.cer && !r.w.busy()) r.w.ceremony(d.cer);
    else if (!d.cer) { r.w.setBoat(!!d.b); r.w.walkTo(d.x, d.z); if (!d.b) r.w.setSitting(!!d.sit); }
  },
  // a lantern taken down (reported by several people, or by the admin): it leaves every screen
  onRemove(id) { const L = lanterns.find((l) => l.id === id && !l.mine); if (L) { if (selected === L) closeCard(); removeLantern(L); } },
  onNote(id, i) { if (Number.isInteger(i) && i >= 0 && i < NOTES.length) { playStone(i, true); heardNote(id, i); } },
  onEmote(id, k) { const r = others.get(id); if (r) r.w.emote(k); },
  onWish(slot, h) { otherWish(slot, h); },
  onLeave(id) { const r = others.get(id); if (r) { r.w.dispose(); others.delete(id); } },
  onStatus(msg) { toast(msg, 4000); },
  onAwayHeart(netId, h) { awayHeart(netId, h); },
  // our server could not be reached: carry on serverless (direct P2P + public relays), as before it existed
  onFallback() {
    if (!(net instanceof ServerNet)) return;
    net = new Net(netHooks); net.setMine(save.mine); loadBoard(); net.start();
  },
};
// with a server configured (config.js) the lake goes through it; otherwise serverless P2P + relays
const SERVER = serverUrl();
let net = SERVER ? new ServerNet(netHooks, SERVER) : new Net(netHooks);
net.setMine(save.mine);
// the lake's memory (board.js): lanterns stay a day on public relays, so an empty lake is never empty
const heartSeen = new Set();
const myScarf = [...net.myKey].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 6;
// it loads in the background (with its signing library) so the first screen stays light
let board = { status: 'off', join() {}, post() {}, heart() {}, wish() {} };
// hearts for our lanterns that came while we were away: counted once, told once a few seconds in
let awayCount = 0, awayTimer = 0, visitSince = save.lastVisit;
function joinBoard(n) {
  board.join(n, net.myKey, visitSince);
  save.lastVisit = Math.floor(Date.now() / 1000); persist();
}
function awayHeart(netId, h) {
  if (!h || heartSeen.has(h)) return; heartSeen.add(h);
  const mineKey = net.myKey + ':';
  if (!netId.startsWith(mineKey)) return;
  const id = netId.slice(mineKey.length);
  save.received++; save.heartsBy[id] = (save.heartsBy[id] | 0) + 1; persist(); updateStats();
  const L = lanterns.find(l => l.id === id); if (L) L.hearts++;
  awayCount++;
  clearTimeout(awayTimer);
  awayTimer = setTimeout(() => {
    // after the weather line and any other line on screen, so it is read on its own
    const show = () => {
      if (screen === 'title' || !weatherNoticed || Date.now() < toastBusyUntil + 300) { setTimeout(show, 600); return; }
      toast(T_(`🌙 자리를 비운 사이, 내 등불에 ♡ ${awayCount}개가 도착했어요`, `🌙 While you were away, ${awayCount} ♡ reached your lanterns`), 5200);
      audio.chime([659.25, 783.99, 987.77, 1318.5], 0.12); awayCount = 0;
    };
    show();
  }, 3000);
}
function loadBoard() { import('./board.js').then(({ Board }) => {
  board = new Board({
    // with people connected directly, give their own message a moment to arrive first (it knows who launched it)
    onLantern(e, fresh) { if (fresh && net.peers > 0) setTimeout(() => net.hooks.onLantern(e, '', fresh), 2500); else net.hooks.onLantern(e, '', fresh); },
    onHeart(netId, h) { net.hooks.onHeart(netId, h); },
    onWish(slot, h) { otherWish(slot, h); },
    onAwayHeart(netId, h) { awayHeart(netId, h); },
  });
  if (lakeNo) joinBoard(lakeNo);
}).catch(() => {}); }
if (net instanceof ServerNet) { net.since = visitSince; net.scarf = myScarf; } else loadBoard();
// the connection line at the bottom is for debugging only: shown with ?debug in the address
const SHOW_NETLINE = /[?&]debug\b/.test(location.search);
if (!SHOW_NETLINE) $('netline').style.display = 'none';
setInterval(() => { net.poll(); const d = $('netline'); if (d && SHOW_NETLINE) d.textContent = net.statusLine() + ` · board ${board.status}`; }, 250);
let toastTimer = 0;
let toastBusyUntil = 0;
function toast(msg, ms = 3200) {
  toastBusyUntil = Date.now() + ms;
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
  arriveStars();
  if (SOFTWARE_GPU) setTimeout(() => toast(L('⚠️ 그래픽 가속이 꺼져 있어 가벼운 화면으로 보여 드려요 · 크롬 설정 → 시스템 → "가능한 경우 그래픽 가속 사용"을 켜면 훨씬 예뻐요', '⚠️ Graphics acceleration is off, so this is a lighter view · turn on "Use graphics acceleration when available" in your browser settings for the full scene'), 9000), 2500);
  const inv = invitedLake();
  if (inv) setTimeout(() => toast(L(`초대받은 호수 ${inv}에 들어왔어요`, `You joined lake ${inv} from an invite`), 3500), 1400);
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
function onMsgInput() { $('count').textContent = `${[...$('msg').value].length}/${MSG_MAX}`; }
$('msg').addEventListener('input', onMsgInput);
$('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendLantern(); e.stopPropagation(); });
document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
  composeMode = b.dataset.mode; document.querySelectorAll('.mode').forEach(x => x.classList.toggle('on', x === b)); audio.tick();
});
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closePanel(b.dataset.close));

function openCompose() {
  closeCard(); closePanel('music');
  $('topic').textContent = L(`💭 오늘의 주제 · ${topicToday()}`, `💭 Today’s topic · ${topicToday()}`);
  $('toast').classList.add('hidden');   // the weather / arrival line never sits over the panel
  $('compose').classList.remove('hidden');
  $('launchBtn').classList.add('hidden'); $('tip').classList.add('hidden');
  screen = 'compose';
  setTimeout(() => $('msg').focus(), 50);
}
function closePanel(which) {
  if (which === 'share') { $('sharePanel').classList.add('hidden'); if (screen === 'share') screen = 'lake'; return; }
  if (which === 'lakes') { $('lakePanel').classList.add('hidden'); if (screen === 'lakes') screen = 'lake'; return; }
  if (which === 'music') { $('musicPanel').classList.add('hidden'); if (screen === 'music') screen = 'lake'; return; }
  if (which === 'diary') { $('diary').classList.add('hidden'); if (screen === 'diary') screen = 'lake'; return; }
  if (which === 'compose') { $('compose').classList.add('hidden'); $('launchBtn').classList.remove('hidden'); $('tip').classList.remove('hidden'); screen = 'lake'; }
  else closeCard();
}
$('launchBtn').onclick = () => {
  audio.start();
  if (walker.state().nearWater) { openCompose(); return; }
  const e = shore.nearestShore(walker.pos.x, walker.pos.z, 1.2);
  walker.walkTo(e.x, e.z, () => { if (screen === 'lake') openCompose(); });
  showTapMark(e.x, e.z);
  toast(L('물가로 걸어가는 중…', 'Walking to the water…'), 1800);
};
let nearWaterShown = null;
function updateLaunchLabel() {
  const near = walker.state().nearWater;
  if (near === nearWaterShown) return;
  nearWaterShown = near;
  $('launchBtn').textContent = near ? L('🏮 여기서 등불 띄우기', '🏮 Launch a lantern here') : L('🏮 물가로 가서 등불 띄우기', '🏮 Go to the water and launch');
}
setInterval(updateLaunchLabel, 200);
$('send').onclick = () => sendLantern();

function sendLantern() {
  const text = cleanMessage($('msg').value);
  const id = 'm' + Date.now().toString(36);
  const water = composeMode === 'water';
  // set it down from where the character stands: on the water at its feet, or up from its hands
  const dir = { ...walker.lakeDir() };
  const fromPier = water && !walker.inBoat && !walker.riding && shore.pierLaunchPoint(walker.pos.x, walker.pos.z);
  const at = { ...(fromPier || (water ? shore.nearestShore(walker.pos.x, walker.pos.z, -1.4) : { x: walker.pos.x + dir.x * 0.7, z: walker.pos.z + dir.z * 0.7 })) };
  // the character kneels (water) or lifts it overhead (sky); the lantern sits in its hands until the release
  const afloat = walker.inBoat || walker.riding;
  let timing;
  if (afloat) {                       // from a boat: lean over the side (water) or raise it up (sky); no kneel, no cut-away
    const hy = walker.yaw, sx = Math.cos(hy), sz = -Math.sin(hy);      // the boat's right side
    at.x = walker.pos.x + sx * 1.35; at.z = walker.pos.z + sz * 1.35;
    dir.x = sx; dir.z = sz;
    walker.emote(water ? 'bow' : 'heart', true);
    timing = { release: water ? 1.3 : 1.1 };
  } else timing = walker.ceremony(composeMode);
  const h = walker.hands(new THREE.Vector3());
  const L = makeLantern({
    id, mine: true, text, color: composeColor, mode: composeMode,
    x: h.x, y: h.y, z: h.z, alpha: 0, fadeIn: 0.5, fresh: 6 + timing.release,
  });
  L.held = { t: 0, release: timing.release, to: { x: at.x, z: at.z },
    v: { x: dir.x * (water ? 2.2 : 0.5), z: dir.z * (water ? 2.2 : 0.5) + (water ? 0 : 0.2), y: water ? 0 : 0.7 } };
  L.grow = 0;
  cine = afloat ? null : { L, t: 0, mode: composeMode, dur: water ? 7.5 : 7, pos: camera.position.clone(), look: walker.camLook.clone() };
  save.mine.push({ id, text, color: composeColor, mode: composeMode });
  save.log.push({ id, text, color: composeColor, mode: composeMode, at: Date.now(), lake: lakeNo || 0 });
  if (save.log.length > 200) save.log.shift();
  if (save.mine.length > 12) save.mine.shift();
  save.launched++;
  persist(); updateStats(); net.setMine(save.mine);
  board.post(net.myKey, { k: id, t: text, c: composeColor, m: composeMode });
  if (net.post) net.post({ k: id, t: text, c: composeColor, m: composeMode });
  offerShare({ text, lake: lakeNo, at: Date.now() }, water ? 3200 : 2700);
  if (!afloat) net.sendPos(walker.pos.x, walker.pos.z, composeMode, myScarf);   // the others see us kneel or lift it
  $('compose').classList.add('hidden'); screen = 'lake';   // the button and tip come back when the pose ends
  if (!afloat) { $('launchBtn').classList.add('hidden'); $('tip').classList.add('hidden'); }
  closeCard();
  $('msg').value = ''; onMsgInput();
  setTimeout(() => audio.plop(), timing.release * 1000);
  toast(text ? T_(`「${text}」 등불이 천천히 떠나가요`, `“${text}” drifts slowly away`) : T_('등불이 조용히 떠나가요', 'Your lantern drifts quietly away'));
  return L;
}

// lantern card
function openCard(L) {
  if (selected) selected.selected = 0;
  selected = L; L.selected = 1;
  $('cardWho').textContent = L.mine ? T_('내가 띄운 등불', 'Your lantern') : L.who ? T_(`${L.who}님의 등불`, `${L.who}’s lantern`) : T_('누군가의 등불', 'Someone’s lantern');
  if (L.hearts + (L.liked ? 1 : 0) >= 5) $('cardWho').textContent += T_(' · ✨ 많은 마음이 닿은 등불', ' · ✨ loved by many');
  const m = $('cardMsg');
  if (L.text) { m.textContent = L.text; m.style.fontStyle = 'normal'; m.style.opacity = 1; }
  else { m.textContent = T_('말없이 띄운 등불이에요\n그 마음도 닿기를', 'A lantern sent without words\nmay its heart reach you'); m.style.whiteSpace = 'pre-line'; m.style.opacity = 0.75; }
  refreshHeart();
  $('hideBtn').classList.toggle('hidden', L.mine);
  // only other people's lanterns can be reported (the built-in warm ones can just be hidden)
  $('reportBtn').classList.toggle('hidden', L.mine || !L.id.includes(':'));
  $('photoBtn').classList.toggle('hidden', !L.mine);
  reportArm = 0; $('reportBtn').textContent = T_('🚩 신고', '🚩 Report');
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
    save.hearted.push(selected.id); save.hearts++; selected.liked = true;
    persist(); updateStats(); refreshHeart();
    burst(selected); audio.chime([783.99, 987.77, 1174.66]);
    const hid = selected.mine ? net.netIdFor(selected.id) || selected.id : selected.id;
    const h = net.myKey + Date.now().toString(36);
    heartSeen.add(h);
    net.sendHeart(hid, h); board.heart(hid, h);
  } else {
    burst(selected); audio.tick();
  }
};
$('hideBtn').onclick = () => {
  if (!selected || selected.mine) return;
  save.hidden.push(selected.id); persist();
  const L = selected; closeCard(); removeLantern(L);
  toast(T_('이 등불은 내 화면에서 숨겼어요', 'Hidden from your screen'), 2200);
};
// ---- the photo card: the moment as a 9:16 picture with the line, the date and the address, to share or keep
const SITE = 'wish-lanterns.ycyeom.workers.dev';
let shareMoment = null, shareTimer = 0, shareBlob = null;
function offerShare(moment, delay) {
  shareMoment = moment; clearTimeout(shareTimer);
  shareTimer = setTimeout(() => {
    if (screen !== 'lake' && screen !== 'card') return;
    $('shareBtn').classList.remove('hidden'); $('tip').classList.add('hidden');
    shareTimer = setTimeout(() => $('shareBtn').classList.add('hidden'), 14000);
  }, delay);
}
function wrapLines(g, text, maxW) {
  const out = []; let line = '';
  for (const ch of [...text]) { if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; }
  if (line) out.push(line);
  return out.slice(0, 3);
}
// draw the scene now and compose the card (the WebGL picture must be copied in the same turn it is drawn)
function makeCard(m) {
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  render(0);
  const sw = canvas.width, sh = canvas.height, k = Math.max(W / sw, H / sh), dw = sw * k, dh = sh * k;
  g.fillStyle = '#050816'; g.fillRect(0, 0, W, H);
  g.drawImage(canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
  let gr = g.createLinearGradient(0, 0, 0, 380); gr.addColorStop(0, 'rgba(5,8,22,.75)'); gr.addColorStop(1, 'rgba(5,8,22,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, 380);
  gr = g.createLinearGradient(0, H - 820, 0, H); gr.addColorStop(0, 'rgba(5,8,22,0)'); gr.addColorStop(0.45, 'rgba(5,8,22,.78)'); gr.addColorStop(1, 'rgba(5,8,22,.94)');
  g.fillStyle = gr; g.fillRect(0, H - 820, W, 820);
  const F = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,160,80,.75)'; g.shadowBlur = 28;
  g.fillStyle = '#ffe6c4'; g.font = `700 54px ${F}`; g.fillText(L('🏮 소원 등불', '🏮 Wish Lanterns'), W / 2, 150);
  g.shadowBlur = 0; g.fillStyle = 'rgba(255,240,220,.75)'; g.font = `400 30px ${F}`; g.fillText(L('오늘의 마음을 등불에 담아', 'Today’s heart, in a lantern'), W / 2, 222);
  const d = new Date((m.at || Date.now()) + 9 * 3600 * 1000);
  const when = EN ? `${d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}, at night${m.lake ? ` · lake ${m.lake}` : ''}` : `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 밤${m.lake ? ` · 호수 ${m.lake}` : ''}`;
  g.font = `700 64px ${F}`;
  const lines = m.text ? wrapLines(g, EN ? `“${m.text}”` : `「${m.text}」`, W - 160) : [L('말없이 띄운 등불', 'A lantern without words')];
  let y = H - 330 - (lines.length - 1) * 44;
  g.shadowColor = 'rgba(255,170,90,.8)'; g.shadowBlur = 30; g.fillStyle = '#fff3df';
  if (!m.text) g.font = `600 52px ${F}`;
  for (const ln of lines) { g.fillText(ln, W / 2, y); y += 88; }
  g.shadowBlur = 0; g.fillStyle = 'rgba(255,230,200,.85)'; g.font = `400 34px ${F}`; g.fillText(when, W / 2, H - 190);
  g.fillStyle = 'rgba(255,214,170,.95)'; g.font = `600 32px ${F}`; g.fillText(SITE, W / 2, H - 110);
  return c;
}
function openShare(m) {
  const c = makeCard(m);
  $('shareBtn').classList.add('hidden'); closeCard();
  $('shareImg').src = c.toDataURL('image/jpeg', 0.9);
  shareBlob = null; c.toBlob((b) => { shareBlob = b; }, 'image/jpeg', 0.92);
  $('toast').classList.add('hidden');
  $('sharePanel').classList.remove('hidden'); screen = 'share';
  audio.chime([783.99, 1046.5], 0.08);
}
const shareFile = () => shareBlob && new File([shareBlob], `sowon-deungbul-${Date.now().toString(36)}.jpg`, { type: 'image/jpeg' });
$('shareBtn').onclick = (e) => { e.stopPropagation(); if (shareMoment) openShare(shareMoment); };
$('photoBtn').onclick = () => { if (selected && selected.mine) { const L = selected; const log = save.log.find((x) => x.id === L.id); openShare({ text: L.text, lake: (log && log.lake) || lakeNo, at: (log && log.at) || Date.now() }); } };
$('shareSave').onclick = () => {
  const f = shareFile(); if (!f) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(L('사진을 저장했어요', 'Picture saved'), 2200);
};
$('shareGo').onclick = async () => {
  const f = shareFile(); if (!f) return;
  const data = { files: [f], title: L('소원 등불', 'Wish Lanterns'), text: L(`오늘의 마음을 등불에 담아 띄웠어요 🏮 https://${SITE}`, `I sent today’s heart off in a lantern 🏮 https://${SITE}`) };
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share(data); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  $('shareSave').click();                                  // no share sheet here (desktop): save it instead
  try { await navigator.clipboard.writeText(`https://${SITE}`); toast(L('사진을 저장하고 주소를 복사했어요', 'Picture saved and the link copied'), 2600); } catch {}
};
// report: a second tap confirms; it hides the lantern here at once and tells the server (3 different people's
// reports take it off the lake for everyone)
let reportArm = 0;
$('reportBtn').onclick = () => {
  if (!selected || selected.mine) return;
  if (Date.now() - reportArm > 3000) { reportArm = Date.now(); $('reportBtn').textContent = L('정말 신고할까요?', 'Report it?'); audio.tick(); return; }
  const L = selected;
  const sent = net.report(L.id);
  save.hidden.push(L.id); persist();
  closeCard(); removeLantern(L);
  toast(sent ? T_('🚩 신고했어요 · 이 등불은 이제 보이지 않아요. 여러 사람이 신고하면 호수에서 사라져요', '🚩 Reported · you won’t see it again. If several people report it, it leaves the lake') : T_('🚩 이 등불은 이제 보이지 않아요', '🚩 You won’t see this lantern again'), 3600);
};
$('wishBtn').addEventListener('click', (e) => { e.stopPropagation(); makeWish(); });
$('invite').onclick = async () => {
  const url = net.inviteUrl();
  try { await navigator.clipboard.writeText(url); toast(L(`호수 ${lakeNo || 1} 초대 링크를 복사했어요 · 친구에게 보내 보세요`, `Invite link to lake ${lakeNo || 1} copied · send it to a friend`), 3500); }
  catch { toast(url, 8000); }
  audio.tick();
};
// today's topic: tapping it puts it in the line as a start
$('topic').onclick = () => { const m = $('msg'); if (!m.value.trim()) { m.value = topicToday() + ' '; onMsgInput(); } m.focus(); audio.tick(); };
// choosing a lake: tap the lake line (top left) for all 30 with how many people are in each; full ones can
// still be chosen (like an invite)
const LAKE_TOTAL = 30;
async function openLakes() {
  if (screen === 'compose' || screen === 'diary' || screen === 'music') return;
  closeCard(); $('toast').classList.add('hidden');
  $('lakePanel').classList.remove('hidden'); screen = 'lakes';
  drawLakes(null); audio.tick();
  const d = await net.lakeCounts();
  if (screen === 'lakes') drawLakes(d);
}
function drawLakes(d) {
  const g = $('lakeGrid'); g.textContent = '';
  const cap = (d && d.cap) || 10;
  $('lakeSub').textContent = d ? L('사람이 있는 호수는 불이 켜져 있어요 · 눌러서 가 보세요', 'Lakes with people are lit · tap one to go') : (net instanceof ServerNet ? L('사람 수를 불러오는 중…', 'Counting people…') : L('가고 싶은 호수를 눌러 보세요', 'Tap a lake to go there'));
  for (let n = 1; n <= LAKE_TOTAL; n++) {
    const c = d ? (d.lakes[n - 1] | 0) : null;
    const b = document.createElement('button'); b.className = 'lake-cell';
    if (n === lakeNo) b.classList.add('here');
    if (c) b.classList.add('lit');
    if (c !== null && c >= cap) b.classList.add('full');
    b.innerHTML = `<b>${n}</b><span>${n === lakeNo ? L('여기', 'here') : c === null ? '' : c >= cap ? L(`가득 ${c}`, `full ${c}`) : c ? L(`${c}명`, `${c}`) : L('조용', 'quiet')}</span>`;
    b.onclick = () => goLake(n);
    g.appendChild(b);
  }
}
async function goLake(n) {
  closePanel('lakes');
  if (n === lakeNo) return;
  audio.chime([523.25, 659.25], 0.1);
  toast(L(`호수 ${n}(으)로 가는 중…`, `Going to lake ${n}…`), 2500);
  const ok = await net.switchLake(n);
  if (ok) {
    try { const u = new URL(location.href); u.searchParams.set('lake', String(n)); history.replaceState(null, '', u); } catch {}
    toast(L(`🌙 호수 ${n}에 왔어요`, `🌙 Welcome to lake ${n}`), 2600);
  } else toast(L('지금은 그 호수로 갈 수 없어요 · 잠시 뒤 다시 해 보세요', 'Can’t reach that lake now · try again in a moment'), 3200);
}
$('stats').onclick = (e) => { e.stopPropagation(); audio.start(); if (screen === 'lakes') closePanel('lakes'); else openLakes(); };
// ---- the rowboat: ⛵ at the water's edge to get in, 🏝 to get out at the nearest shore
let boatShown = '', tipOnShore = '', rideHostId = '', rideOffer = '';
// someone else's boat close by with its bow seat free: offer to ride along
function boatToJoin() {
  let best = '', bd = 6;
  for (const [id, o] of others) {
    if (!o.w.inBoat) continue;
    const taken = [...others.values()].some((x) => x.rd === id);
    const d = Math.hypot(o.w.pos.x - walker.pos.x, o.w.pos.z - walker.pos.z);
    if (!taken && d < bd) { bd = d; best = id; }
  }
  return best;
}
function leaveRide(hostLeft) {
  if (!rideHostId && !walker.riding) return;
  if (walker.riding) walker.unboard(true);   // far out, a passenger is set down on the nearest beach
  rideHostId = '';
  $('tip').textContent = tipOnShore || $('tip').textContent;
  toast(hostLeft ? L('🏝 사공이 배에서 내려서 물가로 돌아왔어요', '🏝 The rower went ashore, so you’re back on the shore') : L('🏝 물가로 돌아왔어요', '🏝 Back on the shore'), 2600);
}
function updateBoatUI() {
  const st = walker.state();
  if (rideHostId) { const h = others.get(rideHostId); if (!h || !h.w.inBoat) leaveRide(true); }
  rideOffer = !walker.inBoat && !walker.riding && !walker.busy() ? boatToJoin() : '';
  const want = screen !== 'lake' && screen !== 'card' ? '' : walker.riding ? 'out' : walker.inBoat ? 'out' : rideOffer ? 'ride' : (st.nearWater && !walker.busy() ? 'in' : '');
  if (want === boatShown) return;
  boatShown = want;
  $('boatBtn').classList.toggle('hidden', !want);
  $('boatBtn').textContent = want === 'out' ? L('🏝 내리기', '🏝 Go ashore') : want === 'ride' ? L('⛵ 같이 타기', '⛵ Ride along') : L('⛵ 배 타기', '⛵ Take the boat');
  $('launchBtn').classList.toggle('hidden', walker.busy());
  document.querySelector('[data-emote=sit]').classList.toggle('hidden', walker.inBoat || walker.riding);
}
$('boatBtn').onclick = (e) => {
  e.stopPropagation(); audio.start(); closeCard();
  if (walker.riding) { leaveRide(false); boatShown = '?'; updateBoatUI(); return; }
  if (!walker.inBoat && rideOffer) {                 // hop into their boat, on the bow bench facing them
    const host = others.get(rideOffer);
    if (host && host.w.inBoat) {
      tipOnShore = $('tip').textContent;
      walker.setRide(host.w); rideHostId = rideOffer; audio.plop();
      net.sendPos(walker.pos.x, walker.pos.z, null, myScarf, false, false, rideHostId);
      $('tip').textContent = L('사공이 노를 저어요 · 등불을 누르면 가까이서 읽어요 · 👋 인사도 해 보세요', 'Your rower is rowing · tap a lantern to read it · try waving 👋');
      toast(L('⛵ 배에 함께 탔어요 · 마주 보고 앉았어요', '⛵ You’re riding along, facing your rower'), 3200);
    }
    boatShown = '?'; updateBoatUI(); return;
  }
  if (walker.inBoat) {
    const ashore = () => { audio.plop(); $('tip').textContent = tipOnShore; toast(L('🏝 물가로 돌아왔어요', '🏝 Back on the shore'), 2200); boatShown = '?'; updateBoatUI(); };
    if (walker.unboard()) ashore();
    else {
      // out on the open lake, far from the beach: row back to the nearest landing on our own, then step ashore
      const l = walker.landing();
      if (l) {
        walker.walkTo(l.water.x, l.water.z, () => { if (walker.inBoat && walker.unboard(true)) ashore(); }, true);
        toast(L('🚣 가까운 해변으로 노를 저어 가요 · 도착하면 내려요', '🚣 Rowing back to the nearest beach · you’ll step ashore there'), 3200);
      }
    }
  } else if (walker.board()) {
    audio.plop(); tipOnShore = $('tip').textContent;
    $('tip').textContent = matchMedia('(pointer: coarse)').matches ? L('물을 누르면 그쪽으로 노를 저어요 · 등불을 누르면 가까이서 읽어요', 'Tap the water to row there · tap a lantern to read it up close') : L('W/S 노 젓기 · A/D 방향 · 물을 누르면 그쪽으로 · 등불을 눌러 읽어요', 'W/S row · A/D turn · tap the water to row there · tap a lantern to read it');
    toast(L('⛵ 배에 탔어요 · 등불 사이로 노를 저어 가 보세요', '⛵ You’re in the boat · row out among the lanterns'), 3200);
  }
  boatShown = '?'; updateBoatUI();
};
// ---- ripples: boats leave a V of rings from the stern and a ring where each oar blade dips
const wake = createWake(scene);
const wakeState = new Map();   // walker -> { x, z, t, ph }
function boatWake(w, dt) {
  if (!w.inBoat) { wakeState.delete(w); return; }
  let st = wakeState.get(w); if (!st) { st = { x: w.pos.x, z: w.pos.z, t: 0, ph: 0 }; wakeState.set(w, st); }
  const dx = w.pos.x - st.x, dz = w.pos.z - st.z, sp = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
  st.x = w.pos.x; st.z = w.pos.z;
  const yaw = w.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
  if (sp > 0.25 && (st.t -= dt) < 0) {
    st.t = 0.38;
    const k = Math.min(1, sp / 2.5);
    // two rings off the stern quarters, stretched along the boat: together they spread as a V behind it
    for (const s of [-1, 1]) wake.ring(w.pos.x - fx * 1.7 + rx * 0.45 * s, w.pos.z - fz * 1.7 + rz * 0.45 * s, 1.2 + k * 1.6, 0.7 + k * 0.6, 1.6, yaw);
  }
  // the oars: a ring each time the blades go into the water
  const r = w.row, s1 = Math.sin(r.ph);
  if (r.amt > 0.3 && st.ph <= 0 && s1 > 0) for (const s of [-1, 1]) wake.ring(w.pos.x + rx * 2.1 * s + fx * 0.3, w.pos.z + rz * 2.1 * s + fz * 0.3, 0.9, 0.9);
  st.ph = s1;
}
function updateWakes(dt) {
  boatWake(walker, dt);
  for (const o of others.values()) boatWake(o.w, dt);
  wake.update(dt);
}
// ---- the campfire: sit by it (🪑) and it grows; the more people sitting round it, the bigger and the more sparks
const fire = createCampfire(scene, shore, GLOW, beach && beach.extraLamp);
let fireHintDone = false;
function updateFire(dt) {
  const near = (w) => Math.hypot(w.pos.x - fire.pos.x, w.pos.z - fire.pos.z);
  let sitters = walker.sitting && near(walker) < fire.R ? 1 : 0;
  for (const o of others.values()) if (o.w.state().sitting && near(o.w) < fire.R) sitters++;
  fire.update(dt, T, sitters);
  const d = near(walker);
  // you don't walk through it: step back out of the flames
  if (d < 0.85 && !walker.inBoat && !walker.riding) { const k = 0.85 / Math.max(d, 1e-3); walker.pos.x = fire.pos.x + (walker.pos.x - fire.pos.x) * k; walker.pos.z = fire.pos.z + (walker.pos.z - fire.pos.z) * k; }
  if (screen !== 'title') { audio.setFire(Math.max(0, 1 - d / 14) ** 1.3 * (0.6 + 0.4 * Math.min(1, sitters))); audio.setFireSize(Math.min(4, sitters) / 4); }
  if (!fireHintDone && !save.fireHint && screen === 'lake' && d < 7 && Date.now() > toastBusyUntil + 300) {
    fireHintDone = true; save.fireHint = true; persist();
    toast(L('🔥 모닥불 곁에 앉아 보세요 (😊 → 🪑) · 함께 앉으면 불이 더 커져요', '🔥 Sit by the fire (😊 → 🪑) · it grows when people sit together'), 4200);
  }
}
// ---- the whale of light: on the shared clock (whale.js), so the lake sees it together
const whale = createWhale(scene, GLOW);
let whalePrevY = -9;
function whaleArrives() {
  if (screen === 'title') return;
  audio.whaleSong();
  toast(L('🐋 빛의 고래가 나타났어요!', '🐋 The whale of light is here!'), 4200);
}
function updateWhale(dt) {
  if (whale.schedule(Date.now(), slotHash)) whaleArrives();
  whale.update(dt, T);
  if (!whale.active) { whalePrevY = -9; return; }
  // where it breaks the surface (rising, leaping out, falling back), the lake rings wide
  const wp = whale.pos;
  if ((whalePrevY < -0.3) !== (wp.y < -0.3)) for (let i = 0; i < 3; i++) wake.ring(wp.x + (i - 1) * 3, wp.z, 5 + i * 2.5, 1.2);
  whalePrevY = wp.y;
  // lanterns it passes are lifted on its back for a moment and glow brighter
  for (const L of lanterns) {
    if (L.mode !== 'water') continue;
    const k = whale.lift(L.x, L.z); if (k <= 0) continue;
    L.group.position.y += k * 1.6; L.glow.scale.multiplyScalar(1 + k * 0.8); L.glow.material.opacity = Math.min(1, L.glow.material.opacity + k * 0.4);
  }
}
// ---- singing stones at the water's edge: tap to play; the lake hears it too
const stones = createStones(scene, shore, GLOW);
function playStone(i, remote) {
  const s = stones.hit(i); if (!s) return;
  audio.start();
  const d = Math.hypot(s.x - walker.pos.x, s.z - walker.pos.z);
  audio.stone(NOTES[i], remote ? Math.max(0, 1 - d / 45) : 1);
  if (!remote) heardNote('', i);
  if (!remote) { net.sendNote && net.sendNote(i); if (!save.stonesPlayed) { save.stonesPlayed = true; persist(); toast(L('🎐 노래하는 돌이에요 · 같은 호수 사람들에게도 들려요', '🎐 Singing stones · everyone on the lake hears them'), 3200); } }
}
let stoneHintDone = false;
function stoneHint() {   // the first time you come near them
  if (stoneHintDone || save.stonesPlayed || screen !== 'lake') return;
  const s = stones.stones[3];
  if (Math.hypot(s.x - walker.pos.x, s.z - walker.pos.z) < 6 && Date.now() > toastBusyUntil + 300) { stoneHintDone = true; toast(L('🎐 물가의 빛나는 돌을 눌러 보세요', '🎐 Try tapping the glowing stones by the water'), 3000); }
}
// ---- the lake's secret song: five glinting mounds in the sand hold a note each (one note of today's melody
// per note); play the whole song on the singing stones and the lake answers. Same song for everyone each day.
const STONE_NAMES = [['주황', 'amber'], ['금빛', 'gold'], ['노란', 'yellow'], ['초록', 'green'], ['하늘색', 'sky-blue'], ['보라', 'violet'], ['분홍', 'pink']];
const STONE_CSS = ['#ffb070', '#ffd27a', '#fff08a', '#9ff0b0', '#8fd8ff', '#b9a8ff', '#ffa8d8'];
const ORD = [['첫 번째', 'first'], ['두 번째', 'second'], ['세 번째', 'third'], ['네 번째', 'fourth'], ['다섯 번째', 'fifth']];
let melody = null, songK = 0, digSpot = null, digShown = false, digHintDone = false, melodyCheckT = 0;
function melodyState() {
  const day = seoulDay(Date.now());
  if (!save.melody || save.melody.day !== day) { save.melody = { day, dug: [false, false, false, false, false], solved: false }; persist(); }
  return save.melody;
}
function buildMelody() {
  const st = melodyState();
  if (melody && melody.day === st.day) return;
  if (melody) scene.remove(melody.group);
  const avoid = stones.stones.map(q => ({ x: q.x, z: q.z, r: 2.4 })).concat([{ x: fire.pos.x, z: fire.pos.z, r: 3.8 }, { x: 0, z: 16, r: 2 }]);
  melody = createMelody(scene, shore, GLOW, { dayNum: st.day, dug: st.dug, avoid });
}
buildMelody();
const songDots = (got) => melody.song.map((n, k) => got[k] ? `<i class="sd" style="--c:${STONE_CSS[n]}"></i>` : '<i class="sd q">?</i>').join('');
function songRow() {
  const st = melodyState(), n = st.dug.filter(Boolean).length;
  const head = st.solved ? L('🎐 오늘의 호수 노래를 찾았어요', '🎐 You found today’s lake song') : L(`🎐 오늘의 호수 노래 · 쪽지 ${n}/${SONG_LEN}`, `🎐 Today’s lake song · notes ${n}/${SONG_LEN}`);
  return `<span class="song-row">${head} <span class="song-dots">${songDots(st.solved ? [1, 1, 1, 1, 1] : st.dug)}</span>${save.songs ? L(` · 찾은 날 <b>${save.songs}</b>`, ` · days found <b>${save.songs}</b>`) : ''}</span>`;
}
function showNote(k) {
  const st = melodyState(), n = melody.song[k], nm = STONE_NAMES[n], have = st.dug.filter(Boolean).length;
  $('noteText').innerHTML = L(`오늘 호수의 노래,<br><b>${ORD[k][0]} 음</b>은 <span class="stone-name" style="--c:${STONE_CSS[n]}">${nm[0]} 돌</span>`,
    `Today’s lake song:<br>the <b>${ORD[k][1]} note</b> is the <span class="stone-name" style="--c:${STONE_CSS[n]}">${nm[1]} stone</span>`);
  $('noteSong').innerHTML = songDots(st.dug);
  $('noteFoot').textContent = have >= SONG_LEN
    ? L('다 모았어요! 물가의 노래하는 돌을 이 순서대로 눌러 보세요', 'All five! Play them on the singing stones by the water, in this order')
    : L(`쪽지 ${have}/${SONG_LEN} · 모래사장 어딘가에 반짝이는 곳이 더 있어요`, `Notes ${have}/${SONG_LEN} · more glints are hiding along the beach`);
  $('notePanel').classList.remove('hidden');
}
$('noteOk').onclick = (e) => { e.stopPropagation(); $('notePanel').classList.add('hidden'); };
function startDig() {
  const s = digSpot; if (!s || walker.busy() || walker.inBoat || walker.riding) return;
  audio.start(); closeCard();
  walker.emote('bow', true); melody.dig(s); audio.dig && audio.dig();
  const st = melodyState(); st.dug[s.i] = true; persist();
  digSpot = null;
  setTimeout(() => { audio.chime([NOTES[melody.song[s.i]], NOTES[melody.song[s.i]] * 1.5], 0.14); showNote(s.i); }, 1900);
}
$('digBtn').onclick = (e) => { e.stopPropagation(); startDig(); };
// the stones you (and each person on the lake) played lately; five in a row that match today's song wins
const heard = new Map();
function heardNote(id, i) {
  const now = performance.now();
  let h = heard.get(id); if (!h || now - h.t > 6000) { h = { seq: [], t: now }; heard.set(id, h); }
  h.seq.push(i); h.t = now; if (h.seq.length > SONG_LEN) h.seq.shift();
  if (melody.match(h.seq)) { h.seq = []; songFound(!id); }
}
function songFound(mine) {
  songK = 1;
  // the stones light one after another, then the lake answers: the whale's distant song
  melody.song.forEach((n, k) => setTimeout(() => stones.hit(n), 900 + k * 260));
  setTimeout(() => { audio.chime(melody.song.map(n => NOTES[n] / 2), 0.2); }, 900);
  setTimeout(() => audio.whaleSong(), 2600);
  if (!mine) { toast(L('✨ 누군가 오늘의 호수 노래를 찾았어요!', '✨ Someone found today’s lake song!'), 4200); return; }
  const st = melodyState();
  if (!st.solved) { st.solved = true; save.songs++; persist(); }
  setTimeout(() => toast(L('🎐 호수의 노래를 찾았어요! 멀리서 고래가 대답해요', '🎐 You found the lake song! The whale answers from far away'), 5200), 600);
}
function updateMelody(dt) {
  if ((melodyCheckT -= dt) < 0) { melodyCheckT = 20; buildMelody(); }   // a new Seoul day: a new song, fresh mounds
  melody.update(dt, T);
  if (songK > 0) {
    songK = Math.max(0, songK - dt / 12);
    const k = Math.sin(Math.min(1, songK * 6) * Math.PI / 2) * songK;
    for (const Ln of lanterns) { Ln.glow.scale.multiplyScalar(1 + k * 0.8); Ln.glow.material.opacity = Math.min(1, Ln.glow.material.opacity + k * 0.45); }
  }
  const free = screen === 'lake' && !walker.inBoat && !walker.riding && !walker.busy();
  digSpot = free ? melody.nearest(walker.pos, 1.5) : null;
  if (!!digSpot !== digShown) { digShown = !!digSpot; $('digBtn').classList.toggle('hidden', !digShown); }
  // the first time a glint is near: a word about it
  if (!digHintDone && free && Date.now() > toastBusyUntil + 300) {
    const s = melody.nearest(walker.pos, 6);
    if (s) { digHintDone = true; if (!save.digHint) { save.digHint = true; persist(); } toast(save.songs || melodyState().dug.some(Boolean) ? L('✨ 모래 속에 반짝이는 게 있어요', '✨ Something glints in the sand') : L('✨ 모래 속에 무언가 반짝여요 · 가까이 가서 파 보세요', '✨ Something glints in the sand · go close and dig'), 3600); }
  }
}
// ---- the lakeside cat: keeps you company; bond grows with minutes spent near it (saved)
const cat = createCat(scene, shore, { bond: save.catBond });
let catSaveT = 0, purrT = 0;
function updateCat(dt) {
  const st = walker.state();
  cat.update(dt, T, { pos: walker.pos, yaw: walker.yaw, moving: st.moving, sitting: walker.sitting, busy: walker.busy(), boat: walker.inBoat || walker.riding });
  if (screen === 'title') return;
  if (Math.hypot(cat.pos.x - walker.pos.x, cat.pos.z - walker.pos.z) < 3) { save.catBond += dt / 60; cat.bond = save.catBond; }
  if ((catSaveT += dt) > 30) { catSaveT = 0; persist(); }
  stoneHint();
  // curled up beside you while you sit: it purrs now and then (more often as it grows fond of you)
  if (walker.sitting && cat.curled && (purrT -= dt) < 0) { purrT = Math.max(5, 14 - save.catBond); audio.purr(3, Math.min(1, 0.5 + save.catBond / 20)); }
  if (!save.catMet && T > 6 && screen === 'lake' && weatherNoticed && Date.now() > toastBusyUntil + 300) {
    save.catMet = true; persist(); toast(L('🐈 호숫가 고양이가 따라오기 시작했어요 · 눌러 보세요', '🐈 A lakeside cat started following you · give it a tap'), 3800);
  }
}
function petCat() {
  audio.start(); cat.pet(); audio.meow();
  save.catBond += 0.3; cat.bond = save.catBond; persist();
  if (walker.sitting) audio.purr(2.5, 0.8);
}
// little actions: 👋 wave, 🙇 bow, 🎉 jump, 💕 heart, 🪑 sit (also keys 1-5); others on the lake see them too
const EMOTE_KEYS = ['wave', 'bow', 'jump', 'heart', 'sit'];
function doEmote(k) {
  audio.start();
  if (!walker.emote(k)) return;
  if (k === 'sit') net.sendPos(walker.pos.x, walker.pos.z, null, myScarf, walker.sitting);
  else net.sendEmote && net.sendEmote(k);
  $('emoteBar').classList.add('hidden'); audio.tick();
}
$('emoteBtn').onclick = (e) => { e.stopPropagation(); audio.start(); $('emoteBar').classList.toggle('hidden'); audio.tick(); };
document.querySelectorAll('#emoteBar [data-emote]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); doEmote(b.dataset.emote); });
// background music, remembered between visits: 🎵 opens a small panel with an on/off switch, a mood and sliders
const SLIDERS = [
  { id: 'vol', label: L('음악 크기', 'Volume'), min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}` },
  { id: 'tempo', label: L('빠르기', 'Tempo'), min: 0, max: 1, step: 0.01, show: (v) => (v < 0.34 ? L('느리게', 'slow') : v < 0.67 ? L('보통', 'medium') : L('빠르게', 'lively')) },
  { id: 'notes', label: L('오르골 음', 'Melody'), min: 0, max: 1, step: 0.01, show: (v) => (v < 0.08 ? L('없음', 'none') : v < 0.34 ? L('드문드문', 'sparse') : v < 0.67 ? L('보통', 'some') : L('많이', 'lots')) },
  { id: 'key', label: L('음 높이', 'Pitch'), min: -5, max: 7, step: 1, show: (v) => (v > 0 ? `+${v}` : `${v}`) },
  { id: 'rev', label: L('울림', 'Echo'), min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}` },
  { id: 'nature', label: L('물·풀벌레 소리', 'Water & crickets'), min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}` },
];
for (const sd of SLIDERS) {
  const row = document.createElement('label'); row.className = 'mp-row';
  row.innerHTML = `<span class="mp-name">${sd.label}</span><input type="range" min="${sd.min}" max="${sd.max}" step="${sd.step}" data-k="${sd.id}"><span class="mp-val"></span>`;
  $('sliders').appendChild(row);
}
function syncMusic() {
  const c = save.musicCfg;
  $('music').classList.toggle('off', !save.music); $('music').title = L('배경음악 설정', 'Music settings');
  $('musicOn').classList.toggle('on', save.music); $('musicOn').setAttribute('aria-checked', String(save.music));
  $('musicPanel').classList.toggle('muted', !save.music);
  document.querySelectorAll('.mood').forEach((b) => b.classList.toggle('on', b.dataset.mood === c.mood));
  document.querySelectorAll('#sliders input').forEach((inp) => {
    const sd = SLIDERS.find((x) => x.id === inp.dataset.k), v = c[sd.id];
    if (document.activeElement !== inp) inp.value = v;
    inp.style.setProperty('--p', `${((v - sd.min) / (sd.max - sd.min)) * 100}%`);
    inp.nextElementSibling.textContent = sd.show(v);
  });
}
let musicSaveT = 0;
function setMusicCfg(part) {
  Object.assign(save.musicCfg, part); audio.setMusicCfg(part); syncMusic();
  clearTimeout(musicSaveT); musicSaveT = setTimeout(persist, 300);
}
audio.musicOn = save.music; audio.setMusicCfg(save.musicCfg); syncMusic();
function openMusic() {
  closeCard(); if (screen === 'compose') closePanel('compose'); if (screen === 'diary') closePanel('diary');
  $('toast').classList.add('hidden'); $('musicPanel').classList.remove('hidden'); screen = 'music'; syncMusic();
}
$('music').onclick = () => { audio.start(); if (screen === 'music') closePanel('music'); else { openMusic(); audio.tick(); } };
$('musicOn').onclick = () => {
  audio.start(); save.music = !save.music; persist(); audio.setMusic(save.music); syncMusic(); audio.tick();
  if (save.music && audio.muted) $('mute').click();          // turning music on should be heard
};
document.querySelectorAll('.mood').forEach((b) => b.onclick = () => {
  audio.start(); setMusicCfg({ mood: b.dataset.mood });
  if (!save.music) $('musicOn').click(); else audio.tick();
});
document.querySelectorAll('#sliders input').forEach((inp) => inp.addEventListener('input', () => {
  audio.start(); setMusicCfg({ [inp.dataset.k]: +inp.value });
}));
$('musicReset').onclick = () => { setMusicCfg({ ...MUSIC_DEFAULTS }); audio.tick(); };
// the lantern diary: what you launched, the hearts each got, and your totals
function dateKST(ms) { const d = new Date(ms + 9 * 3600 * 1000); return EN ? d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`; }
function openDiary() {
  closeCard(); if (screen === 'compose') closePanel('compose'); if (screen === 'music') closePanel('music');
  const c = COLORS;
  $('diarySum').innerHTML = L(`<span>⭐ 나의 별 <b>${myRipe().length}</b></span><span>띄운 등불 <b>${save.launched}</b></span><span>받은 반짝임 <b>${save.received}</b></span><span>보낸 반짝임 <b>${save.hearts}</b></span><span>별똥별 소원 <b>${save.wishes}</b></span>${songRow()}`, `<span>⭐ my stars <b>${myRipe().length}</b></span><span>lanterns <b>${save.launched}</b></span><span>hearts received <b>${save.received}</b></span><span>hearts sent <b>${save.hearts}</b></span><span>wishes <b>${save.wishes}</b></span>${songRow()}`);
  const list = $('diaryList'); list.textContent = '';
  const items = save.log.length ? [...save.log].reverse() : [];
  if (!items.length) { const e = document.createElement('div'); e.className = 'diary-empty'; e.textContent = L('아직 띄운 등불이 없어요. 물가로 가서 첫 등불을 띄워 보세요.', 'No lanterns yet. Go to the water and launch your first one.'); list.appendChild(e); }
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'diary-item';
    const dot = document.createElement('span'); dot.className = 'diary-dot'; dot.style.setProperty('--c', (c.find(x => x.id === it.color) || c[0]).css);
    const body = document.createElement('div'); body.className = 'diary-text';
    body.textContent = it.text ? (EN ? `“${it.text}”` : `「${it.text}」`) : L('말없이 띄운 등불', 'A lantern without words');
    const meta = document.createElement('div'); meta.className = 'diary-meta';
    meta.textContent = `${it.at ? dateKST(it.at) + L(' 밤', ' night') : ''}${it.lake ? L(` · 호수 ${it.lake}`, ` · lake ${it.lake}`) : ''} · ${it.mode === 'sky' ? L('하늘로', 'to the sky') : L('물 위로', 'on the water')} · ${ripe(it) ? L('⭐ 별이 되었어요', '⭐ now a star') : L('내일 별이 돼요', 'a star tomorrow')}`;
    body.appendChild(meta);
    const hb = document.createElement('span'); hb.className = 'diary-heart'; const n = save.heartsBy[it.id] | 0; hb.textContent = n ? `♡ ${n}` : '';
    row.append(dot, body, hb); list.appendChild(row);
  }
  $('toast').classList.add('hidden');
  $('diary').classList.remove('hidden'); screen = 'diary';
  audio.tick();
}
// from the diary: lift the view to your constellation (or say when the first stars will come)
$('seeStars').onclick = () => {
  closePanel('diary');
  if (!myStarCount) {
    const any = starEntries().length;
    toast(any ? L('⭐ 아직 별이 된 등불이 없어요 · 띄운 등불은 다음 날 하늘의 별이 돼요', '⭐ No stars yet · your lanterns become stars the next day') : L('⭐ 등불을 띄우면 다음 날 하늘에 나의 별이 생겨요', '⭐ Launch a lantern and it becomes your star the next day'), 4200);
    return;
  }
  walker.turnView(null); walker.turnView(-0.3, -0.55);
  toast(L(`⭐ 나의 별 ${myStarCount}개 · 금빛 선으로 이어진 별자리예요 (R: 원래 시점)`, `⭐ ${myStarCount} stars of yours · joined by golden lines (R: back to the view)`), 4200);
  audio.chime([1046.5, 1318.5, 1567.98], 0.12);
};
$('diaryBtn').onclick = () => { audio.start(); if (screen === 'diary') closePanel('diary'); else openDiary(); };
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
  if (screen !== 'title') { const si = stones.pick(camera, cx, cy, window.innerWidth, window.innerHeight); if (si >= 0 && !pickLantern(cx, cy)) { playStone(si, false); return; } }
  if (screen !== 'title' && cat.screenHit(camera, cx, cy, window.innerWidth, window.innerHeight) && !pickLantern(cx, cy)) { petCat(); return; }
  const L = pickLantern(cx, cy);
  if (L) { openCard(L); return; }
  if (screen === 'card') closeCard();
  walkToScreenPoint(cx, cy);
}
canvas.addEventListener('pointerdown', (e) => {
  if (screen === 'title') { startGame(); return; }
  if (screen === 'compose') { closePanel('compose'); return; }
  $('emoteBar').classList.add('hidden');
  if (screen === 'diary') { closePanel('diary'); return; }
  if (screen === 'music') { closePanel('music'); return; }
  if (screen === 'lakes') { closePanel('lakes'); return; }
  if (screen === 'share') { closePanel('share'); return; }
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
  if (walker.riding) return;                 // a passenger does not steer
  if (walker.inBoat) {                       // afloat: row toward the tapped water
    const p = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(waterPlane, p)) return;
    walker.walkTo(p.x, p.z); showTapMark(p.x, p.z); return;
  }
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
  if ((screen === 'lake' || screen === 'card') && /^Digit[1-5]$/.test(e.code) && !e.repeat) doEmote(EMOTE_KEYS[+e.code.slice(5) - 1]);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('notePanel').classList.add('hidden'); closeCard(); if (screen === 'compose') closePanel('compose'); if (screen === 'diary') closePanel('diary'); if (screen === 'music') closePanel('music'); if (screen === 'lakes') closePanel('lakes'); if (screen === 'share') closePanel('share'); }
  else if ((e.key === 'Enter' || e.key === ' ') && screen === 'title') startGame();
});

// ---------------------------------------------------------------- loop + studio hooks
let running = true;
let last = performance.now();
// at most 60 frames a second: a 120-165 Hz screen would otherwise have the GPU draw this whole scene two or three
// times as often, flat out, slowing the rest of the computer with it
let nextDraw = 0;
const FPS_CAP = LITE ? 30 : 60;
function frame(now) {
  if (now < nextDraw - 2 && !window.__fixedRes) { requestAnimationFrame(frame); return; }
  nextDraw = Math.max(nextDraw + 1000 / FPS_CAP, now);
  adaptRes((now - last) / 1000);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (frozen) { requestAnimationFrame(frame); return; }
  if (running) update(dt);
  render(dt);
  requestAnimationFrame(frame);
}

function stepFrames(n) { for (let i = 0; i < n; i++) update(1 / 60); render(1 / 60); }

function reset(seed = 1) {
  reseed(seed);
  T = 0; star = null; nextStar = 1e9; shootingStar.visible = starHead.visible = false; wishOpen = 0; $('wishBtn').classList.add('hidden');
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
window.__studio.moon = (p) => { if (typeof p === 'number') uniforms.moonPhase.value = p; else uniforms.moonPhase.value = moonPhaseNow(); return { phase: +uniforms.moonPhase.value.toFixed(3), name: moonName(uniforms.moonPhase.value) }; };
window.__studio.atmos = () => ({ ...atmos.state(), seoul: { ...seoul }, line: weatherLine() });
window.__studio.music = () => ({ on: audio.musicOn, cfg: { ...audio.cfg }, bar: audio.bar | 0, gain: audio.musicGain ? +audio.musicGain.gain.value.toFixed(3) : null, nature: audio.nature ? +audio.nature.gain.value.toFixed(3) : null, echo: audio.echoWet ? +audio.echoWet.gain.value.toFixed(3) : null });
window.__studio.view = () => ({ ...walker.view, dir: walker.viewDir(), st: walker.state() });
window.__studio.swatch = () => { COLORS.forEach((c, i) => { makeLantern({ id: 'sw' + i, color: c.id, mode: 'water', x: (i - 2) * 2.2, y: 0, z: 4 }); makeLantern({ id: 'sv' + i, color: c.id, mode: 'sky', x: (i - 2) * 2.2, y: 4.5, z: 2 }); });
  lanterns.filter(l => /^s[wv]/.test(l.id)).forEach(l => { l.vx = l.vz = l.vy = 0; l.speed = 0; }); return true; };
window.__studio.night = (k) => { nightOverride = k; return uniforms.nightK.value; };
window.__studio.star = () => { nextStar = 0; return true; };
window.__studio.wish = () => { const b = !$('wishBtn').classList.contains('hidden'); makeWish(); return b; };
window.__studio.others = () => [...others.values()].map(r => ({ ...r.w.state(), busy: r.w.busy() }));
window.__studio.starInfo = () => ({ starSlot, starAt, now: Date.now(), wishOpen, star: !!star });
window.__studio.heartId = (nid) => { const L = lanterns.find(l => l.id === nid); if (!L) return false; openCard(L); $('heartBtn').click(); closeCard(); return true; };
window.__studio.otherWish = (h) => otherWish(wishSlot, h || ('t' + Date.now()));
window.__studio.ids = () => lanterns.map(l => l.id);
window.__studio.dbg = () => { const L = lanterns[lanterns.length - 1]; const h = walker.hands(); return { busy: walker.busy(), held: !!L.held, t: L.held && L.held.t, L: [L.x, L.y, L.z].map(v => +v.toFixed(2)), a: +L.alpha.toFixed(2), sc: +L.group.scale.x.toFixed(2), hands: [h.x, h.y, h.z].map(v => +v.toFixed(2)), cam: camera.position.toArray().map(v => +v.toFixed(1)), cine: !!cine }; };
// test hooks: freeze the live loop and advance it in fixed 1/60 s steps (camera included)
let frozen = false;
window.__studio.freeze = (on = true) => { frozen = on; };
window.__studio.advance = (ms) => { for (let i = 0, n = Math.round(ms / (1000 / 60)); i < n; i++) { update(1 / 60); render(1 / 60); } };
window.__studio.fakeArrival = (mode = 'sky', text = 'test', color = 'amber', who = 'tester') => { net.hooks.onLantern({ netId: 'x:' + Date.now(), text, color, mode }, who, true); return lanterns[lanterns.length - 1].id; };
window.__studio.place = (id, x, z, hearts, color = 'amber', mode = 'water') => { makeLantern({ id, text: 'demo', color, mode, x, y: mode === 'sky' ? 3 : 0, z, hearts }); return id; };
window.__studio.loveInfo = (id) => { const L = lanterns.find(l => l.id === id); return L && { hearts: L.hearts, love: +L.love.toFixed(2), halo: L.halo && { op: +L.halo.material.opacity.toFixed(2), sc: +L.halo.scale.x.toFixed(2), vis: L.halo.visible }, glow: +L.glow.material.opacity.toFixed(2), glowSc: +L.glow.scale.x.toFixed(2), motes: !!L.motes, alpha: L.alpha }; };
window.__studio.renderCost = () => { const gl = renderer.getContext(); const px = new Uint8Array(4); const t = () => { let best = 1e9; for (let i = 0; i < 4; i++) { const s = performance.now(); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); best = Math.min(best, performance.now() - s); } return best; }; t(); const base = t(); const out = { base: [+base.toFixed(1), renderer.info.render.triangles] }; scene.children.forEach((o, i) => { if (!o.visible) return; o.visible = false; const ms = t(); const tris = renderer.info.render.triangles; const k = (o.type + ':' + (o.name || o.userData.tag || i)) + (o.isInstancedMesh ? '[' + o.count + ']' : '') + (o.material && o.material.type ? '/' + o.material.type : ''); out[k] = [+(base - ms).toFixed(1), out.base[1] - tris]; o.visible = true; }); return out; };
window.__studio.dressTris = () => { const d = scene.children.find(o => o.userData.tag === 'shore-dressing'); return d ? d.children.map(c => [c.userData.tag || c.type, c.count ?? 1, c.geometry ? (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3 : 0, Math.round((c.count ?? 1) * (c.geometry ? (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3 : 0))]) : null; };
window.__studio.gpu = () => { const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, points: renderer.info.render.points, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length, lite: LITE, res: resScale, canvas: canvas.width + 'x' + canvas.height }; };
window.__studio.ripen = () => { starsForce = true; arriveStars(); return myStarCount; };
window.__studio.myStars = () => myStarCount;
window.__studio.cat = () => ({ x: +cat.pos.x.toFixed(2), z: +cat.pos.z.toFixed(2), curled: cat.curled, bond: +save.catBond.toFixed(2), d: +Math.hypot(cat.pos.x - walker.pos.x, cat.pos.z - walker.pos.z).toFixed(2) });
window.__studio.catScreen = () => { const v = new THREE.Vector3(cat.pos.x, cat.pos.y + 0.25, cat.pos.z).project(camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; };
window.__studio.stone = (i) => playStone(i, false);
window.__studio.melody = () => ({ song: melody.song, spots: melody.spots.map(s => ({ x: +s.x.toFixed(2), z: +s.z.toFixed(2), i: s.i, dug: s.dug })), state: melodyState(), songK: +songK.toFixed(2), digShown });
window.__studio.dig = () => startDig();
window.__studio.tp = (x, z) => { walker.pos.x = x; walker.pos.z = z; };
window.__studio.stoneK = () => stones.stones.map(s => +s.k.toFixed(2));
window.__studio.stoneScreen = (i) => { const s = stones.stones[i]; const v = new THREE.Vector3(s.x, s.y + 0.2, s.z).project(camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; };
window.__studio.whale = () => { whale.start(0.3, 0.6); whaleArrives(); return true; };
window.__studio.whalePos = () => { const p = whale.pos; return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), active: whale.active }; };
window.__studio.fire = () => ({ x: +fire.pos.x.toFixed(2), z: +fire.pos.z.toFixed(2), d: +Math.hypot(walker.pos.x - fire.pos.x, walker.pos.z - fire.pos.z).toFixed(2) });
window.__studio.openId = (id) => { const L = lanterns.find(l => l.id === id); if (L) openCard(L); return !!L; };
window.__studio.heartRemote = () => { const L = lanterns.find(l => l.id.includes(':')); if (!L) return false; openCard(L); $('heartBtn').click(); return L.id; };
for (const k of ['setCam', 'hudShow', 'launch', 'openNearest']) if (!(k in window.__studio)) window.__studio[k] = ext[k];

requestAnimationFrame(frame);
