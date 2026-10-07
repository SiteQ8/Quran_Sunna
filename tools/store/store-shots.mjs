/* The screenshots of both stores, in the look the app has now: the opening
   screen of the reader's country by night, the hour's countdown, the sky of
   the time on the whole screen, the painted sections, the mushaf, the morning
   azkar, the prayers kept and the qibla. Each is taken from the app itself
   with its clock held, then set in a phone on the night of the paintings
   under a line in gold, as the film shows them.

     python3 -m http.server 8765 --directory docs &
     node tools/store/store-shots.mjs

   → ios/screenshots/6.9-inch/*.png   six, 1320 × 2868, for the 6.9 inch set
   → play/listing/phone/*.png         eight, 1080 × 1920, for Google Play

   The App Store listing workflow places the first, the Play listing workflow
   the second. Needs Playwright's Chromium. */

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

/* Kuwait keeps one offset all year; the 25th of October, as the film */
const DAY = new Date('2026-10-25T00:00:00+03:00').getTime();
const at = (h, m) => DAY + (h * 60 + m) * 60000;

/* what each screen says over it: what it is, and what is worth knowing */
const SHOTS = [
  { name: 'splash', time: at(20, 40), top: 'شاشة بدء من بلدك', sub: 'لوحة من تراث بلدك بليله ونهاره، وترحيبٌ بأهله' },
  { name: 'home', time: at(17, 40), top: 'أوقات الصلاة والأذان', sub: 'تقويم العجيري للكويت، وحسابٌ في جهازك لكل مكان' },
  { name: 'sky', time: at(17, 16), top: 'سماء الوقت', sub: 'تتبدّل مع مواقيت الصلاة في مدينتك من الفجر إلى العشاء' },
  { name: 'sections', time: at(17, 40), top: 'كل ما تحتاجه في يومك', sub: 'القبلة والمساجد والقضاء والعمرة والختمة والأدعية' },
  { name: 'mushaf', time: at(17, 40), top: 'المصحف كاملاً بلا شبكة', sub: 'برواية حفص بالرسم العثماني، ٦٠٤ صفحات وتفسير' },
  { name: 'azkar', time: at(7, 10), top: 'أذكارك في وقتها', sub: 'الصباح والمساء وأذكار اليوم، بعدّادٍ يحفظ أين وصلت' },
  { name: 'prayers', time: at(17, 40), top: 'صلاتي', sub: 'علّم كل صلاة كيف صلّيتها، وتابع شهرك كله' },
  { name: 'qibla', time: at(17, 40), top: 'القبلة', sub: 'بوصلة تدور مع جهازك نحو الكعبة' }
];
/* Apple shows the first three in a search, so the six it takes lead with
   the country, the hour and the sky; Play takes all eight */
const IOS = ['splash', 'home', 'sky', 'mushaf', 'azkar', 'sections'];
const PLAY = ['splash', 'home', 'sky', 'sections', 'mushaf', 'azkar', 'prayers', 'qibla'];

