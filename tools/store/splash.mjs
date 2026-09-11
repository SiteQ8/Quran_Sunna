/* The opening artwork, drawn with the app's own fonts and colours in the
   browser, then handed to the package as a picture. Android cannot read the
   woff2 faces the site uses, so the drawing is done here where it can. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

/* Everything the page needs is carried inside it rather than fetched: a page
   made with setContent has no origin, so the browser refused the cross-origin
   font and drew the name in the system face. That was fixed for the font and
   not for the mark beside it, which kept pointing at http://localhost and kept
   failing, so every opening screen shipped for months with a broken-image box
   where the mark should be. One lesson, two places. */
const asData = (f, mime) => `data:${mime};base64,` + readFileSync(f).toString('base64');
const plex = asData('docs/fonts/plex-arabic-600-arabic.woff2', 'font/woff2');
const mark = asData('docs/icons/icon.svg', 'image/svg+xml');

const OUT = 'android/app/src/main/res';
const themes = [
  { name: 'splash_art', paper: '#f6f4ee', word: '#16241c', gold: '#b08833' },
  { name: 'splash_art_night', paper: '#10161a', word: '#ede9e1', gold: '#bb9036' }
];

const page = await (await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
})).newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });

for (const t of themes) {
  await page.setContent(`<!doctype html><meta charset=utf-8>
  <style>
    @font-face { font-family: 'Plex'; src: url('${plex}') format('woff2'); font-weight: 600; }
    html, body { margin: 0; height: 100%; background: ${t.paper}; }
    .wrap { height: 100%; display: grid; place-items: center; align-content: center; gap: 54px; }
    .mark { width: 470px; height: 470px; border-radius: 108px; display: block; }
    .rule { width: 132px; height: 3px; background: ${t.gold}; border-radius: 2px; }
    .name { font-family: 'Plex', sans-serif; font-weight: 600; font-size: 124px;
      color: ${t.word}; line-height: 1; letter-spacing: -.01em; }
  </style>
  <div class="wrap">
    <img class="mark" id="m" src="${mark}" alt="">
    <div class="rule"></div>
    <div class="name">سُنّتي</div>
  </div>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const ok = await page.evaluate(() => document.fonts.check("600 124px Plex"));
  if (!ok) throw new Error('the Plex face did not load; the splash would be drawn in the wrong font');
  /* and the same question asked of the mark, which is the one that went wrong */
  const drew = await page.evaluate(() => {
    const m = document.getElementById('m');
    return !!m && m.complete && m.naturalWidth > 0;
  });
  if (!drew) throw new Error('the mark did not load; the splash would ship a broken image box');

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
