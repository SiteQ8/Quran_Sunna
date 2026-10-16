/* The opening greets in full on the first opening of the reader's day and
   leaves as soon as the home is drawn on any later opening that day, in the
   page and in the android package alike, and the page is booted as
   interface.test.js boots it, inside jsdom with every script it loads, with
   one store kept across openings and the date held where each test puts it. */
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

const DOCS = path.join(__dirname, '..', 'docs');
const SCRIPTS = [
  'js/i18n.js', 'data/surahs.js', 'data/azkar.js', 'data/hisn.js', 'data/ojeiri.js', 'data/marks.js', 'data/adhan.js', 'data/umrah.js', 'data/dua-themes.js', 'data/duas.js', 'data/content.js', 'data/extras.js',
  'js/prayer-engine.js', 'js/hijri.js', 'js/store.js', 'js/mushaf.js', 'js/app.js'
];
const APP = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
const mushafPayload = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'mushaf.json'), 'utf8'));

function memoryStorage() {
  const map = {};
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

/* as in interface.test.js: a store handed in outlives the window, so the same
   phone can be opened again, and a date handed in is the one the page sees */
function boot(options) {
  const opts = options || {};
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://siteq8.github.io/Quran_Sunna/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;
  Object.defineProperty(win, 'localStorage', { value: opts.storage || memoryStorage(), configurable: true });
  if (opts.now) {
    const fixed = opts.now.getTime();
    const Real = win.Date;
    function Fixed(...args) { return args.length ? new Real(...args) : new Real(fixed); }
    Fixed.prototype = Real.prototype;
    Fixed.now = () => fixed;
    Fixed.parse = Real.parse;
    Fixed.UTC = Real.UTC;
    win.Date = Fixed;
  }
  win.matchMedia = win.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  win.fetch = function (url) {
    if (String(url).indexOf('mushaf.json') !== -1) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mushafPayload) });
    }
    return Promise.reject(new Error('offline in tests'));
  };
  win.Audio = function () {
    return { play: () => Promise.resolve(), pause() { this.paused = true; }, paused: false, src: '' };
  };
  win.navigator.vibrate = function () { return true; };
  win.scrollTo = function () {};
  if (opts.bridge) win.SunnatiApp = opts.bridge;
  SCRIPTS.forEach(function (rel) {
    const code = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    vm.runInContext(code, dom.getInternalVMContext(), { filename: rel });
  });
  win.Mushaf.init(mushafPayload);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  opened.push(dom);
  return { dom, win, doc: win.document };
}

function wait(ms) { return new Promise(function (done) { setTimeout(done, ms); }); }

/* a splash still standing and not yet fading */
function standing(doc) {
  const s = doc.getElementById('boot-splash');
  return !!s && s.style.opacity !== '0';
}

/* the morning, the evening and the next morning of the same phone */
const MORNING = new Date(2026, 9, 13, 7, 10, 0);
const EVENING = new Date(2026, 9, 13, 21, 40, 0);
const LATE = new Date(2026, 9, 13, 23, 59, 30);
const NEXT = new Date(2026, 9, 14, 0, 0, 30);

test('the day\'s first opening greets in full, a later one that day briefly, and the next day in full again', async () => {
  const phone = memoryStorage();

  const first = boot({ storage: phone, now: MORNING });
  assert.strictEqual(first.win.App.helpers.openingState.full, true, 'the first opening of the day');
  await wait(900);
  if (first.win.performance.now() < 3200) {
    assert.ok(standing(first.doc), 'still greeting while the full floor runs');
  }
  assert.strictEqual(phone.getItem('sunnati.greeted'), '2026-10-13', 'and the day is kept');

  const again = boot({ storage: phone, now: EVENING });
  assert.strictEqual(again.win.App.helpers.openingState.full, false, 'opened again the same day');
  await wait(900);
  assert.strictEqual(again.doc.getElementById('boot-splash'), null,
    'gone as soon as the home is drawn, after a floor of 450ms and a fade of 250ms');

  const tomorrow = boot({ storage: phone, now: NEXT });
  assert.strictEqual(tomorrow.win.App.helpers.openingState.full, true, 'a new day greets in full again');
  await wait(900);
  if (tomorrow.win.performance.now() < 3200) {
    assert.ok(standing(tomorrow.doc), 'held for the full greeting');
  }
  assert.strictEqual(phone.getItem('sunnati.greeted'), '2026-10-14');
});

