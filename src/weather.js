// weather.js — today's real Seoul weather on the night lake, and everything that falls through the air.
//   fetchSeoulWeather(ms)   -> Promise<{ kind, temp, code } | null>   (Open-Meteo, keyless; null on any failure)
//   codeToKind(code, cloud) -> 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog'
//   WEATHER[kind]           -> { line (Korean), emoji, cloudK, rainK, fogK, rain, snow }  (targets, 0..1)
//   createAtmosphere(scene, uniforms, { pixelRatio, coarse })
//     .set({ weather, season })   eases every uniform and particle amount toward the new state
//     .update(dt)                 call once per frame (after uniforms.camPos is current)
//     .state()                    { weather, season, rain, snow, petals, leaves } for probes
import * as THREE from '../vendor/three.module.js';
import { L } from './i18n.js';
import { SEASONS } from './season.js';

export const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'snow', 'fog'];

export const WEATHER = {
  clear: { line: L('오늘 서울은 맑아요', 'clear skies in Seoul today'), emoji: '✨', cloudK: 0.0, rainK: 0, fogK: 0.0, rain: 0, snow: 0 },
  cloudy: { line: L('오늘 서울은 구름이 끼었어요', 'cloudy in Seoul today'), emoji: '☁️', cloudK: 1.0, rainK: 0, fogK: 0.12, rain: 0, snow: 0 },
  rain: { line: L('오늘 서울은 비가 와요', 'rain in Seoul today'), emoji: '🌧', cloudK: 1.0, rainK: 1, fogK: 0.3, rain: 1, snow: 0 },
  snow: { line: L('오늘 서울은 눈이 와요', 'snow in Seoul today'), emoji: '❄️', cloudK: 0.9, rainK: 0, fogK: 0.25, rain: 0, snow: 1 },
  fog: { line: L('오늘 서울은 안개가 끼었어요', 'foggy in Seoul today'), emoji: '🌫', cloudK: 0.7, rainK: 0, fogK: 1, rain: 0, snow: 0 },
};

// WMO weather codes (Open-Meteo): 0-1 clear, 2-3 cloud, 45/48 fog, 51-67 & 80-82 & 95-99 rain, 71-77 & 85-86 snow
export function codeToKind(code, cloud = 0) {
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if (code === 3 || (code === 2 && cloud >= 60)) return 'cloudy';
  return 'clear';
}

export async function fetchSeoulWeather(ms = 4000) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978'
    + '&current=weather_code,cloud_cover,precipitation,snowfall,temperature_2m&timezone=Asia%2FSeoul';
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const c = j && j.current;
    if (!c || typeof c.weather_code !== 'number') return null;
    return { kind: codeToKind(c.weather_code, c.cloud_cover | 0), temp: c.temperature_2m, code: c.weather_code };
  } catch { return null; } finally { clearTimeout(timer); }
}

