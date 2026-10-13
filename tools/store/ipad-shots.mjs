/* The App Store's iPad screenshots, in the look the app has on an iPad held on
   its side: the book, with the hour on one half and the app on the other, the
   mushaf as two pages facing, and the sky of the time across the screen. Each
   is taken from the app itself at the 13 inch iPad's size with its clock held,
   then set in an iPad on the night of the paintings under a line in gold, as
   the phone's are.

     python3 -m http.server 8765 --directory docs &
     node tools/store/ipad-shots.mjs

   → ios/screenshots/ipad-13/*.png   five, 2752 × 2064, for the 13 inch iPad set

   The 13 inch set is the one Apple asks for once an app runs on iPad, and it
   shrinks it for every smaller iPad. The App Store listing workflow and every
   version sent from the iOS workflow place it. Needs Playwright's Chromium. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SITE = process.env.SITE || 'http://127.0.0.1:8765/';

async function playwright() {
  for (const where of ['playwright', '/opt/npm-tools/node_modules/playwright/index.js', '/tmp/node_modules/playwright-core/index.mjs']) {
    try {
      const m = await import(where);
      return m.chromium ? m : m.default;
    } catch (e) { /* the next */ }
  }
  throw new Error('playwright is missing');
}

/* Kuwait keeps one offset all year; the 25th of October, as the phone's */
const DAY = new Date('2026-10-25T00:00:00+03:00').getTime();
const at = (h, m) => DAY + (h * 60 + m) * 60000;

/* the 13 inch iPad on its side, in points, and two pixels to the point */
const PAD_W = 1376, PAD_H = 1032, SCALE = 2;
const W = PAD_W * SCALE, H = PAD_H * SCALE;

const SHOTS = [
  { name: 'home', time: at(17, 40), top: 'أوقات الصلاة والأذان', sub: 'تقويم العجيري للكويت، وحسابٌ في جهازك لكل مكان' },
  { name: 'mushaf', time: at(17, 40), top: 'المصحف صفحتان متقابلتان', sub: 'برواية حفص بالرسم العثماني، ٦٠٤ صفحات وتفسير بلا شبكة' },
  { name: 'sky', time: at(17, 16), top: 'سماء الوقت', sub: 'تتبدّل مع مواقيت الصلاة في مدينتك من الفجر إلى العشاء' },
  { name: 'azkar', time: at(7, 10), top: 'أذكارك في وقتها', sub: 'الصباح والمساء وأذكار اليوم، بعدّادٍ يحفظ أين وصلت' },
  { name: 'prayers', time: at(17, 40), top: 'صلاتي', sub: 'علّم كل صلاة كيف صلّيتها، وتابع شهرك كله' }
];

const { chromium } = await playwright();
const browser = await chromium.launch();
const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'ipad-shots-'));

async function settle(page, ms) {
  await page.clock.runFor(ms);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) a.finish();
    }
    return Promise.all(Array.from(document.images).map((i) => (i.complete ? null : i.decode().catch(() => null))));
  });
}

