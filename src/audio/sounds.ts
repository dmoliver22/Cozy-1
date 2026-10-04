// Sound recipes. Each renders one sound into a Float32Array with plain JS math
// (see dsp.ts); the engine wraps the result in an AudioBuffer and caches it.
// Every recipe normalises its own peak, so loudness is decided at playback.

import type { ImpactMaterial, PurrParams } from './audio';
import {
  ad,
  addGlide,
  addModes,
  addNoise,
  Biquad,
  clamp,
  control,
  curve,
  finish,
  midiHz,
  noiseGain,
  Reso,
  rng,
  smooth,
  TAU,
  type Curve,
} from './dsp';

const HALF_PI = Math.PI / 2;

// ---------------------------------------------------------------------------
// Purr

/** Laryngeal twitch rate of a relaxed house cat (Hz). */
const PURR_HZ = 26;

/** Breath envelope at position u (0..1) through a segment: 1 inhale (soft swell), 2 exhale (strong, tapering), else pause. */
function breathAt(kind: number, level: number, u: number): number {
  if (kind === 1) return level * smooth(0, 0.22, u) * (1 - smooth(0.8, 1, u)) * (0.88 + 0.12 * Math.sin(Math.PI * u));
  if (kind === 2) return level * smooth(0, 0.12, u) * (1 - smooth(0.74, 1, u)) * (1 - 0.2 * u);
  return 0;
}

/**
 * A seamless purr loop of two breaths: inhale quieter and a touch higher,
 * exhale louder and lower. Each laryngeal twitch (~26 Hz x rate) pings two
 * small body resonances (~210 and ~480 Hz x pitch, so phone speakers carry
 * it) and gates a burst of raspy noise; a whisper of hum at twice the pulse
 * rate adds warmth on headphones. Everything goes through a soft lowpass
 * (~620-900 Hz x pitch), then a gentle tanh saturation evens out the
 * twitch peaks. The buffer starts and ends mid-pause, so the loop seam is
 * silent.
 *
 * A generator: it yields every `slice` samples so the engine can spread the
 * ~5 s render over several frames instead of hitching one.
 */
