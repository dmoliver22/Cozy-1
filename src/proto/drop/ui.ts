// Cat Drop: the HUD (depth, fish and size, score, how far above bath time
// is), a toast naming each room as the cat drops into it, and the start and
// end cards (the end card sits up top, over the bath the cat ends up in).

import { BREEDS, type BreedId } from '../../physics/breeds';
import { faceSVG } from '../../ui/faces';
import type { DropState } from './game';

export const BREED_CHOICES: BreedId[] = ['tabby', 'kitten', 'persian', 'mainecoon', 'chonk'];

const BLURB: Partial<Record<BreedId, string>> = {
  tabby: 'All-rounder',
  kitten: 'Small & zippy',
  persian: 'Slow as honey',
  mainecoon: 'Big fluffy cloud',
  chonk: 'Heavy pudding',
};

const HOUSE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.2V19a1 1 0 0 0 1 1h3.4v-5.2h3.2V20H17a1 1 0 0 0 1-1v-8.8" fill="currentColor"/></svg>`;
const FISH_ICON = `<svg viewBox="0 0 24 16" width="22" height="15" aria-hidden="true"><path d="M3 8c3-5 10-6 15-2l4-3-1 5 1 5-4-3c-5 4-12 3-15-2Z" fill="#8FB3D9" stroke="#55739A" stroke-width="1.2" stroke-linejoin="round"/><circle cx="15.5" cy="7" r="1.2" fill="#3E3A4F"/></svg>`;
/** Soap bubbles, white with a rainbow sheen (a pile of suds). */
const SUDS = `<defs><radialGradient id="dSud" cx="36%" cy="32%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#F5F1FC"/><stop offset="1" stop-color="#D6CCEE"/></radialGradient><linearGradient id="dSheen" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#F6A8C4"/><stop offset=".35" stop-color="#FADE8C"/><stop offset=".65" stop-color="#96E2BE"/><stop offset="1" stop-color="#8CBEF6"/></linearGradient></defs>`;
function sud(x: number, y: number, r: number): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#dSud)" stroke="#B8ACDA" stroke-width="${Math.max(0.35, r * 0.09)}"/><path d="M${x - r * 0.72} ${y + r * 0.1}A${r * 0.74} ${r * 0.74} 0 0 1 ${x + r * 0.05} ${y - r * 0.72}" stroke="url(#dSheen)" stroke-width="${r * 0.16}" fill="none" stroke-linecap="round" opacity=".75"/><ellipse cx="${x - r * 0.36}" cy="${y - r * 0.38}" rx="${r * 0.2}" ry="${r * 0.12}" transform="rotate(-40 ${x - r * 0.36} ${y - r * 0.38})" fill="#fff"/>`;
}
const BATH_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${SUDS}${sud(8.6, 14.2, 6)}${sud(16.6, 15.6, 4.6)}${sud(14.4, 7.4, 3.6)}${sud(20.4, 7.8, 1.8)}</svg>`;

export interface UiHandlers {
  play(breed: BreedId, daily: boolean): void;
  again(): void;
  menu(): void;
  toggleMusic(): boolean;
  toggleSound(): boolean;
  /** Back to the house (absent on a page of its own). */
  home?: () => void;
}

export class DropUi {
  readonly root: HTMLElement;
  private depth!: HTMLElement;
  private fish!: HTMLElement;
  private mult!: HTMLElement;
  private score!: HTMLElement;
  private best!: HTMLElement;
  private bath!: HTMLElement;
  private bathText!: HTMLElement;
  private toast!: HTMLElement;
  private startCard!: HTMLElement;
  private overCard!: HTMLElement;
  private toastTimer = 0;
  breed: BreedId;
  private last = '';

  constructor(
    root: HTMLElement,
    h: UiHandlers,
    breed: BreedId,
    music: boolean,
    sound: boolean,
  ) {
    this.root = root;
    this.breed = breed;
    root.innerHTML = `
      <div class="hud drop-hud">
        <div class="pill" id="dDepth" aria-label="Depth"><span class="num">0</span><small>m</small></div>
        <div class="pill" id="dFish" aria-label="Fish eaten">${FISH_ICON}<span class="num">0</span><span class="mult" id="dMult">×1.0</span></div>
        <div class="spacer"></div>
        <div class="pill" id="dScore" aria-label="Score"><small>score</small><span class="num">0</span></div>
      </div>
      <div class="drop-bath" id="dBath">${BATH_ICON}<span class="sr">Bath time is </span><span id="dBathText">–</span><span class="sr"> above</span></div>
      <div class="drop-best" id="dBest"></div>
      <div class="drop-toast" id="dToast"></div>
      <div class="drop-btns">
        ${h.home ? `<button class="round drop-home" id="dHome" aria-label="Home">${HOUSE}</button>` : ''}
        <button class="round" id="dMusic" aria-label="Music" aria-pressed="${music}">♪</button>
        <button class="round" id="dSound" aria-label="Sound" aria-pressed="${sound}">${soundIcon(sound)}</button>
      </div>
      <div class="card drop-card" id="dStart" role="dialog" aria-label="Cat Drop">
        <h2>Cat Drop</h2>
        <p>Drag to steer, tap to bounce. Eat fish to get chonkier. Stay ahead of bath time!</p>
        <div class="breeds" role="radiogroup" aria-label="Pick a cat">${BREED_CHOICES.map((b) => breedButton(b, b === breed)).join('')}</div>
        <div class="flow" id="dFlow"></div>
        <div class="row">
          <button class="btn" id="dPlay">Play</button>
          <button class="btn soft" id="dDaily">Daily drop</button>
          ${h.home ? '<button class="btn soft" data-home>Home</button>' : ''}
        </div>
        <div class="bestline" id="dStartBest"></div>
      </div>
      <div class="card drop-card" id="dOver" role="dialog" aria-label="Bath time">
        <h2>Bath time!</h2>
        <div class="stats">
          <div><b id="dOverDepth">0</b><small>metres</small></div>
          <div><b id="dOverFish">0</b><small>fish</small></div>
          <div><b id="dOverScore">0</b><small>score</small></div>
        </div>
        <div class="bestline" id="dOverBest"></div>
        <div class="row">
          <button class="btn" id="dAgain">Again</button>
          <button class="btn soft" id="dMenu">Change cat</button>
          ${h.home ? '<button class="btn soft" data-home>Home</button>' : ''}
        </div>
      </div>`;
    const $ = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement;
    this.depth = $('dDepth').querySelector('.num') as HTMLElement;
    this.fish = $('dFish').querySelector('.num') as HTMLElement;
    this.mult = $('dMult');
    this.score = $('dScore').querySelector('.num') as HTMLElement;
    this.best = $('dBest');
    this.bath = $('dBath');
    this.bathText = $('dBathText');
    this.toast = $('dToast');
    this.startCard = $('dStart');
    this.overCard = $('dOver');
    for (const b of root.querySelectorAll<HTMLButtonElement>('.breed')) {
      b.addEventListener('click', () => {
        this.breed = b.dataset.breed as BreedId;
        for (const o of root.querySelectorAll<HTMLButtonElement>('.breed')) o.setAttribute('aria-checked', String(o === b));
        this.showFlow();
      });
    }
    this.showFlow();
    $('dPlay').addEventListener('click', () => h.play(this.breed, false));
    $('dDaily').addEventListener('click', () => h.play(this.breed, true));
    $('dAgain').addEventListener('click', () => h.again());
    $('dMenu').addEventListener('click', () => h.menu());
    if (h.home) {
      const home = h.home;
      for (const b of root.querySelectorAll<HTMLElement>('#dHome, [data-home]')) b.addEventListener('click', () => home());
    }
    $('dMusic').addEventListener('click', (e) => {
      const on = h.toggleMusic();
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on));
    });
    $('dSound').addEventListener('click', (e) => {
      const on = h.toggleSound();
      const el = e.currentTarget as HTMLElement;
      el.setAttribute('aria-pressed', String(on));
      el.innerHTML = soundIcon(on);
    });
  }

  private showFlow(): void {
    const b = BREEDS[this.breed];
    (this.root.querySelector('#dFlow') as HTMLElement).textContent = `${b.name}: ${b.flow}. ${BLURB[this.breed] ?? ''}`;
  }

  showStart(best: number): void {
    (this.root.querySelector('#dStartBest') as HTMLElement).textContent = best > 0 ? `Best ${best}` : '';
    this.overCard.classList.remove('show');
    this.startCard.classList.add('show');
    this.root.classList.add('menu');
  }

  hideCards(): void {
    this.startCard.classList.remove('show');
    this.overCard.classList.remove('show');
    this.root.classList.remove('menu');
  }

  get cardShown(): boolean {
    return this.startCard.classList.contains('show') || this.overCard.classList.contains('show');
  }

  showOver(s: DropState, best: number, newBest: boolean): void {
    const $ = (id: string): HTMLElement => this.root.querySelector(`#${id}`) as HTMLElement;
    $('dOverDepth').textContent = String(s.depth);
    $('dOverFish').textContent = String(s.fish);
    $('dOverScore').textContent = String(s.score);
    $('dOverBest').textContent = newBest ? 'New best!' : `Best ${best}`;
    $('dOverBest').classList.toggle('new', newBest);
    this.overCard.classList.add('show');
    this.root.classList.add('menu');
  }

  setBest(best: number, daily: boolean): void {
    this.best.textContent = best > 0 ? `${daily ? 'daily best' : 'best'} ${best}` : '';
  }

  update(s: DropState, foamOnScreen: boolean): void {
    const key = `${s.depth}|${s.fish}|${s.mult}|${s.score}|${s.bathGapM}|${foamOnScreen}|${s.phase}`;
    if (key === this.last) return;
    this.last = key;
    this.depth.textContent = String(s.depth);
    this.fish.textContent = String(s.fish);
    this.mult.textContent = `×${s.mult.toFixed(1)}`;
    this.mult.classList.toggle('big', s.mult >= 1.4);
    this.score.textContent = String(s.score);
    const playing = s.phase === 'play';
    this.bath.classList.toggle('show', playing && !foamOnScreen);
    this.bathText.textContent = `${s.bathGapM} m`;
    const close = s.bathGapM < 9;
    this.bath.classList.toggle('close', close);
    this.bath.classList.toggle('near', !close && s.bathGapM < 16);
  }

  room(name: string): void {
    this.toast.textContent = name;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1600);
  }
}

function breedButton(b: BreedId, on: boolean): string {
  return `<button class="breed" role="radio" data-breed="${b}" aria-checked="${on}" aria-label="${BREEDS[b].name}">${faceSVG(b, { size: 40 })}<span>${BREEDS[b].name}</span></button>`;
}

function soundIcon(on: boolean): string {
  return on
    ? `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z" fill="currentColor"/><path d="m16.5 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
