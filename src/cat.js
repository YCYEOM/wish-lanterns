// The lakeside cat: a small low-poly cat that keeps the player company. It trots after you, sits and grooms
// when you stop, curls up beside you when you sit, watches the lake while you launch, and meows (a little ♡)
// when tapped. Its bond with you grows with time spent together: it follows closer and purrs more.
//
//   const cat = createCat(scene, shore)
//   cat.update(dt, T, { pos, yaw, moving, sitting, busy })     each frame
//   cat.screenHit(camera, x, y, w, h)  -> true if a tap at (x, y) lands on the cat
//   cat.pet()                           its reaction to a tap (the caller plays the sound)
import * as THREE from '../vendor/three.module.js';

export function createCat(scene, shore, { coat = 0x7f8798, belly = 0xf4f0ea, bond = 0 } = {}) {
  const { groundY, walkable } = shore;
  // a faint warm emissive like the walker's cloak, so it reads in the dark away from the lantern
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: new THREE.Color(c).multiplyScalar(0.28) });
  const fur = lam(coat), pale = lam(belly), dark = lam(0x2a1c18), pink = lam(0xf2a0a0), stripe = lam(new THREE.Color(coat).multiplyScalar(0.72).getHex());
  const root = new THREE.Group(); root.userData.tag = 'cat'; scene.add(root);
  const fig = new THREE.Group(); fig.scale.setScalar(1.35); root.add(fig);   // faces -z like the walker

  const body = new THREE.Group(); body.position.y = 0.2; fig.add(body);
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 2), fur); torso.scale.set(0.85, 0.78, 1.55); body.add(torso);
  // tabby stripes: thin bands that follow the curve of the back (half rings sitting on the body's surface)
  for (const zt of [-0.55, -0.22, 0.1, 0.42]) {
    const k = Math.sqrt(1 - zt * zt);                                   // the body's cross-section shrinks toward the ends
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.15 * k, 0.011, 4, 14, Math.PI * 0.72), stripe);
    arc.rotation.set(0, 0, Math.PI * 0.14); arc.scale.set(0.85 * 1.02, 0.78 * 1.02, 1);
    arc.position.z = zt * 0.15 * 1.55; body.add(arc);
  }
  const chest = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), pale); chest.scale.set(0.9, 0.9, 0.8); chest.position.set(0, -0.03, -0.17); body.add(chest);
  const head = new THREE.Group(); head.position.set(0, 0.1, -0.23); body.add(head);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.105, 1), fur); skull.scale.set(1.1, 0.95, 0.95); head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 1), pale); muzzle.scale.set(1.2, 0.8, 0.8); muzzle.position.set(0, -0.035, -0.08); head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 4), pink); nose.position.set(0, -0.015, -0.12); head.add(nose);
  const eyes = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), fur); ear.position.set(0.055 * s, 0.09, -0.005); ear.rotation.set(-0.15, 0.6 * s, 0.25 * s); head.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 4), pink); inner.position.set(0.055 * s, 0.085, -0.02); inner.rotation.copy(ear.rotation); head.add(inner);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 4), dark); eye.scale.set(1, 1.25, 0.6); eye.position.set(0.042 * s, 0.012, -0.093); head.add(eye); eyes.push(eye);
  }
  // legs pivot at the top; paws are little pale balls
  const legs = [];
  for (const [x, z] of [[-0.06, -0.14], [0.06, -0.14], [-0.06, 0.15], [0.06, 0.15]]) {
    const g = new THREE.Group(); g.position.set(x, -0.04, z); body.add(g);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.16, 5), fur); l.position.y = -0.08; g.add(l);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.027, 6, 4), pale); p.position.y = -0.16; g.add(p);
    legs.push(g);
  }
  // tail: a chain that curls up and sways
  const tail = []; let parent = new THREE.Group(); parent.position.set(0, 0.04, 0.22); body.add(parent);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group(); if (i) g.position.y = 0.055; parent.add(g);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.02 - i * 0.0015, 0.022 - i * 0.0015, 0.06, 5), i === 5 ? stripe : fur); seg.position.y = 0.028; g.add(seg);
    tail.push(g); parent = g;
  }
  // a small ♡ that floats up when it is petted
  const hc = document.createElement('canvas'); hc.width = hc.height = 64;
  const hg = hc.getContext('2d'); hg.font = '48px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; hg.textAlign = 'center'; hg.textBaseline = 'middle'; hg.fillText('💗', 32, 36);
  const heartTex = new THREE.CanvasTexture(hc); heartTex.colorSpace = THREE.SRGBColorSpace;
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false, opacity: 0 }));
  heart.scale.setScalar(0.32); heart.visible = false; root.add(heart);

  const pos = new THREE.Vector3(0, 0, 0);
  let yaw = 0, speed = 0, phase = 0, mode = 'sit', modeT = 0, loaf = 0, groom = 0, petT = -9, blink = 0, placed = false;
  let lookYaw = 0;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ease = (cur, tgt, k) => cur + (tgt - cur) * k;

  function place(x, z) { pos.set(x, groundY(x, z), z); placed = true; }

  function update(dt, T, p) {
    if (!placed || (!p.boat && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) > 14)) {   // (it waits on the shore while you row)   // first frame, or the player jumped away
      const a = Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)) + 2.4;
      let x = p.pos.x + Math.cos(a) * 1.4, z = p.pos.z + Math.sin(a) * 1.4;
      if (!walkable(x, z)) { x = p.pos.x + 0.6; z = p.pos.z + 0.6; }
      place(x, z);
    }
    modeT += dt;
    const near = Math.max(0.55, 1.6 - bond * 0.04);                // a closer friend sits closer
    // where it wants to be: beside the player when they sit, a little behind and to the side otherwise
    const side = -1;                                              // the side away from the lantern hand, where the camera sees it
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = -fz, rz = fx;
    let tx, tz;
    if (p.sitting || p.busy) { tx = p.pos.x + rx * 0.8 * side + fx * 0.25; tz = p.pos.z + rz * 0.8 * side + fz * 0.25; }
    else { tx = p.pos.x + fx * (1.3 - near) + rx * (0.5 + near) * side; tz = p.pos.z + fz * (1.3 - near) + rz * (0.5 + near) * side; }   // alongside, a little ahead
    const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
    const go = d > (p.sitting || p.busy ? 0.25 : p.moving ? 0.9 : 1.8);
    const want = go ? Math.min(3.6, 1.2 + d * 1.1) : 0;            // trots to catch up
    speed = ease(speed, want, Math.min(1, dt * 5));
    if (speed > 0.05 && d > 0.05) {
      const nx = pos.x + (dx / d) * speed * dt, nz = pos.z + (dz / d) * speed * dt;
      if (walkable(nx, nz)) { pos.x = nx; pos.z = nz; } else speed *= 0.5;
      yaw = wrap(yaw + wrap(Math.atan2(-dx, -dz) - yaw) * Math.min(1, dt * 8));
      mode = 'walk'; modeT = 0;
    } else if (mode === 'walk') { mode = 'sit'; modeT = 0; }
    pos.y = groundY(pos.x, pos.z);
    // settled: face the lake if the player is launching or sitting, otherwise glance at the player now and then
    if (mode !== 'walk') {
      const lake = Math.atan2(-(shore.LAKE.cx - pos.x), -(shore.LAKE.cz - pos.z));
      const toP = Math.atan2(-(p.pos.x - pos.x), -(p.pos.z - pos.z));
      const face = p.busy || p.sitting ? lake : (Math.sin(T * 0.21) > 0.3 ? toP : yaw);
      yaw = wrap(yaw + wrap(face - yaw) * Math.min(1, dt * 1.5));
      lookYaw = ease(lookYaw, Math.max(-0.7, Math.min(0.7, wrap(toP - yaw))) * (Math.sin(T * 0.37) > 0 ? 1 : 0), Math.min(1, dt * 3));
    } else lookYaw = ease(lookYaw, 0, Math.min(1, dt * 4));
    root.position.copy(pos); root.rotation.y = yaw;

    // --- pose
    const walk = Math.min(1, speed / 1.2);
    phase += dt * (3 + speed * 5.5);
    loaf = ease(loaf, mode !== 'walk' && (p.sitting || modeT > 14) ? 1 : 0, Math.min(1, dt * 2));       // curled up
    const sitK = mode !== 'walk' ? (1 - loaf) : 0;                  // sitting upright
    groom = ease(groom, mode !== 'walk' && !p.sitting && (modeT % 9) > 6.5 ? 1 : 0, Math.min(1, dt * 3));
    legs.forEach((g, i) => {
      const front = i < 2, s = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI));
      g.rotation.x = s * 0.6 * walk + (front ? 0 : sitK * 1.3) - loaf * (front ? 1.2 : -1.2) * 0.9;
      g.scale.y = 1 - loaf * 0.5;
    });
    body.position.y = 0.2 + Math.abs(Math.sin(phase)) * 0.02 * walk - loaf * 0.11 - sitK * 0.02;
    body.rotation.x = -sitK * 0.55 + loaf * 0.0;                    // sitting: haunches down, chest up
    head.rotation.x = sitK * 0.45 + groom * 0.6 + Math.sin(T * 0.8) * 0.04;
    head.rotation.y = lookYaw + groom * Math.sin(T * 6) * 0.25;
    head.position.y = 0.1 - loaf * 0.03;
    // tail: up and swaying when walking, wrapped round when curled, a lazy flick when sitting
    tail.forEach((g, i) => {
      const sway = Math.sin(T * (walk > 0.2 ? 6 : 1.6) - i * 0.6) * (0.12 + 0.1 * walk);
      g.rotation.x = i === 0 ? -0.6 - 0.6 * walk + loaf * 1.4 + sitK * 0.9 : -0.12 * (1 - loaf) + loaf * 0.1;
      g.rotation.z = sway + loaf * 0.42;
    });
    // blink now and then
    blink -= dt; const closed = blink < 0.12 && blink > 0;
    if (blink < 0) blink = 2 + (((Math.sin(T * 12.9898) * 43758.5453) % 1 + 1) % 1) * 4;   // no Math.random in game code
    eyes.forEach((e) => { e.scale.y = closed || loaf > 0.8 ? 0.2 : 1.25; });
    // the petting ♡
    const pt = T - petT;
    heart.visible = pt < 1.6; if (heart.visible) { heart.position.set(0, 0.55 + pt * 0.35, 0); heart.material.opacity = Math.min(1, pt * 5) * (1 - Math.max(0, pt - 1) / 0.6); }
    update.T = T;
  }

  const tmp = new THREE.Vector3();
  return {
    root, pos,
    get curled() { return loaf > 0.6; },
    set bond(b) { bond = b; },
    update,
    // tap test in screen space: generous for a small animal
    screenHit(camera, x, y, w, h) {
      tmp.set(pos.x, pos.y + 0.25, pos.z);
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera); if (tmp.z > 1) return false;
      const sx = (tmp.x * 0.5 + 0.5) * w, sy = (-tmp.y * 0.5 + 0.5) * h;
      const focal = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
      return Math.hypot(sx - x, sy - y) < Math.max(26, (0.35 * focal) / dist + 10);
    },
    pet() { petT = update.T || 0; mode = mode === 'walk' ? mode : 'sit'; modeT = 0; },
  };
}