export function* purrSlices(sr: number, p: PurrParams, seed: number, slice = 8192): Generator<void, Float32Array, void> {
  const r = rng(seed);
  const pitch = clamp(p.pitch, 0.6, 1.6);
  const rate = clamp(p.rate, 0.6, 1.6);
  const rough = clamp(p.rough, 0, 1);

  // Breath plan, starting and ending mid-pause.
  const pause = 0.17 / rate;
  const plan: { kind: number; level: number; secs: number; end: number }[] = [{ kind: 0, level: 0, secs: pause / 2, end: 0 }];
  for (let c = 0; c < 2; c++) {
    plan.push({ kind: 1, level: 0.55 + 0.1 * r(), secs: (0.95 + 0.2 * r()) / rate, end: 0 });
    plan.push({ kind: 0, level: 0, secs: (0.05 + 0.03 * r()) / rate, end: 0 });
    plan.push({ kind: 2, level: 1, secs: (1.2 + 0.25 * r()) / rate, end: 0 });
    plan.push({ kind: 0, level: 0, secs: c ? pause / 2 : pause, end: 0 });
  }
  let n = 0;
  for (const s of plan) s.end = n += Math.max(1, Math.round(s.secs * sr));
  const out = new Float32Array(n);

  const body = new Reso(sr);
  const body2 = new Reso(sr);
  const rasp = new Biquad(sr);
  const air = new Biquad(sr);
  const tone = new Biquad(sr);
  const dc = new Biquad(sr).set('hp', 50, 0.6);
  const A = 0.1; // twitch attack, as a share of the pulse period
  const K = 4.5 + 4 * rough; // twitch decay steepness: rougher purrs are snappier
  const BLOCK = 32;
  const smBlock = 1 - Math.exp(-BLOCK / (0.08 * sr)); // inhale/exhale pitch shift glides over ~80 ms
  let gRasp = 1;
  let gAir = 1;
  let lift = 0; // smoothed +1 inhale .. -1 exhale
  let seg = 0;
  let breath = 0;
  let dBreath = 0;
  let ph = r();
  let amp = 1;
  let jit = 1;
  let base = 0; // pulse phase increment before jitter
  let dph = 0;
  let dec = 1;
  let kDec = 1;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    if (i % BLOCK === 0) {
      if (i && i % slice === 0) yield;
      // Control rate: breath envelope (interpolated across the block), pitch lift and filters.
      const j = Math.min(n - 1, i + BLOCK);
      while (j >= plan[seg].end) seg++;
      const s = plan[seg];
      const segStart = seg ? plan[seg - 1].end : 0;
      dBreath = (breathAt(s.kind, s.level, (j - segStart) / (s.end - segStart)) - breath) / BLOCK;
      if (s.kind) lift += ((s.kind === 1 ? 1 : -1) - lift) * smBlock;
      const k = pitch * (1.02 + 0.06 * lift);
      body.set(210 * k, 3.5);
      body2.set(480 * k, 4);
      const fr = (700 + 400 * rough) * k;
      rasp.set('lp', fr, 0.8);
      gRasp = noiseGain(sr, 'lp', fr, 0.8);
      air.set('lp', 900 * k);
      gAir = noiseGain(sr, 'lp', 900 * k);
      tone.set('lp', (620 + 280 * rough) * k, 0.6);
      base = (PURR_HZ * rate * (1.01 + 0.04 * lift)) / sr;
      dph = base * jit;
      kDec = Math.exp(-K * dph);
    }
    // Pulse train: each wrap of `ph` is one twitch, with jittered strength and spacing.
    ph += dph;
    let kick = 0;
    if (ph >= 1) {
      ph -= 1;
      amp = 1 + (r() - 0.5) * (0.3 + 0.6 * rough);
      jit = 1 + (r() - 0.5) * (0.03 + 0.07 * rough);
      dph = base * jit;
      kDec = Math.exp(-K * dph);
      kick = amp;
      dec = 1;
    }
    let tw: number;
    if (ph < A) {
      const s = Math.sin(HALF_PI * (ph / A));
      tw = amp * s * s;
    } else {
      tw = amp * dec;
      dec *= kDec;
    }
    const w = r() * 2 - 1;
    const x =
      0.9 * body.run(kick) +
      0.5 * body2.run(kick) +
      (0.5 + 0.4 * rough) * tw * rasp.run(w) * gRasp +
      0.12 * tw * Math.sin(TAU * 2 * ph) +
      0.05 * air.run(w) * gAir;
    breath += dBreath;
    const y = dc.run(tone.run(x)) * breath;
    out[i] = y;
    if (y > peak) peak = y;
    else if (-y > peak) peak = -y;
  }
  // Gentle saturation: tame the twitch peaks so the purr sits fuller at the same 0.85 peak.
  const drive = peak > 0 ? 1.6 / peak : 0;
  const norm = 0.85 / Math.tanh(1.6);
  for (let i = 0; i < n; i++) {
    if (i % slice === 0) yield;
    out[i] = Math.tanh(out[i] * drive) * norm;
  }
  return out;
}

/** Synchronous purr render (tests, tools). */
export function renderPurr(sr: number, p: PurrParams, seed: number): Float32Array {
  const gen = purrSlices(sr, p, seed);
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
  }
}

// ---------------------------------------------------------------------------
// Impacts: rendered "hard"; playback sets loudness and a speed-dependent lowpass.

export const IMPACT_SECONDS: Record<ImpactMaterial, number> = {
  ceramic: 0.6,
  glass: 0.7,
  metal: 1.5,
  terracotta: 0.35,
  cardboard: 0.35,
  rubber: 0.32,
  wicker: 0.3,
  wood: 0.4,
  fabric: 0.35,
  wall: 0.45,
};

