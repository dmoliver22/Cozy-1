// If It Fits: audio engine. There are no assets; everything is synthesised at
// runtime. Recipes in sounds.ts render Float32Arrays with plain JS math (cached
// here as AudioBuffers), music.ts composes lo-fi piano + brushes bar by bar,
// and this class owns a small Web Audio graph:
//
//   one-shots ───────────────────────────┐
//   purr voices → purrBus → purrSwell ───┴→ sfx ───┐
//   piano → soft lowpass ─┐                        ├→ master → compressor → speakers
//   drums ────────────────┴→ duck → music ─────────┤
//   music + chime sends → reverb (noise IR) ───────┘
//
// The constructor never touches browser globals and every method is a quiet
// no-op until unlock() has created a context, so this imports fine in Node.
// Public methods never throw; the last swallowed error is kept in `lastError`.

import { clamp, hash } from './dsp';
import { Composer, FLOURISH, PIANO_NOTES, SPB, type DrumKind } from './music';
import {
  purrSlices,
  renderBell,
  renderBoing,
  renderBrush,
  renderClick,
  renderGlorp,
  renderHiss,
  renderImpact,
  renderIR,
  renderKick,
  renderMew,
  renderNom,
  renderPiano,
  renderScratch,
  renderSigh,
  renderTick,
  renderWhoosh,
} from './sounds';

export type ImpactMaterial = 'ceramic' | 'cardboard' | 'rubber' | 'metal' | 'wicker' | 'wood' | 'fabric' | 'glass' | 'terracotta' | 'wall';

/** pitch ~0.75..1.35 (1 = normal), rate ~0.8..1.25 (breathing/pulse speed multiplier), rough 0..1 (rumble roughness). */
export interface PurrParams {
  pitch: number;
  rate: number;
  rough: number;
}

// ---- Levels (linear gain). Recipes are peak-normalised; loudness lives here.
const MASTER = 1;
const MUSIC_LEVEL = 0.2; // the music bus sits ~14 dB under the sfx bus (audible on phone speakers, still in the background)
const MUSIC_VERB = 0.6; // music -> reverb send
const CHIME_VERB = 0.7; // chimes / flourish -> reverb send
const PURR_GAIN = 0.3;
const PIANO_GAIN = 0.9; // background piano (before the music bus)
const FLOURISH_GAIN = 0.4; // reveal flourish (on the sfx bus)
const MATERIAL_GAIN: Record<ImpactMaterial, number> = {
  ceramic: 0.8,
  glass: 0.65,
  metal: 0.7,
  terracotta: 0.9,
  cardboard: 1,
  rubber: 0.85,
  wicker: 0.85,
  wood: 0.9,
  fabric: 0.75,
  wall: 0.9,
};
const DRUM_GAIN: Record<DrumKind, number> = { kick: 0.7, slap: 0.45, sweep: 0.5, tick: 0.25 };

// ---- Timing
const LOOKAHEAD = 0.2; // seconds of music scheduled ahead
const TICK_MS = 25; // scheduler period
const PURR_TC = 0.4; // purr level smoothing time constant (s)
const PURR_REST = 2.2; // seconds at zero before a purr voice is released
const MAX_VOICES = 48; // one-shot polyphony cap
const LO_RATE = 24000; // render rate for sounds with little top end (purrs, piano, voices, chimes)
const IMPACT_VARIANTS = 2;
const MATERIALS: readonly ImpactMaterial[] = ['ceramic', 'cardboard', 'rubber', 'metal', 'wicker', 'wood', 'fabric', 'glass', 'terracotta', 'wall'];

type CtxCtor = new (options?: AudioContextOptions) => AudioContext;
const RETRY_EVENTS = ['touchend', 'click'] as const;

interface Graph {
  ctx: AudioContext;
  sfx: GainNode;
  sfxVerb: GainNode;
  purrBus: GainNode;
  purrSwell: GainNode;
  music: GainNode;
  duck: GainNode;
  piano: AudioNode;
  drums: GainNode;
  verb: ConvolverNode;
}

interface PurrVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: AudioNode | null;
  params: PurrParams;
  target: number;
  zeroAt: number;
  seen: number;
}

interface PlayOpts {
  at?: number;
  rate?: number;
  lp?: number;
  pan?: number;
  verb?: number;
  dest?: AudioNode;
}

interface MusicEv {
  t: number;
  midi: number;
  vel: number;
  len: number;
  drum: DrumKind | null;
}

interface Held {
  src: AudioBufferSourceNode;
  gain: GainNode;
  at: number;
}

/** Quantise a parameter for cache keys (NaN-safe). */
const quant = (x: number, step: number, fallback: number): number =>
  Number((Math.round((Number.isFinite(x) ? x : fallback) / step) * step).toFixed(3));
const loRate = (g: Graph): number => Math.min(g.ctx.sampleRate, LO_RATE);
const jitter = (amount: number): number => 1 + (Math.random() - 0.5) * amount;
/** Piano notes are rendered every 3 semitones and repitched by at most +-1.5. */
const zoneOf = (midi: number): number => 3 * Math.round(midi / 3);
/** Same purr voice? (Params are constant per cat; a big change means the id was reused.) */
const samePurr = (a: PurrParams, b: PurrParams): boolean =>
  !b || (Math.abs(a.pitch - b.pitch) < 0.03 && Math.abs(a.rate - b.rate) < 0.03 && Math.abs(a.rough - b.rough) < 0.15) || !Number.isFinite(b.pitch + b.rate + b.rough);

