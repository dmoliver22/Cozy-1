// The DOM around the canvas: a HUD (score and best, boops as paw prints, the
// next cat's face, a music toggle) and the cards (start, jar's full).

import { faceSVG } from '../../ui/faces';
import { BOOPS_MAX, LAST_TIER, TIERS, WILD } from './config';
import type { JarGame, Mode } from './game';

export interface UiHandlers {
  play(mode: Mode): void;
  music(on: boolean): void;
  /** Back to the house (absent on a page of its own). */
  home?: () => void;
}

const PAW = `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="15.6" rx="5.6" ry="4.6"/><ellipse cx="5.4" cy="9.6" rx="2.2" ry="2.7"/><ellipse cx="9.6" cy="5.6" rx="2.2" ry="2.8"/><ellipse cx="14.4" cy="5.6" rx="2.2" ry="2.8"/><ellipse cx="18.6" cy="9.6" rx="2.2" ry="2.7"/></svg>`;
export const HOUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.2V19a1 1 0 0 0 1 1h3.4v-5.2h3.2V20H17a1 1 0 0 0 1-1v-8.8"/></svg>`;
const NOTE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V6.2l10-2.4v11.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.6" cy="17.6" rx="3" ry="2.4"/><ellipse cx="16.6" cy="15.4" rx="3" ry="2.4"/></svg>`;

const fmt = (n: number): string => n.toLocaleString('en-US');