export function renderImpact(sr: number, m: ImpactMaterial, seed: number): Float32Array {
  const r = rng(seed);
  const vary = (x: number, amt = 0.12): number => x * (1 + (r() - 0.5) * amt);
  const out = new Float32Array(Math.ceil((IMPACT_SECONDS[m] ?? 0.3) * sr));
  // The soft pat of a furry body, under the material's own voice.
  const pat = (f1: number, f2: number, amp: number): void => addGlide(out, sr, { f1, f2, glide: 0.02, tau: 0.04, amp });
  switch (m) {
    case 'ceramic': // teacup: four inharmonic cup modes, short decay, soft 1.5 ms attack
      addModes(out, sr, vary(1320), [1, 2.32, 4.25, 6.63], [1, 0.5, 0.26, 0.12], [0.3, 0.17, 0.09, 0.05], 0.0015);
      addNoise(out, sr, r, { type: 'lp', f: 2600, attack: 0.0005, tau: 0.004, amp: 0.25 });
      pat(230, 150, 0.3);
      break;
    case 'glass': // thinner, higher, purer
      addModes(out, sr, vary(2150, 0.1), [1, 2.76, 5.4, 8.9], [1, 0.4, 0.15, 0.05], [0.34, 0.15, 0.07, 0.03], 0.001);
      addNoise(out, sr, r, { type: 'lp', f: 4000, attack: 0.0005, tau: 0.003, amp: 0.2 });
      pat(260, 170, 0.15);
      break;
    case 'metal': // soft-mallet "tonk": a near-unison pair beats slowly, long ring
      addModes(out, sr, vary(410, 0.1), [1, 1.007, 2.16, 3.51, 5.2], [0.8, 0.6, 0.5, 0.28, 0.12], [1, 0.9, 0.55, 0.3, 0.14], 0.003);
      addNoise(out, sr, r, { type: 'bp', f: 1800, q: 1, attack: 0.001, tau: 0.006, amp: 0.25 });
      pat(170, 120, 0.4);
      break;
    case 'terracotta': // clay: heavily damped modes and a gritty band of noise
      addModes(out, sr, vary(640), [1, 2.21, 3.73], [1, 0.45, 0.2], [0.065, 0.035, 0.018], 0.001);
      addNoise(out, sr, r, { type: 'bp', f: 1150, q: 1.3, attack: 0.0008, tau: 0.018, amp: 0.6 });
      pat(250, 170, 0.5);
      break;
    case 'cardboard': // papery "thup": boxy air thump plus a dry rustle and crinkles
      addNoise(out, sr, r, { type: 'bp', f: vary(520), q: 0.9, attack: 0.002, tau: 0.035, amp: 1.2 });
      addGlide(out, sr, { f1: 240, f2: 160, glide: 0.03, tau: 0.05, amp: 0.45, h2: 0.3 });
      addNoise(out, sr, r, { type: 'hp', f: 2600, attack: 0.001, tau: 0.012, amp: 0.22 });
      for (const at of [0.012 + 0.01 * r(), 0.03 + 0.015 * r()]) {
        addNoise(out, sr, r, { type: 'bp', f: 3200, q: 2, at, attack: 0.0004, tau: 0.004, amp: 0.15 });
      }
      break;
    case 'rubber':
      bwomp(out, sr, vary(200, 0.1));
      break;
    case 'wicker': {
      // rattly weave: a quick crackle of tiny clicks over a soft thud
      let at = 0.002;
      for (let k = 7 + Math.floor(r() * 4); k > 0; k--) {
        const amp = (0.35 + 0.65 * r()) * Math.exp(-at / 0.05);
        addNoise(out, sr, r, { type: 'bp', f: 1600 + 1800 * r(), q: 1.8, at, attack: 0.0004, tau: 0.003 + 0.003 * r(), amp });
        at += 0.007 + 0.008 * r();
      }
      addNoise(out, sr, r, { type: 'lp', f: 520, attack: 0.002, tau: 0.03, amp: 0.55 });
      pat(200, 150, 0.35);
      break;
    }
    case 'wood': // soft knuckle knock
      addModes(out, sr, vary(330), [1, 2.61, 4.2], [1, 0.4, 0.15], [0.085, 0.045, 0.022], 0.0015);
      addNoise(out, sr, r, { type: 'lp', f: 2000, attack: 0.0005, tau: 0.004, amp: 0.3 });
      break;
    case 'fabric': // muffled "pff": dark, breathy, barely any body
      addNoise(out, sr, r, { type: 'lp', f: vary(600), q: 0.6, attack: 0.01, tau: 0.06, amp: 1 });
      addNoise(out, sr, r, { type: 'lp', f: 1400, attack: 0.004, tau: 0.025, amp: 0.25 });
      pat(150, 120, 0.3);
      break;
    case 'wall': // soft thud: falling sine (plus octave, for phones) and dull noise
      addGlide(out, sr, { f1: vary(260), f2: 120, glide: 0.04, tau: 0.08, amp: 1, h2: 0.5 });
      addNoise(out, sr, r, { type: 'lp', f: 650, attack: 0.002, tau: 0.035, amp: 0.8 });
      break;
  }
  return finish(out, sr);
}

