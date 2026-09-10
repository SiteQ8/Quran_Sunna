/* The splash artwork, drawn with the app's own fonts and colours in the
   browser, then handed to the package as a picture. Android cannot read the
   woff2 faces the site uses, so the drawing is done here where it can. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

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
    @font-face { font-family: 'Plex'; src: url('http://localhost:8899/fonts/plex-arabic-600-arabic.woff2') format('woff2'); font-weight: 600; }
    @font-face { font-family: 'Amiri'; src: url('http://localhost:8899/fonts/amiri-400-arabic.woff2') format('woff2'); }
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
  await page.waitForTimeout(300);
  const shot = await page.screenshot({ type: 'png' });
  for (const [dir, size] of [['drawable-mdpi', 320], ['drawable-hdpi', 480], ['drawable-xhdpi', 640], ['drawable-xxhdpi', 960], ['drawable-xxxhdpi', 1080]]) {
    mkdirSync(`${OUT}/${dir}`, { recursive: true });
    const small = await page.screenshot({ type: 'png' });
    writeFileSync(`${OUT}/${dir}/${t.name}.png`, small);
    void size;
  }
  void shot;
  console.log('drew', t.name);
}
process.exit(0);
