/* The post that announces an update: a 4:5 post and a story, on the drawn
   sadu rug, listing what changed. Edit ITEMS and the version, then:
     python3 -m http.server 8840 --directory docs &
     node tools/social/update.mjs OUTDIR */
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
import fs from 'fs';
import { runner, cushion, colours as C } from './sadu.mjs';
const OUT = process.argv[2] || '/tmp/sunnati-social';
fs.mkdirSync(OUT, { recursive: true });
const P = 'http://localhost:8840/screens/social/';
const mark = fs.readFileSync(new URL('../../docs/icons/icon.svg', import.meta.url), 'utf8');
const logo = (size) => mark.replace(/width='512' height='512'/, `width='${size}' height='${size}'`);
const VERSION = '8.7';
const ITEMS = [
  ['شعار جديد: محراب يطل على السماء', 'مئذنة على الساحل وهلال فوقها في سماء الغروب، والنجمة على رأس المحراب كما في التطبيق'],
  ['المصحف على هيئة المصحف', 'البسملة في سطرها، والجزء والحزب وربعه في رأس الصفحة، وأرقام المصحف'],
  ['صلاتي', 'علّم كل صلاة من الخمس كيف صلّيتها، وشهرك في شبكة'],
  ['ملاحظات وعلامات', 'ملاحظتك على أي آية، وعلامات قراءة ومراجعة وحفظ وتدبر'],
  ['أذان من تطبيق أندرويد', 'يرنّ في دقيقته والتطبيق مغلق، لموقعك أينما كنت'],
];
const css = `
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  html,body{margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl}
  .page{position:relative;overflow:hidden;background:${C.RED}}
  .rug{position:absolute;inset:0;background-image:${runner()};background-size:180px 128px;background-repeat:repeat}
  .weft{position:absolute;inset:0;background:repeating-linear-gradient(180deg,rgba(0,0,0,.08) 0 2px,transparent 2px 6px);mix-blend-mode:multiply;opacity:.6}
  .vignette{position:absolute;inset:0;background:radial-gradient(90% 60% at 50% 45%,transparent 30%,rgba(40,8,8,.55) 100%)}
  .band{position:absolute;right:0;left:0;height:100px;background-image:${cushion()};background-size:80px 100px;box-shadow:0 0 30px rgba(0,0,0,.35)}
  .band.top{top:0}.band.bottom{bottom:0}
  .panel{position:absolute;right:72px;left:72px;padding:44px 40px 48px;background:#f7f5ef;color:#16241c;border-radius:30px;box-shadow:0 40px 90px rgba(30,5,5,.5);border:6px double ${C.GOLD}}
  .panel::before{content:'';position:absolute;inset:12px;border:1.5px solid ${C.GOLD};border-radius:20px;opacity:.7;pointer-events:none}
  .head{display:flex;align-items:center;gap:22px}
  .head svg{border-radius:22%;display:block;flex:none;filter:drop-shadow(0 12px 22px rgba(90,20,20,.3))}
  .kicker{font-size:30px;font-weight:600;color:${C.GOLD};letter-spacing:.02em}
  .title{font-size:72px;font-weight:700;line-height:1.1;color:${C.RED};margin-top:4px}
  .list{margin-top:34px;display:grid;gap:14px}
  .item{display:flex;gap:18px;align-items:flex-start;padding:18px 22px;border-radius:18px;background:rgba(156,43,43,.06);border:1.5px solid rgba(217,164,65,.55)}
  .eye{flex:none;width:34px;height:34px;margin-top:6px}
  .item b{display:block;font-size:34px;font-weight:700;color:#16241c;line-height:1.3}
  .item span{display:block;font-size:26px;color:#4a5a51;line-height:1.55;margin-top:4px}
  .url{text-align:center;font-size:40px;font-weight:700;color:${C.RED};margin-top:34px}
</style>`;
const eye = `<svg class="eye" viewBox="0 0 40 40"><path d="M20 3 L37 20 L20 37 L3 20z" fill="${C.RED}"/><path d="M20 10 L30 20 L20 30 L10 20z" fill="#f3e9d2"/><path d="M20 15 L25 20 L20 25 L15 20z" fill="#1a1412"/></svg>`;
const list = ITEMS.map((i) => `<div class="item">${eye}<div><b>${i[0]}</b><span>${i[1]}</span></div></div>`).join('');
const items = [
  { w: 1080, h: 1350, file: 'update-post-4x5', html: `<div class="page" style="width:1080px;height:1350px"><div class="rug"></div><div class="weft"></div><div class="vignette"></div><div class="band top"></div><div class="band bottom"></div>
      <div class="panel" style="top:150px"><div class="head">${logo(130)}<div><div class="kicker">تحديث ${VERSION}</div><div class="title">ما الجديد في سُنّتي</div></div></div>
      <div class="list">${list}</div><div class="url">sunnati.3li.info</div></div></div>` },
  { w: 1080, h: 1920, file: 'update-story', html: `<div class="page" style="width:1080px;height:1920px"><div class="rug"></div><div class="weft"></div><div class="vignette"></div><div class="band top"></div><div class="band bottom"></div>
      <div class="panel" style="top:300px"><div class="head">${logo(140)}<div><div class="kicker">تحديث ${VERSION}</div><div class="title">ما الجديد في سُنّتي</div></div></div>
      <div class="list" style="gap:16px">${list}</div><div class="url" style="margin-top:44px">sunnati.3li.info</div></div></div>` },
];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const item of items) {
  const p = await (await b.newContext({ viewport: { width: item.w, height: item.h }, deviceScaleFactor: 1 })).newPage();
  await p.route('http://localhost:8840/__update.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">' + css + item.html }));
  await p.goto('http://localhost:8840/__update.html', { waitUntil: 'networkidle' });
  const ready = await p.evaluate(async () => {
    const faces = ["700 60px 'IBM Plex Sans Arabic'", "600 30px 'IBM Plex Sans Arabic'", "400 30px 'IBM Plex Sans Arabic'"];
    for (const f of faces) { for (let i = 0; i < 3; i++) { try { await document.fonts.load(f, 'سُنّتي'); break; } catch (e) { await new Promise((r) => setTimeout(r, 300)); } } }
    await document.fonts.ready;
    return faces.every((f) => document.fonts.check(f, 'سُنّتي'));
  });
  if (!ready) throw new Error('font not loaded for ' + item.file);
  const overflow = await p.evaluate(() => { const pn = document.querySelector('.panel').getBoundingClientRect(); return pn.bottom > window.innerHeight - 110 ? Math.round(pn.bottom) : 0; });
  if (overflow) console.log('  note: the panel reaches', overflow, 'in', item.file);
  await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/' + item.file + '.png' });
  console.log('drew', item.file);
  await p.close();
}
await b.close();