const BWOMP_PITCH: Curve = [
  [0, 1],
  [0.025, 1.55],
  [0.17, 0.75],
];
const BWOMP_LP: Curve = [
  [0, 1400],
  [0.18, 450],
];

/** Rubber boot "bwomp": a pitch-bent hollow tone through a closing resonant lowpass, plus a tiny sole squeak. */
function bwomp(out: Float32Array, sr: number, f0: number): void {
  const lp = new Biquad(sr);
  let ph = 0;
  let sq = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) lp.set('lp', curve(BWOMP_LP, t), 2.5);
    ph += (TAU * f0 * curve(BWOMP_PITCH, t)) / sr;
    sq += (TAU * 1550 * (1 + 0.28 * smooth(0, 0.05, t)) * (1 + 0.03 * Math.sin(TAU * 32 * t))) / sr;
    const hollow = Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph);
    out[i] += lp.run(hollow) * ad(t, 0.006, 0.07) + 0.12 * Math.sin(sq) * ad(t, 0.004, 0.03);
  }
}

// ---------------------------------------------------------------------------
// Glorp

const GLORP_PITCH: Curve = [
  [0, 0.8],
  [0.16, 1.32],
  [0.5, 1.16],
  [1, 0.7],
]; // "gl" rise, "o" hold, "rp" fall
const GLORP_MOUTH: Curve = [
  [0, 3],
  [0.3, 4.4],
  [0.7, 2.6],
  [1, 1.5],
]; // resonant lowpass cutoff (x f0): opens, then closes

/**
 * A wet-but-cute "glorp": a rounded tone with a rise-then-fall pitch contour
 * through a resonant lowpass that opens and closes like a mouth, a faint
 * slosh of noise, little bubbles for runny cats and a final plop for gooey
 * ones. Viscosity stretches it and lowers it; size lowers it.
 */
export function renderGlorp(sr: number, pitch: number, size: number, visc: number, seed: number): Float32Array {
  const r = rng(seed);
  const sz = clamp(size, 0, 1);
  const vi = clamp(visc, 0, 1);
  const f0 = Math.max(140, 235 * clamp(pitch, 0.5, 1.8) ** 0.85 * (1.18 - 0.36 * sz) * (1.1 - 0.3 * vi));
  const dur = 0.17 + 0.42 * vi + 0.1 * sz;
  const att = 0.02 + 0.05 * vi;
  const wob = 5 + 4 * (1 - vi);
  const n = Math.ceil((dur + 0.1) * sr);
  const out = new Float32Array(n);
  const dph = control(n, sr, (t) => (TAU * f0 * curve(GLORP_PITCH, t / dur) * (1 + 0.025 * Math.sin(TAU * wob * t) * smooth(0.15, 0.4, t / dur))) / sr);
  // soft onset, a little dip between "gl" and "orp", then the release
  const env = control(n, sr, (t) => smooth(0, att, t) * (1 - 0.3 * Math.exp(-(((t / dur - 0.17) / 0.06) ** 2))) * (1 - smooth(0.5, 1, t / dur)) ** 1.3);
  const mouth = new Biquad(sr);
  const slosh = new Biquad(sr).set('bp', f0 * 2.6, 2);
  const gSlosh = 0.1 * noiseGain(sr, 'bp', f0 * 2.6, 2);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) mouth.set('lp', f0 * curve(GLORP_MOUTH, i / sr / dur), 3.2);
    ph += dph[i];
    // harmonics 1-4 from one sin/cos pair
    const s1 = Math.sin(ph);
    const c1 = Math.cos(ph);
    const s2 = 2 * s1 * c1;
    const c2 = 1 - 2 * s1 * s1;
    const src = s1 + 0.4 * s2 + 0.18 * s1 * (3 - 4 * s1 * s1) + 0.08 * 2 * s2 * c2;
    out[i] = (mouth.run(src) + slosh.run(r() * 2 - 1) * gSlosh) * env[i];
  }
  if (vi < 0.7) {
    for (let k = vi < 0.3 ? 2 : 1; k > 0; k--) {
      const f = f0 * (2.3 + 0.9 * r());
      addGlide(out, sr, { f1: f, f2: f * 1.6, glide: 0.012, tau: 0.015, amp: 0.22 * (1 - vi), attack: 0.002, at: dur * (0.55 + 0.35 * r()) });
    }
  }
  if (vi > 0.4) addGlide(out, sr, { f1: f0 * 1.9, f2: f0 * 2.6, glide: 0.01, tau: 0.012, amp: 0.18 * vi, attack: 0.002, at: dur * 0.96 });
  return finish(out, sr);
}

