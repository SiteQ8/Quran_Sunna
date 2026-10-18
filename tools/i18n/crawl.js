#!/usr/bin/env node
/* Opens the app in a language and goes wherever a reader can, listing every
   piece of Arabic still on the screen that is not the Quran, a hadith or a
   remembrance, and every line it hands the phone to speak, notify or share.

     node tools/i18n/crawl.js en           the English table as it stands
     node tools/i18n/crawl.js en --probe   every line of the catalog marked as
                                           known, to find the lines it lacks
     --out <file>                          where the list is written (JSON)

   Each screen is opened at several hours and in the browser and in the app,
   and every control on it that does not delete anything is pressed. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { JSDOM } = (function () {
  for (const where of ['jsdom', '/tmp/node_modules/jsdom']) {
    try { return require(where); } catch (e) { /* the next */ }
  }
  throw new Error('jsdom is missing: run  npm install jsdom');
}());

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const lang = process.argv[2] || 'en';
const probe = process.argv.indexOf('--probe') !== -1;
const outAt = process.argv.indexOf('--out');
const OUT = outAt !== -1 ? process.argv[outAt + 1] : null;

const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/* what stays Arabic, read from the engine itself so the two never differ */
const SACRED = /var SACRED = '([^']+)'/.exec(fs.readFileSync(path.join(DOCS, 'js', 'i18n.js'), 'utf8'))[1];
const KEEP = '[translate="no"],script,style,textarea,noscript,' + SACRED;
const ATTRS = ['aria-label', 'title', 'alt', 'placeholder', 'aria-valuetext', 'aria-roledescription'];

/* the page's own order, read from it so this never drifts from it */
const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const SCRIPTS = ['js/i18n.js'].concat((html.match(/<script src="((?:data|js)\/[^"]+)"><\/script>/g) || [])
  .map(function (t) { return /src="([^"]+)"/.exec(t)[1]; })
  .filter(function (s) { return s !== 'js/boot.js' && s !== 'js/i18n.js'; }));
const VIEWS = (html.match(/<section class="view[^"]*" id="v-([a-z-]+)"/g) || [])
  .map(function (t) { return /id="v-([a-z-]+)"/.exec(t)[1]; });

const mushaf = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'mushaf.json'), 'utf8'));

function table() {
  if (!probe) {
    const file = path.join(DOCS, 'i18n', lang + '.js');
    return fs.existsSync(file) ? { file: file } : { entries: {} };
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
  const entries = {};
  catalog.forEach(function (e) {
    if (e.kind === 'pattern') {
      const places = (e.key.match(/\{#?\d+\}/g) || []).map(function (p) { return p.replace('#', ''); });
      entries[e.key] = '✓' + places.join('✓') + '✓';
    } else entries[e.key] = '✓';
  });
  return { entries: entries };
}
const TABLE = table();

/* The Quran and the Sunnah handed out, whole or cut into a picture's lines,
   are meant to stay Arabic: they are known by being part of a sacred text the
   data holds, or by the vowel marks only the sacred texts carry. */
const SACRED_TEXT = (function () {
  const box = vm.createContext({});
  ['surahs', 'azkar', 'hisn', 'duas', 'content', 'extras', 'adhan'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, 'data', f + '.js'), 'utf8'), box);
  });
  const all = [];
  const take = function (v) { if (typeof v === 'string') all.push(v); };
  Object.keys(box.AZKAR_DB).forEach(function (k) { box.AZKAR_DB[k].items.forEach(function (i) { take(i.t); }); });
  box.HISN.forEach(function (c) { c.i.forEach(function (i) { take(i.t); take(i.n); }); });
  box.DUA_BOOK.forEach(function (t) { t.i.forEach(take); });
  box.DUAS.forEach(function (g) { g.items.forEach(function (d) { take(d.t); }); });
  box.HADITHS.forEach(function (h) { take(h.t); });
  box.RUQYAH.forEach(function (r) { take(r.t); });
  box.N99.forEach(take);
  box.SEERAH_QUOTES.forEach(take);
  return all.join('\n');
}());
function sacredText(text) {
  if ((text.match(/[\u064B-\u0652]/g) || []).length > 3) return true;
  const bare = text.replace(/\s*sunnati\.3li\.info$/, '').trim();
  return bare.length > 1 && SACRED_TEXT.indexOf(bare) !== -1;
}

const found = new Map();
let where = '';
function seen(text, kind, el) {
  const key = String(text).replace(/[ \t\n\r\f]+/g, ' ').trim();
  if (!key || !AR.test(key)) return;
  if (kind !== 'text' && kind !== 'attr' && sacredText(key)) return;
  let e = found.get(key);
  if (!e) { e = { text: key, kind: kind, where: [], in: [] }; found.set(key, e); }
  if (e.where.length < 4 && e.where.indexOf(where) === -1) e.where.push(where);
  if (el && e.in.length < 3) {
    const chain = [];
    for (let x = el, i = 0; x && x.nodeType === 1 && i < 3; x = x.parentElement, i++) {
      chain.push(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (typeof x.className === 'string' && x.className ? '.' + x.className.trim().split(/\s+/).join('.') : ''));
    }
    const c = chain.join(' < ');
    if (e.in.indexOf(c) === -1) e.in.push(c);
  }
}

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

