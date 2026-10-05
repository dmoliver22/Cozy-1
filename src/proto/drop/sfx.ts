// Cat Drop: a few sounds the game's AudioEngine doesn't have, synthesised on a
// small Web Audio graph of their own: a "nom nom", a cushion's "boing", and
// bath time: a light patter of drizzle and soft bubbly bloops that grow as the
// foam comes closer, little pops, a sploosh when it gets the cat, the foam
// swelling as it fills the screen and draining away, the splash of the cat
// landing in the bath, water lapping in the tub, and the tap's drip.
// Like the engine, every method is a quiet no-op until unlock() and never throws.

type CtxCtor = new (o?: AudioContextOptions) => AudioContext;

export class DropSfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private patterGain: GainNode | null = null;
  private lapGain: GainNode | null = null;
  private lapBuf: AudioBuffer | null = null;
  private bloopOwed = 0;
  private blubOwed = 0;
  private lastPop = 0;
  private on = true;

  /** Call from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const w = globalThis as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
        const C = w.AudioContext ?? w.webkitAudioContext;
        if (!C) return;
        const ctx = new C({ latencyHint: 'interactive' });
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.ratio.value = 3;
        comp.connect(ctx.destination);
        const out = ctx.createGain();
        out.gain.value = this.on ? 1 : 0;
        out.connect(comp);
        this.ctx = ctx;
        this.out = out;
        const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = n.getChannelData(0);
        let s = 12345;
        for (let i = 0; i < d.length; i++) {
          s = (s * 1103515245 + 12345) >>> 0;
          d[i] = (s / 4294967296) * 2 - 1;
        }
        this.noise = n;
        this.lapBuf = this.lapBuffer(ctx);
        // iOS: a silent blip inside the gesture unlocks output
        const blip = ctx.createBufferSource();
        blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        blip.connect(ctx.destination);
        blip.start(0);
        document.addEventListener('visibilitychange', () => {
          if (!this.ctx) return;
          if (document.hidden) void this.ctx.suspend().catch(() => undefined);
          else void this.ctx.resume().catch(() => undefined);
        });
      }
      if (this.ctx.state !== 'running' && !document.hidden) void this.ctx.resume().catch(() => undefined);
    } catch {
      // sound is a nicety
    }
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  private live(): AudioContext | null {
    return this.ctx && this.on && this.ctx.state === 'running' ? this.ctx : null;
  }

  private env(ctx: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.out!);
    return g;
  }

  /** Two little munches, a touch brighter for a golden fish. */
  nom(golden = false, size = 0.5): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t0 = ctx.currentTime + 0.005;
      const base = (golden ? 560 : 470) * (1.15 - size * 0.3);
      for (let k = 0; k < 2; k++) {
        const t = t0 + k * 0.12;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(base * (k ? 0.9 : 1.05), t);
        o.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.08);
        o.connect(this.env(ctx, t, 0.16, 0.008, 0.09));
        o.start(t);
        o.stop(t + 0.12);
        // the crunch
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2200 + k * 400;
        bp.Q.value = 1.4;
        src.connect(bp);
        bp.connect(this.env(ctx, t, 0.12, 0.004, 0.05));
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.07);
      }
    } catch {
      // ignore
    }
  }

  /** A cushion's springy boing. */
  boing(speed: number): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.005;
      const v = Math.min(1, speed / 900);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 150 + v * 40;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.09);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.4);
      // the wobble of a spring
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 17;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(f0 * 0.25, t);
      lg.gain.exponentialRampToValueAtTime(1, t + 0.4);
      lfo.connect(lg);
      lg.connect(o.frequency);
      o.connect(this.env(ctx, t, 0.2 + v * 0.1, 0.006, 0.42));
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.5);
      lfo.stop(t + 0.5);
    } catch {
      // ignore
    }
  }

  /** A soft bubble "bloop": a quick upward sweep, like a bubble rising through water. */
  private bloop(ctx: AudioContext, at: number, f0: number, gain: number, len = 0.07): void {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.3, at + len);
    o.connect(this.env(ctx, at, gain, 0.006, len + 0.05));
    o.start(at);
    o.stop(at + len + 0.08);
  }

  /** A loop of light drizzle: sparse soft ticks of filtered noise. */
  private patterLoop(ctx: AudioContext): GainNode {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 987654;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) >>> 0;
      return s / 4294967296;
    };
    const ticks = 150;
    for (let k = 0; k < ticks; k++) {
      const at = Math.floor(rnd() * len);
      const amp = 0.25 + rnd() * 0.75;
      const dur = Math.floor(ctx.sampleRate * (0.002 + rnd() * 0.006));
      for (let i = 0; i < dur && at + i < len; i++) d[at + i] += (rnd() * 2 - 1) * amp * Math.exp(-i / (dur * 0.3));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(this.out!);
    src.start();
    return g;
  }

  /**
   * Bath time nearby: level 0..1 (far off .. right over the cat). Call every
   * frame: the drizzle's patter swells and soft bloops come more often.
   */
  bath(level: number, dt: number): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const l = Math.max(0, Math.min(1, level));
      if (!this.patterGain) {
        if (l <= 0) return;
        this.patterGain = this.patterLoop(ctx);
      }
      this.patterGain.gain.setTargetAtTime(this.on && l > 0 ? 0.04 + l * l * 0.2 : 0, ctx.currentTime, 0.25);
      if (!this.on || l <= 0.05) return;
      this.bloopOwed += dt * (0.4 + 3.2 * l);
      if (this.bloopOwed >= 1) {
        this.bloopOwed = 0;
        this.bloop(ctx, ctx.currentTime + 0.01 + Math.random() * 0.05, 240 + Math.random() * 300, 0.03 + l * 0.05);
      }
    } catch {
      // ignore
    }
  }

  /** A loose bubble popping (quiet, and never too many at once). */
  pop(): void {
    try {
      const ctx = this.live();
      if (!ctx || ctx.currentTime - this.lastPop < 0.08) return;
      this.lastPop = ctx.currentTime;
      const t = ctx.currentTime + 0.005;
      this.bloop(ctx, t, 700 + Math.random() * 500, 0.045, 0.025);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      src.connect(hp);
      hp.connect(this.env(ctx, t, 0.05, 0.002, 0.02));
      src.start(t, Math.random() * 0.5);
      src.stop(t + 0.03);
    } catch {
      // ignore
    }
  }

  /** The foam swallows the cat: a soft whoosh, a low blub, and a flurry of bubbles. */
  sploosh(): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(4200, t);
      lp.frequency.exponentialRampToValueAtTime(420, t + 0.5);
      src.connect(lp);
      lp.connect(this.env(ctx, t, 0.32, 0.04, 0.6));
      src.start(t);
      src.stop(t + 0.7);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(190, t + 0.04);
      o.frequency.exponentialRampToValueAtTime(78, t + 0.3);
      o.connect(this.env(ctx, t + 0.04, 0.24, 0.01, 0.32));
      o.start(t + 0.04);
      o.stop(t + 0.4);
      for (let k = 0; k < 6; k++) this.bloop(ctx, t + 0.12 + k * 0.07 + Math.random() * 0.04, 260 + Math.random() * 420, 0.07);
    } catch {
      // ignore
    }
  }

  /** A burst of noise through a filter, enveloped (the building block of the watery sounds). */
  private hiss(ctx: AudioContext, at: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + attack + decay);
    src.connect(f);
    f.connect(this.env(ctx, at, peak, attack, decay));
    src.start(at, Math.random() * 0.4);
    src.stop(at + attack + decay + 0.05);
  }

  /**
   * The foam pours on down to fill the screen: a gushing swell that rises over
   * `secs`, with bubbly bloops coming faster and faster.
   */
  fill(secs = 1.4): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.02;
      // the gush: noise opening up as it swells, wobbling like water pouring
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + secs);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + secs * 0.9);
      g.gain.setTargetAtTime(0.0001, t + secs, 0.18);
      // (a wobble, as of water gushing: a tremolo on top of the swell)
      const trem = ctx.createGain();
      trem.gain.value = 1;
      const wob = ctx.createOscillator();
      wob.frequency.value = 7;
      const wg = ctx.createGain();
      wg.gain.value = 0.3;
      wob.connect(wg);
      wg.connect(trem.gain);
      src.connect(lp);
      lp.connect(g);
      g.connect(trem);
      trem.connect(this.out!);
      src.start(t);
      wob.start(t);
      src.stop(t + secs + 1);
      wob.stop(t + secs + 1);
      // bubbles, faster and faster
      const n = 26;
      for (let k = 0; k < n; k++) {
        const at = t + secs * Math.sqrt((k + Math.random() * 0.6) / n);
        this.bloop(ctx, at, 220 + Math.random() * 520, 0.03 + 0.04 * (k / n), 0.05 + Math.random() * 0.04);
      }
    } catch {
      // ignore
    }
  }

  /** The foam slides away off the screen: a soft falling "shhh" and a few last bubbles. */
  drain(): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      this.hiss(ctx, t, 'lowpass', 3400, 420, 0.7, 0.14, 0.05, 0.9);
      for (let k = 0; k < 6; k++) this.bloop(ctx, t + 0.05 + k * 0.11 + Math.random() * 0.05, 300 + Math.random() * 500, 0.035, 0.04);
    } catch {
      // ignore
    }
  }

  /** The cat lands in the bath: a plunging plop, a splash of water, and bubbles (`size` 0..1 for bigger cats, `speed` 0..1). */
  splash(size = 0.5, speed = 1): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      const v = Math.max(0.3, Math.min(1, speed));
      // the plop: a quick drop in pitch
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 300 - size * 110;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.28, t + 0.2);
      o.connect(this.env(ctx, t, 0.3 * v, 0.006, 0.24));
      o.start(t);
      o.stop(t + 0.3);
      // the water: a broad splash and the spray after it
      this.hiss(ctx, t, 'bandpass', 1500 - size * 400, 700, 0.6, 0.34 * v, 0.006, 0.42);
      this.hiss(ctx, t + 0.04, 'highpass', 3200, 2400, 0.5, 0.12 * v, 0.02, 0.55);
      // and the bubbles coming back up
      for (let k = 0; k < 6; k++) this.bloop(ctx, t + 0.16 + k * 0.08 + Math.random() * 0.05, 200 + Math.random() * 380, 0.05, 0.06);
    } catch {
      // ignore
    }
  }

  /** A drop from the tap landing in the bath (`delay` seconds from now). */
  plink(delay = 0): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01 + Math.max(0, delay);
      this.bloop(ctx, t, 1050 + Math.random() * 250, 0.05, 0.035);
      this.bloop(ctx, t + 0.012, 520, 0.025, 0.05);
    } catch {
      // ignore
    }
  }

  /** Four seconds of water lapping softly in a tub: low, slow swells of brownish noise (looping seamlessly). */
  private lapBuffer(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 24680;
    let brown = 0;
    // (the swells' envelope, worked out every 256 samples)
    let swell = 0;
    for (let i = 0; i < len; i++) {
      if ((i & 255) === 0) {
        const u = i / len;
        const a = Math.max(0, Math.sin(u * Math.PI * 6));
        const b = Math.max(0, Math.sin(u * Math.PI * 10 + 1));
        swell = 0.35 + 0.65 * a * a + 0.3 * b * b * b;
      }
      s = (s * 1103515245 + 12345) >>> 0;
      brown = brown * 0.97 + ((s / 4294967296) * 2 - 1) * 0.3;
      d[i] = brown * swell;
    }
    return buf;
  }

  /** The lapping, looped, through a soft low-pass (silent until lap() raises it). */
  private lapLoop(ctx: AudioContext): GainNode {
    const buf = this.lapBuf ?? (this.lapBuf = this.lapBuffer(ctx));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.out!);
    src.start();
    return g;
  }

  /** In the bath: level 0..1. Call every frame: the water laps softly, with the odd low blub. */
  lap(level: number, dt: number): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const l = Math.max(0, Math.min(1, level));
      if (!this.lapGain) {
        if (l <= 0) return;
        this.lapGain = this.lapLoop(ctx);
      }
      this.lapGain.gain.setTargetAtTime(this.on && l > 0 ? 0.32 * l : 0, ctx.currentTime, 0.4);
      if (!this.on || l <= 0.05) return;
      this.blubOwed += dt * 0.45 * l;
      if (this.blubOwed >= 1) {
        this.blubOwed = 0;
        this.bloop(ctx, ctx.currentTime + 0.01, 150 + Math.random() * 120, 0.035 * l, 0.09);
      }
    } catch {
      // ignore
    }
  }
}
