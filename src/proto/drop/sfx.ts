// Cat Drop: a few sounds the game's AudioEngine doesn't have, synthesised on a
// small Web Audio graph of their own: a "nom nom", a cushion's "boing", and
// bath time: a light patter of drizzle and soft bubbly bloops that grow as the
// foam comes closer, little pops, a sploosh when it gets the cat, and a sneeze.
// Like the engine, every method is a quiet no-op until unlock() and never throws.

type CtxCtor = new (o?: AudioContextOptions) => AudioContext;

export class DropSfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private patterGain: GainNode | null = null;
  private bloopOwed = 0;
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

  /** A tiny cat sneeze: a little breath in, then "tchoo!" (`pitch` ~1, higher for small cats). */
  sneeze(pitch = 1): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      // "a..."
      const a = ctx.createBufferSource();
      a.buffer = this.noise;
      const abp = ctx.createBiquadFilter();
      abp.type = 'bandpass';
      abp.Q.value = 2;
      abp.frequency.setValueAtTime(1300 * pitch, t);
      abp.frequency.exponentialRampToValueAtTime(2500 * pitch, t + 0.22);
      a.connect(abp);
      abp.connect(this.env(ctx, t, 0.07, 0.16, 0.08));
      a.start(t, Math.random() * 0.5);
      a.stop(t + 0.3);
      // "...tchoo!"
      const c = t + 0.3;
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.3;
      bp.frequency.setValueAtTime(3600 * pitch, c);
      bp.frequency.exponentialRampToValueAtTime(1800 * pitch, c + 0.12);
      n.connect(bp);
      bp.connect(this.env(ctx, c, 0.34, 0.004, 0.13));
      n.start(c, Math.random() * 0.5);
      n.stop(c + 0.18);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(980 * pitch, c);
      o.frequency.exponentialRampToValueAtTime(600 * pitch, c + 0.12);
      o.connect(this.env(ctx, c, 0.1, 0.006, 0.12));
      o.start(c);
      o.stop(c + 0.16);
    } catch {
      // ignore
    }
  }
}
