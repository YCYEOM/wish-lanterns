// Ripples on the lake: soft rings that open and fade (a boat's wake, an oar dipping, anything touching the water).
//   const wake = createWake(scene)
//   wake.ring(x, z, size, strength, stretch?, yaw?)   size: final radius (m); stretch > 1 draws an ellipse along yaw
//   wake.update(dt)
import * as THREE from '../vendor/three.module.js';

export function createWake(scene, max = 48) {
  const geo = new THREE.RingGeometry(0.95, 1.0, 48); geo.rotateX(-Math.PI / 2);   // a thin line, like a ripple's crest
  const pool = [];
  for (let i = 0; i < max; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.visible = false; m.renderOrder = -5; m.userData = { t: 9, life: 1, size: 1, k: 1, sx: 1 };
    scene.add(m); pool.push(m);
  }
  let next = 0;
  return {
    ring(x, z, size = 1.5, strength = 1, stretch = 1, yaw = 0) {
      const m = pool[next]; next = (next + 1) % pool.length;
      m.position.set(x, 0.035, z); m.rotation.y = yaw; m.visible = true;
      Object.assign(m.userData, { t: 0, life: 1.6 + size * 0.5, size, k: strength, sx: stretch });
    },
    update(dt) {
      for (const m of pool) {
        if (!m.visible) continue;
        const u = m.userData; u.t += dt;
        const f = u.t / u.life;
        if (f >= 1) { m.visible = false; continue; }
        const r = 0.15 + u.size * (1 - (1 - f) * (1 - f));                 // opens fast, then slows
        m.scale.set(r * u.sx, 1, r);
        m.material.opacity = 0.16 * u.k * (1 - f) * (1 - f) * Math.min(1, u.t * 8);
      }
    },
  };
}
