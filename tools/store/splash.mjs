/* The splash artwork, drawn with the app's own fonts and colours in the
   browser, then handed to the package as a picture. Android cannot read the
   woff2 faces the site uses, so the drawing is done here where it can. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

import { readFileSync as __read } from 'node:fs';

/* The faces are embedded in the page rather than fetched from a local server:
   a page made with setContent has no origin, so the browser refused the
   cross-origin font and drew the name in the system face instead. Every
   splash shipped before this was in the wrong font, and it did not show. */
const asData = (f) => 'data:font/woff2;base64,' + __read(f).toString('base64');
const plex = asData('docs/fonts/plex-arabic-600-arabic.woff2');
const amiri = asData('docs/fonts/amiri-400-arabic.woff2');

const OUT = 'android/app/src/main/res';
const themes = [
  { name: 'splash_art', paper: '#f6f4ee', ink: '#9c2b2b', word: '#16241c', gold: '#b08833', band: 'rgba(156,43,43,.10)' },
  { name: 'splash_art_night', paper: '#10161a', ink: '#ff6969', word: '#ede9e1', gold: '#bb9036', band: 'rgba(255,105,105,.10)' }
];

const page = await (await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
})).newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });

for (const t of themes) {
  await page.setContent(`<!doctype html><meta charset=utf-8>
  <style>
    @font-face { font-family: 'Plex'; src: url('${plex}') format('woff2'); font-weight: 600; }
    @font-face { font-family: 'Amiri'; src: url('${amiri}') format('woff2'); }
    html, body { margin: 0; height: 100%; background: ${t.paper}; }
    .wrap { height: 100%; display: grid; place-items: center; align-content: center; gap: 46px; position: relative; }
    .band { position: absolute; inset-inline: 0; height: 34px;
      background: repeating-linear-gradient(135deg, ${t.band} 0 17px, transparent 17px 34px); }
    .band.top { top: 210px; } .band.bottom { bottom: 210px; }
    .mark { width: 300px; height: 300px; }
    .name { font-family: 'Plex', sans-serif; font-weight: 600; font-size: 108px; color: ${t.word}; line-height: 1; }
    .rule { width: 300px; height: 2px; background: ${t.gold}; opacity: .75; }
  </style>
  <div class="wrap">
    <div class="band top"></div>
    <img class="mark" src="http://localhost:8899/icons/icon-512.png?v=eye" alt="">
    <div class="rule"></div>
    <div class="name">سُنّتي</div>
    <div class="band bottom"></div>
  </div>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check("600 108px Plex"));
  if (!ok) throw new Error('the Plex face did not load; the splash would be drawn in the wrong font');
  await page.waitForTimeout(300);
  /* This loop once walked five densities and carried a size for each, then
     threw that size away unused and took the same 1080 screenshot every time: ten
     files, byte for byte the same, and a third of the package. The picture
     does not change with the density, so it is written once, in nodpi, which
     is what nodpi means. */
  const shot = await page.screenshot({ type: 'png' });
  mkdirSync(`${OUT}/drawable-nodpi`, { recursive: true });
  writeFileSync(`${OUT}/drawable-nodpi/${t.name}.png`, shot);
  console.log('drew', t.name);
}
process.exit(0);