export class AudioEngine {
  /** Last error swallowed internally (debugging aid only). */
  lastError: unknown = null;

  private g: Graph | null = null;
  private sfxOn = true;
  private musicOn = true;
  private musicWanted = false;
  private resumeAt = -1e9; // Date.now() of the last resume request
  private resumeOnShow = false;
  private voices = 0;

  private readonly bufs = new Map<string, AudioBuffer>(); // LRU of rendered recipes
  private readonly zones = new Map<number, AudioBuffer>(); // piano zones
  private readonly lastAt = new Map<string, number>(); // cooldowns (context time)
  private hits: number[] = []; // recent impact times
  private warmJobs: ((g: Graph) => boolean)[] = []; // each returns true when finished
  private warmTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly purrJobs = new Map<string, Generator<void, Float32Array, void>>(); // purr buffers being rendered in slices
  private purrFrameAt = -1e9; // performance.now() when the current frame's render budget began
  private purrBudget = 0; // ms of purr rendering left this frame
  private readonly purrs = new Map<number, PurrVoice>();
  private purrTimer: ReturnType<typeof setInterval> | undefined;
  private purrCount = -1;

  private musicTimer: ReturnType<typeof setInterval> | undefined;
  private composer: Composer | null = null;
  private barAt = -1;
  private queue: MusicEv[] = [];
  private readonly held = new Set<Held>();
  private duckUntil = 0;
  private duckDepth = 0;
  private seatAt = 0;

  // ---------------------------------------------------------------- lifecycle

  /** Call from a user gesture (pointerdown/click/keydown). Creates or resumes the AudioContext. Idempotent and safe to call on every gesture. */
  unlock(): void {
    try {
      if (this.g?.ctx.state === 'closed') this.teardown();
      if (!this.g) {
        this.g = this.build();
        if (!this.g) return;
        this.startWarmup();
      }
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (this.g.ctx.state !== 'running' && !hidden) this.resume(this.g);
      this.syncMusic();
    } catch (e) {
      this.oops(e);
    }
  }

  /** Context exists and is running. */
  get ready(): boolean {
    return !!this.g && this.g.ctx.state === 'running';
  }

  get sfxEnabled(): boolean {
    return this.sfxOn;
  }

  get musicEnabled(): boolean {
    return this.musicOn;
  }

  /** Sound effects and purrs on/off (purrs fade out and are released while off). */
  setSfxEnabled(on: boolean): void {
    try {
      this.sfxOn = !!on;
      const g = this.g;
      if (!g) return;
      const now = g.ctx.currentTime;
      g.sfx.gain.setTargetAtTime(this.sfxOn ? 1 : 0, now, 0.08);
      g.sfxVerb.gain.setTargetAtTime(this.sfxOn ? 1 : 0, now, 0.08);
      if (!this.sfxOn) for (const v of this.purrs.values()) this.purrLevel(v, 0, now);
    } catch (e) {
      this.oops(e);
    }
  }

  /** Music on/off: off fades the music bus and stops the scheduler; on resumes it if startMusic() was called. */
  setMusicEnabled(on: boolean): void {
    try {
      this.musicOn = !!on;
      const g = this.g;
      if (g) g.music.gain.setTargetAtTime(this.musicOn ? MUSIC_LEVEL : 0, g.ctx.currentTime, this.musicOn ? 0.3 : 0.1);
      this.syncMusic();
    } catch (e) {
      this.oops(e);
    }
  }

  // ---------------------------------------------------------------- one-shots

