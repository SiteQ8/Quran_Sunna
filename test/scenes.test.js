/* The shared cards' foot, and the scene a verse video is made on. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { JSDOM } = (function () {
  for (const where of ['jsdom', '/tmp/node_modules/jsdom']) {
    try { return require(where); } catch (e) { /* try the next */ }
  }
  throw new Error('jsdom is missing: run  npm install jsdom');
}());

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SCRIPTS = [
  'data/surahs.js', 'data/azkar.js', 'data/hisn.js', 'data/ojeiri.js', 'data/marks.js', 'data/adhan.js', 'data/umrah.js', 'data/dua-themes.js', 'data/duas.js', 'data/content.js', 'data/extras.js',
  'js/prayer-engine.js', 'js/hijri.js', 'js/store.js', 'js/mushaf.js', 'js/verse-video.js', 'js/app.js'
];

const mushafPayload = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'mushaf.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function memoryStorage(seed) {
  const map = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    key: (i) => Object.keys(map)[i],
    get length() { return Object.keys(map).length; },
    clear: () => { Object.keys(map).forEach((k) => delete map[k]); }
  };
}

const opened = [];
const { afterEach } = require('node:test');
afterEach(function () {
  while (opened.length) {
    const dom = opened.pop();
    try { dom.window.close(); } catch (e) { /* already gone */ }
  }
});

function boot(options) {
  const opts = options || {};
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://siteq8.github.io/Quran_Sunna/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  Object.defineProperty(win, 'localStorage', { value: opts.storage || memoryStorage(), configurable: true });
  win.matchMedia = win.matchMedia || function () { return { matches: false, addEventListener() {}, removeEventListener() {} }; };
  win.fetch = function (url) {
    if (String(url).indexOf('mushaf.json') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(mushafPayload) });
    return Promise.reject(new Error('offline in tests'));
  };
  win.Audio = function () { return { play: () => Promise.resolve(), pause() { this.paused = true; }, paused: false, src: '' }; };
  win.navigator.vibrate = function () { return true; };
  win.scrollTo = function () {};
  if (opts.before) opts.before(win);
  SCRIPTS.forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, rel), 'utf8'), dom.getInternalVMContext(), { filename: rel });
  });
  win.Mushaf.init(mushafPayload);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  opened.push(dom);
  return { dom, win, doc: win.document };
}

/* A 2d context that does nothing but remember what it was asked to write,
   enough to read a card's foot without a real canvas. */
function recordingCanvas(win) {
  const texts = [];
  win.HTMLCanvasElement.prototype.getContext = function () {
    if (this.__ctx) return this.__ctx;
    const el = this;
    const noop = function () {};
    this.__ctx = new Proxy({ canvas: el }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'fillText') return function (t, x, y) { texts.push({ t: String(t), x: x, y: y, el: el }); };
        if (key === 'measureText') return function (t) { return { width: String(t).length * 14 }; };
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return function () { return { addColorStop: noop }; };
        return noop;
      },
      set(target, key, value) { target[key] = value; return true; }
    });
    return this.__ctx;
  };
  win.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new win.Blob(['card'], { type: 'image/png' })); };
  return texts;
}

/* ---------------- the foot of every shared card ---------------- */

