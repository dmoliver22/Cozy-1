// Generative lo-fi piano + brushes, composed one bar at a time. Pure and
// seeded (no Web Audio here): the engine schedules whatever `next()` returns.
//
// Shape: 74 BPM, swung 8ths, 8-bar phrases. Each phrase picks a progression
// (home base: Fmaj7 - Dm9 - Gm7 - C9sus/C9), two left-hand comping cells, a
// sparse right-hand rhythm (bars 5-7 often echo bars 1-3) and a drum feel;
// the melody is a seeded random walk on F major pentatonic that lands on
// chord tones on strong beats. A new phrase every 8 bars keeps it from
// looping obviously.

import { clamp, rng, type Rand } from './dsp';

export const BPM = 74;
/** Seconds per beat. */
export const SPB = 60 / BPM;
/** Where the off-beat 8th lands inside the beat (0.5 = straight; ~0.62 = lazy swing). */
const SWING = 0.62;

export type DrumKind = 'kick' | 'slap' | 'sweep' | 'tick';
/** Times and lengths are in beats from the bar start; `rh` marks right-hand melody. */
export interface NoteEv {
  at: number;
  midi: number;
  vel: number;
  len: number;
  rh: boolean;
}
export interface DrumEv {
  at: number;
  kind: DrumKind;
  vel: number;
}
export interface BarEvents {
  notes: NoteEv[];
  drums: DrumEv[];
}

interface Chord {
  /** Left-hand root (MIDI). */
  bass: number;
  /** Warm mid-register shell voicing (MIDI). */
  up: readonly number[];
  /** Pitch classes a strong-beat melody note may land on. */
  tones: readonly number[];
  /** Pitch classes the melody avoids entirely over this chord. */
  avoid?: readonly number[];
}

const CHORDS: Record<string, Chord> = {
  Fmaj7: { bass: 41, up: [52, 57, 60], tones: [5, 9, 0, 4] },
  Fmaj9: { bass: 41, up: [52, 55, 57, 60], tones: [5, 9, 0, 4, 7] },
  Dm9: { bass: 38, up: [53, 57, 60, 64], tones: [2, 5, 9, 0, 4] },
  Gm7: { bass: 43, up: [53, 58, 62], tones: [7, 10, 2, 5] },
  Gm9: { bass: 43, up: [53, 58, 62, 69], tones: [7, 10, 2, 5, 9] },
  C9sus: { bass: 36, up: [58, 62, 65], tones: [0, 5, 7, 10, 2] },
  C9: { bass: 36, up: [52, 58, 62], tones: [0, 4, 7, 10, 2], avoid: [5] },
  Am7: { bass: 45, up: [55, 60, 64], tones: [9, 0, 4, 7] },
  Bbmaj7: { bass: 46, up: [57, 62, 65], tones: [10, 2, 5, 9] },
};

/** 8-bar progressions; "A>B" splits a bar at beat 3. The first is home base. */
const PHRASES: readonly (readonly string[])[] = [
  ['Fmaj7', 'Dm9', 'Gm7', 'C9sus>C9', 'Fmaj7', 'Dm9', 'Gm7', 'C9sus>C9'],
  ['Fmaj9', 'Dm9', 'Gm9', 'C9sus', 'Am7', 'Dm9', 'Gm7', 'C9sus>C9'],
  ['Bbmaj7', 'Am7', 'Gm7', 'Fmaj7', 'Bbmaj7', 'Am7', 'Gm9', 'C9sus>C9'],
  ['Fmaj7', 'Am7', 'Bbmaj7', 'C9sus', 'Fmaj9', 'Dm9', 'Gm7', 'C9'],
];

/** Right-hand notes: F major pentatonic, F4..A5 (sits sweetly over every chord above). */
const SCALE = [65, 67, 69, 72, 74, 77, 79, 81];

