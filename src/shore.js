// The lakeshore: a walkable moonlit beach ring around the lake, plus the geometry helpers the
// character and the lanterns use. Owned by the "shore" part.
//
// API (frozen — main.js and walker.js depend on it):
//   LAKE                      { cx, cz, r }  lake centre and mean radius (world units, y up, lake to -z)
//   shoreRadius(angle)        waterline radius at an angle around the lake centre
//   waterDist(x, z)           signed distance to the waterline: < 0 in the water, > 0 on land
//   groundY(x, z)             ground height (the waterline sits at y = 0)
//   walkable(x, z)            true where the character may stand
//   nearestShore(x, z, d)     the point at signed distance d from the waterline nearest (x, z) -> {x, z}
//   lakeE(x, z)               (dist / r)^2 — < 1 inside the lake (used by lantern drift)
//   buildShore(scene, uniforms) adds the beach mesh; returns { mesh, update(dt, playerPos) }
import * as THREE from '../vendor/three.module.js';

export const LAKE = { cx: 0, cz: -70, r: 80 };

export function shoreRadius(a) {
  return LAKE.r * (1 + 0.035 * Math.sin(a * 5 + 1.3) + 0.02 * Math.sin(a * 11 + 0.4));
}
export function waterDist(x, z) {
  const dx = x - LAKE.cx, dz = z - LAKE.cz;
  return Math.hypot(dx, dz) - shoreRadius(Math.atan2(dz, dx));
}
export function lakeE(x, z) {
  const dx = (x - LAKE.cx) / LAKE.r, dz = (z - LAKE.cz) / LAKE.r;
  return dx * dx + dz * dz;
}
function bumps(x, z) {
  return 0.18 * Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.17 - x * 0.07) + 0.08 * Math.sin(x * 0.53 + 1.7) * Math.cos(z * 0.47);
}
export function groundY(x, z) {
  if (onPier(x, z, 0.15)) return PIER.deck + 0.04;       // standing on the planks
  return terrainY(x, z);
}
// the ground itself, under the pier too (the beach mesh and dressing sit on this; only feet stand on the deck)
function terrainY(x, z) {
  const d = waterDist(x, z);
  if (d < 0) return Math.max(-2.5, d * 0.12) - 0.05;
  const beach = 0.9 * (1 - Math.exp(-d / 7));            // gentle sand slope out of the water
  const rise = Math.max(0, d - 14) * 0.09;               // the grass bank climbs behind the beach
  const fade = Math.min(1, d / 6);
  return beach + rise + bumps(x, z) * fade;
}
// the little wooden pier just right of the start: it runs from the sand (d = PIER.d0) straight out
// toward the lake centre into the shallows (d = PIER.d1). The character can walk out along its deck.
const PIER = { a: Math.PI / 2 - 0.19, d0: 3.2, d1: -10.5, half: 1.0, deck: 0.52 };   // root at x≈15: clear of the start and the lanterns posed off it

// solid things standing on (or at the edge of) the walkable sand: the character walks around them
function atX(x, d) {                    // ring angle on the near shore whose point at distance d has this x
  const a0 = Math.acos(Math.max(-1, Math.min(1, x / (shoreRadius(Math.PI / 2) + d))));
  return Math.acos(Math.max(-1, Math.min(1, x / (shoreRadius(a0) + d))));
}
function ringAt(a, d) { const r = shoreRadius(a) + d; return { x: LAKE.cx + Math.cos(a) * r, z: LAKE.cz + Math.sin(a) * r }; }
// stone lanterns (k: 1) and candle cairns (k: 0) along the beach, x along the shore and d from the waterline
const SHORE_LIGHTS = [
  { x: -13.8, d: 2.6, k: 1 }, { x: 5.5, d: 5.2, k: 0 },   // (the stone lantern stands at the far end of the singing stones, not in front of them) { x: -15, d: 5.5, k: 0 }, { x: -22, d: 3.5, k: 1 },
  { x: 11.5, d: 2.2, k: 1 }, { x: 24, d: 4.0, k: 0 }, { x: 33, d: 3.0, k: 1 }, { x: -37, d: 4.5, k: 1 },
  { x: -30, d: 9.0, k: 0 }, { x: 46, d: 5.0, k: 1 }, { x: -50, d: 3.5, k: 0 },
  // a lantern-lit stretch around the start: tea-light groups (k: 2) and more lanterns in view
  { x: 7.5, d: 4.4, k: 1 }, { x: -2.6, d: 8.6, k: 2 }, { x: 3.2, d: 1.7, k: 2 }, { x: -9.5, d: 6.4, k: 2 },
  { x: 2.6, d: 8.9, k: 0 }, { x: -12.6, d: 4.6, k: 2 }, { x: 16.5, d: 7.5, k: 2 }, { x: -18.5, d: 9.5, k: 1 },
].map(L => { const p = ringAt(atX(L.x, L.d), L.d); return { x: p.x, z: p.z, k: L.k }; });
// trees standing in the shallows at the ends of the start beach: lake-side of anywhere the character
// can stand, so the follow camera (always land-side) never looks through them
const WATER_TREES = [
  { x: -11.5, d: -1.4, h: 1.15, seed: 3 }, { x: -16.5, d: -0.6, h: 0.9, seed: 8 }, { x: -27, d: -1.0, h: 1.05, seed: 5 },
  { x: 22, d: -1.2, h: 1.1, seed: 12 }, { x: 30, d: -0.5, h: 0.85, seed: 4 }, { x: -44, d: -1.0, h: 1.2, seed: 9 }, { x: 52, d: -1.2, h: 1.0, seed: 6 },
].map(T => { const p = ringAt(atX(T.x, T.d), T.d); return { ...T, x: p.x, z: p.z }; });
// what the follow camera must not sit behind: the shallows trees (trunk + crown, roughly a 2 m disc each)
export const CAM_OBSTACLES = WATER_TREES.map(t => ({ x: t.x, z: t.z, r: 2.1 * t.h }));
function nearLight(x, z, r) { for (const L of SHORE_LIGHTS) if ((x - L.x) ** 2 + (z - L.z) ** 2 < r * r) return true; return false; }
function blocked(x, z) {
  for (const L of SHORE_LIGHTS) { const dx = x - L.x, dz = z - L.z; if (L.k < 2 && dx * dx + dz * dz < (L.k ? 0.55 : 0.4) ** 2) return true; }   // tea-lights (k 2) are stepped over
  return false;
}
function pierLocal(x, z) {             // -> { d: signed distance along the pier axis from the waterline, s: sideways offset }
  const ca = Math.cos(PIER.a), sa = Math.sin(PIER.a);
  const r0 = shoreRadius(PIER.a);
  const dx = x - (LAKE.cx + ca * r0), dz = z - (LAKE.cz + sa * r0);
  return { d: dx * ca + dz * sa, s: -dx * sa + dz * ca };
}
function onPier(x, z, m = 0) {
  const p = pierLocal(x, z);
  return p.d < PIER.d0 + m && p.d > PIER.d1 - m && Math.abs(p.s) < PIER.half + m;
}
// where the character may stand on the pier: inside the railing posts and short of the end lamp,
// so the body never hangs over the edge or past the pier's end
function onDeck(x, z) {
  const p = pierLocal(x, z);
  return p.d < PIER.d0 + 0.15 && p.d > PIER.d1 + 1.0 && Math.abs(p.s) < PIER.half - 0.32;
}
// the near shore: the arc of beach facing the viewer, roomy enough to wander
export function walkable(x, z) {
  if (onDeck(x, z)) return true;                          // out along the pier deck, over the shallows
  const d = waterDist(x, z);
  // the beach keeps 0.5 m back from the water, except beside the pier's root, where that margin eases to
  // nothing so walking along the waterline steps on and off the deck without a pocket to get caught in
  const pl = pierLocal(x, z);
  const ease = pl.d > PIER.d1 && pl.d < PIER.d0 + 1.5 ? Math.max(0, Math.min(1, (Math.abs(pl.s) - PIER.half) / 3)) : 1;
  if (d < Math.max(0.03, 0.5 * ease)) return false;
  if (d > 30) return false;
  if (blocked(x, z)) return false;                        // stone lanterns and cairns
  return z > -40;
}
// standing on the pier: where a lantern set on the water from it should go (just past the pier's end);
// otherwise null
export function pierLaunchPoint(x, z) {
  if (!onPier(x, z, 0.05)) return null;
  const ca = Math.cos(PIER.a), sa = Math.sin(PIER.a), r0 = shoreRadius(PIER.a);
  const p = pierLocal(x, z);
  const d = Math.min(p.d - 1.6, PIER.d1 - 0.9);
  // the pier runs toward the lake centre, i.e. along -(ca, sa) as d decreases
  return { x: LAKE.cx + ca * (r0 + d) - sa * p.s, z: LAKE.cz + sa * (r0 + d) + ca * p.s };
}
export const PIER_DECK = PIER.deck;
// where the lamp at the pier's end stands (filled in when the pier is built)
export const PIER_LAMP = { x: 0, z: 0 };
export function nearestShore(x, z, d = 0.8) {
  const dx = x - LAKE.cx, dz = z - LAKE.cz;
  const a = Math.atan2(dz, dx);
  const r = shoreRadius(a) + d;
  return { x: LAKE.cx + Math.cos(a) * r, z: LAKE.cz + Math.sin(a) * r };
}

