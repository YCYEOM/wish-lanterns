// The walker: a small hooded traveller carrying a paper lantern, its movement (keys or a tap on
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
//
// The figure is built facing -z (yaw 0). Only its Lambert parts take light (moon, sky, its own
// lantern); the paper of the lantern is unlit and glows.
import * as THREE from '../vendor/three.module.js';

const SPEED = 4.2;
const NEAR_WATER = 3.5;
const SCALE = 1.22;

function tag(o, t) { o.userData.tag = t; return o; }

// little actions (emotes): one-shot gestures with how long they last, and sitting (held until you move)
export const EMOTES = { wave: 2.2, bow: 1.8, jump: 1.25, heart: 2.4 };
// a small emoji that floats up over the head for each gesture, drawn once per emoji
const EMOJI = { wave: '👋', bow: '🙇', jump: '🎉', heart: '💕' };
const emojiTex = {};
function emojiTexture(ch) {
  if (emojiTex[ch]) return emojiTex[ch];
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d'); g.font = '72px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 48, 54);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (emojiTex[ch] = t);
}

// opts.remote: another player's character (no scene lights of its own, a scarf colour of its own)
export function createWalker(scene, shore, glowTex, opts = {}) {
  const { LAKE, groundY, walkable, waterDist } = shore;
  const root = new THREE.Group();
  root.userData.tag = 'player';
  scene.add(root);
  const fig = new THREE.Group(); fig.scale.setScalar(SCALE); root.add(fig);

  // --- palette: a cream cloak with a gold hem, coral scarf, indigo trousers ---
  const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const cloakMat = lam(0xffffff, { vertexColors: true, side: THREE.DoubleSide, emissive: 0x2c2117 });
  const hoodMat = lam(0xeadfca, { emissive: 0x2c2117 });
  const hoodIn = lam(0x2a2238, { side: THREE.BackSide });
  const skin = lam(0xf6d2b4);
  const cheek = lam(0xf29a8c);
  const eyeM = lam(0x241a26);
  const pants = lam(0x39406a);
  const boots = lam(0x4a3428);
  const scarfMat = lam(opts.scarf ?? 0xf07a5e, { side: THREE.DoubleSide });
  const gold = lam(0xd9a74a);
  const wood = lam(0x3b2a22);

  // body pivots at the hips; everything above bobs and leans with it
  const body = new THREE.Group(); body.position.y = 0.5; fig.add(body);

  // legs (pivot at the hip), short and rounded, with little boots that point forward
  function leg(side) {
    const g = new THREE.Group(); g.position.set(0.085 * side, 0, 0);
    // thigh, then a knee joint carrying the shin and boot (bent only when kneeling)
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.22, 7), pants); thigh.position.y = -0.1; g.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.2; g.add(knee);
    const kj = new THREE.Mesh(new THREE.SphereGeometry(0.064, 7, 5), pants); knee.add(kj);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.06, 0.18, 7), pants); shin.position.y = -0.09; knee.add(shin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.19), boots); boot.position.set(0, -0.23, -0.03); knee.add(boot);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.062, 7, 5), boots); cap.position.set(0, -0.2, 0.02); knee.add(cap);
    g.userData.knee = knee;
    body.add(g);
    return g;
  }
  const legL = leg(-1), legR = leg(1);

  // torso under the cloak (seen only between the hem and the legs)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 8), pants); torso.position.y = 0.25; body.add(torso);

  // --- the cloak: a flared cone whose vertices are pushed every frame (flare, sway, ripple) ---
  const CN = 16, CM = 7; // around, down
  const cloakGeo = new THREE.BufferGeometry();
  const cPos = new Float32Array(CN * CM * 3), cCol = new Float32Array(CN * CM * 3);
  const cBase = []; // per vertex: angle, t
  const cream = new THREE.Color(0xf1e6d2), shade = new THREE.Color(0xc9bba6), band = new THREE.Color(0xd9a74a), tmpC = new THREE.Color();
  for (let j = 0; j < CM; j++) for (let i = 0; i < CN; i++) {
    const k = j * CN + i, t = j / (CM - 1), a = (i / CN) * Math.PI * 2;
    cBase.push(a, t);
    if (j === CM - 1) tmpC.copy(band); else tmpC.copy(cream).lerp(shade, t * 0.55 * (0.5 + 0.5 * Math.cos(a)));
    cCol[k * 3] = tmpC.r; cCol[k * 3 + 1] = tmpC.g; cCol[k * 3 + 2] = tmpC.b;
  }
  const cIdx = [];
  for (let j = 0; j < CM - 1; j++) for (let i = 0; i < CN; i++) {
    const a = j * CN + i, b = j * CN + (i + 1) % CN, c = (j + 1) * CN + i, d = (j + 1) * CN + (i + 1) % CN;
    cIdx.push(a, c, b, b, c, d);
  }
  cloakGeo.setIndex(cIdx);
  cloakGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
  cloakGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
  const cloak = tag(new THREE.Mesh(cloakGeo, cloakMat), 'player-cloak'); cloak.frustumCulled = false; body.add(cloak);
  // a rounded mantle over the shoulders
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hoodMat);
  mantle.scale.set(1.08, 0.55, 0.95); mantle.position.y = 0.5; body.add(mantle);

  function shapeCloak(flare, sway, ripple, T, breathe) {
    for (let k = 0; k < CN * CM; k++) {
      const a = cBase[k * 2], t = cBase[k * 2 + 1];
      const t2 = t * t;
      const back = 0.5 + 0.5 * Math.cos(a);        // 1 at the back (+z), 0 at the front
      let r = 0.17 + 0.25 * Math.pow(t, 0.85) + breathe * (1 - t);
      r *= 1 + t2 * (0.05 * Math.sin(a * 3 + T * 2.1) + ripple * 0.09 * Math.sin(a * 4 - T * 9));
      let x = Math.sin(a) * r, z = Math.cos(a) * r;
      let y = 0.52 - 0.6 * t;
      z += t2 * flare * (0.12 + 0.3 * back);       // trails behind when walking
      y += t2 * flare * 0.16 * back;
      x += t2 * sway;
      y += t2 * 0.02 * Math.sin(a * 5 + T * 1.7);
      cPos[k * 3] = x; cPos[k * 3 + 1] = y; cPos[k * 3 + 2] = z;
    }
    cloakGeo.attributes.position.needsUpdate = true;
  }

  // --- head under the hood ---
  const head = new THREE.Group(); head.position.y = 0.72; body.add(head);
  const face = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 2), skin); face.scale.set(1, 0.96, 0.98); head.add(face);
  const eyeGeo = new THREE.SphereGeometry(0.028, 6, 5);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeM); e.scale.set(0.8, 1.25, 0.5); e.position.set(0.072 * s, -0.005, -0.186); head.add(e);
    const c = new THREE.Mesh(eyeGeo, cheek); c.scale.set(1.2, 0.7, 0.4); c.position.set(0.115 * s, -0.06, -0.16); head.add(c);
  }
  // hood: closed on top, open in front of the face; a dark lining shows inside the opening
  const HR = 0.25, OPEN = 1.7;
  const hoodTop = new THREE.Mesh(new THREE.SphereGeometry(HR, 14, 4, 0, Math.PI * 2, 0, Math.PI * 0.3), hoodMat);
  const hoodLow = new THREE.Mesh(new THREE.SphereGeometry(HR, 14, 6, Math.PI * 1.5 + OPEN / 2, Math.PI * 2 - OPEN, Math.PI * 0.3, Math.PI * 0.5), hoodMat);
  const lining = new THREE.Mesh(new THREE.SphereGeometry(HR * 0.97, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.8), hoodIn);
  const hood = new THREE.Group(); hood.position.set(0, 0.025, 0.02); hood.add(hoodTop, hoodLow, lining); head.add(hood);
  // the Sky-like pointed tip of the hood, drooping back
  const tipGeo = new THREE.ConeGeometry(0.1, 0.3, 7); tipGeo.translate(0, 0.15, 0);
  const tip = new THREE.Mesh(tipGeo, hoodMat); tip.position.set(0, 0.12, 0.16); tip.rotation.x = 1.95; hood.add(tip);
  // a little gold clasp at the throat
  const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), gold); clasp.position.set(0, 0.5, -0.2); body.add(clasp);

  // --- the scarf: a ring at the neck and two tails of linked segments that trail and flutter ---
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.055, 6, 12), scarfMat);
  scarfRing.rotation.x = Math.PI / 2; scarfRing.position.y = 0.53; body.add(scarfRing);
  const SEG = 5, SEGL = 0.12;
  const segGeo = new THREE.BoxGeometry(0.1, SEGL, 0.02); segGeo.translate(0, -SEGL / 2, 0);
  const tails = [];
  for (const s of [-1, 1]) {
    const chain = [];
    let parent = new THREE.Group(); parent.position.set(0.055 * s, 0.53, 0.2); body.add(parent);
    for (let n = 0; n < SEG; n++) {
      const g = new THREE.Group(); if (n) g.position.y = -SEGL;
      const m = new THREE.Mesh(segGeo, scarfMat); m.scale.x = 1 - n * 0.07; g.add(m);
      parent.add(g); chain.push(g); parent = g;
    }
    tails.push({ s, chain });
  }

  // --- arms in wide sleeves, mitten hands ---
  function arm(side) {
    const g = new THREE.Group(); g.position.set(0.19 * side, 0.46, 0);
    const sleeveGeo = new THREE.CylinderGeometry(0.05, 0.085, 0.32, 7); sleeveGeo.translate(0, -0.16, 0);
    g.add(new THREE.Mesh(sleeveGeo, hoodMat));
    const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.052, 1), skin); hand.position.y = -0.36; g.add(hand);
    body.add(g);
    return g;
  }
  const armL = arm(-1), armR = arm(1);

  // --- the paper lantern, hanging on a short cord from the right hand ---
  // a short wooden staff in the hand, tilted out and forward; the lantern dangles from its tip
  const staff = new THREE.Group(); staff.position.set(0, -0.36, 0); armR.add(staff);
  const staffGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.42, 5); staffGeo.translate(0, 0.21, 0);
  staff.add(new THREE.Mesh(staffGeo, wood));
  const lantern = tag(new THREE.Group(), 'player-lantern'); lantern.position.set(0, 0.42, 0); staff.add(lantern);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), wood); cord.position.y = -0.05; lantern.add(cord);
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.035 + 0.075 * Math.sin(t * Math.PI), -0.2 * t)); }
  const paperGeo = new THREE.LatheGeometry(pts, 10);
  { // faint vertical ribs: every other column a touch deeper in colour
    const n = paperGeo.attributes.position.count, col = new Float32Array(n * 3), c1 = new THREE.Color(0xffb35c), c2 = new THREE.Color(0xff8f3e);
    for (let v = 0; v < n; v++) { const c = Math.floor(v / 9) % 2 ? c1 : c2; col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
    paperGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const paper = new THREE.Mesh(paperGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }));
  paper.position.y = -0.1; lantern.add(paper);
  const capT = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 8), wood); capT.position.y = -0.1; lantern.add(capT);
  const capB = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.03, 8), wood); capB.position.y = -0.3; lantern.add(capB);
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 5), scarfMat); tassel.position.y = -0.36; tassel.rotation.x = Math.PI; lantern.add(tassel);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.85 }));
  glow.scale.setScalar(1.7); glow.position.y = -0.2; lantern.add(glow);
  const light = new THREE.PointLight(0xffaa55, 2.2, 7, 1.6); light.position.y = -0.2; lantern.add(light);
  // soft moon/sky light for the lit materials (the rest of the world uses its own shaders)
  if (!opts.remote) {
    const hemi = new THREE.HemisphereLight(0x8090d0, 0x201828, 0.9); scene.add(hemi);
    const moon = new THREE.DirectionalLight(0xaab8ff, 0.6); moon.position.set(-30, 60, -40); scene.add(moon);
  }

  // --- motion state ---
  const pos = new THREE.Vector3();
  const vel = { x: 0, z: 0 };
  let yaw = 0, turnRate = 0, phase = 0, walkAmt = 0, moving = false, target = null, onArrive = null;
  let swing = 0, swingV = 0;                // lantern pendulum (radians, forward/back)
  let lastVx = 0, lastVz = 0, idleT = 0, flareS = 0, raise = 0;
  const tailLag = [0, 0];
  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
  // hand-turned view: yaw swings the camera round the character (0 = behind it, facing the lake),
  // pitch raises it (+) or brings it down toward eye level (-); both eased toward the wanted values
  const view = { yaw: 0, pitch: 0, wYaw: 0, wPitch: 0 };
  const YAW_MAX = 2.4, PITCH_MIN = -0.55, PITCH_MAX = 0.6;
  function viewDir() {                   // unit {x, z}: where the camera looks (the lake direction turned by the view yaw)
    const f = lakeDir(), c = Math.cos(view.yaw), s = Math.sin(view.yaw);
    return { x: f.x * c - f.z * s, z: f.x * s + f.z * c };
  }
  // launch ceremony: kneel to set a lantern on the water, or lift it overhead for the sky
  // { mode, t, dur } while running; poses come from the two eased amounts below
  let cer = null, kneel = 0, lift = 0;
  // emotes: { kind, t, dur } while one runs; sitting eases in and out through sitAmt
  let emo = null, sitting = false, sitAmt = 0;
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
  bubble.scale.setScalar(0.62); bubble.visible = false; bubble.renderOrder = 5; root.add(bubble);
  const CER = { water: { dur: 3.6, release: 1.7 }, sky: { dur: 3.0, release: 1.35 } };
  const smooth = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

  function lakeDir() {
    const dx = LAKE.cx - pos.x, dz = LAKE.cz - pos.z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }
  // move, or slide along whatever edge is in the way (water line, back of the beach, a stone lantern):
  // try the step turned a little either way, shortened by how far it is turned, before giving up
  const SLIDE = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.35, 1.57];
  let slideSide = 1;
  function tryMove(nx, nz) {
    if (walkable(nx, nz)) { pos.x = nx; pos.z = nz; return true; }
    const dx = nx - pos.x, dz = nz - pos.z;
    for (const a of SLIDE) {
      const k = 0.45 + 0.55 * Math.cos(a);   // keep most of the pace while sliding round a curve
      for (const sgn of [slideSide, -slideSide]) {
        const c = Math.cos(a * sgn), sn = Math.sin(a * sgn);
        const tx = pos.x + (dx * c - dz * sn) * k, tz = pos.z + (dx * sn + dz * c) * k;
        if (!walkable(tx, tz)) continue;
        // a square-on turn only to climb back toward dry land (out of the corner where the pier meets the
        // water); pushing straight at the water's edge or the back of the beach should stop, not drift
        if (a > 1.4 && waterDist(tx, tz) <= waterDist(pos.x, pos.z) + 0.005) continue;
        pos.x = tx; pos.z = tz; slideSide = sgn; return true;
      }
    }
    return false;
  }
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function animate(dt, T) {
    const speed = Math.hypot(vel.x, vel.z);
    const wa = Math.min(1, speed / SPEED);
    walkAmt += (wa - walkAmt) * Math.min(1, dt * 8);
    phase += dt * (2.0 + speed * 2.1);
    idleT = walkAmt < 0.05 ? idleT + dt : 0;
    const s = Math.sin(phase), c = Math.cos(phase);
    const w = walkAmt;

    // forward acceleration in the character's own frame (for the lantern and the cloak)
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ax = dt > 0 ? (vel.x - lastVx) / dt : 0, az = dt > 0 ? (vel.z - lastVz) / dt : 0;
    lastVx = vel.x; lastVz = vel.z;
    const aFwd = ax * fx + az * fz;

    // legs and arms
    legL.rotation.x = s * 0.75 * w; legR.rotation.x = -s * 0.75 * w;
    // a little knee bend on the back-swing of each stride
    legL.userData.knee.rotation.x = -Math.max(0, -s) * 0.5 * w; legR.userData.knee.rotation.x = -Math.max(0, s) * 0.5 * w;
    const breathe = Math.sin(T * 1.9) * (1 - w);
    armL.rotation.x = -s * 0.6 * w + breathe * 0.03;
    armL.rotation.z = -0.18 - 0.05 * w;
    // the lantern arm: held a little out and forward; at the water's edge, standing, it lifts toward the lake
    const near = waterDist(pos.x, pos.z) < NEAR_WATER;
    raise += ((near && w < 0.1 && idleT > 0.6 ? 1 : 0) - raise) * Math.min(1, dt * 2.5);
    armR.rotation.x = 0.35 + s * 0.22 * w + raise * 0.8;
    armR.rotation.z = 0.42 + raise * 0.05;
    // ceremony poses on top: kneel (both hands reach down and forward) or lift (both hands overhead)
    if (cer) {
      cer.t += dt;
      const c = CER[cer.mode], t = cer.t;
      if (cer.mode === 'water') { kneel = smooth(0, 0.8, t) * (1 - smooth(c.dur - 0.9, c.dur, t)); lift = 0; }
      else { lift = smooth(0, 0.85, t) * (1 - smooth(c.release + 0.7, c.dur, t)); kneel = 0; }
      if (t >= c.dur) { cer = null; kneel = lift = 0; }
    }
    if (kneel > 0 || lift > 0) {
      raise *= 1 - Math.min(1, dt * 6);
      const reach = cer && cer.mode === 'water' ? smooth(0.7, 1.6, cer.t) : 0;   // hands go down to the water
      armL.rotation.x = armL.rotation.x * (1 - kneel - lift) + kneel * (0.45 + reach * 0.3) + lift * 2.95;
      armL.rotation.z = armL.rotation.z * (1 - kneel - lift) + (kneel * 0.32 - lift * 0.4);
      armR.rotation.x = armR.rotation.x * (1 - kneel - lift) + kneel * (0.45 + reach * 0.3) + lift * 2.95;
      armR.rotation.z = armR.rotation.z * (1 - kneel - lift) + (kneel * -0.32 + lift * 0.4);
      // one-knee kneel: front thigh level and shin straight down; back thigh down, knee on the ground, shin trailing
      // (the body leans forward by `lean`, which the hips undo so the legs stay true to the ground)
      const lean = 0.35 * kneel;
      legL.rotation.x = legL.rotation.x * (1 - kneel) + 1.5 * kneel + lean; legL.userData.knee.rotation.x = -1.5 * kneel;
      legR.rotation.x = legR.rotation.x * (1 - kneel) - 0.15 * kneel + lean; legR.userData.knee.rotation.x = -1.45 * kneel;
    }

    // emotes on top of everything else
    sitAmt += ((sitting ? 1 : 0) - sitAmt) * Math.min(1, dt * 3.5);
    let wave = 0, bow = 0, heart = 0, jump = 0, hopY = 0;
    if (emo) {
      emo.t += dt;
      const t = emo.t, D = emo.dur, env = smooth(0, 0.3, t) * (1 - smooth(D - 0.35, D, t));
      if (emo.kind === 'wave') wave = env;
      else if (emo.kind === 'heart') heart = env;
      else if (emo.kind === 'bow') bow = smooth(0, 0.45, t) * (1 - smooth(D - 0.7, D, t));
      else if (emo.kind === 'jump') { jump = env; hopY = t < 1.1 ? Math.sin(Math.PI * ((t % 0.55) / 0.55)) : 0; }
      // the emoji floats up and fades
      bubble.visible = true;
      bubble.position.y = 2.05 + Math.min(1, t / D) * 0.45 + hopY * 0.38;
      bubble.material.opacity = smooth(0, 0.2, t) * (1 - smooth(D - 0.5, D, t));
      if (t >= D) { emo = null; bubble.visible = false; }
    }
    const mix = (a, b, k) => a + (b - a) * k;
    if (sitAmt > 0.001) {                 // sit on the sand: legs out in front, a hand behind, looking up at the sky
      raise *= 1 - sitAmt;
      legL.rotation.x = mix(legL.rotation.x, 1.45, sitAmt); legR.rotation.x = mix(legR.rotation.x, 1.32, sitAmt);
      legL.userData.knee.rotation.x = mix(legL.userData.knee.rotation.x, -0.35, sitAmt);
      legR.userData.knee.rotation.x = mix(legR.userData.knee.rotation.x, -0.15, sitAmt);
      armL.rotation.x = mix(armL.rotation.x, -0.55, sitAmt); armL.rotation.z = mix(armL.rotation.z, -0.45, sitAmt);
    }
    if (wave > 0) {                       // the free hand up, waving side to side
      armL.rotation.x = mix(armL.rotation.x, 2.75, wave);
      armL.rotation.z = mix(armL.rotation.z, -0.35 + Math.sin(T * 11) * 0.38, wave);
    }
    if (heart > 0) {                      // both arms over the head, hands meeting: a heart
      armL.rotation.x = mix(armL.rotation.x, 2.7, heart); armL.rotation.z = mix(armL.rotation.z, 0.62, heart);
      armR.rotation.x = mix(armR.rotation.x, 2.7, heart); armR.rotation.z = mix(armR.rotation.z, -0.62, heart);
    }
    if (jump > 0) {                       // two happy hops, arms flung up
      armL.rotation.x = mix(armL.rotation.x, 2.5, jump); armL.rotation.z = mix(armL.rotation.z, -0.7, jump);
      armR.rotation.x = mix(armR.rotation.x, 2.2, jump);
      const tuck = hopY * jump * 0.5;
      legL.rotation.x += tuck; legR.rotation.x += tuck;
      legL.userData.knee.rotation.x -= tuck * 1.6; legR.userData.knee.rotation.x -= tuck * 1.6;
    }
    if (bow > 0) { armL.rotation.x = mix(armL.rotation.x, 0.25, bow); armL.rotation.z = mix(armL.rotation.z, 0.1, bow); }
    fig.position.y = hopY * 0.38;

    // body: bob twice per stride, roll into turns, lean into speed, breathe when still
    body.position.y = 0.5 + Math.abs(c) * 0.055 * w + breathe * 0.008 - kneel * 0.26 + lift * 0.03 - sitAmt * 0.36;
    body.rotation.x = -0.12 * w - Math.max(-0.1, Math.min(0.1, aFwd * 0.012)) - kneel * 0.35 + lift * 0.08 - bow * 0.75 + sitAmt * 0.12;
    body.rotation.z = s * 0.04 * w - Math.max(-0.25, Math.min(0.25, turnRate * 0.05)) * w;
    body.rotation.y = s * 0.08 * w;
    mantle.scale.y = 0.55 + breathe * 0.02;

    // head: steady when walking; idle, it glances along the lake and up at the sky lanterns
    const gl = Math.sin(T * 0.37) * 0.55 + Math.sin(T * 0.91 + 1.3) * 0.18;
    const up = Math.max(0, Math.sin(T * 0.23 + 0.6)) * 0.35;
    head.rotation.y = (gl * (1 - w) - body.rotation.y * 0.8);
    head.rotation.x = ((-up * (1 - w) + 0.06 * w) + breathe * 0.02) * (1 - kneel - lift) + kneel * 0.15 - lift * 0.55 + bow * 0.3 - sitAmt * 0.32 - heart * 0.15 - jump * 0.2;
    head.rotation.y *= 1 - kneel - lift;
    head.rotation.z = -body.rotation.z * 0.6 + wave * Math.sin(T * 3) * 0.12;

    // lantern pendulum: a damped spring the hand's motion and acceleration excite
    staff.rotation.z = -0.95 - armR.rotation.z;   // tip points out to the side and up
    staff.rotation.x = -0.25;
    const handA = -armR.rotation.x - body.rotation.x - staff.rotation.x;
    const k = 40, damp = 3.2;
    swingV += (-k * swing - damp * swingV + aFwd * 0.9 + s * 1.6 * w) * dt;
    swing += swingV * dt;
    lantern.rotation.x = handA + swing;
    lantern.rotation.z = -armR.rotation.z - staff.rotation.z - body.rotation.z + Math.sin(T * 1.3) * 0.04;

    // cloak and scarf trail behind with speed
    flareS += (w - flareS) * Math.min(1, dt * 3);
    shapeCloak(flareS, -s * 0.035 * w - turnRate * 0.012 * w, w, T, breathe * 0.006);
    for (let i = 0; i < 2; i++) {
      const tl = tails[i];
      tailLag[i] += (w - tailLag[i]) * Math.min(1, dt * (2.2 + i * 0.6));
      const lift = 0.5 + tailLag[i] * 0.8;
      tl.chain.forEach((g, n) => {
        const fl = Math.sin(T * (5.5 + i) - n * 0.9 + i * 1.7) * (0.12 + 0.22 * tailLag[i]);
        g.rotation.x = -(n ? lift * 0.18 : lift) + fl * (n ? 1 : 0.3);
        g.rotation.z = tl.s * 0.08 + Math.sin(T * 1.1 + n * 0.7 + i) * 0.06 + turnRate * 0.02 * n;
      });
    }

    // lantern flicker
    const fk = Math.sin(T * 7.3) + 0.5 * Math.sin(T * 13.1);
    glow.material.opacity = 0.78 + 0.07 * fk;
    light.intensity = 2.2 + 0.25 * fk + raise * 0.4;
  }

  const w = {
    pos,
    get yaw() { return yaw; },
    reset(x, z) {
      pos.set(x, groundY(x, z), z); yaw = Math.atan2(-lakeDir().x, -lakeDir().z);
      vel.x = vel.z = 0; lastVx = lastVz = 0; turnRate = 0; swing = swingV = 0; walkAmt = 0; flareS = 0; raise = 0; idleT = 0;
      target = null; onArrive = null; cam.init = false; cam.boom = undefined; moving = false; cer = null; kneel = lift = 0;
      emo = null; sitting = false; sitAmt = 0; bubble.visible = false; fig.position.y = 0;
      view.yaw = view.pitch = view.wYaw = view.wPitch = 0;
    },
    // start the launch pose; returns its timing { dur, release } (seconds)
    ceremony(mode) {
      target = null; onArrive = null; vel.x = vel.z = 0;
      const d = lakeDir(); yaw = Math.atan2(-d.x, -d.z);
      cer = { mode: mode === 'sky' ? 'sky' : 'water', t: 0 };
      emo = null; sitting = false; bubble.visible = false;
      return CER[cer.mode];
    },
    // a little action: 'wave' | 'bow' | 'jump' | 'heart' (one-shot), or 'sit' (toggles; moving stands up again)
    emote(kind) {
      if (cer) return false;
      if (kind === 'sit') { sitting = !sitting; emo = null; bubble.visible = false; target = null; onArrive = null; return true; }
      if (!EMOTES[kind]) return false;
      sitting = false;
      emo = { kind, t: 0, dur: EMOTES[kind] };
      bubble.material.map = emojiTexture(EMOJI[kind]); bubble.material.needsUpdate = true;
      return true;
    },
    setSitting(on) { if (!cer && sitting !== !!on) { sitting = !!on; if (on) emo = null; } },
    get sitting() { return sitting; },
    get emoting() { return emo ? emo.kind : null; },
    busy() { return !!cer; },
    // world point between the two hands (where a lantern being set down or lifted is held)
    hands(out = new THREE.Vector3()) {
      root.updateMatrixWorld(true);
      const a = new THREE.Vector3(0, -0.36, 0).applyMatrix4(armL.matrixWorld);
      const b = new THREE.Vector3(0, -0.36, 0).applyMatrix4(armR.matrixWorld);
      return out.addVectors(a, b).multiplyScalar(0.5);
    },
    get camLook() { return cam.look; },
    get timing() { return cer && { t: cer.t, ...CER[cer.mode] }; },
    walkTo(x, z, cb) {
      // clamp the goal onto the beach: step it back toward the character until it is walkable
      if (Math.hypot(x - pos.x, z - pos.z) > 0.3) sitting = false;   // walking off stands up
      let gx = x, gz = z;
      for (let i = 0; i < 40 && !walkable(gx, gz); i++) { gx += (pos.x - gx) * 0.12; gz += (pos.z - gz) * 0.12; }
      target = { x: gx, z: gz }; onArrive = cb || null;
    },
    stop() { target = null; onArrive = null; },
    lakeDir,
    viewDir,
    // turn the view by hand: dYaw/dPitch in radians; turnView(null) eases it back behind the character
    turnView(dYaw, dPitch = 0) {
      if (dYaw === null) { view.wYaw = 0; view.wPitch = 0; return; }
      view.wYaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, view.wYaw + dYaw));
      view.wPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, view.wPitch + dPitch));
    },
    get view() { return { yaw: +view.wYaw.toFixed(3), pitch: +view.wPitch.toFixed(3) }; },
    update(dt, keys, T) {
      const f = viewDir();                 // "forward" is where the camera looks (the lake, unless turned)
      const rx = -f.z, rz = f.x;           // screen-right
      let ix = 0, iz = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) { ix += f.x; iz += f.z; }
      if (keys.has('KeyS') || keys.has('ArrowDown')) { ix -= f.x; iz -= f.z; }
      if (keys.has('KeyD') || keys.has('ArrowRight')) { ix += rx; iz += rz; }
      if (keys.has('KeyA') || keys.has('ArrowLeft')) { ix -= rx; iz -= rz; }
      if (cer) ix = iz = 0;
      if (ix || iz) { target = null; onArrive = null; sitting = false; }
      else if (target) {
        const dx = target.x - pos.x, dz = target.z - pos.z, l = Math.hypot(dx, dz);
        if (l < 0.15) { const cb = onArrive; target = null; onArrive = null; if (cb) cb(); }
        else { ix = dx / l; iz = dz / l; if (l < 1.2) { const e = Math.max(0.18, l / 1.2); ix *= e; iz *= e; } }
      }
      const il = Math.hypot(ix, iz);
      const has = il > 0.01;
      // eased velocity: quick to start, a little softer to stop
      const kk = Math.min(1, il);
      const wx = has ? (ix / il) * SPEED * kk : 0, wz = has ? (iz / il) * SPEED * kk : 0;
      const e = 1 - Math.exp(-dt * (has ? 7 : 9));
      vel.x += (wx - vel.x) * e; vel.z += (wz - vel.z) * e;
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > 0.02) {
        const ok = tryMove(pos.x + vel.x * dt, pos.z + vel.z * dt);
        if (!ok) { vel.x *= 0.3; vel.z *= 0.3; if (target) { target = null; onArrive = null; } }
      } else { vel.x = vel.z = 0; }
      moving = has || sp > 0.25;
      // eased turning toward where it goes
      let tr = 0;
      if (has) {
        const want = Math.atan2(-ix, -iz);
        const d = wrap(want - yaw);
        const step = d * (1 - Math.exp(-dt * 9));
        yaw = wrap(yaw + step);
        tr = dt > 0 ? step / dt : 0;
      }
      turnRate += (tr - turnRate) * Math.min(1, dt * 6);
      pos.y = groundY(pos.x, pos.z);
      root.position.copy(pos);
      root.rotation.y = yaw;
      animate(dt, T);
      return moving;
    },
    updateCamera(camera, dt, look = { x: 0, y: 0 }) {
      const ve = 1 - Math.exp(-dt * 10);
      view.yaw += (view.wYaw - view.yaw) * ve; view.pitch += (view.wPitch - view.pitch) * ve;
      const f = viewDir();
      const rx = -f.z, rz = f.x;
      // behind and above the character, looking out over the lake; it stands in the lower-middle
      // third of the frame, well clear of the launch button at the bottom. Pitch lifts it higher and
      // closer to overhead, or lowers it to look up at the sky
      const back = 6.9 - view.pitch * 1.2, up = 3.8 + view.pitch * 4.2;
      const tilt = view.pitch < 0 ? -view.pitch * 9 : 0;   // looking up toward the sky lanterns
      const lean = Math.max(-1, Math.min(1, turnRate * 0.25)) * Math.min(1, Math.hypot(vel.x, vel.z) / SPEED);
      // turned round toward the beach the camera hangs out over the shallows: pull it in short of any tree
      // standing between it and the character
      let boom = back;
      const bx = -f.x, bz = -f.z;
      for (const o of shore.CAM_OBSTACLES) {
        const ox = o.x - pos.x, oz = o.z - pos.z, t = ox * bx + oz * bz;
        if (t < 0.5 || t > boom + o.r) continue;
        const side = Math.abs(ox * bz - oz * bx);
        if (side < o.r) boom = Math.max(4.2, Math.min(boom, t - Math.sqrt(o.r * o.r - side * side) - 0.3));
      }
      cam.boom = cam.boom === undefined ? boom : cam.boom + (boom - cam.boom) * (1 - Math.exp(-dt * (boom < cam.boom ? 12 : 3)));
      const want = new THREE.Vector3(pos.x - f.x * cam.boom + rx * (look.x * 1.2 - lean * 0.4), 0, pos.z - f.z * cam.boom + rz * (look.x * 1.2 - lean * 0.4));
      const short = cam.boom / back;          // pulled in: come down with it so the character stays in frame
      want.y = Math.max(pos.y + up * (0.4 + 0.6 * short) - look.y * 0.6, groundY(want.x, want.z) + 1.2);
      const lookAt = new THREE.Vector3(pos.x + f.x * 10 + rx * look.x * 3, pos.y - 0.8 - look.y * 1.5 + tilt, pos.z + f.z * 10 + rz * look.x * 3);
      if (!cam.init) { cam.pos.copy(want); cam.look.copy(lookAt); cam.init = true; }
      const k = 1 - Math.exp(-dt * 4);
      cam.pos.lerp(want, k); cam.look.lerp(lookAt, 1 - Math.exp(-dt * 5));
      camera.position.copy(cam.pos);
      camera.lookAt(cam.look);
    },
    state() {
      const d = waterDist(pos.x, pos.z);
      return { x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), yaw: +yaw.toFixed(3), moving, nearWater: d < NEAR_WATER, waterDist: +d.toFixed(2), sitting, emote: emo ? emo.kind : null };
    },
    NEAR_WATER,
    // take this character out of the world (another player left)
    dispose() {
      scene.remove(root);
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    },
  };
  return w;
}
