import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })).newPage();
const star = (c, o) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='112' height='112' viewBox='0 0 80 80'><g fill='none' stroke='${c}' stroke-width='1' opacity='${o}'><rect x='27' y='27' width='26' height='26'/><rect x='27' y='27' width='26' height='26' transform='rotate(45 40 40)'/><rect x='-13' y='-13' width='26' height='26'/><rect x='-13' y='-13' width='26' height='26' transform='rotate(45 0 0)'/><rect x='67' y='-13' width='26' height='26'/><rect x='67' y='-13' width='26' height='26' transform='rotate(45 80 0)'/><rect x='-13' y='67' width='26' height='26'/><rect x='-13' y='67' width='26' height='26' transform='rotate(45 0 80)'/><rect x='67' y='67' width='26' height='26'/><rect x='67' y='67' width='26' height='26' transform='rotate(45 80 80)'/></g></svg>`)}")`;
const base = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;width:1080px;height:1350px;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;width:1080px;height:1350px;overflow:hidden;color:#f7f5ef;background:linear-gradient(160deg,#1e6f47 0%,#155238 55%,#0f3c29 100%)}
  .page.paper{color:#16241c;background:#f7f5ef}
  .lattice{position:absolute;inset:0;background-size:112px 112px}
  .frame{position:absolute;inset:36px;border:3px solid rgba(232,196,110,.75);border-radius:26px}
  .frame::before{content:'';position:absolute;inset:14px;border:1.5px solid rgba(232,196,110,.45);border-radius:18px}
  .top{position:absolute;top:84px;right:96px;left:96px;text-align:center}
  .brand{font-size:130px;font-weight:700;letter-spacing:-.01em;line-height:1.1;margin:0}
  .brand small{display:block;font-size:44px;font-weight:500;opacity:.92;margin-top:10px}
  .line{font-size:36px;font-weight:600;color:#e8c46e;margin-top:26px}
  .kicker{font-size:30px;font-weight:600;color:#e8c46e;letter-spacing:.02em}
  .head{font-size:78px;font-weight:700;line-height:1.28;margin:10px 0 0}
  .sub{font-size:38px;line-height:1.7;margin-top:22px;opacity:.9}
  .paper .sub{color:#4a5a51}
  .paper .kicker,.paper .line{color:#7d6124}
  .paper .frame{border-color:#b08833}
  .paper .frame::before{border-color:rgba(176,136,51,.5)}
  .foot{position:absolute;bottom:80px;right:0;left:0;text-align:center;font-size:34px;font-weight:600;color:#e8c46e}
  .paper .foot{color:#1e6f47}
  .foot span{opacity:.75;font-weight:500;margin:0 18px}
  .foot.up{bottom:auto;top:512px}
  .logo{position:absolute;left:50%;top:50%;transform:translate(-50%,-52%)}
  .phone{position:absolute;left:50%;bottom:-210px;transform:translateX(-50%);width:470px;height:960px;border-radius:64px;background:#0d1f17;padding:14px;box-shadow:0 40px 90px rgba(0,0,0,.35)}
  .paper .phone{background:#2a2f2c}
  .phone img{width:442px;height:786px;object-fit:cover;object-position:top;border-radius:50px;display:block}
  .phone::after{content:'';position:absolute;top:22px;left:50%;transform:translateX(-50%);width:120px;height:26px;border-radius:14px;background:#0d1f17}
  .chips{position:absolute;bottom:170px;right:96px;left:96px;display:flex;justify-content:center;gap:18px;flex-wrap:wrap}
  .chip{padding:14px 28px;border-radius:999px;border:2px solid rgba(232,196,110,.7);font-size:30px;font-weight:600;color:#f7f5ef;background:rgba(0,0,0,.15)}
  .paper .chip{border-color:#b08833;color:#16241c;background:rgba(176,136,51,.08)}
</style>`;
const logo = `<svg width="520" height="520" viewBox="0 0 512 512" class="logo"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#268556"/><stop offset="1" stop-color="#11452c"/></linearGradient></defs><rect x="46" y="46" width="420" height="420" rx="96" fill="url(#g)" stroke="rgba(232,196,110,.5)" stroke-width="3"/><g transform="translate(256 256)" fill="none" stroke="#e8c46e" stroke-width="11" stroke-linejoin="round"><rect x="-118" y="-118" width="236" height="236" rx="18"/><rect x="-118" y="-118" width="236" height="236" rx="18" transform="rotate(45)"/></g><path transform="translate(256 256)" d="M30 -88a92 92 0 1 0 0 176 104 104 0 0 1 0-176Z" fill="#f7f5ef"/></svg>`;
const posts = [
  { file: '1-launch', dark: true, html: `
    <div class="page"><div class="lattice" style="background-image:${star('#ffffff', 0.10)}"></div><div class="frame"></div>
      <div class="top"><h1 class="brand">سُنّتي<small>مصحف ومواقيت وأذكار وسنن في جهازك</small></h1></div>
      ${logo}
      <div class="chips"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span><span class="chip">مجاني ومفتوح المصدر</span></div>
      <div class="foot">sunnati.3li.info</div></div>` },
  { file: '2-times', dark: true, html: `
    <div class="page"><div class="lattice" style="background-image:${star('#ffffff', 0.10)}"></div><div class="frame"></div>
      <div class="top"><div class="kicker">مواقيت الكويت</div><h2 class="head">على تقويم العجيري<br>يوماً بيوم كما يُطبع</h2>
      <p class="sub">ساعة تعدّ ما بقي على الأذان، وتنبيه يرنّ في دقيقته والتطبيق مغلق</p></div>
      <div class="foot up">sunnati.3li.info</div>
      <div class="phone"><img src="http://localhost:8840/screens/home.png"></div></div>` },
  { file: '3-quran', dark: false, html: `
    <div class="page paper"><div class="lattice" style="background-image:${star('#1e6f47', 0.16)}"></div><div class="frame"></div>
      <div class="top"><div class="kicker">المصحف كاملاً</div><h2 class="head">صفحة صفحة كالمطبوع<br>وحصن المسلم بأبوابه كلها</h2>
      <p class="sub">تلاوة تمشي مع النص، والتفسير الميسر، وكلاهما يعمل بلا إنترنت</p></div>
      <div class="foot up">sunnati.3li.info</div>
      <div class="phone"><img src="http://localhost:8840/screens/page.png"></div></div>` },
];
for (const post of posts) {
  await p.setContent(base + post.html, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/tmp/sunnati-social/' + post.file + '.png' });
  console.log('drew', post.file);
}
await b.close();
