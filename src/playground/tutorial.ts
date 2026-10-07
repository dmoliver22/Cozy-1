// The first time anyone opens the game they start up in the Playground, on a
// little course built for them: tap the kitten to boop it, then carry it into
// the cannon. Pomf! Out it flies into a tube, round and out of the far end,
// blown along by a fan onto a bouncy cushion, boing, back through the fan's
// wind and down into a hammock, where it curls up. Then home.
//
// The ride is the same every time: the cannon fires a fresh round cat the
// same way whatever it was doing when it went in (gadgets.ts), the physics
// runs in fixed steps with nothing left to chance, and the tube ride is
// scripted. The course is laid out with room to spare either side of every
// landing (the tests nudge the cat about on its way and it still gets there),
// and if a cat ever did go astray it'd be put straight into the hammock.

import type { Cat } from '../game/session';
import type { BreedId } from '../physics/breeds';
import { FRAME_DT, GRAVITY } from '../physics/world';
import { NAMES } from '../house/house';
import { cannonMouth } from './gadgets';
import { SPAWN, evenTube, gadgetOf, snapFunnel, type PlaySave } from './layout';
import type { SkyEvent, SkySim } from './sim';

/** Who takes the ride, and where it starts (on the respawn cloud, left of the cannon). */
export const TOUR_CAT: BreedId = 'kitten';
export const TOUR_START = { x: SPAWN.x - 60 };

/** The course: the cannon on the respawn cloud, the funnel it shoots into on the tube, the fan, the bouncy cushion on its cloud, and the hammock. */
export function course(): PlaySave {
  const tube = {
    id: 6,
    pts: evenTube([
      [270, -235],
      [380, -320],
      [500, -370],
      [620, -360],
      [720, -300],
      [790, -220],
      [800, -160],
      [800, -130],
    ]),
  };
  // (the funnel on the tube's end, facing the cannon: a wide mouth to catch the shot)
  const f = snapFunnel(270, -235, [tube])!;
  return {
    v: 1,
    pieces: [
      { id: 1, kind: 'cannon', x: 40, y: -30, aim: -45 },
      { id: 2, kind: 'fan', x: 720, y: -20, aim: 0 },
      { id: 3, kind: 'bounce', x: 860, y: 150 },
      { id: 4, kind: 'cloud', x: 860, y: 184 },
      { id: 5, kind: 'hammock', x: 1330, y: 140 },
      { id: 7, kind: 'funnel', x: f.x, y: f.y, aim: f.aim },
    ],
    tubes: [tube],
    nextId: 8,
    cats: [],
  };
}

/** Where the tour's been seen (or skipped), so it's only the once. */
export const TOUR_KEY = 'cozy-tour:v1';

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, 'done');
  } catch {
    // (private browsing: it'll show again next time)
  }
}

/** Where it's got to: boop the cat, carry it to the cannon, the ride, curled up in the hammock, off home. */
export type TourStage = 'boop' | 'carry' | 'ride' | 'snug' | 'home';

/** How long it lies in the hammock before it's time for home, how long "Off home" shows (frames), and the longest a ride can take before it's helped along. */
const SNUG_FRAMES = 160;
const HOME_FRAMES = 80;
const RIDE_MAX = 60 * 14;

/** What a hand-dropped cat is let off: let go this near the cannon's mouth, in it goes. */
export const TOUR_REACH = 130;

export class Tour {
  stage: TourStage = 'boop';
  /** What the card says: a line, and under it what to do (or what's happening). */
  line = '';
  sub = '';
  private t = 0;
  private settledIn = 0;

  constructor() {
    this.say('boop');
  }

  private get name(): string {
    return NAMES[TOUR_CAT];
  }