// ---- falling things: one Points cloud each, wrapped in a box that travels with the camera, so a few
// hundred points are always all around you. Seeds are fixed (no Math.random): the look is repeatable.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SHAPES = { rain: 0, snow: 1, petal: 2, leaf: 3 };
function makeFall(kind, count, box, opts, uniforms, pixelRatio) {
  const r = seeded(opts.seed);
  const pos = new Float32Array(count * 3), sd = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (r() - 0.5) * box.x; pos[i * 3 + 1] = r() * box.y; pos[i * 3 + 2] = (r() - 0.5) * box.z;
    sd[i * 4] = r(); sd[i * 4 + 1] = r(); sd[i * 4 + 2] = r(); sd[i * 4 + 3] = (i + 0.5) / count;   // w: show order
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const amt = { value: 0 };
  const m = new THREE.ShaderMaterial({
    uniforms: { time: uniforms.time, camPos: uniforms.camPos, amt, box: { value: box } },
    transparent: true, depthWrite: false, fog: false,
    blending: kind === 'rain' || kind === 'snow' ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      uniform float time; uniform vec3 camPos; uniform float amt; uniform vec3 box; attribute vec4 aSeed;
      varying vec4 vS; varying float vA;
      void main(){
        vec3 p = position;
        float sp = ${opts.speed.toFixed(2)} * (0.75 + 0.5 * aSeed.x);
        p.y -= time * sp;
        p.x += sin(time * ${opts.sway.toFixed(2)} * (0.6 + aSeed.y) + aSeed.z * 6.28) * ${opts.swayAmt.toFixed(2)} + time * ${opts.drift.toFixed(2)};
        p.z += cos(time * ${opts.sway.toFixed(2)} * 0.8 * (0.6 + aSeed.x) + aSeed.y * 6.28) * ${opts.swayAmt.toFixed(2)} * 0.7;
        // wrap into the box around the camera (x/z centred, y from just under the eye up to the top)
        vec3 lo = camPos - vec3(box.x * 0.5, ${opts.below.toFixed(1)}, box.z * 0.5);
        p = lo + mod(p - lo, box);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float edge = 1.0 - smoothstep(0.38, 0.5, max(abs(p.x - camPos.x) / box.x, abs(p.z - camPos.z) / box.z));
        vA = step(aSeed.w, amt) * edge * smoothstep(-0.05, 0.3, p.y);
        vS = aSeed;
        gl_PointSize = vA <= 0.0 ? 0.0 : min(${opts.size.toFixed(1)} / max(-mv.z, 0.6) * (0.7 + 0.6 * aSeed.z), ${opts.maxPx.toFixed(1)}) * ${pixelRatio.toFixed(2)};
        if (-mv.z < 1.2) vA *= smoothstep(0.4, 1.2, -mv.z);   // nothing smears across the lens
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec4 vS; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float a = 0.0; vec3 col = vec3(1.0);
        int shape = ${SHAPES[kind]};
        if (shape == 0) {            // a thin falling streak
          a = (1.0 - smoothstep(0.012, 0.04, abs(c.x + c.y * 0.08))) * smoothstep(0.5, -0.3, c.y) * smoothstep(-0.5, -0.3, c.y) * 0.5;
          col = vec3(0.62, 0.68, 0.85);
        } else if (shape == 1) {     // a soft flake
          a = smoothstep(0.5, 0.1, length(c)) * 0.85; col = vec3(0.85, 0.88, 1.0);
        } else {                     // a petal / a leaf: a turning ellipse
          float an = time * (0.8 + vS.y * 1.6) + vS.x * 6.28;
          vec2 q = mat2(cos(an), -sin(an), sin(an), cos(an)) * c;
          q.x *= 1.0 + 0.8 * abs(sin(an * 0.7 + vS.z * 3.0));   // tumbling: it narrows as it turns edge-on
          float e = length(q * vec2(${kind === 'petal' ? '2.6, 1.6' : '2.2, 1.3'}));
          a = smoothstep(0.5, 0.38, e);
          ${kind === 'petal'
            ? 'col = mix(vec3(1.0, 0.62, 0.76), vec3(1.0, 0.8, 0.88), vS.y) * 0.8;'
            : 'col = mix(mix(vec3(0.75, 0.2, 0.06), vec3(0.85, 0.45, 0.08), smoothstep(0.2, 0.6, vS.y)), vec3(0.8, 0.68, 0.18), smoothstep(0.75, 1.0, vS.y)) * 0.5;'}
        }
        a *= vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col * ${kind === 'rain' || kind === 'snow' ? 'a' : '1.0'}, ${kind === 'rain' || kind === 'snow' ? '1.0' : 'a'});
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; pts.renderOrder = 5; pts.userData.tag = kind + '-fall';
  return { pts, amt };
}

export function createAtmosphere(scene, uniforms, { pixelRatio = 1, coarse = false, lite = false } = {}) {
  const k = lite ? 0.3 : coarse ? 0.55 : 1;   // phones: fewer points; software rendering: far fewer
  const falls = {
    rain: makeFall('rain', Math.round(1500 * k), new THREE.Vector3(40, 22, 40), { seed: 11, speed: 16, sway: 0.3, swayAmt: 0.15, drift: -0.6, size: 260, below: 1.5, maxPx: 70 }, uniforms, pixelRatio),
    snow: makeFall('snow', Math.round(1700 * k), new THREE.Vector3(40, 20, 40), { seed: 23, speed: 1.1, sway: 0.6, swayAmt: 0.9, drift: 0.15, size: 110, below: 1.5, maxPx: 22 }, uniforms, pixelRatio),
    petal: makeFall('petal', Math.round(380 * k), new THREE.Vector3(30, 12, 30), { seed: 37, speed: 0.55, sway: 0.8, swayAmt: 1.4, drift: 0.35, size: 210, below: 1.0, maxPx: 24 }, uniforms, pixelRatio),
    leaf: makeFall('leaf', Math.round(300 * k), new THREE.Vector3(30, 12, 30), { seed: 41, speed: 0.75, sway: 0.7, swayAmt: 1.2, drift: 0.3, size: 210, below: 1.0, maxPx: 26 }, uniforms, pixelRatio),
  };
  for (const f of Object.values(falls)) scene.add(f.pts);

  let weather = 'clear', season = 'autumn';
  const tgt = { cloudK: 0, rainK: 0, fogK: 0, snowCover: 0, ffAmt: 0.45, rain: 0, snow: 0, petal: 0, leaf: 0, s: [0, 0, 1, 0] };
  function set(o) {
    if (o.weather) weather = o.weather;
    if (o.season) season = o.season;
    const W = WEATHER[weather] || WEATHER.clear, S = SEASONS[season] || SEASONS.autumn;
    tgt.cloudK = W.cloudK; tgt.rainK = W.rainK; tgt.fogK = W.fogK;
    tgt.rain = W.rain; tgt.snow = W.snow;
    // snow lies on the ground in winter, and settles a little whenever it is snowing
    tgt.snowCover = Math.max(S.snow, W.snow ? 0.6 : 0) * (weather === 'rain' ? 0.75 : 1);
    // fireflies keep to dry nights; petals and leaves drift less in rain and snow
    const wet = weather === 'rain' || weather === 'snow';
    tgt.ffAmt = S.ff * (wet ? 0.15 : weather === 'fog' ? 0.6 : 1);
    tgt.petal = S.fall === 'petal' ? (wet ? 0.35 : 1) : 0;
    tgt.leaf = S.fall === 'leaf' ? (wet ? 0.35 : 1) : 0;
    tgt.s = S.weights;
    if (o.instant) snap();
  }
  function snap() {
    uniforms.cloudK.value = tgt.cloudK; uniforms.rainK.value = tgt.rainK; uniforms.fogK.value = tgt.fogK;
    uniforms.snowCover.value = tgt.snowCover; uniforms.ffAmt.value = tgt.ffAmt;
    uniforms.season.value.set(...tgt.s);
    falls.rain.amt.value = tgt.rain; falls.snow.amt.value = tgt.snow; falls.petal.amt.value = tgt.petal; falls.leaf.amt.value = tgt.leaf;
  }
  const v4 = new THREE.Vector4();
  function update(dt) {
    const e = 1 - Math.exp(-dt * 0.8);            // a few seconds to drift into new weather
    const ease = (u, t) => { u.value += (t - u.value) * e; };
    ease(uniforms.cloudK, tgt.cloudK); ease(uniforms.rainK, tgt.rainK); ease(uniforms.fogK, tgt.fogK);
    ease(uniforms.snowCover, tgt.snowCover); ease(uniforms.ffAmt, tgt.ffAmt);
    uniforms.season.value.lerp(v4.set(...tgt.s), e);
    ease(falls.rain.amt, tgt.rain); ease(falls.snow.amt, tgt.snow); ease(falls.petal.amt, tgt.petal); ease(falls.leaf.amt, tgt.leaf);
    for (const f of Object.values(falls)) f.pts.visible = f.amt.value > 0.004;   // not drawn at all when not falling
  }
  set({ weather, season, instant: true });
  return {
    set, update, snap,
    get weather() { return weather; }, get season() { return season; },
    state: () => ({ weather, season, rain: +falls.rain.amt.value.toFixed(2), snow: +falls.snow.amt.value.toFixed(2),
      petals: +falls.petal.amt.value.toFixed(2), leaves: +falls.leaf.amt.value.toFixed(2),
      cloud: +uniforms.cloudK.value.toFixed(2), fog: +uniforms.fogK.value.toFixed(2), snowCover: +uniforms.snowCover.value.toFixed(2) }),
  };
}
