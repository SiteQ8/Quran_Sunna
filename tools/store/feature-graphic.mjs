/* The feature graphic for the store, 1024 by 500, drawn from the mark and the
   sadu weave. Run with the site served at localhost:8840. */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
/* fonts do not load across origins, so the page is one of the site's own */
async function sameOrigin(page, html) {
  await page.goto('http://localhost:8840/privacy.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((h) => { document.open(); document.write(h); document.close(); }, html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 })).newPage();
const mark = fs.readFileSync('docs/icons/icon.svg', 'utf8');
import { cushion } from '../social/sadu.mjs';
await sameOrigin(p, `<link rel="stylesheet" href="http://localhost:8840/css/fonts.css"><style>
  html,body{margin:0;width:1024px;height:500px;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .g{position:relative;width:1024px;height:500px;overflow:hidden;background:linear-gradient(135deg,#a83232,#7c1d1d 70%,#5e1414)}
  .w{position:absolute;right:0;left:0;height:78px;background-image:${cushion()};background-size:62px 78px}
  .w.top{top:0}.w.bottom{bottom:0}
  .mark{position:absolute;left:96px;top:112px;width:276px;height:276px;filter:drop-shadow(0 18px 40px rgba(0,0,0,.35))}
  .mark svg{width:276px;height:276px}
  .t{position:absolute;right:96px;top:112px;width:560px;color:#f4ecdc;text-align:right}
  h1{margin:0;font-size:118px;font-weight:700;line-height:1;letter-spacing:-.01em}
  p{margin:18px 0 0;font-size:29px;font-weight:500;color:#f4ecdc;opacity:.95;white-space:nowrap}
  .line{margin-top:30px;font-size:24px;font-weight:600;color:#e8c46e;line-height:1.6}
</style><div class="g"><div class="w top"></div><div class="w bottom"></div><div class="mark">${mark}</div>
<div class="t"><h1>سُنّتي</h1><p>مصحف ومواقيت وأذكار وسنن في جهازك</p><div class="line">المصحف · العجيري · حصن المسلم · السنن · بلا إنترنت</div></div></div>`);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
await p.screenshot({ path: 'play/feature-graphic-1024x500.png' });
console.log('feature graphic written');
await b.close();