/* what never reaches the page is heard here: the phone's speech, the
   notifications, the share sheet, the clipboard, the pictures drawn */
function sinks(win, withApp) {
  win.SpeechSynthesisUtterance = function (text) { seen(text, 'speech'); this.text = text; };
  win.speechSynthesis = { speak() {}, cancel() {}, getVoices() { return [{ name: 'x', lang: 'en-US', localService: true }]; }, addEventListener() {} };
  win.Notification = function (title, opts) { seen(title, 'notify'); if (opts) seen(opts.body, 'notify'); };
  win.Notification.permission = 'granted';
  win.Notification.requestPermission = function () { return Promise.resolve('granted'); };
  Object.defineProperty(win.navigator, 'share', { value: function (d) { if (d) { seen(d.title, 'share'); String(d.text || '').split('\n').forEach(function (l) { seen(l, 'share'); }); } return Promise.resolve(); }, configurable: true });
  Object.defineProperty(win.navigator, 'canShare', { value: function () { return true; }, configurable: true });
  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: function (t) { String(t).split('\n').forEach(function (l) { seen(l, 'copy'); }); return Promise.resolve(); } }, configurable: true });
  win.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({
      fillText: function (t) { seen(t, 'picture'); },
      measureText: function (t) { return { width: String(t).length * 9, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 }; },
      createLinearGradient: function () { return { addColorStop() {} }; },
      createRadialGradient: function () { return { addColorStop() {} }; },
      createPattern: function () { return {}; },
      getImageData: function () { return { data: new Uint8ClampedArray(4) }; }
    }, { get: function (t, k) { return k in t ? t[k] : function () {}; }, set: function () { return true; } });
  };
  win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
  win.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new win.Blob([''], { type: 'image/png' })); };
  if (!withApp) return;
  const record = function () { Array.prototype.forEach.call(arguments, function (a) {
    if (typeof a !== 'string') return;
    if (/^[\[{]/.test(a)) { try { JSON.stringify(JSON.parse(a), function (k, v) { if (typeof v === 'string') seen(v, 'app'); return v; }); } catch (e) { /* not json */ } return; }
    seen(a, 'app');
  }); return true; };
  /* the prayers' names and the city go to the app as they are: it writes
     its own notifications and greeting from them, in its own languages */
  const quiet = function () { return true; };
  win.SunnatiApp = new Proxy({
    platform: function () { return 'android'; }, version: function () { return '8.87.82'; },
    isAdhanEnabled: function () { return true; }, canNotify: function () { return true; },
    languages: function () { return lang; }, setPrayerTimes: quiet, setPlace: quiet,
    /* a backup is the reader's own data, written as it is */
    saveFile: quiet
  }, { get: function (t, k) { return k in t ? t[k] : record; } });
}

function boot(opts) {
  const dom = new JSDOM(html, { url: 'https://sunnati.3li.info/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  Object.defineProperty(win, 'localStorage', { value: memoryStorage(Object.assign({ 'sunnati.lang': lang }, opts.storage || {})), configurable: true });
  let fixed = opts.now.getTime();
  const Real = win.Date;
  function Fixed(...args) { return args.length ? new Real(...args) : new Real(fixed); }
  Fixed.prototype = Real.prototype; Fixed.now = () => fixed; Fixed.parse = Real.parse; Fixed.UTC = Real.UTC;
  win.Date = Fixed;
  win.matchMedia = function () { return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }; };
  win.fetch = function (url) {
    if (String(url).indexOf('mushaf.json') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(mushaf) });
    return Promise.reject(new Error('offline'));
  };
  win.Audio = function () { return { play: () => Promise.resolve(), pause() {}, addEventListener() {}, removeEventListener() {}, load() {}, paused: true, src: '' }; };
  win.navigator.vibrate = function () { return true; };
  win.scrollTo = function () {};
  win.HTMLElement.prototype.scrollIntoView = function () {};
  sinks(win, opts.app);
  const ctx = dom.getInternalVMContext();
  SCRIPTS.forEach(function (rel, i) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, rel), 'utf8'), ctx, { filename: rel });
    if (i === 0) {
      if (TABLE.file) vm.runInContext(fs.readFileSync(TABLE.file, 'utf8'), ctx, { filename: 'i18n/' + lang + '.js' });
      else win.I18n.add(Object.keys(TABLE.entries).length ? TABLE.entries : { '\u200B': '' });
    }
  });
  win.Mushaf.init(mushaf);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  return { dom: dom, win: win, doc: win.document };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

