/* The launch set: three instagram posts, three stories and the wide image for x,
   built from the mark, the app's fonts, its real screens, and sadu bands drawn
   in tools/social/sadu.mjs. Serve docs/ on 8840 first:
     python3 -m http.server 8840 --directory docs &
     node tools/social/draw.mjs OUTDIR */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
import { runner, cushion, tree, colours as C } from './sadu.mjs';
const OUT = process.argv[2] || '/tmp/sunnati-social';
fs.mkdirSync(OUT, { recursive: true });
const P = 'http://localhost:8840/screens/social/';
const mark = fs.readFileSync(new URL('../../docs/icons/icon.svg', import.meta.url), 'utf8');
const logo = (size) => mark.replace(/width='512' height='512'/, `width='${size}' height='${size}'`);

const css = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;overflow:hidden;color:${C.CREAM};background:linear-gradient(180deg,${C.RED},${C.DARK})}
  .page.paper{color:#16241c;background:#f7f5ef}
  .runner{position:absolute;top:0;bottom:0;width:168px;background-image:${runner()};background-size:168px 120px}
  .runner.r{right:0}.runner.l{left:0}
  .band{position:absolute;right:0;left:0;height:120px;background-image:${cushion()};background-size:96px 120px}
  .band.top{top:0}.band.bottom{bottom:0}
  .tree{position:absolute;top:0;bottom:0;width:120px;background-image:${tree()};background-size:120px 200px}
  .tree.r{right:0}.tree.l{left:0}
  .mark{position:absolute;left:50%;transform:translateX(-50%);filter:drop-shadow(0 26px 40px rgba(0,0,0,.35))}
  .mark svg{border-radius:22%}
  .brand{font-size:150px;font-weight:700;line-height:1.05;margin:0}
  .tag{font-size:44px;font-weight:500;margin-top:14px;opacity:.94}
  .kicker{font-size:32px;font-weight:600;color:${C.GOLD}}
  .paper .kicker{color:${C.RED}}
  .head{font-weight:700;line-height:1.28;margin:12px 0 0}
  .sub{line-height:1.7;margin-top:22px;opacity:.92}
  .paper .sub{color:#4a5a51}
  .url{font-weight:700;color:${C.GOLD}}
  .paper .url{color:${C.RED}}
  .text{position:absolute;text-align:center}
  .phone{position:absolute;border-radius:64px;background:#2a1414;padding:14px;box-shadow:0 40px 90px rgba(0,0,0,.45)}
  .phone img{object-fit:cover;object-position:top;border-radius:50px;display:block}
  .chips{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
  .chip{padding:12px 26px;border-radius:999px;border:2px solid ${C.GOLD};font-weight:600;color:${C.CREAM};background:rgba(0,0,0,.2)}
  .paper .chip{border-color:${C.RED};color:#16241c;background:rgba(156,43,43,.07)}
</style>`;

const items = [
  /* instagram, 1080 by 1350 */
  { w: 1080, h: 1350, file: '1-launch', html: `<div class="page" style="width:1080px;height:1350px"><div class="band top"></div><div class="band bottom"></div>
      <div class="mark" style="top:190px">${logo(360)}</div>
      <div class="text" style="top:600px;right:96px;left:96px"><h1 class="brand">سُنّتي</h1><div class="tag">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="margin-top:44px;font-size:30px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
        <div class="url" style="font-size:38px;margin-top:44px">sunnati.3li.info</div></div></div>` },
  { w: 1080, h: 1350, file: '2-times', html: `<div class="page" style="width:1080px;height:1350px"><div class="runner r"></div><div class="runner l"></div>
      <div class="text" style="top:90px;right:210px;left:210px"><div class="kicker">مواقيت الكويت</div><h2 class="head" style="font-size:70px">على تقويم العجيري<br>يوماً بيوم كما يُطبع</h2><p class="sub" style="font-size:34px">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p><div class="url" style="font-size:34px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;bottom:-210px;transform:translateX(-50%);width:470px;height:960px"><img src="${P}home.png" style="width:442px;height:786px"></div></div>` },
  { w: 1080, h: 1350, file: '3-quran', html: `<div class="page paper" style="width:1080px;height:1350px"><div class="tree r"></div><div class="tree l"></div>
      <div class="text" style="top:90px;right:170px;left:170px"><div class="kicker">المصحف كاملاً</div><h2 class="head" style="font-size:70px">صفحة صفحة كالمطبوع<br>وحصن المسلم كاملاً</h2><p class="sub" style="font-size:34px">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p><div class="url" style="font-size:34px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;bottom:-210px;transform:translateX(-50%);width:470px;height:960px"><img src="${P}page.png" style="width:442px;height:786px"></div></div>` },
  /* stories, 1080 by 1920, the bottom sixth left for the link sticker */
  { w: 1080, h: 1920, file: 'story-1-launch', html: `<div class="page" style="width:1080px;height:1920px"><div class="band top"></div><div class="band bottom"></div>
      <div class="mark" style="top:280px">${logo(440)}</div>
      <div class="text" style="top:790px;right:100px;left:100px"><h1 class="brand">سُنّتي</h1><div class="tag" style="font-size:48px">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="margin-top:50px;font-size:34px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
        <div class="url" style="font-size:44px;margin-top:50px">sunnati.3li.info</div></div></div>` },
  { w: 1080, h: 1920, file: 'story-2-times', html: `<div class="page" style="width:1080px;height:1920px"><div class="runner r"></div><div class="runner l"></div>
      <div class="text" style="top:150px;right:210px;left:210px"><div class="kicker">مواقيت الكويت</div><div class="head" style="font-size:72px">على تقويم العجيري<br>يوماً بيوم كما يُطبع</div><p class="sub" style="font-size:36px">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p><div class="url" style="font-size:40px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:720px;transform:translateX(-50%);width:600px;height:1040px"><img src="${P}home.png" style="width:572px;height:1012px"></div></div>` },
  { w: 1080, h: 1920, file: 'story-3-quran', html: `<div class="page paper" style="width:1080px;height:1920px"><div class="tree r"></div><div class="tree l"></div>
      <div class="text" style="top:150px;right:170px;left:170px"><div class="kicker">المصحف كاملاً</div><div class="head" style="font-size:72px">صفحة صفحة كالمطبوع<br>وحصن المسلم كاملاً</div><p class="sub" style="font-size:36px">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p><div class="url" style="font-size:40px;margin-top:18px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:720px;transform:translateX(-50%);width:600px;height:1040px"><img src="${P}page.png" style="width:572px;height:1012px"></div></div>` },
  /* x, 1200 by 675 */
  { w: 1200, h: 675, file: 'x-launch-1200x675', html: `<div class="page" style="width:1200px;height:675px"><div class="band top" style="height:90px;background-size:72px 90px"></div><div class="band bottom" style="height:90px;background-size:72px 90px"></div>
      <div class="text" style="top:150px;right:80px;width:600px;text-align:right"><div class="brand" style="font-size:110px">سُنّتي</div><div class="tag" style="font-size:36px">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="justify-content:flex-start;margin-top:30px;font-size:24px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">مفتوح المصدر</span></div>
        <div class="url" style="font-size:34px;margin-top:30px">sunnati.3li.info</div></div>
      <div class="mark" style="left:70px;top:150px;transform:none">${logo(380)}</div></div>` },
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const item of items) {
  const p = await (await b.newContext({ viewport: { width: item.w, height: item.h }, deviceScaleFactor: 1 })).newPage();
  /* served from the fonts' own origin, or a font will not cross to it */
  await p.route('http://localhost:8840/__post.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">' + css + item.html }));
  await p.goto('http://localhost:8840/__post.html', { waitUntil: 'networkidle' });
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
    return { ok: faces.every((f) => document.fonts.check(f, 'سُنّتي')), failed };
  });
  if (!ready.ok) throw new Error('the app font did not load for ' + item.file + ': ' + ready.failed.join(' | '));
  await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/' + item.file + '.png' });
  console.log('drew', item.file);
  await p.close();
}
await b.close();
