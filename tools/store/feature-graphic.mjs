import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const logo = fs.readFileSync('docs/icons/icon.svg', 'utf8');
const p = await (await b.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 })).newPage();
await p.setContent(`<style>
  html,body{margin:0;height:100%;background:linear-gradient(135deg,#268556,#11452c);
    font-family:'IBM Plex Sans Arabic','Noto Naskh Arabic',system-ui,sans-serif;color:#f7f5ef}
  .pat{position:absolute;inset:0;opacity:.16;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' stroke='%23f6f4ee' stroke-width='1'%3E%3Crect x='27' y='27' width='26' height='26'/%3E%3Crect x='27' y='27' width='26' height='26' transform='rotate(45 40 40)'/%3E%3Crect x='-13' y='-13' width='26' height='26'/%3E%3Crect x='-13' y='-13' width='26' height='26' transform='rotate(45 0 0)'/%3E%3Crect x='67' y='-13' width='26' height='26'/%3E%3Crect x='67' y='-13' width='26' height='26' transform='rotate(45 80 0)'/%3E%3Crect x='-13' y='67' width='26' height='26'/%3E%3Crect x='-13' y='67' width='26' height='26' transform='rotate(45 0 80)'/%3E%3Crect x='67' y='67' width='26' height='26'/%3E%3Crect x='67' y='67' width='26' height='26' transform='rotate(45 80 80)'/%3E%3C/g%3E%3C/svg%3E");background-size:80px 80px}
  .row{position:relative;height:100%;display:flex;align-items:center;justify-content:center;gap:52px;direction:rtl}
  .mark{width:210px;height:210px;filter:drop-shadow(0 18px 40px rgba(0,0,0,.35))}
  .txt{max-width:520px}
  h1{font-size:74px;margin:0 0 10px;letter-spacing:.01em}
  p{font-size:27px;margin:0;color:#cfe3d7;line-height:1.7}
  .line{margin-top:22px;font-size:20px;color:#d9b04a}
</style><div class="pat"></div><div class="row">
  <div class="txt"><h1>سُنّتي</h1><p>مصحف ومواقيت وأذكار وسنن في جهازك</p>
  <div class="line">المصحف · العجيري · حصن المسلم · السنن · بلا إنترنت</div></div>
  <div class="mark">${logo.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
</div>`);
await p.waitForTimeout(300);
await p.screenshot({ path: 'play/feature-graphic-1024x500.png' });
await b.close();
console.log('feature graphic written');
