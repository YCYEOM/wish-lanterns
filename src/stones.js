// Singing stones: seven flat stones along the waterline left of the start, each a note of a pentatonic scale
// (so anything played on them sounds right together). Tapping one rings it: the stone's rune glows, a ring
// opens on the water, a little ♪ floats up. Everyone on the lake hears it (net), quieter farther away.
//
//   const stones = createStones(scene, shore)
//   stones.hit(i, remote?)  -> ring stone i (returns its world position)
//   stones.pick(camera, x, y, w, h) -> index of the stone under a tap, or -1
//   stones.update(dt)
import * as THREE from '../vendor/three.module.js';

export const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];   // C D E G A C D
const HUES = [0xffb070, 0xffd27a, 0xfff08a, 0x9ff0b0, 0x8fd8ff, 0xb9a8ff, 0xffa8d8];

export function createStones(scene, shore, glowTex) {
  const group = new THREE.Group(); group.userData.tag = 'singing-stones'; scene.add(group);
  // a little ♪ drawn once, tinted per stone: floats above each so they read as something to play
  const nc = document.createElement('canvas'); nc.width = nc.height = 64;
  const cx = nc.getContext('2d'); cx.fillStyle = '#fff'; cx.font = 'bold 50px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.shadowColor = '#fff'; cx.shadowBlur = 6; cx.fillText('♪', 32, 34);
  const noteTex = new THREE.CanvasTexture(nc); noteTex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.DodecahedronGeometry(0.42, 0); geo.scale(1.15, 0.42, 0.95);
  const ringGeo = new THREE.RingGeometry(0.16, 0.24, 24); ringGeo.rotateX(-Math.PI / 2);
  const waveGeo = new THREE.RingGeometry(0.9, 1.0, 40); waveGeo.rotateX(-Math.PI / 2);
  const stones = [];
  for (let i = 0; i < NOTES.length; i++) {
    // along the shore left of the start, on the wet sand just above the water
    const p = shore.nearestShore(-4.2 - i * 1.25, 14 - i * 0.2, 0.55);
    const y = shore.groundY(p.x, p.z);
    const g = new THREE.Group(); g.position.set(p.x, y, p.z); g.rotation.y = i * 1.3; group.add(g);
    const col = new THREE.Color(HUES[i]);
    // each stone faintly lit from within in its own colour (paler rock, a tint of the hue)
    const rockMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0x8a8ca0).lerp(col, 0.25), flatShading: true, emissive: col.clone().multiplyScalar(0.22) });
    const rock = new THREE.Mesh(geo, rockMat); rock.position.y = 0.08; g.add(rock);
    const rune = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    rune.position.y = 0.27; g.add(rune);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.position.y = 0.4; glow.scale.setScalar(1.6); g.add(glow);
    const note = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, color: col, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    note.position.y = 0.9; note.scale.setScalar(0.48); g.add(note);
    // the ring that opens on the water toward the lake
    const wave = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const w = shore.nearestShore(p.x, p.z, -1.0); wave.position.set(w.x, 0.03, w.z); wave.visible = false; group.add(wave);
    stones.push({ g, rock, note, rune, glow, wave, x: p.x, y, z: p.z, k: 0, wt: 9, ph: i * 0.9 });
  }
  const tmp = new THREE.Vector3();
  return {
    stones,
    hit(i) {
      const s = stones[i]; if (!s) return null;
      s.k = 1; s.wt = 0; s.wave.visible = true;
      return s;
    },
    pick(camera, x, y, w, h) {
      const focal = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
      let best = -1, bd = Infinity;
      stones.forEach((s, i) => {
        tmp.set(s.x, s.y + 0.2, s.z);
        const dist = tmp.distanceTo(camera.position);
        tmp.project(camera); if (tmp.z > 1) return;
        const sx = (tmp.x * 0.5 + 0.5) * w, sy = (-tmp.y * 0.5 + 0.5) * h, d = Math.hypot(sx - x, sy - y);
        if (d < Math.max(18, (0.5 * focal) / dist + 6) && d < bd) { bd = d; best = i; }
      });
      return best;
    },
    update(dt, T) {
      for (const s of stones) {
        s.k = Math.max(0, s.k - dt * 1.3);
        // a slow shimmer runs along the row every few seconds (stone by stone), inviting a tap
        const i = stones.indexOf(s), u = ((T * 0.9 - i * 0.35) % 6 + 6) % 6, run = u < 1 ? Math.sin(u * Math.PI) : 0;
        const idle = 0.75 + 0.1 * Math.sin(T * 1.4 + s.ph) + 0.25 * run;
        s.rune.material.opacity = Math.min(1, idle + s.k);
        s.rune.scale.setScalar(1 + s.k * 0.35 + run * 0.15);
        s.glow.material.opacity = 0.42 + 0.3 * run + s.k * 0.6; s.glow.scale.setScalar(1.6 + 0.5 * run + s.k * 1.6);
        s.note.position.y = 0.9 + 0.07 * Math.sin(T * 1.8 + s.ph) + s.k * 0.5;
        s.note.material.opacity = Math.min(1, 0.7 + 0.3 * run + s.k * 0.3); s.note.scale.setScalar(0.48 + run * 0.1 + s.k * 0.18);
        if (s.wave.visible) {
          s.wt += dt;
          const t = s.wt / 2.2;
          s.wave.scale.setScalar(0.4 + t * 3.2); s.wave.material.opacity = 0.55 * (1 - t);
          if (t >= 1) s.wave.visible = false;
        }
      }
    },
  };
}
