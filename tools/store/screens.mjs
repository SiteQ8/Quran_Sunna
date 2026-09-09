/* The eight screenshots the store shows, at 1080 by 1920, taken from the app
   itself with the clock held at an afternoon so the times read sensibly.
   Serve docs/ on 8840 first, then: node tools/store/screens.mjs */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';

const SHOTS = [
  ['home', (p) => p.evaluate(() => App.go('home'))],
  ['prayers', (p) => p.evaluate(() => {
    const d = new Date();
    const day = (n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
    [1, 2, 3, 4, 6, 7, 8].forEach((n) => Store.PRAYER_KEYS.forEach((k) => Store.setPrayer(k, n % 3 === 0 ? 'ontime' : 'jamaah', day(n))));
    [5, 9].forEach((n) => Store.PRAYER_KEYS.forEach((k, i) => Store.setPrayer(k, i === 2 ? 'late' : 'ontime', day(n))));
    Store.setPrayer('fajr', 'jamaah'); Store.setPrayer('dhuhr', 'jamaah'); Store.setPrayer('asr', 'ontime');
    App.go('prayers');
  })],
  ['page', (p) => p.evaluate(() => App.helpers.openPage(249))],
  ['azkar', (p) => p.evaluate(() => App.go('azkar'))],
  ['hisn', (p) => p.evaluate(() => { App.state.hisn = 27; App.go('hisn'); })],
  ['tracker', (p) => p.evaluate(() => App.go('tracker'))],
  ['calendar', (p) => p.evaluate(() => App.go('calendar'))],
  ['qibla', (p) => p.evaluate(() => App.go('qibla'))]
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, locale: 'ar-KW', timezoneId: 'Asia/Kuwait' });
const p = await ctx.newPage();
await p.clock.install({ time: new Date('2026-09-13T15:40:00+03:00') });
await p.goto('http://localhost:8840/', { waitUntil: 'networkidle' });
await p.waitForFunction('window.Mushaf && Mushaf.ready()', { timeout: 40000 });
await p.evaluate(() => {
  Store.set('placeAsked', true);
  Store.set('notifyAsked', true);
  Store.set('lastRead', { s: 18, a: 10 });
  Store.setBookmark && null;
  const st = document.createElement('style');
  st.textContent = '#banner{display:none!important}#toast{display:none!important}';
  document.head.appendChild(st);
});
await p.clock.runFor(1500);
for (const [name, go] of SHOTS) {
  await go(p);
  await p.clock.runFor(700);
  await p.waitForTimeout(200);
  await p.screenshot({ path: 'docs/screens/' + name + '.png' });
  console.log('shot', name);
}
await b.close();