async function take(shot) {
  const ctx = await browser.newContext({
    viewport: { width: PAD_W, height: PAD_H }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    locale: 'ar-KW', timezoneId: 'Asia/Kuwait', colorScheme: 'light', reducedMotion: 'no-preference',
    serviceWorkers: 'block'
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('sunnati.settings', JSON.stringify({
      placeAsked: true, notifyAsked: true, tour: true, lat: 29.3759, lng: 47.9774, city: 'الكويت'
    }));
    localStorage.setItem('sunnati.greet', 'الكويت');
    localStorage.setItem('sunnati.lastPage', '249');
  });
  const page = await ctx.newPage();
  const file = path.join(raw, shot.name + '.png');

  await page.clock.install({ time: shot.time - 30000 });
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.App && window.App.go && document.getElementById('arc-count'));
  await page.clock.pauseAt(shot.time - 12000);
  await page.clock.runFor(12000);
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '#banner,#toast,.toast,#sheet{display:none!important}::-webkit-scrollbar{display:none}';
    document.head.appendChild(st);
    /* a month of use, as a reader's iPad would show it */
    const today = App.helpers.sunnahDay();
    for (let n = 0; n <= 30; n++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 12);
      const ids = App.helpers.sunnahTicks(d);
      const share = n === 0 ? .66 : .3 + .6 * (Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1);
      Store.updateDay((rec) => { ids.slice(0, Math.round(ids.length * share)).forEach((id) => { rec.sunnah[id] = true; }); }, d);
    }
    const day = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 12);
    for (let n = 1; n <= 24; n++) {
      Store.PRAYER_KEYS.forEach((k, i) => Store.setPrayer(k, (n + i) % 5 === 0 ? 'ontime' : (n + i) % 7 === 0 ? 'late' : 'jamaah', day(n)));
    }
    Store.setPrayer('fajr', 'jamaah'); Store.setPrayer('dhuhr', 'jamaah'); Store.setPrayer('asr', 'ontime');
  });
  const book = await page.evaluate(() => document.documentElement.classList.contains('book'));
  if (!book) throw new Error('the page is not a book at ' + PAD_W + ' by ' + PAD_H);

  if (shot.name === 'home' || shot.name === 'sky') {
    await page.evaluate(() => { App.go('home'); window.scrollTo(0, 0); });
    await settle(page, 900);
    if (shot.name === 'sky') {
      const r = await page.evaluate(() => {
        const b = document.getElementById('arc-wrap').getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height * .45 };
      });
      await page.mouse.click(r.x, r.y);
      await settle(page, 1600);
      await page.evaluate(() => Promise.all(Array.from(document.querySelectorAll('#skyview img')).map((i) => (i.complete ? null : i.decode().catch(() => null)))));
    }
  } else if (shot.name === 'mushaf') {
    await page.waitForFunction(() => window.Mushaf && window.Mushaf.ready(), null, { timeout: 40000 });
    await page.evaluate(() => App.helpers.openPage(249));
    await settle(page, 900);
  } else if (shot.name === 'azkar') {
    await page.evaluate(() => { window.location.hash = '#azkar/morning'; });
    await settle(page, 600);
    await page.evaluate(() => { App.go('azkar-list'); window.scrollTo(0, 0); });
    await settle(page, 600);
    /* the first card said more than once, counted half way */
    const card = await page.evaluate(() => {
      const digits = (s) => +String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      const c = Array.from(document.querySelectorAll('#azkar-items .dhikr'))
        .find((el) => { const n = digits(el.querySelector('.dhikr-left').textContent.trim()); return n >= 3 && n <= 4; });
      if (!c) return null;
      const r = c.getBoundingClientRect();
      window.scrollTo(0, Math.max(0, Math.round(r.top + window.scrollY - 210)));
      const t = c.querySelector('.dhikr-text').getBoundingClientRect();
      return { x: t.left + t.width / 2, y: t.top + Math.min(t.height / 2, 60) };
    });
    if (card) {
      for (let k = 0; k < 2; k++) { await page.mouse.click(card.x, card.y); await settle(page, 300); }
    }
    await settle(page, 600);
  } else {
    /* by way of the home screen, which draws the count of the day's sunnahs
       that the book keeps on its other half */
    await page.evaluate(() => App.go('home'));
    await settle(page, 300);
    await page.evaluate((v) => { App.go(v); window.scrollTo(0, 0); }, shot.name);
    await settle(page, 900);
  }
  await page.screenshot({ path: file });
  await ctx.close();
}

for (const s of SHOTS) {
  await take(s);
  console.log('took', s.name);
}