// ---------------------------------------------------------------------------
// Cat voice: "mrrp?" (boop) and "mrrow" (grab)

interface MewShape {
  dur: number;
  f0: number;
  pitch: Curve; // x f0
  f1: Curve; // first formant (x ~520 Hz)
  f2: Curve; // second formant (Hz)
  trill: readonly [from: number, to: number, hz: number, depth: number]; // the rolled "rr"
  vib: number;
}

const MEWS: Record<'boop' | 'mrrow', MewShape> = {
  boop: {
    dur: 0.2,
    f0: 480,
    pitch: [
      [0, 0.94],
      [0.3, 0.9],
      [0.62, 1],
      [1, 1.45],
    ], // the questioning lift at the end
    f1: [
      [0, 0.75],
      [0.35, 1.5],
      [1, 1.75],
    ],
    f2: [
      [0, 1500],
      [1, 2200],
    ],
    trill: [0.12, 0.55, 28, 0.45],
    vib: 0,
  },
  mrrow: {
    dur: 0.34,
    f0: 400,
    pitch: [
      [0, 0.86],
      [0.32, 1.12],
      [0.7, 1],
      [1, 0.8],
    ],
    f1: [
      [0, 0.7],
      [0.3, 1.65],
      [0.75, 1.35],
      [1, 0.8],
    ], // m - (r) - ow: mouth opens then rounds
    f2: [
      [0, 1300],
      [0.4, 1850],
      [1, 1050],
    ],
    trill: [0.05, 0.28, 26, 0.35],
    vib: 0.015,
  },
};

/**
 * A tiny cat vocalisation: a band-limited buzzy source (harmonics via the
 * Chebyshev sine recurrence, 1/n^1.2 rolloff) shaped by two moving formant
 * bandpasses, with a flutter for the rolled "rr".
 */
export function renderMew(sr: number, pitch: number, kind: 'boop' | 'mrrow', seed: number): Float32Array {
  const m = MEWS[kind];
  const r = rng(seed);
  const pt = clamp(pitch, 0.5, 1.8);
  const dur = m.dur / pt ** 0.25;
  const f0 = m.f0 * pt;
  const fF1 = 520 * pt ** 0.4;
  const fF2 = pt ** 0.3;
  const nH = clamp(Math.floor((0.45 * sr) / (f0 * 1.6)), 1, 12);
  const wts: number[] = [];
  for (let k = 0; k <= nH; k++) wts.push(k ? 1 / k ** 1.2 : 0);
  const [ta, tb, tHz, depth] = m.trill;
  const vibHz = 5.5 + r();
  const b1 = new Biquad(sr);
  const b2 = new Biquad(sr);
  const lp = new Biquad(sr).set('lp', f0 * 1.6, 0.7);
  const n = Math.ceil((dur + 0.02) * sr);
  const out = new Float32Array(n);
  const dph = control(n, sr, (t) => (TAU * f0 * curve(m.pitch, t / dur) * (1 + m.vib * Math.sin(TAU * vibHz * t) * smooth(0.3, 0.6, t / dur))) / sr);
  // envelope with the "rr" flutter
  const env = control(
    n,
    sr,
    (t) => {
      const u = t / dur;
      const trill = 1 - depth * smooth(ta, ta + 0.08, u) * (1 - smooth(tb - 0.08, tb, u)) * (0.5 + 0.5 * Math.cos(TAU * tHz * t));
      return smooth(0, 0.014 / dur, u) * (1 - smooth(0.8, 1, u)) * trill;
    },
    8,
  );
  let ph = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) {
      const u = i / sr / dur;
      b1.set('bp', fF1 * curve(m.f1, u), 4);
      b2.set('bp', fF2 * curve(m.f2, u), 6);
    }
    ph += dph[i];
    if (ph > TAU) ph -= TAU;
    // sin(k ph) = 2 cos(ph) sin((k-1) ph) - sin((k-2) ph)
    const c2 = 2 * Math.cos(ph);
    let s0 = 0;
    let s1 = Math.sin(ph);
    let src = s1;
    for (let k = 2; k <= nH; k++) {
      const s2 = c2 * s1 - s0;
      s0 = s1;
      s1 = s2;
      src += s2 * wts[k];
    }
    out[i] = (0.65 * b1.run(src) + 0.3 * b2.run(src) + 0.2 * lp.run(src)) * env[i];
  }
  return finish(out, sr);
}

