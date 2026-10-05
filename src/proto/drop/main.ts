// Cat Drop on a page of its own (drop.html): its own sound and settings.

import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-700.css';
import { standaloneShell } from '../shell';
import { mountDrop } from './mount';

mountDrop(document.getElementById('app') as HTMLElement, standaloneShell('catdrop'));