function collect(doc) {
  const walker = doc.createTreeWalker(doc.documentElement, 5, {
    acceptNode: function (n) {
      if (n.nodeType === 3) return 1;
      if (n.matches(KEEP)) return 2;
      ATTRS.forEach(function (a) { const v = n.getAttribute(a); if (v) seen(v, 'attr', n); });
      return 3;
    }
  });
  let n;
  while ((n = walker.nextNode())) seen(n.data, 'text', n.parentElement);
}

/* never pressed: what deletes, what reloads, what leaves the page */
const NEVER = /clear|delete|remove|reset-now|restart-now|import|refresh|offline-cache|data-file|locate|send-feedback|rate-app/;

function clickable(doc, root) {
  return Array.prototype.slice.call(root.querySelectorAll(
    '[data-act],[data-browse],[data-scope],[role="tab"],.picker-btn,[data-fold],.fold-head,[data-hisn],[data-azkar],' +
    '[data-dua-theme],[data-umrah],[data-umrah-step],[data-umrah-fold],[data-station],[data-sleep],[data-check],' +
    '[data-day],[data-day-prayer],[data-mark-prayer],[data-khatma],[data-suggest],[data-phrase],[data-sunnah-day],[data-time],' +
    'button.row,button.btn,.chip,button.switch'))
    .filter(function (el) {
      const name = (el.getAttribute('data-act') || '') + ' ' + (el.id || '');
      return !NEVER.test(name);
    });
}

async function press(env, el, label) {
  const { win, doc } = env;
  where = label;
  try { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); } catch (e) { /* a broken control is a test's business */ }
  await tick(5);
  collect(doc);
  const sheet = doc.getElementById('sheet');
  if (sheet && sheet.classList.contains('is-open')) {
    /* one level into a sheet, then shut it */
    const inner = clickable(doc, doc.getElementById('sheet-body')).slice(0, 25);
    for (const b of inner) {
      if (!doc.body.contains(b)) continue;
      where = label + ' > ' + (b.getAttribute('data-act') || b.className || b.tagName);
      try { b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); } catch (e) { /* on */ }
      await tick(3);
      collect(doc);
    }
    const close = doc.getElementById('sheet-close');
    if (close) close.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  }
  const panel = doc.querySelector('.picker-panel');
  if (panel) { collect(doc); const veil = doc.querySelector('.picker-veil'); if (veil) veil.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
  const tour = doc.getElementById('tour');
  if (tour && !tour.hidden) {
    for (let i = 0; i < 12 && !tour.hidden; i++) { const next = doc.getElementById('tour-next'); if (next) next.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await tick(5); collect(doc); }
  }
  await tick(2);
}

async function visit(env, view, scenario) {
  const { win, doc } = env;
  where = scenario + ' ' + view;
  try { win.App.go(view); } catch (e) { return; }
  await tick(10);
  collect(doc);
  const host = doc.getElementById('v-' + view);
  if (!host) return;
  const list = clickable(doc, host);
  const limit = Math.min(list.length, 90);
  for (let i = 0; i < limit; i++) {
    const el = list[i];
    if (!doc.body.contains(el)) continue;
    await press(env, el, scenario + ' ' + view + ' ' + (el.getAttribute('data-act') || el.getAttribute('data-hisn') || el.id || el.className || el.tagName));
    if (win.App.state.view !== view) { try { win.App.go(view); } catch (e) { /* on */ } await tick(5); }
  }
}

const SCENARIOS = [
  { name: 'web-morning', now: new Date(2026, 9, 14, 9, 30), app: false, storage: {} },
  { name: 'app-friday-night', now: new Date(2026, 9, 15, 21, 15), app: true,
    storage: { 'sunnati.settings': JSON.stringify({ notify: true, jumuahNight: true, morningAdhkar: true, sleepMulk: true, qiyam: true, duha: true, wirdAt: '20:00', salawat: 60, lat: 21.42, lng: 39.82, city: 'مكة المكرمة', tzOffset: 3, zone: 'Asia/Riyadh' }) } },
  { name: 'web-ramadan-evening', now: new Date(2027, 1, 20, 18, 5), app: false, storage: {} },
  { name: 'app-dawn', now: new Date(2026, 9, 16, 4, 40), app: true, storage: {} }
];

(async function main() {
  for (const s of SCENARIOS) {
    let env;
    where = s.name + ' boot';
    try { env = boot(s); } catch (e) { console.error(s.name, 'did not boot:', e.message); continue; }
    await tick(30);
    collect(env.doc);
    for (const v of VIEWS) await visit(env, v, s.name);
    try { env.win.close(); } catch (e) { /* gone */ }
  }
  const list = Array.from(found.values()).sort(function (a, b) { return a.where[0].localeCompare(b.where[0]); });
  const out = JSON.stringify(list, null, 1) + '\n';
  if (OUT) fs.writeFileSync(OUT, out);
  else process.stdout.write(out);
  console.error(list.length + ' lines with Arabic left on screen or handed out');
  process.exit(0);
})();
