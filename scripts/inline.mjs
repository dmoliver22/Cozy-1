// Inline the built JS/CSS (and the favicon) into one self-contained HTML page.
// Usage: node scripts/inline.mjs dist-single            (the game, index.html)
//        node scripts/inline.mjs dist-proto/jar jar     (a prototype, jar.html)
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-single';
const page = `${process.argv[3] ?? 'index'}.html`;
const htmlPath = join(dir, page);
let html = readFileSync(htmlPath, 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_, file) => {
  const js = readFileSync(join(dir, file), 'utf8').replace(/<\/script/g, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/g, (_, file) => `<style>${readFileSync(join(dir, file), 'utf8')}</style>`);
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
if (existsSync(join(dir, 'icon.svg'))) {
  const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
  html = html.replace('href="./icon.svg"', `href="data:image/svg+xml,${encodeURIComponent(svg)}"`);
}
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
writeFileSync(htmlPath, html);

// Everything now lives in the one page.
for (const f of readdirSync(dir)) if (f !== page) rmSync(join(dir, f), { recursive: true, force: true });
console.log(`inlined -> ${htmlPath} (${(html.length / 1024).toFixed(0)} KB)`);
