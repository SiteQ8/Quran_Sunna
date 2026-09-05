import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const svg = fs.readFileSync('/home/claude/qs/docs/icons/icon.svg', 'utf8');
const sizes = fs.readdirSync('/home/claude/qs/docs/splash').filter(f => f.endsWith('.png')).map(f => f.match(/(\d+)x(\d+)/)).map(m => [+m[1], +m[2]]);
for (const [w, h] of sizes) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  const side = Math.round(Math.min(w, h) * 0.30);
  await p.setContent(`<style>html,body{margin:0;width:${w}px;height:${h}px;background:#f7f5ef;display:grid;place-items:center}svg{width:${side}px;height:${side}px;border-radius:${Math.round(side*0.22)}px;box-shadow:0 ${Math.round(side*0.06)}px ${Math.round(side*0.16)}px rgba(90,20,20,.25)}</style>${svg}`);
  await p.waitForTimeout(80);
  await p.screenshot({ path: `/home/claude/qs/docs/splash/splash-${w}x${h}.png` });
  await p.close();
}
console.log('splash redrawn:', sizes.length);
await b.close();
