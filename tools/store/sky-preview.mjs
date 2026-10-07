/* The preview the stores play before the screenshots: a whole day of «سماء
   الوقت» in twenty six seconds, filmed from the app itself frame by frame.

   The app's clock is held and moved by hand, so every frame is what the app
   draws at that minute: the countdown and its words, the painting of the
   hour and the blend between two of them, the stars, the lantern, the moon
   where it stands that night. Only the pace is the film's. Each prayer is
   held for two seconds in real time, the clock ticking as it does, and the
   hours between pass in about one, through the paintings in between; the
   clouds go faster to match, and the walk along the shore is the app's own,
   quickened from minutes to the length of the film.

   It opens on the home screen before the fajr, a touch opens the sky on the
   whole screen, the day goes by, and at night with the full moon rising a
   touch brings the home screen back. 25 October 2026 in Kuwait: the eve of a
   full moon, so the day ends under it.

   Serve docs/ first, then
     python3 -m http.server 8765 --directory docs &
     node tools/store/sky-preview.mjs portrait   → ios/previews/iphone-67/sky-day.mp4
     node tools/store/sky-preview.mjs landscape  → sky-day-landscape.mp4, 1920 × 1080
   A path after the shape writes the film there instead. Needs Playwright's
   Chromium and ffmpeg. */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SHAPES = {
  /* the 6.9 inch iPhone takes previews of 886 by 1920 */
  portrait: { width: 443, height: 960, out: 'ios/previews/iphone-67/sky-day.mp4', crf: 16, cap: '12M' },
  /* and YouTube, which is where Google Play takes its film from, 1920 by 1080 */
  landscape: { width: 960, height: 540, out: 'sky-day-landscape.mp4', crf: 18, cap: '' }
};
const shape = SHAPES[process.argv[2] || 'portrait'];
if (!shape) throw new Error('portrait or landscape');
const OUT = process.argv[3] || shape.out;
const SITE = process.env.SITE || 'http://127.0.0.1:8765/';
const FPS = 30;

async function playwright() {
  for (const where of ['playwright', '/opt/npm-tools/node_modules/playwright/index.js', '/tmp/node_modules/playwright-core/index.mjs']) {
    try {
      const m = await import(where);
      return m.chromium ? m : m.default;
    } catch (e) { /* the next */ }
  }
  throw new Error('playwright is missing');
}

/* Kuwait keeps one offset all year */
const DAY = new Date('2026-10-25T00:00:00+03:00').getTime();
const at = (minute) => DAY + Math.round(minute * 60000);
const smooth = (x) => x * x * (3 - 2 * x);

/* The day, held at each prayer and passing quickly between them: when each
   hold starts in the film, how long it lasts, and the minute it shows. */
function plan(t) {
  const holds = [
    { v: 0, hold: 5.6, m: 4 * 60 + 26 },                         // the night before the fajr
    { v: 6.7, hold: 1.7, m: t.fajr + 36 },                        // the light of the fajr
    { v: 9.5, hold: 1.7, m: t.sunrise + 14 },                     // the sunrise
    { v: 12.4, hold: 1.7, m: t.dhuhr + 3 },                       // just after the dhuhr
    { v: 15.2, hold: 1.7, m: t.asr + (t.maghrib - t.asr) * .6 },  // the gold of the afternoon
    { v: 17.9, hold: 1.9, m: t.maghrib + 8 },                     // just after the maghrib
    { v: 20.8, hold: 1.4, m: t.maghrib + (t.isha - t.maghrib) * .55 }, // the dusk, the lantern lit
    { v: 23.3, hold: 5.3, m: t.isha + 69 }                        // the night, and the full moon up
  ];
  /* whole minutes, so each countdown starts on a round second */
  holds.forEach((h) => { h.m = Math.round(h.m); });
  return {
    holds,
    open: 3.0,    // the touch on the niche
    close: 25.9,  // the touch that brings the home screen back
    fade: 0.7,    // the app's own fade, .skyview's transition
    end: 28.6,
    poster: 18.8, // the frame the store shows before it plays: the maghrib
    clock(v) {
      for (let k = 0; k < holds.length; k++) {
        const h = holds[k];
        const next = holds[k + 1];
        if (v < h.v + h.hold || !next) return at(h.m) + (v - h.v) * 1000;
        if (v < next.v) {
          const from = at(h.m) + h.hold * 1000;
          return from + (at(next.m) - from) * smooth((v - h.v - h.hold) / (next.v - h.v - h.hold));
        }
      }
      return at(holds[0].m);
    }
  };
}

