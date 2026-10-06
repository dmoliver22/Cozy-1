// The cat maker: make your own cat, or restyle the one you made. A live
// preview up top (your cat on a cushion, a soft body like every cat in the
// house: poke it and it hops, and a new size or squish drops it in afresh, so
// you can see how firm or runny it is), then its name, coat, pattern, eyes,
// fur, size, squish (from a firm loaf to a puddle) and personality.

import type { AudioEngine } from '../audio/audio';
import { roundedBox } from '../physics/shapes';
import { SoftBody } from '../physics/softbody';
import { FRAME_DT, World } from '../physics/world';
import {
  COATS,
  COAT_ORDER,
  EYES,
  EYE_ORDER,
  NAME_IDEAS,
  NAME_MAX,
  PATTERNS,
  PATTERN_ORDER,
  PERSONALITIES,
  PERSONALITY_ORDER,
  cleanName,
  designBreed,
  designLook,
  randomDesign,
  squishWords,
  type CatDesign,
} from '../physics/mycat';
import { CatView, drawCat, type Expression } from '../render/catArt';
import { paintCushion } from '../render/cushion';
import { contactShadow } from '../render/paint';
import { faceSVG } from '../ui/faces';

export interface MakerHost {
  readonly audio: AudioEngine;
  openOverlay(html: string, onBind?: (root: HTMLElement) => void): void;
  closeOverlay(): void;
}

export interface MakerOptions {
  /** Making a new cat (rather than restyling the one you have). */
  fresh: boolean;
  /** Names already taken in the house (a new random name won't be one of these). */
  taken: string[];
  done(d: CatDesign): void;
}

/** The preview's cushion: its top is y = 0, and it's this wide. */
const CUSHION_W = 190;
/** The preview's ceiling (its underside), just above the top of the view. */
const CEILING = -122;
const CUSHION_COLOR = '#7FA0C8';

export class CatMaker {
  private d: CatDesign;
  private root: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private world = new World();
  private body: SoftBody | null = null;
  private view: CatView | null = null;
  private running = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private settled = 0;
  private poked = 99;
  private seed = 11;

  constructor(
    private readonly host: MakerHost,
    start: CatDesign,
    private readonly opts: MakerOptions,
  ) {
    this.d = { ...start };
    this.world.addStatic(roundedBox(-CUSHION_W / 2, 0, CUSHION_W, 40, 14));
    // (walls and a ceiling at the edges of the view: a big hop stays on screen)
    this.world.addStatic(roundedBox(-170, -400, 20, 460, 4));
    this.world.addStatic(roundedBox(150, -400, 20, 460, 4));
    this.world.addStatic(roundedBox(-170, CEILING - 20, 340, 20, 4));
  }

  get design(): CatDesign {
    return { ...this.d };
  }

  open(): void {
    const d = this.d;
    const title = this.opts.fresh ? 'Make your cat' : `Restyle ${d.name}`;
    const swatch = (group: string, id: string, color: string, label: string, on: boolean): string =>
      `<button class="mk-swatch" role="radio" data-${group}="${id}" aria-checked="${on}" aria-label="${label}" title="${label}" style="--c:${color}"></button>`;
    const chip = (group: string, id: string, label: string, on: boolean): string => `<button class="mk-chip" role="radio" data-${group}="${id}" aria-checked="${on}">${label}</button>`;
    this.host.openOverlay(
      `<div class="card maker" role="dialog" aria-label="${title}">
        <div class="mk-stage">
          <canvas class="mk-canvas" aria-label="Your cat. Tap to poke it."></canvas>
          <h2 class="mk-title">${title}</h2>
          <button class="mk-dice" data-act="dice" aria-label="Surprise me: a cat at random">🎲 Surprise me</button>
          <span class="mk-poke" aria-hidden="true">tap to poke</span>
        </div>
        <div class="mk-name">
          <label for="mkName">Name</label>
          <input id="mkName" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" value="${d.name}">
          <button class="mk-chip" data-act="name" aria-label="Another name">↻</button>
        </div>
        <div class="mk-group"><div class="mk-label">Coat</div>
          <div class="mk-swatches" role="radiogroup" aria-label="Coat">${COAT_ORDER.map((c) => swatch('coat', c, COATS[c].body, COATS[c].name, c === d.coat)).join('')}</div></div>
        <div class="mk-group"><div class="mk-label">Pattern</div>
          <div class="mk-chips" role="radiogroup" aria-label="Pattern">${PATTERN_ORDER.map((p) => chip('pattern', p, `<span class="mk-face" data-face="${p}"></span>${PATTERNS[p]}`, p === d.pattern)).join('')}</div></div>
        <div class="mk-group"><div class="mk-label">Eyes</div>
          <div class="mk-swatches" role="radiogroup" aria-label="Eyes">${EYE_ORDER.map((e) => swatch('eyes', e, EYES[e].color, EYES[e].name, e === d.eyes)).join('')}</div></div>
        ${this.slider('fur', 'Fur', d.fur, 'Short', 'Fluffy')}
        ${this.slider('size', 'Size', d.size, 'Tiny', 'Chonky')}
        ${this.slider('squish', 'Squish', d.squish, 'Loaf', 'Puddle')}
        <div class="mk-group"><div class="mk-label">Personality</div>
          <div class="mk-chips" role="radiogroup" aria-label="Personality">${PERSONALITY_ORDER.map((p) => chip('personality', p, PERSONALITIES[p].name, p === d.personality)).join('')}</div></div>
        <div class="btns mk-btns">
          <button class="btn primary" data-act="done"></button>
          <button class="btn" data-close>${this.opts.fresh ? 'Not now' : 'Cancel'}</button>
        </div>
      </div>`,
      (root) => this.bind(root),
    );
  }

