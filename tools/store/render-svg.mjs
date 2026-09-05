import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const [svgPath, jobsJson] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath, 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const [size, out, bg] of JSON.parse(jobsJson)) {
  const p = await (await b.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })).newPage();
  await p.setContent(`<style>html,body{margin:0;background:${bg || 'transparent'}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await p.screenshot({ path: out, omitBackground: !bg });
  await p.close();
  console.log('  wrote', out, size + 'x' + size);
}
await b.close();
