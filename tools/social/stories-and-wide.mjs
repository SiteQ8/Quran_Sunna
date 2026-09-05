import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const star = (c, o) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='112' height='112' viewBox='0 0 80 80'><g fill='none' stroke='${c}' stroke-width='1' opacity='${o}'><rect x='27' y='27' width='26' height='26'/><rect x='27' y='27' width='26' height='26' transform='rotate(45 40 40)'/><rect x='-13' y='-13' width='26' height='26'/><rect x='-13' y='-13' width='26' height='26' transform='rotate(45 0 0)'/><rect x='67' y='-13' width='26' height='26'/><rect x='67' y='-13' width='26' height='26' transform='rotate(45 80 0)'/><rect x='-13' y='67' width='26' height='26'/><rect x='-13' y='67' width='26' height='26' transform='rotate(45 0 80)'/><rect x='67' y='67' width='26' height='26'/><rect x='67' y='67' width='26' height='26' transform='rotate(45 80 80)'/></g></svg>`)}")`;
const logo = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#268556"/><stop offset="1" stop-color="#11452c"/></linearGradient></defs><rect x="46" y="46" width="420" height="420" rx="96" fill="url(#g)" stroke="rgba(232,196,110,.5)" stroke-width="3"/><g transform="translate(256 256)" fill="none" stroke="#e8c46e" stroke-width="11" stroke-linejoin="round"><rect x="-118" y="-118" width="236" height="236" rx="18"/><rect x="-118" y="-118" width="236" height="236" rx="18" transform="rotate(45)"/></g><path transform="translate(256 256)" d="M30 -88a92 92 0 1 0 0 176 104 104 0 0 1 0-176Z" fill="#f7f5ef"/></svg>`;
const css = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;overflow:hidden;color:#f7f5ef;background:linear-gradient(160deg,#1e6f47 0%,#155238 55%,#0f3c29 100%)}
  .page.paper{color:#16241c;background:#f7f5ef}
  .lattice{position:absolute;inset:0;background-size:112px 112px}
  .frame{position:absolute;inset:40px;border:3px solid rgba(232,196,110,.75);border-radius:30px}
  .paper .frame{border-color:#b08833}
  .kicker{font-size:34px;font-weight:600;color:#e8c46e}
  .paper .kicker{color:#7d6124}
  .head{font-weight:700;line-height:1.28;margin:12px 0 0}
  .sub{line-height:1.7;margin-top:24px;opacity:.9}
  .paper .sub{color:#4a5a51}
  .url{font-weight:700;color:#e8c46e}
  .paper .url{color:#1e6f47}
  .phone{position:absolute;border-radius:64px;background:#0d1f17;padding:14px;box-shadow:0 40px 90px rgba(0,0,0,.35)}
  .paper .phone{background:#2a2f2c}
  .phone img{object-fit:cover;object-position:top;border-radius:50px;display:block}
  .chips{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
  .chip{padding:12px 26px;border-radius:999px;border:2px solid rgba(232,196,110,.7);font-weight:600;color:#f7f5ef;background:rgba(0,0,0,.15)}
  .paper .chip{border-color:#b08833;color:#16241c;background:rgba(176,136,51,.08)}
</style>`;
/* stories, 1080 by 1920, with the bottom sixth left clear for the link sticker */
const stories = [
  { file: 'story-1-launch', html: `<div class="page" style="width:1080px;height:1920px"><div class="lattice" style="background-image:${star('#ffffff', .10)}"></div><div class="frame"></div>
      <div style="position:absolute;top:150px;right:100px;left:100px;text-align:center"><div style="font-size:150px;font-weight:700;line-height:1.1">سُنّتي</div><div style="font-size:48px;font-weight:500;margin-top:14px">مصحف ومواقيت وأذكار وسنن في جهازك</div></div>
      <div style="position:absolute;top:560px;left:50%;transform:translateX(-50%)">${logo(560)}</div>
      <div class="chips" style="position:absolute;top:1220px;right:100px;left:100px;font-size:34px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
      <div style="position:absolute;top:1440px;right:0;left:0;text-align:center;font-size:44px" class="url">sunnati.3li.info</div></div>` },
  { file: 'story-2-times', html: `<div class="page" style="width:1080px;height:1920px"><div class="lattice" style="background-image:${star('#ffffff', .10)}"></div><div class="frame"></div>
      <div style="position:absolute;top:130px;right:100px;left:100px;text-align:center"><div class="kicker">مواقيت الكويت</div><div class="head" style="font-size:84px">على تقويم العجيري<br>يوماً بيوم كما يُطبع</div><p class="sub" style="font-size:40px">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p><div class="url" style="font-size:42px;margin-top:20px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:700px;transform:translateX(-50%);width:600px;height:1040px"><img src="http://localhost:8840/screens/home.png" style="width:572px;height:1012px"></div></div>` },
  { file: 'story-3-quran', html: `<div class="page paper" style="width:1080px;height:1920px"><div class="lattice" style="background-image:${star('#1e6f47', .16)}"></div><div class="frame"></div>
      <div style="position:absolute;top:130px;right:100px;left:100px;text-align:center"><div class="kicker">المصحف كاملاً</div><div class="head" style="font-size:84px">صفحة صفحة كالمطبوع<br>وحصن المسلم كاملاً</div><p class="sub" style="font-size:40px">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p><div class="url" style="font-size:42px;margin-top:20px">sunnati.3li.info</div></div>
      <div class="phone" style="left:50%;top:700px;transform:translateX(-50%);width:600px;height:1040px"><img src="http://localhost:8840/screens/page.png" style="width:572px;height:1012px"></div></div>` },
];
/* x and whatsapp, 1200 by 675 */
const wide = [
  { file: 'x-launch-1200x675', html: `<div class="page" style="width:1200px;height:675px"><div class="lattice" style="background-image:${star('#ffffff', .10)}"></div><div class="frame" style="inset:26px;border-radius:22px"></div>
      <div style="position:absolute;top:70px;right:80px;width:640px;text-align:right"><div style="font-size:110px;font-weight:700;line-height:1.05">سُنّتي</div><div style="font-size:38px;font-weight:500;margin-top:12px">مصحف ومواقيت وأذكار وسنن في جهازك</div>
        <div class="chips" style="justify-content:flex-start;margin-top:40px;font-size:26px"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">مفتوح المصدر</span></div>
        <div class="url" style="font-size:36px;margin-top:44px">sunnati.3li.info</div></div>
      <div style="position:absolute;left:90px;top:120px">${logo(430)}</div></div>` },
];
for (const set of [[stories, 1080, 1920], [wide, 1200, 675]]) {
  const p = await (await b.newContext({ viewport: { width: set[1], height: set[2] }, deviceScaleFactor: 1 })).newPage();
  for (const item of set[0]) {
    await p.setContent(css + item.html, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    await p.screenshot({ path: '/tmp/sunnati-social/' + item.file + '.png' });
    console.log('drew', item.file);
  }
  await p.close();
}
await b.close();
