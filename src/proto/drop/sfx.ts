// Cat Drop: a few sounds the game's AudioEngine doesn't have, synthesised on a
// small Web Audio graph of their own: a "nom nom", a cushion's "boing", and
// bath time: drizzle drops plinking and soft bubbly bloops that grow as the
// foam comes closer, little pops, a whump when it gets the cat, a bubbly swell
// as it fills the screen, glugs as it drains away, the splash of the cat
// landing in the bath, the odd blub in the tub, and the tap's drip.
// Bath time is tonal on purpose: loops and bursts of noise (a drizzle patter,
// pop clicks, a gushing rush, water lapping) all read as static on a phone.
// Like the engine, every method is a quiet no-op until unlock() and never throws.

type CtxCtor = new (o?: AudioContextOptions) => AudioContext;

export class DropSfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private dropOwed = 0;
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

  /**
   * Whee: a slide whistle for a ride down a boost slide, `secs` long: up as
   * it whooshes in, round and round with the corkscrew (`turns`), and down
   * and out at the bottom.
   */
  slide(secs: number, turns = 2): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.005;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = o.frequency;
      f.setValueAtTime(520, t);
      f.exponentialRampToValueAtTime(1250, t + 0.22);
      // round the turns: a swoop down and back up for each
      const coil = secs * 0.55;
      for (let k = 0; k < turns; k++) {
        const a = t + 0.22 + (coil / turns) * k;
        f.exponentialRampToValueAtTime(760, a + coil / turns / 2);
        f.exponentialRampToValueAtTime(1150 - k * 120, a + coil / turns);
      }
      f.exponentialRampToValueAtTime(420, t + secs);
      // a little vibrato, as a whistle has
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const lg = ctx.createGain();
      lg.gain.value = 14;
      lfo.connect(lg);
      lg.connect(f);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
      g.gain.setValueAtTime(0.09, t + secs - 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + secs + 0.05);
      g.connect(this.out!);
      o.connect(g);
      o.start(t);
      lfo.start(t);
      o.stop(t + secs + 0.1);
      lfo.stop(t + secs + 0.1);
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

  /** One drizzle drop landing: a tiny "plip" that bends upward, like a drop hitting water. */
  private droplet(ctx: AudioContext, at: number, gain: number): void {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = 1300 + Math.random() * 1100;
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 1.5, at + 0.03);
    o.connect(this.env(ctx, at, gain, 0.002, 0.045));
    o.start(at);
    o.stop(at + 0.07);
  }

  /**
   * Bath time nearby: level 0..1 (far off .. right over the cat). Call every
   * frame: drizzle drops plink now and then and soft bloops come, both more
   * often as it closes in.
   */
  bath(level: number, dt: number): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running' || !this.on) return;
      const l = Math.max(0, Math.min(1, level));
      if (l <= 0.05) {
        this.dropOwed = 0;
        this.bloopOwed = 0;
        return;
      }
      this.dropOwed += dt * (0.8 + 4.5 * l);
      if (this.dropOwed >= 1) {
        this.dropOwed = 0;
        this.droplet(ctx, ctx.currentTime + 0.01 + Math.random() * 0.04, 0.014 + l * 0.02);
      }
      this.bloopOwed += dt * (0.4 + 2.6 * l);
      if (this.bloopOwed >= 1) {
        this.bloopOwed = 0;
        this.bloop(ctx, ctx.currentTime + 0.01 + Math.random() * 0.05, 240 + Math.random() * 300, 0.03 + l * 0.04);
      }
    } catch {
      // ignore
    }
  }

  /** A loose bubble popping (quiet, and never too many at once). */
  pop(): void {
    try {
      const ctx = this.live();
      if (!ctx || ctx.currentTime - this.lastPop < 0.09) return;
      this.lastPop = ctx.currentTime;
      const t = ctx.currentTime + 0.005;
      // just the "plip" (a click of noise on every pop added up to static)
      this.bloop(ctx, t, 700 + Math.random() * 500, 0.04, 0.03);
    } catch {
      // ignore
    }
  }

  /** The foam swallows the cat: a soft low whump and a flurry of bubbles. */
  sploosh(): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
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
   * The foam pours on down to fill the screen: a soft, warm swell rising over
   * `secs` with bubbly bloops coming faster and faster.
   */
  fill(secs = 1.4): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.02;
      // the swell: two soft sines a fifth apart, rising a little, gently wobbling
      for (const [f, peak] of [
        [131, 0.05],
        [196, 0.03],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.26, t + secs);
        const wob = ctx.createOscillator();
        wob.frequency.value = 5;
        const wg = ctx.createGain();
        wg.gain.value = f * 0.012;
        wob.connect(wg);
        wg.connect(o.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + secs * 0.85);
        g.gain.setTargetAtTime(0.0001, t + secs, 0.22);
        o.connect(g);
        g.connect(this.out!);
        o.start(t);
        wob.start(t);
        o.stop(t + secs + 1.2);
        wob.stop(t + secs + 1.2);
      }
      // bubbles, faster and faster
      const n = 22;
      for (let k = 0; k < n; k++) {
        const at = t + secs * Math.sqrt((k + Math.random() * 0.6) / n);
        this.bloop(ctx, at, 220 + Math.random() * 520, 0.03 + 0.035 * (k / n), 0.05 + Math.random() * 0.04);
      }
    } catch {
      // ignore
    }
  }

  /** The foam slides away off the screen: a few soft glugs and the last bubbles. */
  drain(): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      for (let k = 0; k < 3; k++) {
        const at = t + k * 0.17;
        const o = ctx.createOscillator();
        o.type = 'sine';
        const f0 = 230 - k * 30;
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.55, at + 0.12);
        o.connect(this.env(ctx, at, 0.09, 0.01, 0.14));
        o.start(at);
        o.stop(at + 0.18);
      }
      for (let k = 0; k < 6; k++) this.bloop(ctx, t + 0.05 + k * 0.11 + Math.random() * 0.05, 300 + Math.random() * 500, 0.03, 0.04);
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
      // the water: one short, soft splash (no hissing spray after it)
      this.hiss(ctx, t, 'bandpass', 1100 - size * 300, 520, 0.8, 0.13 * v, 0.006, 0.26);
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

  /** In the bath: level 0..1. Call every frame: the odd low blub in the tub (no lapping loop: it hissed). */
  lap(level: number, dt: number): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running' || !this.on) return;
      const l = Math.max(0, Math.min(1, level));
      if (l <= 0.05) {
        this.blubOwed = 0;
        return;
      }
      this.blubOwed += dt * 0.4 * l;
      if (this.blubOwed >= 1) {
        this.blubOwed = 0;
        this.bloop(ctx, ctx.currentTime + 0.01, 150 + Math.random() * 120, 0.03 * l, 0.09);
      }
    } catch {
      // ignore
    }
  }

}
