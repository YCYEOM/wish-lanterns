// The whale of light: now and then a great glowing whale rises out of the lake, swims across in front of the
// shore, leaps once and dives again. Shared like the shooting stars: everyone works out the same schedule from
// the wall clock, so a whole lake sees it at the same moment. Under the water it shows as a soft deep glow.
//
//   const whale = createWhale(scene, glowTex)
//   whale.schedule(nowMs)          -> true when one should start now (call each frame; it starts itself)
//   whale.start(seed) / whale.update(dt, T) / whale.lift(x, z) -> 0..1 how much a lantern there is lifted
import * as THREE from '../vendor/three.module.js';

export const WHALE_SLOT = 420;          // seconds: about one in two slots has a whale → every ~12 minutes
const DUR = 30;                          // seconds from the first glow to the last

export function createWhale(scene, glowTex) {
  const root = new THREE.Group(); root.visible = false; root.userData.tag = 'light-whale'; scene.add(root);
  const uniforms = { time: { value: 0 }, fade: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vL = position; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float time; uniform float fade; varying vec3 vN; varying vec3 vW; varying vec3 vL;
      float h(vec3 p){ p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
        vec3 base = mix(vec3(0.15, 0.55, 1.0), vec3(0.65, 0.95, 1.0), rim);
        // little stars inside the body, drifting
        vec3 q = vL * 3.2 + vec3(0.0, time * 0.15, 0.0);
        float st = step(0.965, h(floor(q))) * (0.6 + 0.4 * sin(time * 3.0 + h(floor(q) + 2.0) * 20.0));
        float a = (0.38 + rim * 1.1) + st * 1.2;
        // under the water: dimmer and deeper blue, melting away with depth
        float under = clamp(-vW.y / 6.0, 0.0, 1.0);
        vec3 col = mix(base, vec3(0.05, 0.25, 0.6), under) + st * vec3(1.0, 0.95, 0.85);
        a *= mix(1.0, 0.45, under) * fade;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  // body: a lathe round the length (z), blunt head at -z, tapering to the tail
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, z = -7 + t * 14;
    const r = t < 0.18 ? 1.05 * Math.sqrt(t / 0.18) * (0.75 + 0.25 * t / 0.18) : 1.05 * Math.pow(1 - (t - 0.18) / 0.82, 1.15) * (1 - 0.1 * Math.sin(t * 3));
    prof.push(new THREE.Vector2(Math.max(0.02, r * 1.55), z));
  }
  const bodyGeo = new THREE.LatheGeometry(prof, 20); bodyGeo.rotateX(Math.PI / 2); bodyGeo.scale(1, 0.75, 1);
  const fig = new THREE.Group(); fig.scale.setScalar(1.5); root.add(fig);
  const body = new THREE.Mesh(bodyGeo, mat); fig.add(body);
  const finGeo = new THREE.SphereGeometry(1, 10, 6); finGeo.scale(1.9, 0.12, 0.7);
  const fins = [-1, 1].map((s) => { const f = new THREE.Mesh(finGeo, mat); f.position.set(1.6 * s, -0.5, -2.6); f.rotation.set(0, 0.5 * s, 0.4 * s); fig.add(f); return f; });
  const tail = new THREE.Group(); tail.position.set(0, 0, 6.6); fig.add(tail);
  const flukeGeo = new THREE.SphereGeometry(1, 10, 6); flukeGeo.scale(1.7, 0.1, 0.8);
  [-1, 1].forEach((s) => { const f = new THREE.Mesh(flukeGeo, mat); f.position.set(1.35 * s, 0, 0.5); f.rotation.y = -0.45 * s; tail.add(f); });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6fc8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
  halo.scale.set(36, 18, 1); root.add(halo);
  // sparkles shed along its back
  const N = 160, spos = new Float32Array(N * 3), sage = new Float32Array(N).fill(9);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(spos, 3)); sg.setAttribute('aAge', new THREE.BufferAttribute(sage, 1));
  const sparkles = new THREE.Points(sg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float aAge; varying float vA; void main(){ vA = clamp(1.0 - aAge / 2.5, 0.0, 1.0); gl_PointSize = 9.0 * vA + 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r) * vA; gl_FragColor = vec4(vec3(0.7, 0.95, 1.0) * a, a); }`,
  }));
  sparkles.frustumCulled = false; scene.add(sparkles);
  let sNext = 0;

  let run = null, slotSeen = -1;
  const P = new THREE.Vector3(), P2 = new THREE.Vector3();
  // its path across the lake in front of the shore: from one side to the other, rising, a leap, a dive
  function at(u, out) {
    const s = run.side;
    const x = s * (-55 + 110 * u), z = -22 - 10 * Math.sin(u * Math.PI) + run.dz;   // well in front of the shore
    let y = -7 + 7.2 * Math.sin(Math.min(1, u / 0.22) * Math.PI / 2);          // rising to just under the surface
    if (u > 0.78) y -= 9 * Math.pow((u - 0.78) / 0.22, 1.5);                    // the dive
    const leap = Math.max(0, 1 - Math.abs(u - run.leapAt) / 0.07);               // one leap out of the water
    y += 5.2 * Math.sin(leap * Math.PI / 2);
    return out.set(x, y, z);
  }
  return {
    get active() { return !!run; },
    schedule(nowMs, hash) {
      const slot = Math.floor(nowMs / 1000 / WHALE_SLOT);
      if (slot !== slotSeen) { slotSeen = slot; run && 0; this._at = hash(slot, 11) < 0.5 ? (slot * WHALE_SLOT + 30 + hash(slot, 12) * (WHALE_SLOT - 80)) * 1000 : 0; this._slot = slot; }
      if (!run && this._at && nowMs >= this._at && nowMs < this._at + 2000) { this.start(hash(this._slot, 13), hash(this._slot, 14)); this._at = 0; return true; }
      return false;
    },
    start(a = 0.3, b = 0.6) {
      run = { t: 0, side: a < 0.5 ? 1 : -1, dz: (b - 0.5) * 10, leapAt: 0.45 + b * 0.15 };
      root.visible = true;
    },
    update(dt, T) {
      uniforms.time.value = T;
      // sparkles age and fall back
      for (let i = 0; i < N; i++) if (sage[i] < 9) { sage[i] += dt; spos[i * 3 + 1] += dt * 0.6; }
      sg.attributes.aAge.needsUpdate = true; sg.attributes.position.needsUpdate = true;
      if (!run) return;
      run.t += dt;
      const u = Math.min(1, run.t / DUR);
      at(u, P); at(Math.min(1, u + 0.004), P2);
      root.position.copy(P);
      const dx = P2.x - P.x, dy = P2.y - P.y, dz = P2.z - P.z;
      fig.rotation.set(0, 0, 0);
      fig.rotation.y = Math.atan2(-dx, -dz);
      fig.rotation.x = Math.atan2(dy, Math.hypot(dx, dz));
      tail.rotation.x = Math.sin(T * 1.7) * 0.35;
      fins.forEach((f, i) => { f.rotation.z = (i ? -1 : 1) * (0.4 + Math.sin(T * 1.2) * 0.15); });
      uniforms.fade.value = Math.min(1, run.t / 3) * (1 - Math.max(0, (run.t - DUR + 3) / 3));
      halo.material.opacity = 0.6 * uniforms.fade.value * (P.y > -2 ? 1 : 0.6);
      halo.position.set(0, Math.max(-P.y, 0) * 0 + 0.5, 0);
      if (P.y > -1.2 && (sNext -= dt) < 0) {            // shed sparkles from the back when near the surface
        sNext = 0.03;
        for (let k = 0; k < 3; k++) {
          const i = Math.floor(((T * 97.3 + k * 31) % 1) * N) % N;
          spos[i * 3] = P.x + Math.sin(T * 13 + k) * 3; spos[i * 3 + 1] = Math.max(0.2, P.y + 1); spos[i * 3 + 2] = P.z + Math.cos(T * 11 + k) * 3; sage[i] = 0;
        }
      }
      if (run.t >= DUR) { run = null; root.visible = false; }
    },
    // how much a lantern at (x, z) is lifted by the passing whale: near it, while it is near the surface
    lift(x, z) {
      if (!run) return 0;
      const d = Math.hypot(x - root.position.x, z - root.position.z);
      return d > 11 ? 0 : (1 - d / 11) * Math.max(0, Math.min(1, (root.position.y + 3) / 3)) * uniforms.fade.value;
    },
    get pos() { return root.position; },
  };
}
