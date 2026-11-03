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
      uniform float time; uniform vec3 camPos; uniform vec3 playerPos; uniform vec3 lakeC; uniform float lakeR;
      varying vec3 vW; varying vec3 vN;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n21(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      void main(){
        if (vW.y < -0.02) discard;                      // the water covers everything below the waterline
        float r = length(vW.xz - lakeC.xz);
        float a = atan(vW.z - lakeC.z, vW.x - lakeC.x);
        float shoreR = lakeR * (1.0 + 0.035 * sin(a * 5.0 + 1.3) + 0.02 * sin(a * 11.0 + 0.4));
        float d = r - shoreR;                           // distance from the waterline
        float n = n21(vW.xz * 0.6) * 0.6 + n21(vW.xz * 2.3) * 0.3 + n21(vW.xz * 9.0) * 0.1;
        vec3 wet   = vec3(0.16, 0.15, 0.17);
        vec3 sand  = vec3(0.42, 0.37, 0.33);
        vec3 grass = vec3(0.10, 0.15, 0.13);
        vec3 col = mix(wet, sand, smoothstep(0.2, 2.5, d));
        col = mix(col, grass, smoothstep(9.0 + n * 4.0, 15.0 + n * 4.0, d));
        col *= 0.75 + n * 0.5;
        // ripples of sand
        col *= 0.92 + 0.08 * sin(dot(vW.xz, vec2(0.9, 0.4)) * 3.0 + n * 4.0) * (1.0 - smoothstep(4.0, 10.0, d));
        // moonlight from the upper left, plus a cool sky fill
        vec3 L = normalize(vec3(-0.4, 0.8, -0.45));
        float diff = max(dot(normalize(vN), L), 0.0);
        vec3 lit = col * (vec3(0.30, 0.34, 0.52) * 0.35 + vec3(0.55, 0.6, 0.85) * diff * 0.3);
        // a thin bright edge where the lake laps the sand
        float foam = (1.0 - smoothstep(0.0, 0.5, d)) * (0.55 + 0.45 * sin(time * 1.3 + a * 40.0));
        lit += vec3(0.16, 0.18, 0.26) * foam;
        // the character's lantern: a warm pool of light on the sand
        float pd = length(vW - playerPos - vec3(0.0, 0.8, 0.0));
        lit += col * vec3(1.5, 0.85, 0.4) * exp(-pd * pd * 0.18) * 0.9;
        // fog toward the horizon colour (matches scene.fog)
        float dist = length(vW - camPos);
        float fog = 1.0 - exp(-pow(dist * 0.0042, 2.0));
        gl_FragColor = vec4(mix(lit, vec3(0.082, 0.071, 0.172), fog), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.tag = 'ground';
  scene.add(mesh);
  return {
    mesh,
    update(dt, playerPos) { if (playerPos) shoreUniforms.playerPos.value.copy(playerPos); },
  };
}
