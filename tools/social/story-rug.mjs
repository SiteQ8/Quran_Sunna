/* One story, 1080 by 1920: the sadu as the whole ground, drawn, six columns of
   eyes like a runner laid flat, and the message on a paper panel over it. No
   store badge. Serve docs/ on 8840 first, then: node tools/social/story-rug.mjs OUTDIR */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
import { runner, cushion, colours as C } from './sadu.mjs';
const OUT = process.argv[2] || '/tmp/sunnati-social';
fs.mkdirSync(OUT, { recursive: true });
const mark = fs.readFileSync(new URL('../../docs/icons/icon.svg', import.meta.url), 'utf8');
/* The mark is written with double quotes now and this replacement looked for
   single ones, so it matched nothing and quietly handed back a 512 drawing
   whatever size was asked for. A replacement that can miss has to say so. */
function sized(svg, size) {
  const out = svg.replace(/width=["']512["'] height=["']512["']/,
    `width="${size}" height="${size}"`);
  if (out === svg) throw new Error('the mark did not take a size; icon.svg changed shape');
  return out;
}
const logo = (size) => sized(mark, size);

const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;width:1080px;height:1920px;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;width:1080px;height:1920px;overflow:hidden;background:${C.RED}}
  /* the rug: the runner's column of eyes, six across, with a hair of shadow between */
  .rug{position:absolute;inset:0;background-image:${runner()};background-size:180px 128px;background-repeat:repeat}
  .weft{position:absolute;inset:0;background:repeating-linear-gradient(180deg,rgba(0,0,0,.08) 0 2px,transparent 2px 6px);mix-blend-mode:multiply;opacity:.6}
  .vignette{position:absolute;inset:0;background:radial-gradient(90% 60% at 50% 45%,transparent 30%,rgba(40,8,8,.55) 100%)}
  .band{position:absolute;right:0;left:0;height:110px;background-image:${cushion()};background-size:88px 110px;box-shadow:0 0 30px rgba(0,0,0,.35)}
  .band.top{top:0}.band.bottom{bottom:0}
  .panel{position:absolute;right:90px;left:90px;top:330px;padding:56px 48px 60px;text-align:center;background:#f7f5ef;color:#16241c;border-radius:34px;box-shadow:0 40px 90px rgba(30,5,5,.5);border:6px double ${C.GOLD}}
  .panel::before{content:'';position:absolute;inset:14px;border:1.5px solid ${C.GOLD};border-radius:22px;opacity:.7;pointer-events:none}
  .mark{margin:0 auto;width:260px;filter:drop-shadow(0 18px 30px rgba(90,20,20,.35))}
  .mark svg{border-radius:22%;display:block}
  .name{font-size:132px;font-weight:700;line-height:1;margin-top:28px;color:${C.RED}}
  .tag{font-size:42px;font-weight:500;margin-top:14px;color:#4a5a51}
  .rule{width:200px;height:2px;margin:36px auto;background:linear-gradient(90deg,transparent,${C.GOLD},transparent)}
  .lead{font-size:38px;line-height:1.75;color:#16241c;max-width:820px;margin:0 auto}
  .chips{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:36px}
  .chip{padding:12px 24px;border-radius:999px;border:2px solid ${C.RED};font-size:30px;font-weight:600;color:${C.RED};background:rgba(156,43,43,.06)}
  .url{font-size:44px;font-weight:700;color:${C.RED};margin-top:40px}
</style>
<div class="page"><div class="rug"></div><div class="weft"></div><div class="vignette"></div><div class="band top"></div><div class="band bottom"></div>
  <div class="panel">
    <div class="mark">${logo(260)}</div>
    <div class="name">سُنّتي</div>
    <div class="tag">مصحف ومواقيت وأذكار وسنن في جهازك</div>
    <div class="rule"></div>
    <div class="lead">المصحف كاملاً، ومواقيت الكويت على تقويم العجيري، وحصن المسلم بأبوابه كلها، والسنن اليومية، وأذان في وقته</div>
    <div class="chips"><span class="chip">بلا إنترنت</span><span class="chip">بلا إعلانات</span><span class="chip">بلا تتبع</span></div>
    <div class="url">sunnati.3li.info</div>
  </div></div></html>`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
await p.route('http://localhost:8840/__story.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
await p.goto('http://localhost:8840/__story.html', { waitUntil: 'networkidle' });
const ready = await p.evaluate(async () => {
  const faces = ["700 60px 'IBM Plex Sans Arabic'", "600 30px 'IBM Plex Sans Arabic'", "500 40px 'IBM Plex Sans Arabic'", "400 30px 'IBM Plex Sans Arabic'"];
  for (const f of faces) { for (let i = 0; i < 3; i++) { try { await document.fonts.load(f, 'سُنّتي'); break; } catch (e) { await new Promise((r) => setTimeout(r, 300)); } } }
  await document.fonts.ready;
  return faces.every((f) => document.fonts.check(f, 'سُنّتي'));
});
if (!ready) throw new Error('the app font did not load');
await p.waitForTimeout(150);
await p.screenshot({ path: OUT + '/story-rug.png' });
console.log('drew story-rug');
await b.close();
