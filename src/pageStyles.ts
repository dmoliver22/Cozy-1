// The If It Fits page's stylesheet, on the page only while the house's own
// screens (the home room, If It Fits) are: Cat Jar and Cat Drop bring their
// own, and the two would fight over shared names (.card, .btn, body...).

import css from './styles.css?inline';
import { attachStyles } from './proto/shell';

let remove: (() => void) | null = null;

export function pageStyles(on: boolean): void {
  if (on && !remove) remove = attachStyles(css, 'if-it-fits');
  else if (!on && remove) {
    remove();
    remove = null;
  }
}