/** Sleepy sigh: breathy noise through two formants sweeping down ("haaah"), with a faint hummed "mm". */
export function renderSigh(sr: number, pitch: number, seed: number): Float32Array {
  const r = rng(seed);
  const pt = clamp(pitch, 0.5, 1.8);
  const n = Math.ceil(0.95 * sr);
  const out = new Float32Array(n);
  const env = control(n, sr, (t) => smooth(0, 0.16, t / 0.95) * (1 - smooth(0.35, 1, t / 0.95)) ** 1.2);
  const hum = control(n, sr, (t) => 0.12 * smooth(0.05, 0.2, t / 0.95) * (1 - smooth(0.3, 0.8, t / 0.95)));
  const f1 = new Biquad(sr);
  const f2 = new Biquad(sr);
  const air = new Biquad(sr);
  let g1 = 1;
  let g2 = 1;
  let ga = 1;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 31) === 0) {
      const a = 1150 * (480 / 1150) ** u * pt ** 0.4;
      const b = 2400 * (1450 / 2400) ** u * pt ** 0.3;
      const c = 1500 * (700 / 1500) ** u;
      f1.set('bp', a, 3.5);
      f2.set('bp', b, 5);
      air.set('lp', c, 0.7);
      g1 = noiseGain(sr, 'bp', a, 3.5);
      g2 = noiseGain(sr, 'bp', b, 5);
      ga = noiseGain(sr, 'lp', c, 0.7);
    }
    const w = r() * 2 - 1;
    ph += (TAU * 165 * pt * (1 - 0.1 * u)) / sr;
    out[i] = (0.55 * f1.run(w) * g1 + 0.25 * f2.run(w) * g2 + 0.3 * air.run(w) * ga) * env[i] + hum[i] * Math.sin(ph);
  }
  return finish(out, sr);
}

// ---------------------------------------------------------------------------
// UI

/** Undo: a reverse whoosh. Noise through a rising bandpass with a swelling envelope that stops softly. */
export function renderWhoosh(sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const n = Math.ceil(0.4 * sr);
  const out = new Float32Array(n);
  const env = control(n, sr, (t) => (t / 0.4) ** 2.4 * (1 - smooth(0.86, 1, t / 0.4)));
  const dph = control(n, sr, (t) => (TAU * 320 * (760 / 320) ** (t / 0.4)) / sr); // faint "rewind" whistle
  const b1 = new Biquad(sr);
  const b2 = new Biquad(sr);
  let g1 = 1;
  let g2 = 1;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 31) === 0) {
      const f = 450 * (1900 / 450) ** u;
      b1.set('bp', f, 1.2);
      b2.set('bp', f * 1.7, 2);
      g1 = noiseGain(sr, 'bp', f, 1.2);
      g2 = noiseGain(sr, 'bp', f * 1.7, 2);
    }
    ph += dph[i];
    const w = r() * 2 - 1;
    out[i] = (0.7 * b1.run(w) * g1 + 0.35 * b2.run(w) * g2 + 0.18 * Math.sin(ph)) * env[i];
  }
  return finish(out, sr);
}