/* ---- the frame: the night of the paintings, an iPad, a line in gold ---- */
const FONTS = path.join(ROOT, 'docs', 'css', 'fonts.css');
function frame(shot, png) {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${FONTS}">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{font-family:'IBM Plex Sans Arabic',sans-serif;color:#fff8ea;
    background:radial-gradient(110% 90% at 50% 52%,#1b3a7c 0%,#0d1f49 46%,#050b1e 100%);position:relative}
  canvas{position:absolute;inset:0}
  .glow{position:absolute;left:50%;width:${Math.round(W * .9)}px;height:${Math.round(W * .6)}px;margin-left:-${Math.round(W * .45)}px;border-radius:50%;
    background:radial-gradient(closest-side,rgba(232,190,104,.26) 0%,rgba(232,190,104,.09) 45%,rgba(232,190,104,0) 100%)}
  .words{position:absolute;left:0;right:0;top:110px;text-align:center;padding:0 160px}
  .top{font-size:112px;font-weight:700;line-height:1.2;
    background:linear-gradient(180deg,#fff4d2 0%,#f5d482 46%,#c9953b 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 6px 22px rgba(0,0,0,.5))}
  .sub{font-size:52px;font-weight:500;line-height:1.5;margin-top:18px;text-shadow:0 3px 18px rgba(0,0,0,.5)}
  .pad{position:absolute;left:50%;border-radius:72px;padding:34px;
    background:linear-gradient(150deg,#474c58 0%,#17191f 22%,#0b0c10 55%,#23262e 85%,#3a3e48 100%);
    box-shadow:0 70px 130px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.13) inset,0 0 0 1px rgba(0,0,0,.7)}
  .pad img{display:block;width:100%;border-radius:40px}
</style></head><body>
<canvas id="stars" width="${W}" height="${H}"></canvas>
<div class="glow" id="glow"></div>
<div class="words" id="words"><div class="top">${shot.top}</div><div class="sub">${shot.sub}</div></div>
<div class="pad" id="pad"><img id="screen" src="data:image/png;base64,${png}"></div>
<script>
  /* stars that are the same every time */
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const c = document.getElementById('stars').getContext('2d');
  for (let i = 0; i < 300; i++) {
    const x = r() * ${W}, y = r() * ${H}, rad = .5 + r() * r() * 2.4;
    c.fillStyle = 'rgba(255,248,232,' + (.15 + .7 * r() * r()).toFixed(3) + ')';
    c.beginPath(); c.arc(x, y, rad, 0, 6.2832); c.fill();
  }
  /* the iPad fills what the words leave, its screen in the 13 inch shape */
  const words = document.getElementById('words').getBoundingClientRect();
  const padTop = Math.ceil(words.bottom + 64);
  const bottom = 96, bezel = 34;
  const h = ${H} - padTop - bottom;
  const w = Math.round((h - 2 * bezel) * ${PAD_W} / ${PAD_H}) + 2 * bezel;
  const pad = document.getElementById('pad');
  pad.style.top = padTop + 'px'; pad.style.width = w + 'px'; pad.style.marginLeft = (-w / 2) + 'px';
  const glow = document.getElementById('glow');
  glow.style.top = (padTop + h * .5 - ${Math.round(W * .3)}) + 'px';
</script></body></html>`;
}

const dir = path.join(ROOT, 'ios', 'screenshots', 'ipad-13');
fs.mkdirSync(dir, { recursive: true });
for (const n of fs.readdirSync(dir)) if (n.endsWith('.png')) fs.unlinkSync(path.join(dir, n));
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
for (let i = 0; i < SHOTS.length; i++) {
  const shot = SHOTS[i];
  const png = fs.readFileSync(path.join(raw, shot.name + '.png')).toString('base64');
  const html = path.join(raw, 'frame.html');
  fs.writeFileSync(html, frame(shot, png));
  await page.goto('file://' + html);
  await page.evaluate(async () => { await document.fonts.ready; await document.getElementById('screen').decode(); });
  await page.waitForTimeout(150);
  const out = path.join(dir, (i + 1) + '-' + shot.name + '.png');
  await page.screenshot({ path: out });
  console.log('framed', path.relative(ROOT, out));
}
await page.close();
await browser.close();
console.log('raw screens in', raw);