test('a day is the phone\'s own calendar day, and midnight starts a new one', () => {
  const phone = memoryStorage();
  boot({ storage: phone, now: LATE });
  /* a minute before midnight and the same day again */
  assert.strictEqual(boot({ storage: phone, now: new Date(2026, 9, 13, 23, 59, 50) }).win.App.helpers.openingState.full, false);
  /* half a minute after midnight is the next day */
  assert.strictEqual(boot({ storage: phone, now: NEXT }).win.App.helpers.openingState.full, true);
});

test('a later opening fades faster, and the full one keeps its floor and its fade', () => {
  const fn = /function dismissBootSplash\(atOnce\) \{([\s\S]*?)\n  \}\n/.exec(APP)[1];
  assert.ok(fn.indexOf('var floor = full ? 3200 : 450;') !== -1, 'the full floor on the day\'s first opening, a brief one after');
  assert.ok(fn.indexOf("if (!full) splash.style.transition = 'opacity .22s ease';") !== -1, 'a shorter fade on a later one');
  assert.ok(fn.indexOf('}, full ? 420 : 250);') !== -1, 'and taken away when that fade ends');
  assert.ok(fn.indexOf('floor - since') !== -1, 'a floor and not a length, measured from when the page began loading');
});

test('the day is read before this opening writes anything of its own', () => {
  const body = /function boot\(\) \{([\s\S]*?)\n  \}\n/.exec(APP)[1];
  const read = body.indexOf('opening.full = firstOpenToday();');
  assert.ok(read !== -1, 'boot asks once');
  ['Store.attach();', 'countDay();', 'Store.migrate();'].forEach(function (later) {
    assert.ok(body.indexOf(later) > read, 'before ' + later);
  });
  assert.ok(body.indexOf('tour.returning = cameBefore();') < read,
    'and after the question of whether the app was opened before, which the day\'s key would answer');
  /* a store that cannot be read greets in full rather than not at all */
  const { win } = boot();
  Object.defineProperty(win, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
  assert.strictEqual(win.App.helpers.firstOpenToday(), true);
});

test('clearing every piece of data greets in full again', () => {
  const phone = memoryStorage();
  boot({ storage: phone, now: MORNING });
  assert.strictEqual(boot({ storage: phone, now: EVENING }).win.App.helpers.openingState.full, false);
  const { win } = boot({ storage: phone, now: EVENING });
  win.Store.clearAll();
  assert.strictEqual(phone.getItem('sunnati.greeted'), null, '«حذف كل البيانات» takes the day with the rest');
  assert.strictEqual(boot({ storage: phone, now: EVENING }).win.App.helpers.openingState.full, true);
});

test('on an iPhone the page\'s own opening keeps the same rule, since the wrapper draws none of its own', async () => {
  const ios = fs.readFileSync(path.join(__dirname, '..', 'ios/Sunnati/ReaderController.swift'), 'utf8');
  const code = ios.replace(/\/\*[\s\S]*?\*\//g, '');
  /* the wrapper adds the web view and nothing over it, and answers no pageReady */
  assert.strictEqual((code.match(/addSubview\(/g) || []).length, 1, 'one view, the page');
  assert.ok(code.indexOf('pageReady') === -1, 'and nothing to hold an opening of its own');

  const phone = memoryStorage();
  const bridge = { platform: function () { return 'ios'; }, version: function () { return '2.0'; } };
  const first = boot({ storage: phone, now: MORNING, bridge: bridge });
  assert.strictEqual(first.win.App.helpers.appDrawsSplash(), false);
  assert.strictEqual(first.win.App.helpers.openingState.full, true);
  const again = boot({ storage: phone, now: EVENING, bridge: bridge });
  assert.strictEqual(again.win.App.helpers.openingState.full, false);
  await wait(900);
  assert.strictEqual(again.doc.getElementById('boot-splash'), null, 'brief on an iPhone too');
});

test('the android package decides for itself, before the page exists, by the same day', () => {
  /* the full hold stays as the phone was tuned to it, and a brief floor after */
  assert.ok(/private static final long SPLASH_HOLD_MS = 3200;/.test(MAIN));
  assert.ok(/private static final long SPLASH_BRIEF_MS = 450;/.test(MAIN));
  /* chosen as the splash is made in onCreate, before the page is asked for */
  const create = /protected void onCreate\(Bundle savedInstanceState\) \{([\s\S]*?)\n    \}\n/.exec(MAIN)[1];
  const chosen = create.indexOf('splashHold = firstOpenToday() ? SPLASH_HOLD_MS : SPLASH_BRIEF_MS;');
  assert.ok(chosen !== -1, 'the hold of this opening');
  assert.ok(create.indexOf('splash = new SplashView(this);') < chosen && chosen < create.indexOf('web.loadUrl('),
    'with the splash, before the page');
  /* the phone's own calendar day, kept in the app's own store */
  const day = /private boolean firstOpenToday\(\) \{([\s\S]*?)\n    \}\n/.exec(MAIN)[1];
  assert.ok(day.indexOf('java.time.LocalDate.now().toString()') !== -1, 'the local day, as 2026-10-13');
  assert.ok(day.indexOf('getSharedPreferences(SplashView.PREFS, Context.MODE_PRIVATE)') !== -1);
  assert.ok(day.indexOf('if (today.equals(kept.getString(KEY_GREETED, ""))) return false;') !== -1, 'a day already greeted');
  assert.ok(day.indexOf('kept.edit().putString(KEY_GREETED, today).apply();') !== -1, 'written as it is read');
  /* it still waits for the page, and still never outstays its welcome */
  const dismiss = /void dismissSplash\(\) \{([\s\S]*?)\n    \}\n/.exec(MAIN)[1];
  assert.ok(dismiss.indexOf('if (shown < splashHold && root != null) {') !== -1);
  assert.ok(dismiss.indexOf('}, splashHold - shown);') !== -1);
  assert.ok(dismiss.indexOf('setDuration(splashHold == SPLASH_HOLD_MS ? 420 : 250)') !== -1, 'and fades faster after the first');
  assert.ok(/postDelayed\(new Runnable\(\) \{\s*@Override public void run\(\) \{ dismissSplash\(\); \}\s*\}, 4000\);/.test(create),
    'the ceiling for a page that never says it is ready');
  /* the page tells the package it is ready at the same moment as before */
  assert.ok(APP.indexOf('if (app && app.pageReady) { try { app.pageReady(); } catch (e) { /* older package */ } }') !== -1);
});

test('inside the android package the page takes its own opening away at once, whatever the day', () => {
  let readied = 0;
  const phone = memoryStorage();
  const bridge = { pageReady: function () { readied++; } };
  [MORNING, EVENING].forEach(function (when) {
    const { doc } = boot({ storage: phone, now: when, bridge: bridge });
    assert.strictEqual(doc.getElementById('boot-splash'), null, 'the package draws the only opening');
  });
  assert.strictEqual(readied, 2, 'and is told each time the page has painted');
});

test('the walkthrough still waits until the opening has gone', async () => {
  /* it is looked for 4000ms after the page began loading, which is after the
     full opening, 3200 and a fade of 420, and long after a brief one */
  assert.ok(APP.indexOf('window.setTimeout(maybeStartTour, Math.max(400, 4000 - since));') !== -1);
  assert.ok(3200 + 420 < 4000 && 450 + 250 < 4000);
  /* a reader who never opened the app is always on a day's first opening, so
     the walkthrough follows the full greeting, and it is not offered over it */
  const fresh = boot({ now: MORNING });
  assert.strictEqual(fresh.win.App.helpers.openingState.full, true);
  assert.strictEqual(fresh.win.App.helpers.maybeStartTour(), false, 'not while the opening is up');
  fresh.win.App.helpers.dismissBootSplash(true);
  assert.strictEqual(fresh.win.App.helpers.maybeStartTour(), 'first', 'and once it has gone, it starts');
  /* a later opening of the day belongs to a reader who has opened the app
     before, who is not walked through it again */
  const phone = memoryStorage();
  boot({ storage: phone, now: MORNING });
  const later = boot({ storage: phone, now: EVENING });
  assert.strictEqual(later.win.App.helpers.openingState.full, false);
  await wait(900);
  assert.strictEqual(later.doc.getElementById('boot-splash'), null);
  assert.strictEqual(later.win.App.helpers.maybeStartTour(), false);
});
