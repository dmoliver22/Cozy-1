// One-line tips, each shown once: a little bubble pointing at what it's about
// (the games' tins, the cats' faces, the Build tin), the first time there's
// a moment for it. Tap it (or Got it) and it's gone for good; doing the thing
// it says does that too. Tips wait their turn: one at a time, the first whose
// thing is on screen, and none over a card.

export const TIPS_KEY = 'cozy-tips:v1';

interface Tip {
  id: string;
  text: string;
  /** What it points at (nothing on screen: it waits). */
  at: () => HTMLElement | null;
  /** Just by it, no arrow (a tip about the whole screen, by the top bar). */
  plain: boolean;
}

class Coach {
  private seen: Set<string>;
  private all = false;
  private queue: Tip[] = [];
  private shown: Tip | null = null;
  private el: HTMLElement | null = null;
  private raf = 0;

  constructor() {
    this.seen = new Set();
    try {
      const raw = localStorage.getItem(TIPS_KEY);
      if (raw === 'all') this.all = true;
      else if (raw) for (const id of JSON.parse(raw) as string[]) this.seen.add(id);
    } catch {
      // (nothing kept: every tip's new)
    }
  }

  /** Has this tip been seen? */
  has(id: string): boolean {
    return this.all || this.seen.has(id);
  }

  /** This tip, when there's a moment (once ever; again while it's waiting does nothing). */
  tip(id: string, text: string, at: () => HTMLElement | null, plain = false): void {
    if (this.has(id) || this.queue.some((t) => t.id === id)) return;
    this.queue.push({ id, text, at, plain });
    this.loop();
  }

  /** Done with (dismissed, or the thing it says has been done): never again. */
  done(id: string): void {
    this.queue = this.queue.filter((t) => t.id !== id);
    if (!this.has(id)) {
      this.seen.add(id);
      try {
        localStorage.setItem(TIPS_KEY, JSON.stringify([...this.seen]));
      } catch {
        // (private browsing: it may show again another time)
      }
    }
    if (this.shown?.id === id) this.shown = null;
    this.loop();
  }

  private bubble(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'coach hidden';
    el.setAttribute('role', 'note');
    el.innerHTML = `<p class="coach-text"></p><button class="coach-ok">Got it</button>`;
    el.addEventListener('click', () => {
      if (this.shown) this.done(this.shown.id);
    });
    (document.getElementById('app') ?? document.body).appendChild(el);
    this.el = el;
    return el;
  }

  /** Each frame while there's a tip: the first one whose thing is showing, by it (above it, or under it at the top of the screen). */
  private loop(): void {
    if (this.raf) return;
    const frame = (): void => {
      this.raf = 0;
      const el = this.bubble();
      const overlay = document.getElementById('overlay');
      const card = !!overlay && !overlay.classList.contains('hidden');
      let pick: { tip: Tip; r: DOMRect } | null = null;
      if (!card) {
        for (const t of this.queue) {
          const a = t.at();
          const r = a?.getBoundingClientRect();
          if (a && r && r.width > 0 && r.height > 0 && a.offsetParent !== null) {
            pick = { tip: t, r };
            break;
          }
        }
      }
      if (!pick) {
        el.classList.add('hidden');
        this.shown = null;
      } else {
        const { tip, r } = pick;
        if (this.shown !== tip) {
          this.shown = tip;
          el.querySelector('.coach-text')!.textContent = tip.text;
          el.classList.remove('hidden');
          // (popping in afresh)
          el.classList.remove('coach-pop');
          void el.offsetWidth;
          el.classList.add('coach-pop');
        }
        const W = window.innerWidth;
        const H = window.innerHeight;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const cx = r.left + r.width / 2;
        const left = Math.max(12, Math.min(W - 12 - w, cx - w / 2));
        const below = r.top + r.height / 2 < H / 2;
        el.style.left = `${left}px`;
        el.style.top = below ? `${r.bottom + 12}px` : `${r.top - 12 - h}px`;
        el.dataset.side = tip.plain ? 'plain' : below ? 'below' : 'above';
        el.style.setProperty('--arrow-x', `${Math.max(18, Math.min(w - 18, cx - left))}px`);
      }
      if (this.queue.length) this.raf = requestAnimationFrame(frame);
      else el.classList.add('hidden');
    };
    this.raf = requestAnimationFrame(frame);
  }
}

/** The tips, for everywhere. */
export const coach = new Coach();
