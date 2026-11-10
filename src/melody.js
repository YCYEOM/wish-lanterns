// The lake's secret song: each Seoul day the singing stones hide a five-note melody. Five little mounds of
// glinting sand along the beach hold a folded note each; digging one up tells one note of today's song
// (which stone, in which place). Play all five on the stones, in order, and the lake answers.
// Everyone gets the same song and the same mounds on the same day (a hash of the day, no Math.random).
//
//   const m = createMelody(scene, shore, glowTex, { dayNum, dug })
//   m.song            [5 stone indices]
//   m.spots           [{ x, z, i, dug }]   i = the place in the song this mound's note tells
//   m.nearest(pos, r) -> the undug spot within r, or null
//   m.dig(spot)       start the dig animation (sand flies, the mound opens, a note rises)
//   m.update(dt, T)
//   m.match(seq)      true when seq ends with today's song
import * as THREE from '../vendor/three.module.js';

export const SONG_LEN = 5;
export const seoulDay = (ms) => Math.floor((ms + 9 * 3600 * 1000) / 864e5);
function hash(n, k) { let h = (n * 374761393 + k * 668265263 + 0x9e3779b9) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export function songOf(day) {
  const s = [];
  for (let i = 0; s.length < SONG_LEN; i++) {
    const n = Math.floor(hash(day, 10 + i) * 7);
    if (s.length && n === s[s.length - 1]) continue;   // never the same stone twice running
    s.push(n);
  }
  return s;
}

export function createMelody(scene, shore, glowTex, opts = {}) {
  const day = opts.dayNum, song = songOf(day);
  const group = new THREE.Group(); group.userData.tag = 'dig-spots'; scene.add(group);
  const avoid = (opts.avoid || []);
  // five mounds spread along the beach, one per stretch so they never bunch up; clear of the stones, the fire,
  // the pier and each other, on sand you can stand on
  const spots = [];
  const stretches = [[-30, -18], [-17, -7], [-6, 4], [5, 14], [16, 28]];
  for (let k = 0; k < SONG_LEN; k++) {
    let p = null;
    for (let tries = 0; tries < 40 && !p; tries++) {
      const [a, b] = stretches[k];
      const x = a + (b - a) * hash(day, 100 + k * 50 + tries), d = 2.2 + 5 * hash(day, 200 + k * 50 + tries);
      const q = shore.nearestShore(x, 14, d);
      if (!shore.walkable(q.x, q.z) || !shore.walkable(q.x + 0.8, q.z) || !shore.walkable(q.x - 0.8, q.z)) continue;
      if (shore.nearPier(q.x, q.z) || shore.nearShoreLight(q.x, q.z, 1.6)) continue;
      if (avoid.some(o => Math.hypot(o.x - q.x, o.z - q.z) < (o.r || 2.2))) continue;
      p = q;
    }
    if (!p) p = shore.nearestShore(stretches[k][0] + 4, 14, 4);
    spots.push({ x: p.x, z: p.z, y: shore.groundY(p.x, p.z), dug: false });
  }
  // which mound tells which note: shuffled by the day, so the nearest one isn't always the first note
  const order = [0, 1, 2, 3, 4];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(hash(day, 300 + i) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  spots.forEach((s, k) => { s.i = order[k]; s.dug = !!(opts.dug && opts.dug[s.i]); });

  const sandM = new THREE.MeshLambertMaterial({ color: 0xe8cc98, flatShading: true, emissive: 0x5a4426 });
  const holeM = new THREE.MeshBasicMaterial({ color: 0x1a140e, transparent: true, opacity: 0.75, depthWrite: false });
  const moundG = new THREE.SphereGeometry(0.42, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2); moundG.scale(1, 0.32, 0.85);
  const holeG = new THREE.CircleGeometry(0.34, 14); holeG.rotateX(-Math.PI / 2);
  const pileG = new THREE.SphereGeometry(0.22, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2); pileG.scale(1.2, 0.4, 0.9);
  const cornerG = new THREE.PlaneGeometry(0.16, 0.12), cornerM = new THREE.MeshBasicMaterial({ color: 0xd8ccb0, side: THREE.DoubleSide });
  const grainM = new THREE.PointsMaterial({ color: 0xd9c49c, size: 0.06, transparent: true, opacity: 0.9, depthWrite: false });
  for (const s of spots) {
    const g = new THREE.Group(); g.position.set(s.x, s.y, s.z); g.rotation.y = hash(day, 400 + s.i) * 6.28; group.add(g);
    const mound = new THREE.Mesh(moundG, sandM); mound.position.y = -0.02; g.add(mound);
    // a corner of the folded note poking out of the sand
    const corner = new THREE.Mesh(cornerG, cornerM); corner.position.set(0.08, 0.13, 0.05); corner.rotation.set(-0.5, 0.6, 0.35); mound.add(corner);
    const hole = new THREE.Mesh(holeG, holeM); hole.position.y = 0.025; g.add(hole);
    const pile = new THREE.Mesh(pileG, sandM); pile.position.set(0.55, -0.02, 0.1); g.add(pile);
    // the glint: a small warm twinkle that blinks now and then (easy to miss, easy to spot once you know)
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glint.position.y = 0.2; g.add(glint);
    // the folded note that rises out of the hole when you dig
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), new THREE.MeshBasicMaterial({ color: 0xf4e8cc, side: THREE.DoubleSide, transparent: true, opacity: 0, fog: false }));
    paper.visible = false; g.add(paper);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    const grains = new THREE.Points(pg, grainM.clone()); grains.visible = false; g.add(grains);
    Object.assign(s, { g, mound, hole, pile, glint, paper, grains, digT: -1, ph: hash(day, 500 + s.i) * 10, vel: [] });
    setDug(s, s.dug);
  }
  function setDug(s, dug) { s.dug = dug; s.mound.visible = !dug; s.hole.visible = dug; s.pile.visible = dug; }

  return {
    song, spots, day, group,
    nearest(pos, r = 1.4) {
      let best = null, bd = r;
      for (const s of spots) { if (s.dug || s.digT >= 0) continue; const d = Math.hypot(s.x - pos.x, s.z - pos.z); if (d < bd) { bd = d; best = s; } }
      return best;
    },
    dig(s) {
      s.digT = 0; s.grains.visible = true;
      const a = s.grains.geometry.attributes.position.array;
      s.vel = [];
      for (let j = 0; j < 24; j++) {
        a[j * 3] = 0; a[j * 3 + 1] = 0.05; a[j * 3 + 2] = 0;
        const th = hash(day, 600 + j) * 6.28, sp = 0.6 + hash(day, 700 + j) * 1.2;
        s.vel.push([Math.cos(th) * sp * 0.6, 1.6 + hash(day, 800 + j) * 1.4, Math.sin(th) * sp * 0.6, 0.3 + (j % 3) * 0.25]);
      }
    },
    update(dt, T) {
      for (const s of spots) {
        if (!s.dug) {
          // a blink every few seconds: brief, soft
          const u = ((T + s.ph) % 4.2) / 4.2, b = u < 0.12 ? Math.sin((u / 0.12) * Math.PI) : 0;
          s.glint.material.opacity = 0.3 + 0.7 * b;
          s.glint.scale.setScalar(0.5 + 0.7 * b);
        } else s.glint.material.opacity = 0;
        if (s.digT < 0) continue;
        s.digT += dt;
        const t = s.digT;
        // sand flies up in puffs while the hands scoop (0.2 .. 1.3 s)
        const a = s.grains.geometry.attributes.position.array;
        for (let j = 0; j < 24; j++) {
          const v = s.vel[j], tt = (t - v[3]) % 0.9;
          if (t < v[3] || t > 1.5) { a[j * 3 + 1] = -1; continue; }
          a[j * 3] = v[0] * tt; a[j * 3 + 1] = 0.05 + v[1] * tt - 4.5 * tt * tt; a[j * 3 + 2] = v[2] * tt;
          if (a[j * 3 + 1] < 0) a[j * 3 + 1] = -1;
        }
        s.grains.geometry.attributes.position.needsUpdate = true;
        if (t > 0.9 && !s.dug) setDug(s, true);
        // the note rises out of the hole, turns slowly, and fades
        if (t > 1.0) {
          const k = Math.min(1, (t - 1.0) / 1.2);
          s.paper.visible = true; s.paper.position.y = 0.1 + k * 1.0; s.paper.rotation.y = t * 2.2;
          s.paper.material.opacity = Math.min(1, k * 3) * (t > 2.6 ? Math.max(0, 1 - (t - 2.6) / 0.6) : 1);
        }
        if (t > 3.3) { s.digT = -1; s.paper.visible = false; s.grains.visible = false; }
      }
    },
    match(seq) {
      if (seq.length < SONG_LEN) return false;
      for (let i = 0; i < SONG_LEN; i++) if (seq[seq.length - SONG_LEN + i] !== song[i]) return false;
      return true;
    },
    // set a mound as already dug (or not), e.g. after a day change / save restore
    setDug(i, v) { const s = spots.find(q => q.i === i); if (s) setDug(s, v); },
  };
}