// ---------------------------------------------------------------- seeded helpers (no Math.random)
function rngOf(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }

// shared lighting for the shore and every dressing mesh: dim moon from the upper left, a cool sky
// fill, the character's warm lantern pooling on whatever is near it, fog toward the horizon
const LIGHT_GLSL = /* glsl */`
  uniform vec3 camPos; uniform vec3 playerPos; uniform float time; uniform vec3 pierLamp; uniform vec4 lamps[20];
  uniform float snowCover; uniform vec4 season; uniform float fogK;
  float sHash(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  // leaves and grass take the season: spring blossom on the crowns, lush summer green, autumn reds and golds,
  // a frosted winter grey-green. tree = 1 for tree crowns (blossom and autumn colour go there first)
  vec3 seasonLeaf(vec3 col, vec3 W, float tree){
    float lum = dot(col, vec3(0.3, 0.55, 0.15));
    // a soft, large-scale variation (cells read as a checkerboard on the open bank)
    vec3 q = W * vec3(0.16, 0.22, 0.16) + 3.0; vec3 qi = floor(q), qf = fract(q); qf = qf * qf * (3.0 - 2.0 * qf);
    float v = mix(mix(mix(sHash(qi), sHash(qi + vec3(1,0,0)), qf.x), mix(sHash(qi + vec3(0,1,0)), sHash(qi + vec3(1,1,0)), qf.x), qf.y),
                  mix(mix(sHash(qi + vec3(0,0,1)), sHash(qi + vec3(1,0,1)), qf.x), mix(sHash(qi + vec3(0,1,1)), sHash(qi + vec3(1,1,1)), qf.x), qf.y), qf.z);
    vec3 sum = col * vec3(0.85, 1.15, 0.8);
    vec3 aut = (lum * 0.6 + 0.05) * mix(mix(vec3(4.6, 0.75, 0.2), vec3(4.2, 1.9, 0.25), smoothstep(0.3, 0.55, v)), vec3(3.4, 2.8, 0.4), smoothstep(0.62, 0.85, v));
    aut = mix(col * vec3(1.2, 0.95, 0.5), aut, 0.55 + 0.45 * tree);
    vec3 spr = mix(col * vec3(1.0, 1.1, 0.9), mix(vec3(1.0, 0.36, 0.62), vec3(1.0, 0.58, 0.74), v), tree * (0.6 + 0.35 * v));
    vec3 win = mix(vec3(lum * 1.1), col, 0.35) * vec3(0.95, 1.0, 1.08);
    return spr * season.x + sum * season.y + aut * season.z + win * season.w;
  }
  vec3 shoreLight(vec3 col, vec3 N, vec3 W, float ao){
    vec3 L = normalize(vec3(-0.4, 0.8, -0.45));
    float diff = max(dot(N, L), 0.0);
    float sky = 0.55 + 0.45 * N.y;
    vec3 lit = col * (vec3(0.26, 0.27, 0.42) * 0.42 * sky * ao + vec3(0.62, 0.66, 0.9) * diff * 0.42);
    vec3 toP = playerPos + vec3(0.0, 0.9, 0.0) - W;
    float pd = length(toP);
    float lamb = 0.35 + 0.65 * max(dot(N, toP / max(pd, 1e-3)), 0.0);
    lit += col * vec3(1.6, 0.9, 0.42) * exp(-pd * pd * 0.12) * 1.1 * lamb;
    vec3 toL = pierLamp - W; float ld = length(toL);
    float flick = 0.9 + 0.1 * sin(time * 6.1) * sin(time * 2.3 + 1.0);
    lit += col * vec3(1.5, 0.78, 0.34) * exp(-ld * ld * 0.09) * 0.95 * flick * (0.3 + 0.7 * max(dot(N, toL / max(ld, 1e-3)), 0.0));
    // the stone lanterns and candle cairns along the beach: warm pools on the sand around each
    #ifndef NO_LAMPS
    for (int i = 0; i < 20; i++) {
      vec4 Lp = lamps[i]; if (Lp.w <= 0.0) continue;
      vec3 tl = Lp.xyz - W; float dl2 = dot(tl, tl);
      float fall = Lp.w > 0.7 ? 0.075 : 0.2;
      if (dl2 * fall > 7.0) continue;                 // out of this lamp's reach (< 0.1 % of its light): skip the work
      float dl = sqrt(dl2);
      float fl = 0.88 + 0.12 * sin(time * (5.3 + float(i)) + float(i) * 2.1) * sin(time * 1.9 + float(i));
      lit += col * vec3(1.55, 0.74, 0.30) * exp(-dl * dl * fall) * Lp.w * fl * smoothstep(0.35, 1.1, dl) * (0.35 + 0.65 * max(dot(N, tl / max(dl, 1e-3)), 0.0));
    }
    #endif
    return lit;
  }
  vec3 shoreFog(vec3 lit, vec3 W){
    float dist = length(W - camPos);
    float fog = 1.0 - exp(-pow(dist * mix(0.0042, 0.012, fogK), 2.0));
    // the scene's own fog colours (0x15122c night, 0x2c2a44 mist) in linear light, so the far bank fades into the
    // hills and pines instead of a pale band under them
    return mix(lit, mix(vec3(0.0075, 0.0060, 0.025), vec3(0.025, 0.023, 0.058), fogK), fog);
  }`;

