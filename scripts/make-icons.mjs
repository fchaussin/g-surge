/* Rasterises static/icons/icon.svg into the PNGs the manifest asks for.

   Chromium via Playwright rather than a raster library: it is already a
   dependency, it renders the SVG exactly as a browser will, and it needs no
   native build. The PNGs are committed — a manifest icon has to exist in the
   deployed directory, and adding a browser download to the build to produce
   four small files would be a poor trade.

   Usage : node scripts/make-icons.mjs */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const DIR = 'static/icons';
const svg = readFileSync(join(DIR, 'icon.svg'), 'utf8');

/* `maskable` scales the drawing into the inner 80 % that launchers guarantee
   to keep, and lets the background bleed to the edges behind it. */
const TARGETS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

const page = await (await chromium.launch()).newPage();

for (const { file, size, maskable } of TARGETS) {
  const inner = maskable
    ? `<div style="transform:scale(.78);transform-origin:center">${svg}</div>`
    : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>
       html,body{margin:0;width:100%;height:100%;background:#05060a;overflow:hidden}
       body{display:grid;place-items:center}
       svg{width:${size}px;height:${size}px;display:block}
     </style>${inner}`,
    { waitUntil: 'load' },
  );
  mkdirSync(DIR, { recursive: true });
  const buffer = await page.screenshot({ omitBackground: false });
  writeFileSync(join(DIR, file), buffer);
  console.log(`  ${file.padEnd(24)} ${size}×${size}  ${(buffer.length / 1024).toFixed(1)} Ko`);
}

await page.context().browser().close();
