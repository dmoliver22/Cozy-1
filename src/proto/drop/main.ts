// Cat Drop on a page of its own (drop.html): its own sound and settings.

import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-700.css';
import { setMyCat } from '../../physics/breeds';
import { cleanDesign } from '../../physics/mycat';
import { standaloneShell } from '../shell';
import { mountDrop } from './mount';

// your own cat, if you've made one in the house (on the same site)
try {
  setMyCat(cleanDesign((JSON.parse(localStorage.getItem('cozy-house:v1') ?? '{}') as { cat?: unknown }).cat));
} catch {
  // storage blocked: the six cats
}

mountDrop(document.getElementById('app') as HTMLElement, standaloneShell('catdrop'));
