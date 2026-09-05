/* The store announcement: a 4:5 post, a square post and a story, on a
   disciplined grid: one type scale, one measure, one band of sadu, the mark,
   and the official badges as the two stores publish them, unaltered.
   Google's badge is the arabic one their generator gives; Apple's badge is not
   used for an app that is not yet in their store, so that line is words only.
     python3 -m http.server 8840 --directory docs &
     node tools/social/store.mjs OUTDIR */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
import { cushion, colours as C } from './sadu.mjs';
const OUT = process.argv[2] || '/tmp/sunnati-social';
fs.mkdirSync(OUT, { recursive: true });
const P = 'http://localhost:8840/screens/social/';
const mark = fs.readFileSync(new URL('../../docs/icons/icon.svg', import.meta.url), 'utf8');
const logo = (size) => mark.replace(/width='512' height='512'/, `width='${size}' height='${size}'`);

/* the scale: 1.25 between steps, from a 34px base at 1080 wide */
const css = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  :root{--s0:34px;--s1:42px;--s2:53px;--s3:60px;--s4:83px;--s5:104px;--s6:104px;--m:96px}
  html,body{margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl;-webkit-font-smoothing:antialiased}
  .page{position:relative;overflow:hidden;color:${C.CREAM};background:radial-gradient(120% 90% at 50% 0%,#a83030 0%,${C.RED} 45%,${C.DARK} 100%)}
  .band{position:absolute;right:0;left:0;bottom:0;height:110px;background-image:${cushion()};background-size:88px 110px}
  .grid{position:absolute;right:var(--m);left:var(--m);top:var(--m);bottom:0;display:flex;flex-direction:column;align-items:center;text-align:center}
  .mark{filter:drop-shadow(0 22px 34px rgba(0,0,0,.4))}
  .mark svg{border-radius:22%;display:block}
  .name{font-size:var(--s4);font-weight:700;line-height:1;margin-top:28px;letter-spacing:-.01em}
  .eyebrow{font-size:var(--s0);font-weight:600;color:${C.GOLD};letter-spacing:.02em;margin-top:56px}
  h1{font-size:var(--s6);font-weight:700;line-height:1.12;margin:14px 0 0}
  h1 small{display:block;font-size:var(--s3);font-weight:500;opacity:.9;margin-top:18px}
  .lead{font-size:var(--s1);font-weight:400;line-height:1.6;opacity:.9;margin-top:34px;max-width:880px}
  .badges{display:flex;align-items:center;justify-content:center;gap:28px;margin-top:52px}
  .badges img{height:150px;display:block}
  .soon{display:inline-flex;align-items:center;gap:14px;height:104px;padding:0 34px;border-radius:14px;border:2px solid rgba(243,233,210,.55);font-size:var(--s0);font-weight:600;color:${C.CREAM};background:rgba(0,0,0,.22)}
  .soon b{font-family:'IBM Plex Sans Arabic',sans-serif;font-weight:700;direction:ltr;unicode-bidi:isolate;font-size:var(--s1)}
  .url{font-size:var(--s1);font-weight:700;color:${C.GOLD};margin-top:44px}
  .phone{position:absolute;left:50%;transform:translateX(-50%);border-radius:64px;background:#2a1414;padding:14px;box-shadow:0 40px 90px rgba(0,0,0,.5)}
  .phone img{object-fit:cover;object-position:top;border-radius:50px;display:block}
</style>`;

const head = (markSize) => `<div class="mark">${logo(markSize)}</div><div class="name">سُنّتي</div>`;
const announce = `<div class="eyebrow">تطبيق أندرويد</div>
  <h1>الآن في قوقل بلاي<small>وقريباً على أبل ستور</small></h1>
  <div class="lead">المصحف كاملاً، ومواقيت الكويت على تقويم العجيري، وحصن المسلم، والسنن، وأذان يرنّ والتطبيق مغلق</div>
  <div class="badges"><a href="#"><img src="${P}google-play-ar.png" alt="احصل عليه من Google Play"></a><span class="soon">قريباً على <b>App Store</b></span></div>
  <div class="url">sunnati.3li.info</div>`;

const items = [
  { w: 1080, h: 1350, file: 'store-post-4x5', html: `<div class="page" style="width:1080px;height:1350px"><div class="band"></div><div class="grid" style="top:80px">${head(160)}${announce}</div></div>` },
  { w: 1080, h: 1080, file: 'store-post-1x1', html: `<div class="page" style="width:1080px;height:1080px;--m:80px"><div class="band" style="height:90px;background-size:72px 90px"></div><div class="grid" style="--s6:112px;--s3:56px">${head(150)}<div style="height:0"></div>${announce.replace('margin-top:56px', '').replace('<div class="lead">', '<div class="lead" style="display:none">')}</div></div>` },
  { w: 1080, h: 1920, file: 'store-story', html: `<div class="page" style="width:1080px;height:1920px"><div class="band"></div><div class="grid" style="top:140px">${head(200)}${announce}</div>
      <div class="phone" style="top:1440px;width:520px;height:900px"><img src="${P}home.png" style="width:492px;height:872px"></div></div>` },
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const item of items) {
  const p = await (await b.newContext({ viewport: { width: item.w, height: item.h }, deviceScaleFactor: 1 })).newPage();
  await p.route('http://localhost:8840/__store.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">' + css + item.html }));
  await p.goto('http://localhost:8840/__store.html', { waitUntil: 'networkidle' });
  const ready = await p.evaluate(async () => {
    const faces = ["700 60px 'IBM Plex Sans Arabic'", "600 30px 'IBM Plex Sans Arabic'", "500 40px 'IBM Plex Sans Arabic'", "400 30px 'IBM Plex Sans Arabic'"];
    for (const f of faces) { for (let i = 0; i < 3; i++) { try { await document.fonts.load(f, 'سُنّتي'); break; } catch (e) { await new Promise((r) => setTimeout(r, 300)); } } }
    await document.fonts.ready;
    return faces.every((f) => document.fonts.check(f, 'سُنّتي'));
  });
  if (!ready) throw new Error('font not loaded for ' + item.file);
  await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/' + item.file + '.png' });
  console.log('drew', item.file);
  await p.close();
}
await b.close();
