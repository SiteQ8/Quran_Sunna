/* Proves that a device which has already installed the worker still receives a
   new release, and still works with the network cut. jsdom cannot run a service
   worker, so this check needs a real browser and lives outside the test suite.

   Usage, from the repository root:
     cp -r docs /tmp/site && python3 -m http.server 8795 --directory /tmp/site &
     node tools/check-updates-reach-the-device.mjs
*/
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-KW' });
const p = await ctx.newPage();

// first visit: the worker installs and fills its cache
await p.goto('http://localhost:8795/', { waitUntil: 'networkidle' });
await p.waitForFunction('navigator.serviceWorker.controller !== null', { timeout: 20000 });
const first = await p.evaluate("App.version");
console.log('first visit  : app version ' + first + ', worker controlling ' +
  await p.evaluate("navigator.serviceWorker.controller !== null"));

// a new release lands on the server while the device keeps its cache
const file = 'site/js/app.js';
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("var VERSION = '5.6.0';", "var VERSION = '5.6.1-NEW';"));
console.log('server now serves 5.6.1-NEW');

// returning visit, same profile, same worker
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const second = await p.evaluate("App.version");
console.log('return visit : app version ' + second + (second === '5.6.1-NEW' ? '   the update arrived' : '   STALE, the fix never reaches the device'));

// and it must still work with the network cut
await ctx.setOffline(true);
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(1500);
const offline = await p.evaluate("typeof App === 'object' && !!document.getElementById('v-home')").catch(() => false);
console.log('offline      : app still boots ' + offline);
await b.close();
