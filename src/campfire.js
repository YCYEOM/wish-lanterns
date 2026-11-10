// The campfire: a small fire on the beach right of the start, ringed with stones, a few logs to sit by.
// It grows with the people sitting around it (more flame, more sparks drifting up), crackles when you are near,
// and lights the sand around it (the shore's spare lamp slot).
//
//   const fire = createCampfire(scene, shore, glowTex, lampSlot)
//   fire.update(dt, T, sitters)    sitters: how many people sit within its circle
//   fire.pos / fire.R              where it is and how far "around the fire" reaches
import * as THREE from '../vendor/three.module.js';

export function createCampfire(scene, shore, glowTex, lamp) {
  const p = shore.nearestShore(10.5, 16, 7.2);
  const pos = new THREE.Vector3(p.x, shore.groundY(p.x, p.z), p.z);
  const g = new THREE.Group(); g.position.copy(pos); g.userData.tag = 'campfire'; scene.add(g);
  const lam = (c, e = 0) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: e });
  const stoneM = lam(0x6a6670, 0x1a1414), logM = lam(0x5a3a24, 0x1c0e06), charM = lam(0x2a1a14, 0x3a1408);
  for (let i = 0; i < 9; i++) {                       // the ring of stones
    const a = (i / 9) * Math.PI * 2, st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneM);
    st.position.set(Math.cos(a) * 0.62, 0.06, Math.sin(a) * 0.62); st.scale.set(1, 0.6, 0.9); st.rotation.y = a * 3; g.add(st);
  }
  for (let i = 0; i < 4; i++) {                       // logs leaning into a little cone, charred at the tips
    const a = (i / 4) * Math.PI * 2 + 0.4, l = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.75, 6), i % 2 ? logM : charM);
    l.position.set(Math.cos(a) * 0.18, 0.2, Math.sin(a) * 0.18); l.rotation.set(Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75); g.add(l);
  }
  // seats: three logs lying round the fire
  const seats = [];
  for (const a of [0.5, 2.6, 4.4]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.3, 7), logM);
    s.rotation.set(0, -a, Math.PI / 2); s.position.set(Math.cos(a) * 1.9, 0.14, Math.sin(a) * 1.9); g.add(s); seats.push(a);
  }
  // the flame: a few additive tongues that flicker and stretch, a warm core, a big soft glow
  const flameCol = [0xffd27a, 0xffa040, 0xff7a2a];
  const tongues = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: flameCol[i % 3], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.userData = { ph: i * 1.7, ox: (i % 3 - 1) * 0.08, oz: (i % 2 ? 1 : -1) * 0.06 };
    g.add(m); tongues.push(m);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a4a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5 }));
  halo.position.y = 0.6; g.add(halo);
  // sparks drifting up
  const N = 90, sp = new Float32Array(N * 3), sa = new Float32Array(N).fill(9), sv = new Float32Array(N * 2);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aAge', new THREE.BufferAttribute(sa, 1));
  const sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float aAge; varying float vA; void main(){ vA = clamp(1.0 - aAge / 2.2, 0.0, 1.0); gl_PointSize = 5.0 * vA + 1.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r) * vA; gl_FragColor = vec4(vec3(1.0, 0.62, 0.25) * a, a); }`,
  }));
  sparks.frustumCulled = false; g.add(sparks);
  let next = 0, size = 1, seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return {
    pos, R: 3.2,
    seats: seats.map((a) => ({ x: pos.x + Math.cos(a) * 1.9, z: pos.z + Math.sin(a) * 1.9 })),
    update(dt, T, sitters) {
      size += ((1 + Math.min(4, sitters) * 0.32) - size) * Math.min(1, dt * 0.8);   // more people round it, a bigger fire
      tongues.forEach((m, i) => {
        const u = m.userData, f = 0.75 + 0.25 * Math.sin(T * (7 + i) + u.ph) * Math.sin(T * (3.1 + i * 0.4) + u.ph * 2);
        const h = (0.55 + (i % 3) * 0.12) * size * f;
        m.position.set(u.ox * size, 0.22 + h * 0.45, u.oz * size);
        m.scale.set(0.7 * size * (0.8 + 0.2 * f), h * 2.0, 1);
        m.material.opacity = 0.75 * f;
      });
      halo.scale.setScalar(3.4 * size * (0.95 + 0.05 * Math.sin(T * 9)));
      if (lamp) lamp.set(pos.x, pos.y + 0.6, pos.z, (1.25 + 0.15 * Math.sin(T * 8.3) * Math.sin(T * 3.7)) * Math.min(1.6, size));
      // sparks: more of them with a bigger fire
      next -= dt * (6 + 10 * (size - 1) * 3);
      while (next < 0) {
        next += 1; const i = Math.floor(rnd() * N);
        sp[i * 3] = (rnd() - 0.5) * 0.3; sp[i * 3 + 1] = 0.35; sp[i * 3 + 2] = (rnd() - 0.5) * 0.3; sa[i] = 0;
        sv[i * 2] = (rnd() - 0.5) * 0.35; sv[i * 2 + 1] = (rnd() - 0.5) * 0.35;
      }
      for (let i = 0; i < N; i++) if (sa[i] < 9) {
        sa[i] += dt; sp[i * 3 + 1] += dt * (1.2 + 0.4 * size); sp[i * 3] += sv[i * 2] * dt + Math.sin(T * 2 + i) * 0.004; sp[i * 3 + 2] += sv[i * 2 + 1] * dt;
      }
      sg.attributes.aAge.needsUpdate = true; sg.attributes.position.needsUpdate = true;
    },
  };
}