  private say(what: TourStage | 'load' | SkyEvent['t']): void {
    const n = this.name;
    const lines: Partial<Record<typeof what, [string, string]>> = {
      boop: ['Welcome up to the clouds!', `Tap ${n} to give it a boop.`],
      carry: ['Boop! Now for some fun.', `Pick ${n} up, carry it into the cannon's mouth and let go.`],
      load: ['In it goes…', 'Hold on to your whiskers!'],
      fire: ['Pomf!', 'Straight into the tube…'],
      in: ['Wheee!', 'All the way through the tube.'],
      out: ['Whoosh!', `The fan blows ${n} along…`],
      boing: ['Boing!', '…off the bouncy cushion, back through the wind…'],
      snug: ['…and snug in the hammock.', 'Purrfect. Build anything you like up here.'],
      home: ['Off home we go!', 'Everyone’s waiting to meet you.'],
    };
    const l = lines[what];
    if (!l) return;
    [this.line, this.sub] = l;
  }

  /** The cat's been booped: on to the cannon. */
  booped(): void {
    if (this.stage !== 'boop') return;
    this.stage = 'carry';
    this.say('carry');
  }

  /** Into the cannon it's gone (or straight into the tube): the ride's begun. */
  loaded(): void {
    if (this.stage !== 'boop' && this.stage !== 'carry') return;
    this.stage = 'ride';
    this.t = 0;
    this.say('load');
  }

  /** What's happening on the way round, for the card. */
  heard(e: SkyEvent): void {
    if (this.stage === 'ride' && (e.t === 'fire' || e.t === 'in' || e.t === 'out' || e.t === 'boing')) this.say(e.t);
  }

  /** May the cat be picked up or booped now? (Not once it's off.) */
  get handsOff(): boolean {
    return this.stage !== 'boop' && this.stage !== 'carry';
  }

  /**
   * One step: 'snug' as it curls up in the hammock, 'home' when it's time to
   * go (it's been seen), 'leave' a moment later, 'rescue' if the ride's gone
   * on too long (it's put in the hammock).
   */
  step(sim: SkySim, cat: Cat): 'snug' | 'home' | 'leave' | 'rescue' | null {
    this.t++;
    if (this.stage === 'ride') {
      const ham = hammockOf(sim);
      const inIt = !!ham?.sling?.riders.includes(cat.body);
      this.settledIn = inIt && cat.settled > 0 ? this.settledIn + 1 : 0;
      if (this.settledIn > 20) {
        this.stage = 'snug';
        this.t = 0;
        this.say('snug');
        return 'snug';
      }
      if (this.t > RIDE_MAX) {
        this.t = RIDE_MAX - 60 * 4;
        return 'rescue';
      }
    } else if (this.stage === 'snug' && this.t > SNUG_FRAMES) {
      this.stage = 'home';
      this.t = 0;
      this.say('home');
      return 'home';
    } else if (this.stage === 'home' && this.t === HOME_FRAMES) return 'leave';
    return null;
  }
}

/**
 * The course's hammock let hang till it's still, before anyone's there (so
 * it's just the same however long the cannon takes to be found).
 */
export function settleCourse(sim: SkySim): void {
  for (const p of sim.props) {
    const sl = p.sling;
    if (!sl) continue;
    for (let i = 0; i < 1200 && !sl.still; i++) {
      sl.gather([]);
      sl.step(FRAME_DT, GRAVITY);
    }
  }
}

/** The course's hammock. */
export function hammockOf(sim: SkySim): SkySim['props'][number] | undefined {
  return sim.props.find((p) => p.sling);
}

/** Where a cat goes if it ever needs putting in the hammock: just over its middle. */
export function hammockDrop(sim: SkySim): { x: number; y: number } | null {
  const h = hammockOf(sim);
  return h ? { x: h.save.x, y: h.save.y - 40 } : null;
}

/** The tour's cannon, and whether a cat let go at (x, y) is near enough its mouth to go in. */
export function nearCannon(sim: SkySim, x: number, y: number): ReturnType<typeof gadgetOf> {
  for (const p of sim.props) {
    const g = gadgetOf(p.save);
    if (!g || g.kind !== 'cannon') continue;
    const m = cannonMouth(g);
    if (Math.hypot(x - m.zx, y - m.zy) < TOUR_REACH) return g;
  }
  return null;
}
