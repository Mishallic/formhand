// Renders the Formhand mark to the PNG sizes browsers want: node scripts/make-icons.mjs
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
mkdirSync(out, { recursive: true });

// Same drawing as Mark() in src/ui/icons.tsx. Small sizes drop the last line so it stays legible.
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
  <rect width="24" height="24" rx="5" fill="#2f44d0"/>
  <rect x="4.5" y="5.5" width="6" height="6" rx="1" fill="none" stroke="#fff" stroke-width="1.6"/>
  <path d="M5.9 8.6l1.4 1.4 2.4-2.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12.5 10.5h7M4.5 15.5h15${size > 16 ? 'M4.5 19h10' : ''}" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(size)}`);
  await page.locator('svg').screenshot({ path: join(out, `${size}.png`), omitBackground: true });
}
await browser.close();
console.log(`icons written to ${out}`);
