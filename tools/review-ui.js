#!/usr/bin/env node
/* Walks every screen in a real browser, in both themes, and reports what a
   person would notice: text that spills, controls too small for a thumb, a
   colour too faint to read, a latin word in an arabic interface.

   Needs a browser, which the app itself does not:
     npm install --no-save playwright-core
     npx playwright install chromium
   Then:  node tools/review-ui.js
*/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const PORT = 8899;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'
};

function serve() {
  return http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    var file = path.join(DOCS, rel);
    if (!file.startsWith(DOCS) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT);
}

var chromium;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  console.log('This review needs a browser, which the app itself does not.\n' +
    '  npm install --no-save playwright-core\n' +
    '  npx playwright install chromium\n' +
    'Then run it again.');
  process.exit(0);
}

function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  var roots = ['/opt/pw-browsers', path.join(process.env.HOME || '', '.cache', 'ms-playwright')];
  for (var i = 0; i < roots.length; i++) {
    if (!fs.existsSync(roots[i])) continue;
    var found = fs.readdirSync(roots[i])
      .filter(function (d) { return d.indexOf('chromium') === 0; })
      .map(function (d) { return path.join(roots[i], d, 'chrome-linux', 'chrome'); })
      .filter(fs.existsSync);
    if (found.length) return found[found.length - 1];
  }
  return null;
}

const VIEWS = ['home', 'quran', 'reader', 'search', 'bookmarks', 'khatma', 'azkar',
  'azkar-list', 'tracker', 'more', 'qibla', 'tasbih', 'radio', 'hadith', 'dua',
  'ruqyah', 'calendar', 'settings', 'about'];

/* The reading contrast a body of text needs before it stops being readable on
   a phone held at arm's length in daylight. */
const MIN_CONTRAST_BODY = 4.5;
const MIN_CONTRAST_LARGE = 3;