/** Melody rhythm cells: [8th-note step 0..7, length in 8ths]. Sparse on purpose. */
const RHYTHMS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 6]],
  [
    [2, 2],
    [3, 5],
  ],
  [
    [1, 1],
    [2, 3],
    [5, 3],
  ],
  [
    [0, 3],
    [3, 1],
    [4, 4],
  ],
  [
    [4, 2],
    [5, 1],
    [6, 2],
  ],
  [[5, 3]],
  [
    [0, 2],
    [2, 2],
    [4, 4],
  ],
  [
    [3, 2],
    [6, 2],
  ],
];

/** Left-hand comping hit: [beat, part (0 root, 1 shell, 2 both), velocity, length in beats]. */
type Hit = readonly [beat: number, part: 0 | 1 | 2, vel: number, len: number];
const COMPS: readonly (readonly Hit[])[] = [
  [[0, 2, 0.42, 4]], // whole-bar pad
  [
    [0, 2, 0.42, 1.5],
    [1 + SWING, 1, 0.3, 2.3],
  ], // Charleston: on 1 and the "and" of 2
  [
    [0, 2, 0.4, 2],
    [2, 1, 0.28, 2],
  ], // halves
  [
    [0, 0, 0.42, 4],
    [SWING, 1, 0.3, 3.3],
    [2 + SWING, 1, 0.22, 1.3],
  ], // root, then the shell on the "ands"
];
/** Half-bar chord, for "A>B" bars. */
const SPLIT: readonly Hit[] = [[0, 2, 0.4, 2]];

/** The reveal flourish: a low F, then Fmaj9 rising (F3 C4 E4 G4 A4 C5 E5 G5 A5). */
export const FLOURISH: readonly number[] = [41, 53, 60, 64, 67, 69, 72, 76, 79, 81];

/** Every piano note the music and the flourish can ask for (the engine pre-renders these). */
export const PIANO_NOTES: readonly number[] = [
  ...new Set([...Object.values(CHORDS).flatMap((c) => [c.bass, ...c.up]), ...SCALE, ...FLOURISH]),
].sort((a, b) => a - b);

interface Plan {
  chords: readonly string[];
  /** Comping cell for bars 1-4 and 5-8. */
  comps: readonly [number, number];
  /** Rhythm cell per bar (-1 = rest). */
  rhythms: number[];
  /** Drum feel per bar: 0 none, 1 soft, 2 full. */
  drums: number[];
}

export class Composer {
  private readonly r: Rand;
  private bar = 0;
  private walk = 3;
  private phrase = -1;
  private plan: Plan | null = null;

  constructor(seed: number) {
    this.r = rng(seed);
  }

  /** Events for the next bar. */
  next(): BarEvents {
    const b = this.bar % 8;
    if (b === 0 || !this.plan) this.plan = this.newPlan(this.bar === 0);
    this.bar++;
    const plan = this.plan;
    const chords = plan.chords[b].split('>').map((n) => CHORDS[n] ?? CHORDS.Fmaj7);
    const notes: NoteEv[] = [];
    if (chords.length > 1) chords.forEach((c, i) => this.comp(notes, c, SPLIT, i * 2, 2));
    else this.comp(notes, chords[0], COMPS[plan.comps[b >> 2]], 0, 4);
    const cell = plan.rhythms[b] >= 0 ? RHYTHMS[plan.rhythms[b]] : [];
    cell.forEach(([step, len], i) => {
      const at = (step >> 1) + (step & 1 ? SWING : 0);
      const chord = chords[chords.length > 1 && at >= 2 ? 1 : 0];
      const vel = 0.34 + 0.12 * this.r() + (i === 0 ? 0.04 : 0);
      notes.push({ at: this.nudge(at), midi: this.melody(chord, step % 4 === 0), vel, len: len * 0.5 + 0.4, rh: true });
    });
    return { notes, drums: this.drums(plan.drums[b]) };
  }

