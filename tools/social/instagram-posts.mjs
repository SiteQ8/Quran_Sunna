/* Three portrait posts, 1080 by 1350, drawn from the mark, the sadu weave and
   the app's own screens, in the site's own type. Run with the site served at
   localhost:8840; writes to /tmp/sunnati-social. */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const OUT = process.env.OUT || '/tmp/sunnati-social';
fs.mkdirSync(OUT, { recursive: true });
/* fonts do not load across origins, so the page is one of the site's own */
async function sameOrigin(page, html) {
  await page.goto('http://localhost:8840/privacy.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((h) => { document.open(); document.write(h); document.close(); }, html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })).newPage();
const mark = fs.readFileSync('docs/icons/icon.svg', 'utf8');
const badge = 'data:image/png;base64,' + fs.readFileSync('tools/social/google-play-badge-ar.png').toString('base64');
const weave = (c, o) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'><g fill='${c}' opacity='${o}'><path d='M0 4h60v2H0z'/><path d='M0 54h60v2H0z'/><path d='M30 12 42 24 30 36 18 24z'/><path d='M0 12 6 24 0 36zM60 12 54 24 60 36z'/><path d='M10 44 16 50 4 50zM30 44 36 50 24 50zM50 44 56 50 44 50z'/></g><g fill='none' stroke='${c}' stroke-width='1.6' opacity='${o}'><path d='M0 24h18M42 24h18'/></g></svg>`)}")`;
const base = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;width:1080px;height:1350px;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;width:1080px;height:1350px;overflow:hidden;color:#f4ecdc;background:linear-gradient(160deg,#a83232 0%,#7c1d1d 55%,#5e1414 100%)}
  .page.paper{color:#16241c;background:#f6f1e6}
  .lattice{position:absolute;inset:0;background-size:60px 60px}
  .frame{position:absolute;inset:36px;border:3px solid rgba(244,236,220,.55);border-radius:26px}
  .frame::before{content:'';position:absolute;inset:14px;border:1.5px solid rgba(244,236,220,.3);border-radius:18px}
  .paper .frame{border-color:#9c2b2b}.paper .frame::before{border-color:rgba(156,43,43,.35)}
  .top{position:absolute;top:84px;right:96px;left:96px;text-align:center}
  .brand{font-size:150px;font-weight:700;letter-spacing:-.01em;line-height:1.2;margin:0}
  .brand small{display:block;font-size:42px;font-weight:500;opacity:.94;margin-top:24px;line-height:1.5}
  .kicker{font-size:30px;font-weight:600;color:#e8c46e;letter-spacing:.02em}
  .paper .kicker{color:#9c2b2b}
  .head{font-size:76px;font-weight:700;line-height:1.28;margin:10px 0 0}
  .sub{font-size:36px;line-height:1.7;margin-top:22px;opacity:.92}
  .paper .sub{color:#4a5a51}
  .mark{position:absolute;left:50%;top:400px;transform:translateX(-50%);width:440px;height:440px;filter:drop-shadow(0 30px 60px rgba(0,0,0,.35))}
  .mark svg{width:440px;height:440px}
  .phone{position:absolute;left:50%;bottom:-260px;transform:translateX(-50%);width:470px;height:960px;border-radius:64px;background:#2b1010;padding:14px;box-shadow:0 40px 90px rgba(0,0,0,.35)}
  .paper .phone{background:#2a2626}
  .phone img{width:442px;height:786px;object-fit:cover;object-position:top;border-radius:50px;display:block}
  .phone::after{content:'';position:absolute;top:22px;left:50%;transform:translateX(-50%);width:120px;height:26px;border-radius:14px;background:#2b1010}
  .paper .phone::after{background:#2a2626}
  .stores{position:absolute;right:0;left:0;bottom:0;display:flex;justify-content:center;align-items:center;gap:22px}
  .stores img{height:76px}
  .soon{height:76px;display:inline-flex;align-items:center;gap:12px;padding:0 24px;border-radius:12px;background:#111;color:#fff;font-family:'IBM Plex Sans Arabic',sans-serif;font-size:26px;font-weight:600;border:1px solid #444;direction:rtl}
  .soon small{font-size:18px;font-weight:500;opacity:.8;display:block;line-height:1.1}
  .soon b{display:block;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:26px;font-weight:600;direction:ltr}
  .site{position:absolute;bottom:80px;right:0;left:0;text-align:center;font-size:32px;font-weight:600;color:#e8c46e}
  .paper .site{color:#9c2b2b}
  .chips{position:absolute;right:96px;left:96px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
  .chip{padding:12px 26px;border-radius:999px;border:2px solid rgba(244,236,220,.7);font-size:28px;font-weight:600;color:#f4ecdc;background:rgba(0,0,0,.14)}
</style>`;
const stores = `<div class="stores"><img src="${badge}" alt="متوفر على Google Play"><span class="soon"><span><small>قريباً على</small><b>App Store</b></span></span></div>`;
const posts = [
  { file: '1-launch', html: `
    <div class="page"><div class="lattice" style="background-image:${weave('#f4ecdc', 0.13)}"></div><div class="frame"></div>
      <div class="top"><h1 class="brand">سُنّتي<small>مصحف ومواقيت وأذكار وسنن في جهازك</small></h1></div>
      <div class="mark">${mark}</div>
      <div class="chips" style="bottom:330px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
      <div style="position:absolute;bottom:190px;right:0;left:0;height:76px">${stores}</div>
      <div class="site">sunnati.3li.info</div></div>` },
  { file: '2-times', html: `
    <div class="page"><div class="lattice" style="background-image:${weave('#f4ecdc', 0.13)}"></div><div class="frame"></div>
      <div class="top"><div class="kicker">مواقيت الكويت</div><h2 class="head">على تقويم العجيري<br>يوماً بيوم كما يُطبع</h2>
      <p class="sub">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p></div>
      <div style="position:absolute;top:470px;right:0;left:0;height:76px">${stores}</div>
      <div class="phone"><img src="http://localhost:8840/screens/home.png"></div></div>` },
  { file: '3-quran', html: `
    <div class="page paper"><div class="lattice" style="background-image:${weave('#9c2b2b', 0.16)}"></div><div class="frame"></div>
      <div class="top"><div class="kicker">المصحف كاملاً</div><h2 class="head">صفحة صفحة كالمطبوع<br>وحصن المسلم بأبوابه كلها</h2>
      <p class="sub">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p></div>
      <div style="position:absolute;top:470px;right:0;left:0;height:76px">${stores}</div>
      <div class="phone"><img src="http://localhost:8840/screens/page.png"></div></div>` },
];
for (const post of posts) {
  await sameOrigin(p, base + post.html);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  const loaded = await p.evaluate(() => document.fonts.check("700 40px 'IBM Plex Sans Arabic'") && document.fonts.check("500 40px 'IBM Plex Sans Arabic'"));
  if (!loaded) { console.error('the site type did not load for', post.file); process.exit(1); }
  await p.screenshot({ path: OUT + '/' + post.file + '.png' });
  console.log('drew', post.file, 'in the site type');
}
await b.close();