(async function main() {
  const server = serve();
  const exe = browserPath();
  if (!exe) { console.log('No chromium found. Set CHROMIUM_PATH or run npx playwright install chromium.'); server.close(); return; }

  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  let problems = 0;

  for (const theme of ['light', 'dark']) {
    const page = await (await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-KW'
    })).newPage();
    const noise = [];
    page.on('pageerror', (e) => noise.push('page error: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|fonts\.googleapis|ERR_CERT/i.test(m.text()))
        noise.push('console error: ' + m.text().slice(0, 140));
    });

    await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction('window.Mushaf && Mushaf.ready()', { timeout: 40000 });
    await page.evaluate((t) => { Store.set('theme', t); }, theme);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction('window.Mushaf && Mushaf.ready()', { timeout: 40000 });

    console.log('\n=== ' + theme + ' ===');

    for (const view of VIEWS) {
      await page.evaluate((name) => {
        if (name === 'reader') App.state.surah = 2;
        if (name === 'azkar-list') App.state.azkarKey = 'morning';
        if (name === 'search') App.state.query = 'الصابرين';
        App.go(name);
      }, view);
      await page.waitForTimeout(320);

      const found = await page.evaluate(([name, minBody, minLarge]) => {
        const issues = [];
        const root = document.getElementById('v-' + name);
        const width = document.documentElement.clientWidth;

        function channel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
        function parse(rgb) {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(rgb || '');
          return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
        }
        function over(top, bottom) {
          return {
            r: top.r * top.a + bottom.r * (1 - top.a),
            g: top.g * top.a + bottom.g * (1 - top.a),
            b: top.b * top.a + bottom.b * (1 - top.a),
            a: 1
          };
        }
        function luminance(c) {
          if (!c) return null;
          return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
        }
        /* A translucent panel shows what is under it, so the colours are laid
           over one another before the contrast is worked out. Treating a twelve
           percent wash as a solid block reports faults that are not there. */
        function behind(el) {
          const stack = [];
          /* Starts at the element itself, because a button that paints its own
             background is what its label actually sits on. */
          let node = el;
          while (node) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
            node = node.parentElement;
          }
          if (!stack.length) return parse('rgb(255,255,255)');
          let base = stack[stack.length - 1];
          for (let i = stack.length - 2; i >= 0; i--) base = over(stack[i], base);
          return base;
        }

        if (document.documentElement.scrollWidth > width + 1)
          issues.push('the page scrolls sideways by ' +
            (document.documentElement.scrollWidth - width) + 'px');

        root.querySelectorAll('*').forEach((el) => {
          const box = el.getBoundingClientRect();
          if (!box.width && !box.height) return;
          if (box.right > width + 1 || box.left < -1)
            issues.push('spills off the edge: ' + (el.id ? '#' + el.id : el.className));
        });

        /* Only leaf elements carry their own words, so only those are measured. */
        root.querySelectorAll('*').forEach((el) => {
          if (el.children.length) return;
          const text = (el.textContent || '').trim();
          if (text.length < 2) return;
          const box = el.getBoundingClientRect();
          if (!box.width || !box.height) return;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.opacity === '0') return;
          /* Emoji carry their own colours and ignore the text colour entirely. */
          if (/\p{Extended_Pictographic}/u.test(text)) return;
          const own = parse(style.color);
          if (!own) return;
          const under = behind(el);
          const fg = luminance(own.a < 1 ? over(own, under) : own);
          const bg = luminance(under);
          if (fg === null || bg === null) return;
          const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          const size = parseFloat(style.fontSize);
          const large = size >= 24 || (size >= 18.66 && +style.fontWeight >= 700);
          const need = large ? minLarge : minBody;
          if (ratio < need)
            issues.push('too faint to read at ' + ratio.toFixed(1) + ':1, needs ' + need +
              ' :: ' + text.slice(0, 28));
        });

        root.querySelectorAll('button, a, select, input, [role="switch"]').forEach((el) => {
          const box = el.getBoundingClientRect();
          if (!box.width || !box.height) return;
          const x = box.left + box.width / 2, y = box.top + box.height / 2;
          if (y < 0 || y > window.innerHeight) return;
          /* A control may reach past what it draws, so the reach is measured by
             asking what is actually under the finger. */
          /* Probed at exactly twenty two pixels from the middle, which is half of
             the forty four a thumb needs. If the control answers there then its
             reach is wide enough, whatever it draws. */
          const up = document.elementFromPoint(x, Math.max(1, y - 22));
          const side = document.elementFromPoint(Math.max(1, x - 22), y);
          const reach = (up && up.closest('button, a, select, input, [role="switch"]') === el) ||
            (side && side.closest('button, a, select, input, [role="switch"]') === el);
          if (box.height < 44 && !reach)
            issues.push('too small for a thumb, ' + Math.round(box.width) + 'x' +
              Math.round(box.height) + ' :: ' + (el.id ? '#' + el.id : el.className));
          const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title');
          if (!label) issues.push('no name for a screen reader :: ' + (el.id ? '#' + el.id : el.className));
        });

        if (!root.querySelector('h1') && !root.getAttribute('aria-labelledby'))
          issues.push('no heading');

        /* The niche is drawn over the same square as the arc it frames. If the
           two are given different boxes the niche stretches and its legs run
           down past the words, which is only visible once it is rendered. */
        const arc = root.querySelector('.arc');
        const arch = root.querySelector('.mihrab');
        if (arc && arch) {
          const a = arc.getBoundingClientRect(), n = arch.getBoundingClientRect();
          if (Math.abs(a.top - n.top) > 1 || Math.abs(a.height - n.height) > 1) {
            issues.push('the niche and the arc have different boxes: arc ' +
              Math.round(a.width) + 'x' + Math.round(a.height) + ', niche ' +
              Math.round(n.width) + 'x' + Math.round(n.height));
          }
          const line = root.querySelector('.arc-label');
          const count = root.querySelector('.arc-count');
          if (line && count) {
            const l = line.getBoundingClientRect(), c = count.getBoundingClientRect();
            if (l.top < n.top + n.height * 0.3) issues.push('the words sit too high in the niche');
            if (c.bottom > n.bottom + n.height * 0.12) issues.push('the countdown falls out under the niche');
          }
        }

        const prose = root.cloneNode(true);
        prose.querySelectorAll('a').forEach((a) => a.remove());
        const latin = [...new Set((prose.textContent.match(/[A-Za-z]{2,}/g) || []))];
        if (latin.length) issues.push('latin in an arabic interface: ' + latin.slice(0, 6).join(', '));
        /* The app writes every number with one set of figures. A stray figure
           from the other set reads as a leftover from another screen. */
        const stray = (prose.textContent.match(/[\u0660-\u0669]/g) || []);
        if (stray.length) issues.push('two sets of figures on one screen: ' + stray.join(''));

        return issues;
      }, [view, MIN_CONTRAST_BODY, MIN_CONTRAST_LARGE]);

      if (found.length) {
        problems += found.length;
        console.log('  ' + view);
        found.forEach((f) => console.log('      ' + f));
      }
    }

    /* The accent changes six times a day and a reader can pick eight more, and
       every one of them writes text on its own tinted panel. Checking only the
       colour of the hour the review happens to run in would miss the others,
       so each is set in turn and the same panel is measured under it. */
    const hours = await page.evaluate(([minBody]) => {
      function channel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
      function parse(rgb) {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(rgb || '') ||
          /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(rgb || '');
        if (!m) return null;
        const scale = rgb.indexOf('color(') === 0 ? 255 : 1;
        return { r: +m[1] * scale, g: +m[2] * scale, b: +m[3] * scale, a: m[4] === undefined ? 1 : +m[4] };
      }
      function over(t, b) { return { r: t.r*t.a + b.r*(1-t.a), g: t.g*t.a + b.g*(1-t.a), b: t.b*t.a + b.b*(1-t.a), a: 1 }; }
      function lum(c) { return 0.2126*channel(c.r) + 0.7152*channel(c.g) + 0.0722*channel(c.b); }
      function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
      App.go('quran');
      const mark = document.querySelector('#surah-list .row-mark');
      const card = parse(getComputedStyle(mark.closest('.row')).backgroundColor);
      const out = [];
      const keys = ['fajr', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'];
      const chosen = Store.get('accent');
      const tryOne = (label) => {
        const ink = parse(getComputedStyle(mark).color);
        const wash = over(parse(getComputedStyle(mark).backgroundColor), card);
        const r = ratio(ink, wash);
        if (r < minBody) out.push(label + ' writes text on its panel at ' + r.toFixed(2) + ':1');
      };
      Store.set('accent', 'auto');
      keys.forEach((k) => { App.render.home; App.helpers.applyAccent(k); tryOne('the ' + k + ' colour'); });
      Object.keys(App.helpers.palettes).forEach((k) => {
        Store.set('accent', k); App.helpers.applyAccent('dhuhr'); tryOne('the ' + k + ' choice');
      });
      Store.set('accent', chosen); App.helpers.applyAccent('dhuhr');
      return out;
    }, [MIN_CONTRAST_BODY]);
    if (hours.length) {
      problems += hours.length;
      console.log('  across every colour:');
      hours.forEach((h) => console.log('      ' + h));
    }

    if (noise.length) {
      problems += noise.length;
      console.log('  browser complained:');
      noise.forEach((n) => console.log('      ' + n));
    }
    await page.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + (problems ? problems + ' things to look at' : 'nothing to report'));
  process.exit(problems ? 1 : 0);
})();
