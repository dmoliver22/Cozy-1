// Cat Drop: the HUD (depth, fish and size, score, how far above the vacuum
// is), a toast naming each room as the cat drops into it, and the start and
// end cards.

import { BREEDS, type BreedId } from '../../physics/breeds';
import { faceSVG } from '../../ui/faces';
import type { DropState } from './game';

export const BREED_CHOICES: BreedId[] = ['tabby', 'kitten', 'persian', 'sphynx', 'mainecoon', 'chonk'];

const BLURB: Partial<Record<BreedId, string>> = {
  tabby: 'All-rounder',
  kitten: 'Small & zippy',
  persian: 'Slow as honey',
  sphynx: 'Bouncy jelly',
  mainecoon: 'Big fluffy cloud',
  chonk: 'Heavy pudding',
};

const FISH_ICON = `<svg viewBox="0 0 24 16" width="22" height="15" aria-hidden="true"><path d="M3 8c3-5 10-6 15-2l4-3-1 5 1 5-4-3c-5 4-12 3-15-2Z" fill="#8FB3D9" stroke="#55739A" stroke-width="1.2" stroke-linejoin="round"/><circle cx="15.5" cy="7" r="1.2" fill="#3E3A4F"/></svg>`;
const VAC_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2v8" stroke="#8E9AA9" stroke-width="2.4" stroke-linecap="round"/><rect x="7" y="8" width="10" height="7" rx="3" fill="#E9DCC4" stroke="#B9A58E"/><rect x="2.5" y="14.5" width="19" height="6.5" rx="3" fill="#D8695F" stroke="#A9493F"/><circle cx="8" cy="17.6" r="1.6" fill="#FFE6A0"/><circle cx="16" cy="17.6" r="1.6" fill="#FFE6A0"/></svg>`;

export interface UiHandlers {
  play(breed: BreedId, daily: boolean): void;
  again(): void;
  menu(): void;
  toggleMusic(): boolean;
  toggleSound(): boolean;
}

export class DropUi {
  readonly root: HTMLElement;
  private depth!: HTMLElement;
  private fish!: HTMLElement;
  private mult!: HTMLElement;
  private score!: HTMLElement;
  private best!: HTMLElement;
  private vac!: HTMLElement;
  private vacText!: HTMLElement;
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
      <div class="drop-vac" id="dVac" aria-live="polite">${VAC_ICON}<span id="dVacText">–</span></div>
      <div class="drop-best" id="dBest"></div>
      <div class="drop-toast" id="dToast"></div>
      <div class="drop-btns">
        <button class="round" id="dMusic" aria-label="Music" aria-pressed="${music}">♪</button>
        <button class="round" id="dSound" aria-label="Sound" aria-pressed="${sound}">${soundIcon(sound)}</button>
      </div>
      <div class="card drop-card" id="dStart" role="dialog" aria-label="Cat Drop">
        <h2>Cat Drop</h2>
        <p>Drag to steer, tap to bounce. Eat fish to get chonkier. Stay ahead of the vacuum!</p>
        <div class="breeds" role="radiogroup" aria-label="Pick a cat">${BREED_CHOICES.map((b) => breedButton(b, b === breed)).join('')}</div>
        <div class="flow" id="dFlow"></div>
        <div class="row">
          <button class="btn" id="dPlay">Play</button>
          <button class="btn soft" id="dDaily">Daily drop</button>
        </div>
        <div class="bestline" id="dStartBest"></div>
      </div>
      <div class="card drop-card" id="dOver" role="dialog" aria-label="Slurped">
        <h2>Slurped!</h2>
        <div class="face" id="dOverFace"></div>
        <div class="stats">
          <div><b id="dOverDepth">0</b><small>metres</small></div>
          <div><b id="dOverFish">0</b><small>fish</small></div>
          <div><b id="dOverScore">0</b><small>score</small></div>
        </div>
        <div class="bestline" id="dOverBest"></div>
        <div class="row">
          <button class="btn" id="dAgain">Again</button>
          <button class="btn soft" id="dMenu">Change cat</button>
        </div>
      </div>`;
    const $ = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement;
    this.depth = $('dDepth').querySelector('.num') as HTMLElement;
    this.fish = $('dFish').querySelector('.num') as HTMLElement;
    this.mult = $('dMult');
    this.score = $('dScore').querySelector('.num') as HTMLElement;
    this.best = $('dBest');
    this.vac = $('dVac');
    this.vacText = $('dVacText');
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
    $('dOverFace').innerHTML = faceSVG(s.breed, { mood: 'sleepy', size: 54 });
    this.overCard.classList.add('show');
    this.root.classList.add('menu');
  }

  setBest(best: number, daily: boolean): void {
    this.best.textContent = best > 0 ? `${daily ? 'daily best' : 'best'} ${best}` : '';
  }

  update(s: DropState, vacOnScreen: boolean): void {
    const key = `${s.depth}|${s.fish}|${s.mult}|${s.score}|${s.vacuumGapM}|${vacOnScreen}|${s.phase}`;
    if (key === this.last) return;
    this.last = key;
    this.depth.textContent = String(s.depth);
    this.fish.textContent = String(s.fish);
    this.mult.textContent = `×${s.mult.toFixed(1)}`;
    this.mult.classList.toggle('big', s.mult >= 1.4);
    this.score.textContent = String(s.score);
    const playing = s.phase === 'play';
    this.vac.classList.toggle('show', playing && !vacOnScreen);
    this.vacText.textContent = `${s.vacuumGapM} m`;
    const close = s.vacuumGapM < 9;
    this.vac.classList.toggle('close', close);
    this.vac.classList.toggle('near', !close && s.vacuumGapM < 16);
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