const { chromium } = await playwright();
const browser = await chromium.launch();
const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'store-shots-'));

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
  /* the 6.9 inch phone exactly: 440 by 956 at three to the point */
  const ctx = await browser.newContext({
    viewport: { width: 440, height: 956 }, deviceScaleFactor: 3,
    locale: 'ar-KW', timezoneId: 'Asia/Kuwait', colorScheme: 'light', reducedMotion: 'no-preference',
    serviceWorkers: 'block'
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('sunnati.settings', JSON.stringify({
      placeAsked: true, notifyAsked: true, lat: 29.3759, lng: 47.9774, city: 'الكويت'
    }));
    localStorage.setItem('sunnati.greet', 'الكويت');
    localStorage.setItem('sunnati.lastPage', '249');
  });
  const page = await ctx.newPage();
  const file = path.join(raw, shot.name + '.png');

  if (shot.name === 'splash') {
    /* the opening screen is gone once the app is up; boot.js has chosen its
       painting by then, from the zone and the hour, so the screen is put back
       as the page itself writes it, with the greeting boot.js gives */
    await page.clock.install({ time: shot.time - 30000 });
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await page.clock.pauseAt(shot.time);
    await page.evaluate(async () => {
      if (!document.getElementById('boot-splash')) {
        const html = await (await fetch(location.href)).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const splash = doc.getElementById('boot-splash');
        document.body.appendChild(document.importNode(splash, true));
      }
      const splash = document.getElementById('boot-splash');
      splash.style.opacity = '1';
      splash.style.display = 'block';
      document.getElementById('boot-hail').textContent = 'حيّ الله أهل';
      document.getElementById('boot-city').textContent = 'الكويت';
      await document.fonts.ready;
      const sky = document.getElementById('boot-sky');
      const m = /url\(["']?([^"')]+)/.exec(getComputedStyle(sky).backgroundImage);
      if (m) { const i = new Image(); i.src = m[1]; await i.decode().catch(() => null); }
      const mark = document.getElementById('boot-mark');
      if (mark && !mark.complete) await mark.decode().catch(() => null);
    });
    await page.waitForTimeout(300);
    const where = await page.evaluate(() => document.documentElement.getAttribute('data-splash'));
    console.log('splash', where);
    await page.screenshot({ path: file });
    await ctx.close();
    return;
  }

  await page.clock.install({ time: shot.time - 30000 });
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.App && window.App.go && document.getElementById('arc-count'));
  await page.clock.pauseAt(shot.time - 12000);
  await page.clock.runFor(12000);
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '#banner,#toast,.toast,#sheet{display:none!important}::-webkit-scrollbar{display:none}';
    document.head.appendChild(st);
    /* a month of use, as a reader's phone would show it */
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

  if (shot.name === 'home' || shot.name === 'sky' || shot.name === 'sections') {
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
    if (shot.name === 'sections') {
      await page.evaluate(() => {
        const h = document.getElementById('home-tiles').previousElementSibling;
        window.scrollTo(0, Math.round(h.getBoundingClientRect().top + window.scrollY - 14));
      });
      await settle(page, 600);
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
    /* the first card said more than once, counted half way, in the middle */
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

/* ---- the frame: the night of the paintings, a phone, a line in gold ---- */
const FONTS = path.join(ROOT, 'docs', 'css', 'fonts.css');
function frame(W, H, shot, png) {
  const big = W > 1200;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${FONTS}">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{font-family:'IBM Plex Sans Arabic',sans-serif;color:#fff8ea;
    background:radial-gradient(120% 78% at 50% 44%,#1b3a7c 0%,#0d1f49 44%,#050b1e 100%);position:relative}
  canvas{position:absolute;inset:0}
  .glow{position:absolute;left:50%;width:${Math.round(W * 1.05)}px;height:${Math.round(W * 1.05)}px;margin-left:-${Math.round(W * .525)}px;border-radius:50%;
    background:radial-gradient(circle,rgba(232,190,104,.30) 0%,rgba(232,190,104,.10) 36%,rgba(232,190,104,0) 68%)}
  .words{position:absolute;left:0;right:0;top:${big ? 150 : 96}px;text-align:center;padding:0 ${big ? 90 : 70}px}
  .top{font-size:${big ? 106 : 82}px;font-weight:700;line-height:1.2;
    background:linear-gradient(180deg,#fff4d2 0%,#f5d482 46%,#c9953b 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 6px 22px rgba(0,0,0,.5))}
  .sub{font-size:${big ? 50 : 39}px;font-weight:500;line-height:1.5;margin-top:${big ? 22 : 14}px;text-shadow:0 3px 18px rgba(0,0,0,.5)}
  .phone{position:absolute;left:50%;border-radius:${big ? 96 : 72}px;padding:${big ? 18 : 14}px;
    background:linear-gradient(150deg,#474c58 0%,#17191f 22%,#0b0c10 55%,#23262e 85%,#3a3e48 100%);
    box-shadow:0 70px 130px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.13) inset,0 0 0 1px rgba(0,0,0,.7)}
  .phone img{display:block;width:100%;border-radius:${big ? 78 : 58}px}
</style></head><body>
<canvas id="stars" width="${W}" height="${H}"></canvas>
<div class="glow" id="glow"></div>
<div class="words" id="words"><div class="top">${shot.top}</div><div class="sub">${shot.sub}</div></div>
<div class="phone" id="phone"><img id="screen" src="data:image/png;base64,${png}"></div>
<script>
  /* stars that are the same every time */
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const c = document.getElementById('stars').getContext('2d');
  for (let i = 0; i < ${big ? 260 : 190}; i++) {
    const x = r() * ${W}, y = r() * ${H}, rad = .5 + r() * r() * ${big ? 2.2 : 1.7};
    c.fillStyle = 'rgba(255,248,232,' + (.15 + .7 * r() * r()).toFixed(3) + ')';
    c.beginPath(); c.arc(x, y, rad, 0, 6.2832); c.fill();
  }
  /* the phone fills what the words leave, its screen in the 6.9 inch shape */
  /* window.top is the page's own, so the phone's is named otherwise */
  const words = document.getElementById('words').getBoundingClientRect();
  const phoneTop = Math.ceil(words.bottom + ${big ? 70 : 46});
  const bottom = ${big ? 120 : 70};
  const pad = ${big ? 18 : 14};
  const h = ${H} - phoneTop - bottom;
  const w = Math.round((h - 2 * pad) * 1320 / 2868) + 2 * pad;
  const phone = document.getElementById('phone');
  phone.style.top = phoneTop + 'px'; phone.style.width = w + 'px'; phone.style.marginLeft = (-w / 2) + 'px';
  const glow = document.getElementById('glow');
  glow.style.top = (phoneTop + h * .42 - ${Math.round(W * .525)}) + 'px';
</script></body></html>`;
}

async function compose(W, H, names, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of fs.readdirSync(dir)) if (n.endsWith('.png')) fs.unlinkSync(path.join(dir, n));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (let i = 0; i < names.length; i++) {
    const shot = SHOTS.find((s) => s.name === names[i]);
    const png = fs.readFileSync(path.join(raw, shot.name + '.png')).toString('base64');
    const html = path.join(raw, 'frame.html');
    fs.writeFileSync(html, frame(W, H, shot, png));
    await page.goto('file://' + html);
    await page.evaluate(async () => { await document.fonts.ready; await document.getElementById('screen').decode(); });
    await page.waitForTimeout(150);
    const out = path.join(dir, (i + 1) + '-' + shot.name + '.png');
    await page.screenshot({ path: out });
    console.log('framed', path.relative(ROOT, out));
  }
  await page.close();
}

await compose(1320, 2868, IOS, path.join(ROOT, 'ios', 'screenshots', '6.9-inch'));
await compose(1080, 1920, PLAY, path.join(ROOT, 'play', 'listing', 'phone'));
await browser.close();
console.log('raw screens in', raw);
