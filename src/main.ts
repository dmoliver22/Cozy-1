import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './house/house.css';
import { App } from './app';
import { pageStyles } from './pageStyles';

pageStyles(true);

async function boot(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('700 16px "Baloo 2"'), document.fonts.load('800 16px "Baloo 2"'), document.fonts.load('700 16px "Nunito"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    // fonts are a nicety
  }
  const app = new App();
  (window as unknown as { __app: App }).__app = app;
  await app.start();
}

void boot();
