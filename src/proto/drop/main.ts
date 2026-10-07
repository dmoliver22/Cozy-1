// Cat Drop on a page of its own (drop.html): its own sound and settings.

import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-700.css';
import { nameCats, setMyCat, type BreedId } from '../../physics/breeds';
import { cleanDesign, cleanName } from '../../physics/mycat';
import { standaloneShell } from '../shell';
import { mountDrop } from './mount';

// your own cat, if you've made one in the house (on the same site), and the names you've given your cats
try {
  const h = JSON.parse(localStorage.getItem('cozy-house:v1') ?? '{}') as { cat?: unknown; residents?: unknown; names?: Record<string, unknown> };
  const d = cleanDesign(h.cat);
  setMyCat(d);
  const residents = Array.isArray(h.residents) ? (h.residents as BreedId[]) : [];
  const names: Partial<Record<BreedId, string>> = d ? { mine: d.name } : {};
  for (const b of residents) {
    const n = cleanName(h.names?.[b]);
    if (n && b !== 'mine') names[b] = n;
  }
  nameCats(names);
} catch {
  // storage blocked: the six cats, by their kinds
}

mountDrop(document.getElementById('app') as HTMLElement, standaloneShell('catdrop'));