test('every shared card ends with the app\'s mark over the two badges, and none prints an address', () => {
  const app = read('docs/js/app.js');
  [/function textCard\(heading, text, face, source\) \{([\s\S]*?)\n  \}\n/, /function listCard\(heading, items, note\) \{([\s\S]*?)\n  \}\n/,
    /function timesCard\(\) \{([\s\S]*?)\n  \}\n/].forEach(function (re) {
    const body = re.exec(app)[1];
    assert.ok(body.indexOf('cardFoot(ctx, W, H)') !== -1, re.source.slice(9, 20) + ' ends with the shared foot');
    assert.ok(body.indexOf('3li.info') === -1, re.source.slice(9, 20) + ' names no address');
  });
  assert.ok(!/fillText\([^)]*3li\.info/.test(app), 'no card writes the address');
  assert.ok(app.indexOf('function badges()') === -1, 'the older badges went with the line they sat under');
  const foot = /function cardFoot\(ctx, W, H\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(foot.indexOf('video.drawIcon(') !== -1 && foot.indexOf('video.drawBadges(ctx, W / 2, H - 136, 40, marks)') !== -1,
    'drawn by the video module, as under a video');
});

test('the share captions that travel with the files keep their words', () => {
  const app = read('docs/js/app.js');
  assert.ok(app.indexOf("JUMUAH_NIGHT_SUNAN.join('\\n') + '\\n\\nتطبيق سُنّتي · sunnati.3li.info'") !== -1, 'the night of jumuah');
  assert.ok(app.indexOf("rows.join('\\n') + '\\n\\nتطبيق سُنّتي · sunnati.3li.info'") !== -1, 'the sunan of the day');
  assert.ok(/'، العشاء ' \+ clockText\(t\.isha\) \+\n      '\\n\\nsunnati\.3li\.info';/.test(app), 'the times');
});

/* the three cards drawn on a canvas that remembers its words */
async function footOf(make, seed) {
  let marks = null;
  const calls = { icon: [], badges: [] };
  const { win } = boot({ storage: memoryStorage(seed) });
  const texts = recordingCanvas(win);
  win.VerseVideo.storeMarks = function () { marks = { icon: { w: 1 }, apple: { w: 2 }, google: { w: 3 } }; return Promise.resolve(marks); };
  win.VerseVideo.drawIcon = function (ctx, img, x, y, size) { calls.icon.push({ img, x, y, size, el: ctx.canvas }); };
  win.VerseVideo.drawBadges = function (ctx, cx, top, h, imgs) { calls.badges.push({ cx, top, h, imgs, el: ctx.canvas }); return 0; };
  const blob = await make(win);
  assert.ok(blob, 'a picture comes out');
  const el = calls.badges[0] && calls.badges[0].el;
  return { texts: texts.filter((x) => x.el === el), calls, marks, W: el && +el.width, H: el && +el.height };
}

function checkFoot(card, label) {
  const { texts, calls, marks, W, H } = card;
  assert.strictEqual(W, 1080, label);
  assert.strictEqual(calls.badges.length, 1, label + ': the badges once');
  assert.deepStrictEqual([calls.badges[0].cx, calls.badges[0].top, calls.badges[0].h], [540, H - 136, 40], label + ': where the verse card has them');
  assert.strictEqual(calls.badges[0].imgs, marks, label + ': the stores\' own files');
  assert.strictEqual(calls.icon.length, 1, label + ': the icon once');
  assert.deepStrictEqual([calls.icon[0].y, calls.icon[0].size], [H - 180 - 22, 44], label + ': the icon beside the name');
  const name = texts.filter((x) => x.t === 'سُنّتي');
  assert.strictEqual(name.length, 1, label + ': the name once');
  assert.strictEqual(name[0].y, H - 180, label);
  assert.ok(!texts.some((x) => x.t.indexOf('3li.info') !== -1), label + ': no address');
  /* everything else on the card stands above the foot */
  texts.filter((x) => x.t !== 'سُنّتي').forEach(function (x) {
    assert.ok(x.y < H - 230, label + ': «' + x.t.slice(0, 20) + '» at ' + x.y + ' runs into the foot at ' + (H - 202));
  });
}

test('the verse card, the list card and the times card share one foot, drawn as the verse card draws it', async () => {
  checkFoot(await footOf((win) => win.App.helpers.verseCard(13, 28)), 'verse');
  checkFoot(await footOf((win) => win.App.helpers.textCard('دعاء', 'اللهم إني أسألك العفو والعافية', 'naskh', '')), 'dua');
  checkFoot(await footOf((win) => win.App.helpers.listCard('ليلة الجمعة', ['أكثِر من الصلاة على النبي ﷺ', 'اقرأ سورة الكهف'], 'من مغرب الخميس إلى فجر الجمعة')), 'list');
  /* the times without their sky, which jsdom cannot paint */
  checkFoot(await footOf((win) => win.App.helpers.timesCard(), { 'sunnati.settings': JSON.stringify({ sky: false }) }), 'times');
});