  private newPlan(first: boolean): Plan {
    const r = this.r;
    let p = first || r() < 0.35 ? 0 : 1 + Math.floor(r() * (PHRASES.length - 1));
    if (p === this.phrase && p !== 0) p = 0;
    this.phrase = p;
    const density = 0.35 + 0.4 * r();
    const pick = (): number => (r() < (1 - density) * 0.7 ? -1 : Math.floor(r() * RHYTHMS.length));
    const rhythms = [pick(), pick(), pick(), pick()];
    for (let b = 4; b < 7; b++) rhythms.push(r() < 0.6 ? rhythms[b - 4] : pick()); // echo the first half
    rhythms.push(r() < 0.6 ? 0 : -1); // cadence: one long note, or a breath
    const feel = r() < 0.7 ? 2 : 1;
    const drums = Array.from({ length: 8 }, (_, b) => (first && b < 2 ? 0 : feel)); // drums join on bar 3
    const comp = (): number => Math.floor(r() * COMPS.length);
    return { chords: PHRASES[p], comps: [comp(), comp()], rhythms, drums };
  }

  /** Left-hand comping: root and/or a softly rolled shell. */
  private comp(out: NoteEv[], c: Chord, cell: readonly Hit[], from: number, span: number): void {
    for (const [beat, part, vel, len] of cell) {
      if (beat >= span) continue;
      const at = this.nudge(from + beat);
      const l = Math.min(len, span - beat) + 0.15;
      const v = vel * (0.9 + 0.2 * this.r());
      if (part !== 1) out.push({ at, midi: c.bass, vel: v, len: l, rh: false });
      if (part !== 0) {
        c.up.forEach((m, i) => {
          const roll = 0.035 * (i + 1);
          out.push({ at: at + roll, midi: m, vel: v * 0.85, len: l - roll, rh: false });
        });
      }
    }
  }

  /** Seeded random walk on the pentatonic scale; strong beats snap to chord tones. */
  private melody(c: Chord, strong: boolean): number {
    const r = this.r;
    let i = this.walk + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)];
    if (i > 5 && r() < 0.5) i--;
    else if (i < 2 && r() < 0.5) i++;
    i = clamp(i, 0, SCALE.length - 1);
    const fits = (k: number): boolean => {
      if (k < 0 || k >= SCALE.length) return false;
      const pc = SCALE[k] % 12;
      return (!strong || c.tones.includes(pc)) && !(c.avoid ?? []).includes(pc);
    };
    if (!fits(i)) {
      for (const d of [1, -1, 2, -2]) {
        if (fits(i + d)) {
          i += d;
          break;
        }
      }
    }
    this.walk = i;
    return SCALE[i];
  }

  /** Brushed kit: muted kick on 1, slow sweeps on 1 and 3, brush slaps on 2 and 4, light ticks on the swung "ands". */
  private drums(feel: number): DrumEv[] {
    const r = this.r;
    const out: DrumEv[] = [];
    if (!feel) return out;
    const full = feel === 2;
    out.push({ at: 0, kind: 'kick', vel: full ? 0.5 : 0.4 });
    if (full && r() < 0.3) out.push({ at: 2 + SWING, kind: 'kick', vel: 0.28 });
    out.push({ at: 0, kind: 'sweep', vel: 0.26 + 0.06 * r() }, { at: 2, kind: 'sweep', vel: 0.24 + 0.06 * r() });
    for (const beat of [1, 3]) out.push({ at: beat + 0.015, kind: 'slap', vel: (full ? 0.5 : 0.38) + 0.08 * (r() - 0.5) });
    if (full) for (let beat = 0; beat < 4; beat++) if (r() < 0.55) out.push({ at: beat + SWING, kind: 'tick', vel: 0.16 + 0.08 * r() });
    for (const d of out) d.at = this.nudge(d.at);
    return out;
  }

  /** Tiny human timing drift (about +-5 ms). */
  private nudge(at: number): number {
    return Math.max(0, at + (this.r() - 0.5) * 0.012);
  }
}
