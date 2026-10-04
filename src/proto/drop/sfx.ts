// Cat Drop: a few sounds the game's AudioEngine doesn't have, synthesised on a
// small Web Audio graph of their own: a "nom nom", a cushion's "boing", the
// vacuum's motor (a loop that swells as it closes in) and the final slurp.
// Like the engine, every method is a quiet no-op until unlock() and never throws.

type CtxCtor = new (o?: AudioContextOptions) => AudioContext;

export class DropSfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private humGain: GainNode | null = null;
  private humFilter: BiquadFilterNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private whine: OscillatorNode | null = null;
  private noise: AudioBuffer | null = null;
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

  /** The vacuum's motor: level 0..1 (silence .. right on top of you). Call every frame. */
  hum(level: number): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      if (!this.humGain) {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(this.out!);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 400;
        f.Q.value = 2;
        f.connect(g);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 62;
        o.connect(f);
        o.start();
        const w = ctx.createOscillator();
        w.type = 'triangle';
        w.frequency.value = 410;
        const wg = ctx.createGain();
        wg.gain.value = 0.18;
        w.connect(wg);
        wg.connect(f);
        w.start();
        // the rush of air
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 0.7;
        const ng = ctx.createGain();
        ng.gain.value = 0.5;
        src.connect(bp);
        bp.connect(ng);
        ng.connect(g);
        src.start();
        this.humGain = g;
        this.humFilter = f;
        this.humOsc = o;
        this.whine = w;
      }
      const l = Math.max(0, Math.min(1, level));
      const now = ctx.currentTime;
      this.humGain.gain.setTargetAtTime(this.on ? l * l * 0.22 : 0, now, 0.12);
      this.humFilter!.frequency.setTargetAtTime(300 + l * 1500, now, 0.15);
      this.humOsc!.frequency.setTargetAtTime(58 + l * 18, now, 0.2);
      this.whine!.frequency.setTargetAtTime(380 + l * 160, now, 0.2);
    } catch {
      // ignore
    }
  }

  /** Sucked up: a rising slurp. */
  slurp(): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.75);
      src.connect(bp);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
      g.gain.setValueAtTime(0.5, t + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      g.connect(this.out!);
      bp.connect(g);
      src.start(t);
      src.stop(t + 0.9);
      // and a little falling "mrrrow?"
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(700, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(1100, t + 0.3);
      o.frequency.exponentialRampToValueAtTime(380, t + 0.75);
      o.connect(this.env(ctx, t + 0.05, 0.1, 0.05, 0.7));
      o.start(t + 0.05);
      o.stop(t + 0.85);
    } catch {
      // ignore
    }
  }

  /** A soft two-note warning when the vacuum first gets close. */
  warn(): void {
    try {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime + 0.01;
      [0, 0.16].forEach((dt, i) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = i ? 392 : 523;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1400;
        o.connect(f);
        f.connect(this.env(ctx, t + dt, 0.05, 0.01, 0.14));
        o.start(t + dt);
        o.stop(t + dt + 0.18);
      });
    } catch {
      // ignore
    }
  }
}