/** UI tick: a tiny falling sine pop with a whisper of contact noise. */
export function renderClick(sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.ceil(0.07 * sr));
  const f = 1100 * (1 + (r() - 0.5) * 0.12);
  addGlide(out, sr, { f1: f, f2: f * 0.56, glide: 0.012, tau: 0.014, amp: 1, attack: 0.0008 });
  addNoise(out, sr, r, { type: 'lp', f: 4000, attack: 0.0003, tau: 0.0018, amp: 0.2 });
  return finish(out, sr);
}

/**
 * Kalimba-like chime: a strong fundamental with a slowly beating twin, a soft
 * third harmonic and the tine's bright ~5.9x "plink". `sparkle` adds glassy
 * upper partials.
 */
export function renderBell(sr: number, midi: number, sparkle: boolean, seed: number): Float32Array {
  const r = rng(seed);
  const f = midiHz(midi);
  const out = new Float32Array(Math.ceil((sparkle ? 1.8 : 1.4) * sr));
  addModes(out, sr, f, [1, 1.0016, 3, 5.93], [1, 0.35, 0.07, 0.11], [0.6, 0.5, 0.2, 0.05], 0.003);
  if (sparkle) addModes(out, sr, f, [2, 4.16, 8.3], [0.14, 0.08, 0.03], [0.5, 0.3, 0.12], 0.004);
  addNoise(out, sr, r, { type: 'bp', f: 3000, q: 1, attack: 0.0003, tau: 0.003, amp: 0.06 });
  return finish(out, sr);
}

// ---------------------------------------------------------------------------
// Music instruments

/**
 * Soft felt piano note. Additive: up to 8 slightly stretched partials (string
 * stiffness), a hammer-position comb on their levels, a lowpass-ish rolloff,
 * a two-stage decay (prompt + aftersound, higher partials die faster), a slow
 * beat between the two strings of each unison, a felt thump, and a 6 ms
 * soft attack. Peak is normalised to 0.5.
 */
export function renderPiano(sr: number, midi: number, seed: number): Float32Array {
  const r = rng(seed);
  const f0 = midiHz(midi);
  const out = new Float32Array(Math.ceil(clamp(3.6 - (midi - 36) * 0.045, 1.6, 3.6) * sr));
  const B = 0.00025 * 2 ** ((midi - 48) / 20);
  const tau = clamp(1.25 * 2 ** (-(midi - 48) / 24), 0.3, 1.6);
  const fMax = Math.min(sr * 0.45, 5500);
  for (let h = 1; h <= 8; h++) {
    const f = h * f0 * Math.sqrt(1 + B * h * h);
    if (f > fMax) break;
    // hammer-position comb, gentle rolloff, and (like a real piano) weak fundamentals in the bass
    const amp = ((0.45 + 0.55 * Math.abs(Math.sin(Math.PI * h * 0.13))) * (f / (f + 110))) / (h ** 1.35 * (1 + (f / 2600) ** 2));
    const t1 = tau / (1 + 0.45 * (h - 1));
    const t2 = 3.2 * t1;
    const w = (TAU * f) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const wb = (TAU * f * (0.0006 + 0.0006 * r())) / sr;
    const cb = Math.cos(wb);
    const sb = Math.sin(wb);
    const k1 = Math.exp(-1 / (t1 * sr));
    const k2 = Math.exp(-1 / (t2 * sr));
    const b0 = r() * TAU;
    let c = 1;
    let s = 0;
    let bc = Math.cos(b0);
    let bs = Math.sin(b0);
    let e1 = 0.72 * amp;
    let e2 = 0.28 * amp;
    const n = Math.min(out.length, Math.ceil(t2 * 7 * sr));
    for (let i = 0; i < n; i++) {
      out[i] += s * (e1 + e2) * (0.8 + 0.2 * bc);
      e1 *= k1;
      e2 *= k2;
      const nc = c * cw - s * sw;
      s = s * cw + c * sw;
      c = nc;
      const nbc = bc * cb - bs * sb;
      bs = bs * cb + bc * sb;
      bc = nbc;
    }
  }
  addNoise(out, sr, r, { type: 'lp', f: 900, attack: 0.001, tau: 0.012, amp: 0.04 });
  const na = Math.round(0.006 * sr);
  for (let i = 0; i < na; i++) out[i] *= Math.sin(HALF_PI * (i / na)) ** 2;
  return finish(out, sr, 0.5, 0.25);
}

