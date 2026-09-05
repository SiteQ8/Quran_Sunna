/* Draws the launch set for instagram, the stories, and the wide image for x,
   from the app's own fonts, its sadu weave, its logo and its real screens.
   Serve docs/ on 8840 first: python3 -m http.server 8840 --directory docs */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const OUT = process.argv[2] || '/tmp/sunnati-social';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

/* the sadu is photographed, not drawn: a runner, a cloth and cushions in docs/screens/social */
const logo = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512"><defs><linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#8f2323'/><stop offset='1' stop-color='#5a1414'/></linearGradient></defs><rect width='512' height='512' rx='112' fill='url(#bg)'/><path d='M0.0 92 l28.4 28 l28.4 -28z M56.9 92 l28.4 28 l28.4 -28z M113.8 92 l28.4 28 l28.4 -28z M170.7 92 l28.4 28 l28.4 -28z M227.6 92 l28.4 28 l28.4 -28z M284.4 92 l28.4 28 l28.4 -28z M341.3 92 l28.4 28 l28.4 -28z M398.2 92 l28.4 28 l28.4 -28z M455.1 92 l28.4 28 l28.4 -28z' fill='#f3e9d2'/><path d='M0.0 420 l28.4 -28 l28.4 28z M56.9 420 l28.4 -28 l28.4 28z M113.8 420 l28.4 -28 l28.4 28z M170.7 420 l28.4 -28 l28.4 28z M227.6 420 l28.4 -28 l28.4 28z M284.4 420 l28.4 -28 l28.4 28z M341.3 420 l28.4 -28 l28.4 28z M398.2 420 l28.4 -28 l28.4 28z M455.1 420 l28.4 -28 l28.4 28z' fill='#f3e9d2'/><rect x='0' y='124' width='512' height='5' fill='#d9a441'/><rect x='0' y='383' width='512' height='5' fill='#d9a441'/><path d='M256 116 L396 256 L256 396 L116 256z' fill='#f3e9d2'/><path d='M256 144 L368 256 L256 368 L144 256z' fill='#1a1412'/><path d='M256 170 L342 256 L256 342 L170 256z' fill='#f3e9d2'/><path d='M256 196 L316 256 L256 316 L196 256z' fill='#1a1412'/><circle cx='260' cy='256' r='34' fill='#f3e9d2'/><circle cx='274' cy='251' r='30' fill='#1a1412'/><path d='M256 116 L396 256 L256 396 L116 256z' fill='none' stroke='#d9a441' stroke-width='6'/></svg>`;
const P = 'http://localhost:8840/screens/social/';
const css = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;overflow:hidden;color:#f7f5ef;background:#7d2222}
  .photo{position:absolute;inset:0;background-size:cover;background-position:center}
  .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(60,12,12,.45),rgba(60,12,12,.28) 45%,rgba(60,12,12,.55))}
  .runner{position:absolute;top:0;bottom:0;width:150px;background-image:url(${P}runner-strip.jpg);background-size:100% auto;background-repeat:repeat-y}
  .runner.r{right:0}.runner.l{left:0}
  .panel{position:absolute;right:120px;left:120px;padding:44px 40px;text-align:center;background:rgba(92,24,24,.92);border:2px solid rgba(232,196,110,.8);border-radius:28px;box-shadow:0 30px 70px rgba(0,0,0,.45)}
  .panel.paper{background:rgba(247,245,239,.96);color:#16241c;border-color:#9c2b2b}
  .brand{font-size:150px;font-weight:700;line-height:1.05;margin:0}
  .tag{font-size:44px;font-weight:500;margin-top:16px;opacity:.94}
  .kicker{font-size:32px;font-weight:600;color:#e8c46e}
  .paper .kicker{color:#9c2b2b}
  .head{font-weight:700;line-height:1.28;margin:12px 0 0}
  .sub{line-height:1.7;margin-top:22px;opacity:.92}
  .paper .sub{color:#4a5a51}
  .url{font-weight:700;color:#e8c46e}
  .paper .url{color:#9c2b2b}
  .phone{position:absolute;border-radius:64px;background:#2a1414;padding:14px;box-shadow:0 40px 90px rgba(0,0,0,.5)}
  .phone img{object-fit:cover;object-position:top;border-radius:50px;display:block}
  .chips{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
  .chip{padding:12px 26px;border-radius:999px;border:2px solid rgba(232,196,110,.8);font-weight:600;color:#f7f5ef;background:rgba(0,0,0,.25)}
  .paper .chip{border-color:#9c2b2b;color:#16241c;background:rgba(156,43,43,.07)}
  .band{position:absolute;right:0;left:0;height:120px;background-image:url(${P}cushion-band.jpg);background-size:auto 120px;background-repeat:repeat-x;background-position:center}
</style>`;
const weave = () => `<div class="photo" style="background-image:url(${P}weave.jpg)"></div><div class="shade"></div>`;
const cushions = () => `<div class="photo" style="background-image:url(${P}cushions.jpg)"></div><div class="shade" style="background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.25) 50%,rgba(0,0,0,.5))"></div>`;
const runners = () => `<div class="runner r"></div><div class="runner l"></div>`;

const items = [
  /* instagram, 1080 by 1350 */
  { w: 1080, h: 1350, file: '1-launch', html: `<div class="page" style="width:1080px;height:1350px">${weave()}
      <div style="position:absolute;top:150px;left:50%;transform:translateX(-50%)">${logo(330)}</div>
      <div class="panel" style="top:520px;padding:38px 40px"><h1 class="brand" style="font-size:130px">سُنّتي</h1><div class="tag" style="font-size:40px">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="margin-top:30px;font-size:29px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
        <div class="url" style="font-size:38px;margin-top:34px">sunnati.3li.info</div></div></div>` },
  { w: 1080, h: 1350, file: '2-times', html: `<div class="page" style="width:1080px;height:1350px">${runners()}
      <div class="panel" style="top:80px;right:190px;left:190px;padding:36px 30px"><div class="kicker">مواقيت الكويت</div><h2 class="head" style="font-size:70px">على تقويم العجيري<br>يوماً بيوم كما يُطبع</h2><p class="sub" style="font-size:34px">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p><div class="url" style="font-size:34px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;bottom:-210px;transform:translateX(-50%);width:470px;height:960px"><img src="${P}home.png" style="width:442px;height:786px"></div></div>` },
  { w: 1080, h: 1350, file: '3-quran', html: `<div class="page" style="width:1080px;height:1350px">${cushions()}
      <div class="panel paper" style="top:80px;padding:36px 30px"><div class="kicker">المصحف كاملاً</div><h2 class="head" style="font-size:70px">صفحة صفحة كالمطبوع<br>وحصن المسلم كاملاً</h2><p class="sub" style="font-size:34px">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p><div class="url" style="font-size:34px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;bottom:-210px;transform:translateX(-50%);width:470px;height:960px"><img src="${P}page.png" style="width:442px;height:786px"></div></div>` },
  /* stories, 1080 by 1920, the bottom sixth left for the link sticker */
  { w: 1080, h: 1920, file: 'story-1-launch', html: `<div class="page" style="width:1080px;height:1920px">${weave()}
      <div style="position:absolute;top:220px;left:50%;transform:translateX(-50%)">${logo(400)}</div>
      <div class="panel" style="top:700px;padding:40px 40px"><h1 class="brand" style="font-size:140px">سُنّتي</h1><div class="tag" style="font-size:46px">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="margin-top:40px;font-size:34px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
        <div class="url" style="font-size:44px;margin-top:40px">sunnati.3li.info</div></div></div>` },
  { w: 1080, h: 1920, file: 'story-2-times', html: `<div class="page" style="width:1080px;height:1920px">${runners()}
      <div class="panel" style="top:130px;right:190px;left:190px;padding:36px 30px"><div class="kicker">مواقيت الكويت</div><div class="head" style="font-size:74px">على تقويم العجيري<br>يوماً بيوم كما يُطبع</div><p class="sub" style="font-size:36px">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p><div class="url" style="font-size:40px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:720px;transform:translateX(-50%);width:600px;height:1040px"><img src="${P}home.png" style="width:572px;height:1012px"></div></div>` },
  { w: 1080, h: 1920, file: 'story-3-quran', html: `<div class="page" style="width:1080px;height:1920px">${cushions()}
      <div class="panel paper" style="top:130px;padding:36px 30px"><div class="kicker">المصحف كاملاً</div><div class="head" style="font-size:74px">صفحة صفحة كالمطبوع<br>وحصن المسلم كاملاً</div><p class="sub" style="font-size:36px">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p><div class="url" style="font-size:40px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:720px;transform:translateX(-50%);width:600px;height:1040px"><img src="${P}page.png" style="width:572px;height:1012px"></div></div>` },
  /* x, 1200 by 675 */
  { w: 1200, h: 675, file: 'x-launch-1200x675', html: `<div class="page" style="width:1200px;height:675px">${weave()}
      <div class="panel" style="top:60px;bottom:60px;right:80px;left:520px;padding:40px 36px;text-align:right"><div class="brand" style="font-size:100px">سُنّتي</div><div class="tag" style="font-size:34px">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="justify-content:flex-start;margin-top:30px;font-size:24px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">مفتوح المصدر</span></div>
        <div class="url" style="font-size:34px;margin-top:34px">sunnati.3li.info</div></div>
      <div style="position:absolute;left:70px;top:130px">${logo(420)}</div></div>` },
];

for (const item of items) {
  const p = await (await b.newContext({ viewport: { width: item.w, height: item.h }, deviceScaleFactor: 1 })).newPage();
  /* a page written into about:blank is another origin to the fonts, and a
     font will not cross an origin without cors, so the page is served from
     the fonts' own origin instead */
  await p.route('http://localhost:8840/__post.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">' + css + item.html }));
  await p.goto('http://localhost:8840/__post.html', { waitUntil: 'networkidle' });
  /* the app's faces are asked for by name and waited on, so the fallback
     never gets drawn in their place */
  const ready = await p.evaluate(async () => {
    const faces = ["700 60px 'IBM Plex Sans Arabic'", "600 30px 'IBM Plex Sans Arabic'", "500 40px 'IBM Plex Sans Arabic'"];
    const failed = [];
    for (const f of faces) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await document.fonts.load(f, 'سُنّتي'); break; }
        catch (e) { if (attempt === 2) failed.push(f + ': ' + e.message); else await new Promise((r) => setTimeout(r, 300)); }
      }
    }
    await document.fonts.ready;
    return { ok: faces.every((f) => document.fonts.check(f, 'سُنّتي')), failed: failed };
  });
  if (!ready.ok) throw new Error('the app font did not load for ' + item.file + ': ' + ready.failed.join(' | '));
  await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/' + item.file + '.png' });
  console.log('drew', item.file, 'with the app font');
  await p.close();
}
await b.close();
