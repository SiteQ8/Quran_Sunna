import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const sizes = fs.readdirSync('docs/splash').map(f => /splash-(\d+)x(\d+)\.png/.exec(f)).filter(Boolean).map(m => [+m[1], +m[2]]);
const svg = fs.readFileSync('docs/icons/icon.svg', 'utf8');
/* fonts do not load across origins, so the page is one of the site's own */
async function sameOrigin(page, html) {
  await page.goto('http://localhost:8840/privacy.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((h) => { document.open(); document.write(h); document.close(); }, html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const [w, h] of sizes) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  const mark = Math.round(Math.min(w, h) * 0.34);
  await sameOrigin(p, `<link rel="stylesheet" href="http://localhost:8840/css/fonts.css"><style>
    html,body{margin:0;width:${w}px;height:${h}px;background:#f6f4ee;font-family:'IBM Plex Sans Arabic',sans-serif}
    .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(mark*0.18)}px}
    svg{width:${mark}px;height:${mark}px;filter:drop-shadow(0 ${Math.round(mark*0.06)}px ${Math.round(mark*0.12)}px rgba(124,29,29,.25))}
    h1{margin:0;font-size:${Math.round(mark*0.34)}px;font-weight:700;color:#7c1d1d;direction:rtl}
    p{margin:0;font-size:${Math.round(mark*0.13)}px;color:#5e6c65;direction:rtl}
  </style><div class="c">${svg}<h1>سُنّتي</h1><p>مصحف ومواقيت وأذكار وسنن في جهازك</p></div>`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `docs/splash/splash-${w}x${h}.png` });
  await p.close();
}
console.log('splash redrawn:', sizes.length);
await b.close();
