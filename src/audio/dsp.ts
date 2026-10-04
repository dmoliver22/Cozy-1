// Offline DSP kit. Every sound in the game is rendered with plain JS math into
// Float32Arrays, which the engine then wraps in AudioBuffers. Pure and
// DOM-free, so recipes run (and can be tested) in Node.

export const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export type Rand = () => number;
/** Breakpoints [x, y], x ascending. */
export type Curve = readonly (readonly [number, number])[];
export type FilterType = 'lp' | 'hp' | 'bp';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Smoothstep: 0 at x <= a, 1 at x >= b. */
export function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** mulberry32: seeded floats in [0, 1). */
export function rng(seed: number): Rand {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash (cache keys -> render seeds). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Eased walk through breakpoints; flat beyond the ends. */
export function curve(pts: Curve, x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x < x1) {
      const [x0, y0] = pts[i - 1];
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t * t * (3 - 2 * t);
    }
  }
  return pts[pts.length - 1][1];
}

/** sin² fade-in over `a` seconds, then exponential decay with time constant `tau`. */
export function ad(t: number, a: number, tau: number): number {
  if (t <= 0) return 0;
  if (t < a) {
    const s = Math.sin(HALF_PI * (t / a));
    return s * s;
  }
  return Math.exp(-(t - a) / tau);
}

/** RBJ-cookbook biquad (transposed direct form II). Call `set` again (e.g. every 32 samples) to sweep. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(private readonly sr: number) {}

  set(type: FilterType, freq: number, q = Math.SQRT1_2): this {
    const w = (TAU * clamp(freq, 10, this.sr * 0.45)) / this.sr;
    const cw = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    if (type === 'bp') {
      this.b0 = al / a0;
      this.b1 = 0;
      this.b2 = -al / a0;
    } else {
      const k = (type === 'lp' ? 1 - cw : 1 + cw) / 2 / a0;
      this.b0 = k;
      this.b1 = type === 'lp' ? 2 * k : -2 * k;
      this.b2 = k;
    }
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Two-pole resonator normalised to a ~unit impulse response peak: "ping" it with impulses. */
export class Reso {
  private y1 = 0;
  private y2 = 0;
  private c1 = 0;
  private c2 = 0;
  private g = 0;

  constructor(private readonly sr: number) {}

  set(freq: number, q: number): this {
    const w = (TAU * freq) / this.sr;
    const r = Math.exp((-Math.PI * freq) / q / this.sr);
    this.c1 = 2 * r * Math.cos(w);
    this.c2 = -r * r;
    this.g = Math.sin(w);
    return this;
  }

  run(x: number): number {
    const y = this.c1 * this.y1 + this.c2 * this.y2 + x * this.g;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Gain that brings uniform white noise through the given filter to ~0.35 RMS, so recipe mixes read as levels. */
export function noiseGain(sr: number, type: FilterType, f: number, q = Math.SQRT1_2): number {
  const nyq = sr / 2;
  const bw = type === 'bp' ? (HALF_PI * f) / q : type === 'lp' ? 1.1 * f : nyq - f;
  return 0.6 / Math.sqrt(clamp(bw, 20, nyq) / nyq);
}

export interface Burst {
  type: FilterType;
  f: number;
  q?: number;
  /** Start time (s). */
  at?: number;
  attack: number;
  tau: number;
  amp: number;
}

/** Mix a filtered-noise burst (sin² attack, exponential decay) into `out`. */
export function addNoise(out: Float32Array, sr: number, r: Rand, b: Burst): void {
  const q = b.q ?? Math.SQRT1_2;
  const flt = new Biquad(sr).set(b.type, b.f, q);
  const g = b.amp * noiseGain(sr, b.type, b.f, q);
  const n0 = Math.round((b.at ?? 0) * sr);
  const n = Math.min(out.length - n0, Math.ceil((b.attack + b.tau * 7) * sr));
  const na = b.attack * sr;
  const k = Math.exp(-1 / (b.tau * sr));
  let env = 1;
  for (let i = 0; i < n; i++) {
    let e: number;
    if (i < na) {
      const s = Math.sin(HALF_PI * (i / na));
      e = s * s;
    } else {
      e = env;
      env *= k;
    }
    out[n0 + i] += flt.run(r() * 2 - 1) * g * e;
  }
}

/** One struck mode: an exponentially decaying sine (rotating phasor, no Math.sin per sample). */
export function addMode(out: Float32Array, sr: number, f: number, amp: number, tau: number, attack = 0.002, at = 0): void {
  if (f <= 0 || f >= sr * 0.47) return;
  const n0 = Math.round(at * sr);
  const n = Math.min(out.length - n0, Math.ceil(tau * 7 * sr));
  const w = (TAU * f) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const k = Math.exp(-1 / (tau * sr));
  const na = Math.max(1, attack * sr);
  let c = 1;
  let s = 0;
  let env = amp;
  for (let i = 0; i < n; i++) {
    let a = env;
    if (i < na) {
      const q = Math.sin(HALF_PI * (i / na));
      a *= q * q;
    }
    out[n0 + i] += s * a;
    const nc = c * cw - s * sw;
    s = s * cw + c * sw;
    c = nc;
    env *= k;
  }
}

/** A set of modes sharing a fundamental: the classic recipe for clinks, tonks and knocks. */
export function addModes(
  out: Float32Array,
  sr: number,
  f0: number,
  ratios: readonly number[],
  amps: readonly number[],
  taus: readonly number[],
  attack = 0.002,
): void {
  for (let i = 0; i < ratios.length; i++) addMode(out, sr, f0 * ratios[i], amps[i], taus[i], attack);
}

export interface Glide {
  /** Start and end frequency; the pitch slides exponentially from f1 toward f2. */
  f1: number;
  f2: number;
  /** Pitch-slide time constant (s). */
  glide: number;
  /** Amplitude decay time constant (s). */
  tau: number;
  amp: number;
  attack?: number;
  at?: number;
  /** Level of an added octave (lets phone speakers hear low thumps). */
  h2?: number;
}

/** A sine with a pitch slide: thumps (falling), bubbles and pops (rising). */
export function addGlide(out: Float32Array, sr: number, o: Glide): void {
  const attack = o.attack ?? 0.003;
  const h2 = o.h2 ?? 0;
  const n0 = Math.round((o.at ?? 0) * sr);
  const n = Math.min(out.length - n0, Math.ceil((attack + o.tau * 7) * sr));
  const na = attack * sr;
  const k = Math.exp(-1 / (o.tau * sr));
  const gk = Math.exp(-1 / (o.glide * sr));
  let df = o.f1 - o.f2;
  let ph = 0;
  let env = 1;
  for (let i = 0; i < n; i++) {
    ph += (TAU * (o.f2 + df)) / sr;
    df *= gk;
    let e: number;
    if (i < na) {
      const s = Math.sin(HALF_PI * (i / na));
      e = s * s;
    } else {
      e = env;
      env *= k;
    }
    out[n0 + i] += o.amp * e * (Math.sin(ph) + h2 * Math.sin(2 * ph));
  }
}

/** Fade the last `fadeOut` seconds (so truncated tails never click) and scale the peak to `peak`. */
export function finish(x: Float32Array, sr: number, peak = 0.9, fadeOut = 0.01): Float32Array {
  const nf = Math.min(x.length, Math.round(fadeOut * sr));
  for (let i = 0; i < nf; i++) x[x.length - 1 - i] *= i / nf;
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  if (m > 1e-9 && Number.isFinite(m)) {
    const g = peak / m;
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  return x;
}
