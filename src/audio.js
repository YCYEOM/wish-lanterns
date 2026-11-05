// Procedural ambience (water + crickets) and small UI sounds, all WebAudio. No files.

// the player's music settings (all 0..1 except key in semitones and mood by name)
export const MUSIC_DEFAULTS = { mood: 'calm', vol: 0.5, tempo: 0.5, notes: 0.5, key: 0, rev: 0.35, nature: 0.5 };
// moods: four chords (one per bar) and the nine-note scale the music box wanders on (an octave below where it sounds)
export const MOODS = {
  calm:   { chords: [[110, 130.81, 164.81], [87.31, 110, 130.81], [130.81, 164.81, 196], [98, 123.47, 146.83]],
            scale: [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25] },
  warm:   { chords: [[130.81, 164.81, 196], [98, 123.47, 146.83], [110, 130.81, 164.81], [87.31, 110, 130.81]],
            scale: [196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33] },
  dreamy: { chords: [[87.31, 110, 130.81, 164.81], [82.41, 98, 123.47, 146.83], [73.42, 87.31, 110, 130.81], [98, 123.47, 146.83, 174.61]],
            scale: [220, 246.94, 261.63, 329.63, 349.23, 392, 440, 493.88, 523.25] },
  starry: { chords: [[146.83, 185, 220], [110, 138.59, 164.81], [123.47, 146.83, 185], [98, 123.47, 146.83]],
            scale: [220, 246.94, 293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25] },
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
    const g = ctx.createGain(); g.gain.value = 0.22;
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
    this.cfg = { ...this.cfg, ...cfg };
    if (this.ctx) this._applyCfg();
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
    const BAR = 6.8 - 4 * c.tempo;                                // 6.8 s (slow) .. 2.8 s (lively) a bar
    const t0 = ctx.currentTime + 0.1;
    if (this.musicOn) {
      const mood = MOODS[c.mood] || MOODS.calm, tr = Math.pow(2, (c.key | 0) / 12);
      const ch = mood.chords[this.bar % 4], padAmp = 0.022 * 3 / ch.length;
      ch.forEach((f) => {                                         // pad: soft swell over the bar
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * tr;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(padAmp, t0 + Math.min(1.6, BAR * 0.35)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + BAR + 1.2);
        o.connect(g); g.connect(this.musicBus); o.start(t0); o.stop(t0 + BAR + 1.3);
      });
      const scale = mood.scale;
      let idx = 3 + Math.floor(this.rnd() * 4);
      const steps = Math.max(0, Math.round(c.notes * 6 - 1 + this.rnd() * 2));
      for (let i = 0; i < steps; i++) {                           // music box: a few notes wandering by steps
        idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(this.rnd() * 5) - 2));
        const t = t0 + 0.3 + i * (BAR / (steps + 0.5)) + this.rnd() * 0.25 * BAR / 4.8;
        [[1, 0.05], [2, 0.012], [3, 0.006]].forEach(([mul, amp]) => {
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = scale[idx] * 2 * mul * tr;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(amp, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 / mul);
          o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 2.4);
        });
      }
    }
    this.bar++;
    clearTimeout(this._musicTimer);
    this._musicTimer = setTimeout(() => this._musicLoop(), BAR * 1000);
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
