/* Draws the launch set for instagram, the stories, and the wide image for x,
   from the app's own fonts, its sadu weave, its logo and its real screens.
   Serve docs/ on 8840 first: python3 -m http.server 8840 --directory docs */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const OUT = process.argv[2] || '/tmp/sunnati-social';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

/* the sadu weave, exactly as the app draws it, in the colour asked for */
const sadu = (c, o) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'><g fill='${c}' opacity='${o}'><path d='M0 4h60v2H0z'/><path d='M0 54h60v2H0z'/><path d='M30 12 42 24 30 36 18 24z'/><path d='M0 12 6 24 0 36zM60 12 54 24 60 36z'/><path d='M10 44 16 50 4 50zM30 44 36 50 24 50zM50 44 56 50 44 50z'/></g><g fill='none' stroke='${c}' stroke-width='1.6' opacity='${o}'><path d='M0 24h18M42 24h18'/></g></svg>`)}")`;
const logo = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b23a3a"/><stop offset="1" stop-color="#6e1d1d"/></linearGradient></defs><rect x="46" y="46" width="420" height="420" rx="96" fill="url(#g)" stroke="rgba(232,196,110,.55)" stroke-width="3"/><g transform="translate(256 256)" fill="none" stroke="#e8c46e" stroke-width="11" stroke-linejoin="round"><rect x="-118" y="-118" width="236" height="236" rx="18"/><rect x="-118" y="-118" width="236" height="236" rx="18" transform="rotate(45)"/></g><path transform="translate(256 256)" d="M30 -88a92 92 0 1 0 0 176 104 104 0 0 1 0-176Z" fill="#f7f5ef"/></svg>`;
const css = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;overflow:hidden;color:#f7f5ef;background:linear-gradient(160deg,#9c2b2b 0%,#7d2222 55%,#5c1818 100%)}
  .page.paper{color:#16241c;background:#f7f5ef}
  .weave{position:absolute;inset:0;background-size:60px 60px}
  .frame{position:absolute;inset:36px;border:3px solid rgba(232,196,110,.8);border-radius:26px}
  .frame::before{content:'';position:absolute;inset:14px;border:1.5px solid rgba(232,196,110,.45);border-radius:18px}
  .paper .frame{border-color:#9c2b2b}
  .paper .frame::before{border-color:rgba(156,43,43,.35)}
  .brand{font-size:150px;font-weight:700;line-height:1.05;margin:0}
  .tag{font-size:44px;font-weight:500;margin-top:16px;opacity:.94}
  .kicker{font-size:32px;font-weight:600;color:#e8c46e}
  .paper .kicker{color:#9c2b2b}
  .head{font-weight:700;line-height:1.28;margin:12px 0 0}
  .sub{line-height:1.7;margin-top:22px;opacity:.92}
  .paper .sub{color:#4a5a51}
  .url{font-weight:700;color:#e8c46e}
  .paper .url{color:#9c2b2b}
  .phone{position:absolute;border-radius:64px;background:#2a1414;padding:14px;box-shadow:0 40px 90px rgba(0,0,0,.4)}
  .paper .phone{background:#2a2f2c}
  .phone img{object-fit:cover;object-position:top;border-radius:50px;display:block}
  .chips{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
  .chip{padding:12px 26px;border-radius:999px;border:2px solid rgba(232,196,110,.75);font-weight:600;color:#f7f5ef;background:rgba(0,0,0,.18)}
  .paper .chip{border-color:#9c2b2b;color:#16241c;background:rgba(156,43,43,.07)}
</style>`;
const dark = () => `<div class="weave" style="background-image:${sadu('#ffffff', .13)}"></div>`;
const light = () => `<div class="weave" style="background-image:${sadu('#9c2b2b', .16)}"></div>`;

const items = [
  /* instagram, 1080 by 1350 */
  { w: 1080, h: 1350, file: '1-launch', html: `<div class="page" style="width:1080px;height:1350px">${dark()}<div class="frame"></div>
      <div style="position:absolute;top:84px;right:96px;left:96px;text-align:center"><h1 class="brand">سُنّتي</h1><div class="tag">مصحف ومواقيت وأذكار وسنن في جهازك</div></div>
      <div style="position:absolute;top:400px;left:50%;transform:translateX(-50%)">${logo(500)}</div>
      <div class="chips" style="position:absolute;top:960px;right:96px;left:96px;font-size:30px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
      <div class="url" style="position:absolute;bottom:84px;right:0;left:0;text-align:center;font-size:36px">sunnati.3li.info</div></div>` },
  { w: 1080, h: 1350, file: '2-times', html: `<div class="page" style="width:1080px;height:1350px">${dark()}<div class="frame"></div>
      <div style="position:absolute;top:84px;right:96px;left:96px;text-align:center"><div class="kicker">مواقيت الكويت</div><h2 class="head" style="font-size:78px">على تقويم العجيري<br>يوماً بيوم كما يُطبع</h2><p class="sub" style="font-size:38px">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p><div class="url" style="font-size:36px;margin-top:22px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;bottom:-210px;transform:translateX(-50%);width:470px;height:960px"><img src="http://localhost:8840/screens/social/home.png" style="width:442px;height:786px"></div></div>` },
  { w: 1080, h: 1350, file: '3-quran', html: `<div class="page paper" style="width:1080px;height:1350px">${light()}<div class="frame"></div>
      <div style="position:absolute;top:84px;right:96px;left:96px;text-align:center"><div class="kicker">المصحف كاملاً</div><h2 class="head" style="font-size:78px">صفحة صفحة كالمطبوع<br>وحصن المسلم كاملاً</h2><p class="sub" style="font-size:38px">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p><div class="url" style="font-size:36px;margin-top:22px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;bottom:-210px;transform:translateX(-50%);width:470px;height:960px"><img src="http://localhost:8840/screens/social/page.png" style="width:442px;height:786px"></div></div>` },
  /* stories, 1080 by 1920, the bottom sixth left for the link sticker */
  { w: 1080, h: 1920, file: 'story-1-launch', html: `<div class="page" style="width:1080px;height:1920px">${dark()}<div class="frame"></div>
      <div style="position:absolute;top:150px;right:100px;left:100px;text-align:center"><h1 class="brand">سُنّتي</h1><div class="tag" style="font-size:48px">مصحف ومواقيت وأذكار وسنن في جهازك</div></div>
      <div style="position:absolute;top:560px;left:50%;transform:translateX(-50%)">${logo(560)}</div>
      <div class="chips" style="position:absolute;top:1220px;right:100px;left:100px;font-size:34px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
      <div class="url" style="position:absolute;top:1440px;right:0;left:0;text-align:center;font-size:44px">sunnati.3li.info</div></div>` },
  { w: 1080, h: 1920, file: 'story-2-times', html: `<div class="page" style="width:1080px;height:1920px">${dark()}<div class="frame"></div>
      <div style="position:absolute;top:130px;right:100px;left:100px;text-align:center"><div class="kicker">مواقيت الكويت</div><div class="head" style="font-size:84px">على تقويم العجيري<br>يوماً بيوم كما يُطبع</div><p class="sub" style="font-size:40px">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p><div class="url" style="font-size:42px;margin-top:20px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:700px;transform:translateX(-50%);width:600px;height:1040px"><img src="http://localhost:8840/screens/social/home.png" style="width:572px;height:1012px"></div></div>` },
  { w: 1080, h: 1920, file: 'story-3-quran', html: `<div class="page paper" style="width:1080px;height:1920px">${light()}<div class="frame"></div>
      <div style="position:absolute;top:130px;right:100px;left:100px;text-align:center"><div class="kicker">المصحف كاملاً</div><div class="head" style="font-size:84px">صفحة صفحة كالمطبوع<br>وحصن المسلم كاملاً</div><p class="sub" style="font-size:40px">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p><div class="url" style="font-size:42px;margin-top:20px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:700px;transform:translateX(-50%);width:600px;height:1040px"><img src="http://localhost:8840/screens/social/page.png" style="width:572px;height:1012px"></div></div>` },
  /* x, 1200 by 675 */
  { w: 1200, h: 675, file: 'x-launch-1200x675', html: `<div class="page" style="width:1200px;height:675px">${dark()}<div class="frame" style="inset:26px;border-radius:22px"></div>
      <div style="position:absolute;top:70px;right:80px;width:640px;text-align:right"><div class="brand" style="font-size:110px">سُنّتي</div><div class="tag" style="font-size:38px">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="justify-content:flex-start;margin-top:40px;font-size:26px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">مفتوح المصدر</span></div>
        <div class="url" style="font-size:36px;margin-top:44px">sunnati.3li.info</div></div>
      <div style="position:absolute;left:90px;top:120px">${logo(430)}</div></div>` },
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