// one lit material for the instanced dressing: per-instance tint (aCol), optional wind sway on height
// lite tier (quality.js): the scatter skips the per-lamp light (the ground keeps it)
let DRESS_DEFS = '';
function dressingMaterial(u, sway, doubleSide, grain = false) {
  return new THREE.ShaderMaterial({
    uniforms: u, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide, fog: false,
    vertexShader: /* glsl */`
      uniform float time; attribute vec3 aCol; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vH;
      void main(){
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float h = max(position.y, 0.0);
        w.x += sin(time * 1.2 + w.x * 0.5 + w.z * 0.35) * ${sway.toFixed(3)} * h * h;
        w.z += cos(time * 0.9 + w.x * 0.3) * ${(sway * 0.5).toFixed(3)} * h * h;
        vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vC = aCol; vH = position.y;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${DRESS_DEFS}
      ${LIGHT_GLSL}
      varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vH;
      void main(){
        if (vW.y < -0.02) discard;                       // the lake surface hides what is under it
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        ${doubleSide ? 'N = normalize(N + vec3(0.0, 0.8, 0.0));' : ''}
        float ao = clamp(0.45 + vH * 0.6, 0.45, 1.0);
        vec3 col = vC * (0.75 + 0.35 * clamp(vH, 0.0, 1.5));
        // greenery (grass, reeds, bushes, crowns) follows the season; wood, stone and candles keep their colour
        float green = clamp((vC.g - max(vC.r, vC.b)) * 14.0, 0.0, 1.0);
        col = mix(col, seasonLeaf(col, vW, smoothstep(1.0, 1.6, vH)), green);
        // snow settles on what faces up
        float sn = snowCover * smoothstep(0.25, 0.75, N.y) * (0.75 + 0.25 * sHash(floor(vW * 6.0)));
        col = mix(col, vec3(0.62, 0.66, 0.78), sn * 0.85);
        ${grain ? `{ vec2 g = vW.xz * vec2(1.0, 1.0); float k = sin(dot(vW.xz, vec2(0.8, 23.0)) + sin(vW.x * 3.1 + vW.z * 1.7) * 2.0);
          col *= 0.86 + 0.14 * k + 0.08 * sin(vW.y * 41.0 + vW.x * 13.0); }` : ''}
        gl_FragColor = vec4(shoreFog(shoreLight(col, N, vW, ao), vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---- dressing geometry (all built from seeded numbers)
function rockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const p = g.attributes.position; const r = rngOf(seed);
  const k = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 1 + 0.18 * Math.sin(x * 3 + k[0]) * Math.sin(y * 2.6 + k[1]) + 0.12 * Math.sin(z * 4 + k[2]);
    p.setXYZ(i, x * f * 1.15, Math.max(y * f * 0.62, -0.3), z * f * 0.95);
  }
  g.computeVertexNormals();
  return g;
}
function bladeTuft(blades, height, spread, width, seed) {
  // a tuft of thin bent blades radiating from a point (each blade: 2 tris, tip at y=height)
  const r = rngOf(seed); const pos = [], nrm = [];
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2, h = height * (0.55 + r() * 0.45), lean = spread * (0.4 + r() * 0.6);
    const ox = Math.cos(a) * 0.06 * r(), oz = Math.sin(a) * 0.06 * r();
    const px = -Math.sin(a) * width, pz = Math.cos(a) * width;
    const mx = ox + Math.cos(a) * lean * 0.35, mz = oz + Math.sin(a) * lean * 0.35;
    const tx = ox + Math.cos(a) * lean, tz = oz + Math.sin(a) * lean;
    const v = [[ox - px, 0, oz - pz], [ox + px, 0, oz + pz], [mx + px * 0.6, h * 0.55, mz + pz * 0.6], [mx - px * 0.6, h * 0.55, mz - pz * 0.6], [tx, h, tz]];
    for (const t of [[0, 1, 2], [0, 2, 3], [3, 2, 4]]) for (const i of t) { pos.push(...v[i]); nrm.push(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
function reedClump(seed) {
  const g = bladeTuft(11, 1.0, 0.18, 0.025, seed);
  // a few cattail heads on top
  const r = rngOf(seed + 9); const parts = [g];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 5); c.deleteAttribute('uv');
    const a = r() * 6.28, rad = 0.05 * r();
    c.translate(Math.cos(a) * rad + 0.04, 0.88 + r() * 0.2, Math.sin(a) * rad);
    parts.push(c.toNonIndexed());
  }
  return mergeGeos(parts);
}
function driftwoodGeometry() {
  const log = new THREE.CylinderGeometry(0.11, 0.16, 1, 7, 3, false); log.deleteAttribute('uv');
  const p = log.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 4) * 0.05); }
  log.rotateZ(Math.PI / 2);
  const br = new THREE.CylinderGeometry(0.03, 0.07, 0.45, 5); br.deleteAttribute('uv');
  br.translate(0, 0.22, 0); br.rotateZ(-0.9); br.rotateY(0.6); br.translate(0.18, 0.02, 0);
  const br2 = new THREE.CylinderGeometry(0.025, 0.06, 0.32, 5); br2.deleteAttribute('uv');
  br2.translate(0, 0.16, 0); br2.rotateZ(1.1); br2.rotateY(-0.4); br2.translate(-0.3, 0.02, 0.02);
  const g = mergeGeos([log.toNonIndexed(), br.toNonIndexed(), br2.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
}
function canopyGeometry(seed) {
  // low-poly broadleaf: trunk plus lumpy crown blobs
  const r = rngOf(seed); const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.22, 2.4, 6); trunk.deleteAttribute('uv'); trunk.translate(0, 1.2, 0);
  parts.push(trunk.toNonIndexed());
  for (let i = 0; i < 4; i++) {
    const b = rockGeometry(seed * 7 + i);
    const s = 1.0 + r() * 0.7;
    b.scale(s, s * 1.25, s);
    b.translate((r() - 0.5) * 1.6, 2.6 + r() * 1.4, (r() - 0.5) * 1.6);
    parts.push(b);
  }
  const g = mergeGeos(parts); g.computeVertexNormals(); return g;
}
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3); let o = 0;
  for (const g of list) {
    const gg = g.index ? g.toNonIndexed() : g;
    if (!gg.attributes.normal) gg.computeVertexNormals();
    pos.set(gg.attributes.position.array, o * 3); nrm.set(gg.attributes.normal.array, o * 3);
    o += gg.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}
function instanced(scene, geo, mat, list, tag) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const col = new Float32Array(Math.max(1, list.length) * 3);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
  list.forEach((it, i) => {
    E.set(it.rx || 0, it.ry || 0, it.rz || 0); Q.setFromEuler(E);
    P.set(it.x, it.y, it.z); S.set(it.sx, it.sy, it.sz);
    M.compose(P, Q, S); m.setMatrixAt(i, M);
    col[i * 3] = it.c[0]; col[i * 3 + 1] = it.c[1]; col[i * 3 + 2] = it.c[2];
  });
  m.count = list.length;
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  m.frustumCulled = false;
  m.userData.tag = tag;
  scene.add(m);
  return m;
}
// a point on the shore ring: angle a (radians around the lake centre), signed distance d from the waterline
function ringPt(a, d) {
  const r = shoreRadius(a) + d;
  return { x: LAKE.cx + Math.cos(a) * r, z: LAKE.cz + Math.sin(a) * r };
}

export function buildShore(scene, uniforms, { lite = false } = {}) {
  // polar ring around the lake: dense near the waterline, sparse far away (coarser in the lite tier, quality.js)
  const SEG = lite ? 160 : 320, RINGS = lite ? 48 : 90;
  DRESS_DEFS = lite ? '#define NO_LAMPS' : '';
  const pos = [], idx = [];
  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS;
    const off = -6 + Math.pow(t, 2.2) * 420;      // signed offset from the waterline
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const r = shoreRadius(a) + off;
      const x = LAKE.cx + Math.cos(a) * r, z = LAKE.cz + Math.sin(a) * r;
      pos.push(x, terrainY(x, z), z);
    }
  }
  for (let j = 0; j < RINGS; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + SEG + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1); // wound so the faces look up
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const shoreUniforms = {
    time: uniforms.time, camPos: uniforms.camPos,
    playerPos: { value: new THREE.Vector3(0, 0, 16) },
    pierLamp: { value: new THREE.Vector3(0, -50, 0) },
    lamps: { value: Array.from({ length: 20 }, () => new THREE.Vector4(0, -50, 0, 0)) },
    lakeC: { value: new THREE.Vector3(LAKE.cx, 0, LAKE.cz) },
    lakeR: { value: LAKE.r },
    snowCover: uniforms.snowCover, season: uniforms.season, fogK: uniforms.fogK,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: shoreUniforms, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${lite ? '#define LITE' : ''}
      ${LIGHT_GLSL}
      uniform vec3 lakeC; uniform float lakeR;
      varying vec3 vW; varying vec3 vN;
      float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float n21(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * n21(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      // pebbles: a cellular speckle — returns 1 inside a small stone
      float pebble(vec2 p, float dens){ vec2 i = floor(p), f = fract(p); float m = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(x, y); vec2 o = vec2(h21(i+g), h21(i+g+7.3));
          float r = 0.12 + 0.2 * h21(i+g+3.1); float k = step(h21(i+g+11.0), dens);
          m = max(m, k * (1.0 - smoothstep(r * 0.7, r, length(g + o - f)))); } return m; }
      // sand height field: wind ripples (warped) plus grain — used for a bump normal
      float sandH(vec2 p, float d){
        float w = fbm(p * 0.25);
        float rip = sin(dot(p, vec2(0.35, 1.0)) * 4.2 + w * 9.0);
        rip = 1.0 - abs(rip);                              // sharp crests
        return rip * 0.6 * smoothstep(1.5, 4.0, d) * (1.0 - smoothstep(9.0, 13.0, d)) + n21(p * 6.0) * 0.25;
      }
      void main(){
        if (vW.y < -0.02) discard;                      // the water covers everything below the waterline
        vec2 p = vW.xz;
        float r = length(p - lakeC.xz);
        float a = atan(p.y - lakeC.z, p.x - lakeC.x);
        float shoreR = lakeR * (1.0 + 0.035 * sin(a * 5.0 + 1.3) + 0.02 * sin(a * 11.0 + 0.4));
        float d = r - shoreR;                           // distance from the waterline
        #ifdef LITE
        float big = n21(p * 0.07), mid = n21(p * 0.6), fine = 0.5;
        #else
        float big = fbm(p * 0.07), mid = fbm(p * 0.6), fine = n21(p * 7.0);
        #endif

        // --- the wash: the lake laps up the sand and slides back
        float wave = 0.5 + 0.5 * sin(time * 0.55 + a * 9.0 + big * 3.0);
        float reach = 0.3 + 1.5 * wave * wave;                 // how far the current wave runs up
        float wetLine = 3.4 + 1.6 * mid;                          // the darker band left by earlier waves
        float wetK = 1.0 - smoothstep(wetLine - 0.35, wetLine + 0.25, d);
        float washK = 1.0 - smoothstep(reach - 0.15, reach + 0.05, d);

        // --- palette: warm-dark sand, damp, wet, the grass bank
        vec3 sandDry = mix(vec3(0.27, 0.20, 0.14), vec3(0.34, 0.25, 0.17), big);
        vec3 sandDamp = vec3(0.095, 0.07, 0.058);
        vec3 sandWet = vec3(0.075, 0.062, 0.065);
        vec3 grassA = vec3(0.075, 0.13, 0.065), grassB = vec3(0.13, 0.17, 0.07), soil = vec3(0.12, 0.09, 0.06);
        vec3 col = sandDry;
        col *= 0.78 + 0.32 * mid + 0.14 * (fine - 0.5);
        #ifndef LITE
        // pebbles and shell flecks scattered over the sand, thicker near the water
        float peb = pebble(p * 3.2, 0.10 + 0.25 * (1.0 - smoothstep(1.0, 6.0, d)));
        float pebShade = h21(floor(p * 3.2) + 5.0);
        col = mix(col, mix(vec3(0.08, 0.07, 0.07), vec3(0.42, 0.37, 0.32), pebShade), peb * 0.8);
        float fleck = step(0.993, h21(floor(p * 22.0)));
        col += fleck * vec3(0.18, 0.16, 0.14);
        #endif
        // damp and wet sand toward the water
        col = mix(col, sandDamp * (0.8 + 0.4 * mid), wetK * 0.92);
        // the wrack line: a ragged dark seam of weed and twigs where the high water stopped
        #ifndef LITE
        float wr = exp(-pow((d - wetLine - 0.2) / 0.22, 2.0)) * smoothstep(0.4, 0.65, n21(p * 2.6 + 11.0));
        col = mix(col, vec3(0.045, 0.04, 0.03), wr * 0.75);
        #endif
        col = mix(col, mix(sandWet, vec3(0.02, 0.025, 0.05), 0.55 * (1.0 - smoothstep(0.0, reach, d))), washK);   // a thin film of water over the sand
        // the grass bank creeps down over the sand in tongues
        float gEdge = 7.2 + 5.0 * big + 1.5 * mid;
        float gK = smoothstep(gEdge, gEdge + 2.5, d);
        // patchy, even in every direction (a stretched streak noise read as brush smears from afar),
        // softening into the broad patches with distance so the far bank does not shimmer
        #ifdef LITE
        float streak = mid;
        vec3 grass = mix(grassA, grassB, mid) * (0.6 + 0.7 * streak);
        #else
        float gFar = smoothstep(12.0, 40.0, length(cameraPosition.xz - p));
        float streak = mix(0.55 * n21(p * 3.1) + 0.45 * n21(p * 7.3 + 4.0), mid, gFar);
        float tuftK = smoothstep(0.6, 0.7, fbm(p * 0.9 + 3.0)) * smoothstep(3.0, 6.0, d);
        gK = max(gK, tuftK * 0.55 * (0.4 + 0.6 * streak));
        vec3 grass = mix(grassA, grassB, mid) * (0.6 + 0.7 * streak);
        grass = mix(grass, soil, smoothstep(0.55, 0.75, fbm(p * 0.35 + 9.0)) * 0.6);
        #endif
        col = mix(col, seasonLeaf(grass, vW, 0.0), gK);
        // a darker damp-soil seam where grass meets sand
        col *= 1.0 - 0.25 * (smoothstep(gEdge - 1.5, gEdge, d) - smoothstep(gEdge + 0.5, gEdge + 2.5, d));

        // --- bump normal from the sand height field (dry sand only)
        #ifdef LITE
        float hS = 0.0; vec3 N = normalize(vN);
        #else
        float bm = (1.0 - gK) * (1.0 - wetK * 0.7);
        float e = 0.04;
        float hS = sandH(p, d) * bm;
        float hx = sandH(p + vec2(e, 0.0), d) * bm, hz = sandH(p + vec2(0.0, e), d) * bm;
        vec3 N = normalize(normalize(vN) + vec3(-(hx - hS) / e, 0.0, -(hz - hS) / e) * 0.06);
        #endif
        float cav = 0.85 + 0.3 * hS;                      // ripple troughs sit a little darker
        col *= cav;
        // a blanket of snow over the beach and the bank, thinning to bare wet sand at the water
        #ifdef LITE
        float snowK = snowCover * smoothstep(0.6, 2.4, d - reach);
        #else
        float snowK = snowCover * smoothstep(0.6, 2.4, d - reach) * (0.82 + 0.18 * fbm(p * 0.8 + 21.0));
        #endif
        col = mix(col, vec3(0.50, 0.54, 0.66) * (0.92 + 0.12 * fine), snowK);
        vec3 lit = shoreLight(col, N, vW, 1.0);

        // --- wet sand mirrors the sky: a cool sheen, brightest at grazing angles, with the moon glint
        vec3 V = normalize(camPos - vW);
        float fres = pow(1.0 - max(V.y, 0.0), 3.0);
        float gloss = max(washK, wetK * 0.45);
        lit += gloss * fres * vec3(0.10, 0.08, 0.20) * (0.6 + 0.4 * mid);
        lit += washK * (0.35 + 0.65 * fres) * vec3(0.07, 0.06, 0.15) * (1.0 - smoothstep(0.0, reach + 0.2, d));   // the film mirrors the sky, melting into the lake
        vec3 Lm = normalize(vec3(-0.4, 0.8, -0.45));
        vec3 Hm = normalize(V + Lm);
        lit += gloss * pow(max(dot(N, Hm), 0.0), 60.0) * vec3(0.16, 0.16, 0.24) * mid;

        // --- foam: the frothy lip of the running wave plus a broken line at the waterline
        // lace: a cellular-ish net of thin foam strands, drifting with the backwash
        #ifdef LITE
        float lip = smoothstep(reach - 0.55, reach - 0.05, d) * (1.0 - smoothstep(reach - 0.05, reach + 0.08, d)) * 0.5 * (0.35 + 0.65 * wave);
        lit += vec3(0.17, 0.18, 0.24) * lip;
        #else
        vec2 fp = p * 2.2 + vec2(0.0, -time * 0.25);
        float lace = abs(n21(fp) - n21(fp * 1.9 + 4.0));
        lace = 1.0 - smoothstep(0.0, 0.2, lace);                         // thin strands where the two fields cross
        float patchy = smoothstep(0.35, 0.75, fbm(vec2(a * 70.0 + time * 0.05, time * 0.08)));   // foam comes and goes along the shore
        float lipBand = smoothstep(reach - 0.55, reach - 0.05, d) * (1.0 - smoothstep(reach - 0.05, reach + 0.08, d));
        float lip = lipBand * (0.55 + 0.45 * lace) * (0.4 + 0.6 * patchy) * (0.35 + 0.65 * wave);
        float edge = (1.0 - smoothstep(0.0, 0.35, d)) * (0.4 + 0.6 * patchy) * 0.3;   // a soft glow where the film meets the lake
        vec2 bc = p * 9.0 + vec2(0.0, floor(time * 0.8) * 3.7);
        float bubbles = step(0.78, h21(floor(bc))) * (1.0 - smoothstep(0.06, 0.16, length(fract(bc) - 0.5))) * washK * smoothstep(reach - 0.8, reach, d) * 0.25;
        lit += vec3(0.17, 0.18, 0.24) * (lip + edge + bubbles);
        #endif

        gl_FragColor = vec4(shoreFog(lit, vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.tag = 'ground';
  scene.add(mesh);

  // ---------------------------------------------------------------- dressing (instanced, seeded)
  const R = rngOf(4242);
  const rr = (a, b) => a + (b - a) * R();
  const NEAR_A0 = Math.asin(0.375), NEAR_A1 = Math.PI - NEAR_A0;   // the walkable near arc (z > -40)
  const dress = new THREE.Group(); dress.userData.tag = 'shore-dressing'; scene.add(dress);

  // grass tufts: thick on the bank, sparse clumps creeping onto the sand
  const tufts = [];
  for (let i = 0; i < 2600 && tufts.length < 1500; i++) {
    const a = rr(0, Math.PI * 2);
    const near = a > NEAR_A0 - 0.3 && a < NEAR_A1 + 0.3;
    const d = near ? 4 + Math.pow(R(), 1.6) * 46 : rr(3, 40);
    const q = ringPt(a, d);
    if (onPier(q.x, q.z, 1.2) || nearLight(q.x, q.z, 1.3)) continue;
    const bankEdge = 9 + 6 * hash2(q.x * 0.07, q.z * 0.07);
    if (d < bankEdge && R() > 0.3) continue;           // only a few strays on the open sand
    const s = d < bankEdge ? rr(0.6, 1.0) : rr(0.5, 1.0);
    const g = rr(0.75, 1.1);
    tufts.push({ x: q.x, y: terrainY(q.x, q.z) - 0.03, z: q.z, ry: rr(0, 6.28), sx: s, sy: s * rr(0.8, 1.3), sz: s,
      c: [0.20 * g, 0.30 * g, 0.13 * g] });
  }
  instanced(dress, bladeTuft(9, 0.7, 0.28, 0.035, 11), dressingMaterial(shoreUniforms, 0.12, true), lite ? tufts.filter((_, i) => i % 5 === 0) : tufts, 'grass');

  // rocks: little stones on the open sand, boulder clusters at the ends of the beach and in the shallows
  const rocks = [];
  const rockCol = () => { const v = rr(0.7, 1.1); return [0.30 * v, 0.28 * v, 0.27 * v]; };
  for (let i = 0; i < 120; i++) {                        // pebbles and small stones on the walkable sand, thicker at the wet band
    const a = rr(NEAR_A0, NEAR_A1), d = i % 2 ? rr(0.2, 4) : rr(0.6, 22);
    const q = ringPt(a, d); const s = rr(0.12, 0.38);
    if (onPier(q.x, q.z, 1.2) || nearLight(q.x, q.z, 1.3)) continue;
    rocks.push({ x: q.x, y: terrainY(q.x, q.z) - s * 0.25, z: q.z, rx: rr(-0.3, 0.3), ry: rr(0, 6.28), sx: s, sy: s, sz: s * rr(0.7, 1.2), c: rockCol() });
  }
  const clusters = [[NEAR_A0 - 0.06, 1], [NEAR_A1 + 0.06, 1], [1.33, -1.4], [1.86, -1.2], [1.12, 2.5], [2.05, 2.0], [0.62, 0.5], [2.5, 0.8],
    [-0.4, 2], [3.6, 1.5], [4.4, 1], [5.2, 2]];
  clusters.forEach(([ca, cd], k) => {
    const n = 3 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const a = ca + rr(-0.025, 0.025), d = cd + rr(-1.4, 1.4);
      const q = ringPt(a, d); const big = i === 0 ? rr(0.9, 1.5) : rr(0.3, 0.8);
      if (onPier(q.x, q.z, 1.2) || nearLight(q.x, q.z, 1.3)) continue;
      const s = big * (Math.abs(a - Math.PI / 2) < 0.6 && d > 0.5 ? 0.55 : 1);  // keep the sand near the start open
      rocks.push({ x: q.x, y: Math.max(terrainY(q.x, q.z), -0.6) - s * 0.15, z: q.z, rx: rr(-0.25, 0.25), ry: rr(0, 6.28), rz: rr(-0.2, 0.2), sx: s * rr(0.9, 1.4), sy: s, sz: s, c: rockCol() });
    }
  });
  instanced(dress, rockGeometry(3), dressingMaterial(shoreUniforms, 0, false), rocks, 'rock');

  // driftwood: bleached logs lying along the wrack line
  const wood = [];
  for (let i = 0; i < 16; i++) {
    const a = i < 12 ? rr(NEAR_A0 + 0.05, NEAR_A1 - 0.05) : rr(0, Math.PI * 2);
    const d = rr(1.6, 6.5); const q = ringPt(a, d);
    if (onPier(q.x, q.z, 1.2) || nearLight(q.x, q.z, 1.3)) continue;
    const len = rr(1.4, 3.6), th = rr(0.7, 1.3), v = rr(0.85, 1.15);
    wood.push({ x: q.x, y: terrainY(q.x, q.z) - 0.03 + 0.04 * th, z: q.z, ry: -a - Math.PI / 2 + rr(-0.5, 0.5), rz: rr(-0.05, 0.05), sx: len, sy: th, sz: th, c: [0.38 * v, 0.33 * v, 0.28 * v] });
  }
  instanced(dress, driftwoodGeometry(), dressingMaterial(shoreUniforms, 0, false), wood, 'driftwood');

  // reed clumps standing in the shallows (the open water in front of the start stays clear for launches)
  const reeds = [];
  for (let c = 0; c < 70; c++) {                      // reed beds: a centre and 4–9 clumps around it
    const ca = c < 44 ? rr(NEAR_A0 - 0.1, NEAR_A1 + 0.1) : rr(0, Math.PI * 2);
    if (Math.abs(ca - Math.PI / 2) < 0.1) continue;  // the open water in front of the start stays clear for launches
    const cd = rr(-2.6, -0.2), n = 4 + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) {
      const a = ca + rr(-0.022, 0.022), d = cd + rr(-0.9, 0.9);
      const q = ringPt(a, d);
      if (onPier(q.x, q.z, 0.4) || d > 0.5) continue;
      const s = rr(0.9, 2.1), g = rr(0.8, 1.15);
      reeds.push({ x: q.x, y: Math.max(terrainY(q.x, q.z), -0.35), z: q.z, ry: rr(0, 6.28), sx: rr(0.8, 1.3), sy: s, sz: rr(0.8, 1.3), c: [0.17 * g, 0.21 * g, 0.10 * g] });
    }
  }
  instanced(dress, reedClump(21), dressingMaterial(shoreUniforms, 0.09, true), lite ? reeds.filter((_, i) => i % 3 === 0) : reeds, 'reeds');

  // trees and bushes framing the ends of the beach (outside the walkable arc, never behind the camera)
  const trees = [], bushes = [];
  for (let i = 0; i < 400 && trees.length < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const a = side > 0 ? rr(NEAR_A0 - 0.45, NEAR_A0 - 0.04) : rr(NEAR_A1 + 0.04, NEAR_A1 + 0.45);
    const d = rr(4, 30); const q = ringPt(a, d);
    if (walkable(q.x, q.z) || q.z > -42) continue;
    const s = rr(1.0, 1.7), v = rr(0.8, 1.15);
    trees.push({ x: q.x, y: terrainY(q.x, q.z) - 0.1, z: q.z, ry: rr(0, 6.28), sx: s, sy: s * rr(0.9, 1.3), sz: s, c: [0.09 * v, 0.14 * v, 0.08 * v] });
  }
  for (let i = 0; i < 600 && bushes.length < 60; i++) {
    const a = rr(0, Math.PI * 2), d = rr(2.5, 40); const q = ringPt(a, d);
    if (walkable(q.x, q.z) || q.z > -42) continue;
    const s = rr(0.5, 1.1), v = rr(0.8, 1.2);
    bushes.push({ x: q.x, y: terrainY(q.x, q.z) - 0.05, z: q.z, ry: rr(0, 6.28), sx: s * 1.3, sy: s * 1.1, sz: s * 1.2, c: [0.13 * v, 0.20 * v, 0.09 * v] });
  }
  instanced(dress, canopyGeometry(5), dressingMaterial(shoreUniforms, 0.015, false), trees, 'tree');
  instanced(dress, bladeTuft(34, 1.5, 1.1, 0.11, 17), dressingMaterial(shoreUniforms, 0.05, true), bushes, 'bush');

  // ---------------------------------------------------------------- the wooden pier
  // planks across two stringers on paired pilings, a lantern post at the far end
  const ca = Math.cos(PIER.a), sa = Math.sin(PIER.a), r0 = shoreRadius(PIER.a);
  const at = (d, side) => ({ x: LAKE.cx + ca * (r0 + d) - sa * side, z: LAKE.cz + sa * (r0 + d) + ca * side });
  const ryAcross = -PIER.a - Math.PI / 2;           // box local x runs across the pier, local z along it
  const PR = rngOf(777); const pr = (a, b) => a + (b - a) * PR();
  const woodC = (k = 1) => { const v = pr(0.78, 1.12) * k; return [0.36 * v, 0.25 * v, 0.16 * v]; };
  const planks = [], beams = [], piles = [];
  for (let d = PIER.d0 - 0.15; d > PIER.d1; d -= 0.34) {
    if (PR() < 0.025 && d < 0) continue;            // one or two missing boards
    const q = at(d, pr(-0.03, 0.03));
    planks.push({ x: q.x, y: PIER.deck + pr(-0.012, 0.012), z: q.z, ry: ryAcross + pr(-0.025, 0.025), rz: pr(-0.015, 0.015),
      sx: PIER.half * 2 * pr(0.94, 1.04), sy: 0.07, sz: 0.29, c: woodC() });
  }
  const len = PIER.d0 - PIER.d1, mid = (PIER.d0 + PIER.d1) / 2;
  for (const side of [-0.72, 0.72]) {
    const q = at(mid, side);
    beams.push({ x: q.x, y: PIER.deck - 0.13, z: q.z, ry: ryAcross, sx: 0.14, sy: 0.18, sz: len, c: woodC(0.7) });
  }
  // cross bracing under the deck so the edge reads as a structure, not a slab
  for (let d = PIER.d0 - 0.6; d > PIER.d1; d -= 2.6) {
    const q = at(d, 0);
    beams.push({ x: q.x, y: PIER.deck - 0.24, z: q.z, ry: ryAcross, sx: PIER.half * 2.05, sy: 0.12, sz: 0.14, c: woodC(0.65) });
  }
  for (let d = PIER.d0 - 0.6; d > PIER.d1 - 0.1; d -= 2.6) for (const side of [-0.9, 0.9]) {
    const q = at(d, side); const top = PIER.deck + (d < PIER.d1 + 2.6 ? 0.55 : 0.12);
    const bottom = Math.min(terrainY(q.x, q.z), 0) - 0.6;
    piles.push({ x: q.x, y: (top + bottom) / 2, z: q.z, ry: pr(0, 6), rz: pr(-0.03, 0.03), sx: 1, sy: top - bottom, sz: 1, c: woodC(0.6) });
  }
  // a lantern post at the end, the place to send lanterns off from
  const lampQ = at(PIER.d1 + 0.45, 0.9);
  piles.push({ x: lampQ.x, y: PIER.deck + 0.85, z: lampQ.z, ry: 0, sx: 0.8, sy: 1.7, sz: 0.8, c: woodC(0.55) });
  const armQ = at(PIER.d1 + 0.45, 0.62);
  beams.push({ x: armQ.x, y: PIER.deck + 1.62, z: armQ.z, ry: ryAcross, sx: 0.62, sy: 0.07, sz: 0.07, c: woodC(0.55) });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.deleteAttribute('uv');
  const pileGeo = new THREE.CylinderGeometry(0.1, 0.12, 1, 8); pileGeo.deleteAttribute('uv');
  const woodMat = dressingMaterial(shoreUniforms, 0, false, true);
  instanced(dress, boxGeo, woodMat, planks, 'pier');
  instanced(dress, boxGeo.clone(), woodMat, beams, 'pier');
  instanced(dress, pileGeo, woodMat, piles, 'pier');
  const lampAt = at(PIER.d1 + 0.45, 0.4);
  PIER_LAMP.x = lampAt.x; PIER_LAMP.z = lampAt.z;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0xffb35c }));
  lamp.position.set(lampAt.x, PIER.deck + 1.42, lampAt.z); lamp.userData.tag = 'pier-lamp';
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, 0.08, 8), new THREE.MeshBasicMaterial({ color: 0x1a120c }));
  cap.position.set(0, 0.19, 0); lamp.add(cap);
  dress.add(lamp);
  // a soft halo around the lamp (additive sprite drawn from a tiny generated gradient, no canvas needed)
  const NH = 32, px = new Uint8Array(NH * NH * 4);
  for (let y = 0; y < NH; y++) for (let x = 0; x < NH; x++) {
    const r = Math.hypot(x - NH / 2 + 0.5, y - NH / 2 + 0.5) / (NH / 2); const v = Math.max(0, 1 - r); const k = v * v;
    px.set([255, 190, 120, Math.round(255 * k)], (y * NH + x) * 4);
  }
  const haloTex = new THREE.DataTexture(px, NH, NH);
  haloTex.magFilter = THREE.LinearFilter; haloTex.minFilter = THREE.LinearFilter; haloTex.needsUpdate = true;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
  halo.scale.set(3.4, 3.4, 1); lamp.add(halo); halo.userData.tag = 'pier-lamp';
  shoreUniforms.pierLamp.value.set(lampAt.x, PIER.deck + 1.3, lampAt.z);

  // ---------------------------------------------------------------- small stuff, in clusters
  // pebble groups, shells, twigs, sedge/grass clumps and driftwood bits along the whole arc:
  // densest along the waterline and at the foot of the bank, sparse over the open middle
  function shellGeometry() {
    const pos = [], nrm = [], N = 10;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI * (i / N), a1 = Math.PI * ((i + 1) / N);
      const h0 = i % 2 ? 0.16 : 0.26, h1 = (i + 1) % 2 ? 0.16 : 0.26;   // ribbed rim
      const v = [[0, 0.05, -0.15], [Math.cos(a0), h0 * 0.5, Math.sin(a0) * 0.85 - 0.15], [Math.cos(a1), h1 * 0.5, Math.sin(a1) * 0.85 - 0.15]];
      for (const q of v) { pos.push(...q); nrm.push(q[0] * 0.3, 1, q[2] * 0.3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return g;
  }
  function twigGeometry() {
    const a = new THREE.CylinderGeometry(0.6, 1, 1, 5); a.deleteAttribute('uv'); a.rotateZ(Math.PI / 2);
    const b = new THREE.CylinderGeometry(0.4, 0.7, 0.35, 4); b.deleteAttribute('uv'); b.translate(0, 0.17, 0); b.rotateZ(-1.1); b.translate(0.12, 0, 0); b.rotateX(Math.PI / 2);
    const g = mergeGeos([a.toNonIndexed(), b.toNonIndexed()]); g.computeVertexNormals(); return g;
  }
  const pebbles = [], shells = [], twigs = [], sedge = [], bits = [];
  const SR = rngOf(9090); const sr = (a, b) => a + (b - a) * SR();
  const pebbleCol = () => {
    const t = SR(), v = sr(0.75, 1.2);
    if (t < 0.35) return [0.30 * v, 0.29 * v, 0.28 * v];        // grey
    if (t < 0.6) return [0.34 * v, 0.26 * v, 0.19 * v];         // brown
    if (t < 0.8) return [0.12 * v, 0.11 * v, 0.11 * v];         // dark basalt
    return [0.45 * v, 0.43 * v, 0.39 * v];                       // pale quartz
  };
  for (let c = 0; c < 640; c++) {
    const near = c < 520;
    const ca = near ? sr(NEAR_A0 - 0.15, NEAR_A1 + 0.15) : sr(0, Math.PI * 2);
    const band = SR();
    const cd = band < 0.46 ? sr(0.15, 3.2) : band < 0.86 ? sr(6.0, 13.0) : sr(3.2, 6.0);
    const centre = ringPt(ca, cd);
    if (onPier(centre.x, centre.z, 0.6)) continue;
    const kind = SR();
    const spread = sr(0.35, 1.1);
    const put = (n, fn) => {
      for (let i = 0; i < n; i++) {
        const r = spread * Math.sqrt(SR()), t = SR() * 6.283;
        const x = centre.x + Math.cos(t) * r, z = centre.z + Math.sin(t) * r;
        const d = waterDist(x, z);
        if (d < 0.05 || onPier(x, z, 0.15) || nearLight(x, z, 0.45)) continue;
        fn(x, z, d);
      }
    };
    if (kind < 0.42) put(6 + Math.floor(SR() * 10), (x, z) => {
      const s = sr(0.025, 0.11) * (SR() < 0.12 ? 1.8 : 1);
      pebbles.push({ x, y: terrainY(x, z) - s * 0.2, z, rx: sr(-0.3, 0.3), ry: sr(0, 6.28), sx: s * sr(0.9, 1.4), sy: s, sz: s, c: pebbleCol() });
    });
    else if (kind < 0.58 && cd < 4.5) put(3 + Math.floor(SR() * 6), (x, z) => {
      const s = sr(0.035, 0.075), v = sr(0.85, 1.15), pink = SR() < 0.4;
      shells.push({ x, y: terrainY(x, z) + 0.004, z, rx: sr(-0.2, 0.2), ry: sr(0, 6.28), rz: sr(-0.2, 0.2), sx: s, sy: s, sz: s,
        c: pink ? [0.52 * v, 0.40 * v, 0.37 * v] : [0.54 * v, 0.49 * v, 0.42 * v] });
    });
    else if (kind < 0.74) put(2 + Math.floor(SR() * 5), (x, z) => {
      const len = sr(0.25, 0.85), th = sr(0.012, 0.028), v = sr(0.7, 1.1);
      twigs.push({ x, y: terrainY(x, z) - 0.02 + th * 0.3, z, ry: sr(0, 6.28), rz: sr(-0.06, 0.06), sx: len, sy: th, sz: th, c: [0.26 * v, 0.19 * v, 0.13 * v] });
    });
    else if (kind < 0.95) put(3 + Math.floor(SR() * 7), (x, z, d) => {
      const s = d < 3 ? sr(0.35, 0.7) : sr(0.45, 0.95), g = sr(0.75, 1.15);
      const dry = d < 3 || SR() < 0.25;                           // sedge by the water is straw-coloured
      sedge.push({ x, y: terrainY(x, z) - 0.02, z, ry: sr(0, 6.28), sx: s, sy: s * sr(0.8, 1.3), sz: s,
        c: dry ? [0.30 * g, 0.27 * g, 0.15 * g] : [0.17 * g, 0.27 * g, 0.11 * g] });
    });
    else put(1 + Math.floor(SR() * 3), (x, z) => {
      const len = sr(0.35, 0.9), th = sr(0.25, 0.45), v = sr(0.85, 1.15);
      bits.push({ x, y: terrainY(x, z) - 0.03 + 0.03 * th, z, ry: sr(0, 6.28), rz: sr(-0.05, 0.05), sx: len, sy: th, sz: th, c: [0.40 * v, 0.35 * v, 0.29 * v] });
    });
  }
  instanced(dress, rockGeometry(57, 0), dressingMaterial(shoreUniforms, 0, false), pebbles, 'pebbles');
  instanced(dress, shellGeometry(), dressingMaterial(shoreUniforms, 0, true), shells, 'shells');
  instanced(dress, twigGeometry(), dressingMaterial(shoreUniforms, 0, false), twigs, 'twigs');
  instanced(dress, bladeTuft(8, 0.75, 0.32, 0.03, 61), dressingMaterial(shoreUniforms, 0.1, true), sedge, 'grass');
  instanced(dress, driftwoodGeometry(), dressingMaterial(shoreUniforms, 0, false), bits, 'driftwood');

  // ---------------------------------------------------------------- shore lights
  // stone lanterns (tōrō): plinth, post, fire box with paper windows, wide roof and a knob on top
  function stoneLantern() {
    const parts = [];
    const add = (g, y) => { g.deleteAttribute('uv'); g.translate(0, y, 0); parts.push(g.toNonIndexed()); };
    add(new THREE.CylinderGeometry(0.34, 0.4, 0.16, 6), 0.08);
    add(new THREE.CylinderGeometry(0.12, 0.15, 0.62, 6), 0.47);
    add(new THREE.CylinderGeometry(0.26, 0.2, 0.1, 6), 0.83);
    for (let k = 0; k < 6; k++) {                     // corner posts of the fire box
      const g = new THREE.BoxGeometry(0.06, 0.28, 0.06); const a = k / 6 * Math.PI * 2 + Math.PI / 6;
      g.deleteAttribute('uv'); g.translate(Math.cos(a) * 0.18, 1.02, Math.sin(a) * 0.18); parts.push(g.toNonIndexed());
    }
    add(new THREE.CylinderGeometry(0.05, 0.46, 0.2, 6), 1.26);
    add(new THREE.CylinderGeometry(0.08, 0.1, 0.06, 6), 1.38);
    add(new THREE.SphereGeometry(0.08, 6, 4), 1.46);
    const g = mergeGeos(parts); g.computeVertexNormals(); return g;
  }
  function cairn() {
    const parts = [];
    [[0.32, 0.12, 0.06], [0.24, 0.1, 0.17], [0.16, 0.09, 0.26]].forEach(([r, h, y], i) => {
      const g = rockGeometry(31 + i); g.scale(r, h * 1.4, r * 0.9); g.rotateY(i * 1.3); g.translate(0.02 * i, y, -0.015 * i); parts.push(g);
    });
    const g = mergeGeos(parts); g.computeVertexNormals(); return g;
  }
  const stones = [], cairns = [], flames = [], candles = [];
  SHORE_LIGHTS.forEach((L, i) => {
    const y = terrainY(L.x, L.z) - 0.04; const v = 0.85 + 0.3 * hash2(i, 3.7);
    const item = { x: L.x, y, z: L.z, ry: hash2(i, 9.1) * 6.28, sx: 1, sy: 1, sz: 1, c: [0.20 * v, 0.195 * v, 0.19 * v] };
    if (L.k === 1) { stones.push(item); flames.push({ x: L.x, y: y + 1.02, z: L.z, k: 1 }); }
    else if (L.k === 0) { cairns.push(item); flames.push({ x: L.x, y: y + 0.4, z: L.z, k: 0 }); }
    else {                                             // a little group of tea-lights / pillar candles in the sand
      const n = 3 + Math.floor(hash2(i, 5.5) * 3);
      for (let c = 0; c < n; c++) {
        const a = c / n * 6.28 + hash2(i, c), r = 0.12 + 0.2 * hash2(c, i);
        const cx = L.x + Math.cos(a) * r, cz = L.z + Math.sin(a) * r, h = 0.07 + 0.16 * hash2(c + 3, i);
        candles.push({ x: cx, y: terrainY(cx, cz) + h / 2 - 0.01, z: cz, sx: 1, sy: h / 0.12, sz: 1, c: [0.62, 0.55, 0.45] });
        flames.push({ x: cx, y: terrainY(cx, cz) + h + 0.03, z: cz, k: 2 });
      }
    }
    shoreUniforms.lamps.value[i].set(L.x, y + (L.k === 1 ? 0.95 : 0.4), L.z, L.k === 1 ? 1.05 : L.k === 0 ? 0.65 : 0.55);
  });
  instanced(dress, stoneLantern(), dressingMaterial(shoreUniforms, 0, false), stones, 'stone-lantern');
  instanced(dress, cairn(), dressingMaterial(shoreUniforms, 0, false), cairns, 'candle-cairn');
  const waxGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8); waxGeo.deleteAttribute('uv');
  instanced(dress, waxGeo, dressingMaterial(shoreUniforms, 0, false), candles, 'tea-lights');
  // the flames: a lit paper core in each lantern, a candle stub on each cairn, both with a soft halo
  const coreGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.24, 6);
  const candleGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.12, 6);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffa648 });
  const flameGeo = new THREE.SphereGeometry(0.025, 6, 4); flameGeo.scale(1, 1.8, 1);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  const halos = [];
  flames.forEach((f, i) => {
    const big = f.k === 1, tea = f.k === 2;
    if (!tea) {
      const m = new THREE.Mesh(big ? coreGeo : candleGeo, coreMat);
      m.position.set(f.x, f.y + (big ? 0 : -0.06), f.z); m.userData.tag = big ? 'stone-lantern' : 'candle-cairn';
      dress.add(m);
    } else {
      const m = new THREE.Mesh(flameGeo, flameMat); m.position.set(f.x, f.y, f.z); m.userData.tag = 'tea-lights'; dress.add(m);
    }
    const base = big ? 0.95 : tea ? 0.6 : 0.8;
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: base }));
    const sc = big ? 2.8 : tea ? 0.75 : 1.5; h.scale.set(sc, sc, 1); h.position.set(f.x, f.y + (big || tea ? 0 : 0.04), f.z);
    h.userData = { tag: 'shore-glow', base, ph: i * 1.7, sc };
    dress.add(h); halos.push(h);
  });

  // glints in the grass: tiny dew/firefly sparks that twinkle on the bank and around the lights
  const GL = 420, gpos = new Float32Array(GL * 3), gseed = new Float32Array(GL);
  for (let i = 0, n = 0; n < GL && i < GL * 6; i++) {
    let x, z;
    if (n < 90) { const L = SHORE_LIGHTS[n % SHORE_LIGHTS.length]; const a = rr(0, 6.28), r = rr(0.6, 3.2); x = L.x + Math.cos(a) * r; z = L.z + Math.sin(a) * r; }
    else { const q = ringPt(rr(NEAR_A0 - 0.2, NEAR_A1 + 0.2), rr(6, 34)); x = q.x; z = q.z; }
    if (waterDist(x, z) < 0.6) continue;
    gpos.set([x, terrainY(x, z) + rr(0.05, 0.5), z], n * 3); gseed[n] = R(); n++;
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
  gg.setAttribute('aSeed', new THREE.BufferAttribute(gseed, 1));
  const glints = new THREE.Points(gg, new THREE.ShaderMaterial({
    uniforms: shoreUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`uniform float time; attribute float aSeed; varying float vB; varying float vWarm;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vB = pow(0.5 + 0.5 * sin(time * (0.7 + aSeed * 2.3) + aSeed * 61.0), 6.0);
        vWarm = step(0.45, fract(aSeed * 7.0));
        gl_PointSize = clamp(34.0 / -mv.z, 1.5, 9.0) * (0.4 + vB);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`varying float vB; varying float vWarm;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
        vec3 c = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.82, 0.45), vWarm);
        gl_FragColor = vec4(c * a * (0.1 + vB * 1.1), 1.0); }`,
  }));
  glints.userData.tag = 'grass-glints'; dress.add(glints);

  // leafy trees standing in the shallows at the ends of the beach: a leaning trunk and a crown of
  // small leaf cards in a few clusters — a broken silhouette, not a blob
  function leafyTree(seed) {
    const r = rngOf(seed); const pos = [], nrm = [];
    const lean = 0.35 + r() * 0.3;                        // leans out over the water (local -z)
    const trunk = new THREE.CylinderGeometry(0.12, 0.26, 4.2, 6, 4); trunk.deleteAttribute('uv');
    const tp = trunk.attributes.position;
    for (let i = 0; i < tp.count; i++) { const y = tp.getY(i) + 2.1; tp.setY(i, y); tp.setZ(i, tp.getZ(i) - lean * y * y * 0.08); }
    const parts = [trunk.toNonIndexed()];
    const top = { y: 4.0, z: -lean * 16 * 0.08 };
    for (let c = 0; c < 6; c++) {
      const cx = (r() - 0.5) * 2.6, cy = top.y + 0.3 + r() * 1.6, cz = top.z + (r() - 0.5) * 2.4;
      const rad = 1.0 + r() * 0.7;
      for (let k = 0; k < 90; k++) {
        const u = r() * 2 - 1, t = r() * 6.283, rr2 = Math.cbrt(r()) * rad;
        const px = cx + Math.sqrt(1 - u * u) * Math.cos(t) * rr2, py = cy + u * rr2 * 0.7, pz = cz + Math.sqrt(1 - u * u) * Math.sin(t) * rr2;
        const ax = r() * 6.28, ay = r() * 6.28, sz = 0.16 + r() * 0.12;
        const e1 = [Math.cos(ay) * sz, Math.sin(ax) * sz * 0.5, Math.sin(ay) * sz], e2 = [-Math.sin(ay) * sz * 0.6, Math.cos(ax) * sz * 0.6, Math.cos(ay) * sz * 0.6];
        const v = [[px - e1[0], py - e1[1], pz - e1[2]], [px + e2[0], py + e2[1], pz + e2[2]], [px + e1[0], py + e1[1], pz + e1[2]], [px - e2[0], py - e2[1], pz - e2[2]]];
        const ny = (py - cy) / rad;                       // outward-ish normal, brighter on top of each cluster
        const n = [(px - cx) / rad, 0.4 + ny, (pz - cz) / rad];
        for (const t3 of [[0, 1, 2], [0, 2, 3]]) for (const q of t3) { pos.push(...v[q]); nrm.push(...n); }
      }
    }
    const crown = new THREE.BufferGeometry();
    crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    crown.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return { trunk: mergeGeos(parts), crown };
  }
  const T = leafyTree(41);
  const trunks = [], crowns = [];
  WATER_TREES.forEach((t, i) => {
    const a = Math.atan2(t.z - LAKE.cz, t.x - LAKE.cx);
    const ry = Math.PI / 2 - a + (hash2(i, 1.3) - 0.5) * 0.6;   // local -z (the lean) points at the lake centre
    const y = Math.max(terrainY(t.x, t.z), -0.5) - 0.1, v = 0.85 + 0.3 * hash2(i, 7.7);
    trunks.push({ x: t.x, y, z: t.z, ry, sx: t.h, sy: t.h, sz: t.h, c: [0.17 * v, 0.13 * v, 0.10 * v] });
    crowns.push({ x: t.x, y, z: t.z, ry, sx: t.h, sy: t.h, sz: t.h, c: [0.11 * v, 0.17 * v, 0.09 * v] });
  });
  instanced(dress, T.trunk, dressingMaterial(shoreUniforms, 0.004, false), trunks, 'tree');
  instanced(dress, T.crown, dressingMaterial(shoreUniforms, 0.006, true), crowns, 'tree');

  return {
    mesh,
    update(dt, playerPos) {
      if (playerPos) shoreUniforms.playerPos.value.copy(playerPos);
      const t = shoreUniforms.time.value;
      for (const h of halos) { const f = 0.88 + 0.12 * Math.sin(t * 5.7 + h.userData.ph) * Math.sin(t * 2.1 + h.userData.ph * 0.5); h.material.opacity = h.userData.base * f; }
    },
  };
}
