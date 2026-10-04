import { defineConfig } from 'vitest/config';

// Pages: the game (index.html) and two prototypes built on its engine
// (jar.html: Cat Jar, drop.html: Cat Drop).
const PAGES = ['index', 'jar', 'drop'];

// `--mode single` builds one page (PAGE=jar|drop, default the game) as one
// self-contained HTML file (see scripts/inline.mjs), handy for portals,
// itch.io uploads and quick sharing.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const page = process.env.PAGE ?? 'index';
  return {
    base: './',
    build: {
      target: 'es2020',
      outDir: single ? (page === 'index' ? 'dist-single' : `dist-proto/${page}`) : 'dist',
      assetsInlineLimit: single ? 100_000_000 : 4096,
      // one stylesheet per page (the prototypes must not restyle the game)
      cssCodeSplit: !single,
      sourcemap: false,
      rollupOptions: {
        input: Object.fromEntries((single ? [page] : PAGES).map((p) => [p, `${p}.html`])),
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
      testTimeout: 120_000,
    },
  };
});
