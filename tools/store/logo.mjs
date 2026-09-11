/* The mark, and everything drawn from it.
 *
 * What it is: a sadu diamond with the crescent taken out of it. السدو is the
 * bedouin weave, and the serrated diamond is its own shape, so the app is not
 * another mosque silhouette on a green field. One diamond, one crescent, two
 * shapes: the mark before this had four nested diamonds, two woven bands, two
 * gold rules and a crescent sixty units wide inside five hundred and twelve,
 * which on a phone at forty eight pixels was a red blob.
 *
 * Why one tool: the geometry used to live in logo.py while the launcher, the
 * status bar silhouette and the themed icon were each drawn by hand somewhere
 * else, so they could drift apart and nothing would say. Every one of them is
 * now computed here from the same numbers.
 *
 *   node tools/store/logo.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const RED = '#8f2323';
const CREAM = '#f3e9d2';

/* ---------- geometry, on a 512 square ---------- */

/** A diamond with a sawtooth on each side, every tooth pointing away from the
 *  centre. The tooth is what makes it read as a weave and not as a rhombus. */
function sadu(cx, cy, r, teeth, depth) {
  const corner = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corner[i];
    const [bx, by] = corner[(i + 1) % 4];
    for (let t = 0; t < teeth; t++) {
      const t0 = t / teeth;
      const tm = (t + 0.5) / teeth;
      pts.push([ax + (bx - ax) * t0, ay + (by - ay) * t0]);
      const mx = ax + (bx - ax) * tm;
      const my = ay + (by - ay) * tm;
      const ux = mx - cx;
      const uy = my - cy;
      const len = Math.hypot(ux, uy) || 1;
      pts.push([mx + (ux / len) * depth, my + (uy / len) * depth]);
    }
  }
  return 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') + ' Z';
}

/** A circle with a larger circle taken out of it. The larger the bite the
 *  thinner the crescent; the lean tilts where the opening faces. */
function crescent(cx, cy, r, cut = 1.30, lean = 0.34) {
  const dx = r * lean;
  const dy = r * 1.70;
  const x0 = cx - dx / 2;
  const y0 = cy - dy / 2;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} a${r} ${r} 0 1 0 ${dx.toFixed(1)} ${dy.toFixed(1)} ` +
    `a${(r * cut).toFixed(1)} ${(r * cut).toFixed(1)} 0 0 1 ${(-dx).toFixed(1)} ${(-dy).toFixed(1)} Z`;
}

/* The drawing is proportional to its box, so the same numbers make a 512 icon
   and a 24 silhouette. scale is how much of the box the mark fills, which the
   launcher's safe area and the web icon want differently. */
function markPaths(scale = 1, box = 512) {
  const k = box / 512;
  const c = box / 2;
  return {
    weave: sadu(c, c, 186 * scale * k, 6, 26 * scale * k),
    moon: crescent(c + 6 * scale * k, c, 100 * scale * k)
  };
}

function markSvg({ rounded = 112, scale = 1, ground = RED, weave = CREAM, bleed = true } = {}) {
  const p = markPaths(scale);
  if (bleed) {
    /* on a field, the crescent is painted in the field's own colour */
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
      `<rect width="512" height="512" rx="${rounded}" fill="${ground}"/>` +
      `<path d="${p.weave}" fill="${weave}"/><path d="${p.moon}" fill="${ground}"/></svg>`;
  }
  /* on nothing, it has to be a real hole: painting it cream over cream left the
     launcher's front layer as a plain diamond with no moon in it at all */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<path d="${p.weave} ${p.moon}" fill="${weave}" fill-rule="evenodd"/></svg>`;
}

/** The same mark as one silhouette: the weave filled and the crescent cut out
 *  of it by the even-odd rule, for the status bar and the themed home screen
 *  where only one colour is drawn. */
function silhouetteVector(dp, scale) {
  /* Drawn straight onto the 24 grid rather than scaled from the 512 one. A
     blanket number replacement was tried first and it scaled the arc flags of
     the crescent too, turning «0 1 0» into «0.00 0.05 0.00», which no renderer
     accepts: a flag is not a measurement. */
  const p = markPaths(scale, 24);
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Drawn by tools/store/logo.mjs from the same numbers as the launcher icon.
     One colour on a transparent field: the weave is filled and the crescent is
     cut out of it, not painted over it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${dp}dp" android:height="${dp}dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd"
        android:pathData="${p.weave} ${p.moon}"/>
</vector>
`;
}

/* ---------- what gets written ---------- */

const ICONS = 'docs/icons';
const RES = 'android/app/src/main/res';

mkdirSync(ICONS, { recursive: true });

/* the web icon, the maskable one with more room round it, and the mark alone */
writeFileSync(`${ICONS}/icon.svg`, markSvg({}));
writeFileSync(`${ICONS}/maskable.svg`, markSvg({ rounded: 0, scale: 0.76 }));
writeFileSync(`${ICONS}/mark.svg`, markSvg({ bleed: false, scale: 1 }));

/* the silhouettes, which must be the same shape as the icon and used not to be */
writeFileSync(`${RES}/drawable/ic_notification.xml`, silhouetteVector(24, 1));
writeFileSync(`${RES}/drawable/ic_launcher_monochrome.xml`, silhouetteVector(108, 0.66));

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
});

async function raster(svg, size, out, transparent = false) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1
  });
  await page.setContent(
    `<style>html,body{margin:0;height:100%}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    { waitUntil: 'load' });
  await page.screenshot({ path: out, omitBackground: transparent });
  await page.close();
  return out;
}

const icon = markSvg({});
for (const s of [72, 96, 128, 144, 152, 180, 192, 256, 384, 512]) {
  await raster(icon, s, `${ICONS}/icon-${s}.png`);
}
await raster(icon, 1024, `${ICONS}/play-1024.png`);

const maskable = markSvg({ rounded: 0, scale: 0.76 });
for (const s of [192, 512]) await raster(maskable, s, `${ICONS}/maskable-${s}.png`);

/* The launcher foreground: the mark on nothing, inside the safe middle, since
   the gradient behind it is a drawable of its own. 108dp at each density. */
const foreground = markSvg({ bleed: false, scale: 0.66 });
for (const [dir, px] of [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]]) {
  mkdirSync(`${RES}/mipmap-${dir}`, { recursive: true });
  await raster(foreground, px, `${RES}/mipmap-${dir}/ic_launcher_foreground.png`, true);
}

await browser.close();
console.log('the mark and everything drawn from it');