export function todayLabel(d = new Date()): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export class JarUI {
  readonly hud: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly boopsEl: HTMLElement;
  private readonly nextEl: HTMLElement;
  private readonly musicBtn: HTMLButtonElement;
  private readonly startCard: HTMLElement;
  private readonly endCard: HTMLElement;
  private shown = { score: -1, best: -1, boops: -1, next: -1, mode: '' };
  endShown = false;
  private bump = 0;

  constructor(
    root: HTMLElement,
    private readonly h: UiHandlers,
    musicOn: boolean,
  ) {
    root.innerHTML = `
      <div class="hud jar-hud" id="hud">
        ${h.home ? `<button class="jar-music jar-home" id="homeBtn" aria-label="Home">${HOUSE_ICON}</button>` : ''}
        <div class="pill jar-score"><span class="jar-score-n" id="score">0</span><small id="best">best 0</small><small class="jar-mode" id="mode"></small></div>
        <div class="jar-boops" id="boops" aria-label="Boops left"></div>
        <div class="spacer"></div>
        <button class="jar-music" id="music" aria-label="Music" aria-pressed="${musicOn}">${NOTE}</button>
        <div class="jar-next" aria-label="Next cat"><small>next</small><div class="jar-next-face" id="next"></div></div>
      </div>
      <div class="card jar-card" id="start" role="dialog" aria-labelledby="startTitle">
        <h2 id="startTitle">Cat Jar</h2>
        <p>Drag sideways to aim, let go to drop. Two of the same cat that snuggle up melt into a bigger one!</p>
        <div class="jar-chain">${TIERS.slice(0, LAST_TIER + 1)
          .map((t, i) => `<span class="jar-chain-cat" title="${t.name}">${faceSVG(t.breed, { size: 21 + i * 3.4, mood: i === LAST_TIER ? 'happy' : 'open' })}<small>${t.trait}</small></span>`)
          .join('<span class="jar-arrow">›</span>')}</div>
        <p class="jar-wild"><span class="jar-wild-face">${faceSVG('void', { size: 22, mood: 'happy' })}</span>A Little Void melts into any cat and makes it one size bigger.</p>
        <p class="jar-tip">Cats left alone doze off (zzz) and won't melt: tap one to boop it awake (paws at the top). Swipe up and down to look around the tall jar.</p>
        <div class="jar-buttons"><button class="btn" id="playBtn">Play</button><button class="btn soft" id="dailyBtn">Daily jar</button>${h.home ? '<button class="btn soft" data-home>Home</button>' : ''}</div>
        <p class="jar-small" id="startBest"></p>
      </div>
      <div class="card jar-card" id="end" role="dialog" aria-labelledby="endTitle">
        <h2 id="endTitle">Jar's full!</h2>
        <p class="jar-small jar-daily" id="endMode"></p>
        <div class="jar-final" id="final">0</div>
        <p class="jar-small" id="endBest"></p>
        <div class="jar-biggest" id="biggest"></div>
        <div class="jar-buttons"><button class="btn" id="againBtn">Again</button><button class="btn soft" id="otherBtn">Daily jar</button>${h.home ? '<button class="btn soft" data-home>Home</button>' : ''}</div>
      </div>`;
    const $ = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement;
    this.hud = $('hud');
    this.scoreEl = $('score');
    this.bestEl = $('best');
    this.modeEl = $('mode');
    this.boopsEl = $('boops');
    this.nextEl = $('next');
    this.musicBtn = $('music') as HTMLButtonElement;
    this.startCard = $('start');
    this.endCard = $('end');
    $('playBtn').addEventListener('click', () => h.play('play'));
    if (h.home) {
      const home = h.home;
      for (const b of root.querySelectorAll<HTMLElement>('#homeBtn, [data-home]')) b.addEventListener('click', () => home());
    }
    $('dailyBtn').addEventListener('click', () => h.play('daily'));
    this.musicBtn.addEventListener('click', () => {
      const on = this.musicBtn.getAttribute('aria-pressed') !== 'true';
      this.musicBtn.setAttribute('aria-pressed', String(on));
      h.music(on);
    });
  }

  /** Height of the HUD in CSS px (the view keeps the jar below it). */
  hudBottom(): number {
    return this.hud.getBoundingClientRect().bottom + 4;
  }

  showStart(best: number, dailyBest: number): void {
    const s = this.startCard.querySelector('#startBest') as HTMLElement;
    s.textContent = best > 0 || dailyBest > 0 ? `Best ${fmt(best)} · today's jar ${fmt(dailyBest)}` : '';
    this.startCard.classList.add('show');
    this.endCard.classList.remove('show');
    this.endShown = false;
    this.hud.classList.add('jar-dim');
  }

  hideCards(): void {
    this.startCard.classList.remove('show');
    this.endCard.classList.remove('show');
    this.endShown = false;
    this.hud.classList.remove('jar-dim');
  }

  showEnd(game: JarGame, best: number, newBest: boolean): void {
    const $ = (id: string): HTMLElement => this.endCard.querySelector(`#${id}`) as HTMLElement;
    $('endMode').textContent = game.mode === 'daily' ? `Daily jar · ${todayLabel()}` : '';
    $('final').textContent = fmt(game.score);
    $('endBest').textContent = newBest ? 'New best!' : `Best ${fmt(best)}`;
    $('endBest').classList.toggle('jar-new', newBest);
    const t = TIERS[game.biggest];
    $('biggest').innerHTML = `${faceSVG(t.breed, { size: 34, mood: 'happy' })}<span>Biggest cat: <b>${t.name}</b></span>`;
    const again = $('againBtn');
    const other = $('otherBtn');
    const mode = game.mode;
    again.onclick = () => this.h.play(mode);
    other.textContent = mode === 'daily' ? 'Free play' : 'Daily jar';
    other.onclick = () => this.h.play(mode === 'daily' ? 'play' : 'daily');
    this.endCard.classList.add('show');
    this.endShown = true;
  }

  /** Refresh the HUD (cheap: only touches what changed). */
  update(game: JarGame, best: number, dt: number): void {
    const s = this.shown;
    if (game.score !== s.score) {
      if (s.score >= 0 && game.score > s.score) this.bump = 1;
      s.score = game.score;
      this.scoreEl.textContent = fmt(game.score);
    }
    if (this.bump > 0) {
      this.bump = Math.max(0, this.bump - dt * 4);
      this.scoreEl.style.transform = `scale(${1 + 0.18 * Math.sin(this.bump * Math.PI)})`;
    }
    const b = Math.max(best, game.score);
    if (b !== s.best) {
      s.best = b;
      this.bestEl.textContent = `best ${fmt(b)}`;
    }
    const mode = game.mode === 'daily' ? `daily · ${todayLabel()}` : '';
    if (mode !== s.mode) {
      s.mode = mode;
      this.modeEl.textContent = mode;
    }
    if (game.boops !== s.boops) {
      const gained = s.boops >= 0 && game.boops > s.boops;
      s.boops = game.boops;
      let html = '';
      for (let k = 0; k < BOOPS_MAX; k++) {
        if (k >= Math.max(3, game.boops) && k >= game.boops) break;
        html += `<span class="jar-paw${k < game.boops ? ' on' : ''}${gained && k === game.boops - 1 ? ' new' : ''}">${PAW}</span>`;
      }
      this.boopsEl.innerHTML = html;
      this.boopsEl.setAttribute('aria-label', `Boops left: ${game.boops}`);
    }
    const next = game.over ? -1 : (game.queue[1] ?? -1);
    if (next !== s.next) {
      s.next = next;
      this.nextEl.innerHTML = next >= 0 ? faceSVG(TIERS[next].breed, { size: next === WILD ? 26 : 22 + next * 4, mood: next === WILD ? 'happy' : undefined }) : '';
      this.nextEl.title = next >= 0 ? TIERS[next].name : '';
      this.nextEl.classList.toggle('jar-next-wild', next === WILD);
      (this.nextEl.parentElement as HTMLElement).style.visibility = next >= 0 ? '' : 'hidden';
    }
  }

  /** Shake the paws when there are no boops left. */
  noBoops(): void {
    this.boopsEl.classList.remove('jar-shake');
    void this.boopsEl.offsetWidth;
    this.boopsEl.classList.add('jar-shake');
  }

  setMusic(on: boolean): void {
    this.musicBtn.setAttribute('aria-pressed', String(on));
  }
}
