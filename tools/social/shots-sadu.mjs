import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, locale: 'ar-KW', timezoneId: 'Asia/Kuwait' });
const p = await ctx.newPage();
await p.clock.install({ time: new Date('2026-09-06T15:40:00+03:00') });
await p.goto('http://localhost:8840/', { waitUntil: 'networkidle' });
await p.waitForFunction('window.Mushaf && Mushaf.ready()', { timeout: 30000 });
await p.evaluate(() => { Store.set('accent', 'sadu'); Store.set('pattern', 'sadu'); Store.set('placeAsked', true); location.reload(); });
await p.waitForTimeout(2500);
await p.waitForFunction('window.Mushaf && Mushaf.ready()', { timeout: 30000 });
await p.evaluate(() => { const bn = document.getElementById('banner'); if (bn) bn.hidden = true; const st = document.createElement('style'); st.textContent = '#banner{display:none!important}'; document.head.appendChild(st); });
await p.clock.runFor(1500);
for (const [name, script] of [['home', "App.go('home')"], ['page', "App.helpers.openPage(2)"]]) {
  await p.evaluate(script); await p.clock.runFor(600);
  await p.screenshot({ path: '/home/claude/qs/docs/screens/social/' + name + '.png' });
  console.log('shot', name, 'in sadu red');
}
await b.close();
