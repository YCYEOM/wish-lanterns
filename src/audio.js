// Procedural ambience (water + crickets) and small UI sounds, all WebAudio. No files.

// the player's music settings (all 0..1 except key in semitones and mood by name)
export const MUSIC_DEFAULTS = { mood: 'calm', vol: 0.5, tempo: 0.5, notes: 0.5, key: 0, rev: 0.35, nature: 0.5 };
// moods: four chords (one per bar) and the nine-note scale the music box wanders on (an octave below where it sounds)
export const MOODS = {
  // 🌙 calm: A minor, a soft sine pad and a music box wandering slowly — the original
  calm:   { chords: [[110, 130.81, 164.81], [87.31, 110, 130.81], [130.81, 164.81, 196], [98, 123.47, 146.83]],
            scale: [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25],
            tempo: 1, pad: 'sine', voice: 'box', oct: 2 },
  // 🕯️ warm: C major, a round triangle pad, a low bass on each bar and a gently picked broken chord (guitar-like)
  warm:   { chords: [[130.81, 164.81, 196], [98, 123.47, 146.83], [110, 130.81, 164.81], [87.31, 110, 130.81]],
            scale: [196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33],
            tempo: 0.85, pad: 'warm', voice: 'pluck', oct: 1, bass: true, arp: true },
  // 🫧 dreamy: maj7 chords, a wide detuned pad breathing through a slow filter, a few glassy bells, very slow
  dreamy: { chords: [[87.31, 110, 130.81, 164.81], [82.41, 98, 123.47, 146.83], [73.42, 87.31, 110, 130.81], [98, 123.47, 146.83, 174.61]],
            scale: [220, 246.94, 261.63, 329.63, 349.23, 392, 440, 493.88, 523.25],
            tempo: 1.45, pad: 'wide', voice: 'bell', oct: 2, sparse: true },
  // ✨ starry: D major, bright and high, a celesta twinkling quick figures and tiny sparkles over a light pad
  starry: { chords: [[146.83, 185, 220], [110, 138.59, 164.81], [123.47, 146.83, 185], [98, 123.47, 146.83]],
            scale: [220, 246.94, 293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25],
            tempo: 0.8, pad: 'sine', voice: 'celesta', oct: 4, sparkle: true, busy: true },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.seed = 1234567;
    this.cfg = { ...MUSIC_DEFAULTS };
  }
  rnd() { // own deterministic stream so audio never perturbs gameplay rng
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.nature = ctx.createGain(); this.nature.gain.value = this.cfg.nature * 2; this.nature.connect(this.master);

    // water: brown noise -> lowpass, slowly breathing
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = this.rnd() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = this.water = ctx.createGain(); g.gain.value = 0.22;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.08;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.nature);
    src.start(); lfo.start();

    // soft pad drone
    const pad = ctx.createGain(); pad.gain.value = 0.035; pad.connect(this.nature);
    [220, 277.18, 329.63].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f / 2;
      const og = ctx.createGain(); og.gain.value = 0.5;
      const l = ctx.createOscillator(); l.frequency.value = 0.05 + i * 0.03;
      const lg = ctx.createGain(); lg.gain.value = 0.4;
      l.connect(lg); lg.connect(og.gain);
      o.connect(og); og.connect(pad); o.start(); l.start();
    });

    this._cricketLoop();
    if (this.musicOn) this.setMusic(true);
  }
  _cricketLoop() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.05;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const base = 4200 + this.rnd() * 900;
    const chirps = 2 + Math.floor(this.rnd() * 3);
    const out = ctx.createGain(); out.gain.value = 0.018 + this.rnd() * 0.012;
    if (pan) { pan.pan.value = this.rnd() * 1.6 - 0.8; out.connect(pan); pan.connect(this.nature); } else out.connect(this.nature);
    for (let i = 0; i < chirps; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base;
      const e = ctx.createGain(); e.gain.value = 0;
      const t = t0 + i * 0.11;
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(1, t + 0.012);
      e.gain.linearRampToValueAtTime(0, t + 0.06);
      o.connect(e); e.connect(out); o.start(t); o.stop(t + 0.08);
    }
    setTimeout(() => this._cricketLoop(), 700 + this.rnd() * 2600);
  }
  // gentle generative music: a slow Am-F-C-G pad and a music-box melody on the A-minor pentatonic,
  // a few notes per bar with long rests; switchable, quiet under the water and crickets
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (!this.musicGain) {
      const ctx = this.ctx;
      this.musicBus = ctx.createGain();                          // every voice goes here
      this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0;   // on/off and volume
      this.musicBus.connect(this.musicGain); this.musicGain.connect(this.master);
      // a soft echo for "울림": delay with feedback through a lowpass, mixed back in
      this.echo = ctx.createDelay(2); this.echo.delayTime.value = 0.42;
      this.echoFb = ctx.createGain(); this.echoLp = ctx.createBiquadFilter(); this.echoLp.type = 'lowpass'; this.echoLp.frequency.value = 2400;
      this.echoWet = ctx.createGain();
      this.musicGain.connect(this.echo); this.echo.connect(this.echoLp); this.echoLp.connect(this.echoFb); this.echoFb.connect(this.echo);
      this.echoLp.connect(this.echoWet); this.echoWet.connect(this.master);
      this.bar = 0; this._musicLoop();
    }
    this._applyCfg();
  }
  // change any of the music settings; levels move at once, tempo / notes / key / mood from the next bar
  setMusicCfg(cfg) {
    const moodChanged = cfg.mood && cfg.mood !== this.cfg.mood;
    this.cfg = { ...this.cfg, ...cfg };
    if (this.ctx) this._applyCfg();
    // a new mood starts a fresh bar now (not when the old one ends), so the change is heard at once
    if (moodChanged && this.ctx && this.musicGain && this.musicOn) { this.bar = 0; this._musicLoop(); }
  }
  _applyCfg() {
    const t = this.ctx.currentTime, c = this.cfg;
    if (this.nature) this.nature.gain.setTargetAtTime(c.nature * 2, t, 0.15);
    if (!this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(this.musicOn ? c.vol * 2 : 0, t, this.musicOn ? 0.25 : 0.8);
    this.echoFb.gain.setTargetAtTime(0.18 + c.rev * 0.42, t, 0.2);
    this.echoWet.gain.setTargetAtTime(c.rev * 0.75, t, 0.2);
  }
  _musicLoop() {
    const ctx = this.ctx, c = this.cfg;
    const mood = MOODS[c.mood] || MOODS.calm;
    const BAR = (6.8 - 4 * c.tempo) * mood.tempo;                // 6.8 s (slow) .. 2.8 s (lively), stretched by the mood
    const t0 = ctx.currentTime + 0.1;
    if (this.musicOn) {
      const tr = Math.pow(2, (c.key | 0) / 12);
      const ch = mood.chords[this.bar % 4];
      this._pad(mood, ch, tr, t0, BAR);
      if (mood.bass) this._voice('bass', ch[0] / 2 * tr, t0 + 0.05, 0.05);
      if (mood.arp) {                                             // picked broken chord: up and back, eighth notes
        const order = [0, 1, 2, 1, 0, 2, 1, 2], step = BAR / 8;
        order.forEach((k, i) => this._voice('pluck', ch[k] * 2 * tr, t0 + i * step, 0.028 * (i % 2 ? 0.7 : 1)));
      }
      const scale = mood.scale, mul = Math.pow(2, mood.oct - 1);
      let idx = 3 + Math.floor(this.rnd() * 4);
      let steps = Math.max(0, Math.round(c.notes * 6 - 1 + this.rnd() * 2));
      if (mood.sparse) steps = Math.ceil(steps / 2);
      if (mood.busy) steps = Math.round(steps * 1.6);
      for (let i = 0; i < steps; i++) {                           // the melody wanders by steps
        idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(this.rnd() * 5) - 2));
        const t = t0 + 0.3 + i * (BAR / (steps + 0.5)) + this.rnd() * 0.25 * BAR / 4.8;
        this._voice(mood.voice, scale[idx] * mul * tr, t, mood.voice === 'pluck' ? 0.04 : 0.05);
      }
      if (mood.sparkle) {                                         // tiny high twinkles here and there
        for (let i = 0, n = 2 + Math.floor(this.rnd() * 3); i < n; i++)
          this._voice('twinkle', scale[5 + Math.floor(this.rnd() * 4)] * 8 * tr, t0 + this.rnd() * BAR, 0.012);
      }
    }
    this.bar++;
    clearTimeout(this._musicTimer);
    this._musicTimer = setTimeout(() => this._musicLoop(), BAR * 1000);
  }
  // the chord bed of each mood
  _pad(mood, ch, tr, t0, BAR) {
    const ctx = this.ctx, end = t0 + BAR + 1.3, amp = 0.022 * 3 / ch.length;
    const out = ctx.createGain(); out.connect(this.musicBus);
    let dest = out;
    if (mood.pad === 'warm' || mood.pad === 'wide') {             // through a lowpass; the wide pad's filter breathes
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
      f.frequency.setValueAtTime(mood.pad === 'warm' ? 900 : 500, t0);
      if (mood.pad === 'wide') f.frequency.linearRampToValueAtTime(1600, t0 + BAR * 0.55), f.frequency.linearRampToValueAtTime(600, end);
      f.connect(out); dest = f;
    }
    ch.forEach((fr) => {
      const voices = mood.pad === 'wide' ? [[-7, 'sawtooth', 0.32], [7, 'sawtooth', 0.32]] : mood.pad === 'warm' ? [[0, 'triangle', 1.2]] : [[0, 'sine', 1]];
      for (const [cents, type, k] of voices) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr * tr; o.detune.value = cents;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(amp * k, t0 + Math.min(mood.pad === 'wide' ? 2.4 : 1.6, BAR * 0.4));
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        o.connect(g); g.connect(dest); o.start(t0); o.stop(end + 0.1);
      }
    });
  }
  // one note in a mood's voice
  _voice(kind, f, t, amp) {
    const ctx = this.ctx;
    const note = (partials, dec) => partials.forEach(([mul, a, d = dec, type = 'sine']) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp * a, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + d + 0.05);
    });
    if (kind === 'box') note([[1, 1, 2.2], [2, 0.24, 1.1], [3, 0.12, 0.7]]);                  // music box
    else if (kind === 'bell') note([[1, 1, 4.5], [2.76, 0.35, 2.2], [5.4, 0.12, 1.1], [0.5, 0.2, 3]]);   // glassy bell, inharmonic
    else if (kind === 'celesta') note([[1, 1, 0.9], [4, 0.3, 0.35], [2, 0.18, 0.5]]);        // short, bright
    else if (kind === 'twinkle') note([[1, 1, 0.35], [1.5, 0.4, 0.25]]);
    else if (kind === 'pluck') note([[1, 1, 1.1, 'triangle'], [2, 0.3, 0.45], [3, 0.1, 0.25]]);   // a soft picked string
    else if (kind === 'bass') note([[1, 1, 2.6], [2, 0.25, 1.2]]);
  }
  // the campfire, level 0..1 (how near, how big): a soft low roar of the flames under real-sounding crackle —
  // clusters of tiny wood snaps (each a few ms of decaying noise, rung through a narrow band), now and then a
  // bigger knot popping with a woody body, and short sizzles of sap. The lake's water hush dips near the fire.
  setFire(level) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.fire) {
      const sr = ctx.sampleRate, len = sr * 4, buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.03 * (this.rnd() * 2 - 1)) / 1.03; d[i] = last * 4; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 0.4;
      const gain = ctx.createGain(); gain.gain.value = 0;
      // the flames breathe: a slow uneven swell in the roar
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.37; const lg = ctx.createGain(); lg.gain.value = 0; lfo.connect(lg); lg.connect(gain.gain); lfo.start();
      const out = ctx.createGain(); out.gain.value = 1; out.connect(this.master);
      src.connect(lp); lp.connect(gain); gain.connect(out); src.start();
      this.fire = { gain, lg, out, level: 0 };
      // one cluster of snaps rendered into a small buffer, played through its own band
      const cluster = (L) => {
        const n = 0.35, cb = ctx.createBuffer(1, Math.floor(sr * n), sr), c = cb.getChannelData(0);
        const count = 1 + Math.floor(this.rnd() * this.rnd() * 9);
        let at = 0;
        for (let k = 0; k < count; k++) {
          at += Math.floor(sr * (0.004 + this.rnd() * this.rnd() * 0.06));
          const amp = 0.25 + 0.75 * this.rnd() ** 2, dur = Math.floor(sr * (0.0006 + this.rnd() * 0.0025));
          for (let j = 0; j < dur && at + j < c.length; j++) c[at + j] += (this.rnd() * 2 - 1) * amp * Math.exp(-j / (dur * 0.3));
        }
        const t = ctx.currentTime + 0.01, s0 = ctx.createBufferSource(); s0.buffer = cb;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + this.rnd() * 4200; bp.Q.value = 0.7 + this.rnd() * 1.5;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
        const g = ctx.createGain(); g.gain.value = (1.4 + this.rnd() * 1.4) * L;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        s0.connect(hp); hp.connect(bp); bp.connect(g);
        if (pan) { pan.pan.value = this.rnd() * 0.8 - 0.4; g.connect(pan); pan.connect(out); } else g.connect(out);
        if (this.echo && this.rnd() < 0.3) g.connect(this.echo);
        s0.start(t);
      };
      // a knot of wood bursting: a sharp crack with a short woody ring under it
      const pop = (L) => {
        const t = ctx.currentTime + 0.01, len2 = Math.floor(sr * 0.12), pb = ctx.createBuffer(1, len2, sr), c = pb.getChannelData(0);
        for (let j = 0; j < len2; j++) c[j] = (this.rnd() * 2 - 1) * Math.exp(-j / (sr * 0.006)) + (j < sr * 0.03 ? (this.rnd() * 2 - 1) * 0.25 * Math.exp(-j / (sr * 0.01)) : 0);
        const s0 = ctx.createBufferSource(); s0.buffer = pb;
        const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 500 + this.rnd() * 700; body.Q.value = 3; body.gain.value = 10;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250;
        const g = ctx.createGain(); g.gain.value = (1.3 + this.rnd() * 0.7) * L;
        s0.connect(hp); hp.connect(body); body.connect(g); g.connect(out); if (this.echo) g.connect(this.echo);
        s0.start(t);
      };
      // sap sizzling for a moment: a thin hiss swelling and fading
      const hiss = (L) => {
        const t = ctx.currentTime + 0.01, dur = 0.4 + this.rnd() * 0.9;
        const s0 = ctx.createBufferSource(); s0.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000 + this.rnd() * 2500;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * L, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s0.connect(hp); hp.connect(g); g.connect(out); s0.start(t, this.rnd() * 3); s0.stop(t + dur + 0.05);
      };
      const tick = () => {
        const L = this.fire.level, big = this.fire.size || 0;
        if (L > 0.02 && ctx.state === 'running') {
          cluster(L);
          if (this.rnd() < 0.07 + big * 0.06) pop(L);
          if (this.rnd() < 0.025) hiss(L);
        }
        // crackle comes in bursts: often quick follow-ups, sometimes a lull; a bigger fire crackles more
        const quick = this.rnd() < 0.45;
        setTimeout(tick, L > 0.02 ? (quick ? 40 + this.rnd() * 140 : 200 + this.rnd() * (900 - big * 400)) : 700);
      };
      tick();
    }
    this.fire.level = level;
    const t = ctx.currentTime;
    this.fire.gain.gain.setTargetAtTime(0.07 * level, t, 0.4);
    this.fire.lg.gain.setTargetAtTime(0.025 * level, t, 0.4);
    // near the fire the lake's hush steps back so the crackle carries
    if (this.water) this.water.gain.setTargetAtTime(0.22 * (1 - 0.6 * Math.min(1, level * 1.4)), t, 0.5);
  }
  // how big the fire is now (0..1): more knots popping, fewer lulls
  setFireSize(k) { if (this.fire) this.fire.size = Math.max(0, Math.min(1, k)); }
  // the whale's song: two low voices gliding slowly, through a soft filter and the echo
  whaleSong() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
    const out = ctx.createGain(); out.gain.value = 0.9; lp.connect(out); out.connect(this.master); if (this.echo) out.connect(this.echo);
    const call = (t0, f0, f1, f2, dur, amp) => {
      for (const [mul, a, type] of [[1, 1, 'sine'], [2, 0.25, 'triangle'], [3.01, 0.08, 'sine']]) {
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0 * mul, t0); o.frequency.exponentialRampToValueAtTime(f1 * mul, t0 + dur * 0.45); o.frequency.exponentialRampToValueAtTime(f2 * mul, t0 + dur);
        const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.value = f1 * mul * 0.012; vib.connect(vg); vg.connect(o.frequency);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(amp * a, t0 + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(lp); o.start(t0); o.stop(t0 + dur + 0.1); vib.start(t0); vib.stop(t0 + dur + 0.1);
      }
    };
    call(t + 0.2, 180, 320, 240, 3.2, 0.09);
    call(t + 3.8, 260, 420, 210, 3.8, 0.07);
    call(t + 9.5, 150, 230, 120, 4.5, 0.08);
    this.chime([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.18, 0.4);
  }
  // a singing stone: a soft marimba-like knock with a bell overtone; vol by how near it is
  stone(f, vol = 1) {
    if (!this.ctx || vol < 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [mul, a, d] of [[1, 0.16, 1.6], [4, 0.04, 0.35], [2.76, 0.03, 0.9], [0.5, 0.05, 0.8]]) {
      const o = ctx.createOscillator(); o.frequency.value = f * mul;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a * vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.master); if (this.echo) g.connect(this.echo); o.start(t); o.stop(t + d + 0.05);
    }
  }
  // digging in sand: a few soft scoops of filtered noise
  dig() {
    if (!this.ctx) return;
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * 0.3), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (this.rnd() * 2 - 1) * (1 - i / len);
    for (let k = 0; k < 4; k++) {
      const t = ctx.currentTime + 0.25 + k * 0.27, n = ctx.createBufferSource(); n.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + k * 300; bp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      n.connect(bp); bp.connect(g); g.connect(this.master); n.start(t); n.stop(t + 0.3);
    }
  }
  // the cat: a short meow (a sawtooth through two formant filters, pitch rising then falling)
  meow() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, f0 = 560 + this.rnd() * 160;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.85, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.16); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.55);
    const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    out.gain.setValueAtTime(0.12, t + 0.3); out.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    for (const [f, q, g] of [[900, 6, 1], [2600, 8, 0.5]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(f * 0.8, t); bp.frequency.linearRampToValueAtTime(f * 1.15, t + 0.2);
      const gg = ctx.createGain(); gg.gain.value = g; o.connect(bp); bp.connect(gg); gg.connect(out);
    }
    out.connect(this.master); o.start(t); o.stop(t + 0.65);
  }
  // a purr: soft low noise pulsing about 25 times a second
  purr(dur = 2.5, level = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.06 * (this.rnd() * 2 - 1)) / 1.06; d[i] = last * 4; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 24; const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.09 * level, t + 0.6);
    env.gain.setValueAtTime(0.09 * level, t + dur - 0.7); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(am); am.connect(env); env.connect(this.nature || this.master);
    src.start(t); lfo.start(t); src.stop(t + dur); lfo.stop(t + dur);
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.2);
  }
  plop() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.55);
    this.chime([523.25, 659.25, 783.99], 0.12, 0.25);
  }
  chime(notes = [783.99, 1046.5], gap = 0.09, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    notes.forEach((f, i) => {
      const t = ctx.currentTime + delay + i * gap;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.5);
    });
  }
  tick() { this.chime([1318.5], 0, 0); }
}