const { chromium } = await playwright();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: shape.width, height: shape.height }, deviceScaleFactor: 2,
  locale: 'ar-KW', timezoneId: 'Asia/Kuwait', colorScheme: 'light', reducedMotion: 'no-preference',
  serviceWorkers: 'block'
});
await ctx.addInitScript(() => {
  localStorage.setItem('sunnati.settings', JSON.stringify({
    placeAsked: true, notifyAsked: true, lat: 29.3759, lng: 47.9774, city: 'الكويت'
  }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

/* the clock is the app's: held, and moved only from here */
const start = DAY + (4 * 60 + 26) * 60000;
await page.clock.install({ time: start - 30000 });
await page.goto(SITE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.App && window.App.go && document.getElementById('arc-count'));
await page.clock.pauseAt(start - 12000);
/* the opening splash keeps its floor of three seconds, then goes */
await page.clock.runFor(12000);

const t = await page.evaluate(() => App.computeTimes(new Date(2026, 9, 25, 12)));
const film = plan(t);
console.log('times', JSON.stringify(t));
console.log('holds', film.holds.map((h) => Math.floor(h.m / 60) + ':' + String(h.m % 60).padStart(2, '0')).join(' '));

await page.evaluate(async () => {
  /* nothing the app raises on its own crosses the film: no banner, no toast,
     no sheet. The fades are set frame by frame from the film, so the
     stylesheet's own transitions are taken off and left to it. */
  const st = document.createElement('style');
  st.textContent = '#banner,#toast,.toast,#sheet{display:none!important}' +
    '.skyview,.skyview-plate{transition:none!important}' +
    '::-webkit-scrollbar{display:none}';
  document.head.appendChild(st);
  /* a month of use, as the screenshots of the store show one: the meter of
     the day part full and the thirty days under it in their shades, rather
     than an app opened for the first time */
  const sunnahDay = App.helpers.sunnahDay;
  const today = sunnahDay();
  /* the film opens before the fajr, still on the day before by the app's
     reckoning, and ends on the evening of the next, part done */
  for (let n = -1; n <= 30; n++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 12);
    const ids = App.helpers.sunnahTicks(d);
    const share = n === -1 ? .48 : n === 0 ? .66 : .3 + .6 * (Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1);
    Store.updateDay((rec) => { ids.slice(0, Math.round(ids.length * share)).forEach((id) => { rec.sunnah[id] = true; }); }, d);
  }
  /* every painting decoded before the first frame, so none arrives late */
  await Promise.all(['night', 'fajr', 'sunrise', 'morning', 'noon', 'afternoon', 'sunset', 'dusk'].map((n) => {
    const img = new Image();
    img.src = 'img/sky/' + n + '.webp';
    return img.decode().catch(() => null);
  }));
  App.go('home');
  window.scrollTo(0, 0);
});

/* where a finger would touch the niche, and the shore in the scene */
const niche = await page.evaluate(() => {
  const r = document.getElementById('arc-wrap').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height * .45 };
});

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-preview-'));
let now = start;
let opened = false;
let closed = false;
const total = Math.round(film.end * FPS);
for (let f = 0; f < total; f++) {
  const v = f / FPS;
  if (!opened && v >= film.open) {
    await page.mouse.click(niche.x, niche.y);
    opened = true;
  }
  if (!closed && v >= film.close) {
    await page.mouse.click(shape.width / 2, shape.height / 2);
    closed = true;
  }
  const want = Math.round(film.clock(v));
  /* one jump per frame: whatever fell due fires once, the countdown among it */
  if (want > now) { await page.clock.fastForward(want - now); now = want; }
  await page.evaluate(({ v, film: s, shape: sh }) => {
    const view = document.getElementById('skyview');
    const scene = document.getElementById('skyview-scene');
    const inSky = v >= s.open && v < s.close + s.fade;
    /* the fade in and the fade out, as the app does them */
    if (view) {
      if (v >= s.open && v < s.open + s.fade) view.style.opacity = String((v - s.open) / s.fade);
      else if (v >= s.close && v < s.close + s.fade) view.style.opacity = String(1 - (v - s.close) / s.fade);
      else view.style.opacity = '';
      if (v >= s.close + s.fade) view.hidden = true;
    }
    /* every motion of the page, held and set to the film's time: the clouds
       quickened, the rest at their own pace */
    for (const a of document.getAnimations()) {
      const target = a.effect && a.effect.target;
      if (!(a.animationName)) { a.cancel(); continue; }   // the app's walk along the shore, done below
      /* what runs once, a screen coming in, is let finish: it is not the sky */
      if (a.effect.getComputedTiming().iterations !== Infinity) { a.finish(); continue; }
      if (a.__born === undefined) { a.__born = v; a.pause(); }
      const sky = target && target.closest && target.closest('#skyview');
      const speed = a.animationName === 'cloud-drift' ? (sky ? 6 : 2) : 1;
      a.currentTime = (v - a.__born) * 1000 * speed;
    }
    /* the walk along the shore: from the minaret near the edge to the
       minaret in the middle, arriving at it with the night */
    if (scene && inSky) {
      const w = scene.getBoundingClientRect().width;
      const vw = window.innerWidth;
      const room = Math.max(0, w - vw);
      const x = (at) => -Math.min(room, Math.max(0, w * .746 - vw * at));
      const p = Math.max(0, Math.min(1, (v - s.open) / (s.close + s.fade - s.open)));
      const e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const from = x(sh.width > sh.height ? .74 : .84), to = x(sh.width > sh.height ? .74 : .5);
      scene.style.transform = 'translateX(' + (from + (to - from) * e).toFixed(2) + 'px)';
    }
  }, { v, film: { open: film.open, close: film.close, fade: film.fade }, shape });
  await page.evaluate(() => Promise.all(Array.from(document.querySelectorAll('#skyview img')).map((i) => (i.complete ? null : i.decode().catch(() => null)))));
  await page.screenshot({ path: path.join(frames, String(f).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 95 });
  if (f % 30 === 0) {
    const s = await page.evaluate(() => ({
      open: !document.getElementById('skyview').hidden,
      a: document.getElementById('skyview-a').getAttribute('src') || document.getElementById('sky-a').getAttribute('href'),
      words: document.getElementById('arc-label').textContent + ' ' + document.getElementById('arc-name').textContent + ' ' + document.getElementById('arc-count').textContent
    }));
    console.log(v.toFixed(1) + 's', new Date(now).toISOString().slice(11, 19), s.open ? 'sky ' : 'home', s.a, s.words);
  }
}
await browser.close();
if (errors.length) console.log('page errors:', errors.join(' | '));

/* H.264 High at 4.0 in 4:2:0 at thirty frames, and a silent stereo track,
   which is what App Store Connect asks of a preview */
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
const args = ['-y', '-framerate', String(FPS), '-i', path.join(frames, '%04d.jpg'),
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest',
  '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-preset', 'slow',
  '-crf', String(shape.crf)];
if (shape.cap) args.push('-maxrate', shape.cap, '-bufsize', '24M');
args.push('-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', OUT);
const enc = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
if (enc.status !== 0) throw new Error(String(enc.stderr).slice(-2000));
/* the still the store shows before the film plays, beside it as hours,
   minutes, seconds and frames, which is how App Store Connect takes it */
const s = Math.floor(film.poster);
const poster = '00:00:' + String(s).padStart(2, '0') + ':' + String(Math.round((film.poster - s) * FPS)).padStart(2, '0');
fs.writeFileSync(OUT.replace(/\.mp4$/, '.poster'), poster + '\n');
console.log('wrote', OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB', 'poster at', poster, 'frames in', frames);
