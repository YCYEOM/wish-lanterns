// The walker: a small human-shaped character carrying a lantern, its movement (keys or a tap on
// the ground) and the camera that follows it. Owned by the "walker" part.
//
// API (frozen — main.js depends on it):
//   createWalker(scene, shore, glowTexture) -> walker
//   walker.pos                 THREE.Vector3 (feet, world space)
//   walker.yaw                 facing angle (radians, 0 = facing -z)
//   walker.reset(x, z)         place the character, standing still
//   walker.walkTo(x, z, onArrive?)  walk to a point (clamped to the beach); onArrive fires on arrival
//   walker.stop()              cancel a walk
//   walker.update(dt, keys, T) move (keys: Set of held key codes), animate; returns true while moving
//   walker.updateCamera(camera, dt, look) place the follow camera (look: {x,y} in -1..1 pointer offset)
//   walker.lakeDir()           unit {x, z} from the character toward the lake centre
//   walker.state()             { x, z, yaw, moving, nearWater, waterDist }
import * as THREE from '../vendor/three.module.js';

const SPEED = 4.2;
const NEAR_WATER = 3.5;

export function createWalker(scene, shore, glowTex) {
  const { LAKE, groundY, walkable, waterDist } = shore;
  const root = new THREE.Group();
  root.userData.tag = 'player';
  scene.add(root);

  // --- body (low-poly, lit by the moon and by its own lantern) ---
  const cloth = new THREE.MeshLambertMaterial({ color: 0x6b7fb8, flatShading: true });
  const cloak = new THREE.MeshLambertMaterial({ color: 0x3d4f86, flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf1c9a5, flatShading: true });
  const hair = new THREE.MeshLambertMaterial({ color: 0x3a2a24, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2433, flatShading: true });
  const scarf = new THREE.MeshLambertMaterial({ color: 0xe0705a, flatShading: true });

  const hips = new THREE.Group(); hips.position.y = 0.62; root.add(hips);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.62, 7), cloak); torso.position.y = 0.33; hips.add(torso);
  const scarfM = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.06, 5, 8), scarf); scarfM.rotation.x = Math.PI / 2; scarfM.position.y = 0.62; hips.add(scarfM);
  const head = new THREE.Group(); head.position.y = 0.86; hips.add(head);
  head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), skin));
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.215, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hairM.position.set(0, 0.03, 0.02); head.add(hairM);
  const eyeGeo = new THREE.SphereGeometry(0.025, 5, 4);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(eyeGeo, dark); e.position.set(0.07 * s, 0.0, -0.18); head.add(e); }

  function limb(len, w, mat) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(w, w * 0.85, len, 6), mat); m.position.y = -len / 2; g.add(m);
    return g;
  }
  const legL = limb(0.6, 0.075, dark), legR = limb(0.6, 0.075, dark);
  legL.position.set(-0.1, 0.02, 0); legR.position.set(0.1, 0.02, 0); hips.add(legL, legR);
  const armL = limb(0.48, 0.06, cloth), armR = limb(0.48, 0.06, cloth);
  armL.position.set(-0.27, 0.58, 0); armR.position.set(0.27, 0.58, 0); hips.add(armL, armR);

  // the lantern it carries, hanging from the right hand
  const lantern = new THREE.Group(); lantern.position.set(0, -0.5, -0.06); armR.add(lantern);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), new THREE.MeshBasicMaterial({ color: 0xffc37a }));
  paper.position.y = -0.12; lantern.add(paper);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), dark); handle.position.y = 0.0; lantern.add(handle);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.85 }));
  glow.scale.setScalar(1.6); glow.position.y = -0.12; lantern.add(glow);
  const light = new THREE.PointLight(0xffaa55, 2.2, 7, 1.6); light.position.y = -0.1; lantern.add(light);
  // soft moon/sky light for the lit materials (the rest of the world uses its own shaders)
  const hemi = new THREE.HemisphereLight(0x8090d0, 0x201828, 0.9); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xaab8ff, 0.6); moon.position.set(-30, 60, -40); scene.add(moon);

  const pos = new THREE.Vector3();
  let yaw = 0, phase = 0, moving = false, target = null, onArrive = null;
  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };

  function lakeDir() {
    const dx = LAKE.cx - pos.x, dz = LAKE.cz - pos.z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }
  function tryMove(nx, nz) {
    if (walkable(nx, nz)) { pos.x = nx; pos.z = nz; return true; }
    if (walkable(nx, pos.z)) { pos.x = nx; return true; }
    if (walkable(pos.x, nz)) { pos.z = nz; return true; }
    return false;
  }

  const w = {
    pos,
    get yaw() { return yaw; },
    reset(x, z) { pos.set(x, groundY(x, z), z); yaw = Math.atan2(-lakeDir().x, -lakeDir().z); target = null; onArrive = null; cam.init = false; },
    walkTo(x, z, cb) {
      // clamp the goal onto the beach: step it back toward the character until it is walkable
      let gx = x, gz = z;
      for (let i = 0; i < 40 && !walkable(gx, gz); i++) { gx += (pos.x - gx) * 0.12; gz += (pos.z - gz) * 0.12; }
      target = { x: gx, z: gz }; onArrive = cb || null;
    },
    stop() { target = null; onArrive = null; },
    lakeDir,
    update(dt, keys, T) {
      const f = lakeDir();                 // "forward" is toward the lake, as the camera looks
      const rx = -f.z, rz = f.x;           // screen-right
      let ix = 0, iz = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) { ix += f.x; iz += f.z; }
      if (keys.has('KeyS') || keys.has('ArrowDown')) { ix -= f.x; iz -= f.z; }
      if (keys.has('KeyD') || keys.has('ArrowRight')) { ix += rx; iz += rz; }
      if (keys.has('KeyA') || keys.has('ArrowLeft')) { ix -= rx; iz -= rz; }
      if (ix || iz) { target = null; onArrive = null; }
      else if (target) {
        const dx = target.x - pos.x, dz = target.z - pos.z, l = Math.hypot(dx, dz);
        if (l < 0.15) { const cb = onArrive; target = null; onArrive = null; if (cb) cb(); }
        else { ix = dx / l; iz = dz / l; if (l < 0.6) { ix *= l / 0.6; iz *= l / 0.6; } }
      }
      const il = Math.hypot(ix, iz);
      moving = il > 0.01;
      if (moving) {
        const k = Math.min(1, il);
        const ok = tryMove(pos.x + (ix / il) * SPEED * k * dt, pos.z + (iz / il) * SPEED * k * dt);
        if (!ok && target) { target = null; onArrive = null; }
        const want = Math.atan2(-ix, -iz);
        let d = want - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 10);
      }
      pos.y = groundY(pos.x, pos.z);
      phase += dt * (moving ? 9 : 0);
      const s = moving ? Math.sin(phase) : 0;
      const breathe = Math.sin(T * 2) * 0.012;
      legL.rotation.x = s * 0.7; legR.rotation.x = -s * 0.7;
      armL.rotation.x = -s * 0.5; armR.rotation.x = s * 0.25 - 0.15;
      lantern.rotation.x = -armR.rotation.x + Math.sin(T * 3) * 0.08;
      hips.position.y = 0.62 + (moving ? Math.abs(Math.cos(phase)) * 0.05 : breathe);
      torso.rotation.z = moving ? Math.sin(phase) * 0.04 : 0;
      head.rotation.y = moving ? 0 : Math.sin(T * 0.4) * 0.25;
      root.position.copy(pos);
      root.rotation.y = yaw;
      glow.material.opacity = 0.75 + 0.1 * Math.sin(T * 7.3) + 0.05 * Math.sin(T * 13.1);
      light.intensity = 2.0 + 0.3 * Math.sin(T * 7.3);
      return moving;
    },
    updateCamera(camera, dt, look = { x: 0, y: 0 }) {
      const f = lakeDir();
      const rx = -f.z, rz = f.x;
      const back = 8.5, up = 5.2;
      const want = new THREE.Vector3(pos.x - f.x * back + rx * look.x * 1.2, 0, pos.z - f.z * back + rz * look.x * 1.2);
      want.y = Math.max(pos.y + up - look.y * 0.6, groundY(want.x, want.z) + 1.2);
      const lookAt = new THREE.Vector3(pos.x + f.x * 9 + rx * look.x * 3, pos.y - 0.6 - look.y * 1.5, pos.z + f.z * 9 + rz * look.x * 3);
      if (!cam.init) { cam.pos.copy(want); cam.look.copy(lookAt); cam.init = true; }
      const k = 1 - Math.exp(-dt * 4);
      cam.pos.lerp(want, k); cam.look.lerp(lookAt, k);
      camera.position.copy(cam.pos);
      camera.lookAt(cam.look);
    },
    state() {
      const d = waterDist(pos.x, pos.z);
      return { x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), yaw: +yaw.toFixed(3), moving, nearWater: d < NEAR_WATER, waterDist: +d.toFixed(2) };
    },
    NEAR_WATER,
  };
  return w;
}