/** Very soft, muted kick: a felt-beater pitch drop (with an octave so phones hear a hint of it). */
export function renderKick(sr: number): Float32Array {
  const r = rng(7);
  const out = new Float32Array(Math.ceil(0.4 * sr));
  addGlide(out, sr, { f1: 140, f2: 52, glide: 0.03, tau: 0.1, amp: 1, attack: 0.004, h2: 0.35 });
  addNoise(out, sr, r, { type: 'lp', f: 280, attack: 0.002, tau: 0.015, amp: 0.18 });
  return finish(out, sr);
}

/**
 * Brush on a snare: band-passed noise with a bristly grain. `sweep` is the
 * slow circular swish (soft swell); otherwise the "slap" on 2 and 4, whose
 * attack is still a gentle 18 ms.
 */
export function renderBrush(sr: number, sweep: boolean, seed: number): Float32Array {
  const r = rng(seed);
  const dur = sweep ? 0.75 : 0.35;
  const q = sweep ? 0.5 : 0.7;
  const out = new Float32Array(Math.ceil(dur * sr));
  const bp = new Biquad(sr);
  const hp = new Biquad(sr).set('hp', 700);
  const soft = new Biquad(sr).set('lp', sweep ? 6000 : 7000);
  const grain = new Biquad(sr).set('lp', 1500);
  const gGrain = noiseGain(sr, 'lp', 1500);
  let g = 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      const f = sweep ? 1800 * 1.56 ** (t / dur) : 2700;
      bp.set('bp', f, q);
      g = noiseGain(sr, 'bp', f, q);
    }
    const env = sweep
      ? smooth(0, 0.28, t) * Math.exp(-Math.max(0, t - 0.28) / 0.15) * (0.85 + 0.15 * Math.sin(TAU * 3 * t))
      : ad(t, 0.018, 0.08);
    const bristle = 0.7 + 0.5 * Math.abs(grain.run(r() * 2 - 1) * gGrain);
    out[i] = soft.run(hp.run(bp.run(r() * 2 - 1) * g)) * env * bristle;
  }
  return finish(out, sr);
}

/** Light closed hi-hat tick. */
export function renderTick(sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.ceil(0.07 * sr));
  addNoise(out, sr, r, { type: 'hp', f: 7000, attack: 0.0005, tau: 0.011, amp: 0.7 });
  addNoise(out, sr, r, { type: 'bp', f: 9500, q: 1, attack: 0.0005, tau: 0.008, amp: 0.4 });
  return finish(out, sr);
}

/**
 * Stereo reverb impulse response: exponentially decaying noise (RT60 ~0.85 x
 * length) whose tail darkens (one-pole lowpass sweeping 6.5 kHz -> 900 Hz),
 * a 12 ms pre-delay and a few early reflections.
 */
export function renderIR(sr: number, seconds: number, seed: number): [Float32Array, Float32Array] {
  const make = (s: number): Float32Array => {
    const r = rng(s);
    const n = Math.ceil(seconds * sr);
    const x = new Float32Array(n);
    const pre = Math.round(0.012 * sr);
    const decay = Math.exp(-6.9 / (seconds * 0.85 * sr));
    const fadeIn = 0.008 * sr;
    let env = 1;
    let lp = 0;
    let a = 1;
    for (let i = pre; i < n; i++) {
      const j = i - pre;
      if ((j & 63) === 0) a = 1 - Math.exp((-TAU * 6500 * (900 / 6500) ** (j / (n - pre))) / sr);
      lp += a * (r() * 2 - 1 - lp);
      x[i] = lp * env * Math.min(1, j / fadeIn);
      env *= decay;
    }
    for (let k = 0; k < 6; k++) x[pre + Math.round((0.006 + 0.04 * r()) * sr)] += (r() < 0.5 ? -0.5 : 0.5) * (1 - 0.12 * k);
    return x;
  };
  return [make(seed), make(seed + 1)];
}