  /** Stop the preview (the card closed, however it was closed). */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.root = null;
    this.canvas = null;
  }

  private slider(key: 'fur' | 'size' | 'squish', label: string, v: number, lo: string, hi: string): string {
    const extra = key === 'squish' ? `<b class="mk-flow" data-flow></b>` : '';
    return `<div class="mk-group mk-slide"><div class="mk-label">${label}${extra}</div>
      <input type="range" min="0" max="100" step="1" value="${Math.round(v * 100)}" data-slide="${key}" aria-label="${label}: ${lo} to ${hi}">
      <div class="mk-ends"><span>${lo}</span><span>${hi}</span></div></div>`;
  }

  private bind(root: HTMLElement): void {
    this.root = root;
    this.canvas = root.querySelector<HTMLCanvasElement>('.mk-canvas');
    const pick = (group: 'coat' | 'pattern' | 'eyes' | 'personality'): void => {
      root.querySelectorAll<HTMLElement>(`[data-${group}]`).forEach((b) =>
        b.addEventListener('click', () => {
          (this.d[group] as string) = b.dataset[group]!;
          this.host.audio.click();
          this.changed(false);
        }),
      );
    };
    pick('coat');
    pick('pattern');
    pick('eyes');
    pick('personality');
    root.querySelectorAll<HTMLInputElement>('[data-slide]').forEach((el) => {
      const key = el.dataset.slide as 'fur' | 'size' | 'squish';
      // fur shows as you slide; a new size or squish drops a fresh cat onto
      // the cushion once you let go (to show it off), the readout following as you slide
      el.addEventListener('input', () => {
        this.d[key] = Number(el.value) / 100;
        if (key === 'fur') this.changed(false);
        else this.refresh();
      });
      if (key !== 'fur') el.addEventListener('change', () => this.changed(true));
    });
    const name = root.querySelector<HTMLInputElement>('#mkName')!;
    name.addEventListener('input', () => {
      this.d.name = cleanName(name.value) || this.d.name;
      this.refresh();
    });
    name.addEventListener('blur', () => {
      name.value = this.d.name;
    });
    root.querySelector('[data-act=name]')!.addEventListener('click', () => {
      const ideas = NAME_IDEAS.filter((n) => n !== this.d.name && !this.opts.taken.includes(n));
      this.d.name = ideas[Math.floor(Math.random() * ideas.length)] ?? this.d.name;
      name.value = this.d.name;
      this.host.audio.click();
      this.refresh();
    });
    root.querySelector('[data-act=dice]')!.addEventListener('click', () => {
      this.d = randomDesign(Math.random, [...this.opts.taken, this.d.name]);
      name.value = this.d.name;
      for (const el of root.querySelectorAll<HTMLInputElement>('[data-slide]')) el.value = String(Math.round(this.d[el.dataset.slide as 'fur' | 'size' | 'squish'] * 100));
      this.host.audio.click();
      this.changed(true);
    });
    root.querySelector('[data-act=done]')!.addEventListener('click', () => {
      const d = { ...this.d, name: cleanName(name.value) || this.d.name };
      this.host.audio.reveal();
      this.host.closeOverlay();
      this.opts.done(d);
    });
    this.canvas?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.poke();
    });
    this.refresh();
    this.drop(true);
    this.running = true;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The design changed: the controls and the preview follow (and maybe a fresh drop). */
  private changed(drop: boolean): void {
    this.refresh();
    if (drop || !this.body) this.drop(false);
    else this.recoat();
  }

  /** The same cat, just as it is, in its new coat. */
  private recoat(): void {
    const old = this.body!;
    const br = designBreed(this.d);
    if (br.physics.nodes !== old.n) return this.drop(false);
    const snap = old.snapshot();
    this.world.removeBody(old);
    const b = new SoftBody('mine', 0, 0, br.physics, br.look);
    b.restore(snap);
    this.world.addBody(b);
    this.body = b;
  }

  /** Every control shows the design; the readouts say what it is. */
  private refresh(): void {
    const root = this.root;
    if (!root) return;
    const d = this.d;
    for (const group of ['coat', 'pattern', 'eyes', 'personality'] as const)
      root.querySelectorAll<HTMLElement>(`[data-${group}]`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[group] === d[group])));
    // (each pattern shown in the coat you've picked)
    root.querySelectorAll<HTMLElement>('[data-face]').forEach((el) => {
      const pattern = el.dataset.face as CatDesign['pattern'];
      el.innerHTML = faceSVG('mine', { look: designLook({ ...d, pattern }), key: `mk-${d.coat}-${d.eyes}-${pattern}`, size: 22 });
    });
    const flow = root.querySelector<HTMLElement>('[data-flow]');
    if (flow) flow.textContent = squishWords(d.squish).flow;
    const done = root.querySelector<HTMLElement>('[data-act=done]');
    if (done) done.textContent = this.opts.fresh ? `Bring ${d.name} home` : `Save ${d.name}`;
  }

  /** A fresh body for the design, dropped onto the cushion (from higher up the first time). */
  private drop(first: boolean): void {
    if (this.body) this.world.removeBody(this.body);
    const br = designBreed(this.d);
    const r = br.physics.radius;
    // (dropped from a little way up, its ears clear of the ceiling)
    const b = new SoftBody('mine', 0, Math.max(-r - (first ? 10 : 70), CEILING + r * 1.15 + 4), br.physics, br.look);
    this.world.addBody(b);
    this.body = b;
    this.view = new CatView(b.n, this.seed++);
    this.view.side = 1;
    this.settled = 0;
    this.poked = 99;
    if (!first) this.host.audio.boop(br.voice.pitch);
  }

  /** A poke: a little hop. */
  private poke(): void {
    const b = this.body;
    if (!b) return;
    b.wake();
    b.computeCentroid();
    b.kick((Math.random() - 0.5) * b.p.hop * 0.3, -b.p.hop);
    this.poked = 0;
    this.host.audio.boop(designBreed(this.d).voice.pitch);
  }

  private frame = (t: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : FRAME_DT;
    this.last = t;
    this.acc += dt;
    let n = 0;
    while (this.acc >= FRAME_DT && n < 3) {
      this.step();
      this.acc -= FRAME_DT;
      n++;
    }
    if (n === 3) this.acc = 0;
    this.draw(dt);
  };

  private step(): void {
    const b = this.body;
    if (!b) return;
    this.world.step();
    this.poked++;
    // loaf at rest, round on the move (as in the house)
    const still = b.emaVx * b.emaVx + b.emaVy * b.emaVy < 14 * 14 && b.emaEnergy < 400 && b.airborneFrames < 3;
    this.settled = still ? this.settled + 1 : 0;
    if (this.settled > 8) b.loafiness = Math.min(1, b.loafiness + FRAME_DT * 1.4);
    else if (b.energy > 900) b.loafiness = Math.max(0, b.loafiness - FRAME_DT * 3);
  }

  private draw(dt: number): void {
    const c = this.canvas;
    const b = this.body;
    const v = this.view;
    if (!c || !b || !v) return;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const s = Math.min(W / 250, (H - 34) / 124);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, (dpr * W) / 2, dpr * (H - 30));
    // the cushion
    ctx.save();
    ctx.translate(-CUSHION_W / 2, -3);
    paintCushion(ctx, CUSHION_W, 30, CUSHION_COLOR, 3);
    ctx.restore();
    v.update(dt);
    b.computeCentroid();
    let maxY = -Infinity;
    for (let i = 0; i < b.n; i++) maxY = Math.max(maxY, b.y[i]);
    const hgt = Math.max(0, -maxY);
    contactShadow(ctx, b.cx, 1, b.p.radius * (1.1 - Math.min(0.5, hgt / 200)), 0.32 * Math.max(0.3, 1 - hgt / 120), 0.8);
    const persona = b.breed.look.persona;
    const expression: Expression = this.poked < 24 ? 'squint' : b.airborneFrames > 6 ? 'wide' : this.settled > 40 && persona === 'sleepy' ? 'sleepy' : this.settled > 140 ? 'content' : 'open';
    drawCat(ctx, b, v, { expression, look: 0, rim: null, seated: false, resting: this.settled > 6, purr: 0, grabbed: false, glow: 0 }, s);
  }
}