  /** Soft wet-but-cute 'glorp' as a cat pours into a container. pitch 0.6..1.6, size 0..1, viscosity 0..1 (water .. honey). */
  glorp(pitch: number, size: number, viscosity: number): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'glorp', 0.05)) return;
      const s = quant(clamp(size, 0, 1), 0.1, 0.5);
      this.play(g, this.glorpBuffer(g, pitch, s, viscosity), 0.26 * (0.78 + 0.35 * s), { rate: jitter(0.04), pan: (Math.random() - 0.5) * 0.3 });
    } catch (e) {
      this.oops(e);
    }
  }

  /** A cat lands on something: speed in world units/s (~150 gentle .. 1400 hard), size 0..1. */
  impact(material: ImpactMaterial, speed: number, size: number): void {
    try {
      const g = this.live();
      if (!g || !(speed >= 150)) return;
      // Throttle: at most 8 impact voices per 100 ms, and one per material per 60 ms.
      const now = g.ctx.currentTime;
      while (this.hits.length && now - this.hits[0] >= 0.1) this.hits.shift();
      if (this.hits.length >= 8 || !this.gate(g, `hit:${material}`, 0.06)) return;
      const crowd = 1 / (1 + 0.3 * this.hits.length); // later hits in a pile-up are softer
      this.hits.push(now);
      const v = clamp((speed - 150) / 1250, 0, 1);
      const sz = clamp(Number.isFinite(size) ? size : 0.5, 0, 1);
      const buf = this.impactBuffer(g, material, Math.floor(Math.random() * IMPACT_VARIANTS));
      const gain = crowd * (MATERIAL_GAIN[material] ?? 0.8) * (0.05 + 0.3 * v ** 0.9) * (0.8 + 0.35 * sz);
      // Harder hits are brighter; bigger cats a touch lower.
      this.play(g, buf, gain, { lp: 1800 + 9000 * v ** 1.2, rate: (1 - 0.06 * sz) * jitter(0.06), pan: (Math.random() - 0.5) * 0.4 });
    } catch (e) {
      this.oops(e);
    }
  }

  /** Tap on a cat: a tiny rising 'mrrp?'. */
  boop(pitch: number): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'boop', 0.04)) return;
      this.play(g, this.voiceBuffer(g, 'boop', pitch), 0.2, { rate: jitter(0.03) });
    } catch (e) {
      this.oops(e);
    }
  }

  /** Finger grabs a cat: a sleepy breathy sigh, or a short soft 'mrrow'. */
  grab(pitch: number, sleepy: boolean): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'grab', 0.08)) return;
      this.play(g, this.voiceBuffer(g, sleepy ? 'sigh' : 'mrrow', pitch), sleepy ? 0.15 : 0.14, { rate: jitter(0.03) });
    } catch (e) {
      this.oops(e);
    }
  }

  /** A cat settled into a container (score 0..100): two warm kalimba notes, a third sparkly one when snug (>= 92). */
  seat(score: number): void {
    try {
      const g = this.live();
      if (!g) return;
      const s = clamp(Number.isFinite(score) ? score : 0, 0, 100);
      // Intervals of F major (the music's key), rising with the score.
      const notes = s >= 92 ? [72, 77, 81] : s >= 70 ? [72, 77] : s >= 40 ? [69, 72] : [65, 69];
      const now = g.ctx.currentTime;
      const t = Math.max(now + 0.01, this.seatAt);
      if (t > now + 0.6) return; // a pile-up of seats: let the cascade breathe
      this.seatAt = t + 0.24;
      notes.forEach((m, i) => {
        const sparkle = i === 2;
        this.play(g, this.bellBuffer(g, m, sparkle), sparkle ? 0.13 : 0.16, { at: t + i * 0.11, verb: CHIME_VERB, pan: (i - 0.5) * 0.15 });
      });
    } catch (e) {
      this.oops(e);
    }
  }

  /** A cat hisses: pitch 0.6..1.6. */
  hiss(pitch: number): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'hiss', 0.3)) return;
      this.play(g, this.hissBuffer(g, pitch), 0.13, { rate: jitter(0.05), pan: (Math.random() - 0.5) * 0.3 });
    } catch (e) {
      this.oops(e);
    }
  }

  /** A cat lands on a bouncy cushion: boing (speed in world units/s, size 0..1). */
  boing(speed: number, size: number): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'boing', 0.07)) return;
      const v = clamp((speed - 150) / 900, 0, 1);
      this.play(g, this.boingBuffer(g, quant(size, 0.25, 0.5)), 0.1 + 0.16 * v, { rate: jitter(0.04) * (1.06 - 0.1 * v), pan: (Math.random() - 0.5) * 0.2 });
    } catch (e) {
      this.oops(e);
    }
  }

  /** Nom nom: a cat eats a fish treat. */
  nom(pitch: number): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'nom', 0.08)) return;
      this.play(g, this.nomBuffer(g, pitch), 0.24, { rate: jitter(0.06) });
    } catch (e) {
      this.oops(e);
    }
  }

  /** A cat eyeing something to pounce on chitters: a few quick little "ek"s. */
  chitter(pitch: number): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'chitter', 0.6)) return;
      const now = g.ctx.currentTime;
      const buf = this.voiceBuffer(g, 'boop', Math.min(1.8, pitch * 1.45));
      for (let k = 0; k < 3; k++) this.play(g, buf, 0.085 - k * 0.012, { at: now + k * 0.085, rate: 1.25 * jitter(0.06) });
    } catch (e) {
      this.oops(e);
    }
  }

  /**
   * A scuffle in a dust cloud, `seconds` long: tumbling thumps, raked claws,
   * hisses and yowls from both cats (their voices' pitches).
   */
  scuffle(seconds: number, pitchA: number, pitchB: number): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'scuffle', 0.8)) return;
      const now = g.ctx.currentTime;
      let t = 0.02;
      let k = 0;
      while (t < seconds && k < 18) {
        const pitch = k % 2 ? pitchB : pitchA;
        const pan = (Math.random() - 0.5) * 0.5;
        const roll = Math.random();
        if (roll < 0.4) this.play(g, this.impactBuffer(g, 'fabric', k % IMPACT_VARIANTS), 0.1 + Math.random() * 0.08, { at: now + t, rate: jitter(0.25), lp: 2600, pan });
        else if (roll < 0.72) this.play(g, this.scratchBuffer(g, k % 3), 0.07 + Math.random() * 0.04, { at: now + t, rate: jitter(0.3), pan });
        else if (roll < 0.86) this.play(g, this.hissBuffer(g, pitch), 0.06, { at: now + t, rate: jitter(0.12), pan });
        else this.play(g, this.voiceBuffer(g, 'mrrow', Math.min(1.8, pitch * 1.25)), 0.09, { at: now + t, rate: jitter(0.18), pan });
        t += 0.07 + Math.random() * 0.12;
        k++;
      }
    } catch (e) {
      this.oops(e);
    }
  }

  /** Undo: a soft reverse whoosh. */
  undo(): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'undo', 0.1)) return;
      this.play(g, this.uiBuffer(g, 'undo', Math.floor(Math.random() * 2)), 0.15);
    } catch (e) {
      this.oops(e);
    }
  }

  /** UI button: a tiny soft tick/pop. */
  click(): void {
    try {
      const g = this.live();
      if (!g || !this.gate(g, 'click', 0.03)) return;
      this.play(g, this.uiBuffer(g, 'click', Math.floor(Math.random() * 3)), 0.11, { rate: jitter(0.06) });
    } catch (e) {
      this.oops(e);
    }
  }

  // ---------------------------------------------------------------- purrs

  /** Purr layer for one cat; call every frame with the desired level 0..1 (smoothed, tau ~0.4 s). */
  setPurr(id: number, level: number, params: PurrParams): void {
    try {
      const g = this.g;
      if (!g) return;
      const want = this.sfxOn && level > 0.001 ? Math.min(level, 1) : 0; // NaN -> 0
      let v = this.purrs.get(id);
      if (v && want && !samePurr(v.params, params)) {
        this.dropPurr(id, v, 0.15); // the id now belongs to a different cat: start its own voice
        v = undefined;
      }
      if (!v) {
        if (!want) return;
        const buf = this.purrBuffer(g, params);
        if (!buf) return; // still rendering (~2 ms of work per frame); the voice starts a few frames later
        v = this.makePurr(g, id, buf, params);
      }
      const now = g.ctx.currentTime;
      v.seen = now;
      this.purrLevel(v, want, now);
      if (!v.target && now - v.zeroAt > PURR_REST) this.dropPurr(id, v, 0);
    } catch (e) {
      this.oops(e);
    }
  }

  /** Fade out and release every purr voice (e.g. when a room changes), and reset the reveal swell. */
  stopAllPurrs(): void {
    try {
      for (const [id, v] of this.purrs) this.dropPurr(id, v, 0.12);
      this.resetSwell();
    } catch (e) {
      this.oops(e);
    }
  }

  /** The 'Fits & sits' reveal: purrs swell (x1.6 for ~6 s, then settle at x1.2), music ducks, a piano flourish plays. */
  reveal(): void {
    try {
      const g = this.g;
      if (!g) return;
      const now = g.ctx.currentTime;
      const swell = g.purrSwell.gain;
      swell.cancelScheduledValues(now);
      swell.setTargetAtTime(1.6, now, 0.6);
      swell.setTargetAtTime(1.2, now + 6, 1.5);
      this.duckMusic(0.65, 6);
      const live = this.live();
      if (live && this.gate(live, 'reveal', 1)) this.flourish(live, now + 0.03);
    } catch (e) {
      this.oops(e);
    }
  }

  // ---------------------------------------------------------------- music

  /** Gentle generative lo-fi piano + brushes (see music.ts). Safe to call before unlock(): it starts once audio is unlocked. */
  startMusic(): void {
    try {
      this.musicWanted = true;
      this.syncMusic();
    } catch (e) {
      this.oops(e);
    }
  }

  /** Stop composing and let ringing notes fade out quickly. */
  stopMusic(): void {
    try {
      this.musicWanted = false;
      this.syncMusic();
    } catch (e) {
      this.oops(e);
    }
  }

  /** Temporarily lower the music by `amount` (0..1) for `seconds`, then ease back. Overlapping ducks merge. */
  duckMusic(amount: number, seconds: number): void {
    try {
      const g = this.g;
      if (!g) return;
      const now = g.ctx.currentTime;
      let depth = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
      let until = now + clamp(Number.isFinite(seconds) ? seconds : 0, 0, 600);
      if (now < this.duckUntil) {
        depth = Math.max(depth, this.duckDepth);
        until = Math.max(until, this.duckUntil);
      }
      this.duckDepth = depth;
      this.duckUntil = until;
      const p = g.duck.gain;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(1 - depth, now, 0.2);
      p.setTargetAtTime(1, until, 0.8);
    } catch (e) {
      this.oops(e);
    }
  }

  // ---------------------------------------------------------------- internals: graph

  private build(): Graph | null {
    const w = globalThis as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      ctx = new Ctor();
    }
    const gain = (value: number, to: AudioNode): GainNode => {
      const n = ctx.createGain();
      n.gain.value = value;
      n.connect(to);
      return n;
    };

    // A gentle safety net: soft knee, only really bites when many sounds pile up.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.3;
    comp.connect(ctx.destination);
    const master = gain(MASTER, comp);

    // Room reverb; its noise impulse response is rendered by the warm-up (silent until then).
    const verb = ctx.createConvolver();
    verb.connect(master);

    const sfx = gain(this.sfxOn ? 1 : 0, master);
    const sfxVerb = gain(this.sfxOn ? 1 : 0, verb);
    const purrSwell = gain(1, sfx);
    const purrBus = gain(1, purrSwell);
    const music = gain(this.musicOn ? MUSIC_LEVEL : 0, master);
    music.connect(gain(MUSIC_VERB, verb));
    const duck = gain(1, music);
    const piano = ctx.createBiquadFilter(); // the "light lowpass" that keeps the piano warm
    piano.type = 'lowpass';
    piano.frequency.value = 4200;
    piano.Q.value = -3; // dB: no resonant bump
    piano.connect(duck);
    const drums = gain(1, duck);

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.onVisibility);
      // iOS only honours some gestures for audio; keep retrying on those until we're running.
      for (const type of RETRY_EVENTS) document.addEventListener(type, this.retry, { capture: true, passive: true });
    }
    // iOS: one silent sample played inside the gesture fully unlocks output.
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    blip.connect(ctx.destination);
    blip.onended = () => blip.disconnect();
    blip.start(0);
    return { ctx, sfx, sfxVerb, purrBus, purrSwell, music, duck, piano, drums, verb };
  }

  private teardown(): void {
    clearInterval(this.musicTimer);
    clearInterval(this.purrTimer);
    clearTimeout(this.warmTimer);
    this.musicTimer = this.purrTimer = this.warmTimer = undefined;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      for (const type of RETRY_EVENTS) document.removeEventListener(type, this.retry, { capture: true });
    }
    this.purrs.clear();
    this.purrJobs.clear();
    this.held.clear();
    this.bufs.clear();
    this.zones.clear();
    this.lastAt.clear();
    this.queue = [];
    this.hits = [];
    this.warmJobs = [];
    this.voices = 0;
    this.purrCount = -1;
    this.barAt = -1;
    this.duckUntil = this.seatAt = 0;
    this.g = null;
  }

  private resume(g: Graph): void {
    this.resumeAt = Date.now();
    g.ctx.resume().catch((e: unknown) => this.oops(e));
  }

  /** Suspend while the page is hidden; resume on return if we were running. */
  private readonly onVisibility = (): void => {
    try {
      const g = this.g;
      if (!g || typeof document === 'undefined') return;
      if (document.hidden) {
        if (g.ctx.state === 'running') {
          this.resumeOnShow = true;
          g.ctx.suspend().catch((e: unknown) => this.oops(e));
        }
      } else if (this.resumeOnShow) {
        this.resumeOnShow = false;
        this.resume(g);
      }
    } catch (e) {
      this.oops(e);
    }
  };

  /** Gesture listener: resume a context that is still (or again) suspended, e.g. after an iOS interruption. */
  private readonly retry = (): void => {
    try {
      const g = this.g;
      if (g && g.ctx.state !== 'running' && g.ctx.state !== 'closed' && !document.hidden) this.resume(g);
    } catch (e) {
      this.oops(e);
    }
  };

  /** The graph, if one-shots can sound right now: sfx on, and running (or a resume was just requested). */
  private live(): Graph | null {
    const g = this.g;
    if (!g || !this.sfxOn) return null;
    return g.ctx.state === 'running' || Date.now() - this.resumeAt < 1000 ? g : null;
  }

  /** Cooldown per sound key, so a burst of identical events doesn't stack. */
  private gate(g: Graph, key: string, gap: number): boolean {
    const now = g.ctx.currentTime;
    const last = this.lastAt.get(key);
    if (last !== undefined && now - last < gap) return false;
    this.lastAt.set(key, now);
    return true;
  }

  private oops(e: unknown): void {
    this.lastError = e;
  }

  // ---------------------------------------------------------------- internals: buffers

  private toBuffer(g: Graph, data: Float32Array, sr: number): AudioBuffer {
    const b = g.ctx.createBuffer(1, data.length, sr);
    b.getChannelData(0).set(data);
    return b;
  }

  /** Render a recipe once per key (small LRU). */
  private cached(g: Graph, key: string, sr: number, render: (sr: number) => Float32Array): AudioBuffer {
    let b = this.bufs.get(key);
    if (b) this.bufs.delete(key);
    else {
      b = this.toBuffer(g, render(sr), sr);
      if (this.bufs.size >= 120) this.bufs.delete(this.bufs.keys().next().value as string);
    }
    this.bufs.set(key, b);
    return b;
  }

  private glorpBuffer(g: Graph, pitch: number, size: number, viscosity: number): AudioBuffer {
    const p = quant(pitch, 0.04, 1);
    const s = quant(clamp(size, 0, 1), 0.1, 0.5);
    const v = quant(clamp(viscosity, 0, 1), 0.1, 0.5);
    const key = `glorp:${p}:${s}:${v}`;
    return this.cached(g, key, loRate(g), (sr) => renderGlorp(sr, p, s, v, hash(key)));
  }

  private voiceBuffer(g: Graph, kind: 'boop' | 'mrrow' | 'sigh', pitch: number): AudioBuffer {
    const p = quant(pitch, 0.04, 1);
    return this.cached(g, `${kind}:${p}`, loRate(g), (sr) => (kind === 'sigh' ? renderSigh(sr, p, 5) : renderMew(sr, p, kind, kind === 'boop' ? 11 : 3)));
  }

  private hissBuffer(g: Graph, pitch: number): AudioBuffer {
    const p = quant(pitch, 0.1, 1);
    return this.cached(g, `hiss:${p}`, g.ctx.sampleRate, (sr) => renderHiss(sr, p, 41));
  }

  private boingBuffer(g: Graph, size: number): AudioBuffer {
    return this.cached(g, `boing:${size}`, loRate(g), (sr) => renderBoing(sr, size));
  }

  private nomBuffer(g: Graph, pitch: number): AudioBuffer {
    const p = quant(pitch, 0.1, 1);
    return this.cached(g, `nom:${p}`, loRate(g), (sr) => renderNom(sr, p, 43));
  }

  private scratchBuffer(g: Graph, variant: number): AudioBuffer {
    return this.cached(g, `scratch:${variant}`, g.ctx.sampleRate, (sr) => renderScratch(sr, 61 + variant));
  }

  private bellBuffer(g: Graph, midi: number, sparkle: boolean): AudioBuffer {
    return this.cached(g, `bell:${midi}:${sparkle}`, loRate(g), (sr) => renderBell(sr, midi, sparkle, midi));
  }

  private uiBuffer(g: Graph, kind: 'undo' | 'click', variant: number): AudioBuffer {
    return kind === 'undo'
      ? this.cached(g, `undo:${variant}`, loRate(g), (sr) => renderWhoosh(sr, 21 + variant))
      : this.cached(g, `click:${variant}`, g.ctx.sampleRate, (sr) => renderClick(sr, 31 + variant));
  }

  private reverb(g: Graph): void {
    if (g.verb.buffer) return;
    const sr = g.ctx.sampleRate;
    const [l, r] = renderIR(sr, 2.4, 0x5eed);
    const ir = g.ctx.createBuffer(2, l.length, sr);
    ir.getChannelData(0).set(l);
    ir.getChannelData(1).set(r);
    g.verb.buffer = ir;
  }

  private impactBuffer(g: Graph, m: ImpactMaterial, variant: number): AudioBuffer {
    return this.cached(g, `hit:${m}:${variant}`, g.ctx.sampleRate, (sr) => renderImpact(sr, m, hash(m) + variant * 977));
  }

  private drumBuffer(g: Graph, kind: DrumKind, variant: number): AudioBuffer {
    const v = kind === 'kick' ? 0 : variant;
    return this.cached(g, `drum:${kind}:${v}`, g.ctx.sampleRate, (sr) =>
      kind === 'kick' ? renderKick(sr) : kind === 'tick' ? renderTick(sr, 40 + v) : renderBrush(sr, kind === 'sweep', 50 + v),
    );
  }

  private zone(g: Graph, z: number): AudioBuffer {
    let b = this.zones.get(z);
    if (!b) {
      b = this.toBuffer(g, renderPiano(loRate(g), z, z * 7919), loRate(g));
      this.zones.set(z, b);
    }
    return b;
  }

  /**
   * Purr loop for these params: cached, or rendered in slices within a ~2 ms budget per frame
   * (shared by all purr renders), so a new breed's purr costs a few frames of spare time
   * instead of one long hitch. Returns null while the render is still in progress.
   */
  private purrBuffer(g: Graph, p: PurrParams): AudioBuffer | null {
    const pp: PurrParams = { pitch: quant(p?.pitch, 0.05, 1), rate: quant(p?.rate, 0.05, 1), rough: quant(clamp(p?.rough, 0, 1), 0.25, 0.5) };
    const key = `purr:${pp.pitch}:${pp.rate}:${pp.rough}`;
    const hit = this.bufs.get(key);
    if (hit) return hit;
    const now = performance.now();
    if (now - this.purrFrameAt > 12) {
      this.purrFrameAt = now; // a new frame: refill the budget
      this.purrBudget = 2;
    }
    if (this.purrBudget <= 0) return null;
    let job = this.purrJobs.get(key);
    if (!job) this.purrJobs.set(key, (job = purrSlices(loRate(g), pp, hash(key), 2048)));
    let step = job.next();
    while (!step.done && performance.now() - now < this.purrBudget) step = job.next();
    this.purrBudget -= performance.now() - now;
    if (!step.done) return null;
    this.purrJobs.delete(key);
    const data = step.value;
    return this.cached(g, key, loRate(g), () => data);
  }

  /**
   * After unlock, pre-render in small time slices (most urgent first): the reverb, the first
   * chord, UI ticks, impacts, the rest of the piano, drums and chimes. One render of each
   * voice recipe and a neutral purr also warm up the JIT, so a breed's first glorp, boop or
   * purr renders quickly. Nothing here runs inside the unlocking gesture.
   */
  private startWarmup(): void {
    const jobs: ((g: Graph) => boolean)[] = [];
    const add = (fn: (g: Graph) => unknown): void => void jobs.push((g) => (fn(g), true));
    add((g) => this.reverb(g));
    const zones = new Set([42, 51, 57, 60, ...PIANO_NOTES.map(zoneOf)]); // first chord (Fmaj7) first
    for (let v = 0; v < 3; v++) add((g) => this.uiBuffer(g, 'click', v));
    for (const m of MATERIALS) for (let v = 0; v < IMPACT_VARIANTS; v++) add((g) => this.impactBuffer(g, m, v));
    for (const z of zones) add((g) => this.zone(g, z));
    for (const k of ['kick', 'slap', 'sweep', 'tick'] as const) for (let v = 0; v < 2; v++) add((g) => this.drumBuffer(g, k, v));
    for (const m of [65, 69, 72, 77]) add((g) => this.bellBuffer(g, m, false));
    add((g) => this.bellBuffer(g, 81, true));
    for (let v = 0; v < 2; v++) add((g) => this.uiBuffer(g, 'undo', v));
    add((g) => this.glorpBuffer(g, 1, 0.5, 0.5));
    for (const k of ['boop', 'mrrow', 'sigh'] as const) add((g) => this.voiceBuffer(g, k, 1));
    jobs.push((g) => !!this.purrBuffer(g, { pitch: 1, rate: 1, rough: 0.5 }));
    this.warmJobs = jobs;
    clearTimeout(this.warmTimer);
    this.warmTimer = setTimeout(this.warm, 50);
  }

  /** Runs warm-up jobs for ~4 ms, then yields to the page for 30 ms. */
  private readonly warm = (): void => {
    this.warmTimer = undefined;
    const g = this.g;
    if (!g) return;
    const t0 = performance.now();
    try {
      while (this.warmJobs.length && performance.now() - t0 < 4) {
        if (!this.warmJobs[0](g)) break; // a sliced job wants another turn later
        this.warmJobs.shift();
      }
    } catch (e) {
      this.warmJobs.shift();
      this.oops(e);
    }
    if (this.warmJobs.length) this.warmTimer = setTimeout(this.warm, 30);
  };

  // ---------------------------------------------------------------- internals: voices

  /** Fire-and-forget voice: buffer -> [lowpass] -> gain -> [pan] -> bus (+ reverb send). Disconnects itself when done. */
  private play(g: Graph, buf: AudioBuffer, gain: number, o: PlayOpts = {}): void {
    if (this.voices >= MAX_VOICES) return;
    const ctx = g.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (o.rate) src.playbackRate.value = o.rate;
    const nodes: AudioNode[] = [src];
    let head: AudioNode = src;
    const link = (n: AudioNode): void => {
      head.connect(n);
      nodes.push(n);
      head = n;
    };
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.min(o.lp, ctx.sampleRate * 0.45);
      f.Q.value = -3;
      link(f);
    }
    const amp = ctx.createGain();
    amp.gain.value = gain;
    link(amp);
    if (o.pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      link(p);
    }
    head.connect(o.dest ?? g.sfx);
    if (o.verb) {
      const send = ctx.createGain();
      send.gain.value = o.verb;
      head.connect(send);
      send.connect(g.sfxVerb);
      nodes.push(send);
    }
    this.voices++;
    src.onended = () => {
      this.voices--;
      for (const n of nodes) n.disconnect();
    };
    src.start(Math.max(ctx.currentTime, o.at ?? 0));
  }

  /** One piano note from the nearest pre-rendered zone, damped after `len` seconds. */
  private pianoNote(g: Graph, midi: number, vel: number, at: number, len: number, sfx: boolean): void {
    const ctx = g.ctx;
    const z = zoneOf(midi);
    const buf = this.zone(g, z);
    const rate = 2 ** ((midi - z) / 12);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = vel * (sfx ? FLOURISH_GAIN : PIANO_GAIN);
    src.connect(gain);
    gain.connect(sfx ? g.sfx : g.piano);
    let send: GainNode | null = null;
    if (sfx) {
      send = ctx.createGain();
      send.gain.value = CHIME_VERB;
      gain.connect(send);
      send.connect(g.sfxVerb);
    }
    const start = Math.max(at, ctx.currentTime);
    src.start(start);
    if (len + 1.5 < buf.duration / rate) {
      gain.gain.setTargetAtTime(0, start + len, 0.25); // damper
      src.stop(start + len + 1.5);
    }
    const h: Held = { src, gain, at: start };
    if (!sfx) this.held.add(h);
    src.onended = () => {
      this.held.delete(h);
      src.disconnect();
      gain.disconnect();
      send?.disconnect();
    };
  }

  /** Rising Fmaj9 sweep with a gentle ritardando over a soft low F. */
  private flourish(g: Graph, t: number): void {
    let at = t;
    FLOURISH.forEach((m, i) => {
      const top = i === FLOURISH.length - 1;
      this.pianoNote(g, m, i === 0 ? 0.4 : 0.3 + 0.3 * (i / FLOURISH.length), at, top ? 3.5 : 2.5, true);
      at += i === 0 ? 0.02 : 0.075 + 0.012 * i;
    });
  }

  // ---------------------------------------------------------------- internals: purrs

  private makePurr(g: Graph, id: number, buf: AudioBuffer, params: PurrParams): PurrVoice {
    const ctx = g.ctx;
    // Per-cat detune, pan and breath phase so layered purrs never phase-lock.
    const h = hash(`cat:${id}`);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.975 + 0.05 * ((h & 255) / 255);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    let pan: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      pan.pan.value = (((h >>> 8) & 255) / 255 - 0.5) * 0.5;
      gain.connect(pan);
      pan.connect(g.purrBus);
    } else gain.connect(g.purrBus);
    src.start(ctx.currentTime, (((h >>> 16) & 1023) / 1024) * buf.duration);
    const v: PurrVoice = { src, gain, pan, params: { pitch: params?.pitch, rate: params?.rate, rough: params?.rough }, target: 0, zeroAt: 0, seen: ctx.currentTime };
    this.purrs.set(id, v);
    if (this.purrTimer === undefined) this.purrTimer = setInterval(this.sweepPurrs, 500);
    return v;
  }

  private purrLevel(v: PurrVoice, level: number, now: number): void {
    // Only re-aim the smoother on meaningful changes (keeps the automation timeline short).
    if (level === v.target || (level > 0 && v.target > 0 && Math.abs(level - v.target) < 0.01 + 0.05 * v.target)) return;
    if (level === 0) v.zeroAt = now;
    v.target = level;
    v.gain.gain.setTargetAtTime(level * PURR_GAIN, now, PURR_TC);
    this.purrMix();
  }

  private dropPurr(id: number, v: PurrVoice, fade: number): void {
    this.purrs.delete(id);
    v.src.onended = () => {
      v.src.disconnect();
      v.gain.disconnect();
      v.pan?.disconnect();
    };
    const g = this.g;
    if (g && fade > 0) {
      const now = g.ctx.currentTime;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, fade);
      v.src.stop(now + fade * 6);
    } else v.src.stop();
    if (!this.purrs.size) {
      clearInterval(this.purrTimer);
      this.purrTimer = undefined;
      this.resetSwell();
    }
    this.purrMix();
  }

  /** Many purring cats get a gentle bus trim so the room hums rather than roars. */
  private purrMix(): void {
    const g = this.g;
    if (!g) return;
    let n = 0;
    for (const v of this.purrs.values()) if (v.target > 0.02) n++;
    if (n === this.purrCount) return;
    this.purrCount = n;
    g.purrBus.gain.setTargetAtTime(1 / (1 + 0.15 * Math.max(0, n - 1)), g.ctx.currentTime, 0.5);
  }

  private resetSwell(): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;
    g.purrSwell.gain.cancelScheduledValues(now);
    g.purrSwell.gain.setTargetAtTime(1, now, 0.3);
  }

  /** Fades purrs whose cat stopped being updated, and releases voices that have rested at zero. */
  private readonly sweepPurrs = (): void => {
    try {
      const g = this.g;
      if (!g) return;
      const now = g.ctx.currentTime;
      for (const [id, v] of this.purrs) {
        if (now - v.seen > 0.75) this.purrLevel(v, 0, now);
        if (!v.target && now - v.zeroAt > PURR_REST) this.dropPurr(id, v, 0);
      }
    } catch (e) {
      this.oops(e);
    }
  };

  // ---------------------------------------------------------------- internals: music

  /** Run the scheduler iff music is wanted, enabled, and a context exists. */
  private syncMusic(): void {
    const run = this.musicWanted && this.musicOn && !!this.g;
    if (run && this.musicTimer === undefined) {
      this.composer ??= new Composer((Math.random() * 2 ** 32) >>> 0);
      this.barAt = -1;
      this.queue = [];
      this.musicTimer = setInterval(this.tick, TICK_MS);
      this.tick();
    } else if (!run && this.musicTimer !== undefined) {
      clearInterval(this.musicTimer);
      this.musicTimer = undefined;
      this.queue = [];
      this.releaseHeld();
    }
  }

  /** Lookahead scheduler: compose bars as they come within reach, then schedule events due in the next 0.2 s. */
  private readonly tick = (): void => {
    try {
      const g = this.g;
      if (!g || !this.composer || g.ctx.state !== 'running') return;
      const now = g.ctx.currentTime;
      const horizon = now + LOOKAHEAD;
      if (this.barAt < 0) this.barAt = now + 0.8; // fresh start: a breath of silence while the piano warms up
      else if (this.barAt < now) this.barAt = now + 0.05; // the timer stalled: resync rather than rush
      while (this.barAt < horizon) {
        this.queueBar(this.composer, this.barAt);
        this.barAt += 4 * SPB;
      }
      while (this.queue.length && this.queue[0].t < horizon) {
        const ev = this.queue.shift() as MusicEv;
        if (ev.t < now - 0.02) continue; // too late: drop rather than smear
        if (ev.drum) this.play(g, this.drumBuffer(g, ev.drum, Math.floor(Math.random() * 2)), ev.vel * DRUM_GAIN[ev.drum], { at: ev.t, dest: g.drums });
        else this.pianoNote(g, ev.midi, ev.vel, ev.t, ev.len, false);
      }
    } catch (e) {
      this.oops(e);
    }
  };

  private queueBar(composer: Composer, t0: number): void {
    const bar = composer.next();
    for (const n of bar.notes) this.queue.push({ t: t0 + n.at * SPB, midi: n.midi, vel: n.rh ? n.vel : n.vel * 0.8, len: n.len * SPB, drum: null });
    for (const d of bar.drums) this.queue.push({ t: t0 + d.at * SPB, midi: 0, vel: d.vel, len: 0, drum: d.kind });
    this.queue.sort((a, b) => a.t - b.t);
  }

  /** Fade out ringing music notes (and cancel ones not yet started). */
  private releaseHeld(): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;
    for (const h of this.held) {
      try {
        if (h.at > now) h.src.stop(now);
        else {
          h.gain.gain.cancelScheduledValues(now);
          h.gain.gain.setTargetAtTime(0, now, 0.12);
          h.src.stop(now + 0.8);
        }
      } catch (e) {
        this.oops(e);
      }
    }
  }
}
