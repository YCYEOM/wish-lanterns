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
  const d = waterDist(x, z);
  if (d < 0) return Math.max(-2.5, d * 0.12) - 0.05;
  const beach = 0.9 * (1 - Math.exp(-d / 7));            // gentle sand slope out of the water
  const rise = Math.max(0, d - 14) * 0.09;               // the grass bank climbs behind the beach
  const fade = Math.min(1, d / 6);
  return beach + rise + bumps(x, z) * fade;
}
// the near shore: the arc of beach facing the viewer, roomy enough to wander
export function walkable(x, z) {
  const d = waterDist(x, z);
  if (d < 0.5 || d > 30) return false;
  return z > -40;
}
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
  uniform vec3 camPos; uniform vec3 playerPos; uniform float time;
  vec3 shoreLight(vec3 col, vec3 N, vec3 W, float ao){
    vec3 L = normalize(vec3(-0.4, 0.8, -0.45));
    float diff = max(dot(N, L), 0.0);
    float sky = 0.55 + 0.45 * N.y;
    vec3 lit = col * (vec3(0.26, 0.27, 0.42) * 0.42 * sky * ao + vec3(0.62, 0.66, 0.9) * diff * 0.42);
    vec3 toP = playerPos + vec3(0.0, 0.9, 0.0) - W;
    float pd = length(toP);
    float lamb = 0.35 + 0.65 * max(dot(N, toP / max(pd, 1e-3)), 0.0);
    lit += col * vec3(1.6, 0.9, 0.42) * exp(-pd * pd * 0.12) * 1.1 * lamb;
    return lit;
  }
  vec3 shoreFog(vec3 lit, vec3 W){
    float dist = length(W - camPos);
    float fog = 1.0 - exp(-pow(dist * 0.0042, 2.0));
    return mix(lit, vec3(0.082, 0.071, 0.172), fog);
  }`;

// one lit material for the instanced dressing: per-instance tint (aCol), optional wind sway on height
function dressingMaterial(u, sway, doubleSide) {
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
      ${LIGHT_GLSL}
      varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vH;
      void main(){
        if (vW.y < -0.02) discard;                       // the lake surface hides what is under it
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        ${doubleSide ? 'N = normalize(N + vec3(0.0, 0.8, 0.0));' : ''}
        float ao = clamp(0.45 + vH * 0.6, 0.45, 1.0);
        vec3 col = vC * (0.75 + 0.35 * clamp(vH, 0.0, 1.5));
        gl_FragColor = vec4(shoreFog(shoreLight(col, N, vW, ao), vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---- dressing geometry (all built from seeded numbers)
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
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

export function buildShore(scene, uniforms) {
  // polar ring around the lake: dense near the waterline, sparse far away
  const SEG = 320, RINGS = 90;
  const pos = [], idx = [];
  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS;
    const off = -6 + Math.pow(t, 2.2) * 420;      // signed offset from the waterline
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const r = shoreRadius(a) + off;
      const x = LAKE.cx + Math.cos(a) * r, z = LAKE.cz + Math.sin(a) * r;
      pos.push(x, groundY(x, z), z);
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
    lakeC: { value: new THREE.Vector3(LAKE.cx, 0, LAKE.cz) },
    lakeR: { value: LAKE.r },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: shoreUniforms, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
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
        float big = fbm(p * 0.07), mid = fbm(p * 0.6), fine = n21(p * 7.0);

        // --- the wash: the lake laps up the sand and slides back
        float wave = 0.5 + 0.5 * sin(time * 0.55 + a * 9.0 + big * 3.0);
        float reach = 0.3 + 1.5 * wave * wave;                 // how far the current wave runs up
        float wetLine = 3.4 + 1.6 * mid;                          // the darker band left by earlier waves
        float wetK = 1.0 - smoothstep(wetLine - 0.8, wetLine + 0.6, d);
        float washK = 1.0 - smoothstep(reach - 0.15, reach + 0.05, d);

        // --- palette: warm-dark sand, damp, wet, the grass bank
        vec3 sandDry = mix(vec3(0.34, 0.25, 0.17), vec3(0.42, 0.31, 0.21), big);
        vec3 sandDamp = vec3(0.15, 0.105, 0.08);
        vec3 sandWet = vec3(0.075, 0.062, 0.065);
        vec3 grassA = vec3(0.075, 0.13, 0.065), grassB = vec3(0.13, 0.17, 0.07), soil = vec3(0.12, 0.09, 0.06);
        vec3 col = sandDry;
        col *= 0.78 + 0.32 * mid + 0.14 * (fine - 0.5);
        // pebbles and shell flecks scattered over the sand, thicker near the water
        float peb = pebble(p * 3.2, 0.10 + 0.25 * (1.0 - smoothstep(1.0, 6.0, d)));
        float pebShade = h21(floor(p * 3.2) + 5.0);
        col = mix(col, mix(vec3(0.08, 0.07, 0.07), vec3(0.42, 0.37, 0.32), pebShade), peb * 0.8);
        float fleck = step(0.993, h21(floor(p * 22.0)));
        col += fleck * vec3(0.18, 0.16, 0.14);
        // damp and wet sand toward the water
        col = mix(col, sandDamp * (0.8 + 0.4 * mid), wetK * 0.92);
        col = mix(col, sandWet, washK);
        // the grass bank creeps down over the sand in tongues
        float gEdge = 8.5 + 6.0 * big + 2.0 * mid;
        float gK = smoothstep(gEdge, gEdge + 2.5, d);
        float streak = n21(vec2(p.x * 9.0 + p.y * 2.0, p.y * 1.4));
        float tuftK = smoothstep(0.62, 0.72, fbm(p * 0.9 + 3.0)) * smoothstep(4.0, 8.0, d);
        gK = max(gK, tuftK * 0.55 * (0.4 + 0.6 * streak));
        vec3 grass = mix(grassA, grassB, mid) * (0.6 + 0.7 * streak);
        grass = mix(grass, soil, smoothstep(0.55, 0.75, fbm(p * 0.35 + 9.0)) * 0.6);
        col = mix(col, grass, gK);
        // a darker damp-soil seam where grass meets sand
        col *= 1.0 - 0.25 * (smoothstep(gEdge - 1.5, gEdge, d) - smoothstep(gEdge + 0.5, gEdge + 2.5, d));

        // --- bump normal from the sand height field (dry sand only)
        float bm = (1.0 - gK) * (1.0 - wetK * 0.7);
        float e = 0.04;
        float hS = sandH(p, d) * bm;
        float hx = sandH(p + vec2(e, 0.0), d) * bm, hz = sandH(p + vec2(0.0, e), d) * bm;
        vec3 N = normalize(normalize(vN) + vec3(-(hx - hS) / e, 0.0, -(hz - hS) / e) * 0.06);
        float cav = 0.85 + 0.3 * hS;                      // ripple troughs sit a little darker
        col *= cav;
        vec3 lit = shoreLight(col, N, vW, 1.0);

        // --- wet sand mirrors the sky: a cool sheen, brightest at grazing angles, with the moon glint
        vec3 V = normalize(camPos - vW);
        float fres = pow(1.0 - max(V.y, 0.0), 3.0);
        float gloss = max(washK, wetK * 0.45);
        lit += gloss * fres * vec3(0.10, 0.08, 0.20) * (0.6 + 0.4 * mid);
        vec3 Lm = normalize(vec3(-0.4, 0.8, -0.45));
        vec3 Hm = normalize(V + Lm);
        lit += gloss * pow(max(dot(N, Hm), 0.0), 60.0) * vec3(0.35, 0.36, 0.5);

        // --- foam: the frothy lip of the running wave plus a broken line at the waterline
        float froth = fbm(vec2(a * 260.0, d * 3.0 - time * 0.4));
        float lip = exp(-pow((d - reach) / 0.18, 2.0)) * smoothstep(0.35, 0.65, froth + 0.15 * wave);
        float edge = (1.0 - smoothstep(0.0, 0.35, d)) * (0.55 + 0.45 * sin(time * 1.3 + a * 40.0)) * smoothstep(0.3, 0.6, froth);
        vec2 bc = p * 9.0 + vec2(0.0, floor(time * 0.8) * 3.7);
        float bubbles = step(0.72, h21(floor(bc))) * (1.0 - smoothstep(0.08, 0.2, length(fract(bc) - 0.5))) * washK * smoothstep(reach - 0.8, reach, d) * 0.35;
        lit += vec3(0.42, 0.44, 0.55) * (lip * 1.2 + edge * 0.8 + bubbles);

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
    const bankEdge = 9 + 6 * hash2(q.x * 0.07, q.z * 0.07);
    if (d < bankEdge && R() > 0.3) continue;           // only a few strays on the open sand
    const s = d < bankEdge ? rr(0.6, 1.0) : rr(0.5, 1.0);
    const g = rr(0.75, 1.1);
    tufts.push({ x: q.x, y: groundY(q.x, q.z) - 0.03, z: q.z, ry: rr(0, 6.28), sx: s, sy: s * rr(0.8, 1.3), sz: s,
      c: [0.20 * g, 0.30 * g, 0.13 * g] });
  }
  instanced(dress, bladeTuft(9, 0.7, 0.28, 0.035, 11), dressingMaterial(shoreUniforms, 0.12, true), tufts, 'grass');

  // rocks: little stones on the open sand, boulder clusters at the ends of the beach and in the shallows
  const rocks = [];
  const rockCol = () => { const v = rr(0.7, 1.1); return [0.30 * v, 0.28 * v, 0.27 * v]; };
  for (let i = 0; i < 120; i++) {                        // pebbles and small stones on the walkable sand, thicker at the wet band
    const a = rr(NEAR_A0, NEAR_A1), d = i % 2 ? rr(0.2, 4) : rr(0.6, 22);
    const q = ringPt(a, d); const s = rr(0.12, 0.38);
    rocks.push({ x: q.x, y: groundY(q.x, q.z) - s * 0.25, z: q.z, rx: rr(-0.3, 0.3), ry: rr(0, 6.28), sx: s, sy: s, sz: s * rr(0.7, 1.2), c: rockCol() });
  }
  const clusters = [[NEAR_A0 - 0.06, 1], [NEAR_A1 + 0.06, 1], [1.33, -1.4], [1.86, -1.2], [1.12, 2.5], [2.05, 2.0], [0.62, 0.5], [2.5, 0.8],
    [-0.4, 2], [3.6, 1.5], [4.4, 1], [5.2, 2]];
  clusters.forEach(([ca, cd], k) => {
    const n = 3 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const a = ca + rr(-0.025, 0.025), d = cd + rr(-1.4, 1.4);
      const q = ringPt(a, d); const big = i === 0 ? rr(0.9, 1.5) : rr(0.3, 0.8);
      const s = big * (Math.abs(a - Math.PI / 2) < 0.6 && d > 0.5 ? 0.55 : 1);  // keep the sand near the start open
      rocks.push({ x: q.x, y: Math.max(groundY(q.x, q.z), -0.6) - s * 0.15, z: q.z, rx: rr(-0.25, 0.25), ry: rr(0, 6.28), rz: rr(-0.2, 0.2), sx: s * rr(0.9, 1.4), sy: s, sz: s, c: rockCol() });
    }
  });
  instanced(dress, rockGeometry(3), dressingMaterial(shoreUniforms, 0, false), rocks, 'rock');

  // driftwood: bleached logs lying along the wrack line
  const wood = [];
  for (let i = 0; i < 16; i++) {
    const a = i < 12 ? rr(NEAR_A0 + 0.05, NEAR_A1 - 0.05) : rr(0, Math.PI * 2);
    const d = rr(1.6, 6.5); const q = ringPt(a, d);
    const len = rr(1.4, 3.6), th = rr(0.7, 1.3), v = rr(0.85, 1.15);
    wood.push({ x: q.x, y: groundY(q.x, q.z) + 0.06 * th, z: q.z, ry: -a - Math.PI / 2 + rr(-0.5, 0.5), rz: rr(-0.05, 0.05), sx: len, sy: th, sz: th, c: [0.38 * v, 0.33 * v, 0.28 * v] });
  }
  instanced(dress, driftwoodGeometry(), dressingMaterial(shoreUniforms, 0, false), wood, 'driftwood');

  // reed clumps standing in the shallows (the open water in front of the start stays clear for launches)
  const reeds = [];
  for (let i = 0; i < 240 && reeds.length < 110; i++) {
    const a = rr(0, Math.PI * 2);
    if (Math.abs(a - Math.PI / 2) < 0.12) continue;
    const d = rr(-3.2, 0.4); const q = ringPt(a, d);
    const s = rr(0.9, 2.0), g = rr(0.8, 1.15);
    reeds.push({ x: q.x, y: Math.max(groundY(q.x, q.z), -0.35), z: q.z, ry: rr(0, 6.28), sx: rr(0.8, 1.3), sy: s, sz: rr(0.8, 1.3), c: [0.17 * g, 0.21 * g, 0.10 * g] });
  }
  instanced(dress, reedClump(21), dressingMaterial(shoreUniforms, 0.09, true), reeds, 'reeds');

  // trees and bushes framing the ends of the beach (outside the walkable arc, never behind the camera)
  const trees = [], bushes = [];
  for (let i = 0; i < 400 && trees.length < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const a = side > 0 ? rr(NEAR_A0 - 0.45, NEAR_A0 - 0.04) : rr(NEAR_A1 + 0.04, NEAR_A1 + 0.45);
    const d = rr(4, 30); const q = ringPt(a, d);
    if (walkable(q.x, q.z) || q.z > -42) continue;
    const s = rr(1.0, 1.7), v = rr(0.8, 1.15);
    trees.push({ x: q.x, y: groundY(q.x, q.z) - 0.1, z: q.z, ry: rr(0, 6.28), sx: s, sy: s * rr(0.9, 1.3), sz: s, c: [0.09 * v, 0.14 * v, 0.08 * v] });
  }
  for (let i = 0; i < 600 && bushes.length < 60; i++) {
    const a = rr(0, Math.PI * 2), d = rr(2.5, 40); const q = ringPt(a, d);
    if (walkable(q.x, q.z) || q.z > -42) continue;
    const s = rr(0.5, 1.1), v = rr(0.8, 1.2);
    bushes.push({ x: q.x, y: groundY(q.x, q.z) - 0.2 * s, z: q.z, ry: rr(0, 6.28), sx: s * 1.3, sy: s * 0.8, sz: s * 1.2, c: [0.10 * v, 0.15 * v, 0.08 * v] });
  }
  instanced(dress, canopyGeometry(5), dressingMaterial(shoreUniforms, 0.015, false), trees, 'tree');
  instanced(dress, rockGeometry(17), dressingMaterial(shoreUniforms, 0.04, false), bushes, 'bush');

  return {
    mesh,
    update(dt, playerPos) { if (playerPos) shoreUniforms.playerPos.value.copy(playerPos); },
  };
}
