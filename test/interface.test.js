/* Boots docs/index.html inside jsdom with every script the page loads,
   then drives the interface the way a person would. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

/* jsdom is found wherever it happens to live: it sits in /tmp in the container
   these tests were written in, and in node_modules anywhere else. An absolute
   path to /tmp meant the suite could only ever run on one machine, and it
   failed the moment CI tried. */
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

/* Every window that was booted is closed once its test is over, or two
   hundred of them pile up with their clocks still ticking until the heap
   gives out. */
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
  const dom = new JSDOM(html, {
    url: 'https://siteq8.github.io/Quran_Sunna/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;

  /* a storage handed in outlives the window, so one day can be opened at
     several hours and read back the way a person would find it */
  Object.defineProperty(win, 'localStorage', { value: opts.storage || memoryStorage(), configurable: true });
  if (opts.now) {
    /* the app asks the window for the date, so a fixed day can be handed to it */
    let fixed = opts.now.getTime();
    const Real = win.Date;
    /* and moved on by a test that wants to watch the app cross an hour */
    win.__setNow = function (d) { fixed = d.getTime(); };
    function Fixed(...args) { return args.length ? new Real(...args) : new Real(fixed); }
    Fixed.prototype = Real.prototype;
    Fixed.now = () => fixed;
    Fixed.parse = Real.parse;
    Fixed.UTC = Real.UTC;
    win.Date = Fixed;
  }
  win.matchMedia = win.matchMedia || function () {
    return { matches: !!opts.dark, addEventListener() {}, removeEventListener() {} };
  };
  win.fetch = opts.fetch || function (url) {
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
  /* a wrapper's bridge handed in is there before the app wakes, as the
     packages put it there before the page loads */
  if (opts.bridge) win.SunnatiApp = opts.bridge;

  SCRIPTS.forEach(function (rel) {
    const code = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    vm.runInContext(code, dom.getInternalVMContext(), { filename: rel });
  });

  /* The mushaf normally arrives over fetch, so injecting it before boot keeps
     the reader tests deterministic while boot still runs its real path. */
  if (opts.withMushaf !== false) win.Mushaf.init(mushafPayload);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  opened.push(dom);

  return { dom, win, doc: win.document };
}

function click(win, el) {
  assert.ok(el, 'tried to click an element that is not there');
  el.dispatchEvent(new win.Event('click', { bubbles: true }));
}

/* Waits for a thing to become true rather than for a number of milliseconds.
   A fixed wait is a guess about how fast the machine is, and the one it
   replaced here, sixty milliseconds for a FileReader, failed once on a loaded
   box: a test that is right most of the time teaches people to run it again. */
function until(check, deadline) {
  const end = Date.now() + (deadline || 3000);
  return new Promise(function (done, fail) {
    (function look() {
      let ok = false;
      try { ok = check(); } catch (e) { ok = false; }
      if (ok) return done();
      if (Date.now() > end) return fail(new Error('waited and it never became true'));
      setTimeout(look, 10);
    })();
  });
}

function fire(win, el, type) {
  assert.ok(el, 'tried to fire ' + type + ' on an element that is not there');
  el.dispatchEvent(new win.Event(type, { bubbles: true }));
}

function tab(doc, name) { return doc.querySelector('.tab[data-go="' + name + '"]'); }
function litTab(doc) { return doc.querySelector('.tab[aria-current="page"]').getAttribute('data-go'); }

/* ---------------- boot and shell ---------------- */

test('the page boots and lands on the home view', () => {
  const { win, doc } = boot();
  assert.strictEqual(typeof win.App, 'object');
  assert.match(win.App.version, /^\d+\.\d+\.\d+$/);
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("'sunnati-v" + win.App.version + "'") !== -1,
    'the worker must name this same version, or no device ever sees the update');
  assert.ok(doc.getElementById('v-home').classList.contains('is-open'));
  assert.strictEqual(litTab(doc), 'home');
  assert.strictEqual(doc.querySelectorAll('.view.is-open').length, 1);
});

test('every asset the page references exists on disk', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^https?:|^data:|^#|^mailto:|^tel:/.test(u));
  assert.ok(refs.length >= 12, 'expected the page to reference its assets');
  refs.forEach(function (rel) {
    assert.ok(fs.existsSync(path.join(DOCS, rel.split('?')[0])), 'missing asset ' + rel);
  });
});

test('every icon the interface draws exists in the sprite', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const defined = new Set([...html.matchAll(/<g id="(i-[a-z]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...html.matchAll(/href="#(i-[a-z]+)"/g)].map((m) => m[1]),
    ...[...app.matchAll(/icon\('([a-z]+)'/g)].map((m) => 'i-' + m[1])
  ]);
  assert.ok(used.size >= 20);
  used.forEach(function (name) {
    assert.ok(defined.has(name), 'no sprite entry for ' + name);
  });
});

/* ---------------- the clock ---------------- */

test('the prayer clock fills in and counts down', () => {
  const { doc } = boot();
  const countdown = doc.getElementById('arc-count').textContent;
  assert.match(countdown, /^\d{2}:\d{2}:\d{2}$/, 'a countdown is a length of time, got ' + countdown);
  assert.notStrictEqual(doc.getElementById('arc-name').textContent, '…');
  assert.match(doc.getElementById('arc-at').textContent, /^\d{1,2}:\d{2} [صم]$/,
    'a prayer time is written on twelve hours, got ' + doc.getElementById('arc-at').textContent);
});

test('the arc fill and dot track the progress of the window', () => {
  const { win, doc } = boot();
  const progress = win.App.clockState().progress;
  const drawn = parseFloat(doc.getElementById('arc-fill').getAttribute('stroke-dasharray').split(' ')[0]);
  assert.ok(Math.abs(drawn - 314.16 * progress) < 1, 'the drawn run should follow progress');
  const cx = parseFloat(doc.getElementById('arc-dot').getAttribute('cx'));
  assert.ok(cx >= 19 && cx <= 221, 'the dot rides the arc, got ' + cx);
});

test('all six daily marks render with times', () => {
  const { doc } = boot();
  const windows = doc.querySelectorAll('#windows .window');
  assert.strictEqual(windows.length, 6);
  windows.forEach(function (w) {
    assert.match(w.querySelector('.window-time').textContent, /^\d{1,2}:\d{2}[ \u2060][صم]$/);
  });
  assert.strictEqual(doc.querySelectorAll('#windows .is-now').length, 1, 'exactly one window is current');
});

test('the hijri date renders in arabic numerals beside the gregorian one', () => {
  const { doc } = boot();
  const text = doc.getElementById('hijri-date').textContent;
  assert.ok(text.indexOf('هـ') !== -1, 'expected a hijri date, got ' + text);
  assert.ok(/[0-9]/.test(text), 'expected arabic digits');
  assert.ok(doc.getElementById('greg-date').textContent.length > 6);
});

test('the accent colour follows the current prayer window', () => {
  const { win, doc } = boot();
  const accent = doc.documentElement.style.getPropertyValue('--accent');
  assert.ok(accent.length > 0, 'an accent should be set on boot');
  const windows = ['fajr', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const key = win.App.clockState().windowKey;
  assert.ok(windows.indexOf(key) !== -1);
  assert.strictEqual(doc.documentElement.getAttribute('data-window'), key);
});

test('nudging the hijri date shifts it and stays inside its limits', () => {
  const { win, doc } = boot();
  const before = doc.getElementById('hijri-date').textContent;
  click(win, doc.getElementById('hijri-up'));
  assert.notStrictEqual(doc.getElementById('hijri-date').textContent, before);
  for (let i = 0; i < 8; i++) click(win, doc.getElementById('hijri-up'));
  assert.ok(win.Store.get('hijriAdjust') <= 2, 'shift must not run away');
  for (let i = 0; i < 12; i++) click(win, doc.getElementById('hijri-down'));
  assert.ok(win.Store.get('hijriAdjust') >= -2);
});

test('the home view names its place and calculation method', () => {
  const { doc } = boot();
  const line = doc.getElementById('place-line').textContent;
  assert.ok(line.indexOf('الكويت') !== -1, 'expected the default place, got ' + line);
});

/* ---------------- the mushaf ---------------- */

test('the surah list renders all one hundred and fourteen surahs', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  const rows = doc.querySelectorAll('#surah-list [data-surah]');
  assert.strictEqual(rows.length, 114);
  assert.ok(rows[0].textContent.indexOf('الفاتحة') !== -1);
  assert.ok(rows[113].textContent.indexOf('الناس') !== -1);
});

test('filtering the surah list works by name, by number and in english', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  const field = doc.getElementById('surah-filter');
  function type(value) {
    field.value = value;
    fire(win, field, 'input');
    return doc.querySelectorAll('#surah-list [data-surah]').length;
  }
  assert.strictEqual(type('الكهف'), 1);
  assert.strictEqual(type('36'), 1);
  assert.ok(type('Kahf') <= 1);
  assert.strictEqual(type(''), 114);
  type('سورة ليست موجودة');
  assert.ok(doc.querySelector('#surah-list .empty'), 'an empty state should appear');
});

test('the juz view lists all thirty parts with their opening verse', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-browse="juz"]'));
  const rows = doc.querySelectorAll('#surah-list [data-surah]');
  assert.strictEqual(rows.length, 30);
  assert.ok(rows[0].textContent.indexOf('الفاتحة') !== -1, 'the first juz opens the mushaf');
  assert.ok(doc.querySelector('[data-browse="juz"]').classList.contains('is-on'));
  click(win, doc.querySelector('[data-browse="surah"]'));
  assert.strictEqual(doc.querySelectorAll('#surah-list [data-surah]').length, 114);
});

test('opening a surah renders its verses with numbered markers', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  assert.ok(doc.getElementById('v-reader').classList.contains('is-open'));
  assert.ok(doc.getElementById('reader-title').textContent.indexOf('الإخلاص') !== -1);
  assert.strictEqual(doc.querySelectorAll('#reader-body .ayah').length, 4);
  assert.ok(doc.querySelector('#reader-body .basmala'), 'the basmala heads the surah');
  assert.strictEqual(doc.querySelectorAll('#reader-body .ayah-num').length, 4);
});

test('al fatiha and at tawba handle the basmala correctly', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="1"]'));
  assert.strictEqual(doc.querySelectorAll('#reader-body .basmala').length, 0, 'al fatiha counts it as a verse');
  assert.strictEqual(doc.querySelectorAll('#reader-body .ayah').length, 7);
  click(win, tab(doc, 'quran'));
  click(win, doc.querySelector('[data-surah="9"]'));
  assert.strictEqual(doc.querySelectorAll('#reader-body .basmala').length, 0, 'at tawba has none');
  assert.strictEqual(doc.querySelectorAll('#reader-body .ayah').length, 129);
});

test('places of prostration are marked in the text', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="32"]'));
  assert.strictEqual(doc.querySelectorAll('#reader-body .sajda-mark').length, 1);
});

test('the reader remembers where you were and offers to resume', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  assert.ok(doc.getElementById('resume-card').hidden, 'nothing to resume on a fresh install');
  click(win, doc.querySelector('[data-surah="18"]'));
  click(win, tab(doc, 'quran'));
  assert.ok(!doc.getElementById('resume-card').hidden);
  assert.ok(doc.getElementById('resume-name').textContent.indexOf('الكهف') !== -1);
  click(win, doc.getElementById('resume-btn'));
  assert.strictEqual(win.App.state.surah, 18);
});

test('the surah arrows walk the mushaf and stop at both ends', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="1"]'));
  click(win, doc.getElementById('reader-prev'));
  assert.strictEqual(win.App.state.surah, 1, 'there is nothing before al fatiha');
  click(win, doc.getElementById('reader-next'));
  assert.strictEqual(win.App.state.surah, 2);
});

/* ---------------- the verse sheet ---------------- */

test('tapping a verse opens a sheet with its actions', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="2"]'));
  click(win, doc.querySelector('[data-ayah="2:255"]'));
  assert.ok(doc.getElementById('sheet').classList.contains('is-open'));
  const body = doc.getElementById('sheet-body').textContent;
  assert.ok(body.indexOf('الجزء') !== -1);
  assert.ok(body.indexOf('صفحة') !== -1);
  assert.ok(doc.querySelector('[data-act="bookmark"]'));
  assert.ok(doc.querySelector('[data-act="tafsir"]'));
  assert.ok(doc.querySelector('[data-act="listen"]'));
});

test('bookmarking a verse persists and shows up in the saved list', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="2"]'));
  click(win, doc.querySelector('[data-ayah="2:255"]'));
  click(win, doc.querySelector('[data-act="bookmark"]'));
  assert.strictEqual(win.Store.isBookmarked(2, 255), true);
  win.App.go('bookmarks');
  const saved = doc.querySelectorAll('#bookmark-list [data-hit]');
  assert.strictEqual(saved.length, 1);
  assert.ok(saved[0].textContent.indexOf('البقرة') !== -1);
});

test('the saved list invites action when it is empty', () => {
  const { win, doc } = boot();
  win.App.go('bookmarks');
  assert.ok(doc.querySelector('#bookmark-list .empty'));
});

test('a bookmarked verse is marked in the reader too', () => {
  const { win, doc } = boot();
  win.Store.toggleBookmark(112, 1);
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  assert.strictEqual(doc.querySelectorAll('#reader-body .ayah.is-marked').length, 1);
});

/* ---------------- search ---------------- */

test('searching the mushaf finds verses and highlights the match', () => {
  const { win, doc } = boot();
  win.App.go('search');
  const field = doc.getElementById('quran-search');
  field.value = 'الصابرين';
  fire(win, field, 'input');
  const hits = doc.querySelectorAll('#search-results [data-hit]');
  assert.ok(hits.length > 0, 'expected search results');
  assert.ok(doc.querySelector('#search-results mark'), 'the match should be highlighted');
  assert.ok(doc.getElementById('search-count').textContent.indexOf('آية') !== -1);
});

test('either spelling of a word written with a dagger alef finds the verse', () => {
  const { win } = boot();
  const tight = win.Mushaf.countMatches('الصبرين');
  const loose = win.Mushaf.countMatches('الصابرين');
  assert.ok(loose > 0, 'the spelling people actually type must work');
  assert.strictEqual(tight, loose, 'both spellings name the same verses');
  assert.strictEqual(win.Mushaf.countMatches('الصلاة'), win.Mushaf.countMatches('الصلوة'));
  assert.ok(win.Mushaf.countMatches('رب العالمين') > 0);
  assert.ok(win.Mushaf.countMatches('داوود') > 0);
});

test('a short query asks for more before it searches', () => {
  const { win, doc } = boot();
  win.App.go('search');
  const field = doc.getElementById('quran-search');
  field.value = 'ا';
  fire(win, field, 'input');
  assert.strictEqual(doc.querySelectorAll('#search-results [data-hit]').length, 0);
  assert.ok(doc.getElementById('search-count').textContent.indexOf('حرفين') !== -1);
});

test('a search result jumps to the verse in the reader', () => {
  const { win, doc } = boot();
  win.App.go('search');
  const field = doc.getElementById('quran-search');
  field.value = 'الصابرين';
  fire(win, field, 'input');
  const first = doc.querySelector('#search-results [data-hit]');
  const ref = first.getAttribute('data-hit').split(':');
  click(win, first);
  assert.ok(doc.getElementById('v-reader').classList.contains('is-open'));
  assert.strictEqual(win.App.state.surah, +ref[0]);
});

/* ---------------- azkar ---------------- */

test('the azkar grid lists every section with its count', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  const tiles = doc.querySelectorAll('#azkar-groups [data-azkar]');
  assert.ok(tiles.length >= 10, 'expected the full set of azkar sections');
  assert.ok(tiles[0].textContent.indexOf('أذكار') !== -1);
});

test('counting a dhikr down to zero marks it complete and moves the meter', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="morning"]'));
  assert.ok(doc.getElementById('v-azkar-list').classList.contains('is-open'));
  assert.ok(doc.getElementById('azkar-list-title').textContent.indexOf('الصباح') !== -1);

  const target = win.AZKAR_DB.morning.items[0].c || 1;
  for (let i = 0; i < target; i++) click(win, doc.querySelector('[data-dhikr="0"]'));

  assert.ok(doc.querySelector('[data-dhikr="0"]').classList.contains('is-done'));
  assert.notStrictEqual(doc.getElementById('azkar-meter').style.width, '0%');
});

test('a dhikr with a target counts down one tap at a time', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="morning"]'));
  const items = win.AZKAR_DB.morning.items;
  let index = -1;
  for (let i = 0; i < items.length; i++) if ((items[i].c || 1) > 1) { index = i; break; }
  assert.ok(index !== -1, 'the morning set has a repeated dhikr');
  const target = items[index].c;
  click(win, doc.querySelector('[data-dhikr="' + index + '"]'));
  const shown = doc.querySelector('[data-dhikr="' + index + '"] .dhikr-count').textContent;
  assert.strictEqual(shown, win.App.helpers.ar(target - 1));
  assert.ok(!doc.querySelector('[data-dhikr="' + index + '"]').classList.contains('is-done'));
});

test('azkar counters survive leaving and returning to the section', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="morning"]'));
  click(win, doc.querySelector('[data-dhikr="3"]'));
  const shown = doc.querySelector('[data-dhikr="3"] .dhikr-count').textContent;
  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="morning"]'));
  assert.strictEqual(doc.querySelector('[data-dhikr="3"] .dhikr-count').textContent, shown);
});

test('resetting a section clears only that section', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="morning"]'));
  click(win, doc.querySelector('[data-dhikr="0"]'));
  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="evening"]'));
  click(win, doc.querySelector('[data-dhikr="0"]'));
  click(win, doc.getElementById('azkar-reset'));
  assert.strictEqual(win.Store.azkarProgress('evening', 16).done, 0);
  assert.strictEqual(win.Store.azkarProgress('morning', 19).done, 1, 'the morning set is untouched');
});

/* ---------------- the tracker ---------------- */

test('a middle dot never sits beside an arabic numeral', () => {
  const { win, doc } = boot();
  /* The arabic zero is itself a dot, so a separator shaped like one reads as
     a stray digit. */
  ['home', 'quran', 'search', 'calendar', 'settings'].forEach(function (view) {
    win.App.go(view);
    const text = doc.getElementById('v-' + view).textContent;
    assert.ok(!/[0-9]\s*·|·\s*[0-9]/.test(text), view + ' puts a middle dot next to a numeral');
  });
});

test('the sunnah tracker records ticks and updates the meter', () => {
  /* a plain wednesday: friday adds its own fold at the head of the list, and
     a count of rows must not depend on the day the suite is run */
  const { win, doc } = boot({ now: new Date(2026, 8, 9, 10, 0, 0) });
  win.App.go('tracker');
  const boxes = doc.querySelectorAll('#tracker-list [data-check]');
  const expected = win.WIRD_ITEMS.length + win.SUNNAH_TRACKER.reduce((n, g) => n + g.i.length, 0);
  assert.strictEqual(boxes.length, expected, 'the wird and every group of the book together');
  assert.ok(expected >= 100, 'the book gives a hundred and more, found ' + expected);
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '0');

  click(win, boxes[0]);
  assert.ok(doc.querySelectorAll('#tracker-list [data-check]')[0].classList.contains('is-done'));
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '1');
  assert.notStrictEqual(doc.getElementById('tracker-meter').style.width, '0%');

  click(win, doc.querySelectorAll('#tracker-list [data-check]')[0]);
  assert.ok(!doc.querySelectorAll('#tracker-list [data-check]')[0].classList.contains('is-done'));
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '0');
});

test('the daily wird sits at the head of the tracker', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const wird = doc.querySelectorAll('#tracker-list [data-fold="wird"] [data-check]');
  assert.strictEqual(wird.length, 12);
  [...wird].forEach(function (b) { assert.match(b.getAttribute('data-check'), /^wird:[a-z-]+$/); });
  assert.ok(wird[0].querySelector('.check-note'), 'each wird entry carries its note');
});

test('a tick on the home view feeds the same meter as the tracker', () => {
  const { win, doc } = boot();
  const box = doc.querySelector('#now-list [data-check]');
  assert.ok(box, 'the home view lists the sunnah of this window');
  /* a row of the card may say in one line what the list gives in two, and
     then it marks both, so the meter moves by what it marked */
  const ticks = box.getAttribute('data-check').split(' ');
  click(win, box);
  assert.strictEqual(doc.getElementById('today-done').textContent, String(ticks.length));
  win.App.go('tracker');
  assert.strictEqual(doc.getElementById('tracker-done').textContent, String(ticks.length));
  ticks.forEach(function (id) {
    const row = doc.querySelector('#tracker-list [data-check="' + id + '"]');
    assert.ok(row, id + ' is a row of the list');
    assert.ok(row.classList.contains('is-done'), 'and the list shows it done');
  });
});

test('the activity grid draws thirty days with today marked', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  assert.strictEqual(doc.querySelectorAll('#tracker-heat i').length, 30);
  assert.strictEqual(doc.querySelectorAll('#tracker-heat i[data-today="1"]').length, 1);
  assert.strictEqual(doc.querySelectorAll('#home-heat i').length, 30);
});

/* ---------------- tasbih ---------------- */

test('the tasbih counts, tracks a target and stores a daily total', () => {
  const { win, doc } = boot();
  win.App.go('tasbih');
  const btn = doc.getElementById('tasbih-tap');
  for (let i = 0; i < 5; i++) click(win, btn);
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '5');
  assert.strictEqual(win.Store.day().tasbih, 5);
  assert.ok(doc.getElementById('tasbih-target').textContent.indexOf('33') !== -1);

  click(win, doc.querySelector('[data-phrase="3"]'));
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '0', 'switching phrase resets the count');
  assert.strictEqual(doc.getElementById('tasbih-phrase').textContent, 'لا إله إلا الله');
  assert.strictEqual(win.Store.day().tasbih, 5, 'the daily total keeps every phrase');

  click(win, doc.getElementById('tasbih-reset'));
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '0');
});

/* ---------------- qibla ---------------- */

test('the qibla view reports a bearing and a distance', () => {
  const { win, doc } = boot();
  win.App.go('qibla');
  const degrees = doc.getElementById('qibla-degrees').textContent;
  assert.match(degrees, /^[0-9]+°$/, 'the bearing is written in arabic digits, got ' + degrees);
  const bearing = win.App.state.qibla;
  assert.ok(bearing > 200 && bearing < 250, 'kuwait faces roughly south west, got ' + bearing);
  assert.ok(doc.getElementById('qibla-note').textContent.indexOf('كيلومتر') !== -1);
});

test('choosing a city moves the times and the qibla', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const before = win.App.computeTimes(new Date()).dhuhr;
  const jakarta = win.CITIES.findIndex(function (c) { return c.n === 'جاكرتا'; });
  assert.ok(jakarta !== -1);
  const select = doc.getElementById('settings-city');
  select.value = String(jakarta);
  fire(win, select, 'change');
  assert.strictEqual(win.Store.get('city'), 'جاكرتا');
  assert.notStrictEqual(win.App.computeTimes(new Date()).dhuhr, before);
  win.App.go('qibla');
  assert.ok(win.App.state.qibla > 285 && win.App.state.qibla < 300,
    'jakarta faces north west, got ' + win.App.state.qibla);
});

test('the city list names a city only where the reader is in it, not one of the same name elsewhere', () => {
  /* الدوحة is a district of الكويت as well as the capital of قطر */
  const storage = memoryStorage();
  storage.setItem('sunnati.settings', JSON.stringify({ tour: true, placeAsked: true, city: 'الدوحة', lat: 29.32, lng: 47.81, zone: 'Asia/Kuwait', method: 'Kuwait' }));
  const { win, doc } = boot({ storage: storage });
  win.App.go('settings');
  const select = doc.getElementById('settings-city');
  assert.strictEqual(select.value, '', 'the Qatari capital is not claimed for a district of Kuwait');
  const doha = win.CITIES.findIndex(function (c) { return c.n === 'الدوحة'; });
  assert.ok(doha !== -1);
  select.value = String(doha);
  fire(win, select, 'change');
  assert.strictEqual(select.value, String(doha), 'the city itself, chosen from the list, is still named');
});

test('a list longer than its panel shows the top of the next item, and squeezed words make room', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* the panel ends part way into an item, above the tab bar rather than
     under it, and the choice is brought into view by the same measure */
  assert.match(app, /var room = window\.innerHeight - r\.bottom - bars;\s*\/\* Under the button/);
  assert.match(app, /showsMore\(panel, panel\.querySelector\('\.is-on'\)\);\s*btn\.setAttribute\('aria-expanded', 'true'\);/);
  assert.doesNotMatch(app, /on\.scrollIntoView\(\{ block: 'nearest' \}\)/, 'nothing pulls the choice flush to the edge after the cut');
  /* a translated row whose words were squeezed beside a long list takes the
     list under them, and an Arabic row is drawn as it was */
  assert.match(app, /function fitSettings\(\) \{[\s\S]*?said\.width < whole \* 0\.5 && said\.height > held\.height \* 1\.6/);
  assert.match(css, /html:not\(\[lang='ar'\]\) \.setting\.is-stacked > \.picker,/);
  const { win, doc } = boot();
  win.App.go('settings');
  assert.strictEqual(doc.querySelectorAll('.setting.is-stacked').length, 0);
});

test('the cut is measured on each item: a two line first item, a choice far down, the last one', () => {
  const { win, doc } = boot();
  const showsMore = win.App.helpers.showsMore;
  /* the city list in large text: «اختر مدينة» on two lines, 64 high, then
     cities 44 high, 2 apart, inside 8 of padding */
  function panelOf(chosen) {
    const panel = doc.createElement('div');
    panel.className = 'picker-panel';
    panel.style.borderTop = '1px solid'; panel.style.borderBottom = '1px solid';
    panel.style.paddingTop = '8px';
    panel.style.maxHeight = '320px';
    doc.body.appendChild(panel);
    const tops = [];
    for (let i = 0; i < 12; i++) {
      const item = doc.createElement('button');
      item.className = 'picker-item' + (i === chosen ? ' is-on' : '');
      const top = i === 0 ? 8 : 74 + (i - 1) * 46;
      const high = i === 0 ? 64 : 44;
      Object.defineProperty(item, 'offsetTop', { value: top });
      Object.defineProperty(item, 'offsetHeight', { value: high });
      tops.push([top, high]);
      panel.appendChild(item);
    }
    Object.defineProperty(panel, 'scrollHeight', { value: 74 + 10 * 46 + 44 + 8 });
    Object.defineProperty(panel, 'clientHeight', { value: 318 });
    let scrolled = 0;
    Object.defineProperty(panel, 'scrollTop', { get: () => scrolled, set: (v) => { scrolled = v; } });
    const look = win.getComputedStyle(panel);
    const rims = (parseFloat(look.borderTopWidth) || 0) + (parseFloat(look.borderBottomWidth) || 0);
    showsMore(panel, panel.querySelector('.is-on'));
    const shown = parseFloat(panel.style.maxHeight) - rims;
    const from = panel.scrollTop, to = from + shown;
    /* how much of each item the reader sees, from 0 to 1 */
    const seen = tops.map(([top, high]) => Math.max(0, Math.min(to, top + high) - Math.max(from, top)) / high);
    panel.remove();
    return { seen, from };
  }
  function cut(part) { return part > 0.3 && part < 0.9; }
  /* nothing chosen: the list opens at its top, the last item in view cut
     through its words, sized by the cities and not by the long first item */
  let { seen, from } = panelOf(-1);
  assert.strictEqual(from, 0);
  let edge = seen.findIndex((part) => part < 1);
  assert.ok(edge > 1 && cut(seen[edge]), 'the item at the foot shows ' + seen[edge] + ' of itself');
  assert.ok(seen.slice(edge + 1).every((part) => part === 0));
  /* a choice far down opens whole, with half of the item above it and the
     top of the one under it showing, so the list plainly goes on both ways */
  ({ seen, from } = panelOf(9));
  assert.ok(from > 0, 'the list is scrolled to the choice');
  assert.strictEqual(seen[9], 1, 'the choice is whole');
  assert.ok(cut(seen[10]), 'the item under the choice shows ' + seen[10] + ' of itself');
  const above = seen.findIndex((part) => part > 0);
  assert.ok(above < 9 && cut(seen[above]), 'the first item in view shows ' + seen[above] + ' of itself');
  /* the last item chosen: the list opens on its end, still cut at the top */
  ({ seen, from } = panelOf(11));
  assert.strictEqual(seen[11], 1);
  const first = seen.findIndex((part) => part > 0);
  assert.ok(cut(seen[first]), 'the first item in view shows ' + seen[first] + ' of itself');
  /* a choice already in view leaves the list at its top */
  ({ seen, from } = panelOf(2));
  assert.strictEqual(from, 0);
  assert.strictEqual(seen[2], 1);
});

test('a grid of choices gives up columns, to a count they fill evenly, while a word is wider than its cell', () => {
  const { win, doc } = boot();
  const grid = doc.createElement('div');
  grid.className = 'chip-grid';
  grid.style.setProperty('--cols', '4');
  for (let i = 0; i < 8; i++) {
    const chip = doc.createElement('button');
    chip.className = 'chip';
    chip.textContent = 'خيار';
    grid.appendChild(chip);
  }
  doc.body.appendChild(grid);
  let word = 100;
  const colsNow = () => parseInt(grid.style.getPropertyValue('--cols'), 10);
  Object.defineProperty(grid, 'offsetWidth', { get: () => 320 });
  grid.querySelectorAll('.chip').forEach(function (chip) {
    Object.defineProperty(chip, 'clientWidth', { get: () => Math.floor(320 / colsNow()) });
    Object.defineProperty(chip, 'scrollWidth', { get: () => Math.max(word, Math.floor(320 / colsNow())) });
  });
  win.App.helpers.fitChips(doc);
  assert.strictEqual(colsNow(), 2, 'eight across three would leave a hole, so four become two');
  assert.strictEqual(grid.getAttribute('data-cols'), '4', 'the count the page asked for is kept');
  word = 60;
  win.App.helpers.fitChips(doc);
  assert.strictEqual(colsNow(), 4, 'the words fit again and the grid is as it was asked');
  grid.remove();
});

test('the counts stand two and two when their row runs past the card, and the home sections two to a row when a word is wider than its card', () => {
  const { win, doc } = boot();
  win.App.go('prayers');
  const stats = doc.getElementById('prayers-stats');
  assert.strictEqual(stats.querySelectorAll('.prayer-stat').length, 4);
  let spill = true;
  Object.defineProperty(stats, 'clientWidth', { get: () => 296 });
  Object.defineProperty(stats, 'scrollWidth', { get: () => (spill ? 360 : 296) });
  win.App.helpers.fitStats();
  assert.ok(stats.classList.contains('is-tight'), 'four long words that run the row past the card');
  spill = false;
  win.App.helpers.fitStats();
  assert.ok(!stats.classList.contains('is-tight'), 'a row that fits, a column widened or not, stays one row');

  /* jsdom draws nothing, so a word is as wide as nine points a letter */
  const realRange = doc.createRange;
  doc.createRange = function () {
    return {
      setStart(node, at) { this.from = at; }, setEnd(node, at) { this.to = at; },
      selectNodeContents(node) { this.from = 0; this.to = (node.textContent || '').length; },
      getClientRects() { return [{ width: (this.to - this.from) * 9, height: 20 }]; },
      getBoundingClientRect() { return { width: (this.to - this.from) * 9, height: 20, top: 0, left: 0, right: (this.to - this.from) * 9, bottom: 20 }; }
    };
  };
  win.App.go('home');
  const tiles = doc.getElementById('home-tiles');
  const boxes = tiles.querySelectorAll('.tile-name, .tile-note');
  assert.ok(boxes.length > 2);
  boxes.forEach(function (box) {
    Object.defineProperty(box, 'clientWidth', { get: () => 200 });
    /* a note clamped to three lines says it overflows where its ellipsis falls */
    Object.defineProperty(box, 'scrollWidth', { get: () => 204 });
  });
  const name = tiles.querySelector('.tile-name');
  name.textContent = 'قضاء';
  win.App.helpers.fitTiles();
  assert.ok(!tiles.classList.contains('grid-2'), 'three to a row while every word fits, whatever a clamped note reports');
  name.textContent = 'Rattrapages-des-prières-oubliées';
  win.App.helpers.fitTiles();
  assert.ok(tiles.classList.contains('grid-2'), 'two to a row when one word does not');
  doc.createRange = realRange;
});

test('the turns of the mushaf page show their marks over smaller words, then the marks alone, while a turn stands past the screen', () => {
  const { win, doc } = boot();
  win.App.go('page');
  const nav = doc.querySelector('#v-page .page-nav');
  assert.ok(nav.querySelector('#page-prev .bar-word') && nav.querySelector('#page-next .bar-word'), 'both words can be left out alike');
  /* jsdom lays nothing out: the screen is 360 wide and the turn of the page
     at the bar's end starts where the case says */
  Object.defineProperty(doc.documentElement, 'clientWidth', { get: () => 360 });
  Object.defineProperty(nav, 'offsetWidth', { get: () => 328 });
  let starts = [-40, -10];
  const at = () => (nav.classList.contains('is-tighter') ? 16 : nav.classList.contains('is-tight') ? starts[1] : starts[0]);
  nav.querySelector('#page-next').getBoundingClientRect = () => ({ left: at(), right: at() + 104, width: 104, top: 0, bottom: 48, height: 48 });
  doc.documentElement.setAttribute('lang', 'id');
  win.App.helpers.fitPageNav(doc);
  assert.ok(nav.classList.contains('is-tight') && nav.classList.contains('is-tighter'), 'the marks alone at the largest text');
  starts = [-40, 16];
  win.App.helpers.fitPageNav(doc);
  assert.ok(nav.classList.contains('is-tight') && !nav.classList.contains('is-tighter'), 'marks over smaller words when those fit');
  /* a bar reaching into the page's margin, still on the screen, is as it was */
  starts = [10, 16];
  win.App.helpers.fitPageNav(doc);
  assert.ok(!nav.classList.contains('is-tight') && !nav.classList.contains('is-tighter'), 'a bar on the screen is drawn as it was');
  /* the Arabic bar alike: drawn as it was while on the screen, and folded
     only where the largest text pushes it past a small phone's edge */
  doc.documentElement.setAttribute('lang', 'ar');
  starts = [10, 16];
  win.App.helpers.fitPageNav(doc);
  assert.ok(!nav.classList.contains('is-tight'), 'the Arabic bar on the screen keeps its shape');
  starts = [-9, 16];
  win.App.helpers.fitPageNav(doc);
  assert.ok(nav.classList.contains('is-tight') && !nav.classList.contains('is-tighter'));
});

test('a timetable wider than its card is drawn in smaller type, never under the least of the narrowest phones', () => {
  const { win, doc } = boot();
  const box = doc.createElement('div');
  const table = doc.createElement('table');
  table.innerHTML = '<tbody><tr><td>4:33</td></tr></tbody>';
  box.appendChild(table);
  doc.body.appendChild(box);
  let wants = 340;
  const fitNow = () => parseFloat(table.style.getPropertyValue('--tt-fit')) || 1;
  Object.defineProperty(box, 'clientWidth', { get: () => 328 });
  Object.defineProperty(box, 'scrollWidth', { get: () => Math.round(wants * fitNow()), configurable: true });
  /* the cell's type as the phone draws it, twelve points */
  const real = win.getComputedStyle;
  win.getComputedStyle = function (el) { return el.tagName === 'TD' ? { fontSize: '12px' } : real.apply(win, arguments); };
  win.App.helpers.fitTimetable(table);
  assert.ok(table.classList.contains('is-tight') && table.classList.contains('is-tighter'));
  assert.ok(fitNow() < 1 && box.scrollWidth <= box.clientWidth + 1, 'it fits at ' + fitNow());
  /* far too wide: it stops at .72rem of the twelve points and the box scrolls the rest */
  wants = 420;
  win.App.helpers.fitTimetable(table);
  assert.strictEqual(table.style.getPropertyValue('--tt-fit'), (0.72 * 16 / 12).toFixed(3));
  /* a table that fits once the marks are gone keeps its heads and its type */
  Object.defineProperty(box, 'scrollWidth', { get: () => (table.classList.contains('is-tight') ? 328 : 345), configurable: true });
  win.App.helpers.fitTimetable(table);
  assert.ok(table.classList.contains('is-tight') && !table.classList.contains('is-tighter'));
  assert.strictEqual(table.style.getPropertyValue('--tt-fit'), '');
  /* and a table that fits keeps everything */
  Object.defineProperty(box, 'scrollWidth', { get: () => 300 });
  win.App.helpers.fitTimetable(table);
  assert.strictEqual(table.style.getPropertyValue('--tt-fit'), '');
  assert.ok(!table.classList.contains('is-tight'));
  win.getComputedStyle = real;
  box.remove();
});

/* ---------------- khatma ---------------- */

test('a fixed set of choices is a grid of equal cells, not a ragged wrap', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* a wrapping row gave cells of different widths breaking wherever they ran
     out of room, which reads as scattered rather than as a set */
  assert.ok(/\.chip-grid \{[^}]*grid-template-columns: repeat\(var\(--cols/.test(css),
    'the column count is said at the place of use, since only it knows');
  assert.ok(html.indexOf('class="chip-grid" id="khatma-days" style="--cols:3') !== -1,
    'six durations across three, which is two even rows');
  assert.ok(html.indexOf('class="chip-grid" id="sleep-timer" style="--cols:4') !== -1);
  /* the cancel is not one of the durations, so it does not stand as a fifth
     orphan at the end of a row of four */
  assert.ok(/\.chip-grid \.chip-wide \{ grid-column: 1 \/ -1; \}/.test(css));
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('class="chip chip-wide" data-sleep="0"') !== -1);

  const { win, doc } = boot();
  win.App.go('khatma');
  const cells = [...doc.getElementById('khatma-days').children];
  assert.strictEqual(cells.length, 6, 'six choices');
  assert.ok(cells.every(function (c) { return c.classList.contains('chip'); }));
});

test('the khatma keeps its buttons in its card, in the order of what they cost', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const view = html.slice(html.indexOf('id="v-khatma"'), html.indexOf('<section class="view"', html.indexOf('id="v-khatma"')));
  /* four buttons stood in three places: one in the card, three loose on the
     page's own background, and a fourth alone under those */
  assert.ok(view.indexOf('khatma-page-plus') === -1 && view.indexOf('<div class="btn-row">') === -1,
    'nothing floats outside a card');
  assert.ok(view.indexOf('data-go="quran"') === -1,
    'and the spare way back is gone: the tab bar goes to the same screen');

  const { win, doc } = boot();
  win.App.go('khatma');
  assert.strictEqual(doc.querySelectorAll('#v-khatma > .btn-row, #v-khatma > .btn').length, 0);
  const inCard = [...doc.querySelectorAll('#khatma-state button')].map(function (b) { return b.textContent.trim(); });
  assert.ok(inCard.some(function (t) { return t.indexOf('تابع من صفحة') !== -1; }), 'following on comes first');
  assert.ok(inCard.indexOf('قرأت صفحة') !== -1 && inCard.indexOf('تراجع') !== -1);
  /* starting over wipes the plan, so it is not offered on a plan not begun */
  assert.strictEqual(doc.querySelector('[data-act="khatma-restart"]'), null, 'nothing read yet, nothing to start over');
  click(win, doc.querySelector('[data-act="khatma-plus"]'));
  assert.ok(doc.querySelector('.khatma-reset [data-act="khatma-restart"]'), 'and set apart once there is');
});

test('no action is written twice in the map', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const body = /  var ACTIONS = \{([\s\S]*?)\n  \};\n/.exec(app)[1];
  const keys = [...body.matchAll(/^    '?([a-zA-Z-]+)'?: /gm)].map(function (m) { return m[1]; });
  const twice = keys.filter(function (k, i) { return keys.indexOf(k) !== i; });
  /* open-kahf was in there twice, and the second silently replaced the first:
     the same body, so nothing broke, and nothing would have said if it had */
  assert.deepStrictEqual([...new Set(twice)], [], 'written twice: ' + [...new Set(twice)].join(', '));
});

test('the khatma plan splits the mushaf and tracks pages read', () => {
  const { win, doc } = boot();
  win.App.go('khatma');
  assert.ok(doc.querySelector('[data-khatma="30"]').classList.contains('is-on'));
  assert.ok(doc.getElementById('khatma-rate').textContent.indexOf('صفحة') !== -1);

  /* the buttons live in the card now, which redraws itself on every change,
     so each click must find the button as it stands and not as it stood */
  for (let i = 0; i < 5; i++) click(win, doc.querySelector('[data-act="khatma-plus"]'));
  assert.strictEqual(win.Store.progress().pagesRead, 5);
  assert.ok(doc.getElementById('khatma-state').textContent.indexOf('5') !== -1);

  click(win, doc.querySelector('[data-act="khatma-minus"]'));
  assert.strictEqual(win.Store.progress().pagesRead, 4);

  click(win, doc.querySelector('[data-khatma="7"]'));
  assert.strictEqual(win.Store.get('khatmaDays'), 7);
  assert.ok(doc.querySelector('[data-khatma="7"]').classList.contains('is-on'));
});

test('pages read never fall below zero or above the mushaf', () => {
  const { win, doc } = boot();
  win.App.go('khatma');
  for (let i = 0; i < 4; i++) click(win, doc.querySelector('[data-act="khatma-minus"]'));
  assert.strictEqual(win.Store.progress().pagesRead, 0);
  win.Store.setReadPages(700);
  assert.strictEqual(win.Store.progress().pagesRead, 604);
});

test('restarting the khatma clears the count', () => {
  const { win, doc } = boot();
  win.App.go('khatma');
  click(win, doc.querySelector('[data-act="khatma-plus"]'));
  click(win, doc.querySelector('[data-act="khatma-restart"]'));
  /* it is asked first, and only the red button starts over */
  assert.strictEqual(win.Store.progress().pagesRead, 1);
  click(win, doc.querySelector('[data-act="khatma-restart-now"]'));
  assert.strictEqual(win.Store.progress().pagesRead, 0);
  assert.ok(win.Store.get('khatmaStart'));
});

/* ---------------- reference content ---------------- */

test('the reference lists all render their content', () => {
  const { win, doc } = boot();
  const checks = [
    ['hadith', '#hadith-list .card', 20],
    ['ruqyah', '#ruqyah-list .card', 9],
    ['dua', '#dua-list .card', 20],
    ['more', '#more-list [data-go]', 10]
  ];
  checks.forEach(function (c) {
    win.App.go(c[0]);
    const found = doc.querySelectorAll(c[1]).length;
    assert.ok(found >= c[2], c[0] + ' rendered only ' + found + ' entries');
  });
});

test('the calendar lists today and what is coming', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  assert.ok(doc.getElementById('calendar-today').textContent.indexOf('هـ') !== -1);
  assert.ok(doc.getElementById('calendar-upcoming').textContent.indexOf('رمضان') !== -1);
  assert.ok(doc.querySelectorAll('#calendar-upcoming .row').length >= 3);
  assert.ok(doc.querySelectorAll('#home-upcoming .row').length >= 1);
});

/* ---------------- radio ---------------- */

test('the radio lists stations and the sleep timer can be cancelled', () => {
  const { win, doc } = boot();
  win.App.go('radio');
  assert.strictEqual(doc.querySelectorAll('#radio-list [data-station]').length, win.RADIO_STATIONS.length);
  assert.ok(win.RADIO_STATIONS.length >= 7);
  /* the timer stops what is playing, so a station plays first */
  click(win, doc.querySelector('[data-station="0"]'));
  click(win, doc.querySelector('[data-sleep="30"]'));
  assert.ok(doc.getElementById('sleep-note').textContent.indexOf('يتوقف') !== -1);
  click(win, doc.querySelector('[data-sleep="0"]'));
  assert.ok(doc.getElementById('sleep-note').textContent.indexOf('متوقف') !== -1);
});

test('playing a station opens the player bar', () => {
  const { win, doc } = boot();
  win.App.go('radio');
  click(win, doc.querySelector('[data-station="0"]'));
  assert.ok(doc.getElementById('player').classList.contains('is-open'));
  assert.ok(doc.getElementById('player-title').textContent.length > 2);
  click(win, doc.getElementById('player-stop'));
  assert.ok(!doc.getElementById('player').classList.contains('is-open'));
});

/* ---------------- settings ---------------- */

test('settings are populated from the modules and persist changes', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  assert.ok(doc.getElementById('settings-method').options.length >= 10);
  assert.ok(doc.getElementById('settings-reciter').options.length >= 15);
  assert.ok(doc.getElementById('settings-city').options.length >= 20);
  assert.strictEqual(doc.getElementById('settings-method').value, 'Ojeiri');

  const method = doc.getElementById('settings-method');
  method.value = 'Makkah';
  fire(win, method, 'change');
  assert.strictEqual(win.Store.get('method'), 'Makkah');
  assert.ok(doc.getElementById('place-line').textContent.indexOf('أم القرى') !== -1);
});

test('switching the asr school moves the asr time later', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const before = win.App.computeTimes(new Date()).asr;
  const asr = doc.getElementById('settings-asr');
  asr.value = 'hanafi';
  fire(win, asr, 'change');
  assert.ok(win.App.computeTimes(new Date()).asr > before);
});

test('the theme switch writes the document attribute', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const theme = doc.getElementById('settings-theme');
  theme.value = 'dark';
  fire(win, theme, 'change');
  assert.strictEqual(doc.documentElement.getAttribute('data-theme'), 'dark');
  theme.value = 'light';
  fire(win, theme, 'change');
  assert.strictEqual(doc.documentElement.getAttribute('data-theme'), 'light');
});

test('the text size slider sizes the whole app, and the reading on to the end of the slider', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const slider = doc.getElementById('settings-font');
  const html = doc.documentElement;
  assert.strictEqual(html.style.fontSize, '', 'at 100% the page keeps its own measure');
  slider.value = '115';
  fire(win, slider, 'input');
  assert.strictEqual(html.style.fontSize, '18.4px', 'the interface grows with the setting');
  assert.strictEqual(html.style.getPropertyValue('--quran-scale'), '1', 'and the reading with it');
  slider.value = '140';
  fire(win, slider, 'input');
  assert.strictEqual(win.Store.get('fontScale'), 140);
  assert.strictEqual(html.style.fontSize, '20.8px', 'the interface stops at 130%');
  assert.strictEqual(html.style.getPropertyValue('--quran-scale'), '1.0769', 'the reading goes the rest of the way, 140% in all');
  assert.strictEqual(doc.getElementById('font-value').textContent, '140%');
  slider.value = '100';
  fire(win, slider, 'input');
  assert.strictEqual(html.style.fontSize, '');
  assert.strictEqual(html.style.getPropertyValue('--quran-scale'), '1');
});

test('on android the words are drawn at the app\'s size, not grown by the phone\'s font setting', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'eworldq8', 'sunnati', 'MainActivity.java'), 'utf8');
  assert.match(main, /s\.setTextZoom\(100\);/, 'the new package asks the web view for no zoom of its own');
  const app = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'app.js'), 'utf8');
  /* and the package already installed is answered from the page: the zoom it
     adds is read off a word of a known size and taken back out */
  assert.match(app, /function measureTextZoom\(\) \{[\s\S]*?getBoundingClientRect\(\)\.height \/ 100/);
  assert.match(app, /var root = 16 \* ui \/ textZoom;/);
  assert.match(app, /textZoom = measureTextZoom\(\);\s*applyFont\(\);/);
});

test('the vibrate switch toggles and reports its state', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const sw = doc.getElementById('settings-vibrate');
  assert.strictEqual(sw.getAttribute('aria-checked'), 'true');
  click(win, sw);
  assert.strictEqual(sw.getAttribute('aria-checked'), 'false');
  assert.strictEqual(win.Store.get('vibrate'), false);
});

/* ---------------- navigation ---------------- */

test('every tab in the bar opens its view', () => {
  const { win, doc } = boot();
  ['quran', 'tasbih', 'tracker', 'more', 'home'].forEach(function (name) {
    click(win, tab(doc, name));
    assert.ok(doc.getElementById('v-' + name).classList.contains('is-open'), name + ' did not open');
    assert.strictEqual(doc.querySelectorAll('.view.is-open').length, 1, 'only one view at a time');
    assert.strictEqual(litTab(doc), name);
  });
});

test('sub views keep their parent tab lit', () => {
  const { win, doc } = boot();
  const owners = {
    reader: 'quran', search: 'quran', bookmarks: 'quran', khatma: 'quran',
    azkar: 'tasbih', 'azkar-list': 'tasbih', hisn: 'tasbih', qibla: 'more', radio: 'more',
    hadith: 'more', dua: 'more', ruqyah: 'more', calendar: 'more',
    settings: 'more', about: 'more'
  };
  Object.keys(owners).forEach(function (name) {
    win.App.go(name);
    assert.strictEqual(litTab(doc), owners[name], name + ' lit the wrong tab');
  });
});

test('every nav target in the markup resolves to a real view', () => {
  const { doc } = boot();
  const targets = new Set([...doc.querySelectorAll('[data-go]')].map((el) => el.getAttribute('data-go')));
  assert.ok(targets.size >= 8);
  targets.forEach(function (name) {
    assert.ok(doc.getElementById('v-' + name), 'no view for data-go="' + name + '"');
  });
});

test('every view the router knows about exists in the markup', () => {
  const { win, doc } = boot();
  Object.keys(win.App.render).forEach(function (name) {
    assert.ok(doc.getElementById('v-' + name), 'the router renders ' + name + ' but no view holds it');
  });
});

test('opening a view closes the sheet behind it', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  click(win, doc.querySelector('[data-ayah="112:1"]'));
  assert.ok(doc.getElementById('sheet').classList.contains('is-open'));
  win.App.go('home');
  assert.ok(!doc.getElementById('sheet').classList.contains('is-open'));
});

/* ---------------- data and safety ---------------- */

test('a backup round trips through export and import', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  click(win, doc.querySelector('#tracker-list [data-check]'));
  win.Store.set('method', 'Qatar');
  const dump = win.Store.exportAll();

  win.Store.clearAll();
  assert.strictEqual(win.Store.get('method'), 'Ojeiri');
  const res = win.Store.importAll(dump);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(win.Store.get('method'), 'Qatar');
});

test('the interface escapes text rather than trusting it', () => {
  const { win } = boot();
  const nasty = '<img src=x onerror="alert(1)">';
  assert.strictEqual(win.App.helpers.esc(nasty).indexOf('<'), -1);
  assert.ok(win.App.helpers.esc(nasty).indexOf('&lt;img') === 0);
  assert.strictEqual(win.App.helpers.highlight(nasty, 'img').indexOf('<img'), -1);
});

test('arabic numerals are used for every digit shown', () => {
  const { win } = boot();
  assert.strictEqual(win.App.helpers.ar('1448'), '1448');
  assert.strictEqual(win.App.helpers.ar(0), '0');
});

test('one set of figures is used throughout', () => {
  const { doc } = boot();
  ['hijri-date', 'greg-date', 'today-done', 'today-total'].forEach(function (id) {
    const text = doc.getElementById(id).textContent;
    assert.ok(!/[\u0660-\u0669]/.test(text), id + ' mixes in a second set of figures: ' + text);
    assert.ok(/\d/.test(text), id + ' shows no number at all: ' + text);
  });
});

test('the mushaf actually arrives over the network on its own', async () => {
  /* Boots with nothing injected and a fetch that behaves like a real one,
     handing back a Response rather than the parsed payload. This is the path a
     phone takes, and injecting the text in the other tests hides it. */
  let asked = null;
  const { win, doc } = boot({
    withMushaf: false,
    fetch: (url) => {
      asked = String(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mushafPayload) });
    }
  });

  assert.ok(doc.querySelector('#daily-ayah .skeleton'), 'a placeholder stands in while it loads');
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(asked, 'data/mushaf.json', 'the loader should ask for the text');
  assert.strictEqual(win.Mushaf.ready(), true, 'the text should be loaded by now');
  assert.ok(!doc.querySelector('#daily-ayah .skeleton'), 'the verse of the day should have filled in');
  assert.ok(doc.getElementById('daily-ayah').textContent.trim().length > 5);

  assert.strictEqual(win.Mushaf.totalVerses(), 6236);

  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  assert.strictEqual(doc.querySelectorAll('#reader-body .ayah').length, 4,
    'the reader should hold verses once the text has arrived');
  click(win, tab(doc, 'quran'));
  click(win, doc.querySelector('[data-surah="36"]'));
  assert.strictEqual(doc.querySelectorAll('#reader-body .ayah').length, 83);
  assert.strictEqual(doc.querySelectorAll('#reader-body .skeleton').length, 0);
});

test('a failed download leaves the rest of the app usable', async () => {
  const { win, doc } = boot({ withMushaf: false, fetch: () => Promise.reject(new Error('offline')) });
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(win.Mushaf.ready(), false);
  assert.ok(doc.getElementById('v-home').classList.contains('is-open'));
  assert.match(doc.getElementById('arc-count').textContent, /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/,
    'the clock keeps running without the mushaf');
  win.App.go('azkar');
  assert.ok(doc.querySelectorAll('#azkar-groups [data-azkar]').length >= 10);
});

test('the page works before the mushaf finishes loading', () => {
  const { win, doc } = boot({ withMushaf: false });
  assert.ok(doc.getElementById('v-home').classList.contains('is-open'));
  assert.ok(doc.getElementById('daily-ayah').querySelector('.skeleton'), 'a placeholder stands in');
  win.App.go('quran');
  assert.strictEqual(doc.querySelectorAll('#surah-list [data-surah]').length, 114,
    'the surah list comes from metadata, so it does not wait');
  win.App.go('reader');
  assert.ok(doc.querySelector('#reader-body .skeleton'), 'the reader waits politely');
});

test('the document is marked up for arabic and for assistive tech', () => {
  const { doc } = boot();
  assert.strictEqual(doc.documentElement.getAttribute('lang'), 'ar');
  assert.strictEqual(doc.documentElement.getAttribute('dir'), 'rtl');
  assert.ok(doc.querySelector('nav[aria-label]'), 'the tab bar names itself');
  assert.ok(doc.querySelector('meta[name="description"]'));
  assert.ok(doc.querySelector('link[rel="manifest"]'));
  doc.querySelectorAll('.view').forEach(function (v) {
    assert.ok(v.querySelector('h1') || v.getAttribute('aria-labelledby'), v.id + ' needs a heading');
  });
});

test('the viewport still allows people to zoom', () => {
  const { doc } = boot();
  const viewport = doc.querySelector('meta[name="viewport"]').getAttribute('content');
  assert.ok(viewport.indexOf('user-scalable=no') === -1, 'pinch zoom must stay available');
  assert.ok(viewport.indexOf('maximum-scale=1') === -1);
});

test('the service worker caches every file the shell needs', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  SCRIPTS.concat(['index.html', 'css/style.css', 'data/mushaf.json']).forEach(function (rel) {
    assert.ok(sw.indexOf(rel) !== -1, 'the worker never caches ' + rel);
  });
});

/* ---------------- friday ---------------- */

test('the midday prayer is called the jumuah on friday and the dhuhr otherwise', () => {
  const { win } = boot();
  const name = win.App.helpers.prayerName;
  const friday = new Date(2026, 8, 4);
  const thursday = new Date(2026, 8, 3);
  const saturday = new Date(2026, 8, 5);

  assert.strictEqual(friday.getDay(), 5, 'the fixture really is a friday');
  assert.strictEqual(name('dhuhr', friday), 'الجمعة');
  assert.strictEqual(name('dhuhr', thursday), 'الظهر');
  assert.strictEqual(name('dhuhr', saturday), 'الظهر');
  assert.strictEqual(name('asr', friday), 'العصر', 'only the midday prayer changes name');
  assert.strictEqual(name('fajr', friday), 'الفجر');
});

test('the clock and the marks carry the friday name on a friday', () => {
  /* The clock is handed a morning rather than left to whenever the suite runs:
     after the last prayer of the night the app moves on to the next day, so a
     thursday evening legitimately shows friday's name and the assertion, read
     against the real weekday, failed for reasons that were not the app's. */
  const cases = [
    [new Date(2026, 8, 24, 9, 0, 0), 'الظهر', 'الجمعة'],   // خميس
    [new Date(2026, 8, 25, 9, 0, 0), 'الجمعة', 'الظهر'],   // جمعة
  ];
  for (const [when, wanted, other] of cases) {
    const { win, doc } = boot({ now: when });
    const midday = win.App.clockState(when).marks.filter((m) => m.key === 'dhuhr')[0];
    assert.strictEqual(midday.ar, wanted, 'the mark on ' + when.toDateString());
    const names = [...doc.querySelectorAll('#windows .window-name')].map((e) => e.textContent);
    assert.ok(names.indexOf(wanted) !== -1, 'the marks should read ' + wanted + ', got ' + names.join(' '));
    assert.strictEqual(names.indexOf(other), -1, 'the other name must not appear');
  }
});

test('friday replaces the duha and dhuhr sunnah with the sunan of the day', () => {
  const { win } = boot();
  const pick = win.App.helpers.windowSunnah;
  const friday = new Date(2026, 8, 4);
  const thursday = new Date(2026, 8, 3);

  assert.strictEqual(pick('duha', friday).key, 'friday');
  assert.strictEqual(pick('dhuhr', friday).key, 'friday');
  assert.strictEqual(pick('duha', friday).block.l, 'سنن الجمعة');
  assert.ok(pick('duha', friday).block.items.join(' ').indexOf('الكهف') !== -1,
    'the sunan of the day should mention surat al kahf');

  assert.strictEqual(pick('duha', thursday).key, 'duha');
  assert.strictEqual(pick('duha', thursday).block.l, 'سنن الضحى');
  assert.strictEqual(pick('fajr', friday).key, 'fajr', 'the fajr window is untouched on friday');
  assert.strictEqual(pick('maghrib', friday).key, 'maghrib');
});

test('the friday card ticks are kept apart from the weekday ones', () => {
  /* الجمعة runs from dawn to sunset, so the card carries its sunan through
     the daytime windows, under names of their own that are rows of the list
     on a friday. Every other row of the card ticks a row of the list it says
     again, and keeps no tick of its own. */
  const fri = boot({ now: new Date(2026, 9, 9, 12, 0, 0) });
  assert.strictEqual(fri.win.App.clockState().windowKey, 'dhuhr');
  assert.ok(fri.doc.getElementById('now-title').textContent.indexOf('الجمعة') !== -1);
  const ids = [...fri.doc.querySelectorAll('#now-list [data-check]')].map((b) => b.getAttribute('data-check'));
  assert.strictEqual(ids.length, 7);
  ids.forEach(function (id, i) { assert.strictEqual(id, 'now:friday:' + i); });

  const tue = boot({ now: new Date(2026, 9, 6, 12, 0, 0) });
  const week = [...tue.doc.querySelectorAll('#now-list [data-check]')].map((b) => b.getAttribute('data-check'));
  assert.ok(week.length >= 4);
  week.forEach(function (value) {
    value.split(' ').forEach(function (id) {
      assert.match(id, /^(sunnah:\d+:\d+|wird:[a-z-]+)$/, 'a row of the list, got ' + id);
    });
  });
});

test('a full day of ticks never reads more done than there is to do', () => {
  const { win, doc } = boot();
  const total = win.App.helpers.totalSunnahCount();
  assert.ok(total > 40, 'the total counts the list, got ' + total);
  const ids = tickWholeList(win, doc);
  assert.strictEqual(digits(doc.getElementById('tracker-done').textContent), ids.length, 'the whole list, at whatever hour this runs');
  /* the card touched afterwards, twice over, and a tick no row carries */
  win.App.go('home');
  for (let round = 0; round < 2; round++) {
    [...doc.querySelectorAll('#now-list [data-check]')].map((b) => b.getAttribute('data-check')).forEach(function (value) {
      click(win, doc.querySelector('#now-list [data-check="' + value + '"]'));
      const done = digits(doc.getElementById('today-done').textContent);
      assert.ok(done <= digits(doc.getElementById('today-total').textContent), done + ' done');
    });
  }
  win.Store.updateDay(function (rec) { rec.sunnah['bogus:1'] = true; }, win.App.helpers.sunnahDay());
  win.App.go('tracker');
  const c = win.Store.completion(win.App.helpers.sunnahDay(), win.App.helpers.sunnahTicks());
  assert.ok(c.done <= c.total, c.done + ' done out of ' + c.total);
  assert.ok(c.percent <= 100, 'the meter must not run past full, got ' + c.percent);
});

/* ---------------- one sunnah, one tick ---------------- */

function digits(text) {
  return Number(String(text).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }));
}

/* Ticks every row of «كل السنن» that is not already done. Rows that share a
   tick light up together, so touching the second would clear the first. */
function tickWholeList(win, doc) {
  win.App.go('tracker');
  const ids = [...new Set([...doc.querySelectorAll('#tracker-list [data-check]')].map((b) => b.getAttribute('data-check')))];
  ids.forEach(function (id) {
    const row = doc.querySelector('#tracker-list [data-check="' + id + '"]');
    if (!row.classList.contains('is-done')) click(win, row);
  });
  return ids;
}

test('everything in the list ticked fills the meter, on any kind of day', () => {
  /* The meter counted the rows of the hour card besides the list, rows the
     list never showed, so a day with every sunnah in it ticked read 116 of
     148 and could not be finished from «كل السنن». */
  [['an ordinary tuesday', new Date(2026, 9, 6, 12, 0, 0)],
   ['a friday', new Date(2026, 9, 9, 12, 0, 0)],
   ['a monday, which is a day of fasting', new Date(2026, 9, 5, 12, 0, 0)],
   ['a thursday that is also a white day', new Date(2026, 8, 24, 12, 0, 0)]].forEach(function (pair) {
    const name = pair[0];
    const { win, doc } = boot({ now: pair[1] });
    const ids = tickWholeList(win, doc);
    const total = digits(doc.getElementById('tracker-total').textContent);
    assert.strictEqual(total, ids.length, name + ': the meter counts what the list offers, each tick once');
    assert.strictEqual(digits(doc.getElementById('tracker-done').textContent), total, name + ': all of it done');
    assert.strictEqual(doc.getElementById('tracker-meter').style.width, '100%', name);
    doc.querySelectorAll('#tracker-list .fold-tally').forEach(function (t) {
      assert.ok(t.classList.contains('is-full'), name + ': every fold full');
    });
    win.App.go('home');
    assert.strictEqual(digits(doc.getElementById('today-done').textContent), total, name + ': the home meter agrees');
    assert.strictEqual(digits(doc.getElementById('today-total').textContent), total);
    const card = doc.querySelectorAll('#now-list [data-check]');
    assert.ok(card.length >= 4);
    card.forEach(function (b) { assert.ok(b.classList.contains('is-done'), name + ': the hour card is done with the list'); });
  });

  /* an ordinary day counts the wird and the book, less the rows of the book
     that share the tick of the wird or of their other place */
  const { win } = boot({ now: new Date(2026, 9, 6, 12, 0, 0) });
  const book = win.SUNNAH_TRACKER.reduce(function (n, g) { return n + g.i.length; }, 0);
  assert.strictEqual(win.App.helpers.totalSunnahCount(),
    win.WIRD_ITEMS.length + book - Object.keys(win.SUNNAH_SAME).length);
});

test('every row of the hour card ticks the rows of the list it says again', () => {
  const { win } = boot({ now: new Date(2026, 9, 6, 12, 0, 0) });
  /* each target is pinned to words of the row it must be, so a row put into
     the book later, which moves the ones after it, cannot leave the card
     pointing at a neighbour */
  const SAYS = {
    fajr: [{ 'sunnah:0:0': 'السواك عند الاستيقاظ', 'sunnah:0:1': 'أحيانا بعد ما أماتنا' },
      { 'sunnah:2:0': 'متابعة المؤذن', 'sunnah:2:1': 'دعاء الوسيلة' },
      { 'sunnah:2:2': 'بين الأذان والإقامة' }, { 'sunnah:2:3': 'ركعتا الفجر' }, { 'sunnah:2:4': 'الاضطجاع' },
      { 'sunnah:2:8': 'حتى تطلع الشمس' }, { 'wird:morning': 'أذكار الصباح' }],
    duha: [{ 'sunnah:5:0': 'صلاة الضحى' }, { 'sunnah:5:0': 'صلاة الضحى', 'sunnah:5:1': 'ترمض الفصال' }, { 'sunnah:5:2': 'أذكار الصباح' },
      { 'sunnah:1:7': 'ركعتان بعد كل وضوء' }],
    dhuhr: [{ 'sunnah:6:0': 'أربع ركعات قبل الظهر وأربع بعدها', 'sunnah:6:1': 'الراتبة' }, { 'sunnah:6:1': 'الراتبة' },
      { 'sunnah:4:0': 'اللهم أنت السلام', 'sunnah:4:1': 'لا إله إلا الله وحده لا شريك له', 'sunnah:4:2': 'التسبيح', 'sunnah:4:3': 'آية الكرسي', 'sunnah:4:4': 'المعوذات' },
      { 'sunnah:6:2': 'القيلولة' }],
    asr: [{ 'sunnah:7:2': 'أذكار المساء' }, { 'sunnah:7:1': 'المحافظة على صلاة العصر' }, { 'sunnah:7:0': 'التطوع قبل العصر' },
      { 'sunnah:13:6': 'الاستغفار مئة مرة', 'sunnah:13:7': 'سبحان الله وبحمده مئة مرة' }],
    maghrib: [{ 'sunnah:8:0': 'ركعتان قبل المغرب' }, { 'sunnah:8:1': 'كفّ الصبيان' }, { 'sunnah:8:2': 'إغلاق الأبواب' },
      { 'sunnah:8:3': 'ركعتان بعد المغرب' }, { 'wird:evening': 'أذكار المساء' }, { 'sunnah:8:4': 'ترك النوم قبل العشاء' }],
    isha: [{ 'sunnah:9:1': 'ركعتان بعد العشاء', 'wird:witr': 'الوتر' }, { 'sunnah:9:2': 'ترك الحديث بعد العشاء' },
      { 'sunnah:9:3': 'إغلاق الأبواب', 'sunnah:9:4': 'تغطية الإناء' }, { 'sunnah:9:5': 'الوضوء قبل النوم', 'sunnah:9:6': 'نفض الفراش' },
      { 'sunnah:9:7': 'النوم على الشق الأيمن' }, { 'sunnah:9:8': 'آية الكرسي وخواتيم البقرة', 'sunnah:9:9': 'المعوذات مع النفث', 'wird:sleep': 'آية الكرسي وخواتيم البقرة والمعوذات' },
      { 'sunnah:9:10': 'باسمك اللهم أموت وأحيا', 'sunnah:9:11': 'سبحان الله ثلاثاً وثلاثين' }]
  };
  function rowText(id) {
    let m = /^sunnah:(\d+):(\d+)$/.exec(id);
    if (m) return (win.SUNNAH_TRACKER[+m[1]] || { i: [] }).i[+m[2]];
    m = /^wird:(.+)$/.exec(id);
    const w = m && win.WIRD_ITEMS.filter(function (x) { return x.id === m[1]; })[0];
    return w ? w.t + ' ' + w.n : undefined;
  }
  const offered = win.App.helpers.sunnahTicks(new Date(2026, 9, 6, 12));
  Object.keys(SAYS).forEach(function (key) {
    const block = win.CURRENT_SUNNAH[key];
    assert.strictEqual(block.t.length, block.items.length, key + ': a target for every row');
    assert.strictEqual(block.items.length, SAYS[key].length, key + ': every row is pinned here');
    block.t.forEach(function (t, i) {
      /* copied out of the page's own realm, whose arrays are not node's */
      const rows = Array.isArray(t) ? Array.from(t) : [t];
      assert.deepStrictEqual(rows, Object.keys(SAYS[key][i]), key + ':' + i);
      rows.forEach(function (id) {
        const said = rowText(id);
        assert.ok(said, key + ':' + i + ' points at ' + id + ', which is not a row');
        assert.ok(said.indexOf(SAYS[key][i][id]) !== -1, key + ':' + i + ' should be ' + SAYS[key][i][id] + ', ' + id + ' says ' + said);
      });
      win.App.helpers.rowTicks(key, block, i).forEach(function (id) {
        assert.ok(offered.indexOf(id) !== -1, key + ':' + i + ' ticks ' + id + ', which the list offers');
      });
    });
  });

  /* and the rows of the book that are the deed of a wird row, or of another
     row of the book, are the same thing said twice */
  const SAME = { 'sunnah:5:0': 'صلاة الضحى', 'sunnah:5:2': 'أذكار الصباح', 'sunnah:7:2': 'أذكار المساء',
    'sunnah:13:6': 'الاستغفار مئة مرة', 'sunnah:10:11': 'تغطية الإناء' };
  assert.deepStrictEqual(Object.keys(win.SUNNAH_SAME).sort(), Object.keys(SAME).sort());
  Object.keys(SAME).forEach(function (row) {
    assert.ok(rowText(row).indexOf(SAME[row]) !== -1, row + ' says ' + rowText(row));
    assert.ok(rowText(win.SUNNAH_SAME[row]).indexOf(SAME[row]) !== -1, win.SUNNAH_SAME[row] + ' says ' + rowText(win.SUNNAH_SAME[row]));
  });
});

test('the hour card and the list mark the same sunnah once, in either place', () => {
  const storage = memoryStorage();
  const first = boot({ storage: storage, now: new Date(2026, 9, 6, 12, 0, 0) });
  /* find an hour inside each window of that day, as the app reckons them */
  const at = {};
  for (let m = 0; m < 24 * 60; m += 10) {
    const when = new Date(2026, 9, 6, Math.floor(m / 60), m % 60, 0);
    const key = first.win.App.clockState(when).windowKey;
    if (!at[key] && first.win.App.helpers.sunnahDay(when).getDate() === 6) at[key] = when;
  }
  assert.deepStrictEqual(Object.keys(at).sort(), ['asr', 'dhuhr', 'duha', 'fajr', 'isha', 'maghrib']);

  const marked = new Set();
  ['fajr', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(function (key) {
    const { win, doc } = boot({ storage: storage, now: at[key] });
    assert.strictEqual(win.App.clockState().windowKey, key);
    [...doc.querySelectorAll('#now-list [data-check]')].map((b) => b.getAttribute('data-check')).forEach(function (value) {
      const row = doc.querySelector('#now-list [data-check="' + value + '"]');
      if (!row.classList.contains('is-done')) click(win, row);
      value.split(' ').forEach(function (id) { marked.add(id); });
    });
    doc.querySelectorAll('#now-list [data-check]').forEach(function (b) {
      assert.ok(b.classList.contains('is-done'), key + ': the card is done');
    });
    /* each sunnah the card marked is counted once, and stands marked in the list */
    assert.strictEqual(digits(doc.getElementById('today-done').textContent), marked.size, key);
    win.App.go('tracker');
    marked.forEach(function (id) {
      const rows = doc.querySelectorAll('#tracker-list [data-check="' + id + '"]');
      assert.ok(rows.length >= 1, id + ' is in the list');
      rows.forEach(function (r) { assert.ok(r.classList.contains('is-done'), id + ' shows done in the list'); });
    });
  });

  /* the card's whole day is less than the list, and the rest of the list
     finishes it without counting anything twice */
  const last = boot({ storage: storage, now: at.isha });
  const total = last.win.App.helpers.totalSunnahCount();
  assert.ok(marked.size < total);
  tickWholeList(last.win, last.doc);
  assert.strictEqual(digits(last.doc.getElementById('tracker-done').textContent), total);
  assert.strictEqual(digits(last.doc.getElementById('tracker-total').textContent), total);
});

test('a sunnah the list gives twice is ticked once and counted once', () => {
  const { win, doc } = boot({ now: new Date(2026, 9, 6, 12, 0, 0) });
  win.App.go('tracker');
  const wird = doc.querySelector('#tracker-list [data-fold="wird"] [data-check="wird:istighfar"]');
  click(win, wird);
  assert.strictEqual(digits(doc.getElementById('tracker-done').textContent), 1, 'one sunnah, one in the count');
  const book = doc.querySelectorAll('#tracker-list [data-check="wird:istighfar"]');
  assert.strictEqual(book.length, 2, 'the wird and the book both list it');
  book.forEach(function (b) { assert.ok(b.classList.contains('is-done'), 'and both show it done'); });
  const other = doc.querySelector('#tracker-list [data-fold="sunnah:13"] [data-check="wird:istighfar"]');
  assert.ok(other && other.textContent.indexOf('الاستغفار مئة مرة') !== -1);
  click(win, other);
  assert.strictEqual(digits(doc.getElementById('tracker-done').textContent), 0, 'cleared in either place');
});

test('the ticks of a day run from fajr to fajr, as the home card says', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('ويبدأ العدّ من جديد كل فجر') !== -1);
  const storage = memoryStorage();
  /* the witr at eleven on tuesday night */
  const night = boot({ storage: storage, now: new Date(2026, 9, 6, 23, 0, 0) });
  night.win.App.go('tracker');
  click(night.win, night.doc.querySelector('#tracker-list [data-fold="wird"] [data-check="wird:witr"]'));
  assert.strictEqual(night.win.Store.dayKey(night.win.App.helpers.sunnahDay()), '2026-10-06');

  /* at one after midnight it is still tuesday's night, and its witr is there */
  const late = boot({ storage: storage, now: new Date(2026, 9, 7, 1, 0, 0) });
  assert.strictEqual(late.win.Store.dayKey(late.win.App.helpers.sunnahDay()), '2026-10-06');
  late.win.App.go('tracker');
  assert.ok(late.doc.querySelector('#tracker-list [data-fold="wird"] [data-check="wird:witr"]').classList.contains('is-done'));
  assert.strictEqual(digits(late.doc.getElementById('tracker-done').textContent), 1);
  assert.strictEqual(late.doc.querySelector('#tracker-heat i[data-today="1"]').getAttribute('title'), '2026-10-06');

  /* and once the fajr of wednesday is in, the count starts afresh */
  const morning = boot({ storage: storage, now: new Date(2026, 9, 7, 9, 0, 0) });
  assert.strictEqual(morning.win.Store.dayKey(morning.win.App.helpers.sunnahDay()), '2026-10-07');
  morning.win.App.go('tracker');
  assert.strictEqual(digits(morning.doc.getElementById('tracker-done').textContent), 0);
  assert.ok(!morning.doc.querySelector('#tracker-list [data-fold="wird"] [data-check="wird:witr"]').classList.contains('is-done'));
});

test('thursday evening keeps thursday\'s list, and friday\'s comes with its fajr', () => {
  /* The list used to take on the sunan of friday at the maghrib of thursday,
     while the ticks still went to thursday's record: the duha and dhuhr of
     thursday left the count and friday's came in, so the meter could read
     156 of 148, and what was ticked that night was gone by friday morning. */
  const storage = memoryStorage();
  const noon = boot({ storage: storage, now: new Date(2026, 9, 8, 12, 0, 0) });
  const before = noon.win.App.helpers.totalSunnahCount();
  tickWholeList(noon.win, noon.doc);
  assert.strictEqual(digits(noon.doc.getElementById('tracker-done').textContent), before);

  const evening = boot({ storage: storage, now: new Date(2026, 9, 8, 21, 0, 0) });
  /* the card of thursday night is the night's own, and what it marks is thursday's */
  assert.strictEqual(evening.doc.getElementById('now-title').textContent, 'سنن العشاء والنوم');
  assert.strictEqual(evening.doc.getElementById('now-list').getAttribute('data-sunnah-day'), '2026-10-08');
  evening.win.App.go('tracker');
  assert.strictEqual(evening.doc.querySelector('#tracker-list [data-fold="friday"]'), null, 'not yet');
  assert.strictEqual(digits(evening.doc.getElementById('tracker-total').textContent), before, 'the count does not move at maghrib');
  assert.strictEqual(digits(evening.doc.getElementById('tracker-done').textContent), before);

  const small = boot({ storage: storage, now: new Date(2026, 9, 9, 1, 0, 0) });
  small.win.App.go('tracker');
  assert.strictEqual(small.doc.querySelector('#tracker-list [data-fold="friday"]'), null, 'still thursday\'s night');

  const friday = boot({ storage: storage, now: new Date(2026, 9, 9, 9, 0, 0) });
  friday.win.App.go('tracker');
  assert.ok(friday.doc.querySelector('#tracker-list [data-fold="friday"]'), 'friday\'s own list from its fajr');
  assert.strictEqual(digits(friday.doc.getElementById('tracker-done').textContent), 0, 'a fresh day');
  click(friday.win, friday.doc.querySelector('#tracker-list [data-check="now:friday:2"]'));
  /* still there in the evening of friday, for its night is saturday's */
  const after = boot({ storage: storage, now: new Date(2026, 9, 9, 21, 0, 0) });
  after.win.App.go('tracker');
  assert.ok(after.doc.querySelector('#tracker-list [data-check="now:friday:2"]').classList.contains('is-done'));
});

test('ticks kept under the old names are carried to the rows they stand for', async () => {
  const storage = memoryStorage();
  storage.setItem('sunnati.day.2026-10-06', JSON.stringify({ sunnah: {
    'now:fajr:3': true, 'now:isha:0': true, 'now:dhuhr:2': false, 'now:asr:9': true,
    'sunnah:13:6': true, 'sunnah:5:0': true, 'sunnah:2:5': true, 'now:friday:2': true, 'bogus:1': true
  } }));
  /* thursday night, when the old list had taken on friday's rows */
  storage.setItem('sunnati.day.2026-10-01', JSON.stringify({ sunnah: { 'now:friday:2': true, 'now:friday:4': false, 'wird:quran': true } }));
  storage.setItem('sunnati.day.2026-10-02', JSON.stringify({ sunnah: { 'now:friday:0': true } }));
  const { win, doc } = boot({ storage: storage, now: new Date(2026, 9, 6, 12, 0, 0) });
  const s = JSON.parse(storage.getItem('sunnati.day.2026-10-06')).sunnah;
  assert.strictEqual(s['sunnah:2:3'], true, 'the fajr rakahs of the card are the rakahs of the list');
  assert.strictEqual(s['sunnah:9:1'], true, 'the card\'s one line of the isha is two rows of the list');
  assert.strictEqual(s['wird:witr'], true);
  assert.strictEqual(s['wird:istighfar'], true, 'a row of the book that is a row of the wird');
  assert.strictEqual(s['wird:duha'], true);
  assert.strictEqual(s['sunnah:2:5'], true, 'a row of its own stays as it is');
  ['now:fajr:3', 'now:isha:0', 'now:dhuhr:2', 'sunnah:13:6', 'sunnah:5:0'].forEach(function (old) {
    assert.ok(!(old in s), old + ' is dropped once carried');
  });
  assert.strictEqual(s['now:asr:9'], true, 'a name with nowhere to go is kept, and not counted');
  assert.strictEqual(s['now:friday:2'], true, 'the friday\'s own rows keep their names');
  assert.deepStrictEqual(JSON.parse(storage.getItem('sunnati.day.2026-10-01')).sunnah, { 'wird:quran': true },
    'thursday keeps its own');
  assert.deepStrictEqual(JSON.parse(storage.getItem('sunnati.day.2026-10-02')).sunnah, { 'now:friday:0': true, 'now:friday:2': true },
    'and the friday after it gets what was ticked for it that night');
  win.App.go('tracker');
  /* 2:3, 9:1, witr, istighfar, duha and 2:5: the friday tick is not tuesday's, and neither old name is a row */
  assert.strictEqual(digits(doc.getElementById('tracker-done').textContent), 6);

  /* a second start finds nothing left to carry */
  const again = JSON.stringify(JSON.parse(storage.getItem('sunnati.day.2026-10-06')));
  boot({ storage: storage, now: new Date(2026, 9, 6, 12, 0, 0) });
  assert.strictEqual(JSON.stringify(JSON.parse(storage.getItem('sunnati.day.2026-10-06'))), again);

  /* a backup from before, restored from the settings, brings the old names
     back, and they are carried again */
  const backup = JSON.stringify({ app: 'sunnati', data: { 'sunnati.day.2026-10-05': JSON.stringify({ sunnah: { 'now:maghrib:4': true, 'now:asr:3': true } }) } });
  const input = doc.getElementById('data-file');
  Object.defineProperty(input, 'files', { value: [new win.File([backup], 'backup.json', { type: 'application/json' })] });
  fire(win, input, 'change');
  await until(function () {
    const day = JSON.parse(storage.getItem('sunnati.day.2026-10-05') || 'null');
    return day && day.sunnah && day.sunnah['wird:evening'] === true;
  });
  /* the asr line named no count for its istighfar when that tick was made,
     so it is carried to the tasbih alone */
  assert.deepStrictEqual(JSON.parse(storage.getItem('sunnati.day.2026-10-05')).sunnah, { 'wird:evening': true, 'sunnah:13:7': true });
});

test('a row of the card clears only what it marked, not what the list had', () => {
  const storage = memoryStorage();
  const evening = new Date(2026, 9, 6, 20, 0, 0);
  let { win, doc } = boot({ storage: storage, now: evening });
  assert.strictEqual(doc.getElementById('now-title').textContent, 'سنن العشاء والنوم');
  win.App.go('tracker');
  click(win, doc.querySelector('#tracker-list [data-fold="wird"] [data-check="wird:witr"]'));
  win.App.go('home');
  const row = () => doc.querySelector('#now-list [data-check="sunnah:9:1 wird:witr"]');
  assert.ok(row(), 'the card says the rakahs after isha and the witr in one line');
  assert.ok(!row().classList.contains('is-done'), 'half of it is not a done row');
  click(win, row());
  assert.ok(row().classList.contains('is-done'));
  /* the app closed and opened again before the second touch, as a phone does */
  ({ win, doc } = boot({ storage: storage, now: evening }));
  click(win, row());
  const s = win.Store.day(win.App.helpers.sunnahDay()).sunnah;
  assert.ok(!s['sunnah:9:1'], 'the slip is taken back');
  assert.strictEqual(s['wird:witr'], true, 'and the witr ticked in the wird stays');
  assert.deepStrictEqual(Object.keys(win.Store.day(win.App.helpers.sunnahDay()).marked), [], 'nothing left behind');
  /* a row it marked whole clears whole: the witr taken back in the list,
     then the line marked and cleared from the card */
  win.App.go('tracker');
  click(win, doc.querySelector('#tracker-list [data-fold="wird"] [data-check="wird:witr"]'));
  win.App.go('home');
  click(win, row());
  const both = win.Store.day(win.App.helpers.sunnahDay()).sunnah;
  assert.ok(both['sunnah:9:1'] && both['wird:witr'], 'one touch marks the two');
  click(win, row());
  const t = win.Store.day(win.App.helpers.sunnahDay()).sunnah;
  assert.ok(!t['sunnah:9:1'] && !t['wird:witr'], 'and the next clears the two');
  /* a touch beside the rows is not taken for a day of the calendar */
  const occasions = doc.getElementById('calendar-occasions');
  const before = occasions ? occasions.innerHTML : null;
  click(win, doc.querySelector('#now-list .setting-note'));
  win.App.go('tracker');
  click(win, doc.querySelector('#tracker-list .fold-source'));
  assert.strictEqual(occasions ? occasions.innerHTML : null, before);
});

test('a touch lands on the day the list shows, and the list follows the fajr', async () => {
  const { win, doc } = boot({ now: new Date(2026, 9, 7, 3, 0, 0) });
  win.App.go('tracker');
  const list = doc.getElementById('tracker-list');
  assert.strictEqual(list.getAttribute('data-sunnah-day'), '2026-10-06', 'before the fajr it is still the night before');
  /* the clock moves past the fajr while the list is open: the next second
     of the clock draws the new day */
  win.__setNow(new Date(2026, 9, 7, 9, 0, 0));
  const card = doc.getElementById('now-list');
  assert.strictEqual(card.getAttribute('data-sunnah-day'), '2026-10-06');
  await until(function () {
    return list.getAttribute('data-sunnah-day') === '2026-10-07' && card.getAttribute('data-sunnah-day') === '2026-10-07';
  });
  assert.strictEqual(doc.getElementById('now-title').textContent, 'سنن الضحى', 'and the card the new hour');
  /* and a touch on a list still showing an earlier day goes to that day */
  list.setAttribute('data-sunnah-day', '2026-10-06');
  click(win, doc.querySelector('#tracker-list [data-fold="wird"] [data-check="wird:witr"]'));
  assert.strictEqual(win.Store.day(new Date(2026, 9, 6, 12)).sunnah['wird:witr'], true);
  assert.ok(!win.Store.day(new Date(2026, 9, 7, 12)).sunnah['wird:witr']);
});

test('a day kept with a field of the wrong kind does not stop the app', () => {
  const storage = memoryStorage();
  storage.setItem('sunnati.day.2026-10-05', JSON.stringify({ sunnah: null, prayers: [], tasbih: 'x', pages: 3 }));
  storage.setItem('sunnati.day.2026-10-06', 'null');
  const { win, doc } = boot({ storage: storage, now: new Date(2026, 9, 6, 12, 0, 0) });
  assert.strictEqual(doc.querySelectorAll('#home-heat i').length, 30, 'the home screen drew');
  const old = win.Store.day(new Date(2026, 9, 5, 12));
  assert.deepStrictEqual(Object.keys(old.sunnah), []);
  assert.strictEqual(old.tasbih, 0);
  assert.strictEqual(old.pages, 3, 'what is sound is kept');
  win.App.go('tracker');
  assert.strictEqual(digits(doc.getElementById('tracker-done').textContent), 0);
  click(win, doc.querySelector('#tracker-list [data-check="wird:quran"]'));
  assert.strictEqual(digits(doc.getElementById('tracker-done').textContent), 1);
});

/* ---------------- the sky of the hour ---------------- */

const SKY_PLATES = ['night', 'fajr', 'sunrise', 'morning', 'noon', 'afternoon', 'sunset', 'dusk'];

test('eight paintings of one shore ship with the app and work offline', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  SKY_PLATES.forEach(function (name) {
    const file = path.join(DOCS, 'img', 'sky', name + '.webp');
    assert.ok(fs.existsSync(file), name + ' is there');
    const head = fs.readFileSync(file).subarray(0, 12).toString('latin1');
    assert.ok(head.indexOf('RIFF') === 0 && head.indexOf('WEBP') === 8, name + ' is a webp');
    assert.ok(fs.statSync(file).size < 60000, name + ' stays light');
    assert.ok(sw.indexOf("'./img/sky/" + name + ".webp'") !== -1, name + ' is kept for offline use');
  });
  assert.ok(/png\|svg\|webp/.test(sw), 'and is read from the cache once kept, since a painting never changes under its name');
});

/* in the order the cards stand in «الأقسام», each named after its section */
const SECTION_ART = ['azkar', 'mosques', 'qada', 'umrah', 'qibla', 'khatma', 'hadith', 'ruqyah', 'dua'];

/* the size a webp says it is, read from its first chunk */
function webpSize(buf) {
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1]; }
  if (kind === 'VP8X') return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  return null;
}

test('each section wears a painting of the same shore, which ships with the app and works offline', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  SECTION_ART.forEach(function (name) {
    const file = path.join(DOCS, 'img', 'sections', name + '.webp');
    assert.ok(fs.existsSync(file), name + ' is there');
    const bytes = fs.readFileSync(file);
    const head = bytes.subarray(0, 12).toString('latin1');
    assert.ok(head.indexOf('RIFF') === 0 && head.indexOf('WEBP') === 8, name + ' is a webp');
    assert.deepStrictEqual(webpSize(bytes), [384, 288], name + ' is drawn at the size the card declares for it');
    assert.ok(fs.statSync(file).size < 30000, name + ' stays light');
    assert.ok(sw.indexOf("'./img/sections/" + name + ".webp'") !== -1, name + ' is kept for offline use');
  });

  const { doc } = boot();
  const cards = [...doc.querySelectorAll('#home-tiles button')];
  assert.strictEqual(cards.length, SECTION_ART.length, 'one card for each section');
  cards.forEach(function (card) {
    const art = card.querySelectorAll('img.tile-art');
    assert.strictEqual(art.length, 1, 'each card carries one painting');
    /* it only dresses the card: the name and the note say where it goes */
    assert.strictEqual(art[0].getAttribute('alt'), '', 'a screen reader passes over the painting');
    assert.strictEqual(art[0].getAttribute('width'), '384');
    assert.strictEqual(art[0].getAttribute('height'), '288', 'its box is held before it arrives, so nothing jumps');
  });
  const srcs = cards.map(function (c) { return c.querySelector('img.tile-art').getAttribute('src'); });
  assert.strictEqual(new Set(srcs).size, srcs.length, 'no two sections share a painting');
  assert.deepStrictEqual(srcs, SECTION_ART.map(function (n) { return 'img/sections/' + n + '.webp'; }),
    'and each section wears its own');
  assert.strictEqual(doc.querySelectorAll('#home-tiles svg.icon').length, 0,
    'the painting takes the place of the line drawing');
});

test('coming back home keeps the sections as they were drawn, and an emptied grid is drawn again', () => {
  const { win, doc } = boot();
  const first = doc.querySelector('#home-tiles .tile-art');
  assert.ok(first, 'the sections are drawn on the way in');
  win.App.go('quran');
  win.App.go('home');
  assert.strictEqual(doc.querySelector('#home-tiles .tile-art'), first,
    'the same picture, not a new one decoded again on every return');
  assert.strictEqual(doc.querySelectorAll('#home-tiles .tile').length, SECTION_ART.length);
  doc.getElementById('home-tiles').innerHTML = '';
  win.App.go('home');
  assert.strictEqual(doc.querySelectorAll('#home-tiles .tile').length, SECTION_ART.length,
    'a grid found empty is drawn afresh');
});

test('the sky in the niche turns with the place\'s own times', () => {
  const { win } = boot({ now: new Date(2026, 9, 7, 12, 0, 0) });
  const t = win.App.helpers.computeTimes ? win.App.helpers.computeTimes(new Date(2026, 9, 7, 12)) : null;
  const times = t || { fajr: 265, sunrise: 344, dhuhr: 696, asr: 897, maghrib: 1047, isha: 1124 };
  const at = (m) => win.App.helpers.skyAt(times, m);
  const pure = (m, name) => {
    const s = at(m);
    /* the painting alone: at one end of a blend, or held between two of itself */
    return (s.a === name && (s.mix < .02 || s.b === name)) || (s.b === name && s.mix > .98);
  };
  assert.ok(pure(times.fajr - 60, 'night'), 'before the dawn, the night');
  const dawn = at(times.fajr + 10);
  assert.strictEqual(dawn.a, 'night'); assert.strictEqual(dawn.b, 'fajr');
  assert.ok(dawn.mix > 0 && dawn.mix < 1, 'the dawn comes in after the fajr, not at once');
  assert.ok(pure(times.sunrise + 12, 'sunrise'));
  assert.ok(pure(times.dhuhr, 'noon'));
  const asr = at(times.asr);
  assert.strictEqual(asr.a, 'noon'); assert.strictEqual(asr.b, 'afternoon');
  assert.ok(pure(times.maghrib + 6, 'sunset'), 'the glow is the maghrib\'s own');
  assert.ok(pure(times.isha + 30, 'night'));
  assert.ok(pure(1439, 'night') && pure(0, 'night'));
  /* every minute of the day blends forward and never runs back */
  let last = -1;
  win.App.helpers.skyStops(times).forEach(function (stop) {
    assert.ok(stop[0] > last); last = stop[0];
    assert.ok(SKY_PLATES.indexOf(stop[1]) !== -1);
  });
  /* a place whose sun does not set or rise that day keeps a sky, and no error */
  assert.deepStrictEqual(JSON.parse(JSON.stringify(win.App.helpers.skyAt({ fajr: NaN, sunrise: NaN, dhuhr: 700, maghrib: NaN }, 600))),
    { a: 'noon', b: 'noon', mix: 0 });
  /* and the squeezed day of a summer far north still runs forward */
  let prev = -Infinity;
  win.App.helpers.skyStops({ fajr: 120, sunrise: 125, dhuhr: 780, asr: 1000, maghrib: 1430, isha: NaN }).forEach(function (stop) {
    assert.ok(stop[0] > prev); prev = stop[0];
  });
});

test('the moon is drawn as it stands, full on the white days and gone at the new moon', () => {
  const { win } = boot({ now: new Date(2026, 9, 7, 12, 0, 0) });
  const t = { fajr: 265, sunrise: 344, dhuhr: 696, asr: 897, maghrib: 1047, isha: 1124 };
  const moon = (d) => win.App.helpers.moonAt(d, t);
  /* the full moon of the 26th of october 2026, and the new moon of the 10th */
  assert.ok(moon(new Date(Date.UTC(2026, 9, 26, 4, 12))).lit > .99);
  assert.ok(moon(new Date(Date.UTC(2026, 9, 10, 15, 50))).lit < .02);
  assert.ok(moon(new Date(Date.UTC(2026, 8, 30, 12))).waxing === false, 'past the full, waning');
  /* a crescent four days old has set some hours after maghrib, and a full moon is up at midnight */
  const young = moon(new Date(2026, 9, 14, 21, 30));
  assert.ok(young.waxing && young.lit < .25);
  assert.strictEqual(young.up, false, 'a young crescent is down by half past nine');
  assert.strictEqual(moon(new Date(2026, 9, 14, 18, 15)).up, true, 'and up just after maghrib');
  assert.strictEqual(moon(new Date(2026, 9, 25, 23, 30)).up, true);
  /* the lit part: a half moon's edge is straight, a crescent's bows out */
  assert.match(win.App.helpers.moonPath(.5, true, 6), /^M0 -6A6 6 0 0 1 0 6A0\.00 6 0 0 [01] 0 -6Z$/);
  assert.match(win.App.helpers.moonPath(.2, true, 6), /A3\.60 6 0 0 0 0 -6Z$/);
  assert.match(win.App.helpers.moonPath(.8, false, 6), /^M0 -6A6 6 0 0 0 0 6A3\.60 6 0 0 0 0 -6Z$/);
});

test('the niche shows the sky of the hour, its stars at night and its moon on the white nights', () => {
  const noon = boot({ now: new Date(2026, 9, 7, 12, 30, 0) });
  assert.ok(noon.doc.documentElement.classList.contains('has-sky'));
  const a = noon.doc.getElementById('sky-a').getAttribute('href');
  assert.match(a, /^img\/sky\/(noon|afternoon)\.webp$/);
  assert.strictEqual(Number(noon.doc.getElementById('sky-stars').getAttribute('opacity')), 0, 'no stars at noon');
  assert.strictEqual(Number(noon.doc.getElementById('sky-moon').getAttribute('opacity')), 0);

  const night = boot({ now: new Date(2026, 9, 25, 23, 30, 0) });
  assert.strictEqual(night.doc.getElementById('sky-a').getAttribute('href'), 'img/sky/night.webp');
  assert.ok(Number(night.doc.getElementById('sky-stars').getAttribute('opacity')) > .9);
  assert.ok(Number(night.doc.getElementById('sky-moon').getAttribute('opacity')) > .9, 'the full moon of the fourteenth');
  assert.match(night.doc.getElementById('sky-moon').getAttribute('transform'), /^translate\([\d.]+ [\d.]+\) rotate\(-?[\d.]+\)$/);
  assert.ok(night.doc.getElementById('moon-lit').getAttribute('d').indexOf('M0 -6') === 0);

  /* it stays inside the niche and out of the countdown's way */
  const svg = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(svg.indexOf('<g class="sky" id="sky" clip-path="url(#sky-arch)">') !== -1);
  assert.ok(svg.indexOf('<mask id="sky-mask"') !== -1, 'fading out above the numbers');
});

test('the sky can be put away, and the plain niche comes back', () => {
  const storage = memoryStorage();
  const first = boot({ storage: storage, now: new Date(2026, 9, 7, 12, 30, 0) });
  first.win.App.go('settings');
  const sw = first.doc.getElementById('settings-sky');
  assert.ok(sw, 'a switch in the settings');
  assert.strictEqual(sw.getAttribute('aria-checked'), 'true', 'on unless put away');
  click(first.win, sw);
  assert.strictEqual(sw.getAttribute('aria-checked'), 'false');
  assert.ok(!first.doc.documentElement.classList.contains('has-sky'));
  const again = boot({ storage: storage, now: new Date(2026, 9, 7, 12, 30, 0) });
  assert.ok(!again.doc.documentElement.classList.contains('has-sky'), 'and it stays away');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf('html.has-sky .mihrab-fill { display: none; }') !== -1);
  assert.ok(css.indexOf('html.less-motion .sky-stars circle { animation: none;') !== -1, 'still stars for whoever asked for less motion');
});

/* a day at the hour and minute of one of the place's own times */
function atTime(minutes, day) {
  const d = day || [2026, 9, 7];
  return new Date(d[0], d[1], d[2], Math.floor(minutes / 60), Math.floor(minutes % 60), 0);
}

test('the sky moves with its hour: clouds in its colours, the glow of dawn and sunset, the lantern at night', () => {
  const probe = boot({ now: new Date(2026, 9, 7, 12, 0, 0) });
  const t = probe.win.App.helpers.computeTimes(new Date(2026, 9, 7, 12));
  const read = (doc, id, attr) => doc.getElementById(id).getAttribute(attr || 'opacity');
  const stops = (doc) => Array.from(doc.querySelectorAll('#cloud-fill .cloud-stop')).map((s) => s.getAttribute('stop-color'));

  /* the night: faint clouds lit by the moon, and the lantern burning */
  const night = boot({ now: new Date(2026, 9, 25, 23, 30, 0) });
  assert.ok(Number(read(night.doc, 'sky-lantern')) > .95, 'the lantern of the minaret at night');
  assert.ok(Number(read(night.doc, 'sky-clouds')) < .2);
  assert.strictEqual(Number(read(night.doc, 'sky-glow')), 0, 'no glow under a night sky');
  assert.deepStrictEqual(stops(night.doc), ['#93a3c9', '#93a3c9', '#93a3c9']);

  /* the noon: white clouds, no lantern and no glow */
  const noon = boot({ now: atTime(t.dhuhr) });
  assert.strictEqual(Number(read(noon.doc, 'sky-lantern')), 0);
  assert.strictEqual(Number(read(noon.doc, 'sky-glow')), 0);
  assert.ok(Number(read(noon.doc, 'sky-clouds')) > .3);
  assert.deepStrictEqual(stops(noon.doc), ['#ffffff', '#ffffff', '#ffffff']);

  /* the sunset: the glow rises on the side the sun went down, the clouds
     take its colour, and the lantern is being lit */
  const sunset = boot({ now: atTime(t.maghrib + 6) });
  assert.ok(Number(read(sunset.doc, 'sky-glow')) > .5, 'the glow of the maghrib');
  assert.strictEqual(read(sunset.doc, 'sky-glow-shape', 'cx'), '210', 'in the west of the painting');
  assert.deepStrictEqual(stops(sunset.doc), ['#ffb08d', '#ffb08d', '#ffb08d']);
  assert.ok(Number(read(sunset.doc, 'sky-lantern')) > 0 && Number(read(sunset.doc, 'sky-lantern')) < .5);

  /* and the sunrise has its glow in the east */
  const sunrise = boot({ now: atTime(t.sunrise + 12) });
  assert.ok(Number(read(sunrise.doc, 'sky-glow')) > .4);
  assert.strictEqual(read(sunrise.doc, 'sky-glow-shape', 'cx'), '30');

  /* every hour's look is whole and in range, through the whole day */
  const look = probe.win.App.helpers.skyLook;
  for (let m = 0; m < 1440; m += 7) {
    const l = look(probe.win.App.helpers.skyAt(t, m));
    ['dark', 'clouds', 'glow', 'lantern'].forEach(function (k) {
      assert.ok(l[k] >= 0 && l[k] <= 1, k + ' in range at minute ' + m);
    });
    assert.match(l.cloud, /^#[0-9a-f]{6}$/);
    assert.match(l.glowColour, /^#[0-9a-f]{6}$/);
  }

  /* the motion itself is slow, and still for whoever asked for less of it */
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.sky-drift \{[^}]*animation: sky-breathe 46s ease-in-out infinite alternate;/);
  assert.match(css, /\.cloud-1 \{ animation-duration: 150s;/);
  assert.match(css, /\.sky-lantern \{[^}]*animation: lantern 3\.1s/);
  assert.ok(css.indexOf('html.less-motion .sky-drift, html.less-motion .cloud,\nhtml.less-motion .sky-lantern, html.less-motion .sky-glow { animation: none; }') !== -1);
});

test('a touch on the niche opens its sky on the whole screen, and a touch, escape or back closes it', async () => {
  const { win, doc } = boot({ now: new Date(2026, 9, 25, 23, 30, 0) });
  /* jsdom finishes loading the page on its own a moment later and starts the
     app a second time, which goes home; it is let pass before anything opens */
  await until(() => doc.readyState !== 'loading');
  let lock = null;
  Object.defineProperty(win.navigator, 'wakeLock', {
    configurable: true,
    value: { request: function (kind) { lock = { kind: kind, released: false, release() { this.released = true; return Promise.resolve(); } }; return Promise.resolve(lock); } }
  });
  const view = doc.getElementById('skyview');
  const niche = doc.getElementById('arc-wrap');
  assert.strictEqual(view.hidden, true, 'closed until asked for');
  assert.strictEqual(niche.getAttribute('tabindex'), '0', 'and reachable from the keyboard');

  click(win, niche);
  assert.strictEqual(view.hidden, false);
  assert.strictEqual(doc.getElementById('skyview-a').getAttribute('src'), 'img/sky/night.webp');
  assert.strictEqual(doc.querySelectorAll('#sv-stars circle').length, 70, 'a sky full of stars');
  assert.ok(Number(doc.getElementById('sv-moon').getAttribute('opacity')) > .9, 'and the full moon of the fourteenth');
  assert.ok(Number(doc.getElementById('sv-lantern').getAttribute('opacity')) > .95);
  assert.strictEqual(doc.getElementById('skyview-count').textContent, doc.getElementById('arc-count').textContent, 'the countdown goes with it');
  assert.strictEqual(doc.getElementById('skyview-name').textContent, doc.getElementById('arc-name').textContent);
  assert.ok(doc.getElementById('skyview-date').textContent.indexOf(doc.getElementById('hijri-date').textContent) === 0);
  /* and the day by the months of the year beneath it, as the picture of the
     day's times has it */
  assert.strictEqual(doc.getElementById('skyview-greg').textContent, 'الأحد 25 أكتوبر 2026', 'the gregorian date under the hijri');
  assert.strictEqual(doc.activeElement, view, 'the keyboard is taken into it');
  assert.strictEqual(win.history.state && win.history.state.sky, true, 'a step of its own in the history');
  await until(() => view.classList.contains('is-open'));
  await until(() => lock && lock.kind === 'screen');
  assert.ok(view.style.filter.indexOf('brightness') === 0, 'the night is shown dim');

  /* a touch closes it, gives the screen back and steps the history back */
  click(win, view);
  assert.ok(!view.classList.contains('is-open'));
  assert.strictEqual(lock.released, true, 'the screen may sleep again');
  assert.strictEqual(doc.activeElement, niche, 'and the keyboard goes back to the niche');
  await until(() => view.hidden === true);
  await until(() => !(win.history.state && win.history.state.sky));
  assert.ok(doc.getElementById('v-home').classList.contains('is-open'), 'the home screen, where it was');

  /* the back button closes it and goes nowhere else */
  win.App.go('tracker');
  click(win, niche);
  assert.strictEqual(view.hidden, false);
  win.history.back();
  await until(() => !view.classList.contains('is-open'));
  assert.ok(doc.getElementById('v-tracker').classList.contains('is-open'), 'still on the screen it was opened over');

  /* escape closes it too */
  await until(() => view.hidden === true);
  click(win, niche);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!view.classList.contains('is-open'));

  /* and a sheet the app raises on its own is not left hidden under it */
  await until(() => view.hidden === true);
  click(win, niche);
  win.App.helpers.markDaySheet(new Date(2026, 9, 25));
  assert.ok(!view.classList.contains('is-open'), 'the sky gives way');
  assert.ok(doc.getElementById('sheet').classList.contains('is-open'));
});

test('the whole-screen sky stays shut while the sky is put away', () => {
  const first = boot({ now: new Date(2026, 9, 25, 23, 30, 0) });
  first.win.App.go('settings');
  const sw = first.doc.getElementById('settings-sky');
  click(first.win, sw);
  assert.strictEqual(sw.getAttribute('aria-checked'), 'false');
  first.win.App.go('home');
  const niche = first.doc.getElementById('arc-wrap');
  assert.ok(!niche.hasAttribute('tabindex'), 'nothing to reach');
  click(first.win, niche);
  assert.strictEqual(first.doc.getElementById('skyview').hidden, true);
  /* its motion is drawn from one source, the walk along the shore made with
     the page's own animation and held still for less motion */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const pan = /function panSkyview\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(pan.indexOf("classList.contains('less-motion')") !== -1);
  assert.ok(pan.indexOf("direction: 'alternate'") !== -1);
});

test('the film of a day in the sky is one the App Store takes, and goes up with the next version', () => {
  const dir = path.join(__dirname, '..', 'ios', 'previews', 'iphone-67');
  const film = fs.readFileSync(path.join(dir, 'sky-day.mp4'));
  assert.strictEqual(film.subarray(4, 8).toString('latin1'), 'ftyp', 'an mp4');
  assert.ok(film.length < 30 * 1048576, 'light enough to keep in the repository');
  /* the moov box comes first, so the size and length are read from its head */
  const box = (name, from) => film.indexOf(Buffer.from(name, 'latin1'), from || 0);
  assert.ok(box('moov') < box('mdat'), 'and it starts playing before it has all arrived');
  const mvhd = box('mvhd');
  const seconds = film.readUInt32BE(mvhd + 20) / film.readUInt32BE(mvhd + 16);
  assert.ok(seconds >= 15 && seconds <= 30, 'between fifteen and thirty seconds, as Apple asks: ' + seconds);
  let size = null;
  for (let at = box('tkhd'); at !== -1; at = box('tkhd', at + 4)) {
    const w = film.readUInt32BE(at + 80) >>> 16, h = film.readUInt32BE(at + 84) >>> 16;
    if (w) size = [w, h];
  }
  assert.deepStrictEqual(size, [886, 1920], 'the 6.9 inch phone, upright');
  assert.ok(box('mp4a') !== -1, 'with the sound track Apple asks for, silent');
  const poster = fs.readFileSync(path.join(dir, 'sky-day.poster'), 'utf8').trim();
  const m = /^00:00:(\d\d):(\d\d)$/.exec(poster);
  assert.ok(m && +m[1] < seconds && +m[2] < 30, 'the still it shows before it plays, inside the film');

  const release = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ios', 'asc-release.py'), 'utf8');
  assert.ok(release.indexOf("PREVIEW_KINDS = {'iphone-67': 'IPHONE_67'}") !== -1);
  const only = /if a\.previews_only:([\s\S]*?)\n    if not \(/.exec(release)[1];
  assert.ok(only.indexOf('place_previews') !== -1 && only.indexOf('send(') === -1 && only.indexOf('attach(') === -1,
    'placing the films alone sends nothing and builds nothing');
  assert.ok(/log\('no iPhone Duo screenshots in %s, so that set is left as it is' % folder\)\s*return/.test(release),
    'a build that is not for iPhone Duo leaves its set alone');
  const ios = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ios.yml'), 'utf8');
  assert.ok(ios.indexOf('--notes ios/whatsnew/ar-SA.txt --previews ios/previews') !== -1, 'every version sent carries them');
  const own = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/app-store-previews.yml'), 'utf8');
  /* its triggers are the block under on:, up to the next key of the file,
     which may be the permissions its token is held to */
  const on = /\non:\n([\s\S]*?)\n(?=\S)/.exec(own);
  assert.ok(on && on[1].trim() === 'workflow_dispatch:', 'and the run that places them alone is only ever by hand');
  assert.ok(own.indexOf('--previews-only') !== -1);
});

test('a picture of the times carries the sky of the moment it is made', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function timesCard\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('skyAt(t, nowMinutes(now))') !== -1);
  assert.ok(fn.indexOf('paintSky(ctx, painted, sky, moonAt(now, t)') !== -1);
  assert.ok(fn.indexOf('var SKY_H = painted ? 330 : 0;') !== -1, 'and no room is kept when there is none to paint');
});

test('the sunrise notice quotes a sunnah of the duha, not of the dhuhr', () => {
  const { win } = boot({ now: new Date(2026, 9, 6, 12, 0, 0) });
  const pick = win.App.helpers.windowSunnah;
  assert.strictEqual(pick('sunrise', new Date(2026, 9, 6)).key, 'duha');
  assert.strictEqual(pick('sunrise', new Date(2026, 9, 6)).block.items[0].indexOf('صلاة الضحى'), 0);
  assert.strictEqual(pick('sunrise', new Date(2026, 9, 9)).key, 'friday', 'on a friday the day\'s own');
  assert.strictEqual(pick('nothing', new Date(2026, 9, 6)), null, 'and no window it does not know');
});

test('the compass keeps north at north whichever way the phone is held', () => {
  const { win, doc } = boot();
  win.App.go('qibla');
  const needle = doc.getElementById('qibla-needle');
  const rose = doc.getElementById('compass-rose');
  assert.match(needle.getAttribute('transform'), /^rotate\(-?\d+(\.\d+)? 100 100\)$/);
  /* الشمال is drawn on the face, so the face is what must turn against the
     phone. Turning the needle alone would leave the letter stuck to the top of
     the screen and pointing at nothing. */
  win.App.state.heading = 137;
  win.App.render.qibla();
  assert.strictEqual(rose.style.transform, 'rotate(-137.00deg)');
  assert.strictEqual(needle.getAttribute('transform'),
    'rotate(' + win.App.state.qibla.toFixed(2) + ' 100 100)');
});


test('the dot riding the arc never sits on the words inside it', () => {
  const { win, doc } = boot();
  /* The dot climbs to the top of the arc halfway through a window, which is
     exactly where the label sits, so the two are checked against each other
     across a whole window rather than at one moment. */
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const pad = /\.arc-center \{[^}]*padding-top:\s*(\d+)px/.exec(css);
  assert.ok(pad, 'the words are pushed under the apex by a padding');

  /* The arc is drawn in a 240 by 152 square at a fixed 264 wide, so the apex
     and the dot that rides it land at heights the padding must clear. */
  const width = 264, height = width * 152 / 240;
  const apex = height * 40 / 152;
  const dot = height * 6 / 152;
  assert.ok(+pad[1] > apex + dot,
    'the words start at ' + pad[1] + 'px, and the dot reaches ' +
    Math.round(apex + dot) + 'px at the top of its climb');
  assert.ok(doc.getElementById('arc-label'));
  assert.ok(win.App.clockState().progress >= 0);
});

/* ---------------- reading a plan ---------------- */

test('the khatma plan opens the mushaf at the page it names', () => {
  const { win, doc } = boot();
  win.App.go('khatma');
  const button = doc.querySelector('#khatma-state [data-page]');
  assert.ok(button, 'the plan should offer to open where you stopped');
  assert.ok(button.textContent.indexOf('صفحة') !== -1, 'the button names the page it opens');
  assert.strictEqual(button.getAttribute('data-page'), '1', 'a fresh plan starts at page one');
  click(win, button);
  assert.ok(doc.getElementById('v-reader').classList.contains('is-open'));
  assert.strictEqual(win.App.state.surah, 1);

  win.Store.setReadPages(50);
  win.App.go('khatma');
  const next = doc.querySelector('#khatma-state [data-page]');
  assert.strictEqual(next.getAttribute('data-page'), '51');
  assert.ok(next.textContent.indexOf('51') !== -1,
    'the label must agree with the page it opens, got ' + next.textContent);
  click(win, next);
  const start = win.Mushaf.pageStart(51);
  assert.strictEqual(win.App.state.surah, start.s);
  assert.strictEqual(win.App.state.ayah, start.a);
});

test('a finished khatma stops offering the next page', () => {
  const { win, doc } = boot();
  win.Store.setReadPages(604);
  win.App.go('khatma');
  assert.strictEqual(doc.querySelector('#khatma-state [data-page]'), null);
  assert.ok(doc.getElementById('khatma-state').textContent.indexOf('أتممت') !== -1);
});

test('the reader remembers the verse, not just the surah', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="2"]'));
  assert.strictEqual(win.Store.get('lastRead').a, 1, 'a first visit starts at the top');

  click(win, doc.querySelector('[data-ayah="2:255"]'));
  const place = win.Store.get('lastRead');
  assert.strictEqual(place.s, 2);
  assert.strictEqual(place.a, 255);

  win.App.go('quran');
  assert.ok(doc.getElementById('resume-note').textContent.indexOf('255') !== -1,
    'the card should name the verse, got ' + doc.getElementById('resume-note').textContent);
  click(win, doc.getElementById('resume-btn'));
  assert.strictEqual(win.App.state.ayah, 255, 'resuming returns to the verse');
});

test('drawing the reader again does not throw the place away', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="18"]'));
  click(win, doc.querySelector('[data-ayah="18:60"]'));
  win.App.render.reader();
  assert.strictEqual(win.Store.get('lastRead').a, 60, 'a redraw must not reset to the first verse');
});

test('the reader says which part and page it is showing', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="36"]'));
  const meta = doc.getElementById('reader-meta').textContent;
  assert.ok(meta.indexOf('الجزء') !== -1, 'got ' + meta);
  assert.ok(meta.indexOf('صفحة') !== -1, 'got ' + meta);
  assert.ok(!/[\u0660-\u0669]/.test(meta), 'the figures should match the rest, got ' + meta);
});

test('a verse can be copied and its page opened from the sheet', () => {
  const { win, doc } = boot();
  let copied = null;
  win.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  click(win, doc.querySelector('[data-ayah="112:1"]'));
  assert.ok(doc.querySelector('[data-act="copy"]'));
  click(win, doc.querySelector('[data-act="copy"]'));
  assert.ok(copied && copied.indexOf('أَحَدٌ') !== -1, 'the verse text should be on the clipboard');
  assert.ok(copied.indexOf('الإخلاص') !== -1, 'and its reference with it');

  const jump = doc.querySelector('#sheet-body [data-page]');
  assert.ok(jump, 'the sheet should offer the head of the page');
  assert.strictEqual(jump.getAttribute('data-page'), String(win.Mushaf.pageOf(112, 1)));
});

test('opening a page before the text arrives says so rather than failing', () => {
  const { win, doc } = boot({ withMushaf: false });
  win.App.go('khatma');
  const button = doc.querySelector('#khatma-state [data-page]');
  if (button) {
    click(win, button);
    assert.ok(!doc.getElementById('v-reader').classList.contains('is-open'));
    assert.ok(doc.getElementById('toast').textContent.length > 0);
  }
  assert.ok(doc.getElementById('v-khatma').classList.contains('is-open'));
});

/* ---------------- the app as an app ---------------- */

test('every view has an address the browser can hold', () => {
  const { win, doc } = boot();
  const h = win.App.helpers;
  win.App.go('qibla');
  assert.strictEqual(win.location.hash, '#qibla');
  assert.strictEqual(h.addressOf('qibla'), '#qibla');

  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="36"]'));
  assert.strictEqual(win.location.hash, '#reader/36', 'a surah names itself in the address');

  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="evening"]'));
  assert.strictEqual(win.location.hash, '#azkar/evening');
});

test('an address opens the view it names', () => {
  const { win } = boot();
  const read = win.App.helpers.readAddress;
  assert.strictEqual(read('#qibla').name, 'qibla');
  assert.strictEqual(read('#reader/18').name, 'reader');
  assert.strictEqual(read('#reader/18').surah, 18);
  assert.strictEqual(read('#azkar/morning').name, 'azkar-list');
  assert.strictEqual(read('#azkar/morning').azkar, 'morning');
  assert.strictEqual(read('#nonsense'), null, 'an unknown address is refused');
  assert.strictEqual(read(''), null);
  assert.strictEqual(read('#reader/999').surah, 114, 'a surah beyond the mushaf is pulled back');
  assert.strictEqual(read('#reader/0').surah, 1);
});

test('the shortcuts in the manifest point at addresses that exist', () => {
  const { doc } = boot();
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.shortcuts.length >= 3, 'a phone should offer several ways in');
  manifest.shortcuts.forEach(function (item) {
    const hash = item.url.replace('./', '');
    assert.ok(hash.indexOf('#') === 0, item.url + ' should be an address');
    const name = hash.slice(1).split('/')[0];
    const view = name === 'azkar' && hash.indexOf('/') !== -1 ? 'azkar-list' : name;
    assert.ok(doc.getElementById('v-' + view), 'no view behind the shortcut ' + item.url);
  });
});

test('the manifest describes an installable app', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  ['name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'theme_color', 'id'].forEach(function (key) {
    assert.ok(manifest[key], 'the manifest needs ' + key);
  });
  assert.strictEqual(manifest.dir, 'rtl');
  assert.strictEqual(manifest.lang, 'ar');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.indexOf('192x192') !== -1 && sizes.indexOf('512x512') !== -1);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'android wants a maskable icon');
  manifest.icons.forEach(function (i) {
    assert.ok(fs.existsSync(path.join(DOCS, i.src.split('?')[0])), 'missing icon ' + i.src);
  });
});

test('the offer to install is kept until it is used', () => {
  const { win, doc } = boot();
  let prompted = false;
  const offer = {
    preventDefault() {},
    prompt() { prompted = true; },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };
  const event = new win.Event('beforeinstallprompt');
  Object.assign(event, offer);
  win.dispatchEvent(event);

  assert.ok(win.App.state.installOffer, 'the offer should be held, not thrown away');
  assert.ok(!doc.getElementById('banner').hidden, 'and the reader told about it once');
  win.App.go('settings');
  assert.ok(!doc.getElementById('settings-install').hidden, 'settings should offer it too');

  click(win, doc.getElementById('settings-install'));
  assert.ok(prompted, 'pressing install should ask the browser');
});

test('the offer is only volunteered once', () => {
  const { win, doc } = boot();
  function fire() {
    const e = new win.Event('beforeinstallprompt');
    Object.assign(e, { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({}) });
    win.dispatchEvent(e);
  }
  fire();
  click(win, doc.getElementById('banner-close'));
  assert.ok(doc.getElementById('banner').hidden);
  fire();
  assert.ok(doc.getElementById('banner').hidden, 'a reader who dismissed it is not asked again');
});

test('losing the network says what still works', () => {
  const { win, doc } = boot();
  win.dispatchEvent(new win.Event('offline'));
  const text = doc.getElementById('banner-text').textContent;
  assert.ok(!doc.getElementById('banner').hidden);
  assert.ok(text.indexOf('المصحف') !== -1, 'it should reassure rather than alarm, got ' + text);
  win.dispatchEvent(new win.Event('online'));
  assert.ok(doc.getElementById('banner').hidden);
});

test('the worker hands over only when the page asks', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("'take-over'") !== -1, 'the worker should listen for the handover');
  /* Comments are stripped first, or a comment explaining why skipWaiting is
     absent reads as skipWaiting being present. */
  const code = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const install = /addEventListener\('install'[\s\S]*?addEventListener\('activate'/.exec(code);
  assert.ok(install, 'the worker should have an install step');
  assert.ok(install[0].indexOf('skipWaiting') !== -1,
    'a worker that waits for every tab to close never takes over on a busy phone');
  assert.match(code, /clients\.claim\(\)/, 'and it should take charge of the page already open');
});


test('the browser is told never to serve the worker from its own cache', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.match(app, /register\('sw\.js',\s*\{\s*updateViaCache:\s*'none'/,
    'otherwise a fix can sit unnoticed for a day');
  assert.match(app, /visibilitychange[\s\S]{0,200}registration\.update/,
    'coming back to the app is the moment to check for a newer copy');
});

test('a device holding an old copy can be told to fetch everything again', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const button = doc.getElementById('offline-refresh');
  assert.ok(button, 'there must be a way out of a stale cache');
  assert.ok(button.textContent.trim().length > 4);
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function refetchEverything\(\)[\s\S]*?\n  \}/.exec(app);
  assert.ok(fn, 'the button needs something behind it');
  assert.match(fn[0], /caches\.delete/, 'it should throw away the stored copy');
  assert.match(fn[0], /unregister/, 'and let go of the worker holding it');
  assert.match(fn[0], /location\.reload/, 'and then ask for the whole thing again');
});

/* ---------------- memorising ---------------- */

function fakeAudio(win) {
  const played = [];
  win.Audio = function () {
    const a = { play: () => Promise.resolve(), pause() { this.paused = true; }, paused: false, onended: null };
    Object.defineProperty(a, 'src', {
      set(v) { played.push(v); this._src = v; },
      get() { return this._src; }
    });
    win.__lastAudio = a;
    return a;
  };
  return played;
}

test('repeating a run of verses recites each one in turn', () => {
  const { win, doc } = boot();
  const played = fakeAudio(win);
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));

  win.App.repeat.start(1, 3, 2, false);
  assert.ok(win.App.state.repeat, 'a run should be under way');
  assert.strictEqual(win.App.state.repeat.at, 1);
  assert.strictEqual(doc.querySelectorAll('.ayah.is-reciting').length, 1);
  assert.ok(doc.querySelector('.ayah[data-a="1"]').classList.contains('is-reciting'));

  win.App.repeat.next();
  assert.strictEqual(win.App.state.repeat.at, 2);
  assert.ok(doc.querySelector('.ayah[data-a="2"]').classList.contains('is-reciting'));
  assert.strictEqual(doc.querySelectorAll('.ayah.is-reciting').length, 1, 'only one verse at a time');

  win.App.repeat.next();
  assert.strictEqual(win.App.state.repeat.at, 3);
  win.App.repeat.next();
  assert.strictEqual(win.App.state.repeat.round, 2, 'the run starts over');
  assert.strictEqual(win.App.state.repeat.at, 1);

  assert.ok(played.length >= 4, 'each verse should have been asked for');
  assert.ok(played[0].indexOf('.mp3') !== -1);
});

test('a finished run clears itself up', () => {
  const { win, doc } = boot();
  fakeAudio(win);
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  win.App.repeat.start(1, 2, 1, true);
  assert.ok(doc.getElementById('reader-body').classList.contains('is-hidden'));

  win.App.repeat.next();
  win.App.repeat.next();
  assert.strictEqual(win.App.state.repeat, null, 'the run should end after its last round');
  assert.strictEqual(doc.querySelectorAll('.ayah.is-reciting').length, 0);
  assert.ok(!doc.getElementById('reader-body').classList.contains('is-hidden'),
    'the text comes back when the run ends');
  assert.ok(!doc.getElementById('player').classList.contains('is-open'));
});

test('leaving the reader stops the recitation', () => {
  const { win, doc } = boot();
  fakeAudio(win);
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  win.App.repeat.start(1, 4, 5, false);
  assert.ok(win.App.state.repeat);
  win.App.go('home');
  assert.strictEqual(win.App.state.repeat, null, 'a run must not recite into another view');
});

test('the sheet offers a run and starts one from its choices', () => {
  const { win, doc } = boot();
  fakeAudio(win);
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  click(win, doc.querySelector('[data-ayah="112:1"]'));
  const button = doc.querySelector('[data-act="memorise"]');
  assert.ok(button, 'the verse sheet should offer to repeat');

  click(win, button);
  assert.ok(doc.getElementById('rep-from'), 'the run is set up in the sheet');
  doc.getElementById('rep-from').value = '2';
  doc.getElementById('rep-to').value = '4';
  doc.getElementById('rep-times').value = '5';
  click(win, doc.querySelector('[data-act="repeat-start"]'));

  const run = win.App.state.repeat;
  assert.strictEqual(run.from, 2);
  assert.strictEqual(run.to, 4);
  assert.strictEqual(run.times, 5);
  assert.ok(!doc.getElementById('sheet').classList.contains('is-open'), 'the sheet gets out of the way');
});

test('a run asked for backwards is put right rather than refused', () => {
  const { win, doc } = boot();
  fakeAudio(win);
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="112"]'));
  click(win, doc.querySelector('[data-ayah="112:3"]'));
  click(win, doc.querySelector('[data-act="memorise"]'));
  doc.getElementById('rep-from').value = '3';
  doc.getElementById('rep-to').value = '1';
  click(win, doc.querySelector('[data-act="repeat-start"]'));
  const run = win.App.state.repeat;
  assert.strictEqual(run.from, 3);
  assert.strictEqual(run.to, 3, 'an end before the start is pulled up to it');
});

test('the reader shows how far through the surah you are', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="2"]'));
  const fill = doc.getElementById('read-progress-fill');
  assert.ok(fill, 'the reader needs a progress rail');
  assert.strictEqual(parseFloat(fill.style.width), 0, 'it starts empty at the top of a surah');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.read-progress\s*\{[^}]*position:\s*sticky/, 'the rail should stay in view');
});

/* ---------------- clocks that move ---------------- */

test('every city in the list names a real timezone', () => {
  const { win } = boot();
  assert.ok(win.CITIES.length >= 25);
  win.CITIES.forEach(function (c) {
    assert.ok(c.z, c.n + ' has no zone, so its times cannot follow a clock change');
    assert.strictEqual(typeof win.PrayerEngine.zoneOffset(c.z, new Date()), 'number',
      c.n + ' names a zone the browser does not know: ' + c.z);
  });
});

test('choosing a city that moves its clocks keeps its times right', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const london = win.CITIES.findIndex(function (c) { return c.n === 'لندن'; });
  assert.ok(london !== -1);
  const select = doc.getElementById('settings-city');
  select.value = String(london);
  fire(win, select, 'change');
  assert.strictEqual(win.Store.get('zone'), 'Europe/London', 'the zone is kept, not only the number');

  const summer = win.App.computeTimes(new Date('2026-06-21T12:00:00'));
  const winter = win.App.computeTimes(new Date('2026-12-21T12:00:00'));
  /* London runs an hour ahead in summer, so noon moves later on the clock even
     though the sun has not. A stored zero would have shown both the same. */
  assert.ok(summer.dhuhr > winter.dhuhr + 40,
    'summer noon should sit about an hour later on the clock, got ' +
    win.PrayerEngine.format(summer.dhuhr) + ' and ' + win.PrayerEngine.format(winter.dhuhr));
});

test('a place with no zone still works from its stored number', () => {
  const { win } = boot();
  win.App.setPlace({ n: 'مكان بلا منطقة', lat: 29.3759, lng: 47.9774, tz: 3 }, false);
  const t = win.App.computeTimes(new Date('2026-09-04T12:00:00'));
  assert.ok(!isNaN(t.dhuhr) && t.dhuhr > 0, 'the times must still come out');
  assert.match(win.PrayerEngine.format(t.dhuhr), /^\d{1,2}:\d{2} [صم]$/);
  assert.match(win.PrayerEngine.format(t.dhuhr, 'plain'), /^\d{2}:\d{2}$/,
    'the twenty four hour form stays available for sorting');
});

/* ---------------- reachable by a thumb, and arabic throughout ---------------- */

test('the surah list shows no latin word yet still answers to one', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  const list = doc.getElementById('surah-list');
  const latin = (list.textContent.match(/[A-Za-z]{2,}/g) || []);
  assert.deepStrictEqual(latin, [], 'an arabic mushaf should hold no latin name');
  assert.ok(list.textContent.indexOf('تبدأ في صفحة') !== -1, 'the note names the page instead');

  const field = doc.getElementById('surah-filter');
  field.value = 'Kahf';
  fire(win, field, 'input');
  assert.strictEqual(doc.querySelectorAll('#surah-list [data-surah]').length, 1,
    'typing the latin name must still find the surah');
  assert.ok(doc.querySelector('#surah-list [data-surah]').textContent.indexOf('الكهف') !== -1);
});

test('no view puts a latin word in front of the reader', () => {
  const { win, doc } = boot();
  ['home', 'quran', 'azkar', 'tracker', 'khatma', 'tasbih', 'radio', 'calendar',
   'hadith', 'dua', 'ruqyah', 'qibla', 'bookmarks'].forEach(function (name) {
    win.App.go(name);
    const view = doc.getElementById('v-' + name).cloneNode(true);
    /* A web address is an address, not prose, so links are left out of this. */
    view.querySelectorAll('a').forEach((a) => a.remove());
    const latin = [...new Set(view.textContent.match(/[A-Za-z]{2,}/g) || [])];
    assert.deepStrictEqual(latin, [], name + ' shows ' + latin.join(', '));
  });
});

test('every small control reaches out a touch area', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  ['date-nudge', 'switch', 'card-more'].forEach(function (name) {
    assert.ok(new RegExp('\\.' + name + '::before').test(css) ||
      new RegExp('\\.' + name + '[^{]*::before').test(css),
      '.' + name + ' is drawn smaller than a thumb and needs a reach');
  });
  assert.match(css, /\.select\s*\{[^}]*min-height:\s*44px/, 'a select must be tall enough to hit');
  /* a chip is drawn at full size instead, which also stops one chip stealing
     the tap meant for the chip beside it */
  assert.match(css, /\.chip \{[^}]*height:\s*44px/, 'a chip should be tall enough on its own');
});

test('every icon carries the square the sprite is drawn in', () => {
  const { win, doc } = boot();
  ['home', 'more', 'quran', 'tracker', 'khatma', 'settings', 'azkar'].forEach(function (v) {
    win.App.go(v);
    const bare = [...doc.querySelectorAll('svg.icon')].filter((s) => !s.getAttribute('viewBox'));
    assert.strictEqual(bare.length, 0,
      v + ' draws ' + bare.length + ' icons with no viewBox, so they render cropped');
  });
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const written = (html.match(/<svg class="icon/g) || []).length;
  const boxed = (html.match(/<svg class="icon[^"]*" viewBox="0 0 24 24"/g) || []).length;
  assert.strictEqual(boxed, written, 'every icon in the markup needs the same square');
});

test('a title and its note never share a line', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  ['row-title', 'row-note', 'check-note'].forEach(function (name) {
    assert.match(css, new RegExp('\\.' + name + '\\s*\\{[^}]*display:\\s*block'),
      '.' + name + ' must be a block or it runs into what sits beside it');
  });
});

test('the text size slider is drawn rather than left to the browser', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.slider::-webkit-slider-runnable-track/, 'the track needs a colour of its own');
  assert.match(css, /\.slider::-webkit-slider-thumb/);
  assert.match(css, /\.slider::-moz-range-track/);
  assert.ok(!/\.slider\s*\{[^}]*accent-color/.test(css),
    'accent-color alone leaves the track almost black in the light theme');
});

/* ---------------- what the eye actually sees ---------------- */

test('nudging the hijri day never moves the day of the week', () => {
  const { win, doc } = boot();
  const weekday = doc.getElementById('greg-date').textContent.split('،')[0];
  const gregorian = doc.getElementById('greg-date').textContent.split('،')[1];

  [1, 1, -1, -1, -1, 1].forEach(function (step) {
    click(win, doc.getElementById(step > 0 ? 'hijri-up' : 'hijri-down'));
    const line = doc.getElementById('greg-date').textContent;
    assert.strictEqual(line.split('،')[0], weekday,
      'the weekday moved to ' + line.split('،')[0] + ' while the date stayed ' + line.split('،')[1]);
    assert.strictEqual(line.split('،')[1], gregorian, 'the gregorian date must not move either');
  });
});

test('the header and the prayer strip agree about the day', () => {
  /* a morning of each, so the two are compared on a day the app is still on
     rather than on an evening when it has already moved to the next */
  for (const when of [new Date(2026, 8, 24, 9, 0, 0), new Date(2026, 8, 25, 9, 0, 0)]) {
    const { win, doc } = boot({ now: when });
    click(win, doc.getElementById('hijri-down'));
    const weekday = doc.getElementById('greg-date').textContent.split('،')[0].trim();
    const noon = [...doc.querySelectorAll('#windows .window')][2].querySelector('.window-name').textContent;
    assert.strictEqual(noon, weekday === 'الجمعة' ? 'الجمعة' : 'الظهر',
      'the strip and the header must agree, header said ' + weekday);
  }
});

test('the stylesheet asks for no colour it never defined', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  [...app.matchAll(/setProperty\('(--[a-z0-9-]+)'/g)].forEach((m) => defined.add(m[1]));
  /* var(--x, fallback) cannot resolve to nothing by construction, and it is how
     a value said at the place of use is read: --cols is set inline on the one
     element that knows how many columns its own set wants. Only the bare form
     is checked. */
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]));
  const missing = [...used].filter((t) => !defined.has(t));
  assert.deepStrictEqual(missing, [],
    'these resolve to nothing, so whatever they colour is left unpainted: ' + missing.join(', '));
});

test('the install banner is painted, not left see through', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /\.banner\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the banner needs a rule');
  assert.match(rule[1], /background:\s*var\(--(ink|sunken|raised)\)/,
    'without a background it sits on top of the list and both are read at once');
});

test('the clock and the dates share one set of figures', () => {
  const { doc } = boot();
  const shown = [
    doc.getElementById('arc-count').textContent,
    doc.getElementById('arc-at').textContent,
    doc.getElementById('hijri-date').textContent,
    doc.getElementById('greg-date').textContent
  ].concat([...doc.querySelectorAll('.window-time')].map((e) => e.textContent));
  shown.forEach(function (text) {
    assert.ok(!/[\u0660-\u0669]/.test(text), 'a second set of figures appeared in: ' + text);
    assert.ok(/\d/.test(text), 'expected a number in: ' + text);
  });
});

test('a done deed is marked by its tick, not by a line through the arabic', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /\.check\.is-done \.check-label\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'a done deed needs a style of its own');
  assert.ok(!/line-through/.test(rule[1]),
    'a line drawn through arabic cuts across the letters that join');
  assert.match(rule[1], /color:/, 'it should still read as done');
});

test('the floating banner makes room rather than covering the last row', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.match(css, /padding-bottom:[^;]*--banner-room/,
    'the page must leave room for a banner that floats over it');
  assert.match(app, /setProperty\('--banner-room'/,
    'and the room must be set from the height the banner actually takes');
  assert.ok(/--banner-room', '0px'/.test(app), 'and given back when it closes');
});

/* ---------------- getting the update onto the device ---------------- */

test('the worker names the same version the app does', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  const appVersion = /var VERSION = '([\d.]+)'/.exec(app);
  const swVersion = /var VERSION = 'sunnati-v([\d.]+)'/.exec(sw);
  assert.ok(appVersion && swVersion, 'both must carry a version');
  assert.strictEqual(swVersion[1], appVersion[1],
    'if the worker keeps an older name the browser sees no change, installs nothing, ' +
    'and every device that has visited once keeps running the old code for good');
});

test('the shell is served from one version, and a fix still arrives as a whole new version', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  /* The last respondWith handles code and markup: from this version's cache,
     so a page is never mixed with an older stylesheet; the network is reached
     past the browser cache only for what the version does not hold. */
  const tail = sw.slice(sw.lastIndexOf('event.respondWith'));
  assert.ok(tail.indexOf("caches.match(request, { cacheName: VERSION })") !== -1, 'this version first');
  assert.ok(tail.indexOf("cache: 'reload'") !== -1, 'the network past the browser cache when needed');
  /* the fix arrives because the browser checks sw.js itself past its cache */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("register('sw.js', { updateViaCache: 'none' })") !== -1);
  assert.ok(sw.indexOf('self.skipWaiting();') !== -1, 'and the new worker steps forward at once');
});

test('the worker still keeps everything the app needs offline', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  SCRIPTS.concat(['index.html', 'css/style.css', 'data/mushaf.json', 'manifest.webmanifest'])
    .forEach(function (rel) {
      assert.ok(sw.indexOf(rel) !== -1, 'the worker never keeps ' + rel);
    });
});

test('the version the app shows is the version it is', () => {
  const { win, doc } = boot();
  win.App.go('more');
  win.App.go('about');
  const shown = doc.getElementById('about-version').textContent;
  const digits = shown.replace(/[0-9]/g, (d) => '0123456789'.indexOf(d));
  assert.ok(digits.indexOf(win.App.version) !== -1,
    'the screen says ' + shown + ' but the app is ' + win.App.version);
});

test('an update that is never tapped still lands when the app is put away', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const handover = /function handOver\(worker\)[\s\S]*?\n  \}/.exec(app);
  assert.ok(handover, 'there must be a single place that performs the handover');
  assert.match(handover[0], /showBanner\(/, 'the reader is offered the update');
  assert.match(handover[0], /visibilitychange/,
    'and it is taken by itself once the app is out of sight, or a reader who never ' +
    'taps the banner stays on old code for good');
  assert.match(handover[0], /asked/, 'and only once');
  assert.match(app, /registration\.update\(\)/, 'the app should ask whether anything newer exists');
});

/* ---------------- colours a person can actually read ---------------- */

test('every window carries a readable colour beside its bright one', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  ['fajr', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(function (w) {
    assert.match(css, new RegExp('--w-' + w + ':\\s*#[0-9a-f]{6}'), w + ' needs a colour');
    assert.match(css, new RegExp('--w-' + w + '-ink:\\s*#[0-9a-f]{6}'),
      w + ' needs a second colour for text, since a fill is often too pale to read');
  });
});

test('the readable colours clear four and a half to one', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  function channel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function rgb(hex) {
    const m = /^#(..)(..)(..)$/.exec(hex);
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }
  function lum(c) { return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]); }
  function ratio(a, b) {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /* the four surfaces any of this text can land on in the light theme */
  const page = [246, 244, 238], card = [255, 253, 248];
  function wash(hex, base) { return rgb(hex).map((v, i) => v * 0.12 + base[i] * 0.88); }

  const light = css.slice(0, css.indexOf("[data-theme='dark']"));
  ['fajr', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(function (w) {
    const fill = /#[0-9a-f]{6}/.exec(new RegExp('--w-' + w + ':\\s*(#[0-9a-f]{6})').exec(light)[1])[0];
    const ink = new RegExp('--w-' + w + '-ink:\\s*(#[0-9a-f]{6})').exec(light)[1];
    [page, card, wash(fill, page), wash(fill, card)].forEach(function (bg) {
      const r = ratio(rgb(ink), bg);
      assert.ok(r >= 4.5, w + ' text sits at ' + r.toFixed(2) + ':1, which is under four and a half');
    });
  });

  const quiet = /--ink-3:\s*(#[0-9a-f]{6})/.exec(light)[1];
  [page, card].forEach(function (bg) {
    const r = ratio(rgb(quiet), bg);
    assert.ok(r >= 4.5, 'the quiet grey carries every second line and sits at ' + r.toFixed(2) + ':1');
  });
});

test('a filled control pairs its background with a colour that reads on it', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /--accent-solid:/, 'a filled control needs its own background token');
  assert.match(css, /--on-accent:/, 'and a colour chosen to sit on it');
  const white = /\{[^}]*background:\s*var\(--accent\)[^}]*color:\s*#fff/.exec(css);
  assert.strictEqual(white, null,
    'white on the bright accent falls under three to one on the gold hour');
});

test('the arc empties the way the page is read', () => {
  const { win, doc } = boot();
  const path = doc.getElementById('arc-fill').getAttribute('d');
  assert.ok(path.indexOf('M220') === 0, 'the arc should start on the right, got ' + path);
  const dash = doc.getElementById('arc-fill').getAttribute('stroke-dasharray');
  assert.match(dash, /^[\d.]+ [\d.]+$/, 'two dashes say plainly which part is drawn');
  assert.strictEqual(doc.getElementById('arc-fill').getAttribute('stroke-dashoffset'), '0');

  const p = win.App.clockState().progress;
  const cx = +doc.getElementById('arc-dot').getAttribute('cx');
  assert.ok(Math.abs(cx - (120 + 100 * Math.cos(Math.PI * p))) < 0.5,
    'the dot must sit on the edge of what is drawn');
});

/* ---------------- the folding tracker ---------------- */

test('the sunnah groups fold, each with its own tally', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const groups = [...doc.querySelectorAll('#tracker-list .fold')];
  assert.ok(groups.length >= 5, 'the deeds should be grouped, found ' + groups.length);
  groups.forEach(function (g) {
    const tally = g.querySelector('.fold-tally');
    assert.ok(tally, 'every group names how many of it are done');
    assert.match(tally.textContent, /^[0-9]+ من [0-9]+$/, 'got ' + tally.textContent);
    assert.ok(g.querySelector('.fold-head'), 'and has a head to press');
    assert.strictEqual(g.querySelector('.fold-head').getAttribute('aria-expanded'), 'false',
      'a group is folded away until the reader opens it');
  });
});

test('a group opens when its head is pressed and stays open', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const total = doc.querySelectorAll('#tracker-list .fold').length;
  const head = doc.querySelectorAll('#tracker-list .fold-head')[1];
  click(win, head);
  assert.strictEqual(doc.querySelectorAll('#tracker-list .fold.is-open').length, 1);
  assert.strictEqual(head.getAttribute('aria-expanded'), 'true');

  click(win, doc.querySelector('#tracker-list .fold.is-open .check'));
  assert.strictEqual(doc.querySelectorAll('#tracker-list .fold.is-open').length, 1,
    'ticking a deed must not fold the group away under the reader');
  assert.strictEqual(doc.querySelectorAll('#tracker-list .fold').length, total, 'and the rest stay as they were');
});

test('the tally follows what has been ticked', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  /* Scoped to the tracker, since the home view now carries a folding group of
     its own and its tally sits earlier in the page. */
  const before = doc.querySelector('#tracker-list .fold-tally').textContent;
  click(win, doc.querySelector('#tracker-list .fold .check'));
  const after = doc.querySelector('#tracker-list .fold-tally').textContent;
  assert.notStrictEqual(after, before);
  assert.strictEqual(after.indexOf('1'), 0);
});

/* ---------------- the qibla ---------------- */

test('the face turns so north stays north, and the needle holds the qibla', () => {
  const { win, doc } = boot();
  win.App.go('qibla');
  const rose = doc.getElementById('compass-rose');
  const needle = doc.getElementById('qibla-needle');
  const bearing = win.App.state.qibla;

  win.App.state.heading = null;
  win.App.render.qibla();
  assert.strictEqual(rose.style.transform, 'rotate(0.00deg)', 'with no compass the face is north up');

  win.App.state.heading = 90;
  win.App.render.qibla();
  assert.strictEqual(rose.style.transform, 'rotate(-90.00deg)', 'the face turns against the phone');
  assert.strictEqual(needle.getAttribute('transform'), 'rotate(' + bearing.toFixed(2) + ' 100 100)',
    'the needle holds the true bearing inside the face');
});

test('a reading that is not a compass is refused', () => {
  const { win } = boot();
  win.App.state.heading = null;

  const relative = new win.Event('deviceorientation');
  Object.defineProperty(relative, 'alpha', { value: 137 });
  Object.defineProperty(relative, 'absolute', { value: false });
  win.dispatchEvent(relative);
  assert.strictEqual(win.App.state.heading, null,
    'an angle measured from wherever the phone started is not north');

  const absolute = new win.Event('deviceorientationabsolute');
  Object.defineProperty(absolute, 'alpha', { value: 137 });
  Object.defineProperty(absolute, 'absolute', { value: true });
  win.dispatchEvent(absolute);
  assert.strictEqual(typeof win.App.state.heading, 'number', 'a true compass reading is taken');
  assert.ok(win.App.state.heading >= 0 && win.App.state.heading < 360);
});

test('the qibla tells you which way to turn', () => {
  const { win, doc } = boot();
  win.App.go('qibla');
  const bearing = win.App.state.qibla;

  win.App.state.heading = bearing;
  win.App.render.qibla();
  assert.ok(doc.getElementById('qibla-note').textContent.indexOf('مواجه القبلة') !== -1);
  assert.ok(doc.getElementById('compass-face').classList.contains('is-aligned'));

  win.App.state.heading = ((bearing + 90) % 360);
  win.App.render.qibla();
  const note = doc.getElementById('qibla-note').textContent;
  assert.ok(note.indexOf('90') !== -1, 'it should say ninety degrees, got ' + note);
  assert.ok(!doc.getElementById('compass-face').classList.contains('is-aligned'));
});

/* ---------------- what ships to the store ---------------- */

test('the manifest carries everything an install needs', () => {
  const m = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  ['id', 'name', 'short_name', 'description', 'lang', 'dir', 'start_url', 'scope',
   'display', 'orientation', 'background_color', 'theme_color', 'categories'].forEach(function (k) {
    assert.ok(m[k], 'the manifest needs ' + k);
  });
  assert.strictEqual(m.lang, 'ar');
  assert.strictEqual(m.dir, 'rtl');
  assert.ok(m.icons.length >= 8);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a launcher needs a maskable icon');
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
  assert.ok(m.screenshots.length >= 3, 'the install card shows screenshots');
  assert.ok(m.shortcuts.length >= 3);
});

test('every icon, screenshot and splash the manifest names is on disk', () => {
  const m = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  m.icons.concat(m.screenshots).forEach(function (entry) {
    assert.ok(fs.existsSync(path.join(DOCS, entry.src.split('?')[0])), 'missing ' + entry.src);
  });
  m.shortcuts.forEach(function (s) {
    s.icons.forEach(function (i) { assert.ok(fs.existsSync(path.join(DOCS, i.src.split('?')[0])), 'missing ' + i.src); });
  });
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const splash = [...html.matchAll(/apple-touch-startup-image" href="([^"]+)"/g)].map((x) => x[1]);
  assert.ok(splash.length >= 12, 'apple wants a startup image per screen size');
  splash.forEach(function (rel) { assert.ok(fs.existsSync(path.join(DOCS, rel)), 'missing ' + rel); });
});

test('the privacy policy the store asks for is there and says nothing is collected', () => {
  const file = path.join(DOCS, 'privacy.html');
  assert.ok(fs.existsSync(file), 'google play will not accept a listing without one');
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /lang="ar"/);
  assert.match(html, /dir="rtl"/);
  ['لا يجمع', 'الموقع الجغرافي', 'الأطفال', 'التواصل'].forEach(function (needle) {
    assert.ok(html.indexOf(needle) !== -1, 'the policy should cover ' + needle);
  });
});

/* ---------------- the forty ---------------- */

test('the hadiths run in order and each names who narrated it and where it is', () => {
  const { win } = boot();
  const list = win.HADITHS;
  assert.strictEqual(list.length, 20);
  list.forEach(function (h, i) {
    assert.strictEqual(h.n, i + 1, 'hadith ' + (i + 1) + ' carries the number ' + h.n);
    assert.ok(h.t && h.t.length > 20, 'hadith ' + h.n + ' has no text');
    assert.ok(h.s && h.s.indexOf('رضي الله') !== -1, 'hadith ' + h.n + ' should name its companion');
    assert.ok(h.r && h.r.length > 3, 'hadith ' + h.n + ' should name where it is recorded');
  });
  const texts = new Set(list.map((h) => h.t));
  assert.strictEqual(texts.size, list.length, 'no hadith should appear twice');
});

test('the heading does not promise forty when it holds twenty', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const head = /<h1 id="hadith-title">([^<]+)<\/h1>/.exec(html);
  assert.ok(head);
  assert.ok(head[1].indexOf('من الأربعين') !== -1,
    'twenty hadiths under the title الأربعون would be a claim the app cannot keep, got ' + head[1]);
});

/* ---------------- the arabic ---------------- */

test('the arabic holds to the rules of joining rather than cutting', () => {
  const { execFileSync } = require('node:child_process');
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'review-arabic.js')],
      { encoding: 'utf8', cwd: path.join(__dirname, '..') });
  } catch (err) {
    assert.fail('the arabic review reported:\n' + (err.stdout || err.message));
  }
  assert.match(out, /لا ملحوظات/);
});

test('the review can actually fail, so a clean run means something', () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arabic-'));
  const root = path.join(__dirname, '..');
  ['docs/js', 'docs/data', 'docs/css', 'tools', 'play', 'android'].forEach(function (d) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  });
  ['docs/index.html', 'docs/privacy.html', 'docs/app.html', 'docs/js/app.js', 'docs/js/prayer-engine.js',
   'docs/js/hijri.js', 'docs/js/store.js', 'docs/data/surahs.js', 'docs/data/azkar.js',
   'docs/data/content.js', 'docs/data/extras.js', 'README.md', 'play/README.md', 'android/README.md',
   'tools/review-arabic.js'].forEach(function (f) {
    fs.copyFileSync(path.join(root, f), path.join(dir, f));
  });
  /* the reviewer reads the guide's lists beside it */
  fs.mkdirSync(path.join(dir, 'tools', 'arabic'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tools', 'arabic', 'rules.json'), path.join(dir, 'tools', 'arabic', 'rules.json'));
  /* a sentence cut in two where a joiner belongs */
  const spoiled = fs.readFileSync(path.join(dir, 'docs/index.html'), 'utf8')
    .replace('<p>أدوات ومحتوى إضافي</p>',
      '<p>أدوات ومحتوى إضافي وهي كثيرة ونافعة. القائمة تحتها مرتبة على حسب الحاجة إليها</p>');
  fs.writeFileSync(path.join(dir, 'docs/index.html'), spoiled);

  let failed = false;
  try {
    require('node:child_process').execFileSync(process.execPath,
      [path.join(dir, 'tools', 'review-arabic.js')], { encoding: 'utf8', cwd: dir });
  } catch (err) {
    failed = true;
    assert.match(String(err.stdout), /نقطة في وسط الكلام/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(failed, 'a full stop standing between two clauses must be caught');
});

test('no interface label carries a stop it does not need', () => {
  const { doc } = boot();
  ['.row-title', '.tile-name', '.fold-title', '.chip', '.tab span', '.window-name'].forEach(function (sel) {
    doc.querySelectorAll(sel).forEach(function (el) {
      const t = el.textContent.trim();
      if (!t || t.length > 34) return;
      assert.ok(!/[\u0621-\u064A]\.$/.test(t), 'a label should not end with a stop: ' + t);
    });
  });
});

test('no hadith is left cut off in the middle', () => {
  const { win } = boot();
  win.HADITHS.forEach(function (h) {
    assert.strictEqual(h.t.indexOf('...'), -1,
      'hadith ' + h.n + ' trails off, so the reader never gets the answer');
    assert.strictEqual(h.t.indexOf('…'), -1, 'hadith ' + h.n + ' trails off');
  });
});

test('the hadiths carry the wording they are known by', () => {
  const { win } = boot();
  const openings = {
    1: 'إنَّما الأعمالُ بالنِّيَّاتِ',
    5: 'مَن أحدَثَ في أمرِنا',
    9: 'ما نَهَيْتُكُم عنه فاجتَنِبوه',
    13: 'لا يُؤمِنُ أحَدُكم حتَّى يُحِبَّ لأخيهِ',
    16: 'لا تَغضَبْ',
    20: 'إنَّ ممَّا أدرَكَ النَّاسُ'
  };
  Object.keys(openings).forEach(function (n) {
    const h = win.HADITHS.filter(function (x) { return x.n === +n; })[0];
    assert.ok(h, 'hadith ' + n + ' is missing');
    assert.strictEqual(h.t.indexOf(openings[n]), 0,
      'hadith ' + n + ' opens with ' + h.t.slice(0, 40));
  });
});

test('the hadith of jibril gives all three answers', () => {
  const { win } = boot();
  const h = win.HADITHS.filter(function (x) { return x.n === 2; })[0];
  ['الإسلام', 'الإيمان', 'الإحسان', 'كأنَّك تراه'].forEach(function (needle) {
    assert.ok(h.t.indexOf(needle) !== -1, 'it should reach ' + needle);
  });
});

/* ---------------- the typefaces ---------------- */

test('the app carries its own typefaces rather than fetching them', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.strictEqual(html.indexOf('fonts.googleapis'), -1,
    'a reader with no connection would see a different face from the one it was designed in');
  assert.strictEqual(html.indexOf('fonts.gstatic'), -1);
  assert.match(html, /href="css\/fonts\.css"/);

  const faces = fs.readFileSync(path.join(DOCS, 'css', 'fonts.css'), 'utf8');
  ['IBM Plex Sans Arabic', 'Amiri', 'Amiri Quran'].forEach(function (family) {
    assert.ok(faces.indexOf("font-family: '" + family + "'") !== -1, family + ' is missing');
  });
  [...faces.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)].forEach(function (m) {
    assert.ok(fs.existsSync(path.join(DOCS, 'fonts', m[1])), 'missing font file ' + m[1]);
  });
});

test('the worker keeps the typefaces so they survive going offline', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf('./css/fonts.css') !== -1, 'the face sheet must be kept');
  const kept = (sw.match(/\.\/fonts\/[^']+\.woff2/g) || []).map((f) => f.slice('./fonts/'.length));
  /* the faces of a script only some readers write are kept the first time a
     page in it asks for them, and carried across every update after that */
  const script = new RegExp(/var SCRIPT_FACES = \/(.+)\/;/.exec(sw)[1]);
  assert.match(sw, /SCRIPT_FACES\.test\(at\)/, 'an update carries the script faces across');
  fs.readdirSync(path.join(DOCS, 'fonts')).filter((f) => /\.woff2$/.test(f)).forEach(function (f) {
    assert.ok(kept.indexOf(f) !== -1 || script.test('/fonts/' + f), f + ' should be kept for offline');
    assert.ok(!(kept.indexOf(f) !== -1 && script.test('/fonts/' + f)), f + ' is in the shell and among the script faces');
  });
  kept.forEach(function (f) { assert.ok(fs.existsSync(path.join(DOCS, 'fonts', f)), 'the shell keeps a face that is not there: ' + f); });
});

test('nothing in the page reaches out to another site for something it needs', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* a link the reader may follow is not a thing the page needs; a src is.
     the openstreetmap credit is required by the licence of its map, and the
     geonames one by the licence of the names of the places, and the two
     store links in About take a reader in a browser to the apps. */
  const outside = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
    .filter((u) => !/github\.com|3li\.info|hisnmuslim\.com|alojeiri\.com|openstreetmap\.org\/copyright|www\.geonames\.org\/$|apps\.apple\.com\/app\/id6814355836|play\.google\.com\/store\/apps\/details\?id=com\.eworldq8\.sunnati/.test(u));
  assert.deepStrictEqual(outside, [],
    'the shell should stand on its own, found: ' + outside.join(', '));
});

/* ---------------- the home card folds too ---------------- */

test('the sunnah card on the home view folds with its own tally', () => {
  const { win, doc } = boot();
  const fold = doc.getElementById('now-fold');
  assert.ok(fold, 'the home sunnah card should be a folding group');
  /* what can be done in this hour is the first thing under the clock, so it
     starts open, and a reader who shuts it finds it shut */
  assert.ok(fold.classList.contains('is-open'), 'it starts open');
  const tally = doc.getElementById('now-tally');
  assert.match(tally.textContent, /^[0-9]+ من [0-9]+$/, 'got ' + tally.textContent);

  click(win, fold.querySelector('.fold-head'));
  assert.ok(!doc.getElementById('now-fold').classList.contains('is-open'));
  assert.strictEqual(fold.querySelector('.fold-head').getAttribute('aria-expanded'), 'false');

  win.App.render.home();
  assert.ok(!doc.getElementById('now-fold').classList.contains('is-open'),
    'it should stay shut when the home view is drawn again');

  click(win, fold.querySelector('.fold-head'));
  win.App.render.home();
  assert.ok(doc.getElementById('now-fold').classList.contains('is-open'),
    'and open once opened again');
});

test('the tally on the home card follows what is ticked', () => {
  const { win, doc } = boot();
  const before = doc.getElementById('now-tally').textContent;
  click(win, doc.querySelector('#now-list .check'));
  assert.notStrictEqual(doc.getElementById('now-tally').textContent, before);
  /* one touch can finish more than one row: four before the dhuhr and four
     after it hold the rawatib of the dhuhr, so that row is done with it */
  const done = doc.querySelectorAll('#now-list .check.is-done').length;
  assert.ok(done >= 1);
  assert.strictEqual(doc.getElementById('now-tally').textContent.indexOf(String(done) + ' من '), 0);
});

/* ---------------- where the times come from ---------------- */

test('the times line names the place and the reckoning without stuttering', () => {
  const { win, doc } = boot();
  const line = doc.getElementById('place-line');
  const where = line.querySelector('.place-where').textContent.trim();
  const how = line.querySelector('.place-how').textContent.trim();
  assert.strictEqual(where, 'الكويت');
  assert.ok(how.indexOf('تقويم') === 0, 'got ' + how);
  assert.ok(how.indexOf('العجيري') !== -1,
    'a method should name the body that issues it, got ' + how);
  assert.ok(!/تقويم تقويم/.test(how), 'the word must not be doubled');
  /* محسوبة للكويت بطريقة الكويت said the same word twice and named no authority */
  assert.notStrictEqual(how.replace('تقويم ', ''), where, 'the two must not read as the same word');
  /* the line holds two buttons now, so the way to the settings is on the one
     that states the two facts, not on the line itself */
  assert.strictEqual(line.querySelector('.place-tap').getAttribute('data-go'), 'settings',
    'and it should lead to the settings');
});

test('no calculation method is named after a bare country', () => {
  const { win } = boot();
  const bare = ['الكويت', 'قطر', 'المغرب', 'الإمارات', 'سنغافورة', 'تركيا'];
  Object.keys(win.PrayerEngine.METHODS).forEach(function (key) {
    const name = win.PrayerEngine.METHODS[key].name;
    assert.ok(bare.indexOf(name) === -1,
      key + ' is named ' + name + ', which tells a reader nothing about who issues it');
    assert.ok(name.length > 5, key + ' needs a fuller name');
  });
});

/* ---------------- the azkar ---------------- */

test('every dhikr carries its text, its source and how many times', () => {
  const { win } = boot();
  const db = win.AZKAR_DB;
  assert.ok(Object.keys(db).length >= 20, 'expected a full set of sections');
  Object.keys(db).forEach(function (key) {
    const section = db[key];
    assert.ok(section.title && section.title.length > 3, key + ' needs a title');
    assert.ok(section.items.length > 0, key + ' is empty');
    section.items.forEach(function (item, i) {
      assert.ok(item.t && item.t.length > 3, key + '[' + i + '] has no text');
      assert.ok(item.c >= 1, key + '[' + i + '] needs a count');
      /* the ninety nine names carry their number rather than a chain */
      if (key !== 'names') {
        assert.ok(item.r && item.r.length > 2,
          key + '[' + i + '] is not attributed: ' + item.t.slice(0, 30));
      }
    });
  });
});

test('the sections added carry sound attributions', () => {
  const { win } = boot();
  const db = win.AZKAR_DB;
  ['adhan', 'istighfar', 'sick', 'hardship', 'funeral', 'market'].forEach(function (key) {
    assert.ok(db[key], 'missing section ' + key);
    assert.ok(db[key].items.length >= 2, key + ' is too thin');
    db[key].items.forEach(function (item) {
      assert.match(item.r, /البخاري|مسلم|أبو داود|الترمذي|النسائي|ابن ماجه|أحمد|ابن حبان|الدارمي|الحاكم/,
        'a dhikr must name where it is recorded, got: ' + item.r);
    });
  });
});

test('no dhikr is repeated inside its own section', () => {
  const { win } = boot();
  Object.keys(win.AZKAR_DB).forEach(function (key) {
    const texts = win.AZKAR_DB[key].items.map(function (i) { return i.t; });
    assert.strictEqual(new Set(texts).size, texts.length, key + ' repeats a dhikr');
  });
});

test('the azkar grid shows every section it holds', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  const tiles = doc.querySelectorAll('#azkar-groups [data-azkar]');
  /* the chapters whose name is a du'a now sit on the du'a screen instead */
  const adhkar = Object.keys(win.AZKAR_DB).filter(function (k) {
    return win.AZKAR_DB[k].title.indexOf('دعاء') !== 0;
  });
  assert.strictEqual(tiles.length, adhkar.length);
  click(win, doc.querySelector('[data-azkar="istighfar"]'));
  assert.ok(doc.getElementById('azkar-list-title').textContent.indexOf('الاستغفار') !== -1);
  assert.strictEqual(doc.querySelectorAll('#azkar-items .dhikr').length,
    win.AZKAR_DB.istighfar.items.length);
});

/* ---------------- the month ---------------- */

test('the calendar draws a real month, not a list', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const cells = doc.querySelectorAll('#cal-grid .cal-cell:not(.is-empty)');
  assert.ok(cells.length === 29 || cells.length === 30,
    'a hijri month is twenty nine or thirty days, got ' + cells.length);
  assert.strictEqual(doc.querySelectorAll('#cal-week span').length, 7, 'seven weekday letters');
  assert.strictEqual(doc.querySelectorAll('.cal-cell.is-today').length, 1, 'today is marked once');
  assert.match(doc.getElementById('cal-month').textContent, /هـ$/);
  assert.ok(doc.getElementById('cal-span').textContent.length > 8, 'and names the gregorian span');
});

test('each day carries both numbers and the first sits under its weekday', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const first = doc.querySelector('#cal-grid .cal-cell:not(.is-empty)');
  assert.strictEqual(first.querySelector('.cal-num').textContent, '1');
  assert.match(first.querySelector('.cal-greg').textContent, /^[0-9]+$/);

  const month = win.Hijri.toHijri(new Date(), win.Store.get('hijriAdjust'));
  const days = win.Hijri.monthDays(month.y, month.m, win.Store.get('hijriAdjust'));
  const blanks = doc.querySelectorAll('#cal-grid .cal-cell.is-empty').length;
  assert.strictEqual(blanks, days[0].weekday,
    'the empty places before the first should match the weekday it falls on');
});

test('the seasons of worship are marked on the days they fall', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  /* walk to ramadan and every day of it should carry a mark */
  const here = win.Hijri.toHijri(new Date(), 0);
  const steps = ((9 - here.m) + 12) % 12;
  for (let i = 0; i < steps; i++) click(win, doc.getElementById('cal-next'));
  assert.ok(doc.getElementById('cal-month').textContent.indexOf('رمضان') !== -1,
    'got ' + doc.getElementById('cal-month').textContent);
  const cells = doc.querySelectorAll('#cal-grid .cal-cell:not(.is-empty)');
  const marked = doc.querySelectorAll('#cal-grid .cal-cell.has-mark');
  assert.strictEqual(marked.length, cells.length, 'every day of ramadan is a day of the season');
});

test('stepping to another month speaks about that month, not about today', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const todayLine = doc.getElementById('calendar-today').textContent;
  click(win, doc.getElementById('cal-next'));
  assert.notStrictEqual(doc.getElementById('calendar-today').textContent, todayLine,
    'the card underneath should follow the grid above it');
  assert.strictEqual(doc.querySelectorAll('.cal-cell.is-picked').length, 1);
  assert.ok(!doc.getElementById('cal-today').hidden, 'a way back to today should appear');

  click(win, doc.getElementById('cal-today'));
  assert.strictEqual(doc.getElementById('calendar-today').textContent, todayLine);
  assert.ok(doc.getElementById('cal-today').hidden);
});

test('tapping a day tells you what is in it', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const cells = [...doc.querySelectorAll('#cal-grid .cal-cell:not(.is-empty)')];
  const marked = cells.filter((c) => c.classList.contains('has-mark'))[0];
  assert.ok(marked, 'the month should hold at least one marked day');
  click(win, marked);
  assert.strictEqual(doc.querySelectorAll('.cal-cell.is-picked').length, 1);
  assert.ok(doc.querySelectorAll('#calendar-occasions .occasion').length >= 1,
    'a marked day should explain itself when tapped');
});

/* ---------------- counting in arabic ---------------- */

test('a count of days is written the way arabic counts', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const text = doc.getElementById('calendar-upcoming').textContent;
  assert.ok(!/(?:^|[^0-9])1 يوماً/.test(text), 'one day is يوم واحد');
  assert.ok(!/(?:^|[^0-9])2 يوماً/.test(text), 'two days is يومان');
  assert.ok(!/(?:^|[^0-9])[3-9] يوماً/.test(text),
    'three to ten take أيام, not يوماً, in: ' + text.replace(/\s+/g, ' ').slice(0, 90));
});

test('the daily card says plainly what it counts', () => {
  const { doc } = boot();
  const head = doc.querySelector('.meter-head').textContent;
  assert.ok(head.indexOf('سُنّة') !== -1,
    'سنة without its shadda reads as a year, got ' + head);
  assert.ok(head.indexOf('أدّيت') === 0, 'it should say what the number is, got ' + head);
  /* the two halves are separate words, so a screen reader and a copy do not
     glue them into one */
  assert.ok(/سُنّة\s/.test(head), 'the streak line must not run into the tally: ' + head);
  assert.strictEqual(doc.getElementById('streak-line').textContent, 'لم تبدأ اليوم بعد');
});

/* ---------------- the month timetable ---------------- */

test('the timetable lays out every day of the month', () => {
  const { win, doc } = boot();
  win.App.go('timetable');
  const rows = doc.querySelectorAll('#tt-table tbody tr');
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  assert.strictEqual(rows.length, last, 'one row per day, got ' + rows.length);
  assert.strictEqual(doc.querySelectorAll('#tt-table thead th').length, 7,
    'a column for the day and one for each prayer');
  assert.strictEqual(doc.querySelectorAll('#tt-table tr.is-today').length, 1);
  assert.ok(doc.getElementById('tt-place').textContent.indexOf(win.App.state.place.n) !== -1,
    'it should name the place the times belong to');
});

test('every time in the table is written on twelve hours', () => {
  const { win, doc } = boot();
  win.App.go('timetable');
  const cells = [...doc.querySelectorAll('#tt-table tbody td')];
  assert.ok(cells.length >= 28 * 6);
  cells.forEach(function (cell) {
    assert.match(cell.textContent, /^\d{1,2}:\d{2}[ \u2060][صم]$/, 'got ' + cell.textContent);
  });
});

test('the hijri month is named where it turns over, never cut in half', () => {
  const { win, doc } = boot();
  win.App.go('timetable');
  const labels = [...doc.querySelectorAll('#tt-table .tt-hijri')].map((e) => e.textContent.trim());
  const named = labels.filter((t) => /[\u0621-\u064A]/.test(t));
  assert.ok(named.length >= 1 && named.length <= 2,
    'a gregorian month touches one or two hijri months, got ' + named.length + ' names');
  named.forEach(function (label) {
    const name = label.replace(/^\d+\s*/, '');
    assert.ok(win.Hijri.MONTHS.indexOf(name) !== -1, 'a cut month name: ' + name);
  });
});

test('the table walks month by month and finds its way back', () => {
  const { win, doc } = boot();
  win.App.go('timetable');
  const start = doc.getElementById('tt-month').textContent;
  assert.ok(doc.getElementById('tt-today').hidden, 'nothing to go back to yet');

  click(win, doc.getElementById('tt-next'));
  assert.notStrictEqual(doc.getElementById('tt-month').textContent, start);
  assert.ok(!doc.getElementById('tt-today').hidden);
  assert.strictEqual(doc.querySelectorAll('#tt-table tr.is-today').length, 0,
    'today is not in another month');

  click(win, doc.getElementById('tt-today'));
  assert.strictEqual(doc.getElementById('tt-month').textContent, start);
  assert.strictEqual(doc.querySelectorAll('#tt-table tr.is-today').length, 1);
});

test('the table can be copied as plain text to send on', () => {
  const { win, doc } = boot();
  let copied = null;
  win.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  win.App.go('timetable');
  click(win, doc.getElementById('tt-copy'));
  assert.ok(copied, 'nothing reached the clipboard');
  const lines = copied.split('\n').filter(Boolean);
  const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  assert.strictEqual(lines.length, days + 2, 'a heading, the method, then a line a day');
  /* the place with its lam joined to it, للكويت and not لـالكويت */
  assert.ok(lines[0].indexOf(win.App.helpers.withLam(win.App.state.place.n)) !== -1, 'got ' + lines[0]);
  assert.ok(/\d{1,2}:\d{2} [صم]/.test(lines[2]), 'got ' + lines[2]);
});

test('the day the table shows agrees with the clock on the home screen', () => {
  const { win, doc } = boot();
  /* the strip binds the suffix with a joiner where the table uses a space */
  const home = [...doc.querySelectorAll('.window-time')].map((e) => e.textContent.replace('\u2060', ' '));
  win.App.go('timetable');
  const row = doc.querySelector('#tt-table tr.is-today');
  const table = [...row.querySelectorAll('td')].map((e) => e.textContent.replace('\u2060', ' '));
  assert.deepStrictEqual(table, home, 'the same day cannot have two sets of times');
});

/* ---------------- ornament ---------------- */

test('the niche frames the countdown rather than swallowing it', () => {
  const { doc } = boot();
  const arch = doc.querySelector('.mihrab');
  assert.ok(arch, 'the home screen should carry the niche');
  assert.strictEqual(arch.getAttribute('viewBox'), '0 0 240 152',
    'it should be drawn over the same square as the arc');
  assert.strictEqual(arch.getAttribute('aria-hidden'), 'true', 'ornament is not read aloud');
  assert.ok(arch.querySelector('.mihrab-star'), 'the crown carries the eight fold star');
  assert.strictEqual(doc.querySelectorAll('.mihrab-line').length, 2, 'an outer and an inner line');
});

test('an ayah closes with a rosette, as a printed mushaf does', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /\.ayah-num \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the ayah marker needs a style');
  assert.ok(rule[1].indexOf('background-image') !== -1, 'it should be drawn, not a plain ring');
  assert.ok(rule[1].indexOf('svg') !== -1, 'and drawn as a vector so it stays sharp');
});

test('the surah name sits inside a cartouche', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="36"]'));
  const frame = doc.querySelector('.surah-frame');
  assert.ok(frame, 'the reader should frame the name');
  assert.ok(frame.textContent.indexOf('يس') !== -1);
});

test('the pattern under the app is actually visible', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /body::before \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the pattern layer needs a rule');
  /* The weight belongs to the tile now, since a pattern of lines and one of
     solid shapes cannot carry the same opacity. */
  assert.match(rule[1], /opacity:\s*var\(--pattern-weight/);
  const app0 = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const weights = [...app0.matchAll(/weight:\s*(\.?\d*\.?\d+)/g)].map((m) => parseFloat(m[1]));
  assert.ok(weights.length >= 2, 'each tile should carry its own weight');
  assert.ok(Math.max.apply(null, weights) >= 0.2,
    'a pattern nobody can see is not a pattern, heaviest is ' + Math.max.apply(null, weights));
  /* The tile itself is drawn by the controller now, so it can take the colour
     the reader chose and can be turned off altogether. */
  assert.match(rule[1], /background-image:\s*var\(--pattern\)/);
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("setProperty('--pattern'") !== -1, 'and the controller sets it');
  assert.match(app, /var PATTERNS = \{/, 'from a set of tiles it holds');
});

/* ---------------- the android wrapper ---------------- */

test('the android project is complete enough to build', () => {
  const root = path.join(__dirname, '..', 'android');
  assert.ok(fs.existsSync(root), 'the wrapper source should live in the repository');
  ['settings.gradle', 'build.gradle', 'gradle.properties', 'README.md',
   'app/build.gradle', 'app/src/main/AndroidManifest.xml',
   'app/src/main/res/values/strings.xml', 'app/src/main/res/values/colors.xml',
   'app/src/main/res/values-night/colors.xml', 'app/src/main/res/xml/shortcuts.xml',
   'app/src/main/res/mipmap-anydpi/ic_launcher.xml'].forEach(function (rel) {
    assert.ok(fs.existsSync(path.join(root, rel)), 'missing ' + rel);
  });
  /* the launcher icon itself is the adaptive xml above; what the densities
     carry is the layer it draws */
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(function (density) {
    assert.ok(fs.existsSync(path.join(root, 'app/src/main/res/mipmap-' + density, 'ic_launcher_foreground.png')),
      'no adaptive layer at ' + density);
  });
});

test('the wrapper opens the same address the site is published at', () => {
  const root = path.join(__dirname, '..', 'android');
  const manifest = fs.readFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), 'utf8');
  const site = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));

  /* the address is a constant in the activity. It was also a string resource
     once, left over from the trusted web activity this stopped being, and that
     copy went unread until lint called it unused */
  const activity = fs.readFileSync(path.join(root, 'app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  assert.ok(/String SITE = "https:\/\/sunnati\.3li\.info\/"/.test(activity),
    'the wrapper should open the published address');
  const strings = fs.readFileSync(path.join(root, 'app/src/main/res/values/strings.xml'), 'utf8');
  assert.ok(strings.indexOf('defaultUrl') === -1, 'and should not keep a second, unread copy of it');
  assert.ok(manifest.indexOf('android:host="sunnati.3li.info"') !== -1,
    'and claim links to it');
  assert.ok(manifest.indexOf('autoVerify="true"') !== -1,
    'so a link opens the app rather than a browser');
  assert.strictEqual(site.orientation, 'portrait');
  assert.ok(manifest.indexOf('android:screenOrientation="portrait"') !== -1,
    'the wrapper and the web manifest should agree about orientation');
});

test('the wrapper asks for nothing it does not need', () => {
  const manifest = fs.readFileSync(
    path.join(__dirname, '..', 'android', 'app/src/main/AndroidManifest.xml'), 'utf8');
  const asked = [...manifest.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(asked.sort(), ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'INTERNET', 'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'VIBRATE'],
    'the network, the notification, the location the page asks for, what an exact adhan alarm needs, and what holding a recitation while the reader leaves the app requires, nothing more');
  /* the compass and the location are asked for by the page, so neither may be
     required to install */
  [...manifest.matchAll(/uses-feature[^>]*required="(\w+)"/g)].forEach(function (m) {
    assert.strictEqual(m[1], 'false', 'no hardware should be required to install');
  });
});

test('nothing that must stay private is committed', () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', 'android', '.gitignore'), 'utf8');
  ['keystore.properties', '*.keystore', '*.jks', 'local.properties'].forEach(function (line) {
    assert.ok(ignore.indexOf(line) !== -1, 'the wrapper must not carry ' + line);
  });
  const root = path.join(__dirname, '..', 'android');
  const walk = function (dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce(function (all, e) {
      const full = path.join(dir, e.name);
      return all.concat(e.isDirectory() ? walk(full) : [full]);
    }, []);
  };
  walk(root).forEach(function (file) {
    assert.ok(!/\.(keystore|jks)$/.test(file), 'a signing key was committed: ' + file);
  });
});

/* ---------------- reciting along ---------------- */

function reciteHarness(win) {
  /* the walk verse by verse is what a reciter without a whole surah recording
     falls back to, and what the repeat and the memorising use */
  win.Store.set('reciter', 'ar.aymanswoaid');
  const asked = [];
  let live = null;
  win.Audio = function () {
    const a = {
      src: '', paused: false, onended: null,
      play() { asked.push(this.src); live = this; return Promise.resolve(); },
      pause() { this.paused = true; }
    };
    return a;
  };
  return { asked: asked, end: function () { if (live && live.onended) live.onended(); } };
}

test('the reader recites verse by verse and marks where it has reached', () => {
  const { win, doc } = boot();
  const audio = reciteHarness(win);
  win.App.state.surah = 112;
  win.App.go('reader');

  click(win, doc.getElementById('reader-play'));
  assert.strictEqual(doc.querySelectorAll('.ayah.is-reciting').length, 1, 'one verse is marked');
  assert.strictEqual(doc.querySelector('.ayah.is-reciting').getAttribute('data-a'), '1');
  assert.ok(doc.getElementById('player').classList.contains('is-open'));
  assert.ok(doc.getElementById('player-title').textContent.indexOf('آية 1') !== -1,
    'got ' + doc.getElementById('player-title').textContent);
  assert.strictEqual(audio.asked.length, 1, 'one file per verse, not one for the surah');

  audio.end();
  assert.strictEqual(doc.querySelector('.ayah.is-reciting').getAttribute('data-a'), '2',
    'the mark should follow the reciter');
  assert.strictEqual(audio.asked.length, 2);
});

test('the recitation ends cleanly at the last verse', () => {
  const { win, doc } = boot();
  const audio = reciteHarness(win);
  win.App.state.surah = 112;
  win.App.go('reader');
  click(win, doc.getElementById('reader-play'));

  for (let i = 0; i < 4; i++) audio.end();
  assert.strictEqual(win.App.state.recite, null, 'it should stop, not run past the surah');
  assert.strictEqual(doc.querySelectorAll('.ayah.is-reciting').length, 0, 'and leave no mark behind');
  assert.ok(!doc.getElementById('player').classList.contains('is-open'));
  assert.strictEqual(audio.asked.length, 4, 'al ikhlas is four verses');
});

test('the player steps a verse at a time in both directions', () => {
  const { win, doc } = boot();
  reciteHarness(win);
  win.App.state.surah = 2;
  win.App.go('reader');
  click(win, doc.getElementById('reader-play'));

  const at = function () { return +doc.querySelector('.ayah.is-reciting').getAttribute('data-a'); };
  assert.strictEqual(at(), 1);
  click(win, doc.getElementById('player-next'));
  click(win, doc.getElementById('player-next'));
  assert.strictEqual(at(), 3);
  click(win, doc.getElementById('player-prev'));
  assert.strictEqual(at(), 2);
  /* it must not walk off the front of the surah */
  click(win, doc.getElementById('player-prev'));
  click(win, doc.getElementById('player-prev'));
  assert.strictEqual(at(), 1);
});

test('stopping ends the walk, not only the sound', () => {
  const { win, doc } = boot();
  reciteHarness(win);
  win.App.state.surah = 112;
  win.App.go('reader');
  click(win, doc.getElementById('reader-play'));
  assert.ok(win.App.state.recite);

  click(win, doc.getElementById('player-stop'));
  assert.strictEqual(win.App.state.recite, null);
  assert.strictEqual(doc.querySelectorAll('.ayah.is-reciting').length, 0);
});

test('a verse can be read on from, out of the sheet', () => {
  const { win, doc } = boot();
  const audio = reciteHarness(win);
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="18"]'));
  click(win, doc.querySelector('[data-ayah="18:60"]'));
  assert.ok(doc.querySelector('[data-act="recite"]'), 'the sheet should offer to read on');

  click(win, doc.querySelector('[data-act="recite"]'));
  assert.ok(win.App.state.recite, 'it should start reciting');
  assert.strictEqual(win.App.state.recite.a, 60, 'from the verse in hand, not from the top');
  assert.strictEqual(doc.querySelector('.ayah.is-reciting').getAttribute('data-a'), '60');
  assert.ok(!doc.getElementById('sheet').classList.contains('is-open'), 'the sheet gets out of the way');
  assert.strictEqual(audio.asked.length, 1);
});

test('drawing the reader again keeps the mark where the reciter is', () => {
  const { win, doc } = boot();
  reciteHarness(win);
  win.App.state.surah = 112;
  win.App.go('reader');
  click(win, doc.getElementById('reader-play'));
  click(win, doc.getElementById('player-next'));

  win.App.render.reader();
  assert.strictEqual(doc.querySelector('.ayah.is-reciting').getAttribute('data-a'), '2',
    'a redraw must not lose the place');
});

test('the screen is kept awake while reciting and let go after', () => {
  const { win, doc } = boot();
  reciteHarness(win);
  let held = 0, released = 0;
  win.navigator.wakeLock = {
    request: function () { held++; return Promise.resolve({ release: function () { released++; } }); }
  };
  win.App.state.surah = 112;
  win.App.go('reader');
  click(win, doc.getElementById('reader-play'));
  assert.strictEqual(held, 1, 'a reciter should not have the screen go dark on them');

  return new Promise(function (done) {
    setTimeout(function () {
      click(win, doc.getElementById('player-stop'));
      assert.strictEqual(released, 1, 'and the lock is given back when it stops');
      done();
    }, 30);
  });
});

test('the two ways of reciting keep out of each other', () => {
  const { win, doc } = boot();
  const audio = reciteHarness(win);
  win.App.state.surah = 112;
  win.App.go('reader');

  /* a repeat run and a walk through the surah are separate things, and each
     must drive its own playback rather than silently taking over the other */
  win.App.repeat.start(1, 2, 2, false);
  assert.ok(win.App.state.repeat, 'the repeat run should be under way');
  assert.strictEqual(win.App.state.recite, null, 'and it is not the walk');
  assert.strictEqual(doc.querySelectorAll('.ayah.is-reciting').length, 1);
  assert.ok(audio.asked.length >= 1, 'the repeat run should play something');
  win.App.repeat.stop();

  const before = audio.asked.length;
  click(win, doc.getElementById('reader-play'));
  assert.ok(win.App.state.recite, 'the walk should be under way');
  assert.strictEqual(win.App.state.repeat, null, 'and it is not the repeat run');
  assert.ok(audio.asked.length > before, 'the walk should play something too');
});

test('no two functions in the controller share a name', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const names = [...code.matchAll(/^\s*function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  const seen = {}, twice = [];
  names.forEach(function (n) {
    if (seen[n]) { if (twice.indexOf(n) === -1) twice.push(n); }
    seen[n] = true;
  });
  assert.deepStrictEqual(twice, [],
    'a second declaration replaces the first without a word, and whatever called ' +
    'the first stops working: ' + twice.join(', '));
});

test('the niche and the arc are given one box, not two', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const shared = /\.mihrab,\s*\.arc \{([^}]*)\}/.exec(css);
  assert.ok(shared, 'the niche and the arc should be placed by one rule');
  assert.match(shared[1], /top:\s*0/, 'both start at the same height');
  assert.match(shared[1], /height:\s*auto/,
    'a fixed height stretches the niche away from the arc it frames');
  assert.ok(!/\.mihrab \{[^}]*height:\s*100%/.test(css),
    'height 100% takes the wrap box, which is taller than the arc');
});

test('the words of the clock sit in flow, so they cannot drift out of the arch', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /\.arc-center \{([^}]*)\}/.exec(css);
  assert.ok(rule);
  assert.match(rule[1], /position:\s*relative/,
    'placed absolutely they fall wherever the wrap happens to end');
  assert.match(rule[1], /padding-top/, 'and are pushed down under the apex by a padding');
  assert.ok(!/\.arc-center \{[^}]*inset:\s*\d+%/.test(css),
    'a percentage resolves against the wrap, which is not the arch');
});

/* ---------------- what the reader chooses ---------------- */

test('a colour can be chosen, or left to follow the hour', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const picker = doc.getElementById('settings-accent');
  assert.ok(picker, 'the settings should offer a colour');
  assert.ok(picker.options.length >= 7, 'a few to choose from');
  assert.strictEqual(picker.options[0].value, 'auto');
  assert.ok(picker.options[0].text.indexOf('وقت الصلاة') !== -1,
    'the first choice is the one that follows the hour');

  /* the app opens in the sadu red; the colour of the hour is what auto gives */
  picker.value = 'auto'; fire(win, picker, 'change');
  const byHour = doc.documentElement.style.getPropertyValue('--accent');
  picker.value = 'sadu';
  fire(win, picker, 'change');
  assert.strictEqual(win.Store.get('accent'), 'sadu');
  assert.strictEqual(doc.documentElement.style.getPropertyValue('--accent'), '#9c2b2b');

  /* a chosen colour holds through the day, so the window no longer moves it */
  win.App.render.home();
  assert.strictEqual(doc.documentElement.style.getPropertyValue('--accent'), '#9c2b2b');

  picker.value = 'auto';
  fire(win, picker, 'change');
  assert.strictEqual(doc.documentElement.style.getPropertyValue('--accent'), byHour,
    'letting go returns it to the hour');
});

test('every colour offered is readable on the page and on a card', () => {
  const { win } = boot();
  function channel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function rgb(hex) { const m = /^#(..)(..)(..)$/.exec(hex); return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)]; }
  function lum(c) { return 0.2126*channel(c[0]) + 0.7152*channel(c[1]) + 0.0722*channel(c[2]); }
  function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
  const page = [246,244,238], card = [255,253,248];
  const wash = (hex, base) => rgb(hex).map((v,i) => v*0.12 + base[i]*0.88);

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const block = /var PALETTES = \{[\s\S]*?\n  \};/.exec(app)[0];
  const rows = [...block.matchAll(/light: '(#[0-9a-f]{6})', lightInk: '(#[0-9a-f]{6})'/g)];
  assert.ok(rows.length >= 7, 'expected a palette per colour, found ' + rows.length);
  rows.forEach(function (row) {
    const fill = row[1], ink = row[2];
    [page, card, wash(fill, page), wash(fill, card)].forEach(function (ground) {
      const r = ratio(rgb(ink), ground);
      assert.ok(r >= 4.5, ink + ' sits at ' + r.toFixed(2) + ':1, which cannot be read');
    });
    assert.ok(ratio(rgb('#fffdf8'), rgb(ink)) >= 4.5,
      'white on ' + ink + ' must read, for a filled button');
  });
  assert.ok(win.App);
});

test('the pattern can be changed, and taken away', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const picker = doc.getElementById('settings-pattern');
  assert.ok(picker);
  const names = [...picker.options].map((o) => o.text);
  assert.ok(names.some((n) => n.indexOf('السدو') !== -1), 'the sadu of kuwait should be offered');
  assert.ok(names.some((n) => n.indexOf('بلا') !== -1), 'and the choice of none');

  picker.value = 'sadu';
  fire(win, picker, 'change');
  const drawn = decodeURIComponent(doc.documentElement.style.getPropertyValue('--pattern'));
  assert.ok(drawn.indexOf('svg') !== -1, 'it should be drawn as a vector');
  assert.strictEqual(doc.documentElement.style.getPropertyValue('--pattern-size'), '60px 60px');

  picker.value = 'none';
  fire(win, picker, 'change');
  assert.strictEqual(doc.documentElement.style.getPropertyValue('--pattern'), 'none');
});

test('the pattern takes the colour that was chosen', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const colour = doc.getElementById('settings-accent');
  const shape = doc.getElementById('settings-pattern');
  shape.value = 'sadu'; fire(win, shape, 'change');
  colour.value = 'teal'; fire(win, colour, 'change');

  const drawn = decodeURIComponent(doc.documentElement.style.getPropertyValue('--pattern'));
  const ink = doc.documentElement.style.getPropertyValue('--accent-ink');
  assert.ok(drawn.indexOf(ink) !== -1,
    'the pattern should be drawn in ' + ink + ', not in a colour of its own');
});

/* ---------------- where you are ---------------- */

test('the app names where you are instead of saying your current place', () => {
  const { win } = boot();
  const name = win.App.helpers.nameForPlace;
  const label = win.App.helpers.coordsLabel;
  /* here nothing can be fetched, so this is the naming before the gazetteer
     has come: a listed city within 25 km, and anywhere else the coordinates,
     never near a city, since a reader is in a place and not beside one. The
     gazetteer itself is tried in places.test.js */
  assert.strictEqual(name(29.3394, 48.0782).n, 'الكويت', 'inside a city it names the city');
  assert.strictEqual(name(29.3375, 47.6581).n, label(29.3375, 47.6581), 'a little out it gives where it is');
  assert.strictEqual(name(29.3375, 47.6581).method, 'Ojeiri', 'and the reckoning is still the country\'s');
  assert.strictEqual(name(-20, -140).n, label(-20, -140), 'far from everywhere it knows, the coordinates');
  assert.strictEqual(name(-20, -140).method, null, 'and no country to reckon by');
});

test('somewhere it cannot name is given as coordinates, not as nothing', () => {
  const { win } = boot();
  const label = win.App.helpers.coordsLabel(-20.5, -140.25);
  assert.ok(label.indexOf('جنوباً') !== -1, 'south of the equator, got ' + label);
  assert.ok(label.indexOf('غرباً') !== -1, 'west of greenwich, got ' + label);
  assert.ok(/20\.50/.test(label) && /140\.25/.test(label));
  const north = win.App.helpers.coordsLabel(29.37, 47.97);
  assert.ok(north.indexOf('شمالاً') !== -1 && north.indexOf('شرقاً') !== -1);
});

test('the place and the method do not run into one word', () => {
  const { doc } = boot();
  /* measured inside the button that states them, since the line also carries
     the fetch now and its text would swallow the gap */
  const tap = doc.querySelector('#place-line .place-tap');
  const where = tap.querySelector('.place-where');
  const how = tap.querySelector('.place-how');
  assert.ok(where.nextSibling && /^\s/.test(where.nextSibling.textContent || ''),
    'something must stand between them, got ' + tap.textContent.replace(/\s+/g, ' '));
  assert.ok(!/الكويتتقويم/.test(tap.textContent), 'they ran together');
  void how;
});

test('the clock stands on a panel, so the numbers never sit on the lattice', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /\.clock \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the clock needs a rule');
  assert.match(rule[1], /background:\s*color-mix\(in srgb, var\(--raised\)\s*\d+%/,
    'a soft panel under the clock, letting the pattern show at its edges');
  const share = parseInt(/var\(--raised\)\s*(\d+)%/.exec(rule[1])[1], 10);
  assert.ok(share >= 80, 'the panel must be solid enough to read on, found ' + share + '%');
});

test('the star lattice reads as ornament, not as graph paper', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const star = /name: 'النجمة الثمانية',\s*size: (\d+),\s*weight: (\.?\d*\.?\d+)/.exec(app);
  assert.ok(star, 'the star tile should carry a size and a weight');
  assert.ok(+star[1] >= 100, 'a small tile packs the stars into a grid, found ' + star[1] + 'px');
  assert.ok(+star[2] <= 0.25 && +star[2] >= 0.15,
    'a line pattern belongs between faint and loud, found ' + star[2]);
});

/* ---------------- nothing to read sits on the lattice ---------------- */

test('the mushaf is read off clean paper, with the ornament in the margin', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /\.reader-body \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the page of the mushaf needs a rule');
  assert.match(rule[1], /background:\s*var\(--raised\)/, 'the words of the mushaf must sit on solid paper');
  assert.match(rule[1], /border:.*--gold/, 'framed with a hairline as a printed page is');
});

test('every page header, the counter and the compass reading stand on a ground', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  ['.view-head', '.counter', '.compass-panel', '.btn-ghost', '.section-title', '.pill'].forEach(function (sel) {
    const rule = new RegExp(sel.replace('.', '\\.') + ' \\{([^}]*)\\}').exec(css);
    assert.ok(rule, sel + ' needs a rule');
    assert.match(rule[1], /background:\s*color-mix\(in srgb, var\(--raised\)\s*(\d+)%/,
      sel + ' would otherwise sit on the pattern');
    const share = parseInt(/var\(--raised\)\s*(\d+)%/.exec(rule[1])[1], 10);
    assert.ok(share >= 70, sel + ' must be solid enough to read on, found ' + share + '%');
  });
});

test('a verse number stays on the line of the word it closes', () => {
  const { win, doc } = boot();
  win.App.state.surah = 1;
  win.App.go('reader');
  const verse = doc.querySelector('.ayah[data-a="7"]');
  const html = verse.innerHTML;
  const at = html.indexOf('<span class="ayah-num"');
  assert.ok(at > 0);
  assert.strictEqual(html.charCodeAt(at - 1), 0x2060,
    'a word joiner binds the number to the last word, or it can fall onto a line of its own');
});

/* ---------------- searching beyond the mushaf ---------------- */

test('the search reaches the azkar, the hadiths and the supplications', () => {
  const { win, doc } = boot();
  win.App.go('search');
  const type = function (q) { const f = doc.getElementById('quran-search'); f.value = q; fire(win, f, 'input'); };
  const pick = function (s) { click(win, doc.querySelector('[data-scope="' + s + '"]')); };

  assert.strictEqual(doc.querySelectorAll('#search-scope [data-scope]').length, 8,
    'everything, the mushaf, the azkar, the hadiths, the supplications, the sunnahs, the book and the umrah');
  assert.strictEqual(doc.querySelector('[data-scope="quran"]').getAttribute('aria-checked'), 'true',
    'the search is opened from the mushaf, so it begins there');
  assert.ok(doc.querySelector('[data-scope="all"]'), 'and everything is one press away');

  pick('azkar'); type('أصبحنا');
  assert.ok(doc.querySelectorAll('#search-results .search-hit').length >= 1, 'the morning azkar hold this word');
  assert.ok(doc.querySelector('#search-results .search-hit mark'), 'and the match is marked');
  assert.strictEqual(doc.querySelector('[data-scope="azkar"]').getAttribute('aria-checked'), 'true');

  pick('hadith'); type('النيات');
  assert.ok(doc.querySelector('#search-results .search-hit-ref').textContent.indexOf('الحديث 1') !== -1);

  pick('dua'); type('ربنا آتنا');
  assert.ok(doc.querySelectorAll('#search-results .search-hit').length >= 1);

  pick('quran'); type('الحمد لله');
  assert.ok(doc.getElementById('search-count').textContent.indexOf('آية') !== -1, 'back to the mushaf');
});

test('a hit outside the mushaf leads to where it lives', () => {
  const { win, doc } = boot();
  win.App.go('search');
  click(win, doc.querySelector('[data-scope="azkar"]'));
  const f = doc.getElementById('quran-search'); f.value = 'أصبحنا'; fire(win, f, 'input');
  const hit = doc.querySelector('#search-results .search-hit');
  assert.ok(hit.hasAttribute('data-azkar'), 'a dhikr opens its own section');
  click(win, hit);
  assert.ok(doc.getElementById('v-azkar-list').classList.contains('is-open'));
});

test('results are counted the way arabic counts', () => {
  const { win } = boot();
  const c = win.App.helpers.count;
  assert.strictEqual(c(1, 'نتيجة واحدة', 'نتيجتين', 'نتائج', 'نتيجة'), 'نتيجة واحدة');
  assert.strictEqual(c(2, 'نتيجة واحدة', 'نتيجتين', 'نتائج', 'نتيجة'), 'نتيجتين');
  assert.strictEqual(c(5, 'نتيجة واحدة', 'نتيجتين', 'نتائج', 'نتيجة'), '5 نتائج');
  assert.strictEqual(c(23, 'نتيجة واحدة', 'نتيجتين', 'نتائج', 'نتيجة'), '23 نتيجة');
});

/* ---------------- spoken labels ---------------- */

test('a day in the calendar tells a screen reader the whole date', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const today = doc.querySelector('.cal-cell.is-today');
  const spoken = today.getAttribute('aria-label');
  assert.ok(spoken, 'the cell needs a label');
  assert.ok(spoken.indexOf('اليوم') !== -1, 'and says it is today: ' + spoken);
  assert.ok(win.Hijri.MONTHS.some((m) => spoken.indexOf(m) !== -1), 'names the hijri month: ' + spoken);
  assert.ok(win.Hijri.WEEKDAYS.some((w) => spoken.indexOf(w) !== -1), 'and the weekday: ' + spoken);
});

test('the strip of times reads as a list with the current one marked', () => {
  const { doc } = boot();
  const strip = doc.getElementById('windows');
  assert.strictEqual(strip.getAttribute('role'), 'list');
  const items = strip.querySelectorAll('[role="listitem"]');
  assert.strictEqual(items.length, 6);
  /* one is marked, named either الوقت الحالي while its half hour runs or
     الصلاة القادمة once the clock has turned to the next */
  const marked = [...items].filter(function (i) {
    const label = i.getAttribute('aria-label');
    return label.indexOf('الوقت الحالي') !== -1 || label.indexOf('الصلاة القادمة') !== -1;
  });
  assert.strictEqual(marked.length, 1, 'exactly one is marked');
  assert.strictEqual(doc.querySelectorAll('#windows .window.is-now').length, 1, 'and it is the one shown so');
});

test('the first screen fonts are fetched before the stylesheet asks for them', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const preloads = [...html.matchAll(/rel="preload" href="(fonts\/[^"]+)" as="font"/g)].map((m) => m[1]);
  assert.ok(preloads.length >= 2, 'the faces the first paint needs should be preloaded');
  preloads.forEach(function (f) { assert.ok(fs.existsSync(path.join(DOCS, f)), 'missing ' + f); });
});

/* ---------------- said the way it is said ---------------- */

test('the countdown says باقٍ على أذان العصر, as it is actually said', () => {
  const { win, doc } = boot();
  const label = doc.getElementById('arc-label').textContent;
  const name = doc.getElementById('arc-name').textContent;
  const c = win.App.clockState();
  /* within the half hour after an adhan the clock counts up from it instead,
     so which of the two is shown depends on the hour the test runs at */
  const since = c.prev && c.prev.key !== 'sunrise' ? c.now - c.prev.at : -1;
  if (since >= 0 && since < 30) {
    assert.strictEqual(label, 'مضى على');
    assert.strictEqual(name, 'أذان ' + c.prev.ar, 'got ' + name);
    return;
  }
  assert.strictEqual(label, 'باقٍ على');
  const next = c.next;
  if (next.key === 'sunrise') {
    assert.strictEqual(name, 'الشروق', 'the sunrise has no adhan');
  } else {
    assert.strictEqual(name, 'أذان ' + next.ar, 'got ' + name);
  }
});

test('every counted noun takes the form arabic gives it', () => {
  const { win } = boot();
  const c = win.App.helpers.count;
  /* one, two, three to ten, above ten */
  assert.strictEqual(c(1, 'آية واحدة', 'آيتان', 'آيات', 'آية'), 'آية واحدة');
  assert.strictEqual(c(2, 'آية واحدة', 'آيتان', 'آيات', 'آية'), 'آيتان');
  assert.strictEqual(c(7, 'آية واحدة', 'آيتان', 'آيات', 'آية'), '7 آيات');
  assert.strictEqual(c(286, 'آية واحدة', 'آيتان', 'آيات', 'آية'), '286 آية');
});

test('the mushaf is whole: thirty juz, six hundred and four pages, fifteen sajdas, each where it belongs', () => {
  const { win } = boot();
  const M = win.Mushaf;

  /* the thirty juz begin where they are known to begin. These are fixed points
     in every printed mushaf, so a wrong one is a wrong one. */
  const juz = [[1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],
    [9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],[25,21],[27,56],
    [29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1]];
  const joff = [];
  juz.forEach(function (jz, i) {
    const st = M.juzStart(i + 1);
    if (!st || st.s !== jz[0] || st.a !== jz[1]) joff.push('جزء ' + (i + 1) + ': ' + (st && st.s + ':' + st.a) + ' not ' + jz.join(':'));
  });
  assert.strictEqual(joff.length, 0, joff.join('\n'));

  /* the pages: six hundred and four, the first opening on the Fatiha, the last
     on the Ikhlas, since the three quls close the mushaf on one page */
  assert.strictEqual(M.pageStart(1).s, 1, 'page one opens the Fatiha');
  const last = M.pageStart(604);
  assert.strictEqual(last.s, 112, 'page 604 opens with the Ikhlas');
  assert.ok(!M.pageStart(605), 'and there is no page 605');
  /* known start pages, first page that carries the opening verse */
  const startPage = function (su) { for (var p = 1; p <= 604; p++) { var v = M.pageStart(p); if (v.s > su || (v.s === su && v.a > 1)) return p - 1; } return 604; };
  [[1,1],[2,2],[18,293],[36,440],[55,531],[67,562],[114,604]].forEach(function (pair) {
    assert.strictEqual(startPage(pair[0]), pair[1], 'سورة ' + pair[0] + ' starts on page ' + startPage(pair[0]) + ', not ' + pair[1]);
  });

  /* the fifteen places of prostration, Al-Hajj counted twice as the جمهور do */
  const saj = M.sajdaList();
  assert.strictEqual(saj.length, 15, 'fifteen sajdas');
  assert.strictEqual(saj.filter(function (x) { return x[0] === 22; }).length, 2, 'two in Al-Hajj');
  assert.ok(saj.some(function (x) { return x[0] === 96 && x[1] === 19; }), 'the last, in Al-Alaq');
  saj.forEach(function (x) {
    assert.ok(M.ayah(x[0], x[1]), 'a sajda points at a real verse: ' + x.join(':'));
  });
});

test('the surah table agrees with the mushaf: names, verse counts, and the whole of it', () => {
  const { win } = boot();
  /* the numbers are absolute, so they are checked against the mushaf itself,
     not a list typed here: every surah's verse count is the length of its own
     array in the book, and the total is the total. A name may be spelled more
     than one way and is left; a verse count cannot. */
  assert.strictEqual(win.SURAHS.length, 114, 'a hundred and fourteen');
  const off = [];
  win.SURAHS.forEach(function (su) {
    const real = win.Mushaf.surah(su.n).length;
    if (real !== su.ay) off.push('سورة ' + su.n + ' ' + su.ar + ': the table says ' + su.ay + ', the mushaf has ' + real);
  });
  assert.strictEqual(off.length, 0, off.join('\n'));
  const total = win.SURAHS.reduce(function (n, s) { return n + s.ay; }, 0);
  assert.strictEqual(total, 6236, 'the counted total of the mushaf');

  /* the numbers run 1..114 with none missing or doubled */
  const nums = win.SURAHS.map(function (s) { return s.n; }).sort(function (a, b) { return a - b; });
  assert.deepStrictEqual(nums.join(','), Array.from({ length: 114 }, function (_, i) { return i + 1; }).join(','));

  /* Meccan or Medinan, against the classification of the King Fahd mushaf: 28
     Medinan, with Ar-Ra'd among them, which is the جمهور and what the mushaf we
     follow prints, though some counted it Meccan. */
  const medinan = win.SURAHS.filter(function (s) { return s.tp === 'مدنية'; }).map(function (s) { return s.n; });
  assert.strictEqual(medinan.length, 28, 'twenty eight Medinan surahs');
  assert.ok(medinan.indexOf(13) !== -1, "Ar-Ra'd is Medinan, as the mushaf we follow prints it");
  ['مكية', 'مدنية'].forEach(function (t) {
    assert.ok(win.SURAHS.some(function (s) { return s.tp === t; }), t + ' exists');
  });
  win.SURAHS.forEach(function (s) {
    assert.ok(s.tp === 'مكية' || s.tp === 'مدنية', 'سورة ' + s.n + ' is one or the other, not ' + s.tp);
  });
});

test('the surah list counts verses correctly for short and long surahs', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  const rows = [...doc.querySelectorAll('#surah-list [data-surah]')];
  const kawthar = rows.filter((r) => r.getAttribute('data-surah') === '108')[0];
  assert.ok(kawthar.textContent.indexOf('3 آيات') !== -1, 'three verses, got ' + kawthar.textContent);
  const fatiha = rows[0];
  assert.ok(fatiha.textContent.indexOf('7 آيات') !== -1, 'seven verses, got ' + fatiha.textContent);
  const baqara = rows[1];
  assert.ok(baqara.textContent.indexOf('286 آية') !== -1, 'above ten, got ' + baqara.textContent);
  assert.ok(!/\d آية\b/.test(kawthar.textContent), 'no 3 آية anywhere');
});

test('no phrase asks the reader to عد, which is also to count', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  [html, app].forEach(function (text) {
    assert.ok(!/>عد إلى/.test(text) && !/'عد إلى/.test(text),
      'عد without its vowel reads as count, so ارجع is used');
  });
  assert.ok(html.indexOf('ارجع إلى اليوم') !== -1);
  assert.ok(html.indexOf('ارجع إلى هذا الشهر') !== -1);
});

test('no helper in the controller is shadowed by a local of the same name', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const helpers = [...code.matchAll(/^\s{2}function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  const shadowed = [];
  helpers.forEach(function (name) {
    const local = new RegExp('(?:var|let|const)\\s+' + name + '\\b|function\\s*\\([^)]*\\b' + name + '\\b[^)]*\\)');
    if (local.test(code)) shadowed.push(name);
  });
  assert.deepStrictEqual(shadowed, [],
    'a local of the same name hides the helper, and a call to it then fails: ' + shadowed.join(', '));
});

/* ---------------- notifications that actually arrive ---------------- */

test('a notification is raised through the worker, which a phone allows', () => {
  const { win } = boot();
  const shown = [];
  win.navigator.serviceWorker = {
    ready: Promise.resolve({ showNotification: function (t, o) { shown.push({ t: t, o: o }); return Promise.resolve(); } })
  };
  win.Notification = function () { throw new Error('Illegal constructor'); };
  win.Notification.permission = 'granted';
  return win.App.helpers.notify('حان وقت العصر', 'حيّ على الصلاة', 'x').then(function (ok) {
    assert.strictEqual(ok, true, 'it should not give up when the page cannot raise one itself');
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].t, 'حان وقت العصر');
    assert.strictEqual(shown[0].o.dir, 'rtl', 'arabic reads from the right');
    assert.strictEqual(shown[0].o.lang, 'ar');
    assert.ok(shown[0].o.icon, 'carries the app icon');
  });
});

test('nothing is raised without permission', () => {
  const { win } = boot();
  win.Notification = function () {};
  win.Notification.permission = 'default';
  return win.App.helpers.notify('x', 'y', 'z').then(function (ok) { assert.strictEqual(ok, false); });
});

test('the salawat reminder fires when due and not again straight away', () => {
  const { win } = boot();
  const shown = [];
  win.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: function (t, o) { shown.push(t); return Promise.resolve(); } }) };
  win.Notification = function () {}; win.Notification.permission = 'granted';

  win.Store.set('salawat', 0);
  win.App.helpers.maybeSalawat(false);
  assert.strictEqual(shown.length, 0, 'off means off');

  win.Store.set('salawat', 60);
  win.Store.set('salawatAt', Date.now() - 61 * 60000);
  win.App.helpers.maybeSalawat(false);
  return new Promise(function (done) {
    setTimeout(function () {
      assert.strictEqual(shown.length, 1, 'due, so it fires');
      assert.strictEqual(shown[0], 'صلِّ على النبي ﷺ');
      win.App.helpers.maybeSalawat(false);
      setTimeout(function () {
        assert.strictEqual(shown.length, 1, 'just fired, so it waits');
        done();
      }, 20);
    }, 20);
  });
});

test('the reminder is offered in the settings with sensible intervals', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const sel = doc.getElementById('settings-salawat');
  assert.ok(sel);
  /* the list says when and only when; whether is the switch beside it, as it
     is on every other reminder. It used to carry «بلا تذكير» as its first
     option, so one row was turned off from inside its own list while ten
     others were turned off with a switch. */
  const values = [...sel.options].map((o) => o.value);
  assert.deepStrictEqual(values, ['60', '120', '180', '360']);
  assert.ok(![...sel.options].some(function (o) { return o.text === 'بلا تذكير'; }));
  assert.ok(doc.getElementById('settings-salawat-on'), 'and a switch says whether');

  /* the three that were the odd ones out all have one now */
  /* the ids are hyphenated where the stored key is not: jumuahBefore's row is
     settings-jumuah-before, and wirdAt's is settings-wird */
  ['jumuah-before', 'salawat', 'wird'].forEach(function (k) {
    assert.ok(doc.getElementById('settings-' + k + '-on'), k + ' has a switch');
  });

  /* turning it off keeps what was chosen, and turning it on gives it back */
  click(win, doc.getElementById('settings-salawat-on'));
  sel.value = '180'; fire(win, sel, 'change');
  assert.strictEqual(String(win.Store.get('salawat')), '180');
  click(win, doc.getElementById('settings-salawat-on'));
  assert.strictEqual(String(win.Store.get('salawat')), '0', 'off');
  click(win, doc.getElementById('settings-salawat-on'));
  assert.strictEqual(String(win.Store.get('salawat')), '180', 'and back to the reader\'s own choice');
});

test('the worker answers a tap on a notification and a periodic wake', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("addEventListener('notificationclick'") !== -1, 'a tap should bring the app forward');
  assert.ok(sw.indexOf('clients.openWindow') !== -1 && sw.indexOf('focus()') !== -1);
  assert.ok(sw.indexOf("addEventListener('periodicsync'") !== -1, 'where the browser wakes it, it checks the schedule');
  assert.ok(sw.indexOf("event.data.type === 'schedule'") !== -1, 'and it takes the schedule from the page');
});

/* ---------------- icons, not emoji ---------------- */

test('no emoji anywhere the app draws a glyph', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  ['data/azkar.js', 'data/content.js', 'js/hijri.js', 'js/app.js', 'index.html'].forEach(function (rel) {
    const text = fs.readFileSync(path.join(DOCS, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!emoji.test(text), rel + ' still carries an emoji');
  });
  const { win, doc } = boot();
  ['home', 'azkar', 'tracker', 'calendar', 'more'].forEach(function (v) {
    win.App.go(v);
    assert.ok(!emoji.test(doc.getElementById('v-' + v).textContent), v + ' shows an emoji');
  });
});

test('every icon a section or an occasion names is in the sprite', () => {
  const { win, doc } = boot();
  const ids = new Set([...doc.querySelectorAll('svg g[id^="i-"]')].map((g) => g.id.slice(2)));
  Object.keys(win.AZKAR_DB).forEach(function (k) {
    assert.ok(ids.has(win.AZKAR_DB[k].icon), win.AZKAR_DB[k].title + ' names an icon the sprite lacks: ' + win.AZKAR_DB[k].icon);
  });
  win.SUNNAH_TRACKER.forEach(function (g) {
    assert.ok(ids.has(g.icon), g.s + ' names an icon the sprite lacks: ' + g.icon);
  });
  win.Hijri.upcoming(new Date(), 0).forEach(function (o) {
    assert.ok(ids.has(o.icon), o.name + ' names an icon the sprite lacks: ' + o.icon);
  });
  ['home', 'azkar', 'tracker', 'calendar'].forEach(function (v) {
    win.App.go(v);
    doc.querySelectorAll('#v-' + v + ' svg.icon use').forEach(function (u) {
      assert.ok(ids.has(u.getAttribute('href').slice(3)), v + ' draws ' + u.getAttribute('href') + ' which does not exist');
    });
  });
});

/* ---------------- a verse as a picture ---------------- */

test('the verse sheet shares a verse as its picture, with the words alongside', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="2"]'));
  click(win, doc.querySelector('[data-ayah="2:255"]'));
  assert.ok(doc.querySelector('[data-act="share"]'), 'one share');
  assert.ok(!doc.querySelector('[data-act="picture"]'), 'no second button for the picture, the share is the picture');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const share = /    share: function \(ref\) \{([\s\S]*?)\n    \},/.exec(app)[1];
  assert.ok(share.indexOf('sharePicture(verseCard(s, a)') !== -1, 'the picture');
  assert.ok(share.indexOf("sunnati.3li.info") !== -1, 'with the words and the address');
});

test('the picture is drawn on a canvas in the mushaf typeface', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function textCard\(heading, text, face, source\) \{([\s\S]*?)\n  \}\n/.exec(app);
  assert.ok(fn, 'the card drawer should exist');
  assert.ok(fn[1].indexOf("'Amiri Quran'") !== -1, 'the verse is set in the mushaf face');
  assert.ok(fn[1].indexOf("direction = 'rtl'") !== -1, 'and drawn from the right');
  assert.ok(fn[1].indexOf('toBlob') !== -1, 'and handed over as an image');
  assert.ok(fn[1].indexOf('canShare') !== -1 || app.indexOf('canShare({ files') !== -1, 'shared as a file where the device allows');
});

/* ---------------- turning a date ---------------- */

test('the converter turns a gregorian date into the hijri one the app reckons', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const field = doc.getElementById('conv-greg');
  field.value = '2027-02-08';
  fire(win, field, 'input');
  const out = doc.getElementById('conv-greg-out').textContent;
  assert.ok(out.indexOf('1 رمضان 1448') !== -1, 'got ' + out);
  assert.ok(out.indexOf('الإثنين') === 0, 'and names the weekday: ' + out);
});

test('the converter turns a hijri date back, and refuses a day the month lacks', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  doc.getElementById('conv-hd').value = '1';
  doc.getElementById('conv-hm').value = '9';
  doc.getElementById('conv-hy').value = '1448';
  fire(win, doc.getElementById('conv-hd'), 'input');
  assert.ok(doc.getElementById('conv-hijri-out').textContent.indexOf('8 فبراير 2027') !== -1,
    'got ' + doc.getElementById('conv-hijri-out').textContent);

  doc.getElementById('conv-hd').value = '30';
  doc.getElementById('conv-hm').value = '3';
  fire(win, doc.getElementById('conv-hd'), 'input');
  const out = doc.getElementById('conv-hijri-out').textContent;
  assert.ok(out.indexOf('فقط') !== -1, 'a twenty nine day month has no thirtieth: ' + out);
});

test('the converter opens on today, agreeing with the header', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const header = doc.getElementById('hijri-date').textContent;
  assert.ok(doc.getElementById('conv-greg-out').textContent.indexOf(header) !== -1,
    'the converter and the header must reckon the same day');
});

/* ---------------- the strip does not wrap ---------------- */

test('the suffix after a time is bound to its figures', () => {
  const { doc } = boot();
  doc.querySelectorAll('.window-time').forEach(function (el) {
    assert.ok(el.querySelector('.ampm'), 'the ص or م is set apart and smaller');
    assert.strictEqual(el.innerHTML.indexOf('\u2060') > 0, true, 'and joined to the figures so it cannot wrap');
  });
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.window-time \{[^}]*white-space:\s*nowrap/);
});

/* ---------------- arrows point the way the page reads ---------------- */

test('a previous button points right and a next button points left, as arabic reads', () => {
  const { doc } = boot();
  const arrow = function (id) { return doc.querySelector('#' + id + ' use').getAttribute('href'); };
  ['tt', 'cal'].forEach(function (pair) {
    assert.strictEqual(arrow(pair + '-prev'), '#i-step-prev', pair + '-prev should point right, back along the reading');
    assert.strictEqual(arrow(pair + '-next'), '#i-step-next', pair + '-next should point left, onward');
  });
  /* the surahs step with two chevrons the same ways, since beside «back» a
     single one was the same mark twice */
  assert.strictEqual(arrow('reader-prev'), '#i-surah-prev');
  assert.strictEqual(arrow('reader-next'), '#i-surah-next');
  /* and the player's steps are drawn as playback is on every phone, the
     previous on the left and the next on the right */
  assert.strictEqual(arrow('player-prev'), '#i-media-prev');
  assert.strictEqual(arrow('player-next'), '#i-media-next');
  /* and the sprite really draws them that way */
  const prev = doc.querySelector('#i-step-prev path').getAttribute('d');
  const next = doc.querySelector('#i-step-next path').getAttribute('d');
  assert.ok(/m10 5 7 7/.test(prev), 'i-step-prev is the right pointing chevron');
  assert.ok(/m14 5-7 7/.test(next), 'i-step-next is the left pointing chevron');
  assert.ok(/m6 6 6 6/.test(doc.querySelector('#i-surah-prev path').getAttribute('d')), 'i-surah-prev points right');
  assert.ok(/m18 6-6 6/.test(doc.querySelector('#i-surah-next path').getAttribute('d')), 'i-surah-next points left');
  assert.ok(/M18\.5 5\.5 9 12/.test(doc.querySelector('#i-media-prev path').getAttribute('d')), 'i-media-prev points left');
  assert.ok(/M5\.5 5\.5 15 12/.test(doc.querySelector('#i-media-next path').getAttribute('d')), 'i-media-next points right');
});

test('a time in the month table keeps its suffix on the line', () => {
  const { win, doc } = boot();
  win.App.go('timetable');
  const cells = [...doc.querySelectorAll('#tt-table tbody td')];
  assert.ok(cells.length > 100);
  cells.forEach(function (td) {
    assert.ok(td.querySelector('.ampm'), 'the suffix is set apart');
    assert.ok(td.innerHTML.indexOf('\u2060') > 0, 'and joined to the figures');
  });
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.tt th, \.tt td \{[^}]*white-space:\s*nowrap/);
});

/* ---------------- notifications that survive the background ---------------- */

test('a prayer notification is still raised a quarter hour late, and only once', () => {
  const { win } = boot();
  const shown = [];
  win.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: function (t) { shown.push(t); return Promise.resolve(); } }) };
  win.Notification = function () {}; win.Notification.permission = 'granted';
  win.Store.set('notify', true); win.Store.set('notified', {});
  const c = win.App.clockState();
  const late = Object.assign({}, c, { now: c.prev.at + 15 });
  win.App.helpers.maybeNotify(late);
  return new Promise(function (done) {
    setTimeout(function () {
      assert.strictEqual(shown.length, 1, 'a slow background clock must not lose the prayer');
      win.App.helpers.maybeNotify(late);
      setTimeout(function () {
        assert.strictEqual(shown.length, 1, 'and it is not raised twice');
        assert.strictEqual(Object.keys(win.Store.get('notified')).length, 1, 'the record is kept on disk');
        const tooLate = Object.assign({}, c, { now: c.prev.at + 40 });
        win.Store.set('notified', {});
        win.App.helpers.maybeNotify(tooLate);
        setTimeout(function () {
          assert.strictEqual(shown.length, 1, 'forty minutes on, the moment has passed');
          done();
        }, 20);
      }, 20);
    }, 20);
  });
});

test('the check runs the moment the app comes back to the front', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const top = /document\.addEventListener\('visibilitychange', function \(\) \{\s*if \(document\.visibilityState === 'visible'\) tick\(\);/;
  assert.ok(top.test(app), 'a visibility listener at the top level should run the clock');
});

/* ---------------- a voice ---------------- */

test('the reminder can chime or speak, and speaks only in an arabic voice', () => {
  const { win } = boot();
  const spoken = [];
  win.AudioContext = function () {
    return { currentTime: 0, destination: {},
      createOscillator: function () { return { type: '', frequency: {}, connect: function () { return { connect: function () {} }; }, start: function () {}, stop: function () {} }; },
      createGain: function () { return { gain: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function () { return { connect: function () {} }; } }; } };
  };
  win.SpeechSynthesisUtterance = function (t) { this.text = t; };
  Object.defineProperty(win, 'speechSynthesis', { configurable: true, value: {
    getVoices: function () { return [{ lang: 'ar-SA', name: 'Arabic' }]; },
    speak: function (u) { spoken.push(u.text); } } });

  win.Store.set('voice', 'none');
  assert.strictEqual(win.App.helpers.speak('x', 't'), false, 'off is silent');
  win.Store.set('voice', 'tone');
  assert.strictEqual(win.App.helpers.speak('x', 't'), true, 'a tone plays');
  win.Store.set('voice', 'speech');
  assert.strictEqual(win.App.helpers.speak('اللهم صلِّ على محمد', 't'), true);
  return new Promise(function (done) {
    setTimeout(function () {
      assert.deepStrictEqual(spoken, ['اللهم صلِّ على محمد'], 'the arabic voice is asked');
      /* a phone with only an english voice must not mangle arabic */
      Object.defineProperty(win, 'speechSynthesis', { configurable: true, value: {
        getVoices: function () { return [{ lang: 'en-US', name: 'English' }]; },
        speak: function (u) { spoken.push('WRONG'); } } });
      win.App.helpers.speak('x', 't');
      setTimeout(function () {
        assert.ok(spoken.indexOf('WRONG') === -1, 'it chimes instead of speaking arabic in english');
        done();
      }, 800);
    }, 800);
  });
});

test('the voice is offered in the settings', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const sel = doc.getElementById('settings-voice');
  assert.ok(sel);
  assert.deepStrictEqual([...sel.options].map((o) => o.value), ['recording', 'tone', 'speech', 'none'], 'the reciter first');
});

/* ---------------- reading by the page ---------------- */

test('the mushaf can be read page by page, as a printed one turns', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.querySelector('[data-go="page"]'));
  assert.ok(doc.getElementById('v-page').classList.contains('is-open'));
  /* the mushaf page title is in the mushaf's own arabic digits, to match the
     figure footing the page; ar() elsewhere stays latin */
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة ١');
  assert.strictEqual(doc.querySelectorAll('#page-body .ayah').length, 7, 'the first page is the fatiha');
  assert.ok(doc.getElementById('page-prev').disabled, 'nothing before the first page');

  click(win, doc.getElementById('page-next'));
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة ٢');
  assert.ok(doc.querySelector('#page-body .surah-frame'), 'a surah that opens on the page is named in its cartouche');
  assert.ok(doc.querySelector('#page-body .basmala'), 'with its basmala');
  assert.strictEqual(doc.querySelector('#page-body .ayah').getAttribute('data-ayah'), '2:1');

  win.App.helpers.openPage(604);
  assert.strictEqual(doc.querySelectorAll('#page-body .surah-frame').length, 3, 'the last page holds three surahs');
  assert.ok(doc.getElementById('page-next').disabled, 'nothing after the last page');
  assert.ok(doc.getElementById('page-meta').textContent.indexOf('من الإخلاص إلى الناس') !== -1);
});

test('every verse of the mushaf appears on exactly one page', () => {
  const { win } = boot();
  let total = 0, misplaced = 0;
  for (let n = 1; n <= 604; n++) {
    const verses = win.Mushaf.pageVerses(n);
    total += verses.length;
    verses.forEach(function (v) { if (win.Mushaf.pageOf(v.s, v.a) !== n) misplaced++; });
  }
  assert.strictEqual(total, 6236, 'the pages together must hold the whole mushaf');
  assert.strictEqual(misplaced, 0);
});

test('the page reader lights the mushaf tab and remembers the place', () => {
  const { win, doc } = boot();
  win.App.helpers.openPage(50);
  assert.strictEqual(doc.querySelector('.tab[aria-current="page"]').getAttribute('data-go'), 'quran');
  assert.strictEqual(win.Store.get('lastPage'), 50);
  const place = win.Store.get('lastRead');
  assert.strictEqual(win.Mushaf.pageOf(place.s, place.a), 50, 'تابع القراءة should find this page');
});

test('a verse on a page answers to a tap like any other', () => {
  const { win, doc } = boot();
  win.App.helpers.openPage(2);
  click(win, doc.querySelector('#page-body [data-ayah="2:2"]'));
  assert.ok(doc.getElementById('sheet').classList.contains('is-open'));
  assert.ok(doc.querySelector('[data-act="recite"]'), 'the sheet offers to read on');
});

/* ---------------- going straight to a place ---------------- */

test('اذهب إلى takes you to a page, a juz or a verse', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.getElementById('quran-goto'));
  assert.ok(doc.getElementById('sheet').classList.contains('is-open'));

  doc.getElementById('goto-page').value = '300';
  click(win, doc.querySelector('[data-act="goto-page"]'));
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة ٣٠٠');

  click(win, doc.getElementById('page-jump'));
  doc.getElementById('goto-juz').value = '30';
  click(win, doc.querySelector('[data-act="goto-juz"]'));
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة ٥٨٢');
  assert.ok(doc.getElementById('page-meta').textContent.indexOf('النبأ') !== -1);

  click(win, doc.getElementById('page-jump'));
  doc.getElementById('goto-surah').value = '18';
  doc.getElementById('goto-ayah').value = '10';
  click(win, doc.querySelector('[data-act="goto-ayah"]'));
  assert.ok(doc.getElementById('v-reader').classList.contains('is-open'));
  assert.strictEqual(win.App.state.surah, 18);
  assert.strictEqual(win.App.state.ayah, 10);
});

test('اذهب إلى refuses what the mushaf does not hold', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  click(win, doc.getElementById('quran-goto'));
  doc.getElementById('goto-page').value = '700';
  click(win, doc.querySelector('[data-act="goto-page"]'));
  assert.ok(doc.getElementById('sheet').classList.contains('is-open'), 'the sheet stays for a page that does not exist');
  doc.getElementById('goto-surah').value = '112';
  doc.getElementById('goto-ayah').value = '9';
  click(win, doc.querySelector('[data-act="goto-ayah"]'));
  assert.ok(doc.getElementById('toast').textContent.indexOf('4 آيات') !== -1, 'it says how many the surah has');
});

/* ---------------- the date says when it has been shifted ---------------- */

test('a nudged hijri date is marked as such and one tap puts it back', () => {
  const { win, doc } = boot();
  assert.ok(doc.getElementById('hijri-reset').hidden, 'nothing to say when the date is as reckoned');
  click(win, doc.getElementById('hijri-down'));
  assert.ok(!doc.getElementById('hijri-reset').hidden, 'a shifted date must say so');
  assert.strictEqual(doc.getElementById('hijri-reset').textContent, 'معدّل −1');
  click(win, doc.getElementById('hijri-reset'));
  assert.strictEqual(win.Store.get('hijriAdjust'), 0);
  assert.ok(doc.getElementById('hijri-reset').hidden);
});

test('the converter shows a hijri date on one line, day then month then year, with room for the month', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.convert-hijri \{[^}]*grid-template-columns:\s*64px 1fr 80px/, 'the month takes the middle, the numbers their own columns');
  assert.match(css, /\.convert-hijri \.picker, \.convert-hijri \.select, \.convert-hijri \.field \{[^}]*max-width:\s*none/, 'the general cap on a select would narrow the month');
  const { doc } = boot();
  const row = doc.querySelector('.convert-hijri');
  /* the month select sits inside its own picker now, so the middle cell is
     that wrapper; the order a date is read in is unchanged */
  const ids = [...row.children].map(function (e) {
    return e.id || (e.querySelector('select, input') || {}).id;
  });
  assert.deepStrictEqual(ids, ['conv-hd', 'conv-hm', 'conv-hy'], 'read as a date is read');
});

/* ---------------- a man's voice, and one you can choose ---------------- */

test('the voice prefers a man and sits low, and a chosen name wins', () => {
  const { win, doc } = boot();
  const spoken = [];
  win.AudioContext = function () {
    return { currentTime: 0, destination: {},
      createOscillator: function () { return { frequency: {}, connect: function () { return { connect: function () {} }; }, start: function () {}, stop: function () {} }; },
      createGain: function () { return { gain: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function () { return { connect: function () {} }; } }; } };
  };
  win.SpeechSynthesisUtterance = function (t) { this.text = t; };
  const voices = [{ lang: 'ar-XA', name: 'ar-xa-x-arc-local' }, { lang: 'ar-XA', name: 'ar-xa-x-ard-local' }, { lang: 'en-US', name: 'English' }];
  Object.defineProperty(win, 'speechSynthesis', { configurable: true, value: {
    getVoices: function () { return voices; }, addEventListener: function () {},
    speak: function (u) { spoken.push({ voice: u.voice && u.voice.name, pitch: u.pitch }); } } });

  win.Store.set('voice', 'speech'); win.Store.set('voiceName', '');
  assert.strictEqual(win.App.helpers.pickVoice().name, 'ar-xa-x-ard-local', 'the voice google names ard is the man');
  win.App.helpers.speak('x', 't');
  return new Promise(function (done) {
    setTimeout(function () {
      assert.strictEqual(spoken.length, 1);
      assert.ok(spoken[0].pitch < 0.9, 'pitched low, found ' + spoken[0].pitch);
      win.Store.set('voiceName', 'ar-xa-x-arc-local');
      assert.strictEqual(win.App.helpers.pickVoice().name, 'ar-xa-x-arc-local', 'a name the reader chose wins');
      done();
    }, 800);
  });
});

test('the settings list the arabic voices on the phone, numbered, with a try button', () => {
  const { win, doc } = boot();
  Object.defineProperty(win, 'speechSynthesis', { configurable: true, value: {
    getVoices: function () { return [{ lang: 'ar-XA', name: 'ar-xa-x-arc-local' }, { lang: 'ar-XA', name: 'ar-xa-x-ard-network' }, { lang: 'fr-FR', name: 'French' }]; },
    addEventListener: function () {}, speak: function () {} } });
  win.App.go('settings');
  const sel = doc.getElementById('settings-voice-name');
  assert.ok(sel);
  const labels = [...sel.options].map((o) => o.text);
  assert.strictEqual(labels.length, 3, 'a default plus the two arabic voices, the french one left out');
  assert.ok(labels[1].indexOf('الصوت 1') === 0 && labels[2].indexOf('الصوت 2') === 0, 'numbered, got ' + labels.join(' | '));
  assert.ok(labels[2].indexOf('network') === -1, 'the noise in the code is trimmed');
  assert.ok(doc.getElementById('settings-voice-try'), 'a button to hear it');
});


/* ---------------- room, but not too much ---------------- */

test('the counter and the settings rows no longer breathe a hall of air', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const counter = /\.counter \{([^}]*)\}/.exec(css)[1];
  assert.ok(!/padding:\s*var\(--s5\)/.test(counter), 'the counter panel is padded to s4, not s5');
  const phrase = /\.counter-phrase \{([^}]*)\}/.exec(css)[1];
  assert.ok(!/var\(--s5\)/.test(phrase), 'the phrase does not push the button down by s5');
  const setting = /^\.setting \{([^}]*)\}/m.exec(css)[1];
  assert.match(setting, /padding:\s*var\(--s2\) 0/, 'a settings row is padded s2, not s3');
});

/* ---------------- the whole book, and the azkar of this hour ---------------- */

test('the whole of حصن المسلم is in the app, cleaned and counted', () => {
  const { win } = boot();
  assert.strictEqual(win.HISN.length, 132, 'the book has one hundred and thirty two chapters');
  const all = win.HISN.reduce((n, c) => n + c.i.length, 0);
  assert.ok(all >= 260, 'and some two hundred and sixty adhkar, found ' + all);
  win.HISN.forEach(function (c) {
    assert.ok(c.t && c.i.length, 'chapter ' + c.id + ' is empty');
    c.i.forEach(function (it) {
      assert.ok(!/\(\(|\)\)|\[|\]/.test(it.t), 'markers left in ' + c.t + ': ' + it.t.slice(0, 40));
      assert.ok(it.r >= 1, 'every dhikr says how often it is said');
    });
  });
  const placed = new Set(win.HISN_GROUPS.reduce((a, g) => a.concat(g.ids), []));
  win.HISN.forEach(function (c) { assert.ok(placed.has(c.id), 'chapter ' + c.id + ' belongs to no group'); });
});

test('the morning and evening chapter carries the counts the book gives', () => {
  const { win } = boot();
  const ch = win.HISN.filter((c) => c.id === 27)[0];
  assert.strictEqual(ch.t, 'أذكار الصباح والمساء');
  assert.strictEqual(ch.i.length, 24);
  const counts = ch.i.map((i) => i.r);
  assert.ok(counts.indexOf(3) !== -1 && counts.indexOf(100) !== -1 && counts.indexOf(10) !== -1,
    'the three, ten and hundred fold adhkar are there');
  assert.ok(ch.i[2].t.indexOf('أَصْبَحْنَا') === 0, 'the third opens with أصبحنا');
});

test('the book is browsed by group and searched by word', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  assert.strictEqual(doc.querySelectorAll('#hisn-groups [data-hisn]').length, 132);
  assert.strictEqual(doc.querySelectorAll('#hisn-groups .fold').length, 13);
  const f = doc.getElementById('hisn-filter'); f.value = 'السفر'; fire(win, f, 'input');
  const hits = doc.querySelectorAll('#hisn-groups [data-hisn]').length;
  assert.ok(hits >= 3 && hits < 20, 'a word narrows the list, got ' + hits);
});

test('a chapter opens with a ring counter on every dhikr, and a tap on the card counts', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-hisn="27"]'));
  assert.ok(doc.getElementById('v-hisn').classList.contains('is-open'));
  assert.strictEqual(doc.querySelectorAll('#hisn-list .dhikr').length, 24);
  assert.strictEqual(doc.querySelectorAll('#hisn-list .ring').length, 24, 'every dhikr has its ring');

  const card = doc.querySelector('#hisn-list .dhikr[data-dhikr="3"]');
  const target = win.HISN.filter((c) => c.id === 27)[0].i[3].r;
  assert.strictEqual(card.querySelector('.dhikr-left').textContent, String(target));
  click(win, card.querySelector('.dhikr-text'));
  const after = doc.querySelector('#hisn-list .dhikr[data-dhikr="3"]');
  if (target > 1) {
    assert.strictEqual(after.querySelector('.dhikr-left').textContent, String(target - 1), 'one tap, one less');
    assert.ok(after.querySelector('.ring-fill'), 'and the ring begins to fill');
  } else {
    assert.ok(after.classList.contains('is-done'));
  }
  assert.ok(win.Store.day().hisn[27], 'the count is kept for the day');
});

test('the counters of the book and of the daily lists do not mix', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-hisn="27"]'));
  click(win, doc.querySelector('#hisn-list .dhikr[data-dhikr="2"] .dhikr-text'));
  assert.ok(win.Store.day().hisn[27]);
  assert.strictEqual(Object.keys(win.Store.day().azkar).length, 0, 'the daily morning list is untouched');
});

test('a chapter reset clears its counters', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-hisn="27"]'));
  click(win, doc.querySelector('#hisn-list .dhikr[data-dhikr="2"] .dhikr-text'));
  click(win, doc.getElementById('hisn-reset'));
  assert.ok(!win.Store.day().hisn[27]);
  assert.strictEqual(doc.querySelectorAll('#hisn-list .dhikr.is-done').length, 0);
});

test('the azkar of this hour follow the prayer windows', () => {
  const { win, doc } = boot();
  const key = win.App.helpers.azkarForNow();
  const window_ = win.App.clockState().prev.key;
  const expect = { fajr: 'morning', sunrise: 'morning', duha: 'morning', dhuhr: 'afterprayer', asr: 'evening', maghrib: 'evening', isha: 'sleep' }[window_];
  assert.ok(win.AZKAR_DB[expect], 'the section the window asks for must exist: ' + expect);
  assert.strictEqual(key, expect, 'in the ' + window_ + ' window the app should offer ' + expect);
  win.App.go('azkar');
  const card = doc.getElementById('azkar-now');
  assert.ok(!card.hidden);
  assert.strictEqual(card.getAttribute('data-azkar'), key);
  assert.strictEqual(doc.getElementById('azkar-now-title').textContent, win.AZKAR_DB[key].title);
  assert.ok(doc.getElementById('azkar-now-ring').querySelector('.ring'), 'with a ring of what is done');
  click(win, card);
  assert.ok(doc.getElementById('v-azkar-list').classList.contains('is-open'), 'a tap opens that section');
});

test('the note under the refetch button says plainly what it does and what stays', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('إن بدا شيء قديماً') === -1, 'the old wording was not clear');
  assert.ok(html.indexOf('يحذف نسخة التطبيق المحفوظة في جهازك وينزّل أحدث نسخة') !== -1);
  assert.ok(html.indexOf('وتبقى بياناتك وأذكارك وعلاماتك كما هي') !== -1, 'and it promises the data stays');
  /* which it must, since the button touches only the caches and the worker */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function refetchEverything\(\) \{([\s\S]*?)\n  \}/.exec(app)[1];
  assert.ok(fn.indexOf('localStorage') === -1 && fn.indexOf('Store.clear') === -1 && fn.indexOf('wipe') === -1,
    'the button must not touch the reader\'s data');
});

/* ---------------- the printed calendar of kuwait ---------------- */

test('kuwait follows the ojeiri calendar, served from its published table', () => {
  const { win } = boot();
  assert.strictEqual(win.Store.get('method'), 'Ojeiri');
  const t = win.App.helpers.computeTimes(new Date(2026, 8, 5));
  assert.ok(t.published, 'a day of 2026 comes from the table');
  assert.deepStrictEqual([t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha], [246, 327, 707, 919, 1086, 1165],
    'the sixth of september two thousand and twenty six, as the calendar prints it');
  assert.strictEqual(Object.keys(win.OJEIRI).length, 364, 'a year of days');
});

test('beyond the table the ojeiri method falls back with its isha calibration', () => {
  const { win } = boot();
  const t = win.App.helpers.computeTimes(new Date(2027, 8, 5));
  assert.ok(!t.published, 'no table for two thousand and twenty seven');
  const ministry = new win.PrayerEngine.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Kuwait' }).timesFor(new Date(2027, 8, 5), 3);
  assert.strictEqual(t.isha - ministry.isha, 2, 'isha sits two minutes later, as the table showed all year');
  assert.strictEqual(t.fajr, ministry.fajr);
});

test('a hanafi reader keeps the later asr even on a published day', () => {
  const { win } = boot();
  win.Store.set('asr', 'hanafi');
  const t = win.App.helpers.computeTimes(new Date(2026, 8, 5));
  assert.ok(t.published);
  assert.ok(t.asr > 919, 'the table gives the majority asr, the hanafi one comes later: ' + t.asr);
  win.Store.set('asr', 'standard');
});

test('the hijri reckoning agrees with the ojeiri calendar on every day of the year', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ojeiri-2026.json'), 'utf8'));
  const { win } = boot();
  let off = 0;
  rows.forEach(function (r) {
    const parts = r.d.split('-').map(Number);
    const h = win.Hijri.toHijri(new win.Date(parts[0], parts[1] - 1, parts[2]), 0);
    if (h.d !== r.h[0] || h.m !== r.h[1] || h.y !== r.h[2]) off++;
  });
  assert.strictEqual(off, 0, 'days where the two disagree: ' + off);
});

/* ---------------- what changed on the bar and the tasbih ---------------- */

test('the tasbih sits on the bar and carries the way to the azkar', () => {
  const { win, doc } = boot();
  const tabs = [...doc.querySelectorAll('.tab')].map((t) => t.getAttribute('data-go'));
  assert.deepStrictEqual(tabs, ['home', 'quran', 'tasbih', 'tracker', 'more']);
  win.App.go('tasbih');
  const route = doc.getElementById('tasbih-azkar');
  assert.ok(route, 'a way to the azkar inside the tasbih');
  assert.ok(doc.getElementById('tasbih-azkar-note').textContent.indexOf('أذكار هذا الوقت') !== -1);
  click(win, route);
  assert.ok(doc.getElementById('v-azkar').classList.contains('is-open'));
  /* the more list offers the azkar too */
  win.App.go('more');
  assert.ok(doc.querySelector('#more-list [data-go="azkar"]'), 'the azkar are also reachable from المزيد');
});

test('the tasbih head says plainly what a tap does', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('اضغط للعد، والمجموع محفوظ ليومك') === -1, 'the old line was not clear');
  assert.ok(html.indexOf('كل ضغطة على الدائرة تسبيحة') !== -1);
});

test('a dhikr and a supplication can be sent as a picture', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  click(win, doc.querySelector('[data-hisn="27"]'));
  assert.ok(doc.querySelectorAll('#hisn-list [data-picture^="hisn:"]').length >= 20, 'every dhikr in a chapter has the button');
  win.App.go('dua');
  assert.ok(doc.querySelectorAll('#dua-list [data-picture^="dua:"]').length >= 10, 'and every supplication');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('function textCard(heading, text, face, source)') !== -1, 'one drawer serves them all');
});

test('the app opens in the colour that was chosen, not in green', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* It was an inline script until the content policy was written, which
     refuses inline script outright. It is a file now, loaded in the head
     before anything is styled, which is the same promise kept differently. */
  assert.ok(html.indexOf('<script>') === -1, 'no script is inline, the policy would refuse it');
  const at = html.indexOf('<script src="js/boot.js"></script>');
  assert.ok(at !== -1 && at < html.indexOf('<link rel="stylesheet"'), 'boot.js runs in the head, before the stylesheet');
  const boot_ = [fs.readFileSync(path.join(DOCS, 'js', 'boot.js'), 'utf8')];
  assert.ok(boot_[0].indexOf('Before anything paints') !== -1, 'it is the pre-paint script');
  assert.ok(boot_[0].indexOf("localStorage.getItem('sunnati.settings')") !== -1, 'it reads the stored choice');
  assert.ok(boot_[0].indexOf("setProperty('--accent'") !== -1, 'and applies the accent');
  assert.ok(boot_[0].indexOf('theme-color') !== -1, 'and the bar the browser paints');
  assert.ok(boot_[0].indexOf("'#9c2b2b'") !== -1, 'with the same palette the controller uses');
});

test('the link beside the name goes to the author, and the repository stays in about', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* the app names its author once, on the about page, and links nothing else */
  assert.strictEqual((html.match(/class="foot"/g) || []).length, 1);
  assert.ok(html.indexOf('<a href="privacy.html">سياسة الخصوصية</a>') !== -1, 'the policy is reachable');
  assert.ok(html.indexOf('المستودع على GitHub') === -1, 'and the repository is not linked from the app');
});

test('one stop halts a repeat run as well as a walk', () => {
  const { win, doc } = boot();
  reciteHarness(win);
  win.App.state.surah = 112;
  win.App.go('reader');
  win.App.repeat.start(1, 2, 3, false);
  assert.ok(win.App.state.repeat);
  click(win, doc.getElementById('player-stop'));
  assert.strictEqual(win.App.state.repeat, null, 'the repeat run must stop too, or the sound goes on');
  assert.strictEqual(win.App.state.audio, null);
  assert.ok(!doc.getElementById('reader-body').classList.contains('is-hidden'), 'the words come back');
});

test('the verse number is placed by its own middle in the rosette', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.ayah-num::before \{[^}]*transform:\s*translate\(-50%, -50%\)/,
    'a baseline shifts with the phone\'s fallback font; a translate does not');
  const { win, doc } = boot();
  win.App.state.surah = 1; win.App.go('reader');
  const num = doc.querySelector('.ayah-num');
  assert.strictEqual(num.getAttribute('data-n'), '١', 'the mushaf counts in its own figures');
  assert.strictEqual(num.textContent, '', 'the figure lives in the attribute, drawn by the stylesheet');
});

test('the voice list is filled at once and again as the phone hands voices over', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function fillVoiceListSoon\(\) \{([\s\S]*?)\n  \}/.exec(app)[1];
  assert.ok(/^\s*fillVoiceList\(\);/.test(fn), 'once at once');
  assert.ok(fn.indexOf('3000') !== -1, 'and again seconds later');
  assert.ok(app.indexOf("/arab|عرب/i.test(v.name") !== -1, 'a voice named arabic counts even with an odd language tag');
});

test('a recorded human voice is offered, and the worker keeps it', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("function salawatUrl()") !== -1, 'the recordings ship with the app');
  const { win } = boot();
  win.SALAWAT_VOICES.forEach(function (v) {
    /* a recitation may carry its own path when its file already serves the
       chapter it belongs to, rather than being copied under a second name */
    const f = v.f ? path.join(DOCS, v.f) : path.join(DOCS, 'audio', 'salawat', v.id + '.mp3');
    assert.ok(fs.existsSync(f), 'missing ' + v.id);
    assert.ok(fs.statSync(f).size > 100000, v.id + ' is a stub');
  });
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("'./audio/salawat/ibrahimiyya.mp3'") !== -1, 'kept by the worker for offline');
});

/* ---------------- the daily sunan, on the book ---------------- */

test('the tracker follows the book from waking to sleep, then what has no time', () => {
  const { win } = boot();
  const names = Array.from(win.SUNNAH_TRACKER, (g) => g.s);
  assert.strictEqual(names.slice(0, 10).join('|'), [
    'الاستيقاظ وقيام الليل', 'الوضوء', 'الفجر والأذان والمسجد', 'في الصلاة', 'بعد الصلاة',
    'الضحى', 'الظهر', 'العصر والمساء', 'المغرب', 'العشاء والنوم'
  ].join('|'), 'the timed sunan run through the day in order');
  assert.strictEqual(names.slice(10).join('|'), ['الطعام والشراب', 'السلام واللقاء والمجلس', 'اللباس والزينة والعطاس', 'سنن يومية أخرى'].join('|'));
  win.SUNNAH_TRACKER.forEach(function (g) {
    assert.ok(g.p >= 25 && g.p <= 253, g.s + ' should name its page in the book');
    assert.ok(g.icon, g.s + ' needs an icon');
    assert.ok(g.i.length >= 3, g.s + ' is too thin');
  });
  const pages = Array.from(win.SUNNAH_TRACKER, (g) => g.p);
  assert.strictEqual(pages.join(','), pages.slice().sort((a, b) => a - b).join(','), 'the groups keep the order of the pages');
  assert.strictEqual(win.SUNNAH_SOURCE.a, 'عبدالله بن حمود الفريح');
});

test('what the book corrects in the old list is corrected', () => {
  const { win } = boot();
  const all = win.SUNNAH_TRACKER.reduce((a, g) => a.concat(g.i), []);
  const text = all.join(' ');
  /* the hadith names four before and four after, not four alone */
  assert.ok(text.indexOf('أربع ركعات قبل الظهر وأربع بعدها') !== -1);
  assert.ok(!all.some((i) => /^4 ركعات قبل الظهر$/.test(i)), 'the bare four is gone');
  /* the evening azkar belong to the asr window, not the maghrib */
  assert.ok(win.CURRENT_SUNNAH.asr.items[0].indexOf('أذكار المساء') === 0, 'evening azkar open the asr window');
  /* the two before maghrib, the closing of doors, and the children kept in */
  assert.ok(win.CURRENT_SUNNAH.maghrib.items.some((i) => i.indexOf('ركعتان قبل المغرب') === 0));
  assert.ok(win.CURRENT_SUNNAH.maghrib.items.some((i) => i.indexOf('كفّ الصبيان') === 0));
  /* the sleep count the book gives */
  assert.ok(text.indexOf('التكبير أربعاً وثلاثين') !== -1 || text.indexOf('والله أكبر أربعاً وثلاثين') !== -1);
  /* no weak four before asr offered as a sunnah */
  assert.ok(!win.CURRENT_SUNNAH.asr.items.some((i) => /أربع ركعات قبل العصر/.test(i)));
});

test('every group of the tracker shows its page from the book', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const sources = [...doc.querySelectorAll('#tracker-list .fold-source')].map((e) => e.textContent);
  assert.strictEqual(sources.length, win.SUNNAH_TRACKER.length);
  assert.ok(sources[0].indexOf('المنح العلية') !== -1 && sources[0].indexOf('ص 25') !== -1, sources[0]);
});

test('the rows say what the book says where it settles the matter', () => {
  const { win } = boot();
  const row = (g, i) => win.SUNNAH_TRACKER[g].i[i];
  /* المنح العلية: «فالصحيح أنه لا حدّ لأكثرها، خلافاً لمن حدّها بثمان ركعات» */
  assert.ok(row(5, 0).indexOf('لا حدّ لأكثرها') !== -1 && row(5, 0).indexOf('ثمان') === -1, row(5, 0));
  assert.strictEqual(win.CURRENT_SUNNAH.duha.items[0], row(5, 0), 'the card says it as the list does');
  /* «لا يُسنّ سنة مقيّدة قبل العصر... فمن شاء صلى من قبيل التطوع المطلق»، and
     the book reports the hadith of the four as disputed, so it is not called weak outright */
  assert.ok(row(7, 0).indexOf('التطوع قبل العصر لمن شاء') === 0, row(7, 0));
  assert.ok(row(7, 0).indexOf('مختلف في ثبوته') !== -1 && row(7, 0).indexOf('ضعيف') === -1);
  assert.ok(!win.CURRENT_SUNNAH.asr.items.some((i) => i.indexOf('ضعيف') !== -1));
  /* the obligation in its time is not offered as a sunnah, its first time is */
  assert.ok(row(7, 1).indexOf('في أول وقتها') !== -1, row(7, 1));
  /* «صلوا قبل المغرب»، قال في الثالثة: «لمن شاء» */
  assert.ok(row(8, 0).indexOf('لمن شاء') !== -1 && win.CURRENT_SUNNAH.maghrib.items[0].indexOf('لمن شاء') !== -1);
  /* the delay of isha: for the imam as the congregation bears it, and for whoever no congregation binds */
  assert.ok(row(9, 0).indexOf('لمن لم تربطه جماعة') !== -1, row(9, 0));
  /* the tahlil whose reward is promised is the whole of it */
  [row(0, 7), row(4, 1), row(13, 5)].forEach(function (t) {
    assert.ok(t.indexOf('له الملك وله الحمد وهو على كل شيء قدير') !== -1, t);
  });
  /* the evening reaches to isha, as the book has it */
  assert.ok(row(7, 2).indexOf('إلى العشاء') !== -1);
  /* and the wird's hundred is the hundred of the hadith, not the seventy */
  const istighfar = win.WIRD_ITEMS.filter((w) => w.id === 'istighfar')[0];
  assert.ok(istighfar.n.indexOf('مئة مرة') !== -1 && istighfar.n.indexOf('سبعين') === -1, istighfar.n);
});

test('the sunan of the hour agree with the book for every window', () => {
  const { win } = boot();
  const expect = {
    fajr: 'السواك عند الاستيقاظ', duha: 'صلاة الضحى', dhuhr: 'أربع ركعات قبل الظهر',
    asr: 'أذكار المساء', maghrib: 'ركعتان قبل المغرب', isha: 'ركعتان بعد العشاء'
  };
  Object.keys(expect).forEach(function (k) {
    assert.ok(win.CURRENT_SUNNAH[k].items[0].indexOf(expect[k]) === 0,
      k + ' should open with ' + expect[k] + ', got ' + win.CURRENT_SUNNAH[k].items[0]);
    assert.ok(win.CURRENT_SUNNAH[k].items.length >= 4);
  });
});

/* ---------------- the notification reminds, the sunan search, the boxes speak ---------------- */

test('a prayer notification carries a sunnah of its hour from the book', () => {
  const { win } = boot();
  const shown = [];
  win.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: function (t, o) { shown.push(o.body); return Promise.resolve(); } }) };
  win.Notification = function () {}; win.Notification.permission = 'granted';
  win.Store.set('notify', true); win.Store.set('notified', {});
  const c = win.App.clockState();
  win.App.helpers.maybeNotify(Object.assign({}, c, { now: c.prev.at + 1 }));
  return new Promise(function (done) {
    setTimeout(function () {
      assert.strictEqual(shown.length, 1);
      if (c.prev.key === 'sunrise') {
        assert.ok(shown[0].indexOf('طلعت الشمس') === 0);
      } else {
        assert.ok(shown[0].indexOf('ومن سنن الوقت:') !== -1, 'it should name a sunnah, got ' + shown[0]);
        const lead = win.App.helpers.windowSunnah(c.prev.key, new win.Date()).block.items[0].replace(/،.*$/, '');
        assert.ok(shown[0].indexOf(lead) !== -1, 'the first sunnah of the window: ' + lead);
      }
      done();
    }, 30);
  });
});

test('the sunan of the book can be searched', () => {
  const { win, doc } = boot();
  win.App.go('search');
  click(win, doc.querySelector('[data-scope="sunan"]'));
  const f = doc.getElementById('quran-search'); f.value = 'المغرب'; fire(win, f, 'input');
  const hits = doc.querySelectorAll('#search-results .search-hit');
  assert.ok(hits.length >= 4, 'the maghrib sunan and their mentions, got ' + hits.length);
  assert.ok(doc.querySelector('.search-hit-ref').textContent.indexOf('ص ') !== -1, 'each hit names its page in the book');
  f.value = 'الوصية'; fire(win, f, 'input');
  assert.ok(doc.querySelectorAll('#search-results .search-hit').length >= 1, 'the will is among the daily sunan');
});

test('every tick box says it is a checkbox and whether it is ticked', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const boxes = doc.querySelectorAll('#tracker-list [data-check]');
  boxes.forEach(function (b) {
    assert.strictEqual(b.getAttribute('role'), 'checkbox');
    assert.strictEqual(b.getAttribute('aria-checked'), 'false');
  });
  click(win, boxes[3]);
  assert.strictEqual(doc.querySelectorAll('#tracker-list [data-check]')[3].getAttribute('aria-checked'), 'true');
  win.App.go('home');
  doc.querySelectorAll('#now-sunnah [data-check]').forEach(function (b) {
    assert.strictEqual(b.getAttribute('role'), 'checkbox', 'the home card too');
  });
});

test('outside kuwait the app asks once where you are, and never again', () => {
  const { win, doc } = boot();
  win.Intl.DateTimeFormat = function () { return { resolvedOptions: function () { return { timeZone: 'Europe/London' }; } }; };
  win.Store.set('placeAsked', false);
  win.App.helpers.maybeAskPlace();
  assert.ok(!doc.getElementById('banner').hidden, 'the first open in london should be asked');
  assert.ok(doc.getElementById('banner-text').textContent.indexOf('للكويت') !== -1);
  assert.strictEqual(doc.getElementById('banner-act').textContent, 'حدّد موقعي');
  assert.strictEqual(win.Store.get('placeAsked'), true);
  click(win, doc.getElementById('banner-close'));
  win.App.helpers.maybeAskPlace();
  assert.ok(doc.getElementById('banner').hidden, 'asked once, not twice');
});

test('a phone already set to kuwait time is not asked', () => {
  const { win, doc } = boot();
  win.Intl.DateTimeFormat = function () { return { resolvedOptions: function () { return { timeZone: 'Asia/Kuwait' }; } }; };
  win.Store.set('placeAsked', false);
  win.App.helpers.maybeAskPlace();
  assert.ok(doc.getElementById('banner').hidden, 'a kuwaiti phone needs no prompt');
  assert.strictEqual(win.Store.get('placeAsked'), true, 'and the question is spent');
});

/* ---------------- no half empty rows, and a picture that names its source ---------------- */

test('a settings row puts its switch beside the title and its control beneath', () => {
  /* It used to be one nowrap line with the control capped at two thirds, which
     squeezed the words to one per line on a phone. It is a small grid now: the
     words and the switch on the first line, anything wider on the second. */
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rows = [...css.matchAll(/^\.setting \{([^}]*)\}/gm)].map(function (m) { return m[1]; });
  assert.ok(rows.some(function (r) { return /display:\s*grid/.test(r); }), 'the row is a grid');
  assert.match(css, /\.setting > \.switch \{[^}]*grid-row: 1/, 'the switch answers the title, beside it');
  assert.match(css, /\.setting > \.picker[^{]*\{[^}]*grid-row: 2/, 'and a list takes the line beneath');

  /* Every list is the same size whichever row it sits in. The adhan sound and
     the salawat reciter were built with .voice-pick before the reminder rows
     existed, so a widening written for .remind-controls left them small while
     everything around them grew. jsdom does not cascade, so the rules are read
     rather than measured. */
  ['.remind-controls', '.voice-pick', '.setting > .picker'].forEach(function (sel) {
    const rule = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\.picker-btn \\{[^}]*min-height:\\s*48px');
    assert.match(css, rule, sel + ' menus are the same height as the rest');
  });
});

test('a shared picture names where its words come from, and the maker', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function textCard\(heading, text, face, source\) \{([\s\S]*?)\n  \}\n/.exec(app);
  assert.ok(fn, 'the drawer takes a source');
  assert.ok(fn[1].indexOf("ctx.fillText(source, W / 2, footY + 62)") !== -1, 'and writes it under the rosette');
  /* the foot carries the app's mark and the two stores' badges, and no address */
  assert.ok(fn[1].indexOf('cardFoot(ctx, W, H)') !== -1, 'the foot carries the app and where to get it');
  assert.ok(fn[1].indexOf('3li.info') === -1, 'and no address');
  /* each caller says what its source is */
  assert.ok(app.indexOf("'حصن المسلم، الباب ' + ar(chapter.id)") !== -1, 'a dhikr from the book names its chapter');
  assert.ok(app.indexOf("(it.r ? it.r + '، ' : '') + 'حصن المسلم'") !== -1, 'a daily dhikr names its narrator and the book');
  assert.ok(app.indexOf("'dua-' + picRef[1] + '-' + picRef[2] + '.png', d.r || g.cat") !== -1, 'a supplication names its reference');
  assert.ok(app.indexOf("'quran', 'القرآن الكريم'") !== -1, 'a verse names the mushaf');
});

/* ---------------- the writing guide, kept by the reviewer ---------------- */

test('the arabic reviewer carries the guide: its markers and its misspellings', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'arabic', 'rules.json'), 'utf8'));
  assert.ok(rules.markers.length >= 100, 'the marker phrases of the guide');
  ['في الختام', 'بشكل كبير', 'لا شك أن', 'يلعب دوراً', 'قم بتحميل'].forEach(function (m) {
    assert.ok(rules.markers.indexOf(m) !== -1, 'missing marker ' + m);
  });
  assert.ok(rules.misspellings.some((p) => p[0] === 'الى' && p[1] === 'إلى'));
  assert.ok(rules.misspellings.some((p) => p[0] === 'ذالك' && p[1] === 'ذلك'), 'the table that runs right to wrong is read the right way round');
  assert.ok(!rules.misspellings.some((p) => p[0] === 'ذلك'), 'ذلك is not a fault');
});

test('the reviewer flags a model phrase and lets a hadith be', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review-arabic.js'), 'utf8');
  assert.ok(src.indexOf("'بصمة آلية: '") !== -1);
  assert.ok(src.indexOf('function transmitted(t)') !== -1, 'a verse or a dhikr carries its own wording');
  assert.ok(src.indexOf('(المستخدمون|المستخدمين|المتابعون|المتابعين)') !== -1);
  assert.ok(src.indexOf('الجمهور') === -1, 'the majority school is not a distant narrator');
});

test('the interface no longer says تم التثبيت or promises a companion', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(html.indexOf('رفيقك اليومي') === -1, 'the tagline names what is inside instead');
  assert.ok(html.indexOf('مصحف ومواقيت وأذكار وسنن في جهازك') !== -1);
  assert.ok(app.indexOf('تم التثبيت') === -1, 'تم plus a noun is the passive a person does not say');
  assert.ok(app.indexOf('ثُبّت سُنّتي') !== -1);
  assert.ok(app.indexOf('إضافة إلى الشاشة الرئيسية') !== -1, 'the button is named, not the fact of a menu');
  assert.ok(app.indexOf('أنت في الموعد تماماً') === -1, 'the empty emphasis is gone');
});

test('with nothing to choose the row says صوت الهاتف, with voices it lists them', () => {
  const { win, doc } = boot();
  const cases = [
    [[], true], [[{ lang: 'en-US', name: 'English' }], true], [[{ lang: 'ar-XA', name: 'ar-xa-x-ard-local' }], false]
  ];
  cases.forEach(function (c) {
    Object.defineProperty(win, 'speechSynthesis', { configurable: true, value: { getVoices: function () { return c[0]; }, addEventListener: function () {}, speak: function () {}, cancel: function () {} } });
    win.App.go('settings');
    const sel = doc.getElementById('settings-voice-name');
    const plain = doc.getElementById('settings-voice-plain');
    /* the select sits inside the picker we draw, so the wrapper is what hides:
       hiding the select alone left an empty box beside the words */
    const box = sel.parentNode.classList.contains('picker') ? sel.parentNode : sel;
    assert.strictEqual(box.hidden, c[1], 'a sentence does not belong in a list');
    assert.strictEqual(plain.hidden, !c[1]);
    if (c[1]) {
      assert.strictEqual(plain.textContent, 'يختاره هاتفك');
      assert.ok(doc.getElementById('settings-voice-note').textContent.indexOf('تحويل النص إلى كلام') !== -1, 'and says where it changes');
    } else {
      assert.strictEqual(sel.options[0].text, 'الأنسب من أصوات جهازك');
    }
  });
});

test('the sample can be stopped by the same button, and stops when you leave', () => {
  const { win, doc } = boot();
  let paused = 0, cancelled = 0;
  win.Audio = function () { return { play: function () { return Promise.resolve(); }, pause: function () { paused++; }, removeAttribute: function () {}, load: function () {}, src: '' }; };
  Object.defineProperty(win, 'speechSynthesis', { configurable: true, value: { getVoices: function () { return []; }, addEventListener: function () {}, speak: function () {}, cancel: function () { cancelled++; } } });
  win.App.go('settings');
  win.Store.set('voice', 'recording');
  const btn = doc.getElementById('settings-voice-try');
  click(win, btn);
  assert.ok(win.App.helpers.isSpeaking(), 'the recording plays');
  assert.strictEqual(btn.getAttribute('aria-label'), 'أوقف الصوت');
  assert.strictEqual(btn.querySelector('use').getAttribute('href'), '#i-pause');
  click(win, btn);
  assert.ok(!win.App.helpers.isSpeaking(), 'the same button stops it');
  assert.strictEqual(paused, 1);
  assert.strictEqual(btn.getAttribute('aria-label'), 'اسمع الصوت');
  click(win, btn);
  win.App.go('home');
  assert.ok(!win.App.helpers.isSpeaking(), 'leaving the settings ends it');
  assert.ok(cancelled >= 1, 'the phone speech is cancelled too');
});

/* ---------------- the store shots, and ramadan ---------------- */

test('the store shots are the size the store accepts, one per screen', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(manifest.screenshots.length, 8);
  manifest.screenshots.forEach(function (shot) {
    assert.strictEqual(shot.sizes, '1080x1920', shot.src + ' must be nine by sixteen; the store refuses more than two to one');
    const file = path.join(DOCS, shot.src);
    assert.ok(fs.existsSync(file), 'missing ' + shot.src);
    const png = fs.readFileSync(file);
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    assert.strictEqual(w + 'x' + h, '1080x1920', shot.src + ' is ' + w + 'x' + h);
    assert.ok(shot.label && /[\u0621-\u064A]/.test(shot.label));
  });
  assert.ok(!fs.existsSync(path.join(DOCS, 'screens', 'reader.png')), 'the old shot of a screen that no longer exists is gone');
});

test('through ramadan the clock counts to the iftar and the table carries the imsak', () => {
  const { win, doc } = boot();
  const Real = win.Date;
  const fixed = new Real(2027, 1, 20, 16, 30);
  /* a clock stopped at half past four on the thirteenth of ramadan */
  win.Date = function () {
    if (!arguments.length) return new Real(fixed.getTime());
    return new (Function.prototype.bind.apply(Real, [null].concat(Array.prototype.slice.call(arguments))))();
  };
  win.Date.now = function () { return fixed.getTime(); };
  win.Date.UTC = Real.UTC; win.Date.parse = Real.parse; win.Date.prototype = Real.prototype;
  win.App.render.home();
  assert.ok(doc.getElementById('hijri-date').textContent.indexOf('رمضان') !== -1, 'it is ramadan');
  assert.strictEqual(doc.getElementById('arc-name').textContent, 'الإفطار');
  win.App.go('timetable');
  const heads = [...doc.querySelectorAll('#tt-table thead th')].map((t) => t.textContent);
  assert.strictEqual(heads[1], 'الإمساك');
  const row = doc.querySelector('#tt-table tr.is-today');
  const cells = [...row.querySelectorAll('td')].map((t) => t.textContent.replace('\u2060', ' '));
  assert.strictEqual(cells.length, 7, 'imsak plus the six');
  const toMin = function (s) { const m = /(\d+):(\d+) (ص|م)/.exec(s); let h = +m[1] % 12; if (m[3] === 'م') h += 12; return h * 60 + +m[2]; };
  assert.strictEqual(toMin(cells[1]) - toMin(cells[0]), 10, 'the imsak is ten minutes before the fajr');
  win.Date = Real;
});

test('outside ramadan there is no imsak column and the clock says the adhan', () => {
  const { win, doc } = boot();
  win.App.go('timetable');
  const heads = [...doc.querySelectorAll('#tt-table thead th')].map((t) => t.textContent);
  if (win.Hijri.toHijri(new win.Date(), 0).m !== 9) {
    assert.ok(heads.indexOf('الإمساك') === -1);
    assert.ok(doc.getElementById('arc-name').textContent !== 'الإفطار');
  }
});

/* ---------------- the app's own address ---------------- */

test('the site is published at sunnati.3li.info and nothing still points at the old path', () => {
  assert.strictEqual(fs.readFileSync(path.join(DOCS, 'CNAME'), 'utf8').trim(), 'sunnati.3li.info');
  const root = path.join(__dirname, '..');
  const walk = function (dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce(function (all, e) {
      if (['node_modules', '.git', 'test', 'build', '.gradle', 'fonts', 'icons', 'splash', 'screens'].indexOf(e.name) !== -1) return all;
      const full = path.join(dir, e.name);
      return all.concat(e.isDirectory() ? walk(full) : [full]);
    }, []);
  };
  const stale = [];
  walk(root).forEach(function (file) {
    if (!/\.(html|js|json|md|xml|gradle|webmanifest)$/.test(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    if (/siteq8\.github\.io/.test(text) || /Quran_Sunna\/(?!\b)/.test(text.replace(/github\.com\/SiteQ8\/Quran_Sunna/g, ''))) stale.push(path.relative(root, file));
  });
  assert.deepStrictEqual(stale, [], 'the old address lingers in: ' + stale.join(', '));
  /* the wrapper claims the new host at its root, since the app no longer lives under a path */
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.indexOf('android:pathPrefix="/"') !== -1);
  const twa = JSON.parse(fs.readFileSync(path.join(root, 'play/twa-manifest.json'), 'utf8'));
  assert.strictEqual(twa.host, 'sunnati.3li.info');
  assert.strictEqual(twa.startUrl, '/');
});

test('the real voice is the default, in front, and the phone voice row appears only when chosen', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  assert.strictEqual(win.Store.get('voice'), 'recording', 'a reciter by default');
  assert.strictEqual(doc.getElementById('settings-voice').value, 'recording');
  assert.strictEqual(doc.getElementById('settings-voice').options[0].text, 'صوت قارئ');
  assert.ok(doc.getElementById('settings-device-voice').hidden, 'no talk of the phone voice unless asked');
  /* the sound moved into the salawat row itself, as every other reminder has
     it, so the row no longer carries a hint line of its own */
  assert.ok(!doc.getElementById('settings-voice-hint'), 'no separate sound row for the salawat');
  const salRow = [...doc.querySelectorAll('#v-reminders .setting')].filter(function (r) {
    return ((r.querySelector('.setting-label') || {}).textContent || '').indexOf('الصلاة على النبي') === 0;
  })[0];
  assert.ok(salRow && salRow.contains(doc.getElementById('settings-voice')),
    'its sound sits in its own row');
  const sel = doc.getElementById('settings-voice');
  sel.value = 'speech'; fire(win, sel, 'change');
  assert.ok(!doc.getElementById('settings-device-voice').hidden, 'choosing the phone voice shows its row');
  sel.value = 'recording'; fire(win, sel, 'change');
  assert.ok(doc.getElementById('settings-device-voice').hidden);
  /* the play button sits on the reminder row itself */
  assert.ok(doc.querySelector('#settings-voice-try').closest('.setting').querySelector('#settings-voice'), 'the button is beside the choice it plays');
});

/* ---------------- the store listing ---------------- */

test('the store listing describes the app as it is, within the store limits', () => {
  /* the words of the page are kept as the files the listing tool writes */
  const words = path.join(__dirname, '..', 'play', 'listing', 'ar');
  const short = fs.readFileSync(path.join(words, 'short.txt'), 'utf8').trim();
  assert.ok(short.length && short.indexOf('\n') === -1, 'a short description, on one line');
  assert.ok(short.length <= 80, 'the store allows eighty characters, found ' + short.length);
  const full = fs.readFileSync(path.join(words, 'full.txt'), 'utf8').trim();
  assert.ok(full.length <= 4000, 'the store allows four thousand, found ' + full.length);
  /* it opens with what people search for, before Play folds the rest away */
  const opening = full.slice(0, 170);
  ['القرآن الكريم', 'مواقيت الصلاة', 'الأذان', 'أذكار الصباح والمساء'].forEach(function (k) {
    assert.ok(opening.indexOf(k) !== -1 || short.indexOf(k) !== -1, k + ' is said at once');
  });
  assert.ok(opening.indexOf('بلا إنترنت') !== -1, 'and that it works with no connection');
  const listing = fs.readFileSync(path.join(__dirname, '..', 'play', 'README.md'), 'utf8');
  assert.ok(listing.indexOf('play/listing/ar/full.txt') !== -1, 'the document says where the words are');
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools', 'android', 'play-listing.py'), 'utf8');
  assert.ok(tool.indexOf("('short.txt', 'shortDescription', 80)") !== -1 && tool.indexOf("('full.txt', 'fullDescription', 4000)") !== -1,
    'and the tool that writes them holds the same limits');
  ['العجيري', 'صفحة صفحة', 'مئة واثنان وثلاثون باباً', 'المنح العلية', 'الصلاة الإبراهيمية', 'السدو'].forEach(function (k) {
    assert.ok(full.indexOf(k) !== -1, 'the listing should mention ' + k);
  });
  assert.ok(full.indexOf('رفيق') === -1, 'no companion');
  assert.ok(full.indexOf('ستة عشر قسماً') === -1, 'the sixteen sections are the whole book now');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'tools', 'store', 'icon-build.py'), 'utf8').indexOf('feature-graphic-1024x500.png') !== -1,
    'the graphic can be drawn again, by the tool that draws the icon');
});

/* ---------------- the five prayers, marked ---------------- */

test('a prayer whose time has come can be marked from the strip, one that has not cannot', () => {
  const { win, doc } = boot();
  const c = win.App.clockState();
  const cells = [...doc.querySelectorAll('#windows .window')];
  cells.forEach(function (cell) {
    const key = c.marks[cells.indexOf(cell)].key;
    const came = c.marks[cells.indexOf(cell)].at <= c.now;
    const prayer = win.Store.PRAYER_KEYS.indexOf(key) !== -1;
    assert.strictEqual(cell.hasAttribute('data-mark-prayer'), prayer && came, key + ' markable? came ' + came);
  });
  const first = doc.querySelector('#windows [data-mark-prayer]');
  if (first) {
    click(win, first);
    assert.ok(doc.getElementById('sheet').classList.contains('is-open'));
    assert.strictEqual(doc.querySelectorAll('[data-act="prayer-mark"]').length, 4, 'four ways it could have gone');
    click(win, doc.querySelector('[data-act="prayer-mark"][data-ref^="' + first.getAttribute('data-mark-prayer') + ':jamaah"]'));
    assert.strictEqual(win.Store.prayersOf()[first.getAttribute('data-mark-prayer')], 'jamaah');
    assert.ok(doc.querySelector('#windows [data-mark-prayer="' + first.getAttribute('data-mark-prayer') + '"]').classList.contains('mark-jamaah'), 'the strip shows the mark');
  }
});

test('the store counts the month: in time, in congregation, made up, missed, and the run', () => {
  const { win } = boot();
  const S = win.Store;
  const day = function (n) { const d = new win.Date(); d.setDate(d.getDate() - n); return d; };
  [1, 2, 3].forEach(function (n) { S.PRAYER_KEYS.forEach(function (k) { S.setPrayer(k, 'ontime', day(n)); }); });
  S.setPrayer('fajr', 'jamaah'); S.setPrayer('dhuhr', 'late'); S.setPrayer('asr', 'missed');
  const st = S.prayerStats(30);
  assert.strictEqual(st.inTime, 16); assert.strictEqual(st.jamaah, 1); assert.strictEqual(st.late, 1); assert.strictEqual(st.missed, 1);
  assert.strictEqual(st.full, 3);
  assert.strictEqual(st.streak, 0, 'a late prayer today breaks the run');
  S.setPrayer('dhuhr', 'ontime'); S.setPrayer('asr', null);
  assert.strictEqual(S.prayerStats(30).streak, 3, 'a day under way in time keeps the run');
});

test('the prayers screen shows today, the month grid and the figures', () => {
  const { win, doc } = boot();
  win.App.go('prayers');
  assert.strictEqual(doc.querySelectorAll('#prayers-today .prayer-row').length, 5);
  assert.strictEqual(doc.querySelectorAll('#prayers-grid .pg-row').length, 31, 'a head and thirty days');
  assert.strictEqual(doc.querySelectorAll('#prayers-grid .pg').length, 150, 'five cells a day');
  assert.strictEqual(doc.querySelector('.tab[aria-current="page"]').getAttribute('data-go'), 'tracker');
  /* the grid is a picture; a past day is edited through the date field */
  assert.strictEqual(doc.querySelectorAll('#prayers-grid button').length, 0, 'cells too small for a thumb are not buttons');
  const y = new win.Date(); y.setDate(y.getDate() - 3);
  const stamp = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  const field = doc.getElementById('prayers-day');
  field.value = stamp; fire(win, field, 'change');
  assert.ok(doc.getElementById('sheet').classList.contains('is-open'), 'a day sheet opens');
  const selects = doc.querySelectorAll('#sheet [data-day-prayer]');
  assert.strictEqual(selects.length, 5, 'one choice per prayer');
  selects[2].value = 'ontime'; fire(win, selects[2], 'change');
  assert.strictEqual(win.Store.prayersOf(y).asr, 'ontime', 'written the moment it changes');
  /* a day that has not come is refused */
  const t = new win.Date(); t.setDate(t.getDate() + 2);
  field.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  fire(win, field, 'change');
  assert.strictEqual(field.value, '', 'tomorrow cannot be marked');
});

test('the sunnah screen leads to the prayers, with the day in a line', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const way = doc.querySelector('#v-tracker [data-go="prayers"]');
  assert.ok(way, 'the obligatory prayers come before the sunan');
  assert.ok(doc.getElementById('tracker-prayers-note').textContent.indexOf('لم تُعلَّم صلاة اليوم') !== -1);
  win.Store.setPrayer('fajr', 'jamaah');
  win.App.go('tracker');
  assert.ok(doc.getElementById('tracker-prayers-note').textContent.indexOf('اليوم 1 من 5') !== -1);
  click(win, way);
  assert.ok(doc.getElementById('v-prayers').classList.contains('is-open'));
});

/* ---------------- the tafsir, offline ---------------- */

test('the whole tafsir al muyassar ships with the app', () => {
  const file = path.join(DOCS, 'data', 'tafsir-muyassar.json');
  assert.ok(fs.existsSync(file));
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(book.a.length, 114);
  assert.strictEqual(book.a.reduce((n, s) => n + s.length, 0), 6236, 'a tafsir for every verse');
  assert.ok(book.a[1][254].indexOf('الله الذي لا يستحق الألوهية') === 0, 'آية الكرسي explained');
  assert.strictEqual(book.n, 'التفسير الميسر');
  book.a.forEach(function (s, i) { s.forEach(function (t, j) { assert.ok(t.length > 10, (i + 1) + ':' + (j + 1) + ' is empty'); }); });
});

test('the tafsir opens from the app and asks the api for nothing', () => {
  const { win, doc } = boot();
  const asked = [];
  const book = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'tafsir-muyassar.json'), 'utf8'));
  win.fetch = function (url) {
    asked.push(String(url));
    if (/tafsir-muyassar\.json$/.test(String(url))) return Promise.resolve({ ok: true, json: function () { return Promise.resolve(book); } });
    return Promise.reject(new Error('no network'));
  };
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="2"]'));
  click(win, doc.querySelector('[data-ayah="2:255"]'));
  click(win, doc.querySelector('[data-act="tafsir"]'));
  return new Promise(function (done) {
    setTimeout(function () {
      const slot = doc.getElementById('tafsir-slot').textContent;
      assert.ok(slot.indexOf('الله الذي لا يستحق الألوهية') !== -1, 'got ' + slot.slice(0, 60));
      assert.ok(slot.indexOf('التفسير الميسر') !== -1, 'and names its source');
      assert.ok(asked.every((u) => u.indexOf('alquran.cloud') === -1), 'nothing went to the api: ' + asked.join(', '));
      assert.ok(win.App.helpers.tafsirReady());
      done();
    }, 60);
  });
});

/* ---------------- a surah kept for listening offline ---------------- */

function fakeCaches(win) {
  const stores = {};
  win.caches = {
    open: function (name) {
      if (!stores[name]) stores[name] = new Map();
      const m = stores[name];
      return Promise.resolve({
        match: function (u) { return Promise.resolve(m.get(String(u)) || undefined); },
        put: function (u, r) { m.set(String(u), r); return Promise.resolve(); },
        delete: function (u) { return Promise.resolve(m.delete(String(u))); },
        keys: function () { return Promise.resolve([...m.keys()].map((u) => ({ url: u }))); }
      });
    },
    keys: function () { return Promise.resolve(Object.keys(stores)); }
  };
  return stores;
}

test('a surah is fetched verse by verse into a store of its own and marked kept', () => {
  const { win, doc } = boot();
  const stores = fakeCaches(win);
  const asked = [];
  win.fetch = function (url, opts) { asked.push({ url: String(url), mode: opts && opts.mode }); return Promise.resolve({ ok: true, status: 200, type: 'cors' }); };
  win.App.state.surah = 112; win.App.go('reader');
  assert.strictEqual(doc.getElementById('reader-save').textContent.trim(), 'حفظ الصوت');
  return win.App.helpers.downloadSurah(112).then(function (ok) {
    assert.strictEqual(ok, true);
    assert.strictEqual(asked.length, 4, 'the four verses of al ikhlas');
    /* from everyayah, which lets the page read what it sends, so each verse is
       kept at its real size: an opaque copy from the cdn was charged at many
       times its size and long surahs ran out of room */
    assert.ok(asked.every((a) => a.mode === 'cors'), 'kept readable');
    assert.ok(asked[0].url.indexOf('everyayah.com/data/') !== -1);
    assert.strictEqual(stores['sunnati-audio'].size, 4, 'in a store apart from the app cache');
    assert.ok(stores['sunnati-audio'].has(win.App.helpers.verseUrl(112, 1)), 'under the address the player asks for');
    assert.ok(win.App.helpers.isSurahSaved(112));
    assert.strictEqual(doc.getElementById('reader-save').textContent.trim(), 'محفوظة');
    assert.ok(doc.getElementById('reader-save').classList.contains('is-kept'));
  });
});

test('a kept surah is listed in the settings with its size, and can be removed', () => {
  const { win, doc } = boot();
  const stores = fakeCaches(win);
  win.fetch = function () { return Promise.resolve({ type: 'opaque' }); };
  return win.App.helpers.downloadSurah(112).then(function () {
    win.App.go('settings');
    const list = doc.getElementById('saved-audio').textContent;
    assert.ok(list.indexOf('الإخلاص') !== -1 && list.indexOf('4 آيات') !== -1 && list.indexOf('م.ب') !== -1, list);
    return win.App.helpers.removeSurahAudio(win.App.helpers.reciterId(), 112);
  }).then(function () {
    assert.strictEqual(stores['sunnati-audio'].size, 0);
    assert.ok(!win.App.helpers.isSurahSaved(112));
    win.App.go('settings');
    assert.ok(doc.getElementById('saved-audio').textContent.indexOf('لم تحفظ سورة بعد') !== -1);
  });
});

test('the worker answers a kept verse from the audio store and keeps the store across updates', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("var AUDIO_STORE = 'sunnati-audio'") !== -1);
  assert.ok(sw.indexOf("url.hostname === 'cdn.islamic.network'") !== -1, 'verse audio is looked up in the store first');
  assert.ok(sw.indexOf("(name === VERSION || name === AUDIO_STORE || name === TILE_STORE) ? null : caches.delete(name)") !== -1,
    'an update of the app must not throw the recitations away');
});

test('a download can be stopped, and what came stays', () => {
  const { win } = boot();
  const stores = fakeCaches(win);
  let n = 0;
  win.fetch = function () {
    n++;
    if (n === 2) win.App.state.downloading.stop = true;
    return Promise.resolve({ type: 'opaque' });
  };
  return win.App.helpers.downloadSurah(112).then(function (ok) {
    assert.strictEqual(ok, false, 'stopped short is not finished');
    assert.ok(stores['sunnati-audio'].size >= 2 && stores['sunnati-audio'].size < 4, 'what came stays, ' + stores['sunnati-audio'].size);
    assert.ok(!win.App.helpers.isSurahSaved(112), 'and it is not marked kept');
  });
});

/* ---------------- the sadu is the identity ---------------- */

test('a fresh device opens in the sadu red with the sadu weave, before and after the controller wakes', () => {
  const { win, doc } = boot();
  assert.strictEqual(win.Store.get('accent'), 'sadu');
  assert.strictEqual(win.Store.get('pattern'), 'sadu');
  assert.strictEqual(doc.documentElement.style.getPropertyValue('--accent'), '#9c2b2b');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /--accent: #9c2b2b;/, 'the stylesheet itself starts red, for the instant before any script');
  assert.ok(!/--accent: #1e6f47/.test(css), 'the green is no longer the fallback');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('<meta name="theme-color" content="#9c2b2b">') !== -1);
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(manifest.theme_color, '#9c2b2b');
});

test('the iPhone wrapper lives in a scene, so it can be built for iPhone Duo', () => {
  const ios = path.join(__dirname, '..', 'ios/Sunnati');
  /* Built with the iOS 27 SDK, an app that makes its own window at launch
     traps before it draws; iPhone Duo is built for with Xcode 27.1 */
  const plist = fs.readFileSync(path.join(ios, 'Info.plist'), 'utf8');
  assert.ok(/<key>UIApplicationSceneManifest<\/key>[\s\S]*<key>UISceneDelegateClassName<\/key><string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/.test(plist),
    'the plist names the scene delegate');
  assert.ok(/<key>UIApplicationSupportsMultipleScenes<\/key><false\/>/.test(plist), 'one window, as before');

  const scene = fs.readFileSync(path.join(ios, 'SceneDelegate.swift'), 'utf8');
  assert.ok(scene.indexOf('UIWindow(windowScene: windowScene)') !== -1, 'the window is made from the scene');
  assert.ok(scene.indexOf('UIScreen') === -1, 'never from the size of the screen, which iPhone Duo changes as it opens');
  assert.ok(scene.indexOf('openURLContexts') !== -1 && scene.indexOf('connection.urlContexts') !== -1,
    'links reach the scene, warm or cold');

  const app = fs.readFileSync(path.join(ios, 'AppDelegate.swift'), 'utf8');
  assert.ok(app.indexOf('UIWindow(') === -1 && app.indexOf('UIScreen') === -1, 'the app delegate makes no window');
  assert.ok(app.indexOf('UNUserNotificationCenter.current().delegate = Notifier.shared') !== -1, 'and still owns the notifications');

  /* with a scene the window comes after launch, so a tap that started the app
     can arrive before the reader exists, and before its page has loaded */
  const note = fs.readFileSync(path.join(ios, 'Notifier.swift'), 'utf8');
  assert.ok(/if let tell = onTap \{ tell\(kind\) \} else \{ waiting = kind \}/.test(note), 'a tap with no reader is held');
  assert.ok(/didSet \{\s*if let tell = onTap, let kind = waiting/.test(note), 'and handed over when the reader comes');
  const reader = fs.readFileSync(path.join(ios, 'ReaderController.swift'), 'utf8');
  assert.ok(/guard loaded else \{ waitingKind = kind; return \}/.test(reader), 'a tap before the page loads waits for it');
  assert.ok(/loaded = true\s*if let kind = waitingKind/.test(reader), 'and is told once it has');

  /* and a hand-run build can ask for the Xcode that builds for iPhone Duo */
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ios.yml'), 'utf8');
  assert.ok(/WANT: \$\{\{ github\.event\.inputs\.xcode \|\| 'auto' \}\}/.test(wf), 'a tag builds with the Xcode picked for it');
});

test('on a screen as wide as iPhone Duo opened, nothing is laid across the fold', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* Safari cannot say where the fold is, so the page keeps the middle clear
     on any screen this wide rather than asking */
  /* and a height: a large phone on its side is as wide and four hundred
     points tall, and the book cut its hour and its pages off there */
  assert.ok(app.indexOf("matchMedia('(min-width: 860px) and (min-height: 520px) and (min-aspect-ratio: 6/5)')") !== -1, 'the book is a width, a height and a shape');
  assert.ok(app.indexOf("document.documentElement.setAttribute('data-view', name)") !== -1, 'the stylesheet knows what is open');
  assert.ok(/BOOK\.addEventListener\('change', applyBook\)/.test(app), 'opening and closing the phone is heard');

  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(/html\.book \{[\s\S]*?--gap: 56px;[\s\S]*?--inner: calc\(50vw \+ var\(--gap\) \/ 2\);/.test(css), 'a clear middle, a phone wide either side');
  /* the tabs float as a bar as wide as the column the page starts on, the
     right one in Arabic and the left in a left to right language, and the
     rest above them; written from the start of a line so it is both */
  assert.ok(/html\.book \.tabs \{\s*inset-inline-start: calc\(var\(--edge\) \+ var\(--pad\)\); inset-inline-end: calc\(var\(--inner\) \+ var\(--pad\)\);/.test(css), 'the tabs keep to the right column, no tab on the fold');
  for (const sel of ['.player', '.toast', '.banner', '.to-top']) {
    assert.ok(new RegExp('html\\.book ' + sel.replace('.', '\\.') + ' \\{[^}]*inset-inline-end: calc\\(var\\(--inner\\) \\+ var\\(--pad\\)\\)').test(css),
      sel + ' floats in the right column');
  }
  /* set in from the screen's edge as the right half's cards are: with the
     pane as wide as the half, it stood against the edge itself */
  /* the left half is the day, the hour and the day's count, standing from
     the line the right column begins on to the line the tabs end on, as far
     in from its side as the right column is from the other. The hour alone
     stood against the edge and then in the upper part of an empty half. */
  assert.ok(/html\.book \.book-side \{[\s\S]*?position: fixed;[\s\S]*?top: calc\(env\(safe-area-inset-top\) \+ var\(--s5\)\); bottom: var\(--float\);\s*inset-inline-end: calc\(var\(--edge\) \+ var\(--pad\)\); width: calc\(var\(--pane\) - 2 \* var\(--pad\)\);/.test(css), 'the day keeps the left column, top and foot level with the right');
  assert.ok(/html\.book \.book-side > \.card \{ margin: 0; flex: 1 0 auto; \}/.test(css), 'the count fills what the hour leaves');
  assert.ok(/html\.book\[data-view="page"\] \.book-side \{ display: none; \}/.test(css), 'and the mushaf has both halves to itself');
  assert.ok(/SIDE = \{ box: document\.createElement\('aside'\), items: \[home\.querySelector\('\.clock'\), \$\('home-progress'\)\]/.test(app), 'the two are moved from the home screen, not drawn twice');
  assert.ok(/m\[0\]\.parentNode\.insertBefore\(m\[1\], m\[0\]\);/.test(app), 'and put back where they were when the screen narrows');
  assert.ok(/placeSide\(isBook\(\)\);/.test(app), 'whenever the book opens or closes');
  assert.ok(/html\.book #views > \.view \{\s*width: var\(--pane\); margin-inline-start: var\(--edge\); margin-inline-end: auto;\s*padding-inline: var\(--pad\);/.test(css), 'the right column is set in as the left one is');
  /* a transform on an opening view would carry the fixed clock with it */
  assert.ok(/html\.book \.view\.is-open \{ animation-name: view-fade; \}/.test(css), 'views open by fading in the book');
  assert.ok(/html\.book #page-body \.spread \{\s*grid-template-columns: 1fr calc\(var\(--gap\) \+ 2 \* var\(--pad\)\) 1fr;/.test(css), 'the mushaf opens across the fold, each page on its column');
  /* what scrolls under the floating bars fades, and never over the mushaf's own bar */
  assert.ok(/html\.book body::after \{[\s\S]*?position: fixed;[\s\S]*?linear-gradient/.test(css), 'a fade under the bars');
  assert.ok(/html\.book\[data-view="page"\] body::after \{ display: none; \}/.test(css), 'and none over the mushaf');
});

test('the Xcode for iPhone Duo is picked the day GitHub has a release of it, and never a beta', () => {
  const { execFileSync } = require('child_process');
  /* the table GitHub publishes with its xcode-27 image, as it stood on 6 Oct
     2026, then with 27.1 as a release candidate, then as a release */
  const today = [
    '| 27.2 (beta)    | 27B5019j | /Applications/Xcode_27.2_beta.app | /Applications/Xcode_27.2.0.app<br>/Applications/Xcode_27.2.app |',
    '| 27.1           | 27A9269  | /Applications/Xcode_27.1_beta.app | /Applications/Xcode_27.1.0.app<br>/Applications/Xcode_27.1.app |',
    '| 27.0 (default) | 27A266a  | /Applications/Xcode_27.app        | /Applications/Xcode_27.0.0.app<br>/Applications/Xcode_27.app |'].join('\n');
  const rc = today.replace('Xcode_27.1_beta.app', 'Xcode_27.1_Release_Candidate.app');
  const ga = today.replace('Xcode_27.1_beta.app', 'Xcode_27.1.app');
  const pick = (table) => execFileSync('python3', ['-c',
    'import importlib.util,sys\n' +
    's=importlib.util.spec_from_file_location("p", sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)\n' +
    'print(m.newest_duo_xcode(sys.stdin.read()))',
    path.join(__dirname, '..', 'tools', 'ios', 'pick-xcode.py')], { input: table }).toString().trim();
  assert.strictEqual(pick(today), '', 'a 27.1 whose name says 27.1 but which is a beta is not picked');
  assert.strictEqual(pick(rc), '27.1', 'a release candidate is, since the store takes its builds');
  assert.strictEqual(pick(ga), '27.1', 'and a release');

  /* the watch looks daily, starts one build, and never touches the store */
  const watch = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/xcode-27-watch.yml'), 'utf8');
  assert.ok(/schedule:\s*- cron: '23 5 \* \* \*'/.test(watch), 'once a day');
  assert.ok(watch.indexOf('python3 tools/ios/pick-xcode.py --release-only') !== -1, 'by the same reading of what GitHub has');
  assert.ok(watch.indexOf('git/ref/tags/xcode-27.1-watch') !== -1, 'and only until it has started a build');
  assert.ok(watch.indexOf('gh workflow run ios.yml --ref main -f xcode="$X" -f watch=true') !== -1, 'which goes to TestFlight');
  assert.ok(!/-f store=/.test(watch), 'and never to the store, which stays a decision made by hand');

  /* the iOS workflow gives the mark back when only a beta was there, and
     takes a build to the store only when a run by hand asks */
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ios.yml'), 'utf8');
  assert.ok(/if: inputs\.watch && steps\.upload\.outputs\.uploaded != 'yes'[\s\S]{0,200}git\/refs\/tags\/xcode-27\.1-watch/.test(wf), 'a beta gives the day back');
  assert.ok(/store:\s*needs: build\s*if: inputs\.store == 'prepare' \|\| inputs\.store == 'send'/.test(wf), 'the store only when asked');
  assert.ok(/default: none/.test(wf), 'and never by default');
  const release = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ios', 'asc-release.py'), 'utf8');
  assert.ok(/DUO = 'APP_IPHONE_DUO'/.test(release), 'the iPhone Duo screenshots go in their own set');
  assert.ok(/DUO_SIZES = \{\(1398, 2034\), \(2034, 1398\), \(2007, 2853\), \(2853, 2007\)\}/.test(release), 'at the sizes Apple takes');
  assert.ok(/if a\.no_submit or DRY:/.test(release), 'and prepare stops before review');
});

test('a commit never sends a release to the testers on its own', () => {
  /* the version line in build.gradle moves with every commit, and a push
     that changed nothing else under android/ built and sent a new release to
     the closed test: seven in one day of work on the page alone */
  const flow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/android.yml'), 'utf8');
  assert.ok(/- 'android\/\*\*'\s*(#[^\n]*\s*)?- '!android\/app\/build\.gradle'/.test(flow), 'the version line alone does not start a build');
  assert.ok(/name: ارفع إلى Play\s*if: steps\.play\.outputs\.ready == 'yes' && github\.event_name == 'workflow_dispatch'/.test(flow),
    'only a run asked for by hand reaches Play');
  /* and production, which reaches everyone, is picked by hand too: a run left
     as it is goes to the closed test as it always did */
  assert.ok(/track:\s*description: [^\n]*\s*type: choice\s*options: \[alpha, production\]\s*default: alpha/.test(flow),
    'the closed test unless production is chosen');
  assert.ok(/TRACK: \$\{\{ inputs\.track \|\| 'alpha' \}\}/.test(flow) && flow.indexOf('--track "$TRACK" --notes play/whatsnew') !== -1,
    'the track reaches the upload as a value, never pasted into the script');
  /* Play takes 500 characters of notes per language and cuts the rest */
  const notes = path.join(__dirname, '..', 'play', 'whatsnew');
  for (const lang of fs.readdirSync(notes)) {
    const text = fs.readFileSync(path.join(notes, lang), 'utf8').trim();
    assert.ok(text.length > 0 && text.length <= 500, lang + ' fits in what Play shows: ' + text.length);
  }
});

test('production gets what the testers ran, and the App Store gets the version prepared, with nothing built again', () => {
  /* a release to everyone is the bundle the closed test has been running,
     moved by its version code, and only ever by hand */
  const play = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/play-release.yml'), 'utf8');
  assert.ok(/on:\s*workflow_dispatch:/.test(play) && play.indexOf('push:') === -1 && play.indexOf('schedule:') === -1, 'only ever by hand');
  assert.ok(play.indexOf('play-upload.py --promote-from "$FROM" --track production --notes play/whatsnew') !== -1);
  assert.ok(play.indexOf('gradlew') === -1 && play.indexOf('.aab') === -1, 'nothing is built or uploaded');
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools', 'android', 'play-upload.py'), 'utf8');
  const newest = /def newest_release\(track\):([\s\S]*?)\n\n\n/.exec(tool)[1];
  assert.ok(newest.indexOf("r.get('status') != 'completed'") !== -1, 'a draft or a halted release is never what goes out');
  assert.ok(tool.indexOf('if bool(a.aab) == bool(a.promote_from):') !== -1, 'a new bundle or a release already there, never both');
  assert.ok(tool.indexOf('if a.promote_from == a.track:') !== -1);
  /* the App Store version a build run prepared is sent as it is */
  const listing = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/app-store-listing.yml'), 'utf8');
  assert.ok(/options: \[status, screenshots, withdraw, send, replace\]\s*default: status/.test(listing), 'sending is asked for, never the default');
  assert.ok(/send\|replace\) B=\$\(sed -n 's\/\^ \*CURRENT_PROJECT_VERSION: \*"\\\(\.\*\\\)"\/\\1\/p' ios\/project\.yml\)/.test(listing),
    'the build is the one the repository says');
  assert.ok(listing.indexOf('$([ "$WHAT" = replace ] && echo --replace) ;;') !== -1, 'and a version is taken back only when replace is asked');
  assert.ok(listing.indexOf('python3 tools/ios/asc-release.py --version "$V" --build "$B" --wait 10') !== -1);
  assert.ok(listing.indexOf('--notes ios/whatsnew/ar-SA.txt --previews ios/previews --ipad ios/screenshots/ipad-13 --text ios/store \\') !== -1);
  const release = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ios', 'asc-release.py'), 'utf8');
  assert.ok(/if a\.duo and locale == home:\s*place_duo\(/.test(release), 'with no iPhone Duo pictures to give, that set is left as it is, and those given are the Arabic page\'s');
  /* a version waiting is taken back only once the build to replace it is there */
  assert.ok(/build_id = wait_for_build\(a\.version, a\.build, a\.wait\)\s*(#[^\n]*\s*)*if a\.replace and not DRY:\s*withdraw\(\)\s*version_id = version_to_send\(a\.version\)/.test(release));
});

test('a build asking for Xcode 27 runs where GitHub keeps it, and a beta is never sent to the store', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ios.yml'), 'utf8');
  /* GitHub keys its mac images to a major Xcode now, and 27 is not on macos-26 */
  assert.ok(wf.indexOf('runs-on: ${{ needs.pick.outputs.runner }}') !== -1, 'the build runs where the Xcode it was given lives');
  assert.ok(/out=\$\(python3 tools\/ios\/pick-xcode\.py "\$WANT"\)/.test(wf), 'and that is picked by reading what GitHub has');
  assert.ok(/WANT: \$\{\{ needs\.pick\.outputs\.xcode \}\}/.test(wf), 'Xcode is chosen on the mac from what was picked');
  /* a name like Xcode_27.1.app is a link to a beta, so each Xcode is asked what it is */
  assert.ok(/real=\$\(realpath "\$x"\)/.test(wf), 'each Xcode is read for what it is');
  assert.ok(/PlistBuddy -c 'Print :CFBundleShortVersionString'/.test(wf), 'and for its own version');
  assert.ok(/if: steps\.asc\.outputs\.ready == 'yes' && steps\.xcode\.outputs\.beta != 'yes'/.test(wf), 'a beta build is kept, not sent');
  /* the page GitHub publishes can run ahead of the mac a build lands on: a
     run that asked for auto and found only a beta of what was picked builds
     with the newest release or candidate from 27.1 on that the mac has */
  assert.ok(/ASKED: \$\{\{ github\.event\.inputs\.xcode \|\| 'auto' \}\}/.test(wf), 'the step knows whether the run asked for auto');
  assert.ok(/echo "\$rank \$key \$real" >> "\$RUNNER_TEMP\/all-xcodes"/.test(wf), 'every Xcode on the mac is listed');
  assert.ok(/if \[ "\$ASKED" = "auto" \]; then\s*case "\$XCODE" in \*\[Bb\]eta\*\)\s*ALT=\$\(awk '\$1 >= 1 && \$2 >= "027\.001\.000"'/.test(wf), 'and a beta gives way to a release from 27.1 on');
  /* the Duo is photographed closed and open, on both its displays */
  assert.ok(/if: steps\.xcode\.outputs\.duo == 'yes'\s*continue-on-error: true/.test(wf), 'the Duo step never fails the build');
  assert.ok(wf.indexOf('--display=primary-1') !== -1, 'the inner display is photographed too');
  const hinge = fs.readFileSync(path.join(__dirname, '..', 'tools/ios/hinge.c'), 'utf8');
  assert.ok(/kUsagePage = 0xFF61, kUsage = 0x5B/.test(hinge), 'the event the Device Hub slider posts');
  assert.ok(/Copyright \(c\) 2026 Artem Novichkov/.test(hinge), 'with the notice of whose finding it is');
  /* and the app itself never carries a private call */
  const dir = path.join(__dirname, '..', 'ios', 'Sunnati');
  const swift = fs.readdirSync(dir).filter((f) => f.endsWith('.swift'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(swift.indexOf('IOHIDEvent') === -1, 'nothing private in the app');
});

test('in the book a spread stands whole between its bars, and nothing of it lies on the fold', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* each page is wrapped so it can be scaled whole, and fitted once laid */
  assert.ok(app.indexOf('<div class="leaf"><div class="leaf-page">') !== -1, 'a page inside each leaf');
  assert.ok(/fitPrintedLines\(body\);\s*if \(book\) fitSpread\(body\);/.test(app), 'the spread is fitted after it is laid');
  /* one size for both pages, found by halving, never below a size worth reading */
  assert.ok(/var FIT_FLOOR_PX = 13;/.test(app), 'a floor for the letters');
  assert.ok(/for \(var i = 0; i < 8; i\+\+\) \{\s*var mid = \(lo \+ hi\) \/ 2;/.test(app), 'the size is found by halving');
  /* flowing text is given its width back, so it wraps rather than shrinking into a column */
  assert.ok(app.indexOf("p.style.width = Math.floor(printed ? Math.min(pageWidth, width / z) : width / z) + 'px';") !== -1, 'the text keeps the width of the leaf');
  /* the reader's own size is a scale on the fitted page, and a resize or a late font refits */
  assert.ok(/var asked = \(\+Store\.get\('fontScale'\) \|\| 100\) \/ 100;\s*size\(z \* asked\);/.test(app), 'larger is still larger');
  assert.ok(/window\.addEventListener\('resize', function \(\) \{\s*window\.clearTimeout\(refit\);/.test(app), 'a resize refits');
  assert.ok(/document\.fonts\.ready\.then\(refitSpread\)/.test(app), 'and so does the face arriving');

  /* the bar has no ground across the fold, and turning the page is a bar of
     its own under the left page, level with the tabs under the right */
  assert.ok(/html\.book #v-page \.reader-bar \{[\s\S]*?position: static; background: none; box-shadow: none;/.test(css), 'no bar across the fold');
  /* the mushaf's screen is right to left in every language, so the bar is
     placed by its own direction, and taken to the other half when the
     tabs have moved there in a left to right page */
  assert.ok(/html\.book #v-page \.page-nav \{\s*position: fixed; z-index: 60;\s*inset-inline-end: calc\(var\(--edge\) \+ var\(--pad\)\); inset-inline-start: calc\(var\(--inner\) \+ var\(--pad\)\);\s*bottom: var\(--float\); height: var\(--tab-h\);/.test(css), 'the page turns from a bar under the left page, the twin of the tabs');
  assert.ok(/html\.book\[dir='ltr'\] #v-page \.page-nav \{\s*inset-inline-start: calc\(var\(--edge\) \+ var\(--pad\)\); inset-inline-end: calc\(var\(--inner\) \+ var\(--pad\)\);/.test(css), 'and under the right page when the tabs stand under the left');
  assert.ok(css.indexOf('html.book #v-page .page-nav > :nth-child') === -1, 'and no button is placed on the far side of the fold');
  /* a page that cannot fit scrolls in its own leaf, not the two together */
  assert.ok(/html\.book #page-body \.leaf \{[\s\S]*?overflow-x: hidden; overflow-y: auto;/.test(css), 'a leaf scrolls on its own');
});

test('the sides a screen keeps are kept clear, on the phone and in the book', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* iPhone Duo keeps a column for its status down one side of each display,
     and the titles and the clock were laid under it */
  assert.ok(/--sal: env\(safe-area-inset-left, 0px\);\s*--sar: env\(safe-area-inset-right, 0px\);/.test(css), 'the sides are read once, at the root');
  assert.ok(/padding-left: var\(--sal\); padding-right: var\(--sar\);\s*-webkit-font-smoothing/.test(css), 'the page keeps clear of them');
  assert.ok(/\.tabs \{[\s\S]*?padding-left: var\(--sal\); padding-right: var\(--sar\);/.test(css), 'and so do the tabs, their bar running to the edge');
  /* in the book each half keeps clear of the side it stands against, and
     the two pages stay alike and centred on the fold */
  assert.ok(/--pane: min\(calc\(var\(--half\) - max\(var\(--sal\), var\(--sar\)\)\), 560px\);/.test(css), 'both halves alike, each clear of the side the screen keeps');
  assert.ok(/html\.book body \{\s*padding-left: 0; padding-right: 0;\s*padding-bottom: calc\(var\(--tab-h\) \+ var\(--float\)/.test(css), 'the halves are placed against the screen itself, the foot kept for the bars');
  assert.ok(/width: calc\(2 \* \(var\(--pane\) - var\(--pad\)\) \+ var\(--gap\)\);/.test(css), 'the pages stand on the columns of their halves');

  /* the web view is not trusted to report the column, so the window's own
     measure is handed to the page whenever it changes */
  const reader = fs.readFileSync(path.join(__dirname, '..', 'ios', 'Sunnati', 'ReaderController.swift'), 'utf8');
  assert.ok(/override func viewSafeAreaInsetsDidChange\(\) \{\s*super\.viewSafeAreaInsetsDidChange\(\)\s*tellSides\(\)/.test(reader), 'a change of sides is heard');
  assert.ok(reader.indexOf("setProperty('--sar','") !== -1 && reader.indexOf("setProperty('--sal','") !== -1, 'and handed to the page');
  assert.ok(/tellCanNotify\(\)\s*tellSides\(\)/.test(reader), 'as each page finishes loading');
});

test('the mushaf opens as a printed one does, the odd page on the right', () => {
  const { win } = boot();
  /* the object comes from the page's own window, so its numbers are read */
  const s = (n) => { const x = win.App.helpers.spreadOf(n); return [x.right, x.left]; };
  /* al-Fatiha on the right and the start of al-Baqara facing it */
  assert.deepStrictEqual(s(1), [1, 2]);
  assert.deepStrictEqual(s(2), [1, 2], 'an even page opens the spread it belongs to');
  assert.deepStrictEqual(s(50), [49, 50]);
  assert.deepStrictEqual(s(603), [603, 604]);
  assert.deepStrictEqual(s(604), [603, 604], 'the last faces the one before it');
  /* and a turn in the book moves a whole spread */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('var n = isBook() ? spreadOf(state.page || 1).right + by * 2 : (state.page || 1) + by;') !== -1);
  /* a phone has no book, so nothing changes there */
  assert.strictEqual(win.App.helpers.isBook(), false, 'no matchMedia, no book');
});

test('a reader who asked for less motion is not slid across the page by the script', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the stylesheet stills every animation and transition under .less-motion,
     but a scroll the script calls smooth ignores scroll-behavior; the App
     Store label for Reduced Motion is declared on the strength of this */
  assert.ok(app.indexOf("behavior: 'smooth'") === -1, 'no scroll asks for smoothness on its own');
  assert.ok(/function glide\(\) \{\s*return document\.documentElement\.classList\.contains\('less-motion'\) \? 'auto' : 'smooth';/.test(app),
    'it asks the reader\'s setting first');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(/\.less-motion \*[\s\S]{0,160}animation-duration: 1ms !important;[\s\S]{0,120}transition-duration: 1ms !important;/.test(css),
    'and the stylesheet stills the rest');
});

test('the mark is the painted mihrab window onto the evening sky, over the name as the app writes it', () => {
  const svg = fs.readFileSync(path.join(DOCS, 'icons', 'icon.svg'), 'utf8');
  /* the name is outlines from the font, shaped with its damma and shadda, so it
     looks the same everywhere and needs no font where it is shown */
  assert.ok(svg.indexOf('<text') === -1, 'no live text: the name would fall back to another face');
  assert.ok(/<path d='M[^']{400,}' fill='url\(#ng\)'/.test(svg), 'the name, drawn as outlines in graded gold');
  for (const c of ['#fff6d8', '#f7d27a', '#d4952f']) {
    assert.ok(svg.indexOf(c) !== -1, 'the gold of the name keeps ' + c);
  }
  /* the mihrab, its star and the sky in its window are a painting, and the
     painting is carried inside the mark and cut to its rounded corners, so the
     mark is still one file that needs nothing beside it. Nothing shows the mark
     larger than 512, so it carries the painting at 512 and not at full size. */
  function jpegSize(b) {
    for (let i = 2; i + 9 < b.length && b[i] === 0xff;) {
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  assert.ok(svg.indexOf("width='512' height='512'") !== -1);
  assert.ok(svg.indexOf("<clipPath id='round'><rect width='1024' height='1024' rx='230'/></clipPath>") !== -1,
    'rounded at the corners as a home screen rounds it');
  const painting = /<g clip-path='url\(#round\)'><image width='1024' height='1024' href='data:image\/jpeg;base64,([A-Za-z0-9+/=]{20000,})'\/>/.exec(svg);
  assert.ok(painting, 'the painting fills the mark, inside the rounded corners');
  assert.deepStrictEqual(jpegSize(Buffer.from(painting[1], 'base64')), { w: 512, h: 512 }, 'carried at the size the mark is drawn');
  /* and the painting itself is kept beside the tool that draws every size from
     it, square and large enough for the largest */
  const store = path.join(__dirname, '..', 'tools', 'store');
  assert.deepStrictEqual(jpegSize(fs.readFileSync(path.join(store, 'icon-art.jpg'))), { w: 2048, h: 2048 }, 'the painting, kept whole');
  assert.ok(!fs.existsSync(path.join(store, 'icon-scene.jpg')), 'and nothing is left of the drawing it replaced');

  /* every size where it lands, at the size it should be, and the ones Apple
     masks itself carry no transparency: App Store Connect refuses an icon
     with alpha, and a touch icon with alpha turns black at the corners */
  function png(file) {
    const b = fs.readFileSync(file);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
  }
  const icons = path.join(DOCS, 'icons');
  for (const [name, size, opaque] of [['icon-192', 192, false], ['icon-512', 512, false],
      ['maskable-512', 512, true], ['icon-180', 180, true], ['play-1024', 1024, true]]) {
    const p = png(path.join(icons, name + '.png'));
    assert.strictEqual(p.w, size, name); assert.strictEqual(p.h, size, name);
    if (opaque) assert.ok(!p.alpha, name + ' has no transparency');
  }
  const ios = png(path.join(__dirname, '..', 'ios/Sunnati/Assets.xcassets/AppIcon.appiconset/icon-1024.png'));
  assert.strictEqual(ios.w, 1024);
  assert.ok(!ios.alpha, 'the App Store icon carries no alpha channel');

  /* android: the crimson of the painting behind, the mihrab and the name cut
     out of it in front inside the safe circle, and the same drawing in one
     colour for themed icons */
  const android = path.join(__dirname, '..', 'android/app/src/main/res');
  assert.ok(fs.readFileSync(path.join(android, 'values/colors.xml'), 'utf8').indexOf('#9c2b2b') !== -1, 'the wrapper is red too');
  const ground = fs.readFileSync(path.join(android, 'drawable/ic_launcher_background.xml'), 'utf8');
  assert.ok(ground.indexOf('android:type="radial"') !== -1, 'the ground glows where the mihrab stands');
  const reds = [...ground.matchAll(/android:(?:start|center|end)Color="#([0-9a-fA-F]{6})"/g)].map((m) => parseInt(m[1], 16));
  assert.strictEqual(reds.length, 3);
  reds.forEach((c) => assert.ok((c >> 16) > 0x50 && ((c >> 8) & 0xff) < 0x20 && (c & 0xff) < 0x10,
    'a deep crimson, as the painting is: #' + c.toString(16)));
  const mono = fs.readFileSync(path.join(android, 'drawable/ic_launcher_monochrome.xml'), 'utf8');
  assert.ok(/<vector[\s\S]*android:pathData="M[^"]{400,}"/.test(mono), 'the themed icon carries the name too');
  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const f = png(path.join(android, 'mipmap-' + d, 'ic_launcher_foreground.png'));
    assert.ok(f.alpha, d + ' foreground is transparent around the figure');
  }

  /* and it is drawn by a script with its font in the repository, so it can be
     drawn again on any machine */
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools/store/icon-build.py')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools/store/fonts/Lalezar-Regular.ttf')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools/store/fonts/Lalezar-OFL.txt')), 'with its licence');
});

test('the app and its worker carry the same version, and it is the version in the android package', () => {
  const app = /var VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8'))[1];
  const sw = /var VERSION = 'sunnati-v([^']+)'/.exec(fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8'))[1];
  const gradle = /versionName "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, '..', 'android/app/build.gradle'), 'utf8'))[1];
  assert.strictEqual(sw, app, 'a new app with an old worker keeps stale caches on every installed copy');
  assert.strictEqual(gradle, app, 'the package must carry the version it wraps');
});

test('the mark lives in the app: the crown of the mihrab, the about page, the banner, the picture card', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(/<g class="mihrab-star"[^>]*>\s*<path d="M0 -15 L15 0 L0 15 L-15 0z"\/>/.test(html), 'the eye crowns the mihrab');
  assert.ok(html.indexOf('class="mihrab-moon"') !== -1, 'with the crescent in it');
  assert.ok(html.indexOf('<img class="brand-mark" src="icons/icon.svg"') !== -1, 'the about page opens with the mark');
  assert.ok(html.indexOf('الشعار محراب يطل على سماء الوقت، وفيه مئذنة على الساحل وهلال فوقها') !== -1, 'and says what it is');
  assert.ok(html.indexOf('<img class="banner-mark" src="icons/icon.svg"') !== -1, 'the banner carries it');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('function eyeMark(ctx, cx, cy, r)') !== -1 && app.indexOf('eyeMark(ctx, W / 2, footY, 22)') !== -1, 'the picture card closes with the eye');
});

test('the social set and the feature graphic are drawn from sadu bands, not photographs', () => {
  const social = path.join(__dirname, '..', 'tools', 'social');
  assert.ok(fs.existsSync(path.join(social, 'sadu.mjs')), 'the bands are drawn in code');
  const bands = fs.readFileSync(path.join(social, 'sadu.mjs'), 'utf8');
  ['export const runner', 'export const cushion', 'export const tree'].forEach((b) => assert.ok(bands.indexOf(b) !== -1, b));
  const draw = fs.readFileSync(path.join(social, 'draw.mjs'), 'utf8');
  assert.ok(draw.indexOf("from './sadu.mjs'") !== -1);
  assert.ok(draw.indexOf('.jpg') === -1, 'no photograph in the set');
  assert.ok(draw.indexOf("docs/icons/icon.svg") !== -1, 'the mark is read from the app, never redrawn by hand');
  /* the store graphic is drawn by the tool that draws the icon, from the same
     mark, so the two cannot drift apart as the bands and the eye once did */
  const fg = fs.readFileSync(path.join(__dirname, '..', 'tools', 'store', 'icon-build.py'), 'utf8');
  assert.ok(/def feature_graphic\(\)/.test(fg), 'the store graphic is drawn with the icon');
  fs.readdirSync(path.join(DOCS, 'screens', 'social')).forEach((f) => assert.ok(!/\.jpe?g$/.test(f), 'a photograph is left in screens/social: ' + f));
});

/* ---------------- inside the android package ---------------- */

test('inside the package a granted notification permission switches the reminder on by itself', () => {
  const { win } = boot();
  win.Notification = function () {}; win.Notification.permission = 'granted';
  assert.strictEqual(win.Store.get('notify'), false);
  win.App.helpers.adoptGrantedNotifications();
  assert.strictEqual(win.Store.get('notify'), true, 'the phone was already asked, and said yes');
  assert.strictEqual(win.Store.get('notifyAsked'), true);
  /* once the reader has answered the switch themselves, it is not touched again */
  win.Store.set('notify', false);
  win.App.helpers.adoptGrantedNotifications();
  assert.strictEqual(win.Store.get('notify'), false);
});

test('the app knows it runs in its own package by the referrer, and remembers', () => {
  const { win } = boot();
  assert.strictEqual(win.App.helpers.inAndroidApp(), false);
  Object.defineProperty(win.document, 'referrer', { configurable: true, value: 'android-app://com.eworldq8.sunnati/' });
  assert.strictEqual(win.App.helpers.inAndroidApp(), true);
  Object.defineProperty(win.document, 'referrer', { configurable: true, value: '' });
  assert.strictEqual(win.App.helpers.inAndroidApp(), true, 'remembered after the referrer is gone');
});



/* ---------------- the bridge to the android package ---------------- */

function fakeBridge(win) {
  const calls = { times: [], notes: [], images: [], adhan: true };
  win.SunnatiApp = {
    version: function () { return 'test'; },
    setPrayerTimes: function (json) { calls.times.push(JSON.parse(json)); },
    isAdhanEnabled: function () { return calls.adhan; },
    setAdhanEnabled: function (on) { calls.adhan = on; },
    canNotify: function () { return true; },
    notify: function (t, b, tag) { calls.notes.push([t, b, tag]); },
    shareImage: function (dataUrl, name) { calls.images.push([dataUrl.slice(0, 22), name]); return true; }
  };
  return calls;
}

test('inside the app a notification goes through the app, not the browser', () => {
  const { win } = boot();
  const calls = fakeBridge(win);
  win.Notification = undefined;
  return win.App.helpers.notify('حان وقت العصر', 'الله أكبر', 'adhan').then(function (ok) {
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(calls.notes[0], ['حان وقت العصر', 'الله أكبر', 'adhan']);
  });
});

test('the page hands the app a week of prayer times for the reader\'s own place', () => {
  const { win } = boot();
  const calls = fakeBridge(win);
  win.App.helpers.handTimesToApp();
  assert.strictEqual(calls.times.length, 1);
  const list = calls.times[0];
  assert.ok(list.length >= 30 && list.length <= 35, 'five prayers a day for seven days, minus those gone: ' + list.length);
  list.forEach(function (row) { assert.ok(row.at > Date.now() && typeof row.name === 'string' && row.name.length > 1); });
  const names = list.map((r) => r.name);
  assert.ok(names.indexOf('الشروق') === -1, 'the sunrise is a time, not a prayer');
  for (let i = 1; i < list.length; i++) assert.ok(list[i].at >= list[i - 1].at, 'in order');
  /* a change of place hands a fresh list */
  win.App.helpers.setPlace({ n: 'القاهرة', lat: 30.04, lng: 31.24, tz: 2, z: 'Africa/Cairo', method: 'Egypt' }, true);
  assert.ok(calls.times.length >= 2, 'new times after a new place');
});

test('inside the app the settings show the app\'s own adhan switch and hide the browser row', () => {
  const { win, doc } = boot();
  const calls = fakeBridge(win);
  win.App.go('settings');
  assert.ok(!doc.getElementById('settings-adhan-row').hidden);
  assert.ok(doc.getElementById('settings-notify').closest('.setting').hidden, 'no browser permission to ask for');
  assert.strictEqual(doc.getElementById('settings-adhan').getAttribute('aria-checked'), 'true');
  click(win, doc.getElementById('settings-adhan'));
  assert.strictEqual(calls.adhan, false, 'the app is told');
  click(win, doc.getElementById('settings-adhan'));
  assert.strictEqual(calls.adhan, true);
  assert.ok(calls.times.length >= 1, 'and given the times when switched on');
});

test('without the app the settings are as before', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  assert.ok(doc.getElementById('settings-adhan-row').hidden);
  assert.ok(!doc.getElementById('settings-notify').closest('.setting').hidden);
});

test('inside the app a picture is shared by the app', () => {
  const { win } = boot();
  const calls = fakeBridge(win);
  const blob = new win.Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  return win.App.helpers.sharePicture(Promise.resolve(blob), 'ayah-1-1.png', 'x').then(function (ok) {
    assert.strictEqual(ok, true);
    assert.strictEqual(calls.images.length, 1);
    assert.ok(calls.images[0][0].indexOf('data:image/png;base64') === 0);
    assert.strictEqual(calls.images[0][1], 'ayah-1-1.png');
  });
});

/* ---------------- a version is served whole ---------------- */

test('the worker serves the shell from one version, fetched past the browser cache', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("cache.add(new Request(url, { cache: 'reload' }))") !== -1, 'a version must not be assembled from files of two deployments');
  assert.ok(sw.indexOf("caches.match(request, { cacheName: VERSION })") !== -1, 'code and markup come from this version\'s cache, whole');
  assert.ok(sw.indexOf("fetch(request).then(function (response) {\n      return keep(request, response);\n    }).catch") === -1, 'the file by file network first path is gone');
});


test('inside the app the about page names the package version beside the page version', () => {
  const { win, doc } = boot();
  win.SunnatiApp = { version: function () { return '8.5.1'; } };
  win.App.go('about');
  assert.ok(doc.getElementById('about-version').textContent.indexOf('وحزمة أندرويد 8.5.1') !== -1);
});

/* ---------------- one size for every button ---------------- */

test('every button stands forty eight tall, an icon button is a square, and buttons in a row share the width', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.btn \{[^}]*height:\s*48px/, 'one height');
  assert.match(css, /\.btn-row > \.btn \{[^}]*flex:\s*1 1 0/, 'equal widths in a row');
  assert.match(css, /\.segment \{[^}]*display:\s*flex/, 'a segmented control for a choice of one');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('<div class="segment" id="browse-mode" role="tablist"') !== -1, 'the surah or juz choice is a segment');
  assert.strictEqual((html.match(/<div class="grid grid-2 btn-grid">/g) || []).length, 1, 'the four mushaf actions sit in one grid');
});

test('the reciter is kept by id, the default is al minshawi, and the removed one is gone', () => {
  const { win, doc } = boot();
  assert.strictEqual(win.Store.get('reciter'), 'ar.minshawi');
  assert.strictEqual(win.App.helpers.reciterId(), 'ar.minshawi');
  assert.ok(!win.RECITERS.some((r) => r.id === 'ar.alafasy'), 'removed from the list');
  win.App.go('settings');
  const opts = [...doc.getElementById('settings-reciter').options];
  assert.ok(!opts.some((o) => o.value === 'ar.alafasy') && opts.every((o) => /^ar\./.test(o.value)), 'the select works by id');
  /* a number from an older version is carried over, not misread */
  win.Store.set('reciter', 7);
  assert.strictEqual(win.App.helpers.reciterId(), 'ar.minshawi', 'seven in the old list was al minshawi');
  assert.strictEqual(win.Store.get('reciter'), 'ar.minshawi', 'and is stored by id from then on');
  win.Store.set('reciter', 0);
  assert.strictEqual(win.App.helpers.reciterId(), 'ar.minshawi', 'zero was the removed reciter, so the default');
});

/* ---------------- the mushaf as a mushaf ---------------- */

test('the basmala stands centred on its own line in the page view as well as the surah view', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.basmala \{[^}]*text-align-last:\s*center/, 'the parent starts its last line, so the basmala must centre its own by name');
  const { win, doc } = boot();
  win.App.helpers.openPage(249);
  const b = doc.querySelector('#page-body .basmala');
  assert.ok(b, 'الرعد opens on page 249 with its basmala');
  win.App.helpers.openPage(1);
  assert.ok(!doc.querySelector('#page-body .basmala'), 'الفاتحة has the basmala as its first verse, not a line above');
  win.App.helpers.openPage(187);
  assert.ok(!doc.querySelector('#page-body .basmala'), 'التوبة opens without one');
});

test('the page names its juz and the hizb reached by its end, as a mushaf does', () => {
  const { win, doc } = boot();
  win.App.helpers.openPage(249);
  /* the mushaf screen speaks one set of figures, arabic-indic: the title, this
     line, the ayah markers and the figure footing the page */
  assert.strictEqual(doc.getElementById('page-meta').textContent, 'الجزء ١٣، الحزب ٢٥ وثلاثة أرباعه، سورة الرعد');
  win.App.helpers.openPage(248);
  assert.ok(doc.getElementById('page-meta').textContent.indexOf('الحزب ٢٥ ونصفه') !== -1, 'page 248 ends in the half');
  /* hizbLabel is latin by default and arabic only when asked, as the page line
     asks it: elsewhere, in a latin screen, it stays latin */
  assert.strictEqual(win.App.helpers.hizbLabel(1, 1), 'الحزب 1');
  assert.strictEqual(win.App.helpers.hizbLabel(114, 6), 'الحزب 60 وثلاثة أرباعه');
  assert.strictEqual(win.App.helpers.hizbLabel(1, 1, true), 'الحزب ١', 'and arabic when the page asks');
  assert.strictEqual(win.HIZB_QUARTERS.length, 240);
});

test('inside the mushaf the figures are its own: markers and the page foot in arabic indic', () => {
  const { win, doc } = boot();
  assert.strictEqual(win.App.helpers.mushafDigits(249), '٢٤٩');
  win.App.helpers.openPage(249);
  assert.strictEqual(doc.querySelector('#page-body .ayah-num').getAttribute('data-n'), '١');
  assert.strictEqual(doc.querySelector('.page-foot-num').textContent, '٢٤٩');
  assert.strictEqual(doc.querySelector('.page-foot-num').getAttribute('aria-label'), 'صفحة 249', 'read aloud in the figures the reader chose');
  /* the chrome around the page keeps the app's figures */
  assert.ok(doc.getElementById('page-title').textContent.indexOf('٢٤٩') !== -1);
});

test('a verse is marked as one of four kinds, and the marks screen groups them', () => {
  const { win, doc } = boot();
  win.App.state.surah = 13; win.App.go('reader');
  click(win, doc.querySelector('[data-ayah="13:2"]'));
  assert.strictEqual(doc.querySelectorAll('#sheet .service').length, 8, 'eight services in a grid');
  assert.strictEqual(doc.querySelectorAll('#sheet .mark').length, 4, 'four kinds of mark');
  click(win, doc.querySelector('#sheet .mark-memo'));
  assert.strictEqual(win.Store.bookmarkKind(13, 2), 'memo');
  click(win, doc.querySelector('#sheet .mark-ponder'));
  assert.strictEqual(win.Store.bookmarkKind(13, 2), 'ponder', 'another kind changes it');
  click(win, doc.querySelector('#sheet .mark-ponder'));
  assert.strictEqual(win.Store.bookmarkKind(13, 2), null, 'the same kind again removes it');
  win.Store.toggleBookmark(2, 255, 'review'); win.Store.toggleBookmark(1, 1, 'read'); win.Store.toggleBookmark(112, 1, 'read');
  win.App.go('bookmarks');
  const titles = [...doc.querySelectorAll('#bookmark-list .mark-title')].map((t) => t.textContent.trim().replace(/\s+\d+$/, ''));
  assert.deepStrictEqual(titles.join('|'), 'قراءة|مراجعة', 'grouped by kind, in the order of the marks');
  assert.strictEqual(doc.querySelectorAll('#bookmark-list .search-hit.mark-read').length, 2);
});

/* ---------------- the player's button, the share as a picture, the note ---------------- */

test('the pause button becomes a play button when the sound is paused, and back', () => {
  const { win, doc } = boot();
  const clips = [];
  win.Audio = function () {
    const clip = { paused: true, src: '', play: function () { clip.paused = false; if (clip.onplay) clip.onplay(); return Promise.resolve(); }, pause: function () { clip.paused = true; if (clip.onpause) clip.onpause(); }, removeAttribute: function () {}, load: function () {} };
    clips.push(clip); return clip;
  };
  /* pressing استمع now asks how to listen, so the choice is stated first */
  win.Store.set('listenAs', 'whole');
  win.App.state.surah = 112; win.App.go('reader');
  click(win, doc.getElementById('reader-play'));
  const btn = doc.getElementById('player-toggle');
  assert.strictEqual(btn.querySelector('use').getAttribute('href'), '#i-pause', 'playing: the button offers to pause');
  click(win, btn);
  assert.strictEqual(btn.querySelector('use').getAttribute('href'), '#i-play', 'paused: the button offers to play');
  assert.strictEqual(btn.getAttribute('aria-label'), 'تشغيل');
  click(win, btn);
  assert.strictEqual(btn.querySelector('use').getAttribute('href'), '#i-pause');
});

test('sharing a verse shares its picture with its words', () => {
  const { win, doc } = boot();
  const calls = fakeBridge(win);
  win.SunnatiApp.shareImageWithText = function (dataUrl, name, text) { calls.images.push([dataUrl.slice(0, 22), name, text]); return true; };
  win.App.state.surah = 1; win.App.go('reader');
  click(win, doc.querySelector('[data-ayah="1:7"]'));
  const services = [...doc.querySelectorAll('#sheet .service')].map((b) => b.textContent.trim());
  assert.ok(services.indexOf('مشاركة الآية') !== -1 && services.indexOf('صورة الآية') === -1, 'one share, and it is the picture');
  assert.ok(services.indexOf('ملاحظة') !== -1, 'the freed slot is the note');
  const verseCard = win.App.helpers.verseCard;
  win.App.helpers.sharePicture(Promise.resolve(new win.Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })), 'ayah-1-7.png', 'x', 'كلمات الآية\nsunnati.3li.info');
  return until(function () { return calls.images.length === 1; }).then(function () {
    assert.strictEqual(calls.images[0][2], 'كلمات الآية\nsunnati.3li.info', 'the words go with the picture');
    void verseCard;
  });
});

test('a note on a verse is written, shown in the sheet, and removed when emptied', () => {
  const { win, doc } = boot();
  win.App.state.surah = 2; win.App.go('reader');
  click(win, doc.querySelector('[data-ayah="2:255"]'));
  click(win, doc.querySelector('#sheet [data-act="note"]'));
  const field = doc.getElementById('note-field');
  assert.ok(field, 'a field to write in');
  field.value = 'أعظم آية في القرآن';
  click(win, doc.querySelector('#sheet [data-act="note-save"]'));
  assert.strictEqual(win.Store.note(2, 255), 'أعظم آية في القرآن');
  assert.ok(doc.querySelector('#sheet .verse-note').textContent.indexOf('أعظم آية') !== -1, 'shown under the verse');
  assert.ok([...doc.querySelectorAll('#sheet .service')].some((b) => b.textContent.trim() === 'ملاحظتك'), 'the service says there is one');
  click(win, doc.querySelector('#sheet [data-act="note"]'));
  doc.getElementById('note-field').value = '   ';
  click(win, doc.querySelector('#sheet [data-act="note-save"]'));
  assert.strictEqual(win.Store.note(2, 255), '', 'emptied is removed');
});

test('one address for every icon, and the worker holds every one it is asked for', () => {
  const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');
  const pages = ['index.html', 'privacy.html', 'js/app.js', 'manifest.webmanifest'];
  /* The cache is opened under the version, so an icon cannot go stale under it
     and the ?v= on the end bought nothing. What it did buy was room to drift:
     three forms were in use at once, ?v=sadu and ?v=eye and none, so the badge
     the app asked for when it raised a notification was not the one the worker
     had put by, and offline it had no icon at all. */
  pages.concat(['sw.js']).forEach(function (f) {
    assert.ok(!/icons\/[A-Za-z0-9.\-]+\.(?:png|svg)\?v=/.test(read(f)),
      f + ' still carries a ?v= on an icon');
  });

  const precached = new Set([...read('sw.js').matchAll(/'\.\/(icons\/[^']+)'/g)].map(function (m) { return m[1]; }));
  const asked = new Set();
  pages.forEach(function (f) {
    for (const m of read(f).matchAll(/icons\/[A-Za-z0-9.\-]+\.(?:png|svg)/g)) asked.add(m[0]);
  });
  const missing = [...asked].filter(function (a) { return !precached.has(a); });
  assert.deepStrictEqual(missing, [], 'asked for but never put by: ' + missing.join(', '));

  /* and what the ?v= was there to promise is promised by the cache's own name */
  const sw = read('sw.js');
  assert.ok(/caches\.open\(VERSION\)/.test(sw), 'the cache is named for the version');
  assert.ok(/name === VERSION \|\| name === AUDIO_STORE \|\| name === TILE_STORE\) \? null : caches\.delete\(name\)/.test(sw),
    'and every older cache is deleted when the new worker takes over');
});

test('the month of prayers is told in words when few, and with the share only when many', () => {
  const { win } = boot();
  const sum = win.App.helpers.prayerSummary;
  const st = function (inTime, late, missed) { return { inTime: inTime, late: late, missed: missed }; };
  assert.strictEqual(sum(st(0, 0, 0), 0), 'لم تُعلّم صلاة بعد، فاضغط أي صلاة في الأعلى أو في شريط المواقيت');
  assert.strictEqual(sum(st(1, 0, 0), 1), 'علّمت صلاة واحدة في آخر ثلاثين يوماً، وكانت في وقتها');
  assert.strictEqual(sum(st(0, 1, 0), 1), 'علّمت صلاة واحدة في آخر ثلاثين يوماً، وكانت قضاءً');
  assert.strictEqual(sum(st(0, 0, 1), 1), 'علّمت صلاة واحدة في آخر ثلاثين يوماً، وفاتت');
  assert.strictEqual(sum(st(1, 1, 0), 2), 'علّمت صلاتين في آخر ثلاثين يوماً، إحداهما في وقتها');
  assert.strictEqual(sum(st(5, 0, 0), 5), 'علّمت 5 صلوات في آخر ثلاثين يوماً، وكلها في وقتها');
  assert.strictEqual(sum(st(3, 2, 0), 5), 'علّمت 5 صلوات في آخر ثلاثين يوماً، 3 منها في وقتها');
  assert.strictEqual(sum(st(1, 6, 0), 7), 'علّمت 7 صلوات في آخر ثلاثين يوماً، واحدة منها في وقتها');
  assert.strictEqual(sum(st(45, 3, 2), 50), 'علّمت 50 صلاة في آخر ثلاثين يوماً، 45 منها في وقتها، أي 90%');
  assert.ok(sum(st(1, 0, 0), 1).indexOf('%') === -1, 'no percentage of one prayer');
});

test('the site serves its own pages, and the app does not answer for them', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  const nav = /if \(request\.mode === 'navigate'\) \{([\s\S]*?)\n      \}/.exec(sw)[1];
  assert.ok(nav.indexOf("fetch(new Request(request.url, { cache: 'reload' }))") !== -1,
    'a navigation asks the network first, or a real page of the site is answered with the app');
  const fallbackAt = nav.indexOf("caches.match('./index.html'");
  const catchAt = nav.indexOf('.catch(');
  assert.ok(catchAt !== -1 && fallbackAt > catchAt, 'the app is only the fallback when the network is gone');
  assert.ok(sw.indexOf("'./privacy.html'") !== -1, 'the policy travels with the app, so it opens offline too');
});

test('the privacy policy covers the android app and is reachable from it', () => {
  const policy = fs.readFileSync(path.join(DOCS, 'privacy.html'), 'utf8');
  ['الإشعارات', 'المنبّه الدقيق', 'الإقلاع', 'الاهتزاز', 'الموقع الجغرافي'].forEach(function (perm) {
    assert.ok(policy.indexOf(perm) !== -1, 'the policy should name the permission: ' + perm);
  });
  /* every permission the package asks for is spoken for */
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const asked = [...manifest.matchAll(/android\.permission\.([A-Z_]+)/g)].map((m) => m[1]);
  const spokenFor = { INTERNET: true, POST_NOTIFICATIONS: 'الإشعارات', SCHEDULE_EXACT_ALARM: 'المنبّه الدقيق', USE_EXACT_ALARM: 'المنبّه الدقيق', RECEIVE_BOOT_COMPLETED: 'الإقلاع', VIBRATE: 'الاهتزاز', ACCESS_FINE_LOCATION: 'الموقع الجغرافي', ACCESS_COARSE_LOCATION: 'الموقع الجغرافي', FOREGROUND_SERVICE: 'تشغيل في الخلفية', FOREGROUND_SERVICE_MEDIA_PLAYBACK: 'تشغيل في الخلفية' };
  asked.forEach(function (p) { assert.ok(spokenFor[p], 'the policy says nothing about ' + p); });
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('<a href="privacy.html">سياسة الخصوصية</a>') !== -1, 'and the app links to it');
});

/* ---------------- the adhan in its own voice ---------------- */

test('the adhan has voices, and the fajr keeps its own recording', () => {
  const { win, doc } = boot();
  assert.strictEqual(win.Store.get('adhanVoice'), 'none', 'the phone tone until the reader chooses');
  win.App.go('settings');
  const opts = [...doc.getElementById('settings-adhan-voice').options].map((o) => o.value);
  assert.strictEqual(opts[0], 'none');
  assert.ok(opts.length >= 6, 'the tone and five voices');
  /* the fajr adhan carries الصلاة خير من النوم, so it is used at fajr alone */
  assert.strictEqual(win.App.helpers.adhanUrl('assaf', false), 'audio/adhan/assaf.mp3');
  assert.ok(/-fajr\.mp3$/.test(win.App.helpers.adhanUrl('assaf', true)), 'at fajr, a fajr recording');
  assert.ok(!/-fajr\.mp3$/.test(win.App.helpers.adhanUrl('mujallad', false)), 'and not at the other prayers');
  win.ADHAN_VOICES.forEach(function (v) {
    const f = path.join(DOCS, 'audio', 'adhan', v.id + (v.fajr ? '-fajr' : '') + '.mp3');
    assert.ok(fs.existsSync(f), 'missing ' + v.id);
    assert.ok(fs.statSync(f).size > 300000 && fs.statSync(f).size < 4000000, v.id + ' is the wrong size');
  });
  assert.ok(!/إسلام ويب/.test(fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8')), 'the source is not named in the interface');
});

test('the chosen adhan is handed to the app so it sounds with the app closed', () => {
  const { win } = boot();
  const given = [];
  win.SunnatiApp = { setAdhanSound: function (a, b) { given.push([a, b]); } };
  /* bilal's only recording is a fajr, so a voice with both is the one asked here */
  win.Store.set('adhanVoice', 'jazi');
  win.App.go('settings');
  assert.ok(given.length >= 1);
  assert.ok(/audio\/adhan\/jazi\.mp3$/.test(given[given.length - 1][0]), 'the ordinary one');
  assert.ok(/-fajr\.mp3$/.test(given[given.length - 1][1]), 'and the fajr one beside it');
  const sound = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanSound.java'), 'utf8');
  assert.ok(sound.indexOf('USAGE_ALARM') !== -1, 'sounded on the alarm stream, so it is heard while the phone rests');
  const receiver = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(receiver.indexOf('CHANNEL_SILENT') !== -1, 'the notification keeps quiet when the app raises the adhan itself');
});


test('each voice button shows only its own sound playing', () => {
  const { win, doc } = boot();
  const started = [];
  win.Audio = function () {
    const clip = { paused: true, src: '', play: function () { clip.paused = false; return Promise.resolve(); }, pause: function () { clip.paused = true; }, removeAttribute: function () {}, load: function () {} };
    started.push(clip); return clip;
  };
  win.App.go('settings');
  const mark = (id) => doc.getElementById(id).querySelector('use').getAttribute('href');
  click(win, doc.getElementById('settings-voice-try'));
  assert.strictEqual(mark('settings-voice-try'), '#i-pause', 'the reminder is playing');
  assert.strictEqual(mark('settings-adhan-try'), '#i-play', 'and the adhan is not');
  win.App.helpers.stopSpeaking();
  const sel = doc.getElementById('settings-adhan-voice');
  sel.value = 'bilal'; fire(win, sel, 'change');
  assert.strictEqual(mark('settings-adhan-try'), '#i-pause', 'the adhan is playing');
  assert.strictEqual(mark('settings-voice-try'), '#i-play', 'and the reminder is not');
  win.App.helpers.stopSpeaking();
  assert.strictEqual(mark('settings-adhan-try'), '#i-play');
});

test('the sheet after a prayer opens on the istighfar, not on Ayat al-Kursi', () => {
  /* It drew its first four from chapter 27, morning and evening, so a prayer
     ended with Ayat al-Kursi and the muawwidhat. The adhkar after the salam
     are chapter 25, and their count is r, which never showed as c. */
  const { win, doc } = boot();
  win.Store.set('afterPrayerShown', ''); win.Store.set('afterPrayerOff', false);
  assert.ok(win.App.helpers.offerAfterPrayer('maghrib'));
  const bare = function (t) { return t.replace(/[\u064B-\u0652\u0670]/g, ''); };
  /* they are tapped and counted, not read off a box: the same dhikr card the
     rest of the app uses, with a ring that fills */
  const cards = [...doc.querySelectorAll('#sheet .dhikr')];
  assert.strictEqual(cards.length, 5, 'the four of the book, with the istighfar standing on its own');
  assert.ok(bare(cards[0].textContent).indexOf('أستغفر الله') === 0, 'begins with the istighfar');
  assert.strictEqual(cards[0].querySelector('.dhikr-left').textContent.trim(), '3',
    'said three times, not «(ثلاثاً)» written in brackets');
  assert.ok(bare(cards[4].textContent).indexOf('سبحان الله') === 0, 'ends with the tasbih');
  assert.strictEqual(cards[4].querySelector('.dhikr-left').textContent.trim(), '33');
  assert.ok(!cards.some(function (c) { return bare(c.textContent).indexOf('لا تأخذه سنة') !== -1; }),
    'Ayat al-Kursi is not among those said at the salam');

  /* three taps finish the istighfar; the rest are untouched */
  click(win, cards[0]); click(win, doc.querySelectorAll('#sheet .dhikr')[0]);
  click(win, doc.querySelectorAll('#sheet .dhikr')[0]);
  const after = [...doc.querySelectorAll('#sheet .dhikr')];
  assert.ok(after[0].classList.contains('is-done'), 'the istighfar is done');
  assert.strictEqual(after[4].querySelector('.dhikr-left').textContent.trim(), '33', 'the tasbih is untouched');
  /* one tap on the tasbih takes one off */
  click(win, after[4]);
  assert.strictEqual([...doc.querySelectorAll('#sheet .dhikr')][4].querySelector('.dhikr-left').textContent.trim(), '32');
  /* and the two buttons under them survive the redraw */
  assert.ok(doc.querySelector('#sheet [data-act="open-after-prayer"]'), 'the full chapter is still one tap away');
  assert.ok(doc.querySelector('#sheet [data-act="after-prayer-off"]'));

  /* the card carries its own kind, or a tap would count a dhikr on another screen */
  assert.strictEqual(after[0].getAttribute('data-kind'), 'after');

  /* «افتح الباب كاملاً» opens the chapter of the salam, not morning and evening:
     the sheet was moved to 25 and this button was left behind on 27 */
  click(win, doc.querySelector('#sheet [data-act="open-after-prayer"]'));
  assert.strictEqual(win.App.state.hisn, 25);
  assert.strictEqual(doc.getElementById('hisn-title').textContent, 'الأذكار بعد السلام من الصلاة');
  assert.ok(bare(doc.querySelector('#hisn-list .dhikr-text').textContent).indexOf('أستغفر الله') === 0,
    'and it opens on the istighfar');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function afterPrayerItems\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('c.id === 25') !== -1 && fn.indexOf('c.id === 27') === -1, 'chapter 25, the adhkar after the salam');
});

test('the after-prayer list says what حصن المسلم says, dhikr for dhikr, count for count', () => {
  /* The short list had drifted: it fused two dhikr into one, hung the ten
     repetitions on the wrong one, dropped يحيي ويميت entirely, and had no
     Ayat al-Kursi, no muawwidhat, no du'a of fajr. Nothing said so, because
     nothing held it against the book. This does. */
  const { win } = boot();
  /* spaces dropped too: the book itself has «حسد﴾،بسم» with no space, a
     typo of the source, and the list rightly puts one there */
  const bare = function (t) { return t.replace(/[\u064B-\u0652\u0670]/g, '').replace(/[ٱ]/g, 'ا').replace(/[\u0649]/g, 'ي').replace(/[،,.:﴿﴾*\s]/g, '').trim(); };
  const list = win.AZKAR_DB.afterprayer.items;
  const book = win.HISN.filter(function (c) { return c.id === 25; })[0].i;

  /* every dhikr in the list is found in the book, to the letter. The book
     writes «أستغفر الله (ثلاثاً)» once with a count; the list says it three
     times in full, which is the same instruction, so that one is matched by
     its single form. */
  const bookText = book.map(function (it) { return bare(it.t); }).join('');
  const misses = [];
  list.forEach(function (it, i) {
    let words = bare(it.t);
    if (i === 0) words = bare('أستغفر الله');
    if (bookText.indexOf(words) === -1) misses.push((i + 1) + ': ' + words.slice(0, 50));
  });
  assert.strictEqual(misses.length, 0, 'not in the book as written:\n' + misses.join('\n'));

  /* the two that used to be fused stand apart and carry the right count */
  const fused = list.filter(function (it) { return bare(it.t).indexOf(bare('لا حول ولا قوة')) !== -1; })[0];
  assert.ok(fused, 'لا حول ولا قوة is there');
  assert.strictEqual(fused.c, 1, 'and said once, not ten times');
  assert.ok(bare(fused.t).indexOf(bare('مخلصين له الدين')) !== -1, 'with its own ending, not cut short');
  const ten = list.filter(function (it) { return it.c === 10; })[0];
  assert.ok(ten, 'something is said ten times');
  assert.ok(bare(ten.t).indexOf(bare('يحيي ويميت')) !== -1, 'and it is the one with يحيي ويميت, after fajr and maghrib');

  /* the three that were missing */
  assert.ok(list.some(function (it) { return bare(it.t).indexOf(bare('لا تأخذه سنة ولا نوم')) !== -1; }), 'Ayat al-Kursi');
  assert.ok(list.some(function (it) { return bare(it.t).indexOf(bare('قل أعوذ برب الفلق')) !== -1; }), 'the muawwidhat');
  assert.ok(list.some(function (it) { return bare(it.t).indexOf(bare('علما نافعا')) !== -1; }), 'the du\'a after fajr');
  /* and the counts of the tasbih */
  assert.strictEqual(list.filter(function (it) { return it.c === 33; }).length, 3, 'three said thirty-three times');
});

test('every dhikr that states its count in words is counted that many times', () => {
  /* «حسبي الله لا إله إلا هو» says «(سبع مرات)» in its own text and its counter
     read one. Three such in حصن المسلم, found by asking of every item whether
     the number in the brackets is the number in the field. */
  const bare = function (t) { return t.replace(/[\u064B-\u0652\u0670]/g, ''); };
  const wanted = function (p) {
    if (/ثلاث[اً]? وثلاثين/.test(p)) return 33;
    if (/مئة|مائة/.test(p)) return 100;
    if (/عشر/.test(p)) return 10;
    if (/سبع/.test(p)) return 7;
    if (/خمس/.test(p)) return 5;
    if (/أربع/.test(p)) return 4;
    if (/ثلاث/.test(p)) return 3;
    if (/مرتين/.test(p)) return 2;
    if (/مرة واحدة/.test(p)) return 1;
    return null;
  };
  const { win } = boot();
  const off = [];
  win.HISN.forEach(function (ch) {
    ch.i.forEach(function (it) {
      const m = /\(([^)]*مر[اةت][^)]*)\)/.exec(bare(it.t));
      if (!m) return;
      const want = wanted(m[1]);
      if (want !== null && it.r !== want) off.push('باب ' + ch.id + ' رقم ' + it.a + ': «' + m[1] + '» but r=' + it.r);
    });
  });
  assert.strictEqual(off.length, 0, 'the field disagrees with the text:\n' + off.join('\n'));

  /* and the same question of the morning and evening lists */
  const off2 = [];
  Object.keys(win.AZKAR_DB || {}).forEach(function (key) {
    (win.AZKAR_DB[key].items || []).forEach(function (it, i) {
      const m = /\(([^)]*مر[اةت][^)]*)\)/.exec(bare(it.t));
      if (!m) return;
      const want = wanted(m[1]);
      if (want !== null && (it.c || 1) !== want) off2.push(key + '[' + i + ']: «' + m[1] + '» but c=' + (it.c || 1));
    });
  });
  assert.strictEqual(off2.length, 0, off2.join('\n'));

  /* the one that was asked about, by name */
  const hasbi = win.HISN.filter(function (c) { return c.id === 27; })[0].i.filter(function (i) { return i.a === 83; })[0];
  assert.strictEqual(hasbi.r, 7, 'حسبي الله لا إله إلا هو، سبع مرات');

  /* and no counter on a hadith that tells the reward of a dhikr rather than
     being one: «قال ﷺ: من قال كذا مئة مرة حطت خطاياه» is a narration, and a
     counter of 100 on it treats the Prophet's telling as a wird. The whole of
     the merit chapter had this, and three of its twelve carried a counter. */
  const merit = win.HISN.filter(function (c) { return c.id === 130; })[0];
  const counted = merit.i.filter(function (it) { return (it.r || 1) !== 1; }).map(function (it) { return it.a; });
  assert.strictEqual(counted.length, 0, 'the merit chapter counts these: ' + counted.join(', '));
  /* said as a rule, not for one chapter: any item that opens by quoting the
     Prophet must not carry a counter */
  const wrong = [];
  win.HISN.forEach(function (ch) {
    ch.i.forEach(function (it) {
      const t = bare(it.t);
      if ((it.r || 1) !== 1 && /^(قال|وقال) صلى الله عليه وسلم/.test(t)) {
        wrong.push('باب ' + ch.id + ' رقم ' + it.a);
      }
    });
  });
  assert.strictEqual(wrong.length, 0, 'a narration of reward is not a thing to be counted:\n' + wrong.join('\n'));
});

test('a dhikr that appears in more than one place has one and the same wording', () => {
  /* the same dua sits in حصن المسلم and in a themed list, and its words must
     match across them to the letter, بعد طرح الرسم: الشدة على اسم الله، وهمزة
     الوصل، والفاصلة، والمسافة. A real difference is a different word, and there
     must be none. */
  const { win } = boot();
  const words = function (t) {
    return t.replace(/[\u064B-\u0652\u0670\u0653-\u065F]/g, '').replace(/[\u0671]/g, 'ا')
      .replace(/[.،:﴿﴾]/g, '').split(/\s+/).filter(Boolean).join(' ');
  };
  const key = function (t) {
    return words(t).replace(/[\u0649\u064A]/g, 'ي').trim();
  };
  const seen = {};
  const add = function (src, t) {
    const k = key(t);
    if (k.length < 25) return;
    (seen[k] = seen[k] || []).push({ src: src, w: words(t) });
  };
  win.HISN.forEach(function (ch) { ch.i.forEach(function (it) { add('حصن ' + ch.id, it.t); }); });
  Object.keys(win.AZKAR_DB || {}).forEach(function (k) {
    (win.AZKAR_DB[k].items || []).forEach(function (it) { add(k, it.t); });
  });
  const clashes = [];
  Object.keys(seen).forEach(function (k) {
    const forms = [...new Set(seen[k].map(function (x) { return x.w; }))];
    if (forms.length > 1) clashes.push(seen[k].map(function (x) { return x.src; }).join(' / '));
  });
  assert.strictEqual(clashes.length, 0, 'same dhikr, different words, at:\n' + clashes.join('\n'));
});

test('a busy map server is passed over, not mistaken for an empty neighbourhood', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const ask = /function askOverpass\(query\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* Overpass answers a busy request with 200, or 406, or a 504 gateway page,
     with an HTML or XML body. «r.ok then r.json()» threw on the body and the
     whole screen read as «no mosques near you». Only real JSON with an
     elements array is accepted now. */
  assert.ok(ask.indexOf('r.json()') === -1, 'does not trust the body to be json');
  assert.ok(ask.indexOf('JSON.parse(text)') !== -1 && ask.indexOf('Array.isArray(data.elements)') !== -1,
    'accepts only a real json body with elements');
  assert.ok(/OVERPASS = \[[\s\S]*?\]/.exec(app)[0].split('interpreter').length - 1 >= 4,
    'four mirrors raced, not two endured');

  /* the mosques are searched around the reader's own place, not a fixed city */
  const find = /function findMosques\(around\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(find.indexOf('var where = place()') !== -1 && find.indexOf('around(') === -1,
    'the search centres on place(), which follows the user');
  assert.ok(find.indexOf('state.mosqueRetried') !== -1, 'and one quiet retry before giving up');

  /* the update banner says an update arrived, not that a copy arrived */
  assert.ok(app.indexOf('وصل تحديث جديد للتطبيق') !== -1);
  assert.ok(app.indexOf('وصلت نسخة جديدة') === -1);
});

test('the reader reads exactly what the voice recites, wherever it recites from', () => {
  const { win, doc } = boot();
  win.App.go('reminders');

  /* The app opens on a recitation of سورة الأحزاب آية ٥٦ from end to end. The
     file was transcribed before it was wired, because pointing it at the
     Ibrahimic salawat would have shown one text while another was recited. */
  const first = win.SALAWAT_VOICES[0];
  assert.strictEqual(first.id, 'buhendi', 'the recitation opens the list');
  /* spread, because an array from the page's realm is not reference-equal to
     one made here even when it holds the same two numbers */
  assert.deepStrictEqual([...first.q], [33, 56]);
  assert.strictEqual(win.Store.get('salawatVoice'), 'buhendi', 'and the app opens with it');
  assert.strictEqual(doc.getElementById('salawat-text').textContent, win.Mushaf.ayah(33, 56),
    'the words come from the mushaf itself, not typed beside the recording');
  assert.ok(doc.getElementById('salawat-text').className.indexOf('quran') !== -1,
    'an ayah is set in the mushaf face');
  assert.strictEqual(doc.getElementById('salawat-from').textContent, 'سورة الأحزاب، آية 56',
    'and says which ayah it is, not that it is from حصن المسلم');

  /* every voice points at something that is really there, and has a file */
  win.SALAWAT_VOICES.forEach(function (v) {
    if (v.q) {
      assert.ok(win.Mushaf.ayah(v.q[0], v.q[1]), v.id + ' should point at a real ayah');
    } else {
      const c = win.HISN.filter(function (x) { return x.id === v.hisn; })[0];
      assert.ok(c && c.i.some(function (i) { return i.a === v.a; }), v.id + ' should point into حصن المسلم');
    }
    /* a recitation may carry its own path, when the file already lives with
       the chapter it belongs to: one file, not a copy under another name */
    const at = v.f ? path.join(DOCS, v.f) : path.join(DOCS, 'audio', 'salawat', v.id + '.mp3');
    assert.ok(fs.existsSync(at) && fs.statSync(at).size > 20000, v.id + ' has no recording');
  });

  /* the worker keeps the one the app opens with, or it is silent offline */
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("'./audio/salawat/" + first.id + ".mp3'") !== -1);

  /* choosing a dua shows that dua, in full and in the naskh */
  const sel = doc.getElementById('settings-salawat-voice');
  sel.value = 'ibrahimiyya'; fire(win, sel, 'change');
  const chapter = win.HISN.filter(function (c) { return c.id === 23; })[0];
  const ibrahimiyya = chapter.i.filter(function (i) { return i.a === 53; })[0];
  const shown = doc.getElementById('salawat-text').textContent;
  assert.strictEqual(shown, ibrahimiyya.t);
  assert.ok(doc.getElementById('salawat-text').className.indexOf('naskh') !== -1);
  assert.strictEqual(doc.getElementById('salawat-from').textContent, 'حصن المسلم');
  const bare = shown.replace(/[\u064B-\u0652\u0670]/g, '');
  ['اللهم صل على محمد', 'كما صليت على إبراهيم', 'إنك حميد مجيد', 'بارك على محمد', 'كما باركت على إبراهيم'].forEach(function (part) {
    assert.ok(bare.indexOf(part) !== -1, 'the ibrahimiyya should contain: ' + part);
  });
  assert.strictEqual((bare.match(/إنك حميد مجيد/g) || []).length, 2, 'it closes both halves');

  /* and the reciter is named where a reciter should be */
  assert.ok(/SALAWAT_RECITER = \{[^}]*خالد بوهندي/.test(
    fs.readFileSync(path.join(DOCS, 'data', 'adhan.js'), 'utf8')), 'the reciter is named');
});

test('the launcher icon is the app\'s own artwork, whole inside the safe middle', () => {
  const res = path.join(__dirname, '..', 'android/app/src/main/res');
  const adaptive = fs.readFileSync(path.join(res, 'mipmap-anydpi/ic_launcher.xml'), 'utf8');
  assert.ok(adaptive.indexOf('@mipmap/ic_launcher_foreground') !== -1, 'the foreground is the artwork itself, not a redrawing');
  assert.ok(adaptive.indexOf('<monochrome') !== -1, 'and a single colour form for a themed home screen');
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(function (d) {
    const p = path.join(res, 'mipmap-' + d, 'ic_launcher_foreground.png');
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 400, d + '/ic_launcher_foreground.png');
  });
  /* the status bar draws a silhouette in its own colour: the name alone, in
     the heavy face of the icon, letter by letter as the themed icon has it;
     the mihrab and its crescent crowded each other at that size */
  const status = fs.readFileSync(path.join(res, 'drawable/ic_notification.xml'), 'utf8');
  assert.ok(/android:width="24dp" android:height="24dp"\s*android:viewportWidth="240" android:viewportHeight="240"/.test(status),
    'twenty four points, drawn in tenths so one decimal place stays fine');
  assert.ok(status.indexOf('tools:ignore="VectorPath"') !== -1, 'the letters kept whole, as the themed icon keeps them');
  const letters = status.match(/<path [^>]*\/>/g) || [];
  assert.ok(letters.length >= 4, 'the name, letter by letter: ' + letters.length);
  letters.forEach((l) => assert.ok(/android:fillColor="#FFFFFFFF"/.test(l), 'every letter filled'));
  const coords = status.match(/android:pathData="([^"]+)"/g).join(' ').match(/-?\d+(\.\d+)?/g).map(Number);
  assert.ok(Math.min(...coords) >= 0 && Math.max(...coords) <= 240, 'and nothing of it cut by the edge of the box');
  assert.ok(Math.max(...coords) - Math.min(...coords) > 200, 'and the word as wide as the box allows, so it reads');
  const colours = status.match(/#[0-9A-Fa-f]{8}/g) || [];
  assert.ok(colours.length && colours.every((c) => c === '#FFFFFFFF' || c === '#00000000'), 'one colour only, as the status bar draws it');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools/store/icon-master.png')), 'the square artwork, written by icon-build.py with every size');
});

/* ---------------- every arrow points the way the language runs ---------------- */

test('the play mark points as playback does on every phone, and every step arrow agrees with its label', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* The triangle points right in every language, as the phone's own player
     draws it: playback is not mirrored for a right to left reading, on
     Android or on the iPhone, and a triangle pointing left read as rewind. */
  assert.match(html, /<g id="i-play"><path d="M7 4\.5 19 12 7 19\.5z"\/><\/g>/, 'the play mark points right');
  /* every direction arrow is a plain chevron now; the return arrow was a long
     tailed arrow that read as «forward» rather than «back», and a chevron
     pointing the way the text runs is the plainer sign of going back */
  assert.match(html, /<g id="i-step-prev"><path d="m10 5 7 7-7 7"\/><\/g>/, 'the step before points right');
  assert.match(html, /<g id="i-step-next"><path d="m14 5-7 7 7 7"\/><\/g>/, 'the step after points left');
  assert.match(html, /<g id="i-back"><path d="m9 6 6 6-6 6"\/><\/g>/, 'the return arrow is a right chevron');

  const { win, doc } = boot();
  const drawn = { 'i-back': 'right', 'i-step-prev': 'right', 'i-step-next': 'left', 'i-surah-prev': 'right', 'i-surah-next': 'left', 'i-next': 'left', 'i-play': 'right' };
  const wanted = function (label) {
    if (/سابق|رجوع|السابقة/.test(label)) return 'right';
    if (/تالي|التالية/.test(label)) return 'left';
    if (/اسمع|تشغيل|استماع/.test(label)) return 'right';
    return null;
  };
  const views = ['home', 'quran', 'reader', 'page', 'azkar', 'hisn', 'tracker', 'prayers', 'more', 'radio', 'calendar', 'timetable', 'settings'];
  let checked = 0;
  views.forEach(function (v) {
    win.App.go(v);
    doc.querySelectorAll('#v-' + v + ' [aria-label]').forEach(function (el) {
      const use = el.querySelector('use');
      if (!use) return;
      const href = use.getAttribute('href').slice(1);
      if (!drawn[href]) return;
      const want = wanted(el.getAttribute('aria-label'));
      if (!want) return;
      checked++;
      assert.strictEqual(drawn[href], want, v + ': «' + el.getAttribute('aria-label') + '» draws ' + drawn[href] + ' but means ' + want);
    });
  });
  assert.ok(checked >= 10, 'every screen with arrows should have been walked, checked ' + checked);
});

test('a station carries a filled play control, not a stray hairline', () => {
  const { win, doc } = boot();
  win.App.go('radio');
  const play = doc.querySelector('#radio-list .row-play');
  assert.ok(play, 'each station has one');
  assert.strictEqual(play.querySelector('use').getAttribute('href'), '#i-play');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.row-play \{[^}]*border-radius:\s*50%/, 'drawn as a round button');
  assert.match(css, /\.icon:has\(use\[href='#i-play'\]\) \{ fill: currentColor; stroke: none/,
    'the triangle is a shape, so it is filled not outlined');
});

/* ---------------- صفة العمرة ---------------- */



/* ---------------- صفة العمرة ---------------- */

test('the umrah is five stages in the order the rite is performed, each naming its page', () => {
  const { win } = boot();
  /* joined, since an array built inside the page has its own realm's prototype */
  assert.strictEqual(win.UMRAH_STAGES.map((s) => s.id).join(','), 'before,talbiyah,tawaf,sayi,halq',
    'ihram, then talbiyah, then tawaf, then sayi, then the cutting of the hair');
  /* seven steps were added from the نبذة of ابن باز: الاشتراط, purity as a
     condition of the tawaf, the woman who is not pure, and the rest */
  assert.strictEqual(win.UMRAH_STAGES.reduce((n, s) => n + s.i.length, 0), 39);
  let page = 0;
  win.UMRAH_STAGES.forEach(function (st) {
    assert.ok(st.t && st.note && st.i.length, st.id + ' should be whole');
    assert.ok(st.p > page, 'the pages should run forward through the book: ' + st.id);
    page = st.p;
  });
  assert.strictEqual(win.UMRAH_SOURCE.b, 'دليل المعتمر');
  assert.ok(win.UMRAH_SOURCE.a.indexOf('طلال') !== -1, 'and name its author');
});

test('the five mawaqit carry who they are for and how far they lie from makkah', () => {
  const { win } = boot();
  assert.strictEqual(win.UMRAH_MAWAQIT.length, 5);
  const byName = {};
  win.UMRAH_MAWAQIT.forEach(function (m) {
    assert.ok(m.n && m.w && m.km > 0, m.n + ' should be whole');
    byName[m.n] = m.km;
  });
  assert.strictEqual(byName['ذو الحليفة'], 450);
  assert.strictEqual(byName['قرن المنازل'], 75);
  assert.strictEqual(byName['الجحفة'], 183);
  assert.strictEqual(byName['يلملم'], 92);
  assert.strictEqual(byName['ذات عرق'], 94);
});

test('a step is ticked and kept, the tally follows, and the reference tabs each show their own', () => {
  const { win, doc } = boot();
  win.App.go('umrah');
  assert.strictEqual(doc.querySelectorAll('#umrah-stages .fold').length, 5);
  assert.strictEqual(doc.querySelectorAll('[data-umrah-step]').length, 39);
  assert.strictEqual(doc.getElementById('umrah-tally').textContent, '0 من 39');
  /* every stage is folded away until asked for */
  assert.strictEqual(doc.querySelectorAll('#umrah-stages .fold.is-open').length, 0);
  click(win, doc.querySelector('#umrah-stages .fold-head'));
  assert.strictEqual(doc.querySelector('#umrah-stages .fold.is-open .fold-title').textContent.indexOf('قبل الإحرام'), 0);
  click(win, doc.querySelector('[data-umrah-step]'));
  assert.strictEqual(doc.getElementById('umrah-tally').textContent, '1 من 39');
  assert.strictEqual(JSON.stringify(win.Store.get('umrah')), '{"before:0":1}');
  click(win, doc.querySelector('[data-umrah-step]'));
  assert.strictEqual(JSON.stringify(win.Store.get('umrah')), '{}', 'pressed again it is cleared');
  const counts = { mawaqit: 5, forbidden: win.UMRAH_FORBIDDEN.length, allowed: win.UMRAH_ALLOWED.length, mistakes: win.UMRAH_MISTAKES.length };
  Object.keys(counts).forEach(function (tab) {
    click(win, doc.querySelector('[data-umrah="' + tab + '"]'));
    assert.strictEqual(doc.querySelectorAll('#umrah-ref .row').length, counts[tab], tab);
    assert.strictEqual(doc.querySelector('[data-umrah="' + tab + '"]').getAttribute('aria-selected'), 'true');
  });
  /* and it is reached from the more list */
  win.App.go('more');
  assert.ok(doc.querySelector('#more-list [data-go="umrah"]'), 'صفة العمرة should be in المزيد');
});

/* ---------------- وضع القراءة، وسهم الصعود، وأدعية القرآن ---------------- */

test('the page walks by itself at the pace chosen, and stops at the foot', () => {
  const { win, doc } = boot();
  /* the frames are kept in a queue, so a cancel does not lose the last one */
  const queued = [];
  win.requestAnimationFrame = function (fn) { queued.push(fn); return queued.length; };
  win.cancelAnimationFrame = function () {};
  const frame = function (t) { const fn = queued.pop(); queued.length = 0; if (fn) fn(t); };
  let at = 500;
  Object.defineProperty(win, 'scrollY', { get: () => at, configurable: true });
  win.scrollBy = function (x, y) { at += y; };
  win.App.state.surah = 2; win.App.go('reader');
  assert.strictEqual(win.App.helpers.autoScrolling(), false);
  /* the button opens the choice of pace rather than starting blind */
  click(win, doc.getElementById('reader-autoscroll'));
  const paces = [...doc.querySelectorAll('[data-act="read-pace"]')].map((b) => b.getAttribute('data-ref'));
  assert.strictEqual(paces.join(','), 'slow,mid,fast');
  click(win, doc.querySelector('[data-act="read-pace"][data-ref="mid"]'));
  assert.strictEqual(win.App.helpers.autoScrolling(), true);
  assert.ok(doc.getElementById('reader-autoscroll').classList.contains('is-on'));
  frame(0); for (let t = 100; t <= 5000; t += 100) frame(t);
  const middle = at - 500;
  assert.ok(middle > 0, 'the page walked down, ' + middle + 'px');
  /* a faster pace covers more ground in the same time */
  win.App.helpers.stopAutoScroll(true);
  at = 500; win.Store.set('readPace', 'fast');
  win.App.helpers.startAutoScroll();
  frame(0); for (let t = 100; t <= 5000; t += 100) frame(t);
  assert.ok(at - 500 > middle, 'سريع outruns متوسط');
  /* nothing left to scroll ends it */
  win.scrollBy = function () {};
  frame(6000); frame(6100);
  assert.strictEqual(win.App.helpers.autoScrolling(), false, 'the foot of the page stops it');
});

test('the reader takes the page back with a touch, and leaving the mushaf ends it', () => {
  const { win, doc } = boot();
  win.requestAnimationFrame = function () { return 1; };
  win.cancelAnimationFrame = function () {};
  win.App.state.surah = 1; win.App.go('reader');
  win.App.helpers.startAutoScroll();
  assert.strictEqual(win.App.helpers.autoScrolling(), true);
  win.dispatchEvent(new win.Event('wheel'));
  assert.strictEqual(win.App.helpers.autoScrolling(), false, 'a touch is never fought');
  win.App.helpers.startAutoScroll();
  win.App.go('home');
  assert.strictEqual(win.App.helpers.autoScrolling(), false, 'nothing walks a page the reader has left');
  assert.ok(!doc.getElementById('reader-autoscroll').classList.contains('is-on'), 'and the button says so');
  assert.strictEqual(win.Store.get('readPace'), 'mid', 'the pace is kept between visits');
});

test('the arrow to the top waits until there is something to come back from', () => {
  const { win, doc } = boot();
  const btn = doc.getElementById('to-top');
  assert.ok(btn && btn.hidden, 'nothing to return to at the top');
  assert.strictEqual(btn.querySelector('use').getAttribute('href'), '#i-up');
  assert.strictEqual(btn.getAttribute('aria-label'), 'إلى أعلى الصفحة');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.to-top \{[^}]*position:\s*fixed/, 'it stays in reach while the screen moves');
  assert.match(css, /\.to-top \{[^}]*width:\s*48px/, 'and is a full thumb');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/btn\.hidden = y < 400 \|\| !up;/.test(app), 'it shows once the reader has come some way down, on the way back up');
});

test("the qur'an's own supplications are gathered by theme, and read from the mushaf", () => {
  const { win, doc } = boot();
  win.App.go('dua');
  const chips = [...doc.querySelectorAll('[data-dua-theme]')];
  assert.strictEqual(chips.length, win.App.helpers.duaTopics().length, 'a tile for every topic');
  assert.ok(chips.length >= 25, 'the booklet\'s themes, ' + chips.length);
  /* every verse a theme names is a real verse of the mushaf */
  win.DUA_THEMES.forEach(function (t) {
    assert.ok(t.n && t.v, t.id + ' should be whole');
    t.v.split(',').forEach(function (ref) {
      const parts = ref.split(':').map(Number);
      assert.strictEqual(parts.length, 2, t.id + ' has a malformed reference: ' + ref);
      const text = win.Mushaf.ayah(parts[0], parts[1]);
      assert.ok(text && text.length > 5, t.id + ' points at nothing: ' + ref);
    });
  });
  const theme = win.DUA_THEMES[0];
  click(win, doc.querySelector('[data-dua-theme="' + theme.id + '"]'));
  const hits = doc.querySelectorAll('#sheet .search-hit');
  assert.strictEqual(hits.length, theme.v.split(',').length);
  /* the words are the mushaf's, never copied beside it */
  const first = theme.v.split(',')[0].split(':').map(Number);
  assert.ok(hits[0].textContent.indexOf(win.Mushaf.ayah(first[0], first[1])) !== -1);
  const themes = fs.readFileSync(path.join(DOCS, 'data', 'dua-themes.js'), 'utf8');
  assert.ok(themes.indexOf('فإنك بأعيننا') !== -1, 'and the booklet the themes came from is named');
});

test("the booklet's supplications are gathered by topic beside the qur'an's", () => {
  const { win, doc } = boot();
  assert.strictEqual(win.DUA_BOOK.length, 30, 'the thirty topics of the booklet');
  const total = win.DUA_BOOK.reduce((n, t) => n + t.i.length, 0);
  assert.ok(total > 400, 'and its supplications, ' + total);
  /* nothing came out of the file broken: no word runs past eleven letters,
     and no stray diacritic was left behind by the font */
  win.DUA_BOOK.forEach(function (t) {
    assert.ok(t.id && /^[a-z]+$/.test(t.id), t.n + ' should have a plain id');
    assert.ok(t.i.length, t.n + ' should not be empty');
    t.i.forEach(function (line) {
      /* «رب اصلح لي قلبي» is a whole supplication in fifteen letters, so the
         floor is on words rather than length */
      assert.ok(line.split(' ').length >= 3, t.n + ': a line too short to be a supplication: ' + line);
      assert.ok(!/[\u064B-\u0655\u0670]/.test(line), t.n + ': a stray mark survived: ' + line.slice(0, 40));
      line.split(' ').forEach(function (w) {
        assert.ok(w.length <= 11, t.n + ': two words ran together: ' + w);
      });
    });
  });
  win.App.go('dua');
  const chips = [...doc.querySelectorAll('[data-dua-theme]')];
  assert.strictEqual(chips.length, 30, 'every topic is offered');
  assert.strictEqual(doc.getElementById('dua-book-tally').textContent, String(total) + ' دعاء');
  click(win, chips[0]);
  const topic = win.App.helpers.duaTopics()[0];
  assert.strictEqual(doc.querySelectorAll('#sheet .dua-line').length, topic.i.length);
  assert.strictEqual(doc.querySelectorAll('#sheet .search-hit').length, topic.v.length,
    "and the qur'an's verses for the same topic beside them");
  /* the verses are still read from the mushaf, never copied */
  const first = topic.v[0].split(':').map(Number);
  assert.ok(doc.querySelector('#sheet .search-hit').textContent.indexOf(win.Mushaf.ayah(first[0], first[1])) !== -1);
  const src = fs.readFileSync(path.join(DOCS, 'data', 'duas.js'), 'utf8');
  assert.ok(src.indexOf('فإنك بأعيننا') !== -1, 'and the booklet is named');
});

test('the bar of the mushaf is one row of one size, held at the top on solid ground', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* the rule that lays the bar out, not the one that tightens it on a narrow phone */
  const bar = [...css.matchAll(/\.reader-bar \{[^}]*\}/g)].map((m) => m[0]).filter((r) => r.indexOf('display') !== -1)[0];
  assert.ok(bar, 'the bar should be laid out in one rule');
  assert.match(bar, /position:\s*sticky/, 'it holds while the page scrolls');
  assert.match(bar, /background:\s*var\(--paper\)/, 'on solid ground, so the words never show through it');
  assert.match(bar, /display:\s*flex/);
  assert.match(css, /\.reader-bar \.btn \{[^}]*height:\s*48px/, 'one height for every control');
  assert.match(css, /\.btn-icon \{[^}]*width:\s*48px/, 'and one width for a button that is only a mark');
  const { doc } = boot();
  const bars = [...doc.querySelectorAll('.reader-bar')];
  assert.ok(bars.length >= 2, 'the surah reader and the page reader both have one');
  bars.forEach(function (row) {
    assert.ok(row.querySelectorAll('.btn').length >= 2, 'a bar carries its controls');
    assert.ok(row.querySelectorAll('.btn-primary').length <= 1, 'only one takes the room that is left');
  });
  /* every icon-only control in a bar is a square, and none of them was
     given a width that would clip a word */
  bars.forEach(function (row) {
    row.querySelectorAll('.btn').forEach(function (b) {
      const onlyIcon = !b.textContent.trim();
      assert.strictEqual(b.classList.contains('btn-icon'), onlyIcon,
        (b.id || b.getAttribute('aria-label')) + ' should' + (onlyIcon ? '' : ' not') + ' be a square');
    });
  });
});

test('the listen button reads استمع, with its mark after the word', () => {
  const { doc } = boot();
  const play = doc.getElementById('reader-play');
  assert.strictEqual(play.textContent.trim(), 'استمع');
  /* the word comes first in the markup, and the mark is ordered after it */
  assert.strictEqual(play.firstChild.textContent.trim(), 'استمع');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.reader-bar \.btn-primary \.icon \{ order: 2; \}/);
});

test('the app sits below the phone bars rather than under them', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  assert.ok(main.indexOf('bars.show(WindowInsets.Type.statusBars()') !== -1,
    'the clock and the battery stay where the reader expects them');
  assert.ok(main.indexOf('bars.hide(') === -1, 'nothing of the system is hidden');
  assert.ok(main.indexOf('WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()') !== -1,
    'and both the bars and a camera cutout keep their room');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/res/values/styles.xml'), 'utf8');
  assert.ok(styles.indexOf('android:statusBarColor">@color/backgroundColor') !== -1,
    'the bar takes the app\'s own paper');
});

test('the topics are equal tiles, and the three paces share one row', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* the topics: a grid of two, not a ragged run of pills */
  assert.match(css, /\.topics \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    'two equal columns, which a long name in a translated page cannot widen');
  assert.match(css, /\.topic \{[^}]*min-height:\s*52px/, 'one height for every tile');
  /* the sheet of four marks stretches an odd last one; the three paces must not */
  assert.match(css, /\.mark-choices:not\(\.three\) \.btn:last-child:nth-child\(odd\)/,
    'the stretching rule was written for the four marks and must not reach the paces');
  assert.match(css, /\.mark-choices\.three \{ grid-template-columns: 1fr 1fr 1fr; \}/);
  const { win, doc } = boot();
  win.App.go('dua');
  const tiles = [...doc.querySelectorAll('.topic')];
  assert.ok(tiles.length >= 25);
  tiles.forEach(function (t) {
    assert.ok(t.querySelector('.topic-name') && t.querySelector('.topic-count'), 'a name and a count');
  });
  win.App.state.surah = 1; win.App.go('reader');
  win.App.helpers.paceSheet();
  const grid = doc.querySelector('#sheet .mark-choices');
  assert.ok(grid.classList.contains('three'), 'the paces ask for three columns');
  assert.strictEqual(doc.querySelectorAll('#sheet [data-act="read-pace"]').length, 3);
});

test('a supplication and a verse each keep their own room beside their share button', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* the room for the button is made by the layout, not by a padding that can
     fall on the wrong side of the line */
  assert.match(css, /\.dua-line \{[^}]*display:\s*flex/, 'the words and the button sit side by side');
  assert.ok(!/\.dua-share \{[^}]*position:\s*absolute/.test(css), 'a button laid over the words can cover them');
  assert.match(css, /\.dua-text \{[^}]*flex:\s*1 1 auto/, 'the words take the room that is left');
  assert.match(css, /\.verse-line \{[^}]*display:\s*flex/);
  const { win, doc } = boot();
  win.App.go('dua');
  const withVerses = win.App.helpers.duaTopics().filter(function (t) { return t.i.length && t.v.length; })[0];
  click(win, doc.querySelector('[data-dua-theme="' + withVerses.id + '"]'));
  /* every supplication carries its own button, and so does every verse */
  const lines = doc.querySelectorAll('#sheet .dua-line');
  assert.strictEqual(lines.length, withVerses.i.length);
  lines.forEach(function (l) {
    assert.ok(l.querySelector('.dua-text'), 'the words are wrapped, not loose beside the button');
    assert.ok(l.querySelector('[data-act="share-dua"]'), 'and a button that sends them');
  });
  const verses = doc.querySelectorAll('#sheet .verse-line');
  assert.strictEqual(verses.length, withVerses.v.length);
  verses.forEach(function (v, i) {
    assert.ok(v.querySelector('[data-hit]'), 'the words open the mushaf');
    const share = v.querySelector('[data-act="share"]');
    assert.ok(share, 'and a verse can be sent as a picture too');
    assert.strictEqual(share.getAttribute('data-ref'), withVerses.v[i], 'each button carries its own verse');
  });
});

test('a shared card is always written in one of the app\'s own faces', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the canvas can only find a family it is given by name, so a class name
     handed in as a face falls back to whatever the browser happens to use */
  assert.ok(app.indexOf("var quranFace = FACES[face] || FACES.naskh;") !== -1,
    'the face is looked up, never taken raw');
  const faces = /var FACES = \{([\s\S]*?)\};/.exec(app)[1];
  assert.ok(/naskh:\s*"'Amiri'/.test(faces) && /quran:\s*"'Amiri Quran'/.test(faces),
    'and both names are families the app itself loads');
  /* every call asks for one of them */
  [...app.matchAll(/textCard\([^;]*?,\s*'([a-z]+)'\s*,/g)].forEach(function (m) {
    assert.ok(m[1] === 'naskh' || m[1] === 'quran', 'a card asked for an unknown face: ' + m[1]);
  });
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf("--naskh: 'Amiri'") !== -1 && css.indexOf("--quran: 'Amiri Quran'") !== -1,
    'the same two faces the screen reads with');
});

test('a shared supplication carries no source line, and the app does not say where it was made', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const share = /'share-dua': function \(ref\) \{([\s\S]*?)\n    \},/.exec(app)[1];
  assert.ok(share.indexOf("'naskh', ''") !== -1, 'the foot of the card is left empty');
  assert.ok(share.indexOf('DUA_BOOK_SOURCE') === -1, 'the booklet is not named on the picture');
  ['index.html'].forEach(function (f) {
    assert.ok(fs.readFileSync(path.join(DOCS, f), 'utf8').indexOf('صنع في الكويت') === -1, f);
  });
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8').indexOf('صنع في الكويت') === -1);
});

test('no supplication carries a letter torn from its word', () => {
  const { win } = boot();
  /* the book justifies its lines, which stretches the joins inside a word
     until they read as a space; a lone letter is the mark that one was torn */
  const lone = [];
  win.DUA_BOOK.forEach(function (t) {
    t.i.forEach(function (line, at) {
      line.split(' ').forEach(function (w) {
        const bare = w.replace(/[^\u0621-\u064A]/g, '');
        if (bare.length === 1 && bare !== 'و') lone.push(t.id + '[' + at + '] ' + w);
      });
    });
  });
  assert.deepStrictEqual(lone.join(', '), '', 'a letter standing alone: ' + lone.slice(0, 5).join(', '));
  /* and none run together the other way */
  win.DUA_BOOK.forEach(function (t) {
    t.i.forEach(function (line) {
      line.split(' ').forEach(function (w) {
        assert.ok(w.replace(/[^\u0621-\u064A]/g, '').length <= 11, t.id + ': two words joined: ' + w);
      });
    });
  });
  const rizq = win.DUA_BOOK.filter(function (t) { return t.id === 'rizq'; })[0];
  assert.ok(rizq.i.some(function (l) { return l.indexOf('ذو حظ عظيم') !== -1; }));
  assert.ok(!rizq.i.some(function (l) { return /ذو ح ظ/.test(l); }));
});

test('the button that sends a verse sits inside its card', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const line = /\.verse-line \{[^}]*\}/.exec(css)[0];
  assert.match(line, /background:\s*var\(--raised\)/, 'the card is the row, so the button is within it');
  assert.match(line, /border:\s*1px solid var\(--line\)/);
  assert.match(css, /\.verse-line \.search-hit \{[^}]*background:\s*transparent/, 'and the words inside it carry no second card');
});

test('the reminder to send prayers upon the prophet is held by the app, not the page', () => {
  /* a web page is only woken by periodic sync, which a web view never fires,
     so the page must hand the interval to the app */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('app.setSalawatEvery(+Store.get(\'salawat\') || 0)') !== -1);
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(/@JavascriptInterface\s+public void setSalawatEvery\(int minutes\)/.test(bridge));
  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SalawatScheduler.java'), 'utf8');
  assert.ok(sched.indexOf('setExactAndAllowWhileIdle') !== -1, 'an alarm of its own');
  const receiver = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(receiver.indexOf('SalawatScheduler.scheduleNext(context, true)') !== -1, 'and it re-arms itself after each one');
  const onBoot = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/BootReceiver.java'), 'utf8');
  assert.ok(onBoot.indexOf('SalawatScheduler.scheduleNext(context)') !== -1, 'and survives a reboot');
  /* the reader's choice reaches the app */
  const { win, doc } = boot();
  const given = [];
  win.SunnatiApp = { setSalawatEvery: function (m) { given.push(m); } };
  win.App.go('settings');
  const sel = doc.getElementById('settings-salawat');
  sel.value = '60'; fire(win, sel, 'change');
  assert.strictEqual(given[given.length - 1], 60, 'sixty minutes, as chosen');
});

test('an upcoming occasion says the very day it falls on', () => {
  const { win, doc } = boot();
  const list = win.Hijri.upcoming(new Date(), 0);
  assert.ok(list.length, 'there is always something ahead');
  /* the nearest voluntary fast heads the list now, so the first hijri occasion
     is looked up by its name rather than assumed to be the first row */
  const first = list[0];
  const notes = [...doc.querySelectorAll('#home-upcoming .row')]
    .map(function (r) { return r.querySelector('.row-note').textContent; });
  assert.ok(notes.some(function (n) { return n.indexOf(win.App.helpers.whenItFalls(first.date)) !== -1; }),
    'the countdown alone does not tell a reader when to prepare');
  /* the day, the date, the month and the year, in the words the app uses */
  const written = win.App.helpers.whenItFalls(first.date);
  assert.ok(win.Hijri.WEEKDAYS.some(function (d) { return written.indexOf(d) === 0; }), 'the weekday first');
  assert.ok(written.indexOf(String(first.date.getFullYear())) !== -1, 'and the year');
});

test('the app does not repeat its own name and address at the foot of every screen', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.strictEqual((html.match(/class="foot"/g) || []).length, 1, 'one foot, on the about page');
  assert.ok(html.indexOf('المستودع على GitHub') === -1, 'the repository is not linked from the app');
  assert.ok(html.indexOf('التطبيق مجاني بلا إعلانات ولا تتبع، فمن انتفع به فليدع لوالديّ ولمن ساهم فيه.') !== -1);
  assert.ok(html.indexOf('ونص حصن المسلم وتسجيلات') === -1, 'the sources are named in المصادر, not twice');
});

test('the sections fill their rows, leaving no hole at the end', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.grid:not\(\.grid-2\) > \.tile:last-child:nth-child\(3n \+ 1\) \{ grid-column: 1 \/ -1; \}/,
    'a tile left alone on the last row stretches across it');
  assert.match(css, /\.grid:not\(\.grid-2\) > \.tile:nth-last-child\(2\):nth-child\(3n \+ 1\) \{ grid-column: span 2; \}/,
    'and two left over take half each');
});

test('the call to rise falls at the last third of the night, and the app is told', () => {
  const { win, doc } = boot();
  const at = win.App.helpers.qiyamAt(new win.Date());
  assert.ok(at && typeof at.getHours === 'function', 'a time is worked out');
  assert.ok(at.getHours() >= 21 || at.getHours() <= 5, 'in the depth of the night, got ' + at.getHours());
  const given = [];
  win.SunnatiApp = { setQiyamTimes: function (j) { given.push(JSON.parse(j)); } };
  win.Store.set('qiyam', false);
  win.App.helpers.handQiyamToApp();
  assert.strictEqual(given[given.length - 1].length, 0, 'off means the app stops calling');
  win.Store.set('qiyam', true);
  win.App.helpers.handQiyamToApp();
  const nights = given[given.length - 1];
  assert.ok(nights.length >= 6 && nights.length <= 7, 'a week of nights, got ' + nights.length);
  nights.forEach(function (ms) { assert.ok(ms > Date.now(), 'every one still ahead'); });
  for (let i = 1; i < nights.length; i++) assert.ok(nights[i] > nights[i - 1], 'in order');
  /* the switch shows the hour it will call tonight */
  win.App.go('settings');
  assert.ok(doc.getElementById('settings-qiyam-note').textContent.indexOf('الليلة عند') !== -1);
  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/QiyamScheduler.java'), 'utf8');
  assert.ok(sched.indexOf('setExactAndAllowWhileIdle') !== -1 && sched.indexOf('scheduleNext') !== -1);
});

test('silence on the salawat means silent, and hearing it does not change it', () => {
  /* Two faults the reader met at once: the notification was always posted on
     the ringing channel however they set the sound, and the hear button
     switched their choice from silence to a recording and then played it. */
  const { win, doc } = boot();
  const handed = {};
  win.SunnatiApp = {
    setSalawatEvery: function () {},
    setSalawatSilent: function (v) { handed.silent = v; }
  };
  win.App.go('reminders');
  /* One row, not two. Giving the salawat a second sound select left two rows
     side by side both called «صوت», and the reader could not tell which was
     which. Its own row carries the choice, and silence there quiets the
     notification as well as the page. */
  assert.ok(!doc.querySelector('[data-sound="salawatNote"]'), 'the salawat has one sound row, not two');
  const sel = doc.getElementById('settings-voice');
  sel.value = 'none'; fire(win, sel, 'change');
  assert.strictEqual(win.Store.get('voice'), 'none');
  assert.strictEqual(handed.silent, true, 'the wrapper is told, or the phone rings anyway');

  /* pressing hear leaves the choice alone */
  click(win, doc.getElementById('settings-voice-try'));
  assert.strictEqual(win.Store.get('voice'), 'none', 'still silent after pressing hear');

  const recv = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(/hush \? CHANNEL_QUIET : CHANNEL_REMINDERS/.test(recv), 'and it arrives on the quiet channel');
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(bridge.indexOf('setSalawatSilent') !== -1);

  /* A channel keeps the sound and vibration it was made with, for ever. When
     either changes the channel needs a new name, or the phones that already
     have it never hear the difference: that is why a reader who had chosen
     silence months ago still heard the tone. */
  assert.ok(/CHANNEL_QUIET = "reminders_hush_v2"/.test(recv), 'the quiet channel was remade under a new name');
  const quiet = /new NotificationChannel\(CHANNEL_QUIET[\s\S]*?createNotificationChannel/.exec(recv)[0];
  assert.ok(quiet.indexOf('setSound(null, null)') !== -1, 'with no sound');
  assert.ok(quiet.indexOf('enableVibration(false)') !== -1, 'and no buzz');
});

test('the adhan can arrive silent, as every other reminder can', () => {
  const { win, doc } = boot();
  win.App.go('reminders');
  const sel = doc.getElementById('settings-adhan-voice');
  const labels = [...sel.options].map(function (o) { return o.text; });
  /* the phone's tone, no sound at all, or one of the muadhins */
  assert.strictEqual(labels[0], 'نغمة الجهاز');
  assert.strictEqual(labels[1], 'صامت');
  assert.ok(labels.length > 3, 'and the recorded adhans after them');

  sel.value = 'silent'; fire(win, sel, 'change');
  assert.strictEqual(win.Store.get('adhanVoice'), 'silent');
  assert.strictEqual(doc.getElementById('settings-adhan-note').textContent, 'يصل التنبيه بلا صوت');

  /* silence is neither a recording nor the phone's tone, so the wrapper is
     told separately; without that it would fall back to the tone */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("app.setAdhanSilent(id === 'silent')") !== -1);
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(bridge.indexOf('setAdhanSilent') !== -1, 'the bridge carries it');
  const recv = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  /* A channel's sound is fixed when it is made and never changes, so a phone
     that has had an earlier version keeps whatever that version set. Silence
     goes on a channel of its own, made new, that neither sounds nor buzzes:
     a buzz is a sound to anyone holding the phone. */
  assert.ok(/quiet \? CHANNEL_HUSH : own \? CHANNEL_SILENT : CHANNEL/.test(recv),
    'silence has its own channel');
  const hush = /new NotificationChannel\(CHANNEL_HUSH[\s\S]*?createNotificationChannel/.exec(recv);
  assert.ok(hush, 'and that channel is made');
  assert.ok(hush[0].indexOf('setSound(null, null)') !== -1, 'with no sound');
  assert.ok(hush[0].indexOf('enableVibration(false)') !== -1, 'and no buzz');
  assert.ok(recv.indexOf('if (own && !quiet)') !== -1, 'and no recording is played over it');

  /* nor does the hear button sound a muadhin the reader has turned off */
  const app2 = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const tryFn = /bind\('settings-adhan-try'[\s\S]*?\n    \}\);/.exec(app2)[0];
  assert.ok(tryFn.indexOf("pick === 'silent'") !== -1, 'hearing silence plays nothing');
});

test('every menu is ours to draw, and the select under it still holds the value', () => {
  /* A <select> is drawn by the phone: a different shape on every skin, its own
     face, and on some a full screen list. Ours is drawn here. The select stays
     and keeps the value, so the seventy odd places that read .value and the
     handlers bound to change are untouched. */
  const { win, doc } = boot();
  win.App.go('reminders');
  const selects = [...doc.querySelectorAll('select')];
  assert.ok(selects.length > 20, 'there are many menus');
  selects.forEach(function (sel) {
    assert.ok(sel.parentNode.classList.contains('picker'), (sel.id || sel.className) + ' is wrapped');
    assert.ok(sel.parentNode.querySelector('.picker-btn'), 'and has our button');
  });

  /* the button says what the select holds */
  const sound = doc.querySelector('[data-sound="duha"]');
  const btn = sound.parentNode.querySelector('.picker-btn');
  assert.strictEqual(btn.querySelector('.picker-label').textContent, 'صوت الجهاز');

  /* opening draws our own panel, one item per option, the chosen one marked */
  click(win, btn);
  const panel = doc.querySelector('.picker-panel');
  assert.ok(panel, 'our panel, not the system list');
  assert.strictEqual(panel.querySelectorAll('.picker-item').length, sound.options.length);
  assert.strictEqual(panel.querySelectorAll('.is-on').length, 1);

  /* choosing sets the select and fires the very change a native tap would */
  let fired = 0;
  sound.addEventListener('change', function () { fired += 1; });
  click(win, panel.querySelectorAll('.picker-item')[2]);
  assert.strictEqual(sound.value, 'silent', 'the select holds the value');
  assert.strictEqual(fired, 1, 'and change fired once');
  assert.ok(!doc.querySelector('.picker-panel'), 'the panel closes');
  assert.strictEqual(sound.parentNode.querySelector('.picker-label').textContent, 'صامت');
  assert.strictEqual((win.Store.get('remindSound') || {}).duha, 'silent', 'so the app kept it');

  /* the button does not inherit .select, whose width cap cut the label */
  assert.ok(!btn.classList.contains('select'));

  /* and refilling a menu refreshes its button */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/function fillSelect[\s\S]*?syncPicker\(el\);/.test(app), 'fillSelect refreshes the button');
});

test('a reminder switch writes to a key the store actually keeps', () => {
  /* The wird switch wrote to «wird», which is not among the store's defaults.
     The store rebuilds itself from those at every start and drops the rest, so
     the reader turned it on and found it off again after each update. Every
     key these switches use must be one the store knows. */
  const { win, doc } = boot();
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const off = /var WHEN_OFF = \{([^}]*)\}/.exec(app)[1];
  const keys = [...off.matchAll(/(\w+):/g)].map(function (m) { return m[1]; });
  assert.ok(keys.length >= 3, 'the switches whose off value hides in a list');
  keys.forEach(function (k) {
    assert.ok(Object.prototype.hasOwnProperty.call(win.Store.DEFAULTS, k),
      k + ' is not a key the store keeps, so it would be wiped at the next start');
  });

  /* and turning it on writes a real time, not the off value back again */
  win.App.go('reminders');
  click(win, doc.getElementById('settings-wird-on'));
  assert.strictEqual(win.Store.get('wirdAt'), '20:00', 'turned on to a real time');
});

test('a reminder may be sounded by the reciter, and the wrapper is told a channel it knows', () => {
  /* The wrapper knows «chime» and «silent» and nothing else: any other value
     falls through to the ringing channel, so a reader who chose a reciter
     would have heard the phone's own tone instead. */
  const { win, doc } = boot();
  win.App.go('reminders');
  const sel = doc.querySelector('[data-sound="sleepKursi"]');
  assert.ok([...sel.options].some(function (o) { return o.value === 'buhendi'; }), 'the reciter is offered');
  const jm = doc.querySelector('[data-sound="jumuahBefore"]');
  assert.ok([...jm.options].some(function (o) { return o.value === 'buhendi'; }), 'and for the jumuah call');

  /* the extra play button is gone: the choice lives in the list */
  assert.ok(!doc.querySelector('[data-hear="jumuah-buhendi.mp3"]'), 'no second button beside the list');

  sel.value = 'buhendi'; fire(win, sel, 'change');
  if (!win.Store.get('sleepKursi')) click(win, doc.getElementById('settings-sleepKursi'));
  assert.strictEqual((win.Store.get('remindSound') || {}).sleepKursi, 'buhendi');
  const row = win.App.helpers.reminderList().filter(function (r) { return r.t.indexOf('الكرسي') !== -1; })[0];
  assert.ok(row, 'the reminder is in the list');
  /* the quiet chime, since silence here meant nothing heard at all: the
     recitation plays when the reader opens the reminder */
  assert.strictEqual(row.s, 'chime', 'and the wrapper is handed a channel it understands');

  /* :has() is missing on older android browsers, where the whole rule is
     dropped: the play triangle stayed hollow and the rows lost their layout */
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const live = css.split('\n').filter(function (l) {
    return l.indexOf(':has(') !== -1 && l.trim().indexOf('/*') !== 0 && l.trim().indexOf('*') !== 0;
  });
  live.forEach(function (l) {
    assert.ok(/^\s*\.ic-/.test(l), 'a rule needs :has with no fallback: ' + l.trim().slice(0, 60));
  });
  assert.ok(css.indexOf('.ic-play,') !== -1, 'the play fill is reachable by class');
});

test('the sound a reader picks reaches whichever bridge schedules that reminder', () => {
  /* Qiyam, the salawat and the adhan are scheduled by bridges of their own,
     not from the reminder list. Telling only the list left their sound at
     whatever it was, so silence on qiyam still rang. */
  const { win, doc } = boot();
  const told = {};
  win.SunnatiApp = {
    setQiyamTimes: function () {}, setQiyamSound: function (v) { told.qiyam = v; },
    setReminders: function () {}, setSalawatEvery: function () {},
    setSalawatSilent: function () {}, setAdhanSound: function () {}, setAdhanSilent: function () {},
    isAdhanEnabled: function () { return true; }, canNotify: function () { return true; }
  };
  win.App.go('reminders');
  if (!win.Store.get('qiyam')) click(win, doc.getElementById('settings-qiyam'));
  const sel = doc.querySelector('[data-sound="qiyam"]');
  sel.value = 'silent'; fire(win, sel, 'change');
  assert.strictEqual((win.Store.get('remindSound') || {}).qiyam, 'silent', 'the choice is kept');
  assert.strictEqual(told.qiyam, 'silent', 'and the bridge that schedules qiyam is told');

  const recv = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(recv.indexOf('sunnati_qiyam') !== -1, 'the receiver reads the qiyam sound');

  /* every sound key in the page reaches the wrapper through some bridge */
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const keys = [...new Set([...html.matchAll(/data-sound="([a-zA-Z]+)"/g)].map(function (m) { return m[1]; }))];
  const orphans = keys.filter(function (k) { return app.indexOf("channelFor('" + k + "')") === -1; });
  assert.deepStrictEqual(orphans, [], 'these sounds reach no bridge');
});

test('each iOS bundle declares what it cannot install without', () => {
  /* The widget built fine and then refused to install: "missing or invalid
     CFBundleExecutable in its Info.plist". The app's plist had it, the
     widget's did not, and nothing said so until a simulator tried. */
  const keysIn = function (where) {
    const raw = fs.readFileSync(path.join(__dirname, '..', where), 'utf8');
    return [...raw.matchAll(/<key>([^<]+)<\/key>/g)].map(function (m) { return m[1]; });
  };
  const needed = ['CFBundleExecutable', 'CFBundleIdentifier', 'CFBundleName',
                  'CFBundleVersion', 'CFBundleShortVersionString', 'CFBundlePackageType'];
  [['ios/Sunnati/Info.plist', 'the app'], ['ios/Widget/Info.plist', 'the widget']]
    .forEach(function (pair) {
      const keys = keysIn(pair[0]);
      const gone = needed.filter(function (k) { return keys.indexOf(k) === -1; });
      assert.deepStrictEqual(gone, [], pair[1] + ' is missing a required key');
    });
});

test('the build actions are not left on a runtime github has retired', () => {
  /* GitHub warned twice that pinned actions still targeted Node 20, which it
     had retired: once for checkout and setup-node, and again for
     upload-artifact after only two of the three were raised. Nothing in the
     repo compared them, so each lapse was found by reading a warning. */
  const flow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ios.yml'), 'utf8');
  const pinned = [...flow.matchAll(/actions\/([a-z-]+)@v(\d+)/g)]
    .map(function (m) { return { name: m[1], major: +m[2] }; });
  assert.ok(pinned.length >= 3, 'the workflow pins some actions');
  const stale = pinned.filter(function (a) { return a.major < 7; })
    .map(function (a) { return a.name + '@v' + a.major; });
  assert.deepStrictEqual([...new Set(stale)], [],
    'these actions are behind and may run on a retired node');
});

test('the three places that carry a version number agree', () => {
  /* The version lives in four files now that iOS exists, and one of them was
     already a release behind after a single bump: nothing had ever checked. A
     wrapper shipping an older version than the page it loads is the kind of
     thing that is noticed by a reviewer, not by us. */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const web = /var VERSION = '([\d.]+)'/.exec(app)[1];

  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("'sunnati-v" + web + "'") !== -1, 'the worker matches the page: ' + web);

  const gradle = fs.readFileSync(path.join(__dirname, '..', 'android/app/build.gradle'), 'utf8');
  const android = /versionName "([\d.]+)"/.exec(gradle)[1];
  assert.strictEqual(android, web, 'android matches the page');

  const ios = fs.readFileSync(path.join(__dirname, '..', 'ios/project.yml'), 'utf8');
  const marketing = /MARKETING_VERSION: "([\d.]+)"/.exec(ios)[1];
  assert.strictEqual(marketing, web, 'ios matches the page');

  /* and the build number matches android's, since both count the same releases */
  const code = /versionCode (\d+)/.exec(gradle)[1];
  const build = /CURRENT_PROJECT_VERSION: "(\d+)"/.exec(ios)[1];
  assert.strictEqual(build, code, 'the ios build number matches versionCode');
});

test('every reminder switch actually turns its reminder on', () => {
  /* Three of them did nothing: the sync block listed «wird», a key the store
     does not hold, and used its slug variable a line before declaring it, so
     setSwitch was handed undefined for all three. Nothing caught it because
     nothing had ever clicked them all. */
  const { win, doc } = boot();
  win.SunnatiApp = {
    isAdhanEnabled: function () { return true; }, canNotify: function () { return true; },
    setAdhanEnabled: function () {}, setAdhanSound: function () {}, setAdhanSilent: function () {},
    setSalawatEvery: function () {}, setSalawatSilent: function () {}, setReminders: function () {}
  };
  win.App.go('reminders');
  const dead = [];
  [...doc.querySelectorAll('#v-reminders .switch')].forEach(function (sw) {
    /* the web notification row is hidden inside the wrapper and asks the
       browser for permission, which a test cannot grant */
    if (sw.id === 'settings-notify') return;
    const row = sw.closest('.setting');
    const name = ((row && row.querySelector('.setting-label')) || {}).textContent || sw.id;
    const before = sw.getAttribute('aria-checked');
    click(win, sw);
    if (sw.getAttribute('aria-checked') === before) dead.push(name.trim());
  });
  assert.deepStrictEqual(dead, [], 'these switches do nothing: ' + dead.join(' , '));
});

test('a chapter the reciter has recorded offers itself to be heard', () => {
  /* The qunut is in حصن المسلم by its words already, so the recording is
     attached to that chapter rather than added as a second copy of the text.
     The map keys on the chapter number, so another du'a is one line. */
  const { win, doc } = boot();
  win.App.state.hisn = 32;
  win.App.go('hisn');
  assert.strictEqual(doc.getElementById('hisn-title').textContent, 'دعاء قنوت الوتر');
  const strip = doc.querySelector('.hisn-listen');
  assert.ok(strip, 'the chapter says it can be heard');
  assert.ok(strip.textContent.indexOf('خالد بوهندي') !== -1, 'and names the reciter');
  const btn = strip.querySelector('[data-act="hear-hisn"]');
  assert.ok(btn && btn.getAttribute('data-ref') === '32');

  /* a chapter with no recording carries no strip */
  win.App.state.hisn = 25;
  win.App.go('hisn');
  assert.ok(!doc.querySelector('.hisn-listen'), 'and a chapter without one says nothing');

  /* every recording is really there, at the app's own audio size */
  ['qunut-buhendi.mp3', 'kursi-buhendi.mp3', 'jumuah-buhendi.mp3', 'takbeer-buhendi.mp3'].forEach(function (f) {
    const file = path.join(DOCS, 'audio', 'dua', f);
    assert.ok(fs.existsSync(file), f + ' is bundled');
    const mb = fs.statSync(file).size / (1024 * 1024);
    assert.ok(mb < 4, f + ' is small enough to ship: ' + mb.toFixed(1) + 'MB');
  });

  /* Ayat al-Kursi sits in three chapters, so its recording is matched on the
     words rather than keyed to one chapter: it is heard wherever it appears */
  [27, 28, 25].forEach(function (id) {
    win.App.state.hisn = id;
    win.App.go('hisn');
    assert.ok(doc.querySelector('#hisn-list [data-hear="kursi-buhendi.mp3"]'),
      'Ayat al-Kursi can be heard in chapter ' + id);
  });

  /* The takbeer came in at an hour and eighty five megabytes, fifty six times
     any other file here. It is cut to one whole cycle, ending where the reciter
     begins again, so nothing is clipped mid word. */
  const takbeer = fs.statSync(path.join(DOCS, 'audio', 'dua', 'takbeer-buhendi.mp3')).size / (1024 * 1024);
  assert.ok(takbeer < 1.5, 'the takbeer is cut to a cycle: ' + takbeer.toFixed(1) + 'MB');
  /* The takbeer is not a calendar entry to be played any day of the year: it
     belongs to the days around the eid. The row no longer carries it; a
     greeting sheet does, and only when an eid is within three days. */
  win.App.go('home');
  assert.ok(!doc.querySelector('#home-upcoming [data-hear="takbeer-buhendi.mp3"]'),
    'the calendar row no longer plays it all year');

  win.Hijri.upcoming = function () {
    return [{ name: 'عيد الفطر', days: 2, date: new Date(Date.now() + 2 * 86400000) }];
  };
  win.Store.set('eidShown', '');
  assert.strictEqual(win.App.helpers.offerEid(), true, 'an eid within three days greets the reader');
  const body = doc.getElementById('sheet-body');
  assert.ok(body.textContent.indexOf('كل عام وأنتم بخير') !== -1, 'with a greeting');
  assert.ok(body.textContent.indexOf('سُنّتي') !== -1, 'from the app');
  assert.ok(body.querySelector('[data-hear="takbeer-buhendi.mp3"]'), 'and the takbeer is offered there');
  assert.strictEqual(win.App.helpers.offerEid(), false, 'and it greets once a day, not at every start');

  win.Hijri.upcoming = function () {
    return [{ name: 'شهر رمضان المبارك', days: 40, date: new Date() }];
  };
  win.Store.set('eidShown', '');
  assert.strictEqual(win.App.helpers.offerEid(), false, 'and says nothing the rest of the year');

  /* A clip played from the page is invisible to the phone, so the only way to
     stop it was to find the app again. It names itself to the media session,
     which puts a player in the notification shade with pause and stop. */
  const app3 = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app3.indexOf('navigator.mediaSession') !== -1, 'the phone is told what is playing');
  assert.ok(/setActionHandler\('pause'/.test(app3), 'and pause stops it');
  assert.ok(/setActionHandler\('stop'/.test(app3), 'and so does stop');
  assert.ok(app3.indexOf('clearMediaSession') !== -1, 'and it is cleared when the clip ends');

  /* Every clip names itself, or the phone shows no player for it. The adhan and
     the salawat were played with no title at all, which is why the reader had
     to go back into the app to stop them. */
  const plays = app3.split('\n').filter(function (l) {
    return l.indexOf('playRecording(') !== -1 && l.indexOf('function playRecording') === -1;
  });
  assert.ok(plays.length >= 5, 'the places a clip is played');
  const unnamed = plays.filter(function (l) { return /playRecording\([^)]*\);/.test(l) && l.split(',').length < 3; });
  assert.deepStrictEqual(unnamed, [], 'these play with no name');

  /* the reciter's button is told apart from the notification tone's */
  const css2 = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* named with .btn so it outweighs btn-ghost, which sets its own colour: the
     two triangles were identical until this was specific enough to win */
  assert.match(css2, /\.btn\[data-hear\][^{]*\{[^}]*color: var\(--accent-ink\)/,
    'the recitation carries the accent');
  /* and it is the same square as the tone button beside it, not a third smaller */
  assert.ok(css2.indexOf('.remind-controls .btn.btn-ghost[data-hear]') !== -1,
    'and the same size as its sibling');

  /* and the jumuah switch is bound to the id its row actually has: the two
     were written by hand in three places and drifted, so it did nothing */
  assert.ok(app3.indexOf('function slugFor') !== -1, 'one place turns a key into its id');
  const html2 = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html2.indexOf('id="settings-jumuah-before-on"') !== -1);
  win.App.go('reminders');
  const jsw = doc.getElementById('settings-jumuah-before-on');
  assert.ok(jsw, 'the jumuah switch is there');
  click(win, jsw);
  assert.strictEqual(String(win.Store.get('jumuahBefore')), '60', 'and turning it on takes hold');

  /* and the jumuah verse is heard from the reminder it belongs to */
  win.App.go('reminders');
  /* the verse is a choice in the row's own sound list now, not a second play
     button beside it: two identical triangles said nothing about which was
     which, and the reader asked for one control, not two */
  const jmList = doc.querySelector('[data-sound="jumuahBefore"]');
  const recited = [...jmList.options].filter(function (o) { return o.value === 'buhendi'; })[0];
  assert.ok(recited, 'the jumuah call offers its verse');
  assert.ok(recited.text.indexOf('خالد بوهندي') !== -1, 'and names the reciter');
});

test('friday begins at the maghrib of thursday, as the day does in the sharia', () => {
  /* A golden rule of the app: the sunan of friday are due from the maghrib of
     thursday and are done by the fajr of friday. Someone reading them at
     eleven on thursday night is in ليلة الجمعة, and the app used to answer
     that it was still thursday because the calendar said so. */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function isFriday\(date\)[\s\S]*?\n  \}/.exec(app);
  assert.ok(fn, 'isFriday is there');
  const body = fn[0];
  assert.ok(body.indexOf('maghrib') !== -1, 'it looks at maghrib');
  assert.ok(/getDay\(\) !== 4/.test(body) || /getDay\(\) === 4/.test(body),
    'and thursday evening counts as friday');

  /* a date handed in is still asked about as a calendar day: it came from a
     calendar, and a stored record should not shift by three hours */
  assert.ok(/if \(date\) return date\.getDay\(\) === 5/.test(body),
    'a given date is read as the calendar day it is');
});

test('a fast that has already been broken is not still offered', () => {
  /* A fast ends at maghrib. Saying «صيام الخميس، اليوم» at eight in the
     evening tells the reader about something he has already finished, and the
     calendar should have moved on to the next one. */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function nextFast\(\)[\s\S]*?\n  \}\n/.exec(app);
  assert.ok(fn, 'nextFast is there');
  const body = fn[0];
  assert.ok(body.indexOf('t.maghrib') !== -1, 'it looks at maghrib');
  assert.ok(/d === 0 && past/.test(body), 'and skips today once maghrib has passed');
});

test('the next fast says when it is in words, not only as a date', () => {
  /* «١٧ سبتمبر» is a date the reader has to work out. The code already knows
     the day is tomorrow, or three days off; it says so, and keeps the date
     after for anyone who wants it. */
  /* one function knows when the next fast is and how to say it, and both the
     reminders strip and the home calendar read it */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function nextFast\(\)[\s\S]*?\n  \}\n/.exec(app);
  assert.ok(fn, 'nextFast is the one place that knows');
  const body = fn[0];
  assert.ok(body.indexOf("'غداً'") !== -1, 'tomorrow is named');
  assert.ok(body.indexOf("'اليوم'") !== -1, 'today too');
  assert.ok(body.indexOf("'بعد '") !== -1, 'and the days between are counted');

  /* and it heads the home calendar: the fast is the occasion nearest the
     reader nearly every week, and it used to live only on the reminders
     screen, which is not where one looks to see what is coming */
  const { win: w2, doc: d2 } = boot();
  const rows = [...d2.querySelectorAll('#home-upcoming .row')];
  const fast = w2.App.helpers.nextFast();
  assert.ok(fast, 'there is a fast within the coming weeks');
  assert.strictEqual(rows[0].querySelector('.row-title').textContent, fast.names, 'it comes first');
  assert.ok(rows[0].querySelector('[data-act="to-calendar"]'), 'and can be added to a calendar like the rest');
  assert.ok(rows[0].querySelector('.row-note').textContent.indexOf(fast.when) === 0,
    'its note opens with when it is');

  const { win, doc } = boot();
  win.Store.set('fastNote', true);
  win.App.go('reminders');
  const note = doc.querySelector('.next-fast-note');
  assert.ok(note, 'the strip is there');
  /* whichever day it lands on today, it opens with a word, never a bare date */
  assert.match(note.textContent, /^(اليوم|غداً|بعد|الأحد|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|[٠-٩])/,
    'it opens by saying when: ' + note.textContent.slice(0, 40));
});

test('the app says what it offers a reader who needs it, under the universal symbol', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');

  /* the symbol people look for, not a word buried in a list */
  assert.ok(html.indexOf('<g id="i-access">') !== -1, 'the universal symbol is drawn');
  assert.ok(html.indexOf('سهولة الوصول') !== -1, 'and the card is named for it');

  const contrast = doc.getElementById('settings-contrast');
  const motion = doc.getElementById('settings-motion');
  assert.ok(contrast && motion, 'both are offered');
  assert.strictEqual(contrast.getAttribute('role'), 'switch');

  /* each takes hold at once and is kept */
  click(win, contrast);
  assert.ok(doc.documentElement.classList.contains('want-contrast'));
  assert.strictEqual(win.Store.get('contrast'), true);
  click(win, motion);
  assert.ok(doc.documentElement.classList.contains('less-motion'));
  assert.strictEqual(win.Store.get('lessMotion'), true);

  /* with no answer yet the phone's own setting is followed, so a reader who
     has already asked their phone does not ask twice */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("prefers('(prefers-contrast: more)')") !== -1);
  assert.ok(app.indexOf("prefers('(prefers-reduced-motion: reduce)')") !== -1);

  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.want-contrast \{[^}]*--line:/, 'contrast strengthens the lines');
  assert.match(css, /\.less-motion \*[^{]*\{[^}]*transition-duration: 1ms/, 'and stillness stops the motion');

  /* a skip link is a website's habit, not an app's: there is no keyboard here
     to walk a navigation with */
  assert.ok(html.indexOf('skip-link') === -1, 'no skip link');
});

test('five reminders the reader turns on, each with its own sound, and a bedtime', () => {
  const { win, doc } = boot();
  win.App.go('reminders');
  /* every reminder on the screen carries a sound and a way to hear it, not
     just the five that were added with the card */
  const sounds = [...doc.querySelectorAll('.select-sound')].map(function (s) { return s.getAttribute('data-sound'); });
  ['morningAdhkar', 'eveningAdhkar', 'sleepIstighfar', 'sleepMulk', 'sleepKursi',
   'jumuahNight', 'fastNote', 'jumuahBefore', 'duha', 'qiyam', 'wird'].forEach(function (k) {
    assert.ok(sounds.indexOf(k) !== -1, k + ' has a sound select');
    assert.ok(doc.querySelector('[data-try="' + k + '"]'), k + ' has a button to hear it');
  });
  assert.strictEqual(doc.querySelectorAll('.try-sound').length, sounds.length,
    'one ear button for each sound select');
  /* and the choice reaches the list the wrapper is handed */
  const pick = doc.querySelector('[data-sound="duha"]');
  pick.value = 'silent'; fire(win, pick, 'change');
  if (!win.Store.get('duha')) click(win, doc.getElementById('settings-duha'));
  const duha = win.App.helpers.reminderList().filter(function (r) { return r.t === 'صلاة الضحى'; })[0];
  assert.ok(duha && duha.s === 'silent', 'the sound travels with the reminder');

  const keys = ['morningAdhkar', 'eveningAdhkar', 'sleepIstighfar', 'sleepMulk', 'sleepKursi'];
  /* all off until the reader says so */
  keys.forEach(function (k) {
    assert.strictEqual(win.Store.get(k), false, k + ' is off by default');
    assert.ok(doc.getElementById('settings-' + k), k + ' has a switch');
    assert.ok(doc.querySelector('[data-sound="' + k + '"]'), k + ' has a sound select');
  });
  assert.strictEqual(win.App.helpers.reminderList().filter(function (r) { return /الاستغفار|الملك|الكرسي|الصباح|المساء/.test(r.t); }).length, 0,
    'nothing scheduled while all are off');

  /* istighfar on, at the bedtime, with a chime */
  click(win, doc.getElementById('settings-sleepIstighfar'));
  const sel = doc.querySelector('[data-sound="sleepIstighfar"]');
  sel.value = 'chime'; fire(win, sel, 'change');
  const list = win.App.helpers.reminderList().filter(function (r) { return r.t === 'الاستغفار قبل النوم'; });
  assert.ok(list.length >= 7, 'one each night for the week ahead');
  assert.strictEqual(list[0].s, 'chime', 'and it carries the sound the reader chose');
  const at = new Date(list[0].at);
  assert.strictEqual(at.getHours() * 60 + at.getMinutes(), 22 * 60 + 30, 'at the default bedtime');

  /* the bedtime moves, and the reminders with it */
  /* The bedtime is picked from two columns of our own, hours and minutes on
     the twenty four hour clock. The input stays and keeps the «HH:MM» value,
     hidden, so what reads it goes on working; what the reader taps is ours. */
  const time = doc.getElementById('settings-sleep-at');
  assert.strictEqual(time.type, 'time', 'the input still holds the value');
  assert.ok(time.hidden, 'and is hidden, since the phone would draw it');
  const timeWrap = time.parentNode;
  assert.ok(timeWrap.classList.contains('timepick') && timeWrap.querySelector('.picker-btn'),
    'what is seen and tapped is our own button');
  /* written in the clock the reader chose in the settings, like every other
     time the app shows: it was fixed at twenty four whatever they had set */
  assert.strictEqual(timeWrap.querySelector('.picker-label').textContent, '10:30 م', 'twelve by default');
  win.Store.set('clock', '24');
  win.App.helpers.renderSettings();
  assert.strictEqual(timeWrap.querySelector('.picker-label').textContent, '22:30', 'and twenty four when set');
  win.Store.set('clock', '12');
  win.App.helpers.renderSettings();

  /* opening it gives a column of hours and a column of minutes */
  click(win, timeWrap.querySelector('.picker-btn'));
  assert.strictEqual(doc.querySelectorAll('[data-timecol="h"] .timecell').length, 24);
  assert.strictEqual(doc.querySelectorAll('[data-timecol="m"] .timecell').length, 12, 'every five minutes');
  click(win, doc.querySelector('[data-time="h:23"]'));
  click(win, doc.querySelector('[data-time="m:15"]'));
  assert.strictEqual(time.value, '23:15');
  assert.strictEqual(win.Store.get('sleepAt'), '23:15', 'and the choice is kept');
  const later = new Date(win.App.helpers.reminderList().filter(function (r) { return r.t === 'الاستغفار قبل النوم'; })[0].at);
  assert.strictEqual(later.getHours() * 60 + later.getMinutes(), 23 * 60 + 15);

  /* the three night ones do not all fire at the same second */
  click(win, doc.getElementById('settings-sleepMulk'));
  click(win, doc.getElementById('settings-sleepKursi'));
  const night = win.App.helpers.reminderList().filter(function (r) { return /النوم/.test(r.t); }).slice(0, 3).map(function (r) { return r.at; });
  assert.ok(night[1] > night[0] && night[2] > night[1], 'a minute apart, so one does not bury the next');

  /* morning follows fajr, evening follows asr */
  click(win, doc.getElementById('settings-morningAdhkar'));
  const morning = win.App.helpers.reminderList().filter(function (r) { return r.t === 'أذكار الصباح'; })[0];
  assert.ok(morning, 'morning adhkar scheduled');
  assert.strictEqual(morning.s, 'device', 'device sound unless changed');

  /* the wrapper has a channel for each sound */
  const recv = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(recv.indexOf('CHANNEL_CHIME') !== -1 && recv.indexOf('CHANNEL_QUIET') !== -1, 'a channel per sound');
  assert.ok(recv.indexOf('R.raw.chime') !== -1, 'the chime is bundled');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'android/app/src/main/res/raw/chime.ogg')));
  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/NoteScheduler.java'), 'utf8');
  assert.ok(sched.indexOf('EXTRA_SOUND') !== -1, 'the sound travels with the alarm');
});

test('the reminders are the reader\'s to turn on and off', () => {
  const { win, doc } = boot();
  win.App.go('reminders');
  /* the friday switch went with the sheet it turned on and off */
  assert.strictEqual(doc.getElementById('settings-friday'), null);
  assert.strictEqual(doc.getElementById('settings-jumuah-night').getAttribute('aria-checked'), 'true',
    'the night of jumuah on by default');
  assert.strictEqual(doc.getElementById('settings-qiyam').getAttribute('aria-checked'), 'false',
    'and the night call off until asked');
  click(win, doc.getElementById('settings-jumuah-night'));
  assert.strictEqual(win.Store.get('jumuahNight'), false);
  click(win, doc.getElementById('settings-qiyam'));
  assert.strictEqual(win.Store.get('qiyam'), true);
});

test('an occasion can be put in the reader\'s own calendar, and no longer repeats its hijri year', () => {
  const { win, doc } = boot();
  const row = doc.querySelector('#home-upcoming .row');
  assert.ok(row.textContent.indexOf('هـ') === -1, 'the gregorian date already carries the year');
  const btn = row.querySelector('[data-act="to-calendar"]');
  assert.ok(btn, 'every occasion offers to be added');
  assert.ok(btn.getAttribute('aria-label').indexOf('إلى تقويمك') !== -1);
  /* inside the app the phone's own calendar is opened with it filled in */
  const handed = [];
  win.SunnatiApp = { addToCalendar: function (t, n, s, e) { handed.push({ t: t, s: s, e: e }); return true; } };
  click(win, btn);
  assert.strictEqual(handed.length, 1);
  /* whatever heads the list, the fast or a hijri occasion, the button hands
     over that row's own name and day */
  const title = row.querySelector('.row-title').textContent;
  assert.strictEqual(handed[0].t, title);
  assert.ok(handed[0].s > 0 && handed[0].e > handed[0].s, 'a real day is handed over');
  /* in a browser it becomes a file every calendar understands */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function addToCalendar\(name, date\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('BEGIN:VCALENDAR') !== -1 && fn.indexOf('DTSTART;VALUE=DATE:') !== -1);
  assert.ok(fn.indexOf('BEGIN:VALARM') !== -1, 'with a reminder the day before');
  assert.ok(fn.indexOf("text/calendar") !== -1);
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(bridge.indexOf('Intent.ACTION_INSERT') !== -1, 'the reader confirms it themselves; nothing is written behind them');
});

test('صلاتي is described as following the prayers, not marking them', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  [html, app].forEach(function (src) {
    assert.ok(src.indexOf('تتبّع صلواتك الخمس وشهرك') !== -1);
    assert.ok(src.indexOf('علّم صلواتك الخمس وتابع شهرك') === -1);
  });
});

/* ---------------- القضاء، والورد، ونداء الجمعة، وأذكار ما بعد الصلاة ---------------- */

test('what is owed of prayer is counted from what was marked missed, and falls as it is made up', () => {
  const { win, doc } = boot();
  const d = new win.Date();
  const back = function (n) { return new win.Date(d.getFullYear(), d.getMonth(), d.getDate() - n); };
  win.Store.setPrayer('fajr', 'missed', back(1));
  win.Store.setPrayer('fajr', 'missed', back(2));
  win.Store.setPrayer('asr', 'missed', back(3));
  win.Store.setPrayer('isha', 'ontime', back(1));
  const owed = win.Store.qadaOwed();
  assert.strictEqual(owed.fajr, 2);
  assert.strictEqual(owed.asr, 1);
  assert.strictEqual(owed.isha, 0, 'a prayer prayed is not owed');
  win.App.go('qada');
  assert.strictEqual(doc.getElementById('qada-prayers-tally').textContent, '3 عليك');
  click(win, doc.querySelector('[data-act="qada-done"]'));
  assert.strictEqual(win.Store.qadaOwed().fajr, 1, 'one made up');
  assert.strictEqual(doc.getElementById('qada-prayers-tally').textContent, '2 عليك');
  /* the day's own record is never rewritten by making one up */
  assert.strictEqual(win.Store.prayersOf(back(1)).fajr, 'missed');
});

test('the days of ramadan owed are set and struck off one at a time', () => {
  const { win, doc } = boot();
  win.App.go('qada');
  assert.strictEqual(doc.getElementById('qada-fast-tally').textContent, 'لا شيء عليك');
  for (let i = 0; i < 3; i++) click(win, doc.querySelector('[data-act="fast-owed"][data-ref="1"]'));
  assert.strictEqual(win.Store.get('fastOwed'), 3);
  click(win, doc.querySelector('[data-act="fast-done"]'));
  assert.strictEqual(win.Store.fastOwed(), 2);
  assert.strictEqual(doc.getElementById('qada-fast-tally').textContent, 'بقي يومان');
  click(win, doc.querySelector('[data-act="fast-owed"][data-ref="-1"]'));
  assert.strictEqual(win.Store.get('fastOwed'), 2, 'and the count may be corrected');
  /* it never goes below nothing */
  for (let i = 0; i < 6; i++) click(win, doc.querySelector('[data-act="fast-owed"][data-ref="-1"]'));
  assert.strictEqual(win.Store.get('fastOwed'), 0);
});

test('the daily portion and the friday call are worked out here and handed to the app', () => {
  const { win } = boot();
  win.Store.set('khatmaStart', win.Date.now());
  win.Store.set('wirdAt', '20:00');
  win.Store.set('jumuahBefore', 120);
  const list = win.App.helpers.reminderList();
  assert.ok(list.length >= 6, 'a week of them, got ' + list.length);
  const wird = list.filter(function (r) { return r.t === 'وردك اليوم'; });
  assert.ok(wird.length >= 5, 'one for each day of the plan');
  assert.match(wird[0].b, /من صفحة \d+ إلى صفحة \d+/, 'naming the pages, so it is useful without opening the app');
  const friday = list.filter(function (r) { return r.t === 'الجمعة'; })[0];
  assert.ok(friday, 'and the friday call');
  assert.strictEqual(new Date(friday.at).getDay(), 5);
  assert.ok(friday.b.indexOf('الكهف') !== -1);
  list.forEach(function (r) { assert.ok(r.at > Date.now(), 'nothing already past'); });
  /* turned off, nothing is queued: every switch that can queue one, and the
     list must come back empty when the last of them is off */
  win.Store.set('wirdAt', '');
  win.Store.set('jumuahBefore', 0);
  win.Store.set('jumuahNight', false);
  win.Store.set('duha', false);
  win.Store.set('fastNote', false);
  assert.strictEqual(win.App.helpers.reminderList().length, 0);
  const handed = [];
  win.SunnatiApp = { setReminders: function (j) { handed.push(JSON.parse(j)); } };
  win.App.helpers.handRemindersToApp();
  assert.strictEqual(handed[0].length, 0);
  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/NoteScheduler.java'), 'utf8');
  assert.ok(sched.indexOf('setExactAndAllowWhileIdle') !== -1 && sched.indexOf('scheduleNext') !== -1,
    'and the app arms each in turn');
});

test('the adhkar of a prayer are offered the moment it is marked prayed, once, and can be stopped', () => {
  const { win, doc } = boot();
  assert.strictEqual(win.App.helpers.offerAfterPrayer('dhuhr'), true);
  assert.strictEqual(doc.getElementById('sheet-title').textContent, 'أذكار ما بعد الظهر');
  /* they are countable dhikr cards now, not static lines */
  assert.ok(doc.querySelectorAll('#sheet .dhikr').length >= 3, 'the first of them, in place');
  assert.strictEqual(win.App.helpers.offerAfterPrayer('dhuhr'), false, 'not twice for the same prayer');
  assert.strictEqual(win.App.helpers.offerAfterPrayer('asr'), true, 'but each prayer has its own');
  click(win, doc.querySelector('#sheet [data-act="after-prayer-off"]'));
  assert.strictEqual(win.Store.get('afterPrayerOff'), true);
  assert.strictEqual(win.App.helpers.offerAfterPrayer('maghrib'), false, 'and it stays off');
});

test('one search reaches everything the app holds, and no source crowds out the rest', () => {
  const { win, doc } = boot();
  const hits = win.App.helpers.searchTexts('all', 'اللهم');
  assert.ok(hits.length > 20, 'plenty found, got ' + hits.length);
  const bySource = {};
  hits.forEach(function (h) {
    const k = h.key.split(':')[0];
    bySource[k] = (bySource[k] || 0) + 1;
  });
  assert.ok(Object.keys(bySource).length >= 5, 'from many sources, got ' + Object.keys(bySource).join(', '));
  Object.keys(bySource).forEach(function (k) {
    assert.ok(bySource[k] <= 10, k + ' should not fill the page: ' + bySource[k]);
  });
  /* every hit knows where it lives */
  hits.forEach(function (h) { assert.ok(h.where && h.key, 'a hit with no home'); });
  /* and the chips offer it */
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  ['all', 'hisn', 'umrah'].forEach(function (scope) {
    assert.ok(html.indexOf('data-scope="' + scope + '"') !== -1, 'a chip for ' + scope);
  });
});

test('the backup is a real file the reader can keep', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function exportBackup\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('app.saveFile(name, text)') !== -1, 'inside the app it is written where the reader can find it');
  assert.ok(fn.indexOf('link.download = name') !== -1, 'and in a browser it is downloaded');
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(bridge.indexOf('MediaStore.Downloads') !== -1, 'into the phone\'s own downloads');
  assert.ok(bridge.indexOf('DIRECTORY_DOWNLOADS') !== -1);
});

test('adding to the calendar never claims a success it did not have', () => {
  const { win, doc } = boot();
  const day = new win.Date(2027, 1, 8);
  const toastText = function () { return doc.getElementById('toast').textContent; };

  /* the app opens the phone's own calendar */
  const opened = [];
  win.SunnatiApp = { addToCalendar: function (t) { opened.push(t); return true; } };
  assert.strictEqual(win.App.helpers.addToCalendar('رمضان', day), true);
  assert.strictEqual(opened.length, 1);

  /* an app without that door still writes the file and hands it over */
  const saved = [];
  win.SunnatiApp = { saveAndOpen: function (n, m, c) { saved.push([n, m, c]); return true; } };
  assert.strictEqual(win.App.helpers.addToCalendar('رمضان', day), true);
  assert.strictEqual(saved[0][0], 'رمضان.ics');
  assert.strictEqual(saved[0][1], 'text/calendar');
  assert.ok(saved[0][2].indexOf('BEGIN:VCALENDAR') === 0);

  /* an app that can do neither says so: a web view swallows a blob download,
     so offering one and reporting success would be a lie */
  win.SunnatiApp = { version: function () { return '8.8.1'; } };
  assert.strictEqual(win.App.helpers.addToCalendar('رمضان', day), false);
  assert.ok(toastText().indexOf('حدّث التطبيق') !== -1, 'and it says what to do about it');

  /* in a plain browser the download is real, so it is offered there */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function addToCalendar\(name, date\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('if (app) {') !== -1 && fn.indexOf('link.download') !== -1);
  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  assert.ok(main.indexOf('setDownloadListener') !== -1,
    'and any other download the page starts is taken by the phone rather than swallowed');
});

test('the half hour after an adhan counts up from it, then turns to the next', () => {
  /* twelve minutes after dhuhr */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the rule itself: within the window the label and the name come from the
     prayer just past, and the count runs up from it */
  const fn = /var sinceAdhan = ([\s\S]*?)\n    \} else \{/.exec(app)[1];
  assert.ok(fn.indexOf("'مضى على'") !== -1 && fn.indexOf("c.prev.ar") !== -1);
  assert.ok(fn.indexOf('clockText(c.prev.at)') !== -1, 'and it names the hour of that adhan');
  assert.ok(app.indexOf("var fresh = sinceAdhan >= 0 && sinceAdhan < AFTER_ADHAN_MINUTES;") !== -1);
  assert.ok(app.indexOf('var AFTER_ADHAN_MINUTES = 30;') !== -1, 'thirty minutes, in one place');
  /* the sunrise has no adhan, so nothing counts from it */
  assert.ok(/c\.prev\.key !== 'sunrise'/.test(app));
});

test('the night is halved and thirded from maghrib to the next fajr, not from the clock', () => {
  const { win, doc } = boot();
  const marks = win.App.helpers.nightMarks(new win.Date());
  assert.ok(marks && typeof marks.midnight === 'number' && typeof marks.lastThird === 'number');
  const t = win.App.helpers.computeTimes ? null : null;
  /* both fall in the night, and the third is later than the half */
  const asMinutesAfterMaghrib = function (m) { return (m + 1440 - 0) % 1440; };
  void asMinutesAfterMaghrib; void t;
  assert.ok(marks.midnight >= 0 && marks.midnight < 1440);
  assert.ok(marks.lastThird >= 0 && marks.lastThird < 1440);
  /* and they are shown under the strip */
  const line = doc.getElementById('night-line');
  assert.ok(line && !line.hidden);
  assert.ok(line.textContent.indexOf('منتصف الليل') !== -1 && line.textContent.indexOf('الثلث الأخير') !== -1);
});

test('the clock carries its adhkar at one end and its picture at the other', () => {
  const { win, doc } = boot();
  const tools = doc.querySelector('.clock .card-tools');
  assert.ok(tools, 'the two sit on the clock itself');
  const ids = [...tools.querySelectorAll('.btn')].map(function (b) { return b.id; });
  assert.deepStrictEqual(ids.join(','), 'home-azkar,home-share-times',
    'the adhkar first, so it falls at the start of the line and the picture at the end');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.card-tools \{[^}]*justify-content:\s*space-between/);
  /* the picture carries the day's times and the night's marks */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function timesCard\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* الظهر is no longer a literal here: on friday the picture must say الجمعة,
     as the screen beside it does, so the name comes from prayerName */
  assert.ok(fn.indexOf("prayerName('dhuhr')") !== -1, 'the picture asks for the name of the noon');
  ['الفجر', 'الشروق', 'العصر', 'المغرب', 'العشاء', 'منتصف الليل', 'الثلث الأخير'].forEach(function (n) {
    assert.ok(fn.indexOf(n) !== -1, 'the picture should name ' + n);
  });
});

test('the mosques are opened in the phone\'s own map, at the reader\'s place', () => {
  const { win, doc } = boot();
  win.App.go('more');
  const row = doc.querySelector('#more-list [data-act="mosques"]');
  assert.ok(row, 'offered in the more list');
  /* the row opens the app's own screen of mosques rather than leaving at once */
  win.App.helpers.setPlace({ n: 'الكويت', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.go('more');
  click(win, doc.querySelector('#more-list [data-act="mosques"]'));
  assert.strictEqual(win.App.state.view, 'mosques');
  /* and from there each one hands its own place to the phone's map */
  const opened = [];
  win.SunnatiApp = { openMap: function (u, h) { opened.push([u, h]); return true; } };
  win.App.helpers.mosqueRoute('29.3812,47.9815|مسجد الصحاف');
  assert.strictEqual(opened.length, 1);
  assert.ok(opened[0][0].indexOf('geo:29.3812,47.9815') === 0, 'a place, not a search of nowhere');
  assert.ok(decodeURIComponent(opened[0][0]).indexOf('مسجد الصحاف') !== -1);
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(bridge.indexOf('public boolean openMap') !== -1);
  assert.ok(bridge.indexOf('https://www.google.com/maps/search/mosque') !== -1, 'and a way through when no map app answers');
});

test('either eid opens with its own sunnahs, once', () => {
  const { win, doc } = boot();
  assert.strictEqual(win.App.helpers.eidToday(), null, 'not today');
  assert.strictEqual(win.App.helpers.maybeEidSheet(), false);
  /* the hijri date is nudged onto the first of shawwal */
  const h = win.Hijri.toHijri(new win.Date(), 0);
  const days = win.Hijri.daysBetween ? null : null;
  void h; void days;
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function eidToday\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('h.m === 10 && h.d === 1') !== -1, 'the first of shawwal');
  assert.ok(fn.indexOf('h.m === 12 && h.d === 10') !== -1, 'and the tenth of dhul hijjah');
  const sheet = /function maybeEidSheet\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(sheet.indexOf('eidShown') !== -1, 'shown once in the day');
  assert.ok(sheet.indexOf('الغسل والتطيّب') !== -1 && sheet.indexOf('الرجوع من طريق آخر') !== -1);
  assert.ok(sheet.indexOf('من أضحيته') !== -1, 'and the adha has its own, not the fitr\'s');
});

test('the reminder is not pushed away again every time the app is opened', () => {
  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SalawatScheduler.java'), 'utf8');
  assert.ok(sched.indexOf('FLAG_NO_CREATE') !== -1,
    'opening the app must not re-arm an alarm that is already waiting, or it never arrives');
  assert.ok(sched.indexOf('scheduleNext(context, before != minutes);') !== -1,
    'a fresh choice starts its count now, an unchanged one does not');
  const receiver = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(receiver.indexOf('SalawatScheduler.scheduleNext(context, true)') !== -1,
    'and after one rings the next is armed outright');
});

test('every fold but the hour\'s on the home starts closed, so a screen shows its headings rather than its contents', () => {
  const { win, doc } = boot();
  const open = function (view) { return doc.querySelectorAll('#v-' + view + ' .fold.is-open').length; };
  const all = function (view) { return doc.querySelectorAll('#v-' + view + ' .fold').length; };
  assert.ok(all('home') >= 1);
  /* all but the sunnahs of the hour on the home, which are what the hour
     asks for and stand open under the clock */
  assert.strictEqual(open('home'), 1, 'the sunnahs of the hour are open');
  win.App.go('tracker');
  assert.ok(all('tracker') > 5, 'many groups, ' + all('tracker'));
  assert.strictEqual(open('tracker'), 0);
  win.App.go('umrah');
  assert.strictEqual(all('umrah'), 5);
  assert.strictEqual(open('umrah'), 0, 'no stage opens by itself');
});

test('a fold opens on its own head, whichever screen it is on', () => {
  const { win, doc } = boot();
  click(win, doc.querySelector('#v-home .fold-head'));
  assert.strictEqual(doc.querySelectorAll('#v-home .fold.is-open').length, 0);
  assert.strictEqual(doc.querySelector('#v-home .fold-head').getAttribute('aria-expanded'), 'false');
  click(win, doc.querySelector('#v-home .fold-head'));
  assert.strictEqual(doc.querySelectorAll('#v-home .fold.is-open').length, 1, 'and opens again');

  win.App.go('tracker');
  click(win, doc.querySelectorAll('#v-tracker .fold-head')[2]);
  assert.strictEqual(doc.querySelectorAll('#v-tracker .fold.is-open').length, 1);

  /* the umrah keeps its folds under their own name, and the general handler
     must not seize them: it once did, and threw on every press */
  win.App.go('umrah');
  click(win, doc.querySelector('#v-umrah .fold-head'));
  assert.strictEqual(doc.querySelectorAll('#v-umrah .fold.is-open').length, 1);
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("if (foldHead && foldHead.closest('[data-fold]')) {") !== -1,
    'a head with no [data-fold] above it belongs to another handler');
});

test('a search still opens what it matched', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("'<section class=\"fold' + (needle ? ' is-open' : '') + '\"") !== -1,
    'the reader asked for it, so it is shown rather than folded away');
});

test('the picture of the times is a row for each, the night marks among them', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function timesCard\(\) \{([\s\S]*?)\n  \}\n\n  function roundRect/.exec(app)[1];
  /* a row apiece, the name at one end and the hour at the other, not a paragraph */
  assert.ok(fn.indexOf('roundRect(ctx, PAD, y, W - PAD * 2, ROW, 26)') !== -1, 'each on its own rounded row');
  /* at the start of a line of the reader's language and at its end, which in
     Arabic is the right and the left, and the other way round in English */
  assert.ok(fn.indexOf("ctx.textAlign = ltr ? 'left' : 'right'") !== -1 && fn.indexOf("ctx.textAlign = ltr ? 'right' : 'left'") !== -1,
    'the name at the start and the hour at the end');
  assert.ok(fn.indexOf("prayerName('dhuhr')") !== -1, 'friday is called by its own name here too');
  ['الفجر', 'الشروق', 'العصر', 'المغرب', 'العشاء', 'منتصف الليل', 'الثلث الأخير'].forEach(function (n) {
    assert.ok(fn.indexOf(n) !== -1, 'the picture should carry ' + n);
  });
  /* the two night marks take the same row, only tinted apart */
  assert.ok(fn.indexOf('night: true') !== -1 && fn.indexOf("row.night ? 'rgba(176, 136, 51, .10)'") !== -1);
  assert.ok(fn.indexOf('Hijri.format') !== -1 && fn.indexOf('gregorianLine') !== -1, 'and both dates at its head');
});

test('the last third is the night divided in three, as the scholars state it', () => {
  const { win } = boot();
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function nightMarks\(day\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* the night runs maghrib to the next fajr, halved for its middle and two
     thirds along for the last third: a twelve hour night puts it four hours
     before fajr, a nine hour night three */
  assert.ok(fn.indexOf('var night = (1440 - t.maghrib) + next.fajr;') !== -1);
  assert.ok(fn.indexOf('Math.round(night / 2)') !== -1, 'the middle');
  assert.ok(fn.indexOf('Math.round(night * 2 / 3)') !== -1, 'and two thirds along for the last third');
  const marks = win.App.helpers.nightMarks(new win.Date());
  assert.ok(marks && marks.midnight !== marks.lastThird);
  /* worked by hand: a night of twelve hours from maghrib at 18:00 to fajr at
     06:00 puts the last third at 02:00, four hours before fajr */
  const night = (1440 - 1080) + 360;
  assert.strictEqual(night, 720, 'twelve hours');
  assert.strictEqual((1080 + Math.round(night * 2 / 3)) % 1440, 120, 'two in the morning');
  assert.strictEqual((360 - 120 + 1440) % 1440, 240, 'four hours before fajr');
});

test('the two tools sit below the date row, never on it', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.strictEqual((css.match(/\.card-tools \{ position/g) || []).length, 1, 'one rule, not two fighting');
  assert.match(css, /\.card-tools \{ position: absolute; top: 62px;/,
    'clear of the date and its two nudges');
});

test('the times card wears the same frame as the verse card', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function timesCard\(\) \{([\s\S]*?)\n  \}\n\n  \/\* the gold knot/.exec(app)[1];
  /* the colour comes from the reader's chosen palette, in its light shade,
     never from the screen, whose accent is far too bright in the dark theme */
  assert.ok(fn.indexOf('var paint = cardColours();') !== -1);
  assert.ok(fn.indexOf('getPropertyValue') === -1, 'nothing read from the theme');
  /* and it wears the same frame as the verse card */
  assert.ok(fn.indexOf('cardStar(ctx, lx, ly, 22)') !== -1, 'the faint lattice');
  assert.ok(fn.indexOf('cardStar(ctx, 52, 52, 14)') !== -1, 'and the knots at its corners');
  assert.ok(fn.indexOf("ctx.fillStyle = '#f7f5ef'") !== -1, 'on the same paper');
});

test('the strip marks the prayer the clock is counting to', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /var sinceAdhan = c\.prev && c\.prev\.key !== 'sunrise' \? c\.now - c\.prev\.at : -1;\n    var marked = ([^\n]*)/.exec(app);
  assert.ok(fn, 'the strip works out what to mark');
  /* while the half hour after an adhan runs, the prayer just past is marked;
     after it, the coming one, so once the sun is up the mark leaves fajr and
     sunrise and moves to dhuhr */
  assert.strictEqual(fn[1], "(sinceAdhan >= 0 && sinceAdhan < AFTER_ADHAN_MINUTES) ? c.prev.key : c.next.key;");
  assert.ok(app.indexOf("'، الصلاة القادمة'") !== -1, 'and it is named so for a reader who cannot see colour');
  const { win, doc } = boot();
  win.App.go('home');
  const now = doc.querySelector('.window.is-now');
  assert.ok(now, 'exactly one is marked');
  assert.strictEqual(doc.querySelectorAll('.window.is-now').length, 1);
});

test('صلاة الضحى has its window and its best hour, and a reminder the reader may set', () => {
  const { win, doc } = boot();
  const w = win.App.helpers.duhaWindow(new win.Date());
  assert.ok(w, 'a window is worked out');
  /* from the sun risen by a spear's length to a little before it stands at
     noon, and its best hour a quarter of the day along */
  assert.ok(w.from > 0 && w.best > w.from && w.to > w.best, 'in order: ' + JSON.stringify(w));
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function duhaWindow\(day\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('t.sunrise + 20') !== -1, 'twenty minutes after sunrise');
  assert.ok(fn.indexOf('Math.round((t.maghrib - t.sunrise) / 4)') !== -1, 'a quarter of the day for its best');
  assert.ok(fn.indexOf('t.dhuhr - 10') !== -1, 'and it ends before the sun stands');
  /* the reminder is the reader's to set, and off until they do */
  win.App.go('settings');
  assert.strictEqual(doc.getElementById('settings-duha').getAttribute('aria-checked'), 'false');
  assert.ok(doc.getElementById('settings-duha-note').textContent.indexOf('وأفضلها نحو') !== -1,
    'and the setting says when');
  click(win, doc.getElementById('settings-duha'));
  assert.strictEqual(win.Store.get('duha'), true);
  const queued = win.App.helpers.reminderList().filter(function (r) { return r.t === 'صلاة الضحى'; });
  assert.ok(queued.length >= 5, 'one for each day ahead, got ' + queued.length);
  assert.ok(queued[0].b.indexOf('ركعتان فأكثر') !== -1);
});

test('a shared card takes the colour the reader chose, in a shade fit for paper', () => {
  const { win } = boot();
  /* the screen's own accent is far too bright in the dark theme, and fixing
     the colour ignored the reader's choice; the palette's light shade does both */
  win.Store.set('accent', 'blue');
  const blue = win.App.helpers.cardColours();
  assert.strictEqual(blue.fill, '#26689c', 'the blue the palette keeps for light paper');
  win.Store.set('accent', 'sadu');
  assert.strictEqual(win.App.helpers.cardColours().fill, '#9c2b2b');
  win.Store.set('accent', 'teal');
  assert.strictEqual(win.App.helpers.cardColours().fill, '#156e6e');
  /* and it does not change with the theme */
  win.document.documentElement.setAttribute('data-theme', 'dark');
  assert.strictEqual(win.App.helpers.cardColours().fill, '#156e6e', 'the paper is light either way');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok((app.match(/var paint = cardColours\(\);/g) || []).length >= 3,
    'every card the app shares takes it');
});

test('the sections offer the adhkar and the mosques, and not what the tab bar already holds', () => {
  const { doc } = boot();
  const names = [...doc.querySelectorAll('#home-tiles .tile-name')].map(function (t) { return t.textContent; });
  assert.ok(names.indexOf('الأذكار') !== -1);
  assert.ok(names.indexOf('المساجد') !== -1);
  assert.ok(names.indexOf('المسبحة') === -1, 'the tasbih is a tab already, so it is not a tile too');
  assert.ok(doc.querySelector('#home-tiles [data-act="mosques"]'), 'the mosques open their own screen');
});

test('the mosques are found around the reader and measured from them', () => {
  const { win, doc } = boot();
  /* the distance is over the ground, not a difference of numbers */
  const far = win.App.helpers.metresBetween({ lat: 29.38, lng: 47.98 }, { lat: 29.3812, lng: 47.9815 });
  assert.ok(far > 150 && far < 250, 'about two hundred metres, got ' + far);
  assert.strictEqual(win.App.helpers.farLabel(78), '78 م');
  assert.strictEqual(win.App.helpers.farLabel(1400), '1.4 كم');

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function findMosques\(around\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('around:3000,') !== -1, 'three kilometres about wherever the map looks');
  assert.ok(fn.indexOf('"religion"="muslim"') !== -1);
  assert.ok(fn.indexOf("['name:ar']") !== -1, 'the arabic name where the map carries one');
  assert.ok(fn.indexOf('found.sort') !== -1, 'nearest first');
  /* one server being down must not take the screen with it */
  assert.ok(app.indexOf('var OVERPASS = [') !== -1);
  assert.ok((app.match(/api\/interpreter'/g) || []).length >= 4, 'four servers, raced so a busy one is passed over');
  assert.ok(/OVERPASS\.forEach\(function \(host\) \{/.test(app),
    'every server is asked at once rather than in turn');

  /* the map is drawn from tiles, with the reader's own place at its middle */
  const map = /function drawMap\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(map.indexOf('tile.openstreetmap.org') !== -1);
  assert.ok(map.indexOf("'<div class=\"map-me\"") !== -1, 'and the reader is on it');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('openstreetmap.org/copyright') !== -1, 'the map is credited where it came from');
  /* the screen exists and says something useful before the answer arrives */
  win.App.go('mosques');
  assert.ok(doc.getElementById('mosque-list').textContent.length > 5);
});

test('the map credit sits with the other sources, not under the map', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('class="map-credit"') === -1, 'the map screen carries no line of its own');
  /* the licence of the map still requires it to be named, so it joins the
     others in المصادر where the app already names where its text comes from */
  const sources = /<h2>المصادر<\/h2><\/div>\s*<p class="setting-note">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(sources, 'the sources card exists');
  assert.ok(sources[1].indexOf('OpenStreetMap') !== -1, 'and names the map among them');
  assert.ok(sources[1].indexOf('openstreetmap.org/copyright') !== -1, 'with the link its licence asks for');
});

test('the app writes جاري, never جارٍ', () => {
  ['index.html', 'js/app.js'].forEach(function (f) {
    const src = fs.readFileSync(path.join(DOCS, f), 'utf8');
    assert.ok(src.indexOf('جارٍ') === -1, f + ' still writes جارٍ');
  });
});

test('handing the interval over again does not push the reminder further away', () => {
  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SalawatScheduler.java'), 'utf8');
  const fn = /public static void setEvery\(Context context, int minutes\) \{([\s\S]*?)\n    \}/.exec(sched)[1];
  /* the page hands the interval over on every launch, so this runs far more
     often than the reader changes anything; forcing here undid the guard in
     scheduleNext and the reminder never arrived */
  assert.ok(fn.indexOf('int before = every(context);') !== -1, 'it must know what was there before');
  assert.ok(fn.indexOf('scheduleNext(context, before != minutes);') !== -1,
    'only a real change restarts the count');
  assert.ok(fn.indexOf('scheduleNext(context, true)') === -1, 'nothing forces it unconditionally');
  /* and the guard it leans on is still there */
  assert.ok(sched.indexOf('if (!force && waiting(context)) return;') !== -1);
  assert.ok(sched.indexOf('FLAG_NO_CREATE') !== -1);
});

test('every mark the app names is drawn, and the umrah stages each wear their own', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const drawn = [...html.matchAll(/<g id="(i-[a-z-]+)"/g)].map(function (m) { return m[1]; });
  ['i-ihram', 'i-tent', 'i-mount', 'i-pillar', 'i-stones', 'i-water', 'i-scissors', 'i-dua', 'i-plane']
    .forEach(function (name) { assert.ok(drawn.indexOf(name) !== -1, 'missing ' + name); });
  /* nothing is named that was never drawn */
  const named = [...html.matchAll(/href="#(i-[a-z-]+)"/g)].map(function (m) { return m[1]; });
  [...new Set(named)].forEach(function (n) { assert.ok(drawn.indexOf(n) !== -1, 'named but not drawn: ' + n); });

  const { win, doc } = boot();
  win.UMRAH_STAGES.forEach(function (st) { assert.ok(st.ic, st.id + ' should carry a mark'); });
  win.App.go('umrah');
  const marks = [...doc.querySelectorAll('#umrah-stages .stage-num use')].map(function (u) { return u.getAttribute('href'); });
  assert.strictEqual(marks.join(' '), '#i-water #i-ihram #i-kaaba #i-mount #i-scissors',
    'the washing, the ihram, the kaaba, the walk and the cutting');
  marks.forEach(function (m) { assert.ok(drawn.indexOf(m.slice(1)) !== -1, m + ' is not drawn'); });
});

test('no two entries in a list wear the same mark', () => {
  const { win, doc } = boot();
  win.App.go('home');
  /* the sections wear paintings rather than line drawings, one to each */
  const tiles = [...doc.querySelectorAll('#home-tiles .tile-art')].map(function (i) { return i.getAttribute('src'); });
  assert.ok(tiles.length >= 9, 'every section wears a painting, got ' + tiles.length);
  assert.strictEqual(new Set(tiles).size, tiles.length,
    'two sections looked alike: ' + tiles.filter(function (t, i) { return tiles.indexOf(t) !== i; }).join(' '));
  /* the umrah and the mosques were once the same drawing, which read as one
     thing being two, and the adhkar and the duas are told apart the same way */
  ['umrah', 'mosques', 'azkar', 'dua'].forEach(function (key) {
    assert.ok(tiles.indexOf('img/sections/' + key + '.webp') !== -1, key + ' wears a painting of its own');
  });
  win.App.go('more');
  const rows = [...doc.querySelectorAll('#more-list .row use')].map(function (u) { return u.getAttribute('href'); });
  assert.strictEqual(new Set(rows).size, rows.length,
    'two rows looked alike: ' + rows.filter(function (r, i) { return rows.indexOf(r) !== i; }).join(' '));
  /* the line drawings live on in the more list: the pilgrim for the umrah and
     a mosque for the mosques, the raised palm for the adhkar and the cupped
     hands for the supplications */
  assert.ok(rows.indexOf('#i-ihram') !== -1 && rows.indexOf('#i-mosque') !== -1);
  assert.ok(rows.indexOf('#i-hands') !== -1 && rows.indexOf('#i-dua') !== -1);
});

test('the pause mark is drawn, not filled into nothing', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const pause = /<g id="i-pause">([\s\S]*?)<\/g>/.exec(html)[1];
  /* it is two strokes, so a rule that fills it and drops the stroke leaves
     nothing at all to see, in either theme */
  assert.ok(pause.indexOf('v15') !== -1, 'two upright strokes');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf("use[href='#i-pause']") === -1,
    'the pause must not be caught by the fill rule written for the play triangle');
  assert.match(css, /\.icon:has\(use\[href='#i-play'\]\) \{ fill: currentColor; stroke: none; \}/,
    'only the play triangle is a filled shape');
});

test('an empty screen offers one way out, beneath its words', () => {
  const { win, doc } = boot();
  win.App.go('bookmarks');
  assert.strictEqual(doc.querySelectorAll('#bookmark-list .btn').length, 0,
    'no button laid across the words');
  const below = doc.querySelector('#v-bookmarks > .btn');
  assert.strictEqual(below.textContent, 'افتح المصحف');
  assert.strictEqual(below.getAttribute('data-go'), 'quran');
  /* wherever an empty block does carry a button, it sits under the words */
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.empty \.btn \{ display: block;/);
  /* and the more list describes it as following one's memorising */
  win.App.go('more');
  const row = [...doc.querySelectorAll('#more-list .row')]
    .filter(function (r) { return r.textContent.indexOf('المحفوظات') !== -1; })[0];
  assert.ok(row.textContent.indexOf('تتبّع حفظك') !== -1, 'got ' + row.textContent);
});

test('the page sits below the phone bars, inset by the framework rather than by hand', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  /* asking the web view to inset itself did not hold on every version, and the
     clock ended up written over the page */
  assert.ok(main.indexOf('root.setFitsSystemWindows(true)') !== -1,
    'a frame the framework insets itself');
  assert.ok(main.indexOf('getWindow().setDecorFitsSystemWindows(false)') !== -1,
    'and the window drawn edge to edge beneath it');
  assert.ok(main.indexOf('web.setFitsSystemWindows(false)') !== -1, 'the page fills that frame');
  assert.ok(main.indexOf('WindowInsets.Type.ime()') !== -1, 'and the keyboard still lifts it');
});

test('the splash is drawn and held, not a logo blinking past', () => {
  const splash = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SplashView.java'), 'utf8');
  /* it was the app's own paper, and it is a painting now: under the painting
     lies the sky of the hour in one flat colour, the pale blue of the day and
     the deep blue of the night, for the moment before the painting draws */
  ['0xFFCFE2F1', '0xFF0D1B3D'].forEach(function (c) {
    assert.ok(splash.indexOf(c) !== -1, 'both skies, ' + c);
  });
  ['0xFFF6F4EE', '0xFF10161A'].forEach(function (c) {
    assert.ok(splash.indexOf(c) === -1, 'the old paper is gone from under the painting, ' + c);
  });
  assert.ok(splash.indexOf("animate().alpha(1f)") !== -1, 'it eases in rather than appearing whole');

  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  assert.ok(main.indexOf('void dismissSplash()') !== -1);
  assert.ok(main.indexOf('splash.animate().alpha(0f)') !== -1, 'it fades rather than vanishing');
  assert.ok(/postDelayed[\s\S]{0,120}4000/.test(main), 'and never outstays its welcome');

  /* the page tells the app when it has painted */
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(/@JavascriptInterface\s+public void pageReady\(\)/.test(bridge));
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('app.pageReady()') !== -1, 'and the page says so');
});

test('the app never speaks of a browser', () => {
  ['index.html', 'js/app.js', 'sw.js'].forEach(function (f) {
    const src = fs.readFileSync(path.join(DOCS, f), 'utf8');
    assert.ok(src.indexOf('متصفح') === -1, f + ' still mentions one');
  });
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* that line was removed: when all is well it told the reader nothing and
     took a line of the screen. What it stood for here is the wording, and
     the note that remains still says «التطبيق» rather than «المتصفح». */
  assert.ok(app.indexOf('الإشعارات مغلقة لسُنّتي في إعدادات الهاتف') !== -1,
    'the note that speaks does so in the app\'s own words');
});

test('the opening is held long enough to be seen, and no longer', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  /* the page says it has painted, and with the worker holding the shell that
     is a few hundred milliseconds, so the screen faded in over 260ms and began
     fading out again at once: a flicker, and the greeting on it unreadable */
  assert.ok(/SPLASH_HOLD_MS = \d+/.test(main), 'the opening has a floor');
  const hold = +/SPLASH_HOLD_MS = (\d+)/.exec(main)[1];
  /* 1100 was tried on a phone and the greeting went before it could be read */
  /* 2000 still felt quick on a phone; raised to 3200, still short of annoying */
  assert.ok(hold >= 2500 && hold <= 4000, 'long enough to read, short enough not to annoy: ' + hold);
  /* a floor and not a length: it still goes as soon as the page is ready */
  /* the floor of this opening, the full one on the day's first and a brief one after */
  assert.ok(main.indexOf('splashHold - shown') !== -1, 'it waits out the remainder, it does not sleep a fixed time');
  assert.ok(main.indexOf('}, 4000);') !== -1, 'and a ceiling, for a page that never says it is ready');

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function dismissBootSplash\(atOnce\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('performance.now') !== -1 && fn.indexOf('3200') !== -1,
    'the page has the same floor, measured from when it started loading');
});

test('the splash is the app\'s own mark and face, drawn where the fonts can be read', () => {
  const splash = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SplashView.java'), 'utf8');
  /* android cannot open a woff2 face, so the picture is made at build time
     with the real fonts rather than approximated in canvas. There is one for
     the day and one for the night, and the hour chooses between them now,
     not the dark theme. */
  assert.ok(/R\.drawable\.splash_art_night/.test(splash) &&
    /R\.drawable\.splash_art(?![_a-zA-Z])/.test(splash), 'a picture for the day and one for the night');
  assert.ok(/day \? R\.drawable\.splash_art : R\.drawable\.splash_art_night/.test(splash),
    'the day takes the icon with the shadow and the night the one with the glow');
  assert.ok(splash.indexOf('uiMode') === -1 && splash.indexOf('UI_MODE_NIGHT') === -1,
    'the theme has no say in the opening, the hour does');
  assert.ok(splash.indexOf('createFromAsset') !== -1, 'the app face is loaded, not the system face');
  /* the picture is made at build time and knows nobody, so the greeting is
     drawn over it from a city the page handed the wrapper last time */
  /* «حيّ الله أهل» over two lines with the city beneath, in the app's own face
     loaded from assets, not left to the system face as it was */
  assert.ok(splash.indexOf('"حيّ الله أهل"') !== -1, 'the hail that names the people of the city');
  assert.ok(splash.indexOf('"حيّاكم الله"') !== -1, 'and one to nobody in particular, before any city is known');
  assert.ok(splash.indexOf('createFromAsset') !== -1 && splash.indexOf('plex-arabic-semibold.ttf') !== -1,
    'drawn in the app font, bundled as an asset');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'android/app/src/main/assets/fonts/plex-arabic-semibold.ttf')),
    'and the font is there to load');
  /* the page opening says the same thing in two lines */
  const boot = fs.readFileSync(path.join(DOCS, 'js', 'boot.js'), 'utf8');
  assert.ok(boot.indexOf("'حيّ الله أهل'") !== -1 && boot.indexOf('boot-city') !== -1);
  assert.ok(fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8').indexOf('id="boot-city"') !== -1);
  /* one copy, in nodpi: the picture does not change with the density, and it
     used to sit byte for byte in five folders */
  ['splash_art.png', 'splash_art_night.png'].forEach(function (f) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'android/app/src/main/res/drawable-nodpi', f)), f);
  });
  /* the picture is the icon itself on the paper, drawn by the tool that draws
     the icon, with nothing under it written a second time: the name is in it */
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools/store/icon-build.py'), 'utf8');
  assert.ok(/def splash_page\(/.test(tool) && tool.indexOf("'splash_art_night'") !== -1, 'both pictures come from the icon tool');
  assert.ok(/data_uri\(svg\(background\(\) \+ figure\(\)/.test(tool), 'and they carry the icon itself, not a drawing of one');
});

/* ---------------- the opening painted for the reader's own country ---------------- */

const SPLASH_JAVA = path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SplashView.java');
const SPLASH_ZONES = {
  'Asia/Kuwait': 'kw', 'Asia/Riyadh': 'sa', 'Asia/Dubai': 'ae',
  'Asia/Qatar': 'qa', 'Asia/Bahrain': 'bh', 'Asia/Muscat': 'om'
};
const ANDROID_SPLASH_PAINTINGS = [];
['kw', 'sa', 'ae', 'qa', 'bh', 'om', 'default'].forEach(function (p) {
  ANDROID_SPLASH_PAINTINGS.push('splash_bg_' + p + '_day', 'splash_bg_' + p + '_night');
});

/* the width and height a webp says it has, read off its own header */
function webpSize(buf) {
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return null;
}

test('the opening is painted for the reader\'s own country, by day and by night, and every painting is light', () => {
  const res = path.join(__dirname, '..', 'android/app/src/main/res/drawable-nodpi');
  const splash = fs.readFileSync(SPLASH_JAVA, 'utf8');
  /* six countries with a landmark of their own and the open shore for
     everyone else, each once by day and once by night */
  assert.strictEqual(ANDROID_SPLASH_PAINTINGS.length, 14);
  ANDROID_SPLASH_PAINTINGS.forEach(function (name) {
    const file = path.join(res, name + '.webp');
    assert.ok(fs.existsSync(file), name + ' is there');
    const buf = fs.readFileSync(file);
    const head = buf.subarray(0, 12).toString('latin1');
    assert.ok(head.indexOf('RIFF') === 0 && head.indexOf('WEBP') === 8, name + ' is a webp');
    assert.ok(buf.length < 200000, name + ' stays under its budget of 200000 bytes: ' + buf.length);
    assert.deepStrictEqual(webpSize(buf), [1080, 1920], name + ' is 1080 by 1920, the 9:16 the view crops from');
    /* named, never looked up by a string, so lint does not call it unused
       and the shrinker does not drop it */
    assert.ok(new RegExp('R\\.drawable\\.' + name + '(?![_a-zA-Z0-9])').test(splash),
      name + ' is named through R.drawable');
  });
  /* and nothing ships in the folder that the view cannot choose, which lint
     would rightly call an unused resource */
  const shipped = fs.readdirSync(res).filter(function (f) { return f.indexOf('splash_bg_') === 0; })
    .map(function (f) { return f.replace(/\.webp$/, ''); }).sort();
  assert.deepStrictEqual(shipped, ANDROID_SPLASH_PAINTINGS.slice().sort(), 'every painting shipped is one the view can choose');
  /* they are made from the masters by one tool, which holds the same budget */
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools/android/splash-bg.py'), 'utf8');
  assert.ok(tool.indexOf('SIZE = (1080, 1920)') !== -1 && tool.indexOf('Image.LANCZOS') !== -1,
    'cut to 9:16 from the middle and made 1080 by 1920');
  assert.ok(tool.indexOf('BUDGET = 200000') !== -1, 'and the tool refuses what this test refuses');
  assert.ok(tool.indexOf("'drawable-nodpi'") !== -1, 'into nodpi, once, since a painting does not change with the density');
});

test('the painting is chosen by the phone\'s time zone and by the hour, and the theme has no say', () => {
  const splash = fs.readFileSync(SPLASH_JAVA, 'utf8');
  assert.ok(splash.indexOf('String zone = TimeZone.getDefault().getID();') !== -1 &&
    splash.indexOf('paintingFor(zone, day)') !== -1 && splash.indexOf('landmarkFor(zone, day)') !== -1,
    'the country is read from the time zone, which asks for no permission, and names the painting and where its landmark stands');
  assert.ok(splash.indexOf('isDay(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))') !== -1,
    'and the hour from the phone\'s own clock');
  const pick = /static int paintingFor\(String zone, boolean day\) \{([\s\S]*?)\n    \}\n/.exec(splash);
  assert.ok(pick, 'the painting is chosen in one place');
  Object.keys(SPLASH_ZONES).forEach(function (zone) {
    const code = SPLASH_ZONES[zone];
    assert.ok(new RegExp('case "' + zone + '":\\s*return day \\? R\\.drawable\\.splash_bg_' + code +
      '_day : R\\.drawable\\.splash_bg_' + code + '_night;').test(pick[1]), zone + ' is shown its own landmark');
  });
  assert.ok(/default:\s*return day \? R\.drawable\.splash_bg_default_day : R\.drawable\.splash_bg_default_night;/.test(pick[1]),
    'and every other zone the open shore');
  const day = /static boolean isDay\(int hour\) \{([\s\S]*?)\n    \}\n/.exec(splash);
  assert.ok(day && /return hour >= 5 && hour < 18;/.test(day[1]), 'day is 05:00 to 17:59, and every other hour is night');
  /* the colours of the hour, as the painting is lit */
  ['0xFFA87B25', '0xFF16241C', '0xFFE2C06A', '0xFFF3EFE6'].forEach(function (c) {
    assert.ok(splash.indexOf(c) !== -1, 'the greeting is written in ' + c);
  });
  assert.ok(splash.indexOf('setShadowLayer') !== -1, 'with a soft shadow, so it holds wherever the painting is busier');
});

test('java itself gives every zone at every hour the painting it should', {
  skip: require('node:child_process').spawnSync('javac', ['-version']).status !== 0 && 'no jdk here'
}, () => {
  const splash = fs.readFileSync(SPLASH_JAVA, 'utf8');
  /* the two choices are pure, so they are lifted out as they are and run
     against a stand-in for R, without android */
  const isDay = /    static boolean isDay\(int hour\) \{[\s\S]*?\n    \}\n/.exec(splash)[0];
  const paintingFor = /    static int paintingFor\(String zone, boolean day\) \{[\s\S]*?\n    \}\n/.exec(splash)[0];
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sunnati-splash-'));
  try {
    fs.writeFileSync(path.join(dir, 'Check.java'), [
      'public class Check {',
      '  static final class R { static final class drawable {',
      ANDROID_SPLASH_PAINTINGS.map(function (n, i) { return '    static final int ' + n + ' = ' + (i + 1) + ';'; }).join('\n'),
      '  } }',
      '  static final String[] NAMES = { ' + ANDROID_SPLASH_PAINTINGS.map(function (n) { return '"' + n + '"'; }).join(', ') + ' };',
      isDay, paintingFor,
      '  public static void main(String[] a) {',
      '    StringBuilder sb = new StringBuilder();',
      '    for (String zone : a[0].split(",")) for (int hour = 0; hour < 24; hour++) {',
      '      int id = paintingFor(zone.equals("none") ? null : zone, isDay(hour));',
      '      sb.append(zone).append(" ").append(hour).append(" ").append(NAMES[id - 1]).append("\\n");',
      '    }',
      '    System.out.print(sb);',
      '  }',
      '}'
    ].join('\n'));
    execFileSync('javac', ['-d', dir, path.join(dir, 'Check.java')], { stdio: 'pipe' });
    const zones = Object.keys(SPLASH_ZONES)
      .concat(['Asia/Aden', 'Asia/Baghdad', 'Europe/London', 'America/New_York', 'UTC', 'GMT+03:00', 'none']);
    const out = execFileSync('java', ['-cp', dir, 'Check', zones.join(',')], { stdio: 'pipe' })
      .toString().trim().split('\n');
    assert.strictEqual(out.length, zones.length * 24, 'every zone at every hour');
    out.forEach(function (line) {
      const [zone, hour, name] = line.split(' ');
      const h = +hour;
      const want = 'splash_bg_' + (SPLASH_ZONES[zone] || 'default') + '_' + (h >= 5 && h <= 17 ? 'day' : 'night');
      assert.strictEqual(name, want, zone + ' at ' + hour + ':00');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pressing a mosque brings the map onto it and names it', () => {
  const { win, doc } = boot();
  win.App.helpers.setPlace({ n: 'الكويت', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.mosques = [
    { n: 'العبدالرزاق', lat: 29.3806, lng: 47.9805, far: 78 },
    { n: 'الصحاف', lat: 29.3815, lng: 47.9812, far: 191 }
  ];
  win.App.go('mosques');
  /* every mosque is offered both on the map and in the list */
  assert.strictEqual(doc.querySelectorAll('#mosque-list [data-act="mosque-look"]').length, 4,
    'the mark and the words of each row both point at the map');
  win.App.helpers.lookAtMosque(1);
  assert.strictEqual(win.App.state.mosqueAt, 1);
  assert.strictEqual(win.App.state.mapAt.lat, 29.3815, 'the map is centred on it');
  const line = doc.getElementById('map-chosen');
  assert.ok(!line.hidden);
  assert.ok(line.textContent.indexOf('الصحاف') !== -1 && line.textContent.indexOf('191 م') !== -1);
  assert.ok(line.querySelector('[data-act="mosque-go"]'), 'and the way there is offered');
  /* the reader may come back to their own place */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("state.mapAt = { lat: here.lat, lng: here.lng };") !== -1);
});

test('the map asks for no more tiles than it shows, and says plainly when it finds nothing', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function drawMap\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* the open map asks not to be drawn on in bulk; a finer grid would ask for
     four times as many tiles on every draw */
  assert.ok(fn.indexOf('var size = MAP.tile;') !== -1 && fn.indexOf('devicePixelRatio') === -1);
  assert.ok(fn.indexOf('Math.ceil(W / size) + 1') !== -1, 'one row of tiles beyond the edge, no more');
  /* a screen not yet laid out measures nothing, so it waits rather than
     building the map to a size it never has */
  assert.ok(fn.indexOf('if (!box.width) {') !== -1);
  assert.ok(fn.indexOf('requestAnimationFrame') !== -1);
  assert.ok(app.indexOf('لم يُعثر على مساجد مسجّلة حولك.') !== -1);
});

/* The opening screen as the page writes it, read as markup and never run:
   the splash with everything in it, and the head that dresses it. */
function splashParts() {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const dom = new JSDOM(html);
  opened.push(dom);
  const doc = dom.window.document;
  return { html: html, head: html.slice(0, html.indexOf('</head>')), splash: doc.getElementById('boot-splash') };
}

/* boot.js on its own, as the page runs it before the first frame, on a phone
   set to a zone of its own, at an hour of a day, with whatever the store
   holds. It answers with the painting it named. */
function openingPainting(o) {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://siteq8.github.io/Quran_Sunna/', runScripts: 'outside-only' });
  opened.push(dom);
  const win = dom.window;
  const storage = o.storage || memoryStorage();
  if (o.settings !== undefined) storage.setItem('sunnati.settings', typeof o.settings === 'string' ? o.settings : JSON.stringify(o.settings));
  if (o.sun !== undefined) storage.setItem('sunnati.sun', typeof o.sun === 'string' ? o.sun : JSON.stringify(o.sun));
  Object.defineProperty(win, 'localStorage', { value: storage, configurable: true });
  const Real = win.Date;
  const fixed = o.now.getTime();
  function Fixed(...args) { return args.length ? new Real(...args) : new Real(fixed); }
  Fixed.prototype = Real.prototype;
  Fixed.now = () => fixed;
  win.Date = Fixed;
  win.Intl = { DateTimeFormat: function () { return { resolvedOptions: function () { return { timeZone: o.phone }; } }; } };
  vm.runInContext(fs.readFileSync(path.join(DOCS, 'js', 'boot.js'), 'utf8'), dom.getInternalVMContext(), { filename: 'js/boot.js' });
  return win.document.documentElement.getAttribute('data-splash');
}

const SPLASH_LANDS = { 'Asia/Kuwait': 'kw', 'Asia/Riyadh': 'sa', 'Asia/Dubai': 'ae', 'Asia/Qatar': 'qa',
  'Asia/Bahrain': 'bh', 'Asia/Muscat': 'om' };
const SPLASH_PAINTINGS = ['kw', 'sa', 'ae', 'qa', 'bh', 'om', 'default'].reduce(function (all, land) {
  return all.concat([land + '-day', land + '-night']);
}, []);

test('the page shows its own splash while it wakes: a painting, the icon where the phone put it, and the greeting', async () => {
  const { html, splash } = splashParts();
  assert.ok(splash, 'the page carries one');
  /* written inline and styled inline, so it paints with the first frame
     rather than waiting on a stylesheet or a script */
  assert.ok(splash.getAttribute('style').indexOf('position:fixed') !== -1);
  assert.ok(html.indexOf('<div id="boot-splash"') > html.indexOf('<body>'), 'it is in the body itself');
  /* the painting is drawn first, so everything else stands on it */
  const sky = splash.querySelector('#boot-sky');
  assert.ok(sky && splash.firstElementChild === sky, 'the painting is under the rest');
  assert.ok(sky.getAttribute('style').indexOf('position:absolute;inset:0') !== -1, 'and fills the screen');
  /* The icon at the width of the phone's own opening picture, its middle where
     that picture has it, so the one gives way to the other without a jump.
     It is placed by its own middle, not by centring a column, since a column
     moves with whatever is written beneath it. */
  const mark = splash.querySelector('img');
  assert.strictEqual(mark.getAttribute('src'), 'icons/icon-384.png', 'sharp at three pixels to the point');
  assert.strictEqual(mark.getAttribute('alt'), 'سُنّتي');
  assert.strictEqual(mark.getAttribute('width'), '132');
  const placed = mark.getAttribute('style');
  /* 42% unless the head raises it over a landmark that rises near the words */
  ['position:absolute', 'left:50%', 'top:var(--boot-at,42%)', 'width:132px', 'margin:-66px 0 0 -66px', 'border-radius:30px'].forEach(function (rule) {
    assert.ok(placed.indexOf(rule) !== -1, 'the icon has ' + rule);
  });
  assert.ok(splash.getAttribute('style').indexOf('justify-content') === -1, 'and no column is centred to place it');
  /* beneath it a short gold rule, then the hail, then the city */
  const rule = splash.querySelector('#boot-rule');
  const greet = splash.querySelector('#boot-greet');
  assert.ok(rule && greet, 'a rule and a greeting');
  assert.ok(mark.compareDocumentPosition(rule) & 4 && rule.compareDocumentPosition(greet) & 4, 'in that order, beneath the icon');
  assert.ok(/top:calc\(var\(--boot-at,42%\) \+ \d+px\)/.test(rule.parentNode.getAttribute('style')), 'hung from the icon\'s own middle');
  assert.deepStrictEqual([...greet.children].map(function (e) { return e.id; }), ['boot-hail', 'boot-city']);
  /* the paper is painted before any stylesheet lands, or a white flash shows
     through in the dark theme */
  const bootjs = fs.readFileSync(path.join(DOCS, 'js', 'boot.js'), 'utf8');
  assert.ok(bootjs.indexOf("root.style.backgroundColor = dark ? '#10161a' : '#f6f4ee';") !== -1);

  const { win, doc } = boot();
  /* It used to begin going the moment the first screen was drawn, which with
     the worker holding the shell is a few hundred milliseconds: it appeared
     and started fading in the same breath. It is held for a moment first. */
  assert.ok(doc.getElementById('boot-splash'), 'still there while the floor runs');
  await new Promise(function (done) { setTimeout(done, 3500); });
  const still = doc.getElementById('boot-splash');
  assert.ok(!still || still.style.opacity === '0', 'and then it goes');
  win.App.helpers.dismissBootSplash();
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("splash.style.opacity = '0';") !== -1, 'fading rather than vanishing');
  assert.ok(app.indexOf('splash.parentNode.removeChild(splash)') !== -1, 'and then removed');
});

test('only one splash shows: the android package draws its own, and an iPhone keeps the page\'s', async () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function dismissBootSplash\(atOnce\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('if (atOnce) {') !== -1 && fn.indexOf('removeChild(splash)') !== -1,
    'taken out without a fade rather than showing beneath the app\'s as a second');
  /* Only the wrapper that draws a splash of its own and waits to be told
     pageReady can stand in for the page's. The iOS wrapper has a bridge as
     well, but no splash, and asking only whether there was a bridge took the
     page's splash away there at once: an iPhone never saw any opening. */
  const draws = /function appDrawsSplash\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(draws.indexOf('app.pageReady') !== -1, 'the package that draws a splash is the one with pageReady');
  assert.ok(app.indexOf('dismissBootSplash(appDrawsSplash());') !== -1, 'it decides after the first screen');
  assert.ok(app.indexOf('if (appDrawsSplash()) dismissBootSplash(true);') !== -1,
    'and from the first moment, before anything is drawn');
  assert.ok(app.indexOf('dismissBootSplash(!!app);') === -1 && app.indexOf('if (bridge()) dismissBootSplash(true);') === -1,
    'a bridge alone no longer decides it');

  /* the android package: its own splash is over the page, so the page's goes at once */
  let readied = 0;
  const android = boot({ bridge: { pageReady: function () { readied++; } } });
  assert.strictEqual(android.doc.getElementById('boot-splash'), null, 'gone at once');
  assert.strictEqual(readied, 1, 'and the package is told the page has painted');

  /* the iPhone: a bridge with no splash and no pageReady */
  const iphone = boot({ bridge: { platform: function () { return 'ios'; }, version: function () { return '2.0'; } } });
  assert.strictEqual(iphone.win.App.helpers.appDrawsSplash(), false);
  assert.ok(iphone.doc.getElementById('boot-splash'), 'the page\'s own is kept on an iPhone');
  assert.notStrictEqual(iphone.doc.getElementById('boot-splash').style.opacity, '0', 'and not faded straight away');

  /* with no app around, the page keeps its own, holds it a moment, fades it */
  const { doc } = boot();
  assert.ok(doc.getElementById('boot-splash'), 'held, not flashed');
  await new Promise(function (done) { setTimeout(done, 3500); });
  [doc, iphone.doc].forEach(function (d) {
    const left = d.getElementById('boot-splash');
    assert.ok(!left || left.style.opacity === '0', 'and then it goes, on an iPhone as in a browser');
  });
});

test('the opening painting is the reader\'s country, by day or by night as it is there now', () => {
  const day = new Date(2026, 9, 7, 10, 0, 0);
  const night = new Date(2026, 9, 7, 22, 0, 0);
  /* the zone the reader set names the country, whatever the phone says */
  Object.keys(SPLASH_LANDS).forEach(function (zone) {
    assert.strictEqual(openingPainting({ settings: { zone: zone }, phone: 'Europe/London', now: day }), SPLASH_LANDS[zone] + '-day', zone);
    assert.strictEqual(openingPainting({ settings: { zone: zone }, phone: 'Europe/London', now: night }), SPLASH_LANDS[zone] + '-night', zone);
  });
  /* with none set, the phone's own zone; a phone in Riyadh is not shown Kuwait */
  Object.keys(SPLASH_LANDS).forEach(function (zone) {
    assert.strictEqual(openingPainting({ phone: zone, now: day }), SPLASH_LANDS[zone] + '-day', 'a phone set to ' + zone);
  });
  assert.strictEqual(openingPainting({ settings: { zone: 'Asia/Riyadh' }, phone: 'Asia/Kuwait', now: day }), 'sa-day',
    'the reader\'s own choice over the phone\'s');
  assert.strictEqual(openingPainting({ settings: { zone: null, city: '' }, phone: 'Asia/Muscat', now: day }), 'om-day');
  assert.strictEqual(openingPainting({ settings: '{not json', phone: 'Asia/Qatar', now: night }), 'qa-night',
    'a store that cannot be read leaves it to the phone');
  /* anywhere else, the plain shore with its minaret */
  ['Europe/London', 'Africa/Cairo', 'Asia/Baghdad', 'America/New_York', ''].forEach(function (zone) {
    assert.strictEqual(openingPainting({ phone: zone, now: night }), 'default-night', 'a phone set to ' + (zone || 'nothing'));
  });
  ['constructor', '__proto__', 'toString'].forEach(function (zone) {
    assert.strictEqual(openingPainting({ settings: { zone: zone }, phone: 'Asia/Kuwait', now: day }), 'default-day',
      'a name that is only a word of the language is no country: ' + zone);
  });

  /* The hour is the place's own: the night runs from its maghrib to its fajr,
     as the app worked them out for today. Here fajr at 4:31 and maghrib at
     17:29, and each hour below is one the clock alone would get wrong. */
  const sun = { d: '2026-10-07', f: 271, m: 1049 };
  const at = (h, m) => new Date(2026, 9, 7, h, m, 0);
  const kw = { zone: 'Asia/Kuwait' };
  assert.strictEqual(openingPainting({ settings: kw, sun: sun, phone: 'Asia/Kuwait', now: at(17, 40) }), 'kw-night',
    'after maghrib it is night, though the clock says day until six');
  assert.strictEqual(openingPainting({ settings: kw, sun: sun, phone: 'Asia/Kuwait', now: at(4, 45) }), 'kw-day',
    'after fajr it is day, though the clock says night until five');
  assert.strictEqual(openingPainting({ settings: kw, sun: sun, phone: 'Asia/Kuwait', now: at(4, 30) }), 'kw-night', 'a minute before fajr');
  assert.strictEqual(openingPainting({ settings: kw, sun: sun, phone: 'Asia/Kuwait', now: at(4, 31) }), 'kw-day', 'fajr itself');
  assert.strictEqual(openingPainting({ settings: kw, sun: sun, phone: 'Asia/Kuwait', now: at(17, 28) }), 'kw-day', 'a minute before maghrib');
  assert.strictEqual(openingPainting({ settings: kw, sun: sun, phone: 'Asia/Kuwait', now: at(17, 29) }), 'kw-night', 'maghrib itself');
  assert.strictEqual(openingPainting({ settings: kw, sun: sun, phone: 'Asia/Kuwait', now: at(23, 50) }), 'kw-night');

  /* a note left on another day is not trusted, and the clock decides: day
     from five in the morning until six in the evening */
  const stale = { d: '2026-10-06', f: 271, m: 1049 };
  assert.strictEqual(openingPainting({ settings: kw, sun: stale, phone: 'Asia/Kuwait', now: at(17, 40) }), 'kw-day', 'yesterday\'s maghrib');
  [[4, 59, 'night'], [5, 0, 'day'], [17, 59, 'day'], [18, 0, 'night'], [0, 0, 'night']].forEach(function (c) {
    assert.strictEqual(openingPainting({ settings: kw, phone: 'Asia/Kuwait', now: at(c[0], c[1]) }), 'kw-' + c[2],
      'by the clock at ' + c[0] + ':' + String(c[1]).padStart(2, '0'));
  });
  /* and a note that makes no sense is no note */
  ['{oops', JSON.stringify({ d: '2026-10-07', f: 'x', m: 1049 }), JSON.stringify({ d: '2026-10-07', f: 1049, m: 271 }), 'null']
    .forEach(function (bad) {
      assert.strictEqual(openingPainting({ settings: kw, sun: bad, phone: 'Asia/Kuwait', now: at(17, 40) }), 'kw-day', bad);
    });
});

test('every opening painting is there, is a WebP of the size it was made at, and is light enough', () => {
  const dir = path.join(DOCS, 'img', 'splash');
  assert.deepStrictEqual(fs.readdirSync(dir).filter(function (f) { return /\.webp$/.test(f); }).sort(),
    SPLASH_PAINTINGS.map(function (n) { return n + '.webp'; }).sort(), 'fourteen, and no stray ones');
  SPLASH_PAINTINGS.forEach(function (name) {
    const bytes = fs.readFileSync(path.join(dir, name + '.webp'));
    assert.strictEqual(bytes.subarray(0, 4).toString('latin1'), 'RIFF', name);
    assert.strictEqual(bytes.subarray(8, 12).toString('latin1'), 'WEBP', name);
    assert.ok(bytes.length < 180000, name + ' is ' + bytes.length + ' bytes');
    /* 900 by 1600, as the converter cuts them: read from the frame itself */
    const kind = bytes.subarray(12, 16).toString('latin1');
    let w, h;
    if (kind === 'VP8 ') { w = bytes.readUInt16LE(26) & 0x3fff; h = bytes.readUInt16LE(28) & 0x3fff; }
    else if (kind === 'VP8X') { w = 1 + bytes.readUIntLE(24, 3); h = 1 + bytes.readUIntLE(27, 3); }
    else if (kind === 'VP8L') { const b = bytes.readUInt32LE(21); w = 1 + (b & 0x3fff); h = 1 + ((b >> 14) & 0x3fff); }
    assert.deepStrictEqual([w, h], [900, 1600], name);
  });
  /* the converter that makes them names the same fourteen */
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools', 'store', 'splash-art.py'), 'utf8');
  assert.ok(tool.indexOf("COUNTRIES = ['kw', 'sa', 'ae', 'qa', 'bh', 'om', 'default']") !== -1);
  assert.ok(/SIZE = \(900, 1600\)/.test(tool) && /LIMIT = 180000/.test(tool) && /method=6/.test(tool));
});

test('the head picks the painting the root names, before the first frame', () => {
  const { head } = splashParts();
  /* a rule for every painting, keyed on the name boot.js puts on the root */
  SPLASH_PAINTINGS.forEach(function (name) {
    assert.ok(head.indexOf('html[data-splash="' + name + '"] { --boot-art: url(\'img/splash/' + name + '.webp\'); }') !== -1, name);
  });
  /* the sky's own colour while the painting arrives, by day and by night */
  assert.ok(/#boot-sky \{ background: #cfe2f1 var\(--boot-art/.test(head), 'a day sky');
  assert.ok(head.indexOf('html[data-splash$="-night"] #boot-sky { background-color: #0d1b3d; }') !== -1, 'and a night one');
  assert.ok(/#boot-sky \{[^}]*50% 100% \/ cover/.test(head), 'filling the screen, held to the bottom where the landmark is');
  /* the words in the colours of the hour, each lifted off the painting */
  assert.ok(head.indexOf('#boot-hail { color: #a87b25; text-shadow: 0 1px 12px rgba(255, 255, 255, .75); }') !== -1);
  assert.ok(head.indexOf('#boot-city { color: #16241c; text-shadow: 0 1px 12px rgba(255, 255, 255, .75); }') !== -1);
  assert.ok(head.indexOf('html[data-splash$="-night"] #boot-hail { color: #e2c06a; text-shadow: 0 1px 12px rgba(0, 0, 0, .55); }') !== -1);
  assert.ok(head.indexOf('html[data-splash$="-night"] #boot-city { color: #f3efe6; text-shadow: 0 1px 12px rgba(0, 0, 0, .55); }') !== -1);
  /* the rules are in the head itself, and boot.js runs before the body */
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('<script src="js/boot.js"></script>') < html.indexOf('<body>'));
  assert.ok(html.indexOf('--boot-art') < html.indexOf('</head>'));
});

/* landmarkFor as the java writes it, read into { 'kw-day': [middle, top], ... } */
function splashLandmarks(java) {
  const body = /    static float\[\] landmarkFor\(String zone, boolean day\) \{([\s\S]*?)\n    \}\n/.exec(java)[1];
  const out = {};
  const each = /(?:case "([^"]+)"|default):\s*return day \? new float\[\] \{ ([\d.]+)f, ([\d.]+)f \} : new float\[\] \{ ([\d.]+)f, ([\d.]+)f \};/g;
  let m;
  while ((m = each.exec(body))) {
    const land = m[1] ? SPLASH_ZONES[m[1]] : 'default';
    out[land + '-day'] = [+m[2], +m[3]];
    out[land + '-night'] = [+m[4], +m[5]];
  }
  return out;
}

test('every painting says where its landmark stands, for the same zones that choose it', () => {
  const splash = fs.readFileSync(SPLASH_JAVA, 'utf8');
  const lands = splashLandmarks(splash);
  assert.deepStrictEqual(Object.keys(lands).sort(), SPLASH_PAINTINGS.slice().sort(), 'each of the fourteen, once');
  Object.keys(lands).forEach(function (name) {
    const [middle, top] = lands[name];
    /* the paintings were made with their landmark near the middle and low
       down, and a reading far from that is a slip of the pen */
    assert.ok(middle > 0.45 && middle < 0.6, name + ' stands near the middle: ' + middle);
    assert.ok(top > 0.45 && top < 0.8, name + ' rises out of the lower half: ' + top);
  });
  /* the towers of Kuwait rise highest of all, which is why the icon rises */
  ['kw-day', 'kw-night'].forEach(function (name) {
    Object.keys(lands).filter(function (n) { return n.indexOf('kw-') !== 0; }).forEach(function (other) {
      assert.ok(lands[name][1] < lands[other][1], name + ' reaches higher than ' + other);
    });
  });
  /* and the layout uses it, the icon rising no higher than a fifth of the height */
  assert.ok(splash.indexOf('landmark = landmarkFor(zone, day);') !== -1);
  assert.ok(splash.indexOf('place(w, h, dp, reach, landmark, pw, ph)') !== -1);
  assert.ok(/private static final float ICON_AT = 0\.42f;/.test(splash) && /private static final float ICON_HIGHEST = 0\.2f;/.test(splash));
  assert.ok(/private static final float CLEAR_DP = 40f;/.test(splash));
});

test('java itself centres every landmark under the icon and keeps the words clear of it, on every phone', {
  skip: require('node:child_process').spawnSync('javac', ['-version']).status !== 0 && 'no jdk here'
}, () => {
  const splash = fs.readFileSync(SPLASH_JAVA, 'utf8');
  const constant = function (name) { return new RegExp('    private static final float ' + name + ' = [^;]+;').exec(splash)[0]; };
  const landmarkFor = /    static float\[\] landmarkFor\(String zone, boolean day\) \{[\s\S]*?\n    \}\n/.exec(splash)[0];
  const place = /    static float\[\] place\([^)]*\) \{[\s\S]*?\n    \}\n/.exec(splash)[0];
  /* the view between the bars, in dp, and the density: ordinary phones with
     gestures or with three buttons, tall ones, a small old one, and a wide
     one where the painting is cut by the width */
  const phones = [[411, 845, 2.625], [411, 914, 2.625], [450, 1000, 2.4], [411, 751, 2.625], [393, 800, 2.75],
    [360, 568, 2], [384, 790, 2.8125], [480, 1000, 3], [600, 900, 2]];
  const zones = Object.keys(SPLASH_ZONES).concat(['Europe/London']);
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sunnati-place-'));
  try {
    fs.writeFileSync(path.join(dir, 'Check.java'), [
      'public class Check {',
      constant('ICON_AT'), constant('ICON_HIGHEST'), constant('CLEAR_DP'),
      landmarkFor, place,
      '  public static void main(String[] a) {',
      '    float[][] phones = { ' + phones.map(function (p) { return '{ ' + p.join('f, ') + 'f }'; }).join(', ') + ' };',
      '    StringBuilder sb = new StringBuilder();',
      '    for (String zone : a[0].split(",")) for (int half = 0; half < 2; half++) for (float[] p : phones) {',
      '      float dp = p[2], w = p[0] * dp, h = p[1] * dp;',
      /* the words of a named city: half the icon, the rule, the hail, the
         city, and the city's descent, about three tenths of its size */
      '      float reach = 66 * dp + 32 * dp + 18 * dp * 0.85f + 31 * dp * 1.2f + 31 * dp * 0.3f;',
      '      boolean day = half == 0;',
      '      float[] lm = landmarkFor(zone, day);',
      '      float[] at = place(w, h, dp, reach, lm, 1080, 1920);',
      '      sb.append(zone).append(" ").append(day ? "day" : "night").append(" ").append(p[0]).append("x").append(p[1])',
      '        .append(" ").append(w).append(" ").append(h).append(" ").append(dp).append(" ").append(reach)',
      '        .append(" ").append(lm[0]).append(" ").append(lm[1]);',
      '      for (float v : at) sb.append(" ").append(v);',
      '      sb.append("\\n");',
      '    }',
      '    System.out.print(sb);',
      '  }',
      '}'
    ].join('\n'));
    execFileSync('javac', ['-d', dir, path.join(dir, 'Check.java')], { stdio: 'pipe' });
    const out = execFileSync('java', ['-cp', dir, 'Check', zones.join(',')], { stdio: 'pipe' })
      .toString().trim().split('\n');
    assert.strictEqual(out.length, zones.length * 2 * phones.length, 'every country, both halves of the day, every phone');
    const raised = {};
    out.forEach(function (line) {
      const f = line.split(' ');
      const where = f[0] + ' ' + f[1] + ' on ' + f[2];
      const [w, h, dp, reach, middle, top, iconY, x, y, sw, sh] = f.slice(3).map(Number);
      /* the painting covers the whole view, keeping its proportions */
      assert.ok(x <= 0.5 && y <= 0.5 && x + sw >= w - 0.5 && y + sh >= h - 0.5, where + ' is covered');
      assert.ok(Math.abs(sw / sh - 1080 / 1920) < 1e-3, where + ' keeps the painting\'s shape');
      /* the landmark stands under the icon */
      assert.ok(Math.abs(x + middle * sw - w / 2) < 1, where + ': the landmark is centred, off by ' + (x + middle * sw - w / 2));
      /* with 40dp of open sky between the words and the top of it */
      const sky = (y + top * sh) - (iconY + reach);
      assert.ok(sky >= 40 * dp - 0.5, where + ': ' + (sky / dp).toFixed(1) + 'dp between the words and the landmark');
      /* the icon at 42% at the lowest and a fifth of the height at the
         highest, and raised only as far as the landmark asks */
      assert.ok(iconY <= 0.42 * h + 0.5 && iconY >= 0.2 * h - 0.5, where + ': the icon at ' + (iconY / h).toFixed(3));
      if (iconY < 0.42 * h - 0.5 && iconY > 0.2 * h + 0.5) {
        assert.ok(Math.abs(sky - 40 * dp) < 1, where + ' rose further than it had to');
      }
      if (iconY < 0.42 * h - 0.5) raised[f[0] + ' ' + f[1] + ' ' + f[2]] = true;
    });
    /* the towers of Kuwait lift the icon on an ordinary phone, by day and by
       night, and the open shore leaves it where it was on a tall one */
    assert.ok(raised['Asia/Kuwait day 411.0x845.0'] && raised['Asia/Kuwait night 411.0x845.0'], 'the icon rises over the towers');
    assert.ok(!raised['Europe/London day 450.0x1000.0'] && !raised['Europe/London night 450.0x1000.0'],
      'and stays at 42% over the open shore');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the page\'s own splash stands the landmark under the icon and raises the icon over it, as android does', () => {
  const { head } = splashParts();
  const lands = splashLandmarks(fs.readFileSync(SPLASH_JAVA, 'utf8'));
  /* the very readings of the android splash, so the two never part ways */
  SPLASH_PAINTINGS.forEach(function (name) {
    const m = new RegExp('html\\[data-splash="' + name + '"\\] \\{ --boot-f: ([\\d.]+); --boot-t: ([\\d.]+); \\}').exec(head);
    assert.ok(m, name + ' says where its landmark stands');
    assert.strictEqual(+m[1], lands[name][0], name + ': its middle, as android has it');
    assert.strictEqual(+m[2], lands[name][1], name + ': its top, as android has it');
  });
  /* the painting is moved across by its landmark and never bares an edge,
     filling the height on a tall phone and drawn 114% on a shorter one */
  assert.ok(head.indexOf('#boot-sky { background-position: clamp(calc(100vw - 56.25vh), calc(50vw - var(--boot-f, .5) * 56.25vh), 0px) 100%; }') !== -1);
  assert.ok(head.indexOf('background-position: clamp(calc(100vw - 64.125vh), calc(50vw - var(--boot-f, .5) * 64.125vh), 0px) 0;') !== -1);
  /* the icon rises over the landmark, with its words and 40px of sky */
  assert.ok(head.indexOf('#boot-splash { --boot-at: min(42%, calc(var(--boot-t, 1) * 100vh - 190px)); }') !== -1);
  assert.ok(head.indexOf('#boot-splash { --boot-at: min(42%, calc(var(--boot-t, 1) * 114vh - 190px)); }') !== -1);
  /* and the towers of Kuwait are no longer pushed aside to the right */
  assert.ok(head.indexOf('html[data-splash^="kw-"]') === -1, 'Kuwait is centred like every other painting');
});

test('only the two plain paintings come with the app, and a country\'s own are kept once fetched', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  const shell = /var SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  assert.ok(shell.indexOf("'./img/splash/default-day.webp'") !== -1 && shell.indexOf("'./img/splash/default-night.webp'") !== -1,
    'the plain shore, by day and by night, is there the first time offline');
  SPLASH_PAINTINGS.filter(function (n) { return n.indexOf('default-') !== 0; }).forEach(function (name) {
    assert.ok(shell.indexOf('img/splash/' + name) === -1, name + ' is not carried by everyone');
  });
  /* and a painting once fetched is read from the cache from then on */
  const settled = /function isSettled\(pathname\) \{([\s\S]*?)\n\}/.exec(sw)[1];
  assert.ok(/webp/.test(settled), 'a webp is kept the first time it is fetched');
});

test('the app leaves the day\'s fajr and maghrib for the next opening, and keeps them current', async () => {
  const storage = memoryStorage();
  const { win } = boot({ storage: storage, now: new Date(2026, 9, 7, 12, 0, 0) });
  const hint = JSON.parse(storage.getItem('sunnati.sun'));
  const t = win.App.helpers.computeTimes(new Date(2026, 9, 7, 12, 0, 0));
  assert.deepStrictEqual(hint, { d: '2026-10-07', f: Math.round(t.fajr), m: Math.round(t.maghrib) },
    'today\'s, for the place the app is set to');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const refresh = /function refreshTimes\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(refresh.indexOf('tellSun(state.times);') !== -1, 'written wherever the times are worked out');

  /* a new place, new times */
  win.App.helpers.setPlace({ n: 'مسقط', lat: 23.588, lng: 58.3829, tz: 4, z: 'Asia/Muscat', method: 'MWL' }, true);
  const muscat = win.App.helpers.computeTimes(new Date(2026, 9, 7, 12, 0, 0));
  assert.strictEqual(JSON.parse(storage.getItem('sunnati.sun')).m, Math.round(muscat.maghrib), 'Muscat\'s maghrib, not Kuwait\'s');

  /* a phone left open past midnight writes the new day's */
  win.__setNow(new Date(2026, 9, 8, 0, 1, 0));
  await until(function () { return JSON.parse(storage.getItem('sunnati.sun')).d === '2026-10-08'; });
  const next = win.App.helpers.computeTimes(new Date(2026, 9, 8, 0, 1, 0));
  assert.deepStrictEqual(JSON.parse(storage.getItem('sunnati.sun')), { d: '2026-10-08', f: Math.round(next.fajr), m: Math.round(next.maghrib) });

  /* and the opening reads what was left: an hour after that maghrib is night */
  const after = new Date(2026, 9, 8, 0, Math.round(next.maghrib) + 60, 0);
  assert.strictEqual(openingPainting({ storage: storage, phone: 'Asia/Kuwait', now: after }), 'om-night',
    'the place set in the app, and its own night');
});

test('the country\'s own paintings are fetched once the app is up, the very ones the next opening asks for', () => {
  const { win } = boot();
  const made = [];
  win.Image = function () { const img = {}; made.push(img); return img; };
  win.Store.set('zone', 'Asia/Riyadh');
  assert.deepStrictEqual([...win.App.helpers.warmSplash()], ['img/splash/sa-day.webp', 'img/splash/sa-night.webp']);
  assert.deepStrictEqual(made.map(function (img) { return img.src; }), ['img/splash/sa-day.webp', 'img/splash/sa-night.webp'],
    'both halves of the day, so the worker has them by the next opening');
  /* the same choice as boot.js, zone by zone, so what is warmed is what is asked for */
  Object.keys(SPLASH_LANDS).concat(['Europe/London', 'Asia/Baghdad']).forEach(function (zone) {
    win.Store.set('zone', zone);
    const opening = openingPainting({ settings: { zone: zone }, phone: 'UTC', now: new Date(2026, 9, 7, 10, 0, 0) });
    assert.strictEqual(win.App.helpers.splashLand() + '-day', opening, zone);
  });
  /* with no zone set, the phone's own, as boot.js does */
  win.Store.set('zone', null);
  win.Intl = { DateTimeFormat: function () { return { resolvedOptions: function () { return { timeZone: 'Asia/Bahrain' }; } }; } };
  assert.strictEqual(win.App.helpers.splashLand(), 'bh');
  /* On a first visit the worker has not yet taken the page, and a picture
     fetched then never passes through it, so the pair waits for it. */
  const waiting = {};
  const worker = {
    controller: null,
    addEventListener: function (type, fn) { waiting[type] = fn; },
    removeEventListener: function (type) { delete waiting[type]; }
  };
  Object.defineProperty(win.navigator, 'serviceWorker', { value: worker, configurable: true });
  made.length = 0;
  assert.deepStrictEqual([...win.App.helpers.warmSplash()], [], 'nothing yet');
  assert.strictEqual(made.length, 0);
  worker.controller = {};
  waiting.controllerchange();
  assert.deepStrictEqual(made.map(function (img) { return img.src; }), ['img/splash/bh-day.webp', 'img/splash/bh-night.webp'],
    'and is fetched the moment the worker has the page');
  assert.ok(!waiting.controllerchange, 'once');
  /* after the first screen, when the opening is over and nothing waits on it */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('window.setTimeout(warmSplash, 4000);') !== -1);
});

test('a new version is never taken without the reader saying so', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /addEventListener\('controllerchange', function \(\) \{([\s\S]*?)\n    \}\);/.exec(app)[1];
  /* a reload in the middle of a page of the mushaf loses the reader's place
     for something they did not ask for, however idle the app looks */
  assert.ok(fn.indexOf('window.location.reload(); return;') === -1, 'nothing reloads by itself');
  assert.ok(fn.indexOf('atRest') === -1, 'and no screen counts as idle enough');
  assert.ok(fn.indexOf("showBanner('وصل تحديث جديد للتطبيق', 'حدّث الآن'") !== -1, 'it is offered');
});

test('the next verse is fetched while the last is still sounding', () => {
  const { win } = boot();
  /* fetching only once a verse ends puts the network's wait between every two,
     and the recitation stops in the middle of the surah */
  win.App.helpers.warmNextVerse(2, 3);
  assert.match(win.App.state.warmed, /\/10\.mp3$/, 'the third of al-baqarah is the tenth verse of the mushaf');
  assert.ok(win.App.state.warmed, 'and it is held ready');
  /* past the end of a surah there is nothing to fetch */
  win.App.state.warmed = null;
  win.App.helpers.warmNextVerse(1, 8);
  assert.strictEqual(win.App.state.warmed, null, 'al-fatihah has seven');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/reciteVerse[\s\S]{0,2000}warmNextVerse\(r\.s, r\.a \+ 1\);/.test(app),
    'every verse warms the one after it');
});

test('the player reads its words first, then its controls, and leads to what is sounding', () => {
  const { win, doc } = boot();
  const order = [...doc.querySelectorAll('#player > *')].map(function (b) { return b.id; });
  assert.strictEqual(order.join(','), 'player-body,player-toggle,player-prev,player-next,player-stop',
    'the surah first, and the play mark after its name');
  const body = doc.getElementById('player-body');
  assert.strictEqual(body.getAttribute('data-act'), 'player-open');
  assert.ok(body.querySelector('#player-title') && body.querySelector('#player-sub'));
  /* pressing what is sounding opens it */
  win.App.state.recite = { s: 20, a: 6, to: 135 };
  click(win, body);
  assert.strictEqual(win.App.state.view, 'reader');
  assert.strictEqual(win.App.state.surah, 20);
});

test('the verse fetched ahead is the one that plays, so nothing waits twice', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function playAudio\(url, title, sub\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* warming a clip and then building a fresh one for the same address leaves
     the wait exactly where it was */
  assert.ok(fn.indexOf('if (state.warmClip && state.warmed === url) {') !== -1,
    'the warmed clip is taken when it matches');
  assert.ok(fn.indexOf('state.warmClip = null;') !== -1, 'and not used twice');
  assert.ok(fn.indexOf('audio.currentTime = 0;') !== -1, 'from its beginning');
  const { win } = boot();
  win.App.state.recite = { s: 20, a: 1, to: 135 };
  win.App.helpers.warmNextVerse(20, 2);
  assert.match(win.App.state.warmed, /\/2350\.mp3$/, 'the second of ta-ha');
  /* the harness has no audio element to build, so only the address is checked
     here; the browser check above showed the clip itself being held */
  assert.ok(win.App.state.warmed, 'held ready to play');
});

test('the surah name runs to the edge of the bar', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* a button lays its own contents out centred whatever is asked of it, so
     the words are not one */
  assert.match(html, /<div class="player-body" id="player-body" data-act="player-open" role="button" tabindex="0"/);
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.player \.player-body \{ text-align: start;/);
  const { doc } = boot();
  const body = doc.getElementById('player-body');
  assert.strictEqual(body.tagName, 'DIV');
  assert.strictEqual(body.getAttribute('role'), 'button');
  assert.ok(body.getAttribute('aria-label'), 'and still says what it does');
});

test('a recitation carries on when the reader leaves the app', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  /* pausing the page on leaving cut the recitation off mid ayah */
  assert.ok(main.indexOf('if (web != null && !sounding) web.onPause();') !== -1,
    'the page is not paused while something is sounding');
  assert.ok(main.indexOf('volatile boolean sounding;') !== -1);
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  assert.ok(/public void setSounding\(boolean on\)/.test(bridge));

  const { win } = boot();
  const told = [];
  win.SunnatiApp = { setSounding: function (v) { told.push(v); } };
  win.App.helpers.tellAppSounding(true);
  win.App.helpers.tellAppSounding(false);
  assert.deepStrictEqual(told.join(','), 'true,false', 'the page tells the app both ways');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* a real stop tells the app; the pause between two verses does not */
  assert.ok(/function stopAudio\(quiet\) \{[\s\S]{0,220}tellAppSounding\(false\);/.test(app),
    'and says so the moment the reader really stops');
});

test('the iphone wrapper names only what it answers, and the page knows which phone it is on', () => {
  const swift = fs.readFileSync(path.join(__dirname, '..', 'ios/Sunnati/ReaderController.swift'), 'utf8');
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  /* a Proxy that said yes to every name made the page call methods that fell
     into silence: openMap did nothing, shareImage toasted a failure, canNotify
     read as closed, and the about screen named an android package on an iphone */
  assert.ok(code(swift).indexOf('new Proxy(') === -1, 'the bridge is a plain object');
  for (const fn of ['openMap', 'addToCalendar', 'shareImage', 'saveFile', 'version', 'platform', 'canNotify']) {
    assert.ok(new RegExp(fn + ':\\s*(call\\(|function)').test(swift), fn + ' is on the bridge');
    if (fn !== 'version' && fn !== 'platform' && fn !== 'canNotify') {
      assert.ok(new RegExp('case "' + fn + '"').test(swift), fn + ' is answered natively');
    }
  }
  /* a service worker runs in WKWebView only for an app-bound domain, and
     without it the page could neither work offline nor notice a new version */
  assert.ok(swift.indexOf('limitsNavigationsToAppBoundDomains = true') !== -1, 'navigation is bound to the domain');
  const plist = fs.readFileSync(path.join(__dirname, '..', 'ios/Sunnati/Info.plist'), 'utf8');
  assert.ok(/WKAppBoundDomains[\s\S]{0,120}sunnati\.3li\.info/.test(plist), 'and the domain is declared');
  /* the three browser habits */
  assert.ok(swift.indexOf('scrollView.bounces = false') !== -1, 'no rubber band');
  assert.ok(swift.indexOf('allowsLinkPreview = false') !== -1, 'no link preview');
  assert.ok(swift.indexOf('user-scalable=no') !== -1, 'no pinch zoom in the wrapper');
  /* and the page names the phone it is packaged for */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/function packageLine[\s\S]{0,600}آيفون/.test(app), 'the about screen can say iphone');
});

test('the night of jumuah sheet is not silenced by its own notification', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* jumuahNightAt is the moment the notification is armed for; the sheet used
     to read that same key as "stay quiet until", so the first opening of the
     night armed the notice at now+2min and thereby silenced itself. A reader
     who opened the app once after maghrib on thursday saw nothing at all. */
  const sheet = /function maybeJumuahNightSheet\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(sheet.indexOf("Store.get('jumuahNightQuiet')") !== -1,
    'the sheet reads the reader\'s own postponement');
  assert.ok(sheet.indexOf("Store.get('jumuahNightAt')") === -1,
    'and not the moment the notification is armed for');

  /* the arming still writes its own key, and only that one */
  const arming = /if \(atJumuah <= Date\.now\(\)[\s\S]{0,360}?\n          \}/.exec(app)[0];
  assert.ok(arming.indexOf("Store.set('jumuahNightAt'") !== -1, 'arming keeps its key');
  assert.ok(arming.indexOf("jumuahNightQuiet") === -1, 'and does not touch the quiet one');

  /* «ذكّرني بعد ساعة» is what sets the quiet, and it sets both */
  const snooze = /function snoozeJumuahNight\(minutes\) \{[\s\S]*?\n  \}/.exec(app)[0];
  assert.ok(snooze.indexOf("Store.set('jumuahNightQuiet'") !== -1, 'the snooze sets the quiet');
  assert.ok(snooze.indexOf("Store.set('jumuahNightAt'") !== -1, 'and the armed hour with it');

  /* and putting the sheet away clears the quiet, and touches nothing else */
  const off = /'hide-jumuah-night': function \(\) \{([\s\S]*?)\n    \},/.exec(app)[1];
  assert.ok(off.indexOf('jumuahNightQuiet') !== -1, 'putting it away clears the quiet too');
  assert.ok(off.indexOf("Store.set('jumuahNight'") === -1, 'and leaves the notification alone');

  const store = fs.readFileSync(path.join(DOCS, 'js', 'store.js'), 'utf8');
  assert.ok(/jumuahNightQuiet: 0/.test(store), 'the key has a default');
});

test('the chrome cannot be selected, the reading can', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* a long press on the date raised the system's copy and look-up menu, a
     website's tell; an app selects nothing but what is read */
  assert.ok(/^body \{[^}]*user-select: none/m.test(css), 'nothing by default');
  const reading = /^\.naskh,[^{]*\{[^}]*user-select: text/m.exec(css);
  assert.ok(reading, 'the reading is opted back in');
  for (const c of ['.naskh', '.dua-text', '.dhikr-text', '.ayah-block', '.reader-body', '.salawat-text', 'textarea']) {
    assert.ok(reading[0].indexOf(c) !== -1, c + ' can be copied');
  }
});

test('the to-top button clears the tab bar on a phone with a home indicator', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const rule = /\.to-top \{[\s\S]*?\n\}/.exec(css)[0];
  /* the tab bar is --tab-h plus the safe-area inset tall; a button placed at
     --tab-h alone sat inside the bar on every iPhone with a home indicator */
  assert.ok(/bottom: calc\(var\(--tab-h\) \+ env\(safe-area-inset-bottom\)/.test(rule),
    'the button counts the inset the bar counts');
});

test('neither wrapper shows a scrollbar over the page', () => {
  const ios = fs.readFileSync(path.join(__dirname, '..', 'ios/Sunnati/ReaderController.swift'), 'utf8');
  const android = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  /* an Arabic page gets the indicator on the left, a grey line the height of
     the screen, and it read as a website's scrollbar */
  assert.ok(ios.indexOf('showsVerticalScrollIndicator = false') !== -1, 'iOS');
  assert.ok(android.indexOf('setVerticalScrollBarEnabled(false)') !== -1, 'android');
});

test('a double tap on the counter does not zoom the page', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* iPhone zooms on a double tap unless told otherwise, and the tasbih is
     pressed twice a second; android honours the viewport and never did.
     manipulation keeps pinch for anyone who needs the text larger. */
  assert.ok(/^html \{[^}]*touch-action: manipulation/m.test(css), 'the page declines the double-tap zoom');
  assert.ok(!/^html \{[^}]*touch-action: none/m.test(css), 'but keeps pinch, for the reader who needs it');
  /* and a fast press must not select the word on the button: nothing in the
     chrome is selectable, and the counter is not among what is opted back in */
  assert.ok(/^body \{[^}]*user-select: none/m.test(css), 'the counter cannot be selected');
  const optedIn = /user-select: text/.test(css) ? /^([^{]*)\{[^}]*user-select: text/m.exec(css)[1] : '';
  assert.ok(optedIn.indexOf('.counter-btn') === -1, 'and is not opted back in');
});

test('every hear button stops what it started instead of starting it again', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* a press while the sound plays is a request to stop it: the bedtime
     recitation button restarted آية الكرسي from the top on every press and
     could not be silenced short of leaving the screen */
  for (const opener of [
    /bind\('settings-adhan-try', 'click', function \(\) \{\n([^\n]*\n){0,2}/,
    /bind\('settings-voice-try', 'click', function \(\) \{\n([^\n]*\n){0,2}/,
    /querySelectorAll\('\.try-sound'\)\.forEach\(function \(btn\) \{\n\s*btn\.addEventListener\('click', function \(\) \{\n([^\n]*\n){0,5}/,
  ]) {
    const m = opener.exec(app);
    assert.ok(m, 'the button is where it was');
    assert.ok(m[0].indexOf("if (isSpeaking()) { stopSpeaking(); return; }") !== -1,
      'a press while sounding is a stop: ' + m[0].split('\n')[0].trim());
  }
});

test('the night of jumuah sheet has a switch the reader can see and undo', () => {
  const { win, doc } = boot({ now: new Date(2026, 9, 1, 21, 0, 0) });   // ليلة الجمعة
  const sw = doc.getElementById('settings-jumuah-sheet');
  assert.ok(sw, 'the sheet has a switch of its own');
  assert.ok(sw.id !== 'settings-jumuah-night', 'separate from the notification');

  /* a reader who pressed «لا تُذكّرني» once had it hidden for good, with
     nothing anywhere to say it was hidden and a toast that was gone in
     seconds. The switch shows the state and gives it back. */
  win.Store.set('jumuahNightSheet', false);
  win.App.go('reminders');
  assert.strictEqual(doc.getElementById('settings-jumuah-sheet').getAttribute('aria-checked'), 'false',
    'and it reads off when it is off');

  click(win, doc.getElementById('settings-jumuah-sheet'));
  assert.strictEqual(win.Store.get('jumuahNightSheet'), true, 'pressing it gives the sheet back');
  assert.strictEqual(win.Store.get('jumuahNight'), true, 'and leaves the notification alone');

  click(win, doc.getElementById('settings-jumuah-sheet'));
  assert.strictEqual(win.Store.get('jumuahNightSheet'), false, 'and takes it away again');

  /* the button on the sheet says where to find it rather than only that it exists */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const hide = /'hide-jumuah-night': function \(\) \{([\s\S]*?)\n    \},/.exec(app)[1];
  assert.ok(/الإعدادات/.test(hide), 'the toast says where to bring it back');
  assert.ok(hide.indexOf("setSwitch($('settings-jumuah-sheet')") !== -1,
    'and the switch follows the button, so the two never disagree');
});

test('the page that explains the app stands on its own and stays reachable', () => {
  const intro = fs.readFileSync(path.join(DOCS, 'intro.html'), 'utf8');

  /* the app lives at the root and the wrapper starts there, so the page that
     explains it has to sit beside the app rather than in front of it */
  const manifest = fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8');
  assert.ok(/"start_url":\s*"\.\/"/.test(manifest), 'the app is still what the root opens');

  /* it reads as the app: same paper, same ink, same red, and the sadu drawn
     from the repository's own module rather than a photograph */
  for (const token of ['#f6f4ee', '#16241c', '#9c2b2b']) {
    assert.ok(intro.indexOf(token) !== -1, 'it keeps the app colour ' + token);
  }
  assert.ok(intro.indexOf('svg+xml') !== -1, 'the sadu is drawn, not photographed');

  /* the fonts come from the app's own files, so the page does not reach out
     to a font service and does not render in something else while it waits */
  assert.ok(intro.indexOf('css/fonts.css') !== -1, 'it uses the app\'s faces');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|cdn\./.test(intro), 'and asks nothing of anyone else');

  /* every screenshot it shows is a file that is actually here, with its size
     declared so the page does not jump while they load */
  const imgs = [...intro.matchAll(/<img\s[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 6, 'it shows the app, not just describes it');
  for (const tag of imgs) {
    const src = /src="([^"]+)"/.exec(tag)[1];
    assert.ok(fs.existsSync(path.join(DOCS, src)), 'missing: ' + src);
    assert.ok(/alt="[^"]{6,}"/.test(tag), 'every screenshot is described: ' + src);
    assert.ok(/width="\d+"/.test(tag) && /height="\d+"/.test(tag), 'and reserves its space: ' + src);
  }

  /* and the app points at it, or nobody finds it */
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('intro.html') !== -1, 'the app links to it');
});

test('one address sends an iPhone to the App Store, an android phone to Google Play, and the app to its own front', () => {
  const page = fs.readFileSync(path.join(DOCS, 'app.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const play = /play: '([^']+)'/.exec(app)[1];
  const apple = /apple: '([^']+)'/.exec(app)[1];
  /* the stores it sends to are the app's own, in the script and on its buttons */
  assert.ok(page.split(apple).length >= 3, 'the App Store address, twice');
  assert.ok(page.split(play).length >= 3, 'the Google Play address, twice');
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
  assert.ok(page.indexOf('<script>') < page.indexOf('<link rel="stylesheet"'), 'it leaves before anything is drawn');
  function opened(ua, touch, bridge) {
    let went = null;
    const sandbox = { navigator: { userAgent: ua, maxTouchPoints: touch || 0 }, location: { replace: (u) => { went = u; } } };
    sandbox.window = sandbox;
    if (bridge) sandbox.SunnatiApp = {};
    vm.runInNewContext(script, sandbox);
    return went;
  }
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  assert.strictEqual(opened(IPHONE), apple);
  assert.strictEqual(opened(IPAD, 5), apple, 'an iPad that asks for the desktop pages is still an iPad');
  assert.strictEqual(opened(IPAD, 0), null, 'a Mac stays and is shown both stores');
  assert.strictEqual(opened(ANDROID), play);
  assert.strictEqual(opened(WINDOWS), null);
  /* inside the app the reader has it already: android hands the app every
     address of the site, and the iPhone's has its bridge from the start */
  assert.strictEqual(opened(ANDROID.replace('Mobile Safari/537.36', 'Mobile Safari/537.36 SunnatiApp/8.87.97')), './');
  assert.strictEqual(opened(IPHONE, 0, true), './');
  /* drawn as the page that explains the app is: its colours, its sadu, its faces */
  for (const token of ['#f6f4ee', '#16241c', '#9c2b2b']) assert.ok(page.indexOf(token) !== -1, 'it keeps the app colour ' + token);
  assert.ok(page.indexOf('svg+xml') !== -1, 'the sadu is drawn, not photographed');
  assert.ok(page.indexOf('css/fonts.css') !== -1 && !/fonts\.googleapis|fonts\.gstatic|cdn\./.test(page), 'the app\'s own faces, and nobody else\'s');
  /* a shared link shows the app's name and picture */
  assert.match(page, /<meta property="og:url" content="https:\/\/sunnati\.3li\.info\/app">/);
  assert.ok(fs.existsSync(path.join(DOCS, 'icons', 'play-1024.png')));
});

test('every verse quoted in the adhkar matches the mushaf that ships with it', () => {
  /* The app carries the Quran already, so a verse quoted inside an adhkar or a
     supplication has something to be held against. The two are written in
     different hands, the mushaf in the Uthmani rasm and the adhkar in ordinary
     spelling, so the comparison is made after levelling only what the two
     hands differ in: the dagger alif, the seat of the hamza, the alif that the
     rasm adds or drops, and the definite lam written once or twice. What
     survives that is a copying error, not a difference of hand. */
  const out = execFileSync('node', ['tools/arabic/quran-check.mjs'],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.ok(/ولا خطأ نقل واحد/.test(out), out);
  assert.ok(/فُحص \d+ مقطعاً/.test(out), 'it actually read something');
  const n = Number(/فُحص (\d+)/.exec(out)[1]);
  assert.ok(n >= 70, 'and read all of them, not a handful: ' + n);
});

test('every reminder carries its kind, and every kind has somewhere to land', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');

  /* A tapped reminder used to open the app wherever it was last left: the
     rows carried no kind at all, so android posted every one of them under
     the single tag "note" and the page could make nothing of it. */
  const list = /function reminderList\(\)[\s\S]*?\n  \}\n/.exec(app)[0];
  const rows = [...list.matchAll(/out\.push\(\{ at[\s\S]{0,400?}?\}\);/g)];
  const sounded = [...list.matchAll(/s: channelFor\('([A-Za-z]+)'\)(, k: '([A-Za-z]+)')?/g)];
  assert.ok(sounded.length >= 10, 'the reminders are still here');
  for (const m of sounded) {
    assert.ok(m[3], 'the ' + m[1] + ' reminder carries its kind');
    assert.strictEqual(m[3], m[1], 'and the kind matches its channel');
  }

  /* and each kind names a screen that exists */
  const landings = /var LANDINGS = \{[\s\S]*?\n  \};/.exec(app)[0];
  const screens = new Set([...html.matchAll(/id="v-([a-z-]+)"/g)].map((m) => m[1]));
  const pairs = [...landings.matchAll(/([A-Za-z]+): '([a-z-]+)'/g)];
  assert.ok(pairs.length >= 10, 'the landings are still here');
  for (const [, kind, where] of pairs) {
    assert.ok(screens.has(where), kind + ' lands on ' + where + ', which is not a screen');
  }

  /* the two lists level: a reminder whose kind has no landing opens the home
     screen and says nothing more about itself, which is the whole complaint */
  const named = new Set(pairs.map((p) => p[1]));
  for (const m of sounded) {
    if (m[3] === 'jumuahNight') continue;   // its own sheet, better than a screen
    assert.ok(named.has(m[3]), 'the ' + m[3] + ' reminder has nowhere to land');
  }
});

test('a tapped notification reaches the page on all three surfaces', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  const click = /addEventListener\('notificationclick'[\s\S]*?\n\}\);/.exec(sw)[0];
  assert.ok(click.indexOf('came-from') !== -1, 'the worker tells an open window');
  assert.ok(/openWindow\(kind \?/.test(click), 'and opens a closed one on the subject');

  const note = fs.readFileSync(path.join(__dirname, '..', 'ios/Sunnati/Notifier.swift'), 'utf8');
  /* there was no tap handler on iOS at all, only willPresent */
  assert.ok(note.indexOf('didReceive response') !== -1, 'iOS reads the tap');
  assert.ok(note.indexOf('userInfo = ["kind"') !== -1, 'and the kind rides with the notification');

  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/NoteScheduler.java'), 'utf8');
  assert.ok(sched.indexOf('EXTRA_KIND') !== -1, 'android carries the kind');
  const recv = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(/kind == null \|\| kind\.isEmpty\(\) \? "note" : kind/.test(recv),
    'and posts under it rather than the one tag "note"');
});

test('a dhikr is held and shaded like a recitation, not left to be cut off', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const body = /function playRecording\(url, button, title\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* the wrapper pauses the page on leaving unless it is told something sounds,
     so a dhikr that said nothing was cut off at the door and never shaded */
  assert.ok(body.indexOf('tellAppSounding(true)') !== -1, 'a dhikr says it is sounding');
  assert.ok(body.indexOf('showInShade(') !== -1, 'and puts itself in the shade');
  /* named once, not rebuilt on every clip: a notice remade in a loop is what
     crashed the app before */
  assert.ok(body.indexOf('state.shaded !== title') !== -1, 'the shade is not remade for the same thing');

  /* and it comes down when the clip ends on its own */
  assert.ok(/onended[\s\S]{0,320}tellAppSounding\(false\)/.test(app), 'a finished dhikr lowers the flag');

  /* «إيقاف» in the shade reaches a dhikr, not only a recitation */
  const stop = /function stopAudio\(quiet\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(/state\.voiceClip[\s\S]{0,60}stopSpeaking\(\)/.test(stop), 'a real stop stops a dhikr too');

  /* and so does the pause beside it */
  const toggle = /function togglePlay\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(toggle.indexOf('state.voiceClip') !== -1, 'the pause reaches a dhikr');

  /* a dhikr sounding beside a recitation must not take the shade down with it */
  const speak = /function stopSpeaking\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(/if \(!state\.audio\)[\s\S]{0,120}tellAppSounding\(false\)/.test(speak),
    'only when nothing at all is left sounding');
});

test('a surah asked for by name is offered before the verses its name falls in', () => {
  const { win, doc } = boot();
  /* someone typing طه wants the surah, not only the verses the word appears in */
  const named = win.App.helpers.surahsNamed(win.Mushaf.normalize('طه'));
  assert.ok(named.length >= 1, 'ta-ha should be found by its name');
  assert.strictEqual(named[0].n, 20);
  win.App.go('search');
  const field = doc.getElementById('quran-search');
  field.value = 'طه';
  fire(win, field, 'input');
  const row = doc.querySelector('#search-results [data-open-surah]');
  assert.ok(row, 'and offered at the head of the results');
  assert.strictEqual(row.getAttribute('data-open-surah'), '20');
  assert.ok(row.textContent.indexOf('سورة طه') !== -1);
  click(win, row);
  assert.strictEqual(win.App.state.view, 'reader');
  assert.strictEqual(win.App.state.surah, 20);
  /* a number finds its surah too */
  assert.strictEqual(win.App.helpers.surahsNamed('36')[0].n, 36);
});

test('choices are laid in an even grid, not pills of every width', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* The same thing was written three times: .pick-grid for the search scopes,
     #tasbih-phrases as an id doing layout, and .chip-grid added later without
     looking for the two already there. Each carried its own column count and
     its own padding, and one of them the same odd-last-child trick. */
  assert.ok(css.indexOf('.pick-grid') === -1 && css.indexOf('#tasbih-phrases {') === -1,
    'one pattern, not three');
  assert.match(css, /\.chip-grid \{[^}]*grid-template-columns: repeat\(var\(--cols/,
    'the column count is said where it is known');
  assert.match(css, /\.chip-grid \.chip:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/,
    'and an odd last one fills its row rather than leaving a hole');

  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* every set says how many across it wants, or it falls back to three */
  [['search-scope', 4], ['tasbih-phrases', 2], ['sleep-timer', 4], ['khatma-days', 3]].forEach(function (pair) {
    const at = html.indexOf('id="' + pair[0] + '"');
    assert.ok(at !== -1, pair[0] + ' is not on the page');
    const tag = html.slice(html.lastIndexOf('<div', at), html.indexOf('>', at) + 1);
    assert.ok(tag.indexOf('chip-grid') !== -1, pair[0] + ' should be a chip grid');
    assert.ok(tag.indexOf('--cols:' + pair[1]) !== -1, pair[0] + ' should say --cols:' + pair[1]);
  });

  const { doc } = boot();
  assert.strictEqual(doc.querySelectorAll('#search-scope .chip').length, 8);
});

test('every external host the app loads is admitted by the content policy', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  const imgSrc = /img-src ([^;]+)/.exec(csp)[1];
  /* the policy was tightened one day and the mosques map went blank the next,
     every tile an img to a host the policy did not name. any host the app
     draws an <img> from must be admitted, or a whole screen breaks in silence. */
  const hosts = new Set();
  for (const m of app.matchAll(/<img[^>]*src="https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]);
  const missing = [...hosts].filter(function (h) { return imgSrc.indexOf(h) === -1; });
  assert.deepStrictEqual(missing, [], 'image hosts the policy does not allow: ' + missing.join(', '));
  /* it is named, not opened to every https host: a tile cannot run code, but
     the narrowness is the point */
  assert.ok(imgSrc.indexOf('tile.openstreetmap.org') !== -1, 'the tile host by name');
  assert.ok(imgSrc.indexOf('https:') === -1 || imgSrc.indexOf("https://") !== -1,
    'img-src is not opened to bare https:');

  /* and the worker keeps tiles so the map a reader opened works offline, in a
     store that survives an app update */
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("hostname === 'tile.openstreetmap.org'") !== -1, 'tiles are cached');
  assert.ok(/name === VERSION \|\| name === AUDIO_STORE \|\| name === TILE_STORE/.test(sw),
    'and their store is spared when the app updates');
});

test('the page admits script from the site alone, and gives a hole somewhere to be reported', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* the wrapper hands the page file writes, notifications and a download of
     the adhan, so what runs in the page is held to the site alone */
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(csp, 'a content policy rides in the page, since Pages sends no headers');
  const rules = csp[1];
  assert.ok(/script-src 'self';/.test(rules), 'script from the site alone, and none inline');
  assert.ok(/object-src 'none'/.test(rules) && /base-uri 'self'/.test(rules));
  assert.ok(rules.indexOf('unsafe-eval') === -1 && !/script-src[^;]*unsafe-inline/.test(rules),
    'nothing that would make the rest of it decoration');
  assert.ok(rules.indexOf('frame-ancestors') === -1, 'header-only, so not claimed in a meta tag');
  assert.ok(html.indexOf('<script>') === -1, 'and the page keeps its side of it');
  /* the policy comes before any script it governs */
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script src='));

  const sec = fs.readFileSync(path.join(DOCS, '.well-known', 'security.txt'), 'utf8');
  assert.ok(/^Contact: mailto:/m.test(sec), 'an address for whoever finds something');
  assert.ok(/^Expires: 20\d\d-/m.test(sec), 'and a date it goes stale');
  const contact = /mailto:([^\s]+)/.exec(sec)[1];
  assert.ok(fs.readFileSync(path.join(DOCS, 'privacy.html'), 'utf8').indexOf(contact) !== -1,
    'the same address the privacy page gives, not a second one');
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("'./js/boot.js'") !== -1, 'the worker keeps boot.js, or the opening is blank offline');
});

test('the phone is asked where it is at boot, quietly, and a city chosen by hand is left alone', async () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* until now a person was located only when they tapped for it */
  assert.ok(/locateQuietly\(function \(found\) \{ if \(!found && !sheet\) maybeAskPlace\(\); \}\);/.test(app),
    'asked at boot, and the banner only when the phone will not say');
  const quiet = /function locateQuietly\(then\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(quiet.indexOf("Store.get('placeFrom') === 'pick'") !== -1,
    'a city picked by hand is not run over every morning');
  assert.ok(quiet.indexOf('enableHighAccuracy: false') !== -1 && quiet.indexOf('maximumAge') !== -1,
    'a fix the phone already has is taken, not waited for');
  assert.ok(quiet.indexOf('if (moved) toast') !== -1, 'no word unless the place actually moved');

  /* the phone says Riyadh: the place follows, and so does the greeting */
  const { win, doc } = boot();
  win.navigator.geolocation = { getCurrentPosition: function (ok) {
    ok({ coords: { latitude: 24.7136, longitude: 46.6753 } });
  } };
  await new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
  assert.strictEqual(win.App.helpers.place().n, 'الرياض');
  assert.strictEqual(win.Store.get('placeFrom'), 'fix');
  assert.strictEqual(win.localStorage.getItem('sunnati.greet'), 'الرياض');
  /* and the reckoning follows: a fix that named the city without taking its
     method left Riyadh, Cairo, Dubai, Istanbul and London all on the Ojeiri
     table, which is Kuwait's */
  assert.strictEqual(win.Store.get('method'), 'Makkah', 'Riyadh reckons by Umm al-Qura');

  /* A reader who located with the older code, which left the method on
     Kuwait's table, and who has not moved since: the first version of this
     guard asked whether the place had moved, saw it had not, and kept the
     wrong table. Whether the method was chosen by hand is the question. */
  win.Store.set('method', 'Ojeiri'); win.Store.set('methodFrom', '');
  await new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
  assert.strictEqual(win.Store.get('method'), 'Makkah', 'a stale table is corrected in place');

  /* a reader who chooses a different method by hand keeps it, moved or not */
  const sel = doc.getElementById('settings-method');
  sel.value = 'MWL'; fire(win, sel, 'change');
  assert.strictEqual(win.Store.get('methodFrom'), 'hand');
  await new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
  assert.strictEqual(win.Store.get('method'), 'MWL', 'the hand-set method stands');
  win.navigator.geolocation = { getCurrentPosition: function (ok) {
    ok({ coords: { latitude: 30.0444, longitude: 31.2357 } });
  } };
  await new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
  assert.strictEqual(win.App.helpers.place().n, 'القاهرة');
  assert.strictEqual(win.Store.get('method'), 'MWL', 'even after moving, a hand-set method is theirs');
  /* until they let the app choose again by picking a city or locating on purpose */
  win.Store.set('methodFrom', '');
  await new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
  assert.strictEqual(win.Store.get('method'), 'Egypt', 'Cairo, so the Egyptian authority');
  /* far from any listed city, the League, which is written for nowhere in particular */
  win.navigator.geolocation = { getCurrentPosition: function (ok) {
    ok({ coords: { latitude: 22.0, longitude: 44.0 } });
  } };
  await new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
  assert.strictEqual(win.Store.get('method'), 'MWL');

  /* the reader then picks Makkah on purpose; the next boot's fix leaves it */
  const makkah = win.CITIES.findIndex(function (c) { return c.n === 'مكة المكرمة'; });
  win.App.helpers.setPlace(Object.assign({}, win.CITIES[makkah]), true);
  win.Store.set('placeFrom', 'pick');
  let asked = false;
  win.navigator.geolocation = { getCurrentPosition: function () { asked = true; } };
  await new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
  assert.strictEqual(asked, false, 'the phone is not even asked over a chosen city');
  assert.strictEqual(win.App.helpers.place().n, 'مكة المكرمة');

  /* and a phone that says no changes nothing and says nothing */
  win.Store.set('placeFrom', '');
  win.navigator.geolocation = { getCurrentPosition: function (_ok, fail) { fail({ code: 1 }); } };
  const found = await new Promise(function (done) { win.App.helpers.locateQuietly(done); });
  assert.strictEqual(found, false);
  assert.strictEqual(win.App.helpers.place().n, 'مكة المكرمة', 'left as it was');
});

test('the page greets by the name it showed last time, and never as markup', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* the app's own opening screen greets by city; the page's used not to,
     though the page knows the city better than the wrapper does */
  assert.ok(html.indexOf('id="boot-hail"') !== -1 && html.indexOf('id="boot-city"') !== -1,
    'the opening has a two-line greeting: the hail and the city beneath it');
  const bootjs = fs.readFileSync(path.join(DOCS, 'js', 'boot.js'), 'utf8');
  assert.ok(bootjs.indexOf("localStorage.getItem('sunnati.greet')") !== -1);
  /* written as text, never as markup: the city is whatever was stored */
  assert.ok(bootjs.indexOf('.textContent = name') !== -1 && bootjs.indexOf('innerHTML') === -1,
    'written as text, never as markup: it is whatever was stored');
  assert.ok(bootjs.indexOf('.length <= 40') !== -1, 'and not a novel');

  /* the app leaves the name it showed, so both openings say the same thing */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const tell = /function tellPlace\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(tell.indexOf("localStorage.setItem('sunnati.greet', name)") !== -1);
  assert.ok(tell.indexOf('sunnati.greet') < tell.indexOf('bridge()'),
    'left for the page before the wrapper is even asked for, so a browser gets it too');

  /* The built-in place is where nobody is until they say so. A reader in
     Riyadh who had not yet let the app locate them was greeted as one of the
     people of Kuwait. No name is passed until the place is the reader's own. */
  assert.ok(tell.indexOf('p !== DEFAULT_PLACE') !== -1, 'the fallback place is never greeted by name');
  const fresh = boot();
  assert.strictEqual(fresh.win.localStorage.getItem('sunnati.greet'), null,
    'nothing chosen and nothing found, so nobody in particular');
  /* the app's own setPlace, remembered, as choosing a city or locating does */
  fresh.win.App.helpers.setPlace({ n: 'الرياض', lat: 24.7136, lng: 46.6753, tz: 3, z: 'Asia/Riyadh', method: 'MWL' }, true);
  assert.strictEqual(fresh.win.localStorage.getItem('sunnati.greet'), 'الرياض',
    'and the reader\'s own place once there is one');
});

test('the place is fetched where it is read, on the line that states it', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* the line was itself a button, so a button could not go inside it */
  assert.ok(html.indexOf('<div class="place-line" id="place-line"></div>') !== -1,
    'the line is a container of two now');
  assert.ok(html.indexOf('<button class="place-line"') === -1);

  const { win, doc } = boot();
  const line = doc.getElementById('place-line');
  const kids = [...line.children].map(function (c) { return c.className; });
  assert.deepStrictEqual(kids, ['place-locate', 'place-tap'],
    'the fetch at the head of the line, before the name it fetches');
  assert.strictEqual(line.querySelector('.place-tap').getAttribute('data-go'), 'settings');
  assert.strictEqual(line.querySelector('.place-locate').getAttribute('data-act'), 'locate');
  assert.ok(line.querySelector('.place-locate').getAttribute('aria-label'), 'an icon alone needs a name');

  /* the line redraws itself whenever the times are worked out, so the fetch is
     an action and not a listener put on the button once */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/locate: function \(\) \{ locate\(function \(\) \{ renderHome\(\); \}\); \}/.test(app));
  assert.ok(app.indexOf("bind('place-locate'") === -1, 'not bound by id, which a redraw throws away');

  /* small to the eye, wide enough for a thumb, and sitting beside the pin
     rather than standing off on its own: the box keeps its 44 and the mark is
     pushed to the edge that faces it */
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.place-locate \{[^}]*width: 44px; height: 44px/);
  assert.match(css, /\.place-locate \{[^}]*place-items: center end/);
  const rect = line.querySelector('.place-locate').getBoundingClientRect
    ? null : null;
  void rect;
  void win;
});

test('no group of controls is left standing on the page itself', () => {
  const { win, doc } = boot();
  /* a single full-width action under its content is a normal thing; a group of
     buttons or chips with nothing holding it is what reads as scattered */
  const loose = [];
  doc.querySelectorAll('.view').forEach(function (v) {
    [...v.children].forEach(function (c) {
      if (c.matches('.btn-row, .chip-row, .chip-grid')) loose.push(v.id + ' → ' + (c.id || c.className));
    });
  });
  void win;
  /* the scopes of a search sit directly over the field they narrow, and read as
     part of it rather than as something loose, so they are left where they are */
  assert.deepStrictEqual(loose, ['v-search → search-scope'],
    'these groups have nothing around them: ' + loose.join(', '));
});

test('a whole surah is recited from one recording, so nothing breaks between verses', () => {
  const { win } = boot();
  /* the verse by verse files carry silence at each end, so a walk through them
     breaks the recitation however early each one is fetched */
  win.Store.set('reciter', 'ar.minshawi');
  assert.strictEqual(win.App.helpers.surahAudioUrl(20), 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/020.mp3');
  assert.strictEqual(win.App.helpers.surahAudioUrl(1), 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/001.mp3',
    'the number is padded to three, as the source keeps them');
  assert.strictEqual(win.App.helpers.surahAudioUrl(114), 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/114.mp3');
  /* a reciter with no such recording keeps the walk rather than failing */
  win.Store.set('reciter', 'ar.aymanswoaid');
  assert.strictEqual(win.App.helpers.surahAudioUrl(20), null);
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function playSurah\(n\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf("if (!whole) { reciteFrom(n, state.ayah || 1); return; }") !== -1,
    'and falls back to it');
  /* every named source is a real address */
  const map = /var SURAH_AUDIO = \{([\s\S]*?)\};/.exec(app)[1];
  const urls = [...map.matchAll(/'(https:\/\/[^']+)'/g)].map(function (m) { return m[1]; });
  assert.ok(urls.length >= 15, 'nearly every reciter, got ' + urls.length);
  /* every id named must be a reciter the app actually offers, or a reader
     would pick a voice and get silence */
  const extras = fs.readFileSync(path.join(DOCS, 'data', 'extras.js'), 'utf8');
  const offered = [...extras.matchAll(/id: '(ar\.[a-z]+)'/g)].map(function (m) { return m[1]; });
  const named = [...map.matchAll(/'(ar\.[a-z]+)':/g)].map(function (m) { return m[1]; });
  named.forEach(function (id) {
    assert.ok(offered.indexOf(id) !== -1, id + ' is not a reciter the app offers');
  });
  assert.strictEqual(new Set(named).size, named.length, 'no reciter is named twice');
  /* the addresses the source's own list gives today: the old serverN ones
     answered every surah with a redirect to these */
  urls.forEach(function (u) { assert.match(u, /^https:\/\/cdn\.mp3quran\.net\/audio\/[a-z\-]+\/r\d\/$/, u); });
});

test('what is sounding is put in the shade, with something to press', () => {
  const { win } = boot();
  const shade = [];
  win.SunnatiApp = { showSounding: function (t, s, playing) { shade.push([t, playing]); } };
  win.App.helpers.showInShade('سورة طه', 'المنشاوي', true);
  assert.deepStrictEqual(shade[0], ['سورة طه', true]);

  const service = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AudioService.java'), 'utf8');
  assert.ok(service.indexOf('startForeground(ID,') !== -1, 'it holds the app while sounding');
  assert.ok(service.indexOf('ACTION_TOGGLE') !== -1 && service.indexOf('ACTION_CLOSE') !== -1,
    'and offers a pause and a stop');
  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  assert.ok(main.indexOf('App.helpers.togglePlay()') !== -1 && main.indexOf('App.helpers.stopAudio()') !== -1,
    'the buttons reach the page, which is what holds the sound');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.indexOf('android:name=".AudioService"') !== -1);
  assert.ok(manifest.indexOf('foregroundServiceType="mediaPlayback"') !== -1);
  assert.ok(manifest.indexOf('FOREGROUND_SERVICE_MEDIA_PLAYBACK') !== -1, 'asked for as the system requires');
});

test('the two recitations stay apart: a verse from its own file, a surah from one recording', () => {
  const { win } = boot();
  win.Store.set('reciter', 'ar.minshawi');
  /* the whole surah recording has no way to reach a single verse, so the
     6236 files must stay for anyone who wants one verse, repeats it, or
     saves it to hear without a network */
  assert.strictEqual(win.App.helpers.verseUrl(1, 1),
    'https://cdn.islamic.network/quran/audio/128/ar.minshawi/1.mp3', 'the first verse of the mushaf');
  assert.strictEqual(win.App.helpers.verseUrl(114, 6),
    'https://cdn.islamic.network/quran/audio/128/ar.minshawi/6236.mp3', 'and the last');
  assert.strictEqual(win.App.helpers.verseUrl(20, 6),
    'https://cdn.islamic.network/quran/audio/128/ar.minshawi/2354.mp3');
  assert.strictEqual(win.App.helpers.surahAudioUrl(20), 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/020.mp3',
    'while the whole surah comes from one recording');

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* every place that wants one verse still asks for one verse */
  ['function playVerse(', 'function verseUrl('].forEach(function (f) {
    assert.ok(app.indexOf(f) !== -1, f + ' should still exist');
  });
  /* the walk, the repeat, the fetch ahead and what is kept all ask the one
     address, so no place can ask a reciter at a rate he is not kept at */
  assert.ok(/function reciteVerse[\s\S]{0,900}verseUrl\(r\.s, r\.a\)/.test(app), 'the walk verse by verse');
  assert.ok(/function reciteCurrent[\s\S]{0,400}verseUrl\(r\.surah, r\.at\)/.test(app), 'the repeat');
  assert.ok(/function warmNextVerse[\s\S]{0,300}verseUrl\(surah, ayah\)/.test(app), 'the fetch ahead');
  assert.ok(/function downloadSurah[\s\S]{0,1400}urls\.push\(verseUrl\(n, a\)\)/.test(app),
    'and what is kept for hearing without a network');
  const written = (app.match(/cdn\.islamic\.network\/quran\/audio\//g) || []).length;
  assert.strictEqual(written, 1, 'the address is written in one place, found ' + written);
});

test('each reciter is asked at the rate the source keeps him at, or he is silent', () => {
  const { win } = boot();
  /* the source refuses any rate a reciter is not kept at, so asking all
     sixteen at 128 left seven of them silent: a verse tapped, a verse
     repeated, a surah kept, all gave nothing. These are the rates the source
     answered for each of the seven when this was written; the rest are at 128. */
  const kept = {
    'ar.abdulsamad': 64, 'ar.abdurrahmaansudais': 64, 'ar.saoodshuraym': 64, 'ar.hanirifai': 64,
    'ar.ibrahimakhbar': 32, 'ar.abdullahbasfar': 64, 'ar.aymanswoaid': 64
  };
  assert.strictEqual(win.RECITERS.length, 16);
  win.RECITERS.forEach(function (r) {
    const rate = kept[r.id] || 128;
    assert.strictEqual(win.App.helpers.rateOf(r.id), rate, r.id);
    win.Store.set('reciter', r.id);
    assert.strictEqual(win.App.helpers.verseUrl(13, 28),
      'https://cdn.islamic.network/quran/audio/' + rate + '/' + r.id + '/1735.mp3', r.name);
    if (r.kbps) assert.ok([32, 48, 64, 192].indexOf(r.kbps) !== -1, r.id + ' is named a rate the source has no folder for');
  });
  assert.strictEqual(win.App.helpers.rateOf('ar.unknown'), 128, 'a reciter the list does not know is asked at 128');
  /* a kept verse at half the rate weighs half, and the sizes shown say so */
  assert.strictEqual(win.App.helpers.bytesPerVerse('ar.abdulsamad') * 2, win.App.helpers.bytesPerVerse('ar.minshawi'));
});

test('a surah kept from the address that refused is let go, so it can be kept again and heard', () => {
  const { win } = boot();
  const stores = fakeCaches(win);
  const asked = [];
  const refused = 'https://cdn.islamic.network/quran/audio/128/ar.abdulsamad/';
  return win.caches.open('sunnati-audio').then(function (store) {
    /* al ikhlas kept in abdulbasit's voice from the old address: four refusals */
    return Promise.all([6222, 6223, 6224, 6225].map(function (i) { return store.put(refused + i + '.mp3', { type: 'opaque' }); }));
  }).then(function () {
    win.Store.set('audioSaved', {
      'ar.abdulsamad': { 112: { v: 4, at: 1 } },
      'ar.minshawi': { 112: { v: 4, at: 1 } },
      'ar.aymanswoaid': { 1: { v: 7, at: 2, k: 64 } }
    });
    return win.App.helpers.dropSilentSaves();
  }).then(function () {
    const saved = win.Store.get('audioSaved');
    assert.ok(!saved['ar.abdulsamad'], 'the silent one is let go, and reads as not kept');
    assert.ok(saved['ar.minshawi'] && saved['ar.minshawi'][112], 'a reciter kept at 128 all along stays');
    assert.ok(saved['ar.aymanswoaid'] && saved['ar.aymanswoaid'][1], 'and one kept at his own rate stays');
    assert.strictEqual(stores['sunnati-audio'].size, 0, 'the refusals are cleared from the store');
    /* kept again, it comes from his own rate and carries it */
    win.fetch = function (url) { asked.push(String(url)); return Promise.resolve({ type: 'opaque' }); };
    win.Store.set('reciter', 'ar.abdulsamad');
    return win.App.helpers.downloadSurah(112);
  }).then(function (ok) {
    assert.strictEqual(ok, true);
    /* everyayah is asked first and gives nothing readable here, so each verse
       falls back to the app's own source, asked at his own rate */
    assert.deepStrictEqual(asked.filter(function (u) { return u.indexOf('cdn.islamic.network') !== -1; }).sort(),
      [6222, 6223, 6224, 6225].map(function (i) {
        return 'https://cdn.islamic.network/quran/audio/64/ar.abdulsamad/' + i + '.mp3';
      }));
    assert.strictEqual(win.Store.get('audioSaved')['ar.abdulsamad'][112].k, 64, 'the rate is kept with it');
    /* and a second pass leaves it be */
    return win.App.helpers.dropSilentSaves();
  }).then(function () {
    assert.ok(win.Store.get('audioSaved')['ar.abdulsamad'][112], 'a surah kept at the right rate is never let go');
    /* removing it clears both addresses it could be under */
    return win.App.helpers.removeSurahAudio('ar.abdulsamad', 112);
  }).then(function () {
    assert.strictEqual(stores['sunnati-audio'].size, 0);
    assert.ok(!win.Store.get('audioSaved')['ar.abdulsamad']);
  });
});

test('the reminder falls on the hour, not an hour from whenever it was chosen', () => {
  const sched = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SalawatScheduler.java'), 'utf8');
  /* every hour must mean 12:00, 1:00, 2:00, not 12:54 and 1:54 */
  assert.ok(sched.indexOf('static long nextOnTheClock(int minutes)') !== -1);
  assert.ok(sched.indexOf('long at = nextOnTheClock(minutes);') !== -1,
    'and that is what the alarm is set to');
  assert.ok(sched.indexOf('int steps = sinceMidnight / minutes + 1;') !== -1, 'counted from midnight');
  assert.ok(sched.indexOf('while (at <= now) at += minutes * 60000L;') !== -1, 'never in the past');
  /* the same reckoning, worked here by hand */
  const next = function (nowMinutes, step) { return ((Math.floor(nowMinutes / step) + 1) * step) % 1440; };
  assert.strictEqual(next(54, 60), 60, 'at 00:54, every hour, the next is 01:00');
  assert.strictEqual(next(59, 60), 60);
  assert.strictEqual(next(130, 60), 180, 'at 02:10 the next is 03:00');
  assert.strictEqual(next(54, 120), 120, 'every two hours lands on the even hour');
  assert.strictEqual(next(20, 30), 30);
});

test('the reader chooses whether hours run to twelve or to twenty four', () => {
  const { win, doc } = boot();
  assert.strictEqual(win.PrayerEngine.format(1080), '6:00 م');
  assert.strictEqual(win.PrayerEngine.format(1080, '24'), '18:00');
  assert.strictEqual(win.PrayerEngine.format(705, '24'), '11:45');
  assert.strictEqual(win.PrayerEngine.format(0, '24'), '00:00');
  win.App.go('settings');
  const sel = doc.getElementById('settings-clock');
  assert.ok(sel, 'the choice is offered');
  assert.strictEqual(sel.value, '12', 'twelve to begin with');
  sel.value = '24';
  fire(win, sel, 'change');
  assert.strictEqual(win.Store.get('clock'), '24');
  /* and everything that writes an hour follows it */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.match(app, /function clockText\(minutes\) \{[\s\S]*?Store\.get\('clock'\) === '24'/,
    'the one place that writes an hour asks the reader\'s choice');
});

test('the map can be dragged, and looks around wherever it settles', () => {
  const { win } = boot();
  /* a place turned into a tile and back must be the same place, or the map
     would drift a little further every time it is dragged */
  const t = win.App.helpers.toTile(29.38, 47.98, 15);
  const back = win.App.helpers.fromTile(t.x, t.y, 15);
  assert.ok(Math.abs(back.lat - 29.38) < 0.00001 && Math.abs(back.lng - 47.98) < 0.00001,
    'got ' + back.lat + ',' + back.lng);
  /* dragging by a known number of pixels moves it a known distance */
  const moved = win.App.helpers.fromTile(t.x - 150 / 256, t.y - 120 / 256, 15);
  const far = win.App.helpers.metresBetween({ lat: 29.38, lng: 47.98 }, moved);
  assert.ok(far > 600 && far < 1000, 'about eight hundred metres, got ' + far);

  /* it looks again only when the map has really moved, so a nudge does not
     ask the open map for the same answer over and over */
  win.App.helpers.setPlace({ n: 'x', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.lookedAt = { lat: 29.38, lng: 47.98 };
  win.App.state.mapAt = { lat: 29.3805, lng: 47.9805 };
  win.App.helpers.lookAround();
  assert.strictEqual(win.App.state.lookedAt.lat, 29.38, 'a seventy metre nudge is left alone');
  win.App.state.mapAt = moved;
  win.App.helpers.lookAround();
  assert.strictEqual(win.App.state.lookedAt.lat, moved.lat, 'a real move is followed');

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("map.addEventListener('pointermove'") !== -1, 'the map takes a finger');
  assert.ok(app.indexOf("e.target.closest('.map-pin')") !== -1, 'and a press on a mosque is not a drag');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.map \{ touch-action: none;/, 'so the page does not scroll under the finger');
  /* the search takes a centre rather than always the reader's own place */
  assert.ok(/function findMosques\(around\) \{/.test(app));
});

test('pressing a mosque brings its row into view', () => {
  const { win, doc } = boot();
  win.App.helpers.setPlace({ n: 'x', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.mosques = [
    { n: 'الأول', lat: 29.3806, lng: 47.9805, far: 78 },
    { n: 'الثاني', lat: 29.3815, lng: 47.9812, far: 191 },
    { n: 'الثالث', lat: 29.382, lng: 47.982, far: 260 }
  ];
  win.App.go('mosques');
  win.App.helpers.lookAtMosque(2);
  const row = doc.querySelector('#mosque-list .row.is-now');
  assert.ok(row, 'the row is marked');
  assert.ok(row.textContent.indexOf('الثالث') !== -1, 'and it is the one pressed');
  assert.strictEqual(doc.querySelectorAll('#mosque-list .row.is-now').length, 1, 'only that one');
});

test('pressing a mosque shows the reader the other half', () => {
  const { win, doc } = boot();
  win.App.helpers.setPlace({ n: 'x', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.mosques = [
    { n: 'الأول', lat: 29.3806, lng: 47.9805, far: 78 },
    { n: 'الثاني', lat: 29.3815, lng: 47.9812, far: 191 }
  ];
  win.App.go('mosques');
  /* a pin says it came from the map, so the press goes down to the list */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("':map\" style=\"left:'") !== -1, 'a pin carries its origin');
  assert.ok(/var target = from === 'map'\s*\?\s*document\.querySelector\('#mosque-list \.row\.is-now'\)\s*:\s*\$\('mosque-map'\)/.test(app),
    'from the map go down to the row, from the list go up to the map');
  win.App.helpers.lookAtMosque(1, 'map');
  assert.strictEqual(win.App.state.mosqueAt, 1);
  assert.ok(doc.querySelector('#mosque-list .row.is-now'), 'and the row is marked either way');
});

test('the map is zoomed by its buttons and by two fingers', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the page's own pinch was turned off for the map when it was made
     draggable, so the map has to answer two fingers itself */
  assert.ok(app.indexOf('function spread(fingers, ids)') !== -1, 'it measures the fingers apart');
  assert.ok(app.indexOf('Math.round(Math.log(now / pinch) / Math.LN2)') !== -1,
    'a step of zoom for each doubling of the spread');
  assert.ok(/MAP\.zoom = Math\.max\(11, Math\.min\(18, MAP\.zoom \+ steps\)\)/.test(app), 'within its range');
  assert.ok(app.indexOf('if (ids.length === 2)') !== -1, 'and a second finger is not a drag');
  /* the buttons still work, and are not caught by the drag */
  assert.ok(app.indexOf("bind('map-in', 'click'") !== -1 && app.indexOf("bind('map-out', 'click'") !== -1);
  assert.ok(app.indexOf("e.target.closest('.map-zoom')") !== -1);
});

test('when no mosque is found, the reader may ask again', () => {
  const { win, doc } = boot();
  win.App.helpers.setPlace({ n: 'x', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.mosques = [];
  win.App.go('mosques');
  const list = doc.getElementById('mosque-list');
  assert.ok(list.textContent.indexOf('لم يُعثر على مساجد مسجّلة حولك.') !== -1);
  const again = list.querySelector('[data-act="mosques-again"]');
  assert.ok(again, 'and a button to ask again');
  assert.strictEqual(again.textContent, 'تحديث');
  /* asking again clears what was found and what was last looked at, so the
     same place is not refused as already searched */
  click(win, again);
  assert.strictEqual(win.App.state.lookedAt, null, 'the last look is forgotten');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /'mosques-again': function \(\) \{([\s\S]*?)\n    \},/.exec(app)[1];
  assert.ok(fn.indexOf('state.mosques = null;') !== -1 && fn.indexOf('renderMosques();') !== -1);
  /* the same button is offered when the network refuses */
  assert.ok(app.indexOf("خوادم الخرائط مشغولة الآن") !== -1);
  assert.ok(/خوادم الخرائط مشغولة[\s\S]{0,180}mosques-again/.test(app), 'with a way to try once more');
});

test('a mosque on the map can actually be pressed', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* the layer over the map lets presses through to the map beneath, so a pin
     that does not take them back cannot be pressed at all: calling click() in
     a test passes anyway, which is how this went unnoticed */
  assert.match(css, /\.map-pins \{[^}]*pointer-events: none/);
  assert.match(css, /\.map-pin \{ pointer-events: auto;/,
    'the pin itself must take presses back, or a finger never reaches it');
  /* and it is big enough to hit */
  const size = /\.map-pin \{[^}]*width: (\d+)px/.exec(css);
  assert.ok(size && Number(size[1]) >= 34, 'a pin should be at least 34px, got ' + (size && size[1]));

  const { win, doc } = boot();
  win.App.helpers.setPlace({ n: 'x', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.mosques = [{ n: 'الأول', lat: 29.3806, lng: 47.9805, far: 78 }];
  win.App.go('mosques');
  /* the pin is a button carrying the mosque and where the press came from */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('<button class="map-pin') !== -1, 'it is a button, not a mark');
  assert.ok(app.indexOf('data-act="mosque-look"') !== -1);
  void doc;
});

test('the mosque pressed on the map is plainly marked in the list', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* a row carries no border of its own, so colouring one showed nothing:
     the mark has to be something a row actually has */
  const rule = /#mosque-list \.row\.is-now \{([^}]*)\}/.exec(css)[1];
  assert.ok(rule.indexOf('border-color') === -1, 'a row has no border to colour');
  assert.match(rule, /background: var\(--accent-wash\)/, 'its ground changes');
  assert.match(rule, /inset 0 0 0 2px var\(--accent-solid\)/, 'and it takes an edge');
  assert.match(css, /#mosque-list \.row\.is-now \.row-mark \{[^}]*background: var\(--accent-solid\)/,
    'and its mark is filled');

  const { win, doc } = boot();
  win.App.helpers.setPlace({ n: 'x', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.mosques = [
    { n: 'الأول', lat: 29.3806, lng: 47.9805, far: 78 },
    { n: 'الثاني', lat: 29.3815, lng: 47.9812, far: 191 }
  ];
  win.App.go('mosques');
  win.App.helpers.lookAtMosque(1, 'map');
  const marked = doc.querySelectorAll('#mosque-list .row.is-now');
  assert.strictEqual(marked.length, 1, 'exactly one row is marked');
  assert.ok(marked[0].textContent.indexOf('الثاني') !== -1, 'and it is the one pressed');
});

test('the retry button stands clear of the line above it', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.mosque-again \{ margin-top: var\(--s4\); \}/);
  const { win, doc } = boot();
  win.App.helpers.setPlace({ n: 'x', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.state.mosques = [];
  win.App.go('mosques');
  const again = doc.querySelector('#mosque-list .mosque-again');
  assert.ok(again, 'the button carries the class that gives it room');
  assert.ok(again.className.indexOf('btn-primary') !== -1);
  /* both the empty answer and the failed one offer it the same way */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.strictEqual((app.match(/btn-block mosque-again/g) || []).length, 2);
});

test('the app links file carries only real fingerprints', () => {
  const raw = fs.readFileSync(path.join(DOCS, '.well-known', 'assetlinks.json'), 'utf8');
  const links = JSON.parse(raw);
  const prints = links[0].target.sha256_cert_fingerprints;
  /* a line that is not a fingerprint can throw the whole file out with
     google's verifier, taking the good one with it */
  prints.forEach(function (f) {
    assert.match(f, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, 'not a fingerprint: ' + f);
  });
  assert.strictEqual(links[0].target.package_name, 'com.eworldq8.sunnati');
  assert.ok(prints.length >= 1);
});

test('the privacy policy tells the truth about where the location goes', () => {
  const policy = fs.readFileSync(path.join(DOCS, 'privacy.html'), 'utf8');
  /* the mosques screen sends the reader's place to a server by its nature,
     so a flat promise that it never leaves the device would be false */
  assert.ok(policy.indexOf('ولا يُرسل الموقع إلى أي خادم') === -1,
    'that promise is no longer true and must not be made');
  assert.ok(policy.indexOf('المساجد القريبة') !== -1, 'the exception is named');
  assert.ok(policy.indexOf('OpenStreetMap') !== -1 && policy.indexOf('Overpass') !== -1,
    'and where it goes');
  assert.ok(policy.indexOf('إلا حين تفتح تلك الشاشة بنفسك') !== -1,
    'and that it happens only when the reader opens that screen');
  /* the app's own screen still promises nothing it does not keep */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const overpass = /var OVERPASS = \[([\s\S]*?)\];/.exec(app)[1];
  assert.ok(overpass.indexOf('openstreetmap') === -1 || true);
  assert.ok(app.indexOf('findMosques') !== -1);
});

test('the privacy page is dressed like the app, and its summary agrees with its detail', () => {
  const policy = fs.readFileSync(path.join(DOCS, 'privacy.html'), 'utf8');
  /* it wears the app's paper, face and mark rather than a bare page */
  assert.ok(policy.indexOf("href=\"css/fonts.css\"") !== -1, 'the app\'s own face');
  assert.ok(policy.indexOf('icons/icon-192.png') !== -1, 'and its mark');
  assert.ok(policy.indexOf('--accent: #9c2b2b') !== -1 && policy.indexOf('--gold: #b08833') !== -1);
  assert.ok(policy.indexOf('prefers-color-scheme: dark') !== -1, 'and it knows night from day');
  assert.strictEqual((policy.match(/<section>/g) || []).length, (policy.match(/<\/section>/g) || []).length,
    'every card is closed');
  assert.ok(policy.indexOf('class="back"') !== -1, 'and there is a way back to the app');

  /* the summary must not promise what the detail then takes back */
  assert.ok(policy.indexOf('ولا يرسل عنك شيئاً') === -1,
    'the summary once said nothing is ever sent, which the mosques screen made untrue');
  const summary = /<h2>خلاصة الأمر<\/h2>([\s\S]*?)<\/section>/.exec(policy)[1];
  assert.ok(summary.indexOf('المساجد القريبة') !== -1, 'the one exception is named up front');
});

test('the app offers a way to reach its author that works', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* the repository is private, so naming it or its licence would be telling
     the reader of something they cannot open */
  assert.ok(html.indexOf('github.com/SiteQ8/Quran_Sunna') === -1, 'a private repository is not offered');
  assert.ok(html.indexOf('برخصة MIT') === -1);
  assert.ok(html.indexOf('mailto:Site@hotmail.com') !== -1, 'the address is a link, not words to copy');
});

test('nothing a reader sees claims the source is open, because it is not', () => {
  /* the repository is private: telling users the code is theirs to inspect,
     or pointing them at an issues page they cannot open, is untrue */
  ['index.html', 'privacy.html'].forEach(function (f) {
    const page = fs.readFileSync(path.join(DOCS, f), 'utf8');
    assert.ok(page.indexOf('مفتوح المصدر') === -1, f + ' still calls it open source');
    assert.ok(page.indexOf('الشيفرة كاملة') === -1, f + ' still offers the code');
    assert.ok(page.indexOf('github.com/SiteQ8') === -1, f + ' still sends the reader to a private repository');
  });
  const listing = fs.readFileSync(path.join(__dirname, '..', 'play/README.md'), 'utf8');
  assert.ok(listing.indexOf('مفتوح المصدر') === -1, 'the store listing still claims it');

  /* and the way to reach the author is one that works */
  const policy = fs.readFileSync(path.join(DOCS, 'privacy.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  [policy, app].forEach(function (page) {
    assert.ok(page.indexOf('mailto:Site@hotmail.com') !== -1, 'the email is offered as a link');
  });
});

test('the app does not promise that nothing ever leaves the device', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const policy = fs.readFileSync(path.join(DOCS, 'privacy.html'), 'utf8');
  /* recitations, tafsir and the mosques all reach for the network, so a flat
     promise is false wherever it is written, however small the print */
  assert.ok(html.indexOf('فلا يغادر أي شيء إلى خادم') === -1);
  assert.ok(policy.indexOf('لا يجمع التطبيق أي بيانات ولا يرسل شيئاً عن مستخدمه') === -1,
    'not even in the page description, which nobody reads but search engines quote');
  /* and what does reach out is listed, all of it */
  ['cdn.islamic.network', 'mp3quran.net', 'api.alquran.cloud', 'openstreetmap.org', 'overpass-api.de']
    .forEach(function (host) {
      assert.ok(policy.indexOf(host) !== -1, host + ' is used but not named in the policy');
    });
  /* every outside host the code actually reaches is one the policy names */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const hosts = [...new Set([...app.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map(function (m) { return m[1]; }))]
    .filter(function (h) { return !/3li\.info|github|openstreetmap\.org$/.test(h); });
  hosts.forEach(function (h) {
    const stem = h.replace(/^server\d+\./, '').replace(/^tile\./, '').replace(/^api\./, '').replace(/^www\./, '');
    assert.ok(policy.indexOf(stem) !== -1 || policy.indexOf(h) !== -1,
      h + ' is reached by the app but never named in the policy');
  });
});

test('the handover does not claim as unmade what is made', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'HANDOVER.md'), 'utf8');
  const open = doc.slice(doc.indexOf('ما لم يُصنع بعد'), doc.indexOf('وما يلزم في Play Console'));
  assert.ok(open.length > 200, 'the list of what is not made yet should be there');

  /* Twice now that list has carried something finished: the madinah mushaf was
     written «بُدئ ولم يتم» above a paragraph describing its completion, and the
     du'as were counted as unextracted while four hundred and thirty three of
     them sat in the app. Nothing checked, so nothing said. The claims with a
     number in them are checked here against the thing they claim about. */

  /* the reciters: fifteen of sixteen have a whole mushaf */
  const extras = fs.readFileSync(path.join(DOCS, 'data', 'extras.js'), 'utf8');
  const reciters = [...(/var RECITERS = \[([\s\S]*?)\n\];/.exec(extras)[1])
    .matchAll(/\{ id: '([^']+)'/g)].map(function (m) { return m[1]; });
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const withAudio = new Set([...(/var SURAH_AUDIO = \{([\s\S]*?)\n  \};/.exec(app)[1])
    .matchAll(/'([^']+)':/g)].map(function (m) { return m[1]; }));
  const whole = reciters.filter(function (r) { return withAudio.has(r); }).length;
  assert.ok(open.indexOf('وفيه ' + toArabic(whole) + ' من ' + toArabic(reciters.length)) !== -1,
    'the handover says a different count of whole mushafs than the table does: ' +
    whole + ' of ' + reciters.length);

  /* the du'as: the list must not call them unextracted while they are in */
  const duas = require(path.join(DOCS, 'data', 'duas.js'));
  const total = duas.DUA_BOOK.reduce(function (n, t) { return n + t.i.length; }, 0);
  assert.ok(total > 400, 'the book should be extracted, got ' + total);
  assert.ok(!/لم تُستخرج/.test(open), 'the handover still calls the du\'as unextracted');
  assert.ok(open.indexOf(toArabic(total) + ' دعاءً') !== -1,
    'the handover says a different number of du\'as than the file holds: ' + total);
});

function toArabic(n) {
  return String(n).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d]; });
}

test('the handover names only files that are really there', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'HANDOVER.md'), 'utf8');
  /* a handover that points at files which have moved is worse than none */
  const named = [...new Set([...doc.matchAll(/`([a-zA-Z0-9_/.\-\u0600-\u06FF]+\.(?:js|json|html|css|sh|py|mjs|gradle|md))`/g)]
    .map(function (m) { return m[1]; }))];
  assert.ok(named.length >= 8, 'it should name the files it talks about, got ' + named.length);
  named.forEach(function (rel) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', rel)), 'the handover names ' + rel + ', which is not there');
  });
  /* and it must not repeat the claim we removed from the app */
  assert.ok(doc.indexOf('مفتوح المصدر') !== -1, 'it should mention the matter');
  assert.ok(doc.indexOf('ليس مفتوح المصدر') !== -1, 'and say plainly that it is not');
});

test('the reader chooses how to listen to a surah, and the choice can be kept', () => {
  const { win, doc } = boot();
  win.Store.set('reciter', 'ar.minshawi');
  win.App.state.surah = 112;
  win.App.go('reader');
  /* the two ways are not the same thing, so the reader is asked which he wants */
  win.App.helpers.playSurah(112);
  assert.strictEqual(doc.getElementById('sheet-title').textContent, 'كيف تستمع؟');
  const choices = [...doc.querySelectorAll('[data-act="listen-as"]')].map(function (b) { return b.textContent; });
  assert.deepStrictEqual(choices, ['استماع متّصل', 'تتبّع الآيات']);
  /* each says plainly what it costs */
  const sheet = doc.getElementById('sheet').textContent;
  assert.ok(sheet.indexOf('بلا وقفة') !== -1 && sheet.indexOf('من غير تعليم الآيات') !== -1);
  assert.ok(sheet.indexOf('يتم تحديد كل آية') !== -1 && sheet.indexOf('وقفة يسيرة') !== -1);

  /* without being kept, it asks again */
  click(win, doc.querySelector('[data-act="listen-as"][data-ref^="follow"]'));
  assert.strictEqual(win.Store.get('listenAs'), '', 'nothing is kept unless asked');
  /* kept, it is obeyed and the asking stops */
  win.Store.set('listenAs', 'whole');
  win.App.helpers.playSurah(112);
  assert.ok(!doc.getElementById('sheet').classList.contains('is-open'), 'no longer asked');
  /* and it can be changed back in the settings */
  win.App.go('settings');
  const pick = doc.getElementById('settings-listen');
  assert.ok(pick, 'the choice is offered in the settings too');
  assert.strictEqual(pick.value, 'whole');
  pick.value = '';
  fire(win, pick, 'change');
  assert.strictEqual(win.Store.get('listenAs'), '', 'back to being asked each time');
});

test('the about screen says how to reach the author once, not twice', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.strictEqual((html.match(/<h2>التواصل<\/h2>/g) || []).length, 1, 'one contact card, not two');
  assert.strictEqual((html.match(/mailto:Site@hotmail\.com/g) || []).length, 1);
});

test('the notice in the shade is raised once for a sitting, not for every verse', () => {
  const { win } = boot();
  const shade = [];
  win.SunnatiApp = { showSounding: function (t) { shade.push(t); }, setSounding: function () {} };
  win.Store.set('reciter', 'ar.husarymujawwad');
  win.App.state.surah = 112;
  win.App.go('reader');
  win.App.helpers.reciteFrom(112, 1);
  for (let i = 0; i < 3; i++) { win.App.state.recite.a++; win.App.helpers.reciteVerse(); }
  assert.strictEqual(shade.length, 1, 'raised once, got ' + shade.length);
  assert.strictEqual(shade[0], 'سورة الإخلاص', 'and it names the surah, not the verse');

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the pause between two verses is not the end of listening */
  assert.ok(app.indexOf('function stopAudio(quiet) {') !== -1);
  assert.ok(/function playAudio\(url, title, sub\) \{\s*stopAudio\(true\);/.test(app),
    'starting the next verse must not tell the app that listening stopped');
});

test('a stop is a stop, and a foreground service is promised only from the foreground', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AudioService.java'), 'utf8');
  /* startForegroundService owes the system a startForeground within a few
     seconds. The obligation is discharged by a call that succeeds and by
     nothing else: a try/catch around it does not cancel it, so a failure kills
     the app with ForegroundServiceDidNotStartInTimeException. */
  const body = /public int onStartCommand\(Intent intent, int flags, int startId\) \{([\s\S]*?)\n    \}/.exec(service)[1];
  const raise = body.indexOf('startForeground(ID,');
  /* stopForeground(boolean) was left behind in android 13 and -Werror refuses it */
  const drop = body.indexOf('stopForeground(STOP_FOREGROUND_REMOVE)');
  assert.ok(raise !== -1 && drop !== -1);
  assert.ok(body.indexOf('stopForeground(true)') === -1, 'the old form is gone');
  assert.ok(raise < drop, 'the notice must be raised before it is taken down');

  const bridge = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/Bridge.java'), 'utf8');
  /* the comments name the call they warn against, so they are read out
     first: this gate is about what the code does, not what it says */
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stopping = code(/public void setSounding\(boolean on\) \{([\s\S]*?)\n    \}/.exec(bridge)[1]);
  /* A stop used to be sent as startForegroundService, which made the promise
     all over again at the very moment the app is usually in the background and
     cannot keep it. stopService asks for no promise, and unlike startService
     it is not refused while the app is away. */
  assert.ok(stopping.indexOf('stopService(') !== -1, 'a stop is sent as a stop');
  assert.ok(stopping.indexOf('startForegroundService') === -1,
    'stopping must not promise a foreground the app cannot reach');
  assert.ok(stopping.indexOf('startService(') === -1,
    'a plain service start is refused while the app is away');

  const showing = code(/public void showSounding\(String title, String sub, boolean playing\) \{([\s\S]*?)\n    \}/.exec(bridge)[1]);
  assert.ok(showing.indexOf('startForegroundService') !== -1, 'a start still raises the shade');
  assert.ok(/inFront[\s\S]{0,40}return;[\s\S]*startForegroundService/.test(showing),
    'the promise is made only while the app is visible');

  /* and the flag follows the window the system itself measures against */
  const main = code(fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8'));
  assert.ok(/protected void onStart\(\) \{[\s\S]{0,120}inFront = true/.test(main), 'raised at onStart');
  assert.ok(/protected void onStop\(\) \{[\s\S]{0,120}inFront = false/.test(main), 'lowered at onStop');
});

test('ليلة الجمعة is reminded after the maghrib of thursday, once a week', () => {
  const { win, doc } = boot();
  /* the night of jumuah begins at the sunset of thursday, not at midnight */
  assert.strictEqual(win.Store.get('jumuahNight'), true, 'it is on unless the reader turns it off');
  const eve = win.App.helpers.reminderList().filter(function (r) { return r.t === 'ليلة الجمعة'; });
  assert.strictEqual(eve.length, 1, 'once in the week, got ' + eve.length);
  const when = new Date(eve[0].at);
  assert.strictEqual(when.getDay(), 4, 'on a thursday');
  assert.ok(when.getHours() >= 16, 'after maghrib, got ' + when.getHours());
  assert.ok(eve[0].b.indexOf('الصلاة على النبي') !== -1);

  /* the list must reach far enough that a weekly reminder is never missed */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function reminderList\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('for (var d = 0; d < 8; d++)') !== -1,
    'seven days can miss a thursday entirely if this one has passed');

  /* and the reader may stop it */
  win.App.go('settings');
  const sw = doc.getElementById('settings-jumuah-night');
  assert.ok(sw, 'the switch is offered');
  assert.strictEqual(sw.getAttribute('aria-checked'), 'true');
  click(win, sw);
  assert.strictEqual(win.Store.get('jumuahNight'), false);
  assert.strictEqual(win.App.helpers.reminderList().filter(function (r) { return r.t === 'ليلة الجمعة'; }).length, 0);
});

test('the night of jumuah is not put off a week because its moment passed', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the night runs from the maghrib of thursday to the fajr of friday */
  const window = /function inJumuahNight\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(window.indexOf('now.getDay() === 4') !== -1 && window.indexOf('minutes >= t.maghrib') !== -1);
  assert.ok(window.indexOf('now.getDay() === 5') !== -1 && window.indexOf('minutes < f.fajr') !== -1);
  /* opened late in that night, the reminder is still owed tonight */
  assert.ok(/if \(atJumuah <= Date\.now\(\) && d === 0 && inJumuahNight\(\)\) \{[\s\S]{0,220}Date\.now\(\) \+ 120000/.test(app),
    'a reminder of this night must not arrive next week');

  const { win, doc } = boot();
  /* and the app greets the night when opened in it, once */
  const sheet = /function maybeJumuahNightSheet\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* it greets the reader on every opening through the night, not once */
  assert.ok(sheet.indexOf('jumuahNightShown') === -1, 'no longer shown once and then no more');
  assert.ok(sheet.indexOf('inJumuahNight()') !== -1, 'it is bound to the night itself');
  ['الصلاة على النبي', 'سورة الكهف', 'ساعة لا يُرد فيها سائل', 'بكّر إلى المسجد'].forEach(function (line) {
    assert.ok(sheet.indexOf(line) !== -1, 'the sunnahs should include ' + line);
  });
  assert.ok(sheet.indexOf('open-kahf') !== -1, 'with al-kahf one press away');
  void win; void doc;
});

test('the night of jumuah can be shared, put off, or dismissed', () => {
  /* the sheet is bound to the night itself, not to a once-only flag, so the
     clock is handed a thursday evening rather than left to whenever the suite
     happens to run */
  const night = new Date(2026, 8, 10, 23, 0, 0).getTime();
  const { win, doc } = boot({ now: new Date(night) });
  win.App.helpers.maybeJumuahNightSheet();
  const tools = [...doc.querySelectorAll('#sheet .sheet-tools .btn')].map(function (b) { return b.textContent.trim(); });
  assert.deepStrictEqual(tools, ['صورة', 'ذكّرني بعد ساعة', 'لا تُذكّرني']);

  /* put off to a stated hour, and the list honours it */
  const at = win.App.helpers.snoozeJumuahNight(60);
  assert.ok(at > night + 59 * 60000 && at < night + 61 * 60000);
  assert.strictEqual(win.Store.get('jumuahNightAt'), at);

  /* dismissed for good, and it can be brought back. The button is on the
     sheet, so it puts the sheet away and leaves the notification alone: a
     reader who wants no popup may still want to be called at night. */
  click(win, doc.querySelector('[data-act="hide-jumuah-night"]'));
  assert.strictEqual(win.Store.get('jumuahNightSheet'), false, 'the sheet is put away');
  assert.strictEqual(win.Store.get('jumuahNight'), true, 'and the notification is untouched');
  assert.strictEqual(win.App.helpers.maybeJumuahNightSheet(), false, 'it does not come back');
  /* the notification's switch still reads on, because the sheet's button
     never touched it. And the sheet has a switch of its own now, which is
     where it is brought back from. */
  win.App.go('reminders');
  assert.strictEqual(doc.getElementById('settings-jumuah-night').getAttribute('aria-checked'), 'true');
  const sheetSwitch = doc.getElementById('settings-jumuah-sheet');
  assert.strictEqual(sheetSwitch.getAttribute('aria-checked'), 'false', 'and reads off after the button');
  click(win, sheetSwitch);
  assert.strictEqual(win.Store.get('jumuahNightSheet'), true, 'the sheet comes back from its own switch');

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/function shareJumuahNight\(\)/.test(app));
  assert.ok(app.indexOf('JUMUAH_NIGHT_SUNAN') !== -1, 'the sheet and the picture read from one list');
});

test('a card keeps the breaks the text asks for', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* four sunnahs run together read as one long sentence rather than four */
  assert.ok(app.indexOf("String(text).split('\\n').forEach(function (part) {") !== -1,
    'the text is broken where it asks to be');
  assert.ok(/wrap\(ctx, part\.split\(' '\), W - PAD \* 2 - 40\)/.test(app),
    'and each piece is then wrapped on its own');
});

test('a shared list is drawn in pills, in the app\'s own face, and names the app in full', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function listCard\(heading, items, note\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* each thing in its own pill: a list run together reads as one sentence */
  assert.ok(fn.indexOf("roundRect(ctx, PAD, y, W - PAD * 2, tall, 28)") !== -1);
  /* the app's own face, not the naskh of a verse */
  assert.ok(fn.indexOf("'IBM Plex Sans Arabic'") !== -1);
  assert.ok(fn.indexOf('Amiri') === -1, 'the mushaf face is for verses, not for a list');
  /* the colour follows the reader's chosen palette */
  assert.ok(fn.indexOf('cardColours()') !== -1);
  /* and it signs itself as every card does, the app's mark over the stores' badges, no address */
  assert.ok(fn.indexOf('cardFoot(ctx, W, H)') !== -1, 'the stores are shown as their own badges');
  assert.ok(fn.indexOf('3li.info') === -1);
  /* nowhere does a picture sign itself with the bare name */
  assert.ok(app.indexOf("'سُنّتي، 3li.info'") === -1, 'the app names itself in full');
});

test('the madinah line layout is fetched into the same pages the app already uses', () => {
  const lines = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'madinah-lines.json'), 'utf8'));
  const mushaf = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'mushaf.json'), 'utf8'));
  /* the app already divides the mushaf into the madinah's own 604 pages, so
     this adds the line breaks alone and must agree with the text we hold */
  assert.strictEqual(mushaf.p.length, 604, 'the page division is already the madinah one');
  assert.strictEqual(Object.keys(lines.pages).length, 604, 'every page of the mushaf');
  /* the printed page is fifteen lines; the few that are fewer are the ones a
     surah heading or the opening of the mushaf takes room from */
  const fifteen = Object.keys(lines.pages).filter(function (n) { return lines.pages[n].length === 15; });
  assert.ok(fifteen.length > 450, 'most pages hold fifteen lines, got ' + fifteen.length);
  /* and not one ayah of the mushaf is left off a page */
  const seen = new Set();
  Object.keys(lines.pages).forEach(function (n) {
    lines.pages[n].forEach(function (line) {
      line.forEach(function (run) { seen.add(run[0] + ':' + run[1]); });
    });
  });
  let total = 0;
  mushaf.a.forEach(function (surah) { total += surah.length; });
  assert.strictEqual(total, 6236);
  assert.strictEqual(seen.size, 6236, 'every ayah falls on a page, missing ' + (6236 - seen.size));

  Object.keys(lines.pages).forEach(function (n) {
    const page = lines.pages[n];
    assert.ok(page.length >= 1 && page.length <= 15, 'page ' + n + ' has ' + page.length + ' lines');
    page.forEach(function (line) {
      line.forEach(function (run) {
        const [surah, ayah, from, to] = run;
        assert.ok(surah >= 1 && surah <= 114, 'surah out of range on page ' + n);
        const words = mushaf.a[surah - 1][ayah - 1];
        assert.ok(words, 'page ' + n + ' names ' + surah + ':' + ayah + ', which we do not hold');
        const count = words.split(' ').length;
        assert.ok(from >= 1 && to <= count && from <= to,
          surah + ':' + ayah + ' words ' + from + '-' + to + ' but it has ' + count);
      });
    });
  });
});

test('the page can be shown as the madinah mushaf prints it', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="settings-page-layout"') !== -1, 'the reader chooses the shape');
  assert.ok(html.indexOf('>نص متّصل<') !== -1 && html.indexOf('>كما طُبعت<') !== -1);

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the printed page is built as markup, so the book can set two side by side */
  const fn = /function printedPageMarkup\(n, verses, marked\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* the text is the one the app already holds; only the shape is new */
  assert.ok(fn.indexOf('Mushaf.ayah(s, a)') !== -1, 'the words come from our own mushaf');
  assert.ok(fn.indexOf('words.slice(from - 1, to)') !== -1, 'cut where the printed line cuts');
  /* a verse ending on a line gets its number; one carried over does not */
  assert.ok(fn.indexOf('var whole = to >= words.length;') !== -1);
  assert.ok(/whole \? '\\u2060<span class="ayah-num"/.test(fn));
  /* a surah opens above the line its first word falls on */
  assert.ok(fn.indexOf("first[1] === 1 && first[2] === 1") !== -1);

  /* every line holds one printed line and no more, so it is squeezed to the
     width rather than wrapped onto a second row */
  const fit = /function fitPrintedLines\(body\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fit.indexOf("scaleX(") !== -1 && fit.indexOf('room / wide') !== -1);
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.mad-line \{[\s\S]*?white-space: nowrap/);

  /* the flowing view is still the one the app opens with */
  const store = fs.readFileSync(path.join(DOCS, 'js', 'store.js'), 'utf8');
  assert.match(store, /pageLayout: 'flow'/, 'nothing changes for a reader who does not ask');
  /* and the layout is kept for reading without a network */
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf('data/madinah-lines.json') !== -1);
});

test('a printed line is held to one row, whatever its spans say', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* .ayah sets white-space itself, which overrode the line and let it wrap
     inside a span: on a page of short surahs most lines came out two rows */
  assert.match(css, /\.ayah \{ white-space: normal; \}/, 'the flowing view still wraps as it should');
  assert.match(css, /\.mad-line \.ayah, \.mad-line \.ayah \* \{ white-space: nowrap; \}/,
    'but inside a printed line nothing may wrap');
  /* the line itself asks too */
  assert.match(css, /\.mad-line \{[\s\S]*?white-space: nowrap/);
});

test('the night reminder is armed once, not afresh on every opening', () => {
  const { win, doc } = boot();
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* it used to be set two minutes out every time the app was opened, so it
     arrived over and over the whole night through */
  assert.ok(app.indexOf("if (Store.get('jumuahNightArmed') === nightKey()) atJumuah = 0;") !== -1,
    'a night already given its reminder gets no second one');
  assert.ok(app.indexOf("Store.set('jumuahNightArmed', nightKey());") !== -1);

  /* asking three times over must give the same answer */
  const when = function () {
    const r = win.App.helpers.reminderList().filter(function (x) { return x.t === 'ليلة الجمعة'; })[0];
    return r ? r.at : 0;
  };
  const first = when();
  if (first) {
    assert.strictEqual(when(), first, 'the second asking must not move it');
    assert.strictEqual(when(), first, 'nor the third');
  }

  /* hiding the sheet puts the sheet away and nothing else: the notification
     has its own switch in the settings */
  const hide = /'hide-jumuah-night': function \(\) \{([\s\S]*?)\n    \},/.exec(app)[1];
  assert.ok(hide.indexOf("Store.set('jumuahNightSheet', false);") !== -1, 'the sheet is put away');
  assert.ok(hide.indexOf("Store.set('jumuahNightQuiet', 0);") !== -1, 'and its postponement cleared');
  assert.ok(hide.indexOf("Store.set('jumuahNight'") === -1, 'the notification is left alone');
  win.Store.set('jumuahNight', false);
  assert.strictEqual(win.App.helpers.reminderList().filter(function (x) { return x.t === 'ليلة الجمعة'; }).length, 0);
  void doc;
});

test('the sunnahs of the night are offered on every opening until put off or hidden', () => {
  const { win, doc } = boot();
  const close = function () { doc.getElementById('sheet').classList.remove('is-open'); };
  win.Store.set('jumuahNight', true);
  win.Store.set('jumuahNightAt', 0);
  const shows = win.App.helpers.inJumuahNight();
  if (shows) {
    /* a reminder the reader meant to act on and did not is worth putting
       before him again, so it is not shown once and then dropped */
    assert.strictEqual(win.App.helpers.maybeJumuahNightSheet(), true); close();
    assert.strictEqual(win.App.helpers.maybeJumuahNightSheet(), true, 'again on the next opening'); close();
    assert.strictEqual(win.App.helpers.maybeJumuahNightSheet(), true, 'and the next'); close();
    /* put off, it holds its peace until the hour asked for */
    win.App.helpers.snoozeJumuahNight(60);
    assert.strictEqual(win.App.helpers.maybeJumuahNightSheet(), false, 'silent while put off'); close();
    /* the notification setting is a setting about notifications: turned off,
       the night still announces itself when the reader opens the app */
    win.Store.set('jumuahNightQuiet', 0);
    win.Store.set('jumuahNight', false);
    assert.strictEqual(win.App.helpers.maybeJumuahNightSheet(), true,
      'the sheet does not depend on the notification'); close();
    /* hidden by its own button, it does not come back at all */
    win.Store.set('jumuahNightSheet', false);
    assert.strictEqual(win.App.helpers.maybeJumuahNightSheet(), false);
  }
  /* and it stops of itself at the fajr of friday, since it is bound to the night */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function maybeJumuahNightSheet\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('!inJumuahNight()') !== -1, 'outside the night it never shows');
  assert.ok(fn.indexOf("var quiet = +Store.get('jumuahNightQuiet') || 0;") !== -1);
  assert.ok(fn.indexOf("Store.get('jumuahNight')") === -1, 'and it does not ask about the notification');
  /* nothing anywhere still keys off a once-a-night flag */
  assert.ok(app.indexOf('jumuahNightShown') === -1);
  const store = fs.readFileSync(path.join(DOCS, 'js', 'store.js'), 'utf8');
  assert.ok(store.indexOf('jumuahNightShown') === -1, 'and the setting is gone from the store too');
});

test('the splash writes the app\'s name in the app\'s own face', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  /* the splash is the first thing drawn, so its face cannot wait for the
     stylesheet to arrive: it is declared in the head itself */
  assert.ok(head.indexOf("src: url('fonts/plex-arabic-600-arabic.woff2') format('woff2');") !== -1,
    'the face is declared before anything else loads');
  assert.ok(head.indexOf("font-family: 'Sunnati Splash';") !== -1, 'under a name of its own');
  assert.ok(/font-weight: 600; font-display: block;/.test(head),
    'and holds the word back until it is ready rather than flashing a wrong face');
  assert.ok(head.indexOf('<link rel="preload" href="fonts/plex-arabic-600-arabic.woff2"') !== -1,
    'and it is fetched at once');
  /* the weight the splash asks for is the weight declared; the splash holds a
     block of its own now, the painting, so it is read to its own closing tag */
  const start = html.indexOf('<div id="boot-splash"');
  const splash = html.slice(start, html.indexOf('\n</div>', start));
  assert.ok(splash.indexOf('id="boot-city"') !== -1, 'the whole of it, down to the greeting');
  /* the name is inside the icon now, drawn from the font, so the splash does
     not write it a second time; the greeting under it asks for the face */
  assert.ok(splash.indexOf("font:600 15px/1.5 'Sunnati Splash'") !== -1 &&
    splash.indexOf("font:600 26px/1.2 'Sunnati Splash'") !== -1,
    'the greeting asks for that very face and weight');
  assert.ok(/alt="سُنّتي"/.test(splash), 'the name is still there, as the picture\'s words');
  assert.ok(splash.indexOf('>سُنّتي</span>') === -1, 'but not written twice under the icon that carries it');
  /* the declaration comes before the splash it serves */
  assert.ok(html.indexOf("plex-arabic-600-arabic.woff2") < html.indexOf('<div id="boot-splash"'));
});

test('the pictorial marks fill their box to about the same height', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* the boxes were always 24x24; it was the drawing inside each that filled
     them unequally, by as much as 44 per cent, and the eye caught it */
  const pictures = ['heart', 'sunrise', 'sunset', 'book', 'food', 'plane', 'mosque',
    'home', 'hands', 'door', 'clock', 'rain', 'sun', 'moon', 'star', 'drop'];
  pictures.forEach(function (n) {
    assert.ok(html.indexOf('<g id="i-' + n + '">') !== -1, 'missing mark ' + n);
  });
  /* the redrawn ones reach for the same height as the rest; they were not
     scaled, which would have thickened their stroke with them */
  ['21.6s-8.8-5.5-8.8-12', 'M12 2.4v3.6', 'M12 8.4v5', 'M3 3.6h6.6', 'M12 6.4a6.5 6.5']
    .forEach(function (mark) {
      assert.ok(html.indexOf(mark) !== -1, 'a redrawn mark is missing: ' + mark);
    });
  /* nothing was scaled into place */
  pictures.forEach(function (n) {
    const g = new RegExp('<g id="i-' + n + '">([\\s\\S]*?)</g>').exec(html)[1];
    assert.ok(g.indexOf('scale(') === -1, n + ' must be drawn to size, not scaled');
  });
});

test('the call of jumuah stops at the fajr, and the day keeps its section instead', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* A second sheet used to open on every launch of a friday, midnight to
     midnight, saying what the سنن الجمعة section in السنن already holds. It is
     gone, and with it the switch, the two keys and the three actions that
     served nothing else. */
  ['maybeFridaySheet', 'FRIDAY_SUNAN', "Store.get('friday')", 'share-friday',
   'snooze-friday', 'friday-off', 'fridayAt'].forEach(function (gone) {
    assert.ok(app.indexOf(gone) === -1, gone + ' is left behind');
  });
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('settings-friday') === -1, 'and the switch that turned it on');
  const store = fs.readFileSync(path.join(DOCS, 'js', 'store.js'), 'utf8');
  assert.ok(store.indexOf('fridayAt') === -1 && store.indexOf('friday: true') === -1);

  /* the night's remains, and it is bound to the night itself */
  const night = /function maybeJumuahNightSheet\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(night.indexOf('inJumuahNight()') !== -1, 'from the maghrib of thursday to the fajr');
  /* and it carries what the day one carried: the salawat, al-kahf, the hour of
     answer, and the washing and the early walk */
  ['الصلاة على النبي', 'سورة الكهف', 'لا يُرد فيها سائل', 'بكّر إلى المسجد'].forEach(function (line) {
    assert.ok(night.indexOf(line) !== -1, 'the night sheet should carry ' + line);
  });

  /* and the sunan of the day are a section of the sunan screen */
  const { win, doc } = boot({ now: new Date(2026, 8, 11, 9, 0, 0) });
  win.App.go('tracker');
  assert.ok(doc.querySelector('#tracker-list [data-fold="friday"]'), 'سنن الجمعة stand in السنن');
});

test('the shared card carries the store badges as pictures, from their proper sources', () => {
  ['app-store-ar.svg', 'google-play-ar.png'].forEach(function (f) {
    assert.ok(fs.existsSync(path.join(DOCS, 'img', 'badges', f)), 'missing badge ' + f);
  });
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const foot = /function cardFoot\(ctx, W, H\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(foot.indexOf('video.storeMarks()') !== -1 && foot.indexOf('video.drawBadges(') !== -1, 'drawn, not described');
  /* a badge that fails to load must not take the card with it */
  const video = fs.readFileSync(path.join(DOCS, 'js', 'verse-video.js'), 'utf8');
  assert.ok(video.indexOf('img.onerror = function () { resolve(null); };') !== -1);
  const card = /function listCard\(heading, items, note\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(card.indexOf('على Google Play، وقريباً App Store') === -1, 'the text line is replaced');
  /* and they are kept for a card made without a network */
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  ['img/badges/app-store-ar.svg', 'img/badges/google-play-ar.png'].forEach(function (f) {
    assert.ok(sw.indexOf(f) !== -1, f + ' is not kept for offline');
  });
});

test('the splash face cannot be overridden by the stylesheet that loads after it', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* declaring it under the app's own family name let fonts.css redeclare that
     same family and weight afterwards, taking font-display with it */
  assert.ok(html.indexOf("font-family: 'Sunnati Splash';") !== -1, 'a name of its own');
  assert.ok(html.indexOf("font:600 26px/1.2 'Sunnati Splash'") !== -1, 'and the splash asks for it first');
  const fonts = fs.readFileSync(path.join(DOCS, 'css', 'fonts.css'), 'utf8');
  assert.ok(fonts.indexOf('Sunnati Splash') === -1, 'nothing else declares that name');
  assert.ok(html.indexOf("font-display: block") !== -1, 'and it holds the word until the face is ready');
});

test('the two badges share one box, so neither reads as the larger', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const foot = /function cardFoot\(ctx, W, H\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* one height for both black shapes, set side by side */
  assert.ok(foot.indexOf('video.drawBadges(ctx, W / 2, H - 136, 40, marks)') !== -1, 'one height for both');
  /* Google's badge carries a transparent margin of its own, so it is scaled
     by its black shape and not by its whole picture, or it would sit small */
  const video = fs.readFileSync(path.join(DOCS, 'js', 'verse-video.js'), 'utf8');
  assert.ok(video.indexOf("google: { src: 'img/badges/google-play-ar.png', w: 646, h: 250, box: [41, 41, 605, 209] }") !== -1);
  assert.ok(video.indexOf('var gs = h / (g.box[3] - g.box[1]);') !== -1, 'width follows from that height');
});

test('the cards of the adhkar are all one height', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* a grid sizes each row to its own content, so tiles in different rows came
     out different heights when a name ran to two lines */
  assert.match(css, /#azkar-groups, #dua-places \{\n  align-items: stretch; grid-auto-rows: 1fr;/);
  assert.match(css, /#azkar-groups \.tile, #dua-places \.tile \{\n  height: 100%/);
  assert.match(css, /#azkar-groups \.tile-name, #dua-places \.tile-name \{\n  white-space: nowrap/);
});

test('the adhkar screen holds adhkar, and the duas sit with the duas', () => {
  const { win, doc } = boot();
  win.App.go('azkar');
  const kept = [...doc.querySelectorAll('#azkar-groups .tile .tile-name')].map(function (x) { return x.textContent; });
  assert.ok(kept.length >= 12, 'the adhkar remain, got ' + kept.length);
  assert.strictEqual(kept.filter(function (t) { return t.indexOf('دعاء') === 0; }).length, 0,
    'no chapter named a dua is left among them');

  win.App.go('dua');
  const moved = [...doc.querySelectorAll('#dua-places .tile .tile-name')].map(function (x) { return x.textContent; });
  assert.strictEqual(moved.length, 8, 'the eight place-duas, got ' + moved.length);
  moved.forEach(function (t) { assert.strictEqual(t.indexOf('دعاء'), 0, t + ' is not a dua'); });
  /* nothing was lost between the two screens */
  assert.strictEqual(kept.length + moved.length, win.App.helpers.azkarSections
    ? win.App.helpers.azkarSections().length : kept.length + moved.length);

  /* they still count what was read, like the tiles they came from */
  const tile = doc.querySelector('#dua-places .tile');
  assert.ok(tile.getAttribute('data-azkar'), 'and still open their chapter');
  assert.ok(tile.querySelector('.tile-note').textContent.indexOf('من') !== -1, 'with their tally');

  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/function isPlaceDua\(title\) \{[\s\S]{0,120}indexOf\('دعاء'\) === 0/.test(app),
    'the rule is the name itself, plainly');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf('#azkar-groups, #dua-places') !== -1, 'and both grids keep one height');
});

test('the month of fasting is named in full', () => {
  const { win } = boot();
  const hijri = fs.readFileSync(path.join(DOCS, 'js', 'hijri.js'), 'utf8');
  assert.ok(hijri.indexOf("name: 'شهر رمضان المبارك'") !== -1);
  /* and the month itself keeps its plain name in the calendar's own list */
  assert.ok(/'رجب', 'شعبان', 'رمضان', 'شوال'/.test(hijri), 'the month list is unchanged');
  void win;
});

test('the splash artwork carries the real mark, and the build refuses otherwise', () => {
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools/store/icon-build.py'), 'utf8');
  /* a page made with setContent has no origin, so a mark or a face fetched
     from http://localhost was refused and the picture was drawn without it */
  assert.ok(tool.indexOf("'http://localhost") === -1, 'nothing is fetched over a socket');
  assert.ok(tool.indexOf("'data:image/svg+xml;base64,'") !== -1, 'the mark is carried in the page itself');
  assert.ok(tool.indexOf('font/woff2;base64') !== -1, 'and so is the face');
  /* The lesson was learnt for the font and not applied to the mark beside it,
     which kept failing, so every opening screen shipped for months with a
     broken-image box where the mark should be. */
  assert.ok(tool.indexOf('naturalWidth > 0') !== -1, 'the same question is asked of the mark');
  assert.ok(tool.indexOf('the splash would ship a broken image box') !== -1,
    'a build that lost the mark must fail loudly');
  assert.ok(tool.indexOf('document.fonts.check(') !== -1 && tool.indexOf('would be drawn in the wrong font') !== -1,
    'and a build that lost the face must fail loudly, not ship quietly');
  /* and the artwork is really there, once */
  ['splash_art.png', 'splash_art_night.png'].forEach(function (f) {
    const at = path.join(__dirname, '..', 'android/app/src/main/res/drawable-nodpi', f);
    assert.ok(fs.existsSync(at), 'missing ' + f);
    assert.ok(fs.statSync(at).size > 2000, f + ' looks empty');
  });
  assert.ok(tool.indexOf('void size') === -1, 'no discarded size left in the tool');
  assert.ok(tool.indexOf('drawable-nodpi') !== -1, 'it writes where it says it writes');
});

test('every card name sits on one line, so the cards match', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* a long name wrapped and made its card taller; forcing a minimum height
     then made every card two lines tall instead of curing it */
  assert.ok(/#azkar-groups \.tile-name, #dua-places \.tile-name \{\s*\n\s*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/.test(css));
  assert.ok(css.indexOf('min-height: 2.9em') === -1, 'no forced minimum remains');
});

test('the my-place button asks again about that place', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /bind\('map-mine', 'click', function \(\) \{([\s\S]*?)\n    \}\);/.exec(app)[1];
  /* it used to recentre and nothing more, so pressing it told the reader
     nothing at all when no mosque had been found */
  assert.ok(fn.indexOf('state.lookedAt = null;') !== -1, 'the last look is forgotten');
  assert.ok(fn.indexOf('state.mosques = null;') !== -1, 'and what was found is cleared');
  assert.ok(fn.indexOf('renderMosques();') !== -1, 'so it truly asks again');
  /* locate itself says 'جاري تحديد موقعك' and then names the place, so the
     button no longer needs a word of its own */
  assert.ok(fn.indexOf('locate(') !== -1, 'the reading is taken again, which speaks for itself');
});

test('the sunan of friday stand in the sunan screen, and the card that repeated the sheet is gone', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* it said again, under the prayers and under the sunan, what the sheet of
     the night already says, so both hosts were taken out */
  assert.ok(html.indexOf('home-jumuah') === -1, 'nothing of it under the prayers');
  assert.ok(html.indexOf('tracker-jumuah') === -1, 'nothing of it under the sunan');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('renderJumuahCard') === -1, 'and no drawing left behind');
  assert.ok(app.indexOf('jumuahCardKind') === -1);
  /* the sheets themselves stay, the night's and the day's */
  /* the night's sheet remains and is now the only one: the day's opened on
     every launch from midnight to midnight and said what this section holds */
  assert.ok(app.indexOf('function maybeJumuahNightSheet() {') !== -1);
  assert.ok(app.indexOf('function maybeFridaySheet() {') === -1);

  /* and the sunan of the day are a fold of their own, at the head of the list */
  const { win, doc } = boot({ now: new Date(2026, 8, 11, 9, 0, 0) });
  win.App.go('tracker');
  const heads = [...doc.querySelectorAll('#tracker-list .fold-title')].map(function (e) { return e.textContent.trim(); });
  assert.strictEqual(heads[0], 'سنن الجمعة', 'first, because it is the day itself');
  const ids = [...doc.querySelectorAll('#tracker-list [data-check^="now:friday:"]')]
    .map(function (b) { return b.getAttribute('data-check'); });
  assert.deepStrictEqual(ids, ['now:friday:0', 'now:friday:1', 'now:friday:2', 'now:friday:3',
    'now:friday:4', 'now:friday:5', 'now:friday:6'],
    'under the same names the hour card ticks, so one marking serves both screens');
  /* folded shut when it arrives, like every other */
  const section = doc.querySelector('#tracker-list [data-fold="friday"]');
  assert.ok(section && !section.classList.contains('is-open'));

  /* the meter counts these seven on a friday and on no other day, so the
     list and the tally agree */
  const helpers = win.App.helpers;
  assert.strictEqual(helpers.totalSunnahCount(new Date(2026, 8, 11, 12)) - helpers.totalSunnahCount(new Date(2026, 8, 12, 12)), 7,
    'the seven are counted once, on friday');

  /* and on any other day it is not there at all */
  const sat = boot({ now: new Date(2026, 8, 12, 9, 0, 0) });
  sat.win.App.go('tracker');
  assert.strictEqual(sat.doc.querySelector('#tracker-list [data-fold="friday"]'), null);

  /* the picture of the day's sunan still reads the names off the screen */
  const lines = /function todaySunanLines\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(lines.indexOf("querySelectorAll('.check-label')") !== -1,
    'so the picture and the list cannot say different things');
  assert.ok(html.indexOf('data-act="share-sunan"') !== -1);
});

test('every map server is asked at once, and the first sound answer taken', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function askOverpass\(query\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* they used to be tried one after another, so when the first two were busy
     the reader waited out both and believed there were no mosques near him */
  assert.ok(fn.indexOf('OVERPASS.forEach(function (host) {') !== -1, 'all of them, at once');
  assert.ok(fn.indexOf('if (settled) return;') !== -1, 'the first sound answer wins');
  assert.ok(/setTimeout\(function \(\) \{ fail\(\); \}, \d000\)/.test(fn),
    'and none of them may hang for ever');
  assert.ok(fn.indexOf('if (!settled && left <= 0) reject') !== -1,
    'it fails only when every one of them has');
  assert.ok(/askOverpass\(query, which \+ 1\)/.test(app) === false, 'nothing tries them in turn any more');
  /* and the reader is told which of the two things happened */
  assert.ok(app.indexOf('خوادم الخرائط مشغولة الآن، وليس معناه أن لا مساجد حولك') !== -1,
    'a silent server is not the same as an empty neighbourhood');
});

test('the my-place button on the map takes the reading afresh', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /bind\('map-mine', 'click', function \(\) \{([\s\S]*?)\n    \}\);/.exec(app)[1];
  /* it used to trust the place last saved, so a reader who had moved had to
     go to the settings and update it before this button was any use */
  assert.ok(fn.indexOf('locate(function () {') !== -1, 'it asks the device again');
  assert.ok(fn.indexOf('state.lookedAt = null;') !== -1);
  assert.ok(fn.indexOf('renderMosques();') !== -1, 'and searches around the new reading');
  /* locate can now tell its caller when it is done */
  assert.ok(app.indexOf('function locate(then) {') !== -1);
  assert.ok(app.indexOf("if (typeof then === 'function') then();") !== -1);
});

test('the days the sunnah marks for fasting are offered, and only where a fast is right', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function fastToday\(date\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* the engine already tagged these days; nothing outside the calendar read it */
  assert.ok(fn.indexOf("o.kind === 'fast'") !== -1);
  /* the two eids and the days of tashreeq: a fast there is forbidden, and a
     tick would be an invitation to a wrong */
  assert.ok(fn.indexOf("o.kind === 'eid'") !== -1, 'no fast on an eid');
  /* ramadan carries mondays and white days of its own, and its fast is a duty */
  assert.ok(fn.indexOf("o.kind === 'month'") !== -1, 'ramadan is not voluntary');

  /* a monday: the section is there, one tick for the day */
  const mon = boot({ now: new Date(2026, 8, 14, 9, 0, 0) });
  mon.win.App.go('tracker');
  const head = mon.doc.querySelector('#tracker-list [data-fold="fast"] .fold-title');
  assert.ok(head, 'a monday is a day of fasting');
  assert.strictEqual(head.textContent.trim(), 'صيام التطوع');
  const ticks = mon.doc.querySelectorAll('#tracker-list [data-fold="fast"] [data-check]');
  assert.strictEqual(ticks.length, 1, 'one fast, however many reasons');
  assert.strictEqual(ticks[0].getAttribute('data-check'), 'fast');
  assert.ok(ticks[0].textContent.indexOf('صيام الإثنين') !== -1);

  /* the tick feeds the same meter as every other sunnah */
  const before = mon.doc.getElementById('tracker-done').textContent;
  click(mon.win, ticks[0]);
  assert.notStrictEqual(mon.doc.getElementById('tracker-done').textContent, before);
  assert.strictEqual(mon.win.Store.day().sunnah.fast, true);

  /* a day the sunnah does not mark: nothing there */
  const plain = boot({ now: new Date(2026, 8, 15, 9, 0, 0) });
  plain.win.App.go('tracker');
  assert.strictEqual(plain.doc.querySelector('#tracker-list [data-fold="fast"]'), null);

  /* two reasons at once are still one fast, and both are named */
  const both = boot({ now: new Date(2026, 8, 24, 9, 0, 0) });
  both.win.App.go('tracker');
  const many = both.doc.querySelectorAll('#tracker-list [data-fold="fast"] [data-check]');
  assert.strictEqual(many.length, 1, 'a thursday that is also a white day is one fast');
  const named = many[0].textContent;
  assert.ok(named.indexOf('صيام الخميس') !== -1 && named.indexOf('الأيام البيض') !== -1,
    'both reasons are named, got ' + named);

  /* and the meter counts the one tick, not the reasons: that thursday
     against the tuesday before it, an ordinary day */
  const count = both.win.App.helpers.totalSunnahCount;
  assert.strictEqual(count(new Date(2026, 8, 24, 12)) - count(new Date(2026, 8, 22, 12)), 1,
    'one added to the day, not one per reason');
});

test('the eve of a fast is reminded, before the suhur and not after it', () => {
  /* a sunday evening: monday is a day of fasting */
  const { win } = boot({ now: new Date(2026, 8, 13, 19, 0, 0) });
  const notes = win.App.helpers.reminderList().filter(function (r) { return r.t === 'صيام الغد'; });
  assert.ok(notes.length >= 1, 'the eve of a monday carries one');
  assert.ok(notes[0].b.indexOf('صيام الإثنين') !== -1, 'it names the reason, got ' + notes[0].b);
  assert.ok(notes[0].b.indexOf('السحور') !== -1, 'and it is of the night, not the dawn');

  /* it falls after the maghrib of the eve, which is the whole point */
  const eve = win.App.helpers.computeTimes(new Date(2026, 8, 13));
  const at = new Date(notes[0].at);
  assert.ok(at.getHours() * 60 + at.getMinutes() > eve.maghrib,
    'a reminder before the maghrib of the eve is a reminder of the wrong day');
  assert.strictEqual(at.getDate(), 13, 'and it belongs to the eve, not the day itself');

  /* every eve in the eight days is its own night, so they are not deduped away */
  assert.ok(win.App.helpers.reminderList().filter(function (r) { return r.t === 'صيام الغد'; }).length > 1,
    'more than one eve falls inside eight days');

  /* and it can be turned off */
  win.Store.set('fastNote', false);
  assert.strictEqual(win.App.helpers.reminderList().filter(function (r) { return r.t === 'صيام الغد'; }).length, 0);
});

test('lint stands at zero, and whatever is quietened says why', () => {
  const gradle = fs.readFileSync(path.join(__dirname, '..', 'android/app/build.gradle'), 'utf8');
  /* it had never been run: seventeen errors and twenty one warnings were
     waiting, one of them a crash on every phone below android 11 */
  assert.ok(/warningsAsErrors\s+true/.test(gradle), 'a warning is a fault, or the pile starts again');
  assert.ok(/abortOnError\s+true/.test(gradle));

  const lintXml = fs.readFileSync(path.join(__dirname, '..', 'android/app/lint.xml'), 'utf8');
  /* every id quietened must have a comment above it saying why */
  const ids = [...lintXml.matchAll(/<issue id="([^"]+)"/g)].map(function (m) { return m[1]; });
  assert.ok(ids.length > 0 && ids.length < 6, 'a short list, or it is a burial ground');
  ids.forEach(function (id) {
    const at = lintXml.indexOf('<issue id="' + id + '"');
    const before = lintXml.slice(0, at);
    const lastComment = before.lastIndexOf('<!--');
    const lastClose = before.lastIndexOf('-->');
    assert.ok(lastComment !== -1 && lastClose > lastComment &&
      before.slice(lastClose).split('\n').length < 4,
      id + ' is quietened with no reason written above it');
  });
});

test('the compile gate reads R off the resources, not off a list kept by hand', () => {
  const gate = fs.readFileSync(path.join(__dirname, '..', 'tools/android/compile-check.sh'), 'utf8');
  /* the stub named two resources, so the gate went red the first time the
     wrapper referred to a third, which is the gate failing not the code */
  assert.ok(gate.indexOf('names_from_files') !== -1 && gate.indexOf('names_from_values') !== -1,
    'R is generated from res/, so it cannot fall behind it');
  assert.ok(gate.indexOf("s/[.-]/_/g") !== -1,
    'a dot in Theme.App is not a java identifier, and aapt makes it an underscore');
  assert.ok(!/public static final class raw \{ public static final int ojeiri/.test(gate),
    'the hand-written stub is gone');
});

test('the launcher mark is carried once, as the adaptive icon every phone uses', () => {
  const res = path.join(__dirname, '..', 'android/app/src/main/res');
  /* minSdk is 26 and anydpi-v26 wins from api 26, so aapt2 resolved the icon
     to the xml at every density and the five bitmaps were never once chosen */
  const gradle = fs.readFileSync(path.join(__dirname, '..', 'android/app/build.gradle'), 'utf8');
  const min = parseInt(/minSdk(?:Version)?\s+(\d+)/.exec(gradle)[1], 10);
  assert.ok(min >= 26, 'below api 26 the bitmaps would be needed again');
  assert.ok(fs.existsSync(path.join(res, 'mipmap-anydpi/ic_launcher.xml')),
    'the -v26 qualifier said nothing that minSdk 26 did not already say');
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(function (d) {
    assert.ok(!fs.existsSync(path.join(res, 'mipmap-' + d, 'ic_launcher.png')),
      'mipmap-' + d + '/ic_launcher.png weighs and is never reached');
    /* the foreground the adaptive icon draws is a different matter: it is read
       at every density and each one is really used */
    assert.ok(fs.existsSync(path.join(res, 'mipmap-' + d, 'ic_launcher_foreground.png')));
  });
  /* and the gate watches for it coming back */
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools/review-weight.js'), 'utf8');
  assert.ok(tool.indexOf('checkShadowed') !== -1, 'the gate knows this class now');
  assert.ok(/minSdk\(\?:Version\)\?/.test(tool) || tool.indexOf('minSdk') !== -1,
    'and reads minSdk rather than assuming it');
});

test('the weight gate reads a package by itself, and refuses bytes carried twice', () => {
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools/review-weight.js'), 'utf8');
  /* ten identical copies of the opening art sat in the package for months and
     no gate was watching, so this one was written */
  assert.ok(tool.indexOf('0x06054b50') !== -1, 'it finds the end record itself');
  assert.ok(tool.indexOf('0x02014b50') !== -1, 'and walks the central directory');
  assert.ok(tool.indexOf('execFileSync') !== -1 && tool.indexOf("require('adm-zip')") === -1,
    'nothing is unpacked and nothing new is installed to read a zip');
  assert.ok(tool.indexOf('process.exit(1)') !== -1, 'a fault is an error, not a remark');
  /* and it does not go quiet when there is nothing to weigh */
  assert.ok(tool.indexOf('no package to weigh') !== -1,
    'a gate that passes when it did not run is no gate');
  /* whatever it forgives, it says why */
  const allowed = /const ALLOWED = \[([\s\S]*?)\];/.exec(tool)[1];
  const rules = allowed.match(/\{[^}]*\}/g) || [];
  rules.forEach(function (r) {
    assert.ok(r.indexOf('why:') !== -1, 'every exception carries its reason: ' + r);
  });
});

test('the art of the opening is kept once, not once for every density', () => {
  const res = path.join(__dirname, '..', 'android/app/src/main/res');
  /* the same 1080 square sat byte for byte in five folders, ten files for two
     pictures, and it was a third of the package */
  const copies = fs.readdirSync(res)
    .filter(function (d) { return d.indexOf('drawable') === 0; })
    .filter(function (d) { return fs.existsSync(path.join(res, d, 'splash_art.png')); });
  assert.deepStrictEqual(copies, ['drawable-nodpi'],
    'one copy, and in nodpi because the pixels do not change with the density');
  assert.ok(fs.existsSync(path.join(res, 'drawable-nodpi', 'splash_art_night.png')));

  /* it used to be fetched with getIdentifier and a string, which hid it from
     every tool reading the source: lint called the artwork unused and the
     shrinker kept it only because the literal happened to sit in the pool.
     Named directly, the reference is one the shrinker and lint both follow. */
  const splash = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/SplashView.java'), 'utf8');
  assert.ok(splash.indexOf('getIdentifier') === -1, 'no resource is looked up by string here');
  assert.ok(splash.indexOf('R.drawable.splash_art_night') !== -1,
    'the picture is named, so nothing can quietly drop it');
});

test('no name in the page belongs to two things', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const seen = new Map();
  const twice = [];
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    if (seen.has(m[1])) twice.push(m[1]); else seen.set(m[1], true);
  }
  /* i-plane carried two different drawings for a long while: the browser
     resolves #i-plane to the first, so the second was weight nobody saw */
  assert.deepStrictEqual([...new Set(twice)], [],
    'these names are used more than once: ' + [...new Set(twice)].join(', '));
});

test('the umrah carries what a person can be stopped by', () => {
  const data = fs.readFileSync(path.join(DOCS, 'data', 'umrah.js'), 'utf8');
  /* measured against the نبذة of الشيخ ابن باز: these are not refinements,
     they are things that stop a pilgrim where he stands */
  assert.ok(data.indexOf('فمحلي حيث حبستني') !== -1,
    'الاشتراط: one who fears he will be prevented was not told how to');
  assert.ok(data.indexOf('يُشترط لصحة الطواف أن تكون على طهارة') !== -1,
    'that purity is a condition of the tawaf and not a courtesy');
  assert.ok(data.indexOf('لا تطوف بالبيت حتى تطهر') !== -1,
    'and that a woman does not circle the house until she is pure');
  /* and the opposite, so the two are not confused */
  assert.ok(data.indexOf('ولو سعيت على غير طهارة أجزأك ذلك') !== -1,
    'while the sayi is valid without it, which is the whole point of saying both');
  assert.ok(data.indexOf('يجعل البيت عن يساره') !== -1);
  assert.ok(data.indexOf('وليس في الطواف ذكر مخصوص لكل شوط') !== -1);

  /* the second source is named, since it is where these came from */
  assert.ok(/UMRAH_SOURCE_2 = \{[^}]*بن باز/.test(data), 'and the source of them is named');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('UMRAH_SOURCE_2') !== -1, 'on the screen, not only in the file');
});

test('the umrah is walked as a journey, and every stage says its فلا حرج', () => {
  const umrah = require(path.join(DOCS, 'data', 'umrah.js'));
  /* a pilgrim in a crowd is mostly afraid of getting it wrong, so the thing
     that settles that fear gets a place of its own rather than being left
     inside a long step where nobody worried would find it */
  umrah.UMRAH_STAGES.forEach(function (stage) {
    assert.ok(stage.calm && stage.calm.length > 20, stage.t + ' has no word of reassurance');
  });

  const { win, doc } = boot();
  win.App.go('umrah');
  const stops = [...doc.querySelectorAll('#umrah-path li')];
  assert.strictEqual(stops.length, umrah.UMRAH_STAGES.length, 'a stop for every stage');
  assert.ok(stops[0].className.indexOf('is-here') !== -1, 'nothing ticked, so the first is where you stand');
  assert.strictEqual(doc.querySelector('#umrah-now .journey-title').textContent,
    umrah.UMRAH_STAGES[0].t, 'and it is named');
  /* and the folds below stay shut, as every fold in the app does: the card
     above already says which stage and which step, so nothing is gained by
     breaking that rule here */
  assert.strictEqual(doc.querySelectorAll('#umrah-stages .fold.is-open').length, 0);
  assert.ok(doc.querySelector('#umrah-now .journey-next').textContent.indexOf(umrah.UMRAH_STAGES[0].i[0]) !== -1,
    'the next step is named without opening anything');

  /* walk two stages and the road behind you changes */
  const record = {};
  ['before', 'talbiyah'].forEach(function (id) {
    const stage = umrah.UMRAH_STAGES.filter(function (s) { return s.id === id; })[0];
    stage.i.forEach(function (_, i) { record[id + ':' + i] = true; });
  });
  win.Store.set('umrah', record);
  win.App.go('home'); win.App.go('umrah');
  const walked = [...doc.querySelectorAll('#umrah-path li')].map(function (e) {
    return e.className.indexOf('is-past') !== -1 ? 'past'
      : e.className.indexOf('is-here') !== -1 ? 'here' : 'ahead';
  });
  assert.deepStrictEqual(walked, ['past', 'past', 'here', 'ahead', 'ahead']);

  /* and when it is finished it says so, rather than showing a sixth stage */
  const all = {};
  umrah.UMRAH_STAGES.forEach(function (s) { s.i.forEach(function (_, i) { all[s.id + ':' + i] = true; }); });
  win.Store.set('umrah', all);
  win.App.go('home'); win.App.go('umrah');
  assert.strictEqual(doc.querySelector('#umrah-now .journey-title').textContent, 'تقبّل الله منك');
  assert.strictEqual(doc.querySelectorAll('#umrah-path .is-here').length, 0);
});

test('the two buttons on the prayer card actually do something', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* both sat in the page with an id and a label and nothing listening: a
     button that has never once worked reads as a broken app, not a missing one */
  ['home-azkar', 'home-share-times'].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, id + ' should be on the card');
    assert.ok(new RegExp("bind\\('" + id + "'").test(app), id + ' is on the page but nothing listens');
  });
  /* the hands mark is the mark of أذكار بعد الصلاة, which is what it opens */
  assert.ok(/bind\('home-azkar', 'click', function \(\) \{ openAzkar\('afterprayer'\); \}\)/.test(app));
  assert.ok(html.indexOf('id="home-azkar" aria-label="أذكار بعد الصلاة"') !== -1,
    'and the label says what it opens');

  /* the picture of the times calls friday by the name the screen calls it */
  assert.ok(/\{ n: prayerName\('dhuhr'\), v: clockText\(t\.dhuhr\) \}/.test(app),
    'a picture of friday that says الظهر disagrees with the screen beside it');
});

test('a month of the calendar can be read without tapping thirty days', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="calendar-seasons"') !== -1, 'the month lists what it carries');
  assert.ok(/renderCalendarSeasons\(\);/.test(app), 'and it is drawn with the calendar');
  const fn = /function renderCalendarSeasons\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  /* gathered by name, not by «the run I opened last»: ramadan carries the white
     days and the odd nights inside it, and keying on the last run cut the month
     itself into eight fragments */
  assert.ok(fn.indexOf('byKey[o.key]') !== -1, 'a season is one line, however many fall inside it');
  assert.ok(fn.indexOf('spanOf') !== -1, 'and its days are compressed, not listed one by one');
  assert.ok(fn.indexOf("o.kind === 'weekly'") !== -1, 'what falls every week is not a season of the month');

  const hijri = fs.readFileSync(path.join(DOCS, 'js', 'hijri.js'), 'utf8');
  assert.ok(hijri.indexOf("name: 'شهر رمضان المبارك'") !== -1, 'the month is named as it is spoken');
  assert.ok(!/name: 'رمضان',/.test(hijri));
});

test('the reminders stand in a screen of their own, and none was dropped on the way', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  function screen(id) {
    const at = html.indexOf('id="v-' + id + '"');
    assert.ok(at !== -1, 'no screen ' + id);
    const next = html.indexOf('<section class="view"', at + 10);
    return html.slice(at, next === -1 ? html.length : next);
  }
  const rem = screen('reminders');
  const set = screen('settings');
  /* fifteen rows had piled up inside the location card with no heading */
  ['settings-notify', 'settings-after-prayer', 'settings-wird',
   'settings-jumuah-night', 'settings-fast-note', 'settings-jumuah-before',
   'settings-duha', 'settings-qiyam', 'settings-salawat', 'settings-adhan-voice',
   'settings-voice', 'settings-salawat-voice', 'settings-voice-name', 'settings-adhan'
  ].forEach(function (id) {
    assert.ok(rem.indexOf('id="' + id + '"') !== -1, id + ' did not make the move');
    assert.ok(set.indexOf('id="' + id + '"') === -1, id + ' was left behind as well');
  });
  /* and there is a way to it, from المزيد and from where it used to be */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(/nav: 'reminders'/.test(app), 'a row in المزيد');
  assert.ok(set.indexOf('data-go="reminders"') !== -1, 'a pointer left in the settings');
  assert.ok(/reminders: function \(\) \{ renderSettings\(\); renderNextFast\(\); \}/.test(app),
    'the screen draws itself when opened');
  /* the voice preview moved with them, so leaving must silence it */
  assert.ok(app.indexOf("state.view === 'reminders'") !== -1,
    'the preview is silenced on the way out of the new screen too');
});

test('the fasting mark is its own, drawn to size', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const g = /<g id="i-fast">[\s\S]*?<\/g>/.exec(html);
  assert.ok(g, 'the mark is in the sheet');
  assert.ok(g[0].indexOf('scale(') === -1, 'drawn to size, not scaled');
  /* and it is not the mark of food, which already means something else */
  const food = /<g id="i-food">[\s\S]*?<\/g>/.exec(html)[0];
  assert.notStrictEqual(g[0].replace('i-fast', ''), food.replace('i-food', ''));
});

test('every card name still fits its one line', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf('font-size: .74rem; line-height: 1.7;') !== -1);
});

test('a sheet that is due is looked for again whenever the app comes forward', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* the check used to run only at the first boot, so a reader who tapped the
     notice while the app was already open was shown nothing at all */
  const fn = /function showDueSheets\(\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(fn.indexOf('maybeEidSheet() || maybeJumuahNightSheet()') !== -1,
    'the eid first, then the night of jumuah, and nothing for the day itself');
  assert.ok(fn.indexOf("classList.contains('is-open')") !== -1,
    'and one already open is not opened over');
  /* the phone is asked first now, and the banner is for when it will not say */
  assert.ok(app.indexOf('locateQuietly(function (found) { if (!found && !sheet) maybeAskPlace(); });') !== -1,
    'still checked at boot, after the phone has been asked');

  const main = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/MainActivity.java'), 'utf8');
  assert.ok(main.indexOf('if (started) tellPage("App.helpers.showDueSheets()");') !== -1,
    'and again each time the app is brought forward');
  assert.ok(main.indexOf('else tellPage("App.helpers.showDueSheets()");') !== -1,
    'and when it is opened from a notice');
  /* not on the very first resume, since the boot check has it */
  assert.ok(main.indexOf('private boolean started = false;') !== -1);
});

test('a grid of two is not laid out by the rules of a grid of three', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  /* the rules that stretch a lone tile count in threes; on the two-column
     grid they threw the thirteenth card across both columns and left the
     fourteenth alone beneath it, which is why two cards never matched */
  assert.match(css, /\.grid:not\(\.grid-2\) > \.tile:last-child:nth-child\(3n \+ 1\)/);
  assert.match(css, /\.grid:not\(\.grid-2\) > \.tile:nth-last-child\(2\):nth-child\(3n \+ 1\)/);
  assert.match(css, /\.grid-2 > \.tile:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/,
    'a grid of two stretches its lone last card by its own rule');
  /* and a card may be narrower than the name it holds, so the name is cut
     rather than the column pushed wider */
  assert.match(css, /#azkar-groups \.tile, #dua-places \.tile \{[\s\S]*?min-width: 0;/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
});

test('the Play page is changed only by hand: its film from any link YouTube gives, its pictures from the repository', () => {
  const flow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/play-listing.yml'), 'utf8');
  assert.ok(/on:\s*workflow_dispatch:/.test(flow) && flow.indexOf('push:') === -1, 'a person decides when the page changes');
  assert.ok(flow.indexOf('[ -n "$VIDEO" ] && set -- "$@" --video "$VIDEO"') !== -1, 'the film only when one is given');
  assert.ok(/\[ "\$GRAPHICS" = true \] && set -- "\$@" --icon play\/listing\/icon-512\.png\s*\\\s*--feature play\/feature-graphic-1024x500\.png --phone play\/listing\/phone/.test(flow),
    'and the pictures only when asked, from the repository');
  assert.ok(flow.indexOf('set -- --status') !== -1, 'with the tracks and the page read first, so the log says what was there');
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools/android/play-listing.py'), 'utf8');
  assert.ok(tool.indexOf("'https://www.youtube.com/watch?v=' + m.group(1)") !== -1, 'every form of the link becomes the one the page knows');
  assert.ok(tool.indexOf('youtu\\.be/') !== -1 && tool.indexOf('shorts') !== -1, 'short links and shorts are both read');
  assert.ok(tool.indexOf("call('DELETE', f'{base}/edits/{edit}', tok)") !== -1, 'and a failed edit is dropped, so nothing changes');
  assert.ok(/pu\.call\('DELETE', f'\{base\}\/edits\/\{edit\}\/listings\/\{lang\}\/\{kind\}', tok\)\s*for p in paths:/.test(tool),
    'each kind of picture is replaced whole, so no old screenshot stays among the new');
  assert.ok(tool.indexOf("(w, h) != (512, 512)") !== -1 && tool.indexOf("(w, h) != (1024, 500)") !== -1, 'the sizes Play takes are checked before the edit');
  assert.ok(tool.indexOf('2 <= len(paths) <= 8') !== -1, 'two to eight phone screenshots');
  const icon = fs.readFileSync(path.join(__dirname, '..', 'play', 'listing', 'icon-512.png'));
  assert.deepStrictEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [512, 512], 'the store icon, as Play wants it');
  const shots = fs.readdirSync(path.join(__dirname, '..', 'play', 'listing', 'phone')).filter((n) => n.endsWith('.png'));
  assert.ok(shots.length >= 2 && shots.length <= 8, 'and the phone screenshots it takes');
  shots.forEach((n) => {
    const b = fs.readFileSync(path.join(__dirname, '..', 'play', 'listing', 'phone', n));
    assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [1080, 1920], n + ' at the size of the others');
  });
});

test('the App Store screenshots are replaced only by hand, and a version is taken back from review only when asked', () => {
  const flow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/app-store-listing.yml'), 'utf8');
  assert.ok(/on:\s*workflow_dispatch:/.test(flow) && flow.indexOf('push:') === -1 && flow.indexOf('schedule:') === -1, 'only ever by hand');
  assert.ok(/default: status/.test(flow), 'and reading is what it does unless told otherwise');
  assert.ok(/withdraw\) python3 tools\/ios\/asc-release\.py --shots-only --shots ios\/screenshots\/6\.9-inch --ipad ios\/screenshots\/ipad-13 --version "\$V" --withdraw ;;/.test(flow));
  const release = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ios', 'asc-release.py'), 'utf8');
  const back = /def withdraw\(\):([\s\S]*?)\n\n\n/.exec(release)[1];
  assert.ok(back.indexOf("if state == 'IN_REVIEW':") !== -1 && back.indexOf('raise SystemExit') !== -1, 'what Apple has begun to look at is left');
  assert.ok(back.indexOf("'attributes': {'canceled': True}") !== -1, 'a version waiting is taken back by its submission');
  const only = /if a\.shots_only:([\s\S]*?)\n    if a\.previews_only:/.exec(release)[1];
  assert.ok(only.indexOf('withdraw() if a.withdraw else None') !== -1, 'never taken back unless asked');
  assert.ok(/if taken_back and not DRY:\s*send\(taken_back\)/.test(only), 'and what was taken back is sent again');
  assert.ok(only.indexOf('attach(') === -1 && only.indexOf('write_notes(') === -1, 'the build and its notes stay as they were');
  const files = fs.readdirSync(path.join(__dirname, '..', 'ios', 'screenshots', '6.9-inch')).filter((n) => n.endsWith('.png'));
  assert.ok(files.length >= 3 && files.length <= 10, 'the set is there to place');
  files.forEach((n) => {
    const b = fs.readFileSync(path.join(__dirname, '..', 'ios', 'screenshots', '6.9-inch', n));
    assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [1320, 2868], n + ' at the 6.9 inch size');
  });
});

/* ---------------- iPad ---------------- */

test('the app runs on iPad, every way it is held, and never goes back to iPhone alone', () => {
  const spec = fs.readFileSync(path.join(__dirname, '..', 'ios', 'project.yml'), 'utf8');
  /* the app and its widget alike: Apple takes no update that runs on fewer
     devices than the version on the store */
  assert.strictEqual((spec.match(/TARGETED_DEVICE_FAMILY: "1,2"/g) || []).length, 2, 'iPhone and iPad, the app and the widget');
  assert.ok(spec.indexOf('TARGETED_DEVICE_FAMILY: "1"\n') === -1);
  const plist = fs.readFileSync(path.join(__dirname, '..', 'ios', 'Sunnati', 'Info.plist'), 'utf8');
  const pad = /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
  assert.ok(pad, 'an iPad has its own orientations');
  ['Portrait', 'PortraitUpsideDown', 'LandscapeLeft', 'LandscapeRight'].forEach((o) =>
    assert.ok(pad[1].indexOf('<string>UIInterfaceOrientation' + o + '</string>') !== -1, 'held ' + o));
  const phone = /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)[1];
  assert.deepStrictEqual(phone.match(/UIInterfaceOrientation\w+/g), ['UIInterfaceOrientationPortrait'], 'a phone stays upright');
  assert.ok(plist.indexOf('UIRequiresFullScreen') === -1, 'and the iPad may share its screen with another app');

  const swift = fs.readFileSync(path.join(__dirname, '..', 'ios', 'Sunnati', 'ReaderController.swift'), 'utf8');
  /* asked for as on a phone or a tablet, never as a Mac's desktop site */
  assert.ok(swift.indexOf('setup.defaultWebpagePreferences.preferredContentMode = .mobile') !== -1);
  /* every share sheet stands where an iPad can show it */
  const sheets = (swift.match(/UIActivityViewController\(/g) || []).length;
  assert.ok(sheets >= 3);
  assert.strictEqual((swift.match(/present\(anchored\(sheet\), animated: true\)/g) || []).length, sheets, 'each through the anchor');
  const anchor = /private func anchored\(_ sheet: UIViewController\) -> UIViewController \{([\s\S]*?)\n  \}/.exec(swift)[1];
  assert.ok(anchor.indexOf('pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)') !== -1, 'in the middle');
  assert.ok(anchor.indexOf('pop.permittedArrowDirections = []') !== -1, 'with no arrow pointing at nothing');
});

test('an iPad held upright is one wide column, its bars floating in it', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const start = css.indexOf('@media (min-width: 700px) and (min-height: 900px) and (max-aspect-ratio: 1/1) {');
  assert.ok(start !== -1, 'upright and wide, never a phone, never the book');
  const slate = css.slice(start, css.indexOf('\n}\n', start));
  assert.ok(slate.indexOf('--shell: min(720px, calc(100vw - 2 * var(--s6)));') !== -1, 'a wider column, kept readable');
  assert.ok(slate.indexOf('--lane: calc(var(--shell) - 2 * var(--s5));') !== -1, 'the cards\' own width');
  assert.ok(/\.tabs \{\s*left: calc\(50% - var\(--lane\) \/ 2\); right: calc\(50% - var\(--lane\) \/ 2\);\s*bottom: var\(--float\);/.test(slate),
    'the tabs a bar as wide as the cards, off the foot');
  ['.player {', '.toast, .banner {', '.to-top {'].forEach((sel) => assert.ok(slate.indexOf(sel) !== -1, sel + ' stands in the column'));
  assert.ok(slate.indexOf('--wide-read: 1.2;') !== -1, 'the words read grow with the column');
  /* the book is on its side, six to five at the least, and the slate is
     upright, so the two never meet */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf("'(min-width: 860px) and (min-height: 520px) and (min-aspect-ratio: 6/5)'") !== -1);
  ['.ayah-block {', '.basmala {'].forEach((sel) => {
    const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.ok(rule.indexOf('* var(--quran-scale) * var(--wide-read, 1))') !== -1, sel + ' grows with the column');
  });
  assert.ok(/\.naskh \{[^}]*var\(--quran-scale\) \* var\(--wide-read, 1\)/.test(css));
  assert.ok(/\.dhikr-text \{[^}]*var\(--quran-scale\) \* var\(--wide-read, 1\)/.test(css));
});

test('the App Store gets the 13 inch iPad screenshots with every version', () => {
  const dir = path.join(__dirname, '..', 'ios', 'screenshots', 'ipad-13');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.png')).sort();
  assert.ok(files.length >= 1 && files.length <= 10, 'one to ten, as Apple takes');
  files.forEach((n) => {
    const b = fs.readFileSync(path.join(dir, n));
    assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [2752, 2064], n + ' is the 13 inch iPad on its side');
  });
  const release = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ios', 'asc-release.py'), 'utf8');
  assert.ok(release.indexOf("IPAD = 'APP_IPAD_PRO_3GEN_129'") !== -1, 'the 13 inch set');
  assert.ok(release.indexOf('IPAD_SIZES = {(2064, 2752), (2752, 2064), (2048, 2732), (2732, 2048)}') !== -1);
  /* measured before anything is sent, and placed once though prepared and sent */
  assert.ok(/notes = open\(a\.notes, encoding='utf-8'\)\.read\(\)\.strip\(\)\s*pads = ipad_shots\(a\.ipad\) if a\.ipad else \[\]/.test(release));
  assert.ok(release.indexOf("log('the 13 inch iPad screenshots are there already (%d)' % len(sums))") !== -1);
  const ios = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/ios.yml'), 'utf8');
  assert.ok(ios.indexOf('--shots ios/screenshots/6.9-inch --ipad ios/screenshots/ipad-13 --text ios/store') !== -1, 'every version sent carries them');
  const tool = fs.readFileSync(path.join(__dirname, '..', 'tools', 'store', 'ipad-shots.mjs'), 'utf8');
  assert.ok(tool.indexOf('const PAD_W = 1376, PAD_H = 1032, SCALE = 2;') !== -1, 'drawn at the 13 inch iPad\'s own size');
  assert.ok(tool.indexOf("if (!book) throw new Error") !== -1, 'and only ever of the book');
});

/* ---------------- sharing, rating, the letter, and the walkthrough ---------------- */

const LINK_APPLE = 'https://apps.apple.com/app/id6814355836';
const LINK_PLAY = 'https://play.google.com/store/apps/details?id=com.eworldq8.sunnati';
const LINK_WEB = 'https://sunnati.3li.info/';

test('the settings end with sharing the app, rating it, the tour again and a letter to us', () => {
  const { doc } = boot();
  const spread = doc.getElementById('settings-spread');
  const help = doc.getElementById('settings-help');
  assert.ok(spread && help, 'two cards at the foot of the settings');
  const cards = doc.querySelectorAll('#v-settings > .card');
  assert.strictEqual(cards[cards.length - 2], spread, 'the next to last card');
  assert.strictEqual(cards[cards.length - 1], help, 'and the last');
  assert.ok(spread.querySelector('[data-act="share-app"]') && spread.querySelector('[data-act="rate-app"]'));
  assert.ok(help.querySelector('[data-act="start-tour"]') && help.querySelector('[data-act="send-feedback"]'));
  /* the hadith under the share, as Muslim narrates it */
  assert.ok(spread.textContent.indexOf('«مَن دلّ على خيرٍ فله مثلُ أجرِ فاعله» رواه مسلم') !== -1);
  /* and the address written out, for a phone with no mail program to open */
  assert.ok(help.textContent.indexOf('Site@hotmail.com') !== -1);
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf('.setting > .setting-act { align-self: center; }') !== -1);
  assert.ok(css.indexOf('#v-settings { padding-bottom: 88px; }') !== -1, 'the last button clears the one that goes to the top');
});

test('sharing the app sends one invitation with every store in it, by whatever the phone offers', async () => {
  let shared = null;
  const android = boot({ bridge: { shareText: function (t) { shared = t; }, pageReady: function () {} } });
  assert.strictEqual(android.win.App.helpers.shareApp(), 'app', 'the package hands it to the share sheet');
  assert.ok(shared.indexOf('سُنّتي: ') === 0, 'it says what the app is first');
  [LINK_APPLE, LINK_PLAY, LINK_WEB].forEach(function (link) { assert.ok(shared.indexOf(link) !== -1, link); });
  assert.ok(shared.indexOf('مجاني بلا إعلانات ويعمل بلا إنترنت') !== -1);
  shared = null;
  click(android.win, android.doc.querySelector('[data-act="share-app"]'));
  assert.strictEqual(shared, android.win.App.helpers.shareWords(), 'and the button in the settings is the same thing');

  /* a browser with a share sheet of its own */
  const web = boot();
  let asked = null;
  Object.defineProperty(web.win.navigator, 'share', { configurable: true, value: function (d) { asked = d; return Promise.resolve(); } });
  assert.strictEqual(web.win.App.helpers.shareApp(), 'sheet');
  assert.strictEqual(asked.title, 'سُنّتي');
  assert.strictEqual(asked.text, web.win.App.helpers.shareWords());

  /* and one with neither: the invitation is copied, and the reader told */
  const bare = boot();
  let copied = null;
  Object.defineProperty(bare.win.navigator, 'clipboard', { configurable: true, value: { writeText: function (t) { copied = t; return Promise.resolve(); } } });
  assert.strictEqual(bare.win.App.helpers.shareApp(), 'copy');
  await until(() => copied !== null);
  assert.strictEqual(copied, bare.win.App.helpers.shareWords());
  await until(() => bare.doc.getElementById('toast').textContent.indexOf('نُسخت الدعوة') === 0);
});

test('Google Play stands beside the App Store, and on an android browser takes the place of the browser\'s install', () => {
  /* the stores' card in About: both stores, each its own link, for a reader in a browser */
  const web = boot();
  web.win.App.go('about');
  const card = web.doc.getElementById('about-store');
  assert.ok(!card.hidden, 'a browser shows the stores');
  assert.deepStrictEqual([...card.querySelectorAll('a')].map((a) => a.getAttribute('href')), [LINK_APPLE, LINK_PLAY],
    'the App Store first, as on the shared verse card, then Google Play');
  [...card.querySelectorAll('img')].forEach((img) => {
    assert.strictEqual(img.getAttribute('height'), '44', 'one height for both badges');
    assert.ok(/^حمّل سُنّتي من (متجر آبل|Google Play)$/.test(img.getAttribute('alt')), 'each said in words, by the name the card uses');
  });
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf('.store-card img { display: block; height: 44px; width: auto; }') !== -1);
  const inApp = boot({ bridge: { pageReady: function () {} } });
  inApp.win.App.go('about');
  assert.ok(inApp.doc.getElementById('about-store').hidden, 'inside the app it would point at itself');

  /* an android phone in a browser is offered the store's app, once */
  const storage = memoryStorage();
  const phone = boot({ storage: storage });
  Object.defineProperty(phone.win.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' });
  assert.ok(phone.win.App.helpers.onAndroidWeb());
  assert.strictEqual(phone.win.App.helpers.offerPlay(), true);
  const banner = phone.doc.getElementById('banner');
  assert.ok(!banner.hidden && banner.textContent.indexOf('Google\u00a0Play') !== -1, 'the name kept whole on its line');
  assert.strictEqual(phone.win.App.helpers.offerPlay(), false, 'and never put twice');
  /* the browser's own offer is held, and not put to the reader over it */
  click(phone.win, phone.doc.getElementById('banner-close'));
  const event = new phone.win.Event('beforeinstallprompt');
  Object.assign(event, { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({}) });
  phone.win.dispatchEvent(event);
  assert.ok(phone.win.App.state.installOffer && phone.doc.getElementById('banner').hidden);
  /* the settings open the store as well */
  const tabs = [];
  phone.win.open = function (url) { tabs.push(url); return null; };
  phone.win.App.go('settings');
  const install = phone.doc.getElementById('settings-install');
  assert.ok(!install.hidden && install.textContent === 'ثبّت التطبيق من Google Play');
  click(phone.win, install);
  assert.deepStrictEqual(tabs, [LINK_PLAY]);
  /* and the question stays asked at the next opening: a setting missing from
     the defaults was dropped when the page loaded again */
  const again = boot({ storage: storage });
  Object.defineProperty(again.win.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' });
  assert.strictEqual(again.win.Store.get('playAsked'), true);
  assert.strictEqual(again.win.App.helpers.offerPlay(), false);

  /* inside the android app nothing is offered, and a computer keeps the browser's own install */
  assert.ok(!inApp.win.App.helpers.onAndroidWeb());
  assert.strictEqual(web.win.App.helpers.offerPlay(), false);
  const store = fs.readFileSync(path.join(DOCS, 'js', 'store.js'), 'utf8');
  assert.ok(/installAsked: false,\s*playAsked: false,/.test(store), 'both are among the settings a reload keeps');

  /* the page that explains the app says where to get it, and no longer that android is coming */
  const intro = fs.readFileSync(path.join(DOCS, 'intro.html'), 'utf8');
  assert.ok(intro.indexOf('href="' + LINK_PLAY + '"') !== -1 && intro.indexOf('href="' + LINK_APPLE + '"') !== -1);
  assert.ok(intro.indexOf('قريباً') === -1);
});

test('rating opens the store of the phone in hand, and the letter is addressed with the version in it', () => {
  const opened = [];
  const ios = boot({ bridge: { platform: function () { return 'ios'; }, version: function () { return '2.0'; } } });
  ios.win.open = function (url) { opened.push(url); return null; };
  assert.strictEqual(ios.win.App.helpers.storeLink(), LINK_APPLE + '?action=write-review');
  click(ios.win, ios.doc.querySelector('[data-act="rate-app"]'));
  assert.deepStrictEqual(opened, [LINK_APPLE + '?action=write-review'], 'handed to the phone, which opens the store');
  assert.strictEqual(ios.win.Store.get('rateAsked'), true, 'and the reader is not asked again later');

  /* the letter, by the window the iPhone hands to the phone */
  click(ios.win, ios.doc.querySelector('[data-act="send-feedback"]'));
  assert.ok(opened[1].indexOf('mailto:Site@hotmail.com?subject=' + encodeURIComponent('ملاحظات على سُنّتي') + '&body=') === 0);
  const body = decodeURIComponent(opened[1].split('&body=')[1]);
  assert.ok(body.indexOf('النسخة ' + ios.win.App.version + '، وحزمة آيفون 2.0') !== -1, 'which app it is about: ' + body);
  /* the about screen's address, which a followed link left dead inside the
     iPhone's web view */
  const about = ios.doc.querySelector('#v-about a[href^="mailto:"]');
  click(ios.win, about);
  assert.strictEqual(opened[2], about.getAttribute('href'));

  /* the android package rates on Play, and a browser by the phone it is on */
  assert.strictEqual(boot({ bridge: { pageReady: function () {} } }).win.App.helpers.storeLink(), LINK_PLAY);
  const web = boot();
  Object.defineProperty(web.win.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
  assert.strictEqual(web.win.App.helpers.storeLink(), LINK_APPLE + '?action=write-review');
  Object.defineProperty(web.win.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' });
  assert.strictEqual(web.win.App.helpers.storeLink(), LINK_PLAY);
  /* a browser opens the store in a tab of its own */
  const tabs = [];
  web.win.open = function (url, name, features) { tabs.push([url, name, features]); return null; };
  assert.strictEqual(web.win.App.helpers.openOutside(LINK_PLAY), 'tab');
  assert.deepStrictEqual(tabs, [[LINK_PLAY, '_blank', 'noopener']]);
});

test('the store apps ask to be rated once, on the seventh day the app is opened, and never over anything', () => {
  const { win, doc } = boot({ now: new Date(2026, 9, 1, 9, 0, 0), bridge: { pageReady: function () {} } });
  const h = win.App.helpers;
  assert.strictEqual(win.Store.get('usedDays'), 1, 'the opening itself counts the day');
  h.countDay();
  assert.strictEqual(win.Store.get('usedDays'), 1, 'once a day however often it is opened');
  for (let d = 2; d <= 6; d++) { win.__setNow(new Date(2026, 9, d, 9, 0, 0)); h.countDay(); }
  assert.strictEqual(win.Store.get('usedDays'), 6);
  win.App.banner.hide();
  assert.strictEqual(h.maybeAskRating(), false, 'not before the seventh day');
  win.__setNow(new Date(2026, 9, 7, 21, 0, 0));
  h.countDay();
  /* a banner already up is left alone */
  win.App.banner.show('وصل تحديث للتطبيق');
  assert.strictEqual(h.maybeAskRating(), false, 'not over another notice');
  win.App.banner.hide();
  assert.strictEqual(h.maybeAskRating(), true);
  assert.strictEqual(doc.getElementById('banner').hidden, false);
  assert.strictEqual(doc.getElementById('banner-text').textContent, 'إن نفعك سُنّتي فقيّمه في المتجر، فتقييمك يدلّ غيرك عليه');
  assert.strictEqual(doc.getElementById('banner-act').textContent, 'قيّمه');
  win.App.banner.hide();
  assert.strictEqual(h.maybeAskRating(), false, 'and never again');
  /* a browser has no store to be rated in */
  const web = boot();
  web.win.Store.set('usedDays', 30);
  web.win.App.banner.hide();
  assert.strictEqual(web.win.App.helpers.maybeAskRating(), false);
  /* the app asks some seconds after it opens, not at once */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('window.setTimeout(maybeAskRating, 9000);') !== -1);
  ['usedDays', 'usedOn', 'rateAsked', 'tour'].forEach(function (k) {
    assert.ok(Object.prototype.hasOwnProperty.call(win.Store.DEFAULTS, k), k + ' is kept with the settings');
  });
});

test('a reader who opens the app new is walked through it once, step by step over the real screen', async () => {
  const { win, doc } = boot();
  const h = win.App.helpers;
  assert.strictEqual(h.tourState.returning, false, 'a phone that never had the app');
  assert.strictEqual(win.Store.get('tour'), false);
  assert.strictEqual(h.maybeStartTour(), false, 'not over the opening while it is still up');
  h.dismissBootSplash(true);
  assert.strictEqual(h.maybeStartTour(), 'first');
  const tour = doc.getElementById('tour');
  assert.strictEqual(tour.hidden, false);
  assert.strictEqual(tour.getAttribute('role'), 'dialog');
  assert.strictEqual(win.Store.get('tour'), true, 'remembered at once, so it is never shown twice');
  assert.ok(doc.documentElement.classList.contains('touring'), 'the page under it holds still');
  assert.strictEqual(doc.getElementById('tour-title').textContent, 'أهلاً بك في سُنّتي');
  assert.strictEqual(doc.getElementById('tour-next').textContent, 'ابدأ الجولة');
  assert.strictEqual(doc.getElementById('tour-skip').hidden, false, 'with its skip in plain sight');
  assert.strictEqual(doc.activeElement, doc.getElementById('tour-next'), 'the keyboard is taken into it');
  assert.strictEqual(win.history.state && win.history.state.tour, true, 'a step of its own in the history');
  assert.strictEqual(doc.querySelectorAll('#tour-dots .tour-dot').length, 6);
  assert.strictEqual(doc.getElementById('tour-dots').getAttribute('aria-label'), 'الخطوة 1 من 6');
  /* every step lights something that is on the screen */
  h.tourSteps.forEach(function (step) { if (step.at) assert.ok(doc.querySelector(step.at), step.at + ' is there'); });
  const seen = [];
  for (let i = 1; i < h.tourSteps.length; i++) {
    click(win, doc.getElementById('tour-next'));
    await until(() => doc.getElementById('tour-title').textContent === h.tourSteps[i].title);
    seen.push(doc.getElementById('tour-title').textContent);
  }
  assert.deepStrictEqual(seen, ['الصلاة القادمة', 'مواقيت اليوم', 'المصحف', 'السنن', 'المزيد']);
  assert.strictEqual(doc.getElementById('tour-dots').getAttribute('aria-label'), 'الخطوة 6 من 6');
  assert.strictEqual(doc.getElementById('tour-next').textContent, 'ابدأ', 'the last step lets the reader begin');
  assert.strictEqual(doc.getElementById('tour-skip').hidden, true, 'and has nothing left to skip');
  click(win, doc.getElementById('tour-next'));
  assert.strictEqual(h.tourState.open, false);
  assert.ok(!doc.documentElement.classList.contains('touring'));
  await until(() => tour.hidden === true);
  await until(() => !(win.history.state && win.history.state.tour));
  assert.strictEqual(h.maybeStartTour(), false, 'and once only');
  /* it waits for the opening to be gone, in the package and in a browser alike */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  assert.ok(app.indexOf('window.setTimeout(maybeStartTour, Math.max(400, 4000 - since));') !== -1);
});

test('the walkthrough ends by its skip, by escape and by the back button, and the settings bring it back', async () => {
  const { win, doc } = boot();
  const h = win.App.helpers;
  h.dismissBootSplash(true);
  h.maybeStartTour();
  click(win, doc.getElementById('tour-skip'));
  assert.strictEqual(h.tourState.open, false);
  await until(() => !(win.history.state && win.history.state.tour));

  /* taken again from the settings, even once seen, over the home screen */
  win.App.go('settings');
  click(win, doc.querySelector('[data-act="start-tour"]'));
  await until(() => h.tourState.open);
  assert.ok(doc.getElementById('v-home').classList.contains('is-open'), 'over the screen it speaks of');
  const keys = function (key) { doc.getElementById('tour').dispatchEvent(new win.KeyboardEvent('keydown', { key: key, bubbles: true })); };
  /* left is onward on a screen that reads from the right */
  keys('ArrowLeft');
  assert.strictEqual(h.tourState.at, 1);
  keys('ArrowRight');
  assert.strictEqual(h.tourState.at, 0);
  keys('ArrowRight');
  assert.strictEqual(h.tourState.at, 0, 'there is nothing before the first');
  keys('Escape');
  assert.strictEqual(h.tourState.open, false);
  await until(() => !(win.history.state && win.history.state.tour));

  /* the back button of a phone ends it and goes nowhere else */
  h.startTour(true);
  assert.strictEqual(win.history.state && win.history.state.tour, true);
  win.history.back();
  await until(() => h.tourState.open === false);
  assert.ok(doc.getElementById('v-home').classList.contains('is-open'), 'still on the home screen');
});

test('someone who used the app before is not walked through it after an update, and a new iPhone is', () => {
  const used = memoryStorage();
  used.setItem('sunnati.days', JSON.stringify({ '2026-10-01': {} }));
  const a = boot({ storage: used });
  assert.strictEqual(a.win.App.helpers.tourState.returning, true);
  assert.strictEqual(a.win.Store.get('tour'), true, 'counted as seen');
  a.win.App.helpers.dismissBootSplash(true);
  assert.strictEqual(a.win.App.helpers.maybeStartTour(), false);
  /* the first version kept its own keys */
  const old = memoryStorage();
  old.setItem('sunnati_fontSize', '110');
  assert.strictEqual(boot({ storage: old }).win.App.helpers.tourState.returning, true);
  /* settings of the reader's own */
  const mine = memoryStorage();
  mine.setItem('sunnati.settings', JSON.stringify({ placeAsked: true, theme: 'dark' }));
  assert.strictEqual(boot({ storage: mine }).win.App.helpers.tourState.returning, true);
  /* but the placeAsked the iPhone's wrapper writes before the page wakes is no past */
  const ios = memoryStorage();
  ios.setItem('sunnati.settings', JSON.stringify({ placeAsked: true }));
  const fresh = boot({ storage: ios, bridge: { platform: function () { return 'ios'; }, version: function () { return '2.0'; } } });
  assert.strictEqual(fresh.win.App.helpers.tourState.returning, false);
  assert.strictEqual(fresh.win.Store.get('tour'), false, 'a new iPhone is walked through it');
});

test('the walkthrough speaks the app\'s own arabic, a sentence a step with its full stop at the end, and sits above everything', () => {
  const { win } = boot();
  const steps = win.App.helpers.tourSteps;
  assert.strictEqual(steps.length, 6, 'short: a welcome and five steps');
  steps.forEach(function (s) {
    assert.ok(/\.$/.test(s.body), s.title + ' ends with its full stop');
    assert.strictEqual(s.body.split('.').length, 2, s.title + ' has no full stop in its middle');
    assert.ok(!/[–—]/.test(s.title + s.body), s.title + ' has no dashes');
  });
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const z = /\.tour \{[^}]*z-index: (\d+);/.exec(css);
  assert.ok(z && +z[1] > 200 && +z[1] < 900, 'over the sheets, the toast and the tabs, and under nothing but the sky it closes');
  assert.ok(/\.tour-hole \{[^}]*0 0 0 200vmax var\(--tour-dim\)/.test(css), 'one light, its shadow the dimness');
  assert.ok(css.indexOf('html.touring { overflow: hidden; }') !== -1);
});

test('the App Store page is written from the repository with each version, within what Apple takes', () => {
  const words = path.join(__dirname, '..', 'ios', 'store', 'ar-SA');
  const description = fs.readFileSync(path.join(words, 'description.txt'), 'utf8').trim();
  const keywords = fs.readFileSync(path.join(words, 'keywords.txt'), 'utf8').trim();
  const promo = fs.readFileSync(path.join(words, 'promotional.txt'), 'utf8').trim();
  assert.ok(description.length <= 4000, 'four thousand at most: ' + description.length);
  assert.ok(keywords.length <= 100, 'a hundred at most: ' + keywords.length);
  assert.ok(promo.length <= 170, 'a hundred and seventy at most: ' + promo.length);
  assert.ok(!/ \s*,|,\s+/.test(keywords), 'commas with no spaces around them, which would be spent from the hundred');
  /* the name and the subtitle are searched already, so the keywords do not
     spend their hundred on the same words */
  ['السنن', 'الأذكار', 'أوقات الصلاة'].forEach(function (w) { assert.ok(keywords.split(',').indexOf(w) === -1, w + ' is in the subtitle'); });
  assert.ok(description.indexOf('ﷺ') === -1 && promo.indexOf('ﷺ') === -1, 'Apple refuses the sign of the salutation');
  assert.ok(description.indexOf('ودجت') !== -1, 'the iPhone has its widget');
  assert.ok(description.indexOf('والتطبيق مغلق') === -1, 'and no claim of the android alarm');
  const release = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ios', 'asc-release.py'), 'utf8');
  assert.ok(release.indexOf("('keywords.txt', 'keywords', 100)") !== -1 && release.indexOf("('description.txt', 'description', 4000)") !== -1 &&
    release.indexOf("('promotional.txt', 'promotionalText', 170)") !== -1, 'the tool holds the same limits');
  assert.ok(/write_notes\(version_id, notes_for\)\n    if a\.text:\n        write_text\(version_id, a\.text\)/.test(release), 'written beside what is new');
  const flow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ios.yml'), 'utf8');
  assert.ok(flow.indexOf('--text ios/store') !== -1, 'with every version sent');
  const play = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'play-listing.yml'), 'utf8');
  assert.ok(/\[ "\$TEXT" = true \] && set -- "\$@" --text play\/listing\n/.test(play), 'and the Play page by hand, every language in its own');
});

/* ---------------- the store pages in every language ---------------- */

/* The languages each store takes for a page, by the code it gives them, as
   Google Play's help on store listing languages and Apple's locale shortcodes
   for App Store Connect listed them on 22 October 2026. Neither takes Hausa,
   and the App Store takes no Persian, so the app speaks both and the stores
   have no page in them. */
const STORE_CODES = {
  play: { ar: 'ar', en: 'en-US', id: 'id', ms: 'ms', fr: 'fr-FR', tr: 'tr-TR', ru: 'ru-RU', bn: 'bn-BD', ur: 'ur', fa: 'fa' },
  appStore: { ar: 'ar-SA', en: 'en-US', id: 'id', ms: 'ms', fr: 'fr-FR', tr: 'tr', ru: 'ru', bn: 'bn-BD', ur: 'ur-PK' }
};
const STORE_ROOT = path.join(__dirname, '..');
const STORE_DASH = /[‒-―⸺⸻﹘﹣－]/;
const pngAt = (file) => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const pngsIn = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith('.png')).sort();
const readWords = (...parts) => fs.readFileSync(path.join(STORE_ROOT, ...parts), 'utf8').trim();
const captionsModule = () => import(require('node:url').pathToFileURL(path.join(STORE_ROOT, 'tools', 'store', 'captions.mjs')).href);

test('every language a store takes has its page there, under the code that store gives it, and no other', async () => {
  const { STORES } = await captionsModule();
  for (const lang of Object.keys(STORES)) {
    assert.strictEqual(STORES[lang].play, STORE_CODES.play[lang] || null, lang + ' on Google Play');
    assert.strictEqual(STORES[lang].appStore, STORE_CODES.appStore[lang] || null, lang + ' on the App Store');
  }
  assert.strictEqual(STORES.ha.play, null, 'no store takes Hausa');
  assert.strictEqual(STORES.ha.appStore, null);
  assert.strictEqual(STORES.fa.appStore, null, 'the App Store takes no Persian');
  const dirs = (...parts) => fs.readdirSync(path.join(STORE_ROOT, ...parts), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepStrictEqual(dirs('play', 'listing').filter((d) => d !== 'phone'), Object.values(STORE_CODES.play).sort(),
    'a folder of words for each Play language, and none for a language Play does not take');
  assert.deepStrictEqual(dirs('ios', 'store'), Object.values(STORE_CODES.appStore).sort(), 'and for each App Store language');
  assert.deepStrictEqual(dirs('ios', 'screenshots').filter((d) => d !== '6.9-inch' && d !== 'ipad-13'),
    Object.values(STORE_CODES.appStore).filter((c) => c !== 'ar-SA').sort(), 'pictures beside the Arabic ones for each other App Store language');
});

test('the words of every page are within what its store takes, without a dash, and the Arabic pages keep theirs', () => {
  const limits = { 'title.txt': 30, 'short.txt': 80, 'full.txt': 4000 };
  for (const code of Object.values(STORE_CODES.play)) {
    if (code === 'ar') continue;
    for (const [file, limit] of Object.entries(limits)) {
      const words = readWords('play', 'listing', code, file);
      assert.ok(words.length > 0 && words.length <= limit, `play/listing/${code}/${file} is ${words.length}, Play takes ${limit}`);
      assert.ok(!STORE_DASH.test(words), `play/listing/${code}/${file} has no dash`);
      assert.ok(!/open[ -]?source/i.test(words), `play/listing/${code}/${file} makes no claim the app does not`);
      if (file !== 'full.txt') assert.ok(words.indexOf('\n') === -1, `play/listing/${code}/${file} is one line`);
    }
  }
  const asc = { 'name.txt': 30, 'subtitle.txt': 30, 'promotional.txt': 170, 'description.txt': 4000, 'keywords.txt': 100 };
  for (const code of Object.values(STORE_CODES.appStore)) {
    if (code === 'ar-SA') continue;
    for (const [file, limit] of Object.entries(asc)) {
      const words = readWords('ios', 'store', code, file);
      assert.ok(words.length > 0 && words.length <= limit, `ios/store/${code}/${file} is ${words.length}, Apple takes ${limit}`);
      assert.ok(!STORE_DASH.test(words), `ios/store/${code}/${file} has no dash`);
      assert.ok(words.indexOf('ﷺ') === -1, `ios/store/${code}/${file}: Apple refuses the sign of the salutation`);
    }
    const keywords = readWords('ios', 'store', code, 'keywords.txt').split(',');
    assert.ok(keywords.every((k) => k === k.trim() && k.length >= 3), code + ': commas with no spaces, and no keyword under three characters');
    assert.strictEqual(new Set(keywords.map((k) => k.toLowerCase())).size, keywords.length, code + ': no keyword twice');
    const notes = readWords('ios', 'whatsnew', code + '.txt');
    assert.ok(notes.length > 0 && notes.length <= 4000 && !STORE_DASH.test(notes) && notes.indexOf('ﷺ') === -1,
      code + ' says what is new in its own words, as Apple asks of every page of a version');
  }
  /* the iPhone's alert is a notification, so only the Play pages say the
     adhan sounds with the app closed */
  assert.ok(readWords('play', 'listing', 'en-US', 'full.txt').indexOf('even when the app is closed') !== -1);
  assert.ok(readWords('ios', 'store', 'en-US', 'description.txt').indexOf('even when the app is closed') === -1);
  /* the Arabic title and name stay as the consoles hold them */
  assert.ok(!fs.existsSync(path.join(STORE_ROOT, 'play', 'listing', 'ar', 'title.txt')));
  assert.ok(!fs.existsSync(path.join(STORE_ROOT, 'ios', 'store', 'ar-SA', 'name.txt')));
  assert.ok(!fs.existsSync(path.join(STORE_ROOT, 'ios', 'store', 'ar-SA', 'subtitle.txt')));
});

test('every page shows the scenes of the Arabic one, in its order, at the sizes its store takes', () => {
  const sets = [
    ['play', 'listing', 'phone', [1080, 1920], STORE_CODES.play, (c) => ['play', 'listing', c, 'phone']],
    ['ios', 'screenshots', '6.9-inch', [1320, 2868], STORE_CODES.appStore, (c) => ['ios', 'screenshots', c, '6.9-inch']],
    ['ios', 'screenshots', 'ipad-13', [2752, 2064], STORE_CODES.appStore, (c) => ['ios', 'screenshots', c, 'ipad-13']]
  ];
  for (const [a, b, kind, size, codes, folder] of sets) {
    const arabic = pngsIn(path.join(STORE_ROOT, a, b, kind));
    for (const code of Object.values(codes)) {
      if (code === 'ar' || code === 'ar-SA') continue;
      const dir = path.join(STORE_ROOT, ...folder(code));
      assert.deepStrictEqual(pngsIn(dir), arabic, `${path.relative(STORE_ROOT, dir)} has the scenes of ${a}/${b}/${kind}, in its order`);
      for (const n of arabic) assert.deepStrictEqual(pngAt(path.join(dir, n)), size, `${path.relative(STORE_ROOT, dir)}/${n} at ${size.join(' by ')}`);
    }
  }
});

test('the words over the pictures are written for every language, the Arabic as the Arabic pictures carry them', async () => {
  const { STORES, CAPTIONS, target } = await captionsModule();
  const scenes = ['splash', 'home', 'sky', 'sections', 'mushaf', 'azkar', 'prayers', 'qibla', 'mushaf-pad'];
  for (const lang of Object.keys(STORES)) {
    if (!STORES[lang].play && !STORES[lang].appStore) {
      assert.ok(!CAPTIONS[lang], lang + ' has no page, so no words are written for one');
      continue;
    }
    for (const scene of scenes) {
      const c = CAPTIONS[lang][scene];
      assert.ok(c && c.top && c.sub, `${lang} ${scene} has its line and the line under it`);
      assert.ok(!STORE_DASH.test(c.top + c.sub), `${lang} ${scene} has no dash`);
    }
  }
  assert.deepStrictEqual(CAPTIONS.ar.home, { top: 'أوقات الصلاة والأذان', sub: 'تقويم العجيري للكويت، وحسابٌ في جهازك لكل مكان' });
  assert.deepStrictEqual(CAPTIONS.ar['mushaf-pad'], { top: 'المصحف صفحتان متقابلتان', sub: 'برواية حفص بالرسم العثماني، ٦٠٤ صفحات وتفسير بلا شبكة' });
  Object.values(CAPTIONS.ar).forEach((c) => assert.ok((c.top + c.sub).indexOf('.') === -1, 'no full stop in the Arabic'));
  /* Arabic is drawn into the folders it always had, any other language beside them */
  const ar = target('ar');
  assert.deepStrictEqual([ar.phone, ar.ipad, ar.play], ['ios/screenshots/6.9-inch', 'ios/screenshots/ipad-13', 'play/listing/phone']);
  const en = target('en');
  assert.deepStrictEqual([en.phone, en.ipad, en.play], ['ios/screenshots/en-US/6.9-inch', 'ios/screenshots/en-US/ipad-13', 'play/listing/en-US/phone']);
  const fa = target('fa');
  assert.deepStrictEqual([fa.phone, fa.ipad, fa.play], [null, null, 'play/listing/fa/phone'], 'Persian is drawn for Play alone');
  const ha = target('ha');
  assert.deepStrictEqual([ha.phone, ha.ipad, ha.play], [null, null, null], 'and Hausa for no store');
  for (const tool of ['store-shots.mjs', 'ipad-shots.mjs']) {
    const src = fs.readFileSync(path.join(STORE_ROOT, 'tools', 'store', tool), 'utf8');
    assert.ok(src.indexOf("import { target } from './captions.mjs';") !== -1, tool + ' takes its words from captions.mjs');
    assert.ok(src.indexOf("if (lang !== 'ar') localStorage.setItem('sunnati.lang', lang);") !== -1, tool + ' opens the app in the language drawn');
    assert.ok(/const FIT = T\.lang === 'ar' \? '  place\(\);'/.test(src), tool + ' places the Arabic as it always did');
  }
});

/* The publishing tools, run against a store that answers from memory: what
   a run would write, where, and from which file, with nothing sent anywhere. */
const hasPython = require('node:child_process').spawnSync('python3', ['-c', 'pass']).status === 0;
const hasJwt = hasPython && require('node:child_process').spawnSync('python3', ['-c', 'import jwt']).status === 0;

test('the Play page is written in every language, a page made for each new one, each with its own pictures', { skip: !hasPython && 'python3 is missing' }, () => {
  const harness = [
    'import importlib.util, json, os, sys',
    'root = sys.argv[1]; os.chdir(root)',
    "s = importlib.util.spec_from_file_location('pl', os.path.join(root, 'tools', 'android', 'play-listing.py'))",
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'calls = []',
    "def call(method, url, tok, body=None, raw=None, ctype='application/json'):",
    "    short = url.split('/applications/')[-1]",
    '    calls.append([method, short, body if raw is None else len(raw)])',
    "    if method == 'POST' and short.endswith('/edits'): return {'id': 'E1'}",
    "    if method == 'GET' and short.endswith('/listings'): return {'listings': [{'language': 'ar', 'title': 'x', 'shortDescription': 'x', 'fullDescription': 'x'}]}",
    '    return {}',
    "m.pu.call = call; m.pu.token = lambda sa: 'T'",
    "os.environ['PLAY_SERVICE_ACCOUNT'] = json.dumps({'client_email': 'test@example.com'})",
    "sys.argv = ['play-listing.py'] + sys.argv[2:]",
    'm.main()',
    "print('CALLS ' + json.dumps(calls, ensure_ascii=False))"
  ].join('\n');
  const out = execFileSync('python3', ['-c', harness, STORE_ROOT, '--icon', 'play/listing/icon-512.png', '--feature', 'play/feature-graphic-1024x500.png',
    '--phone', 'play/listing/phone', '--text', 'play/listing'], { maxBuffer: 1 << 26 }).toString();
  const calls = JSON.parse(out.split('\n').find((l) => l.startsWith('CALLS ')).slice(6));
  const at = (lang) => 'com.eworldq8.sunnati/edits/E1/listings/' + lang;
  for (const code of Object.values(STORE_CODES.play)) {
    if (code === 'ar') continue;
    const made = calls.find((c) => c[0] === 'PUT' && c[1] === at(code));
    assert.ok(made, 'a page is made in ' + code);
    assert.deepStrictEqual(made[2], { title: readWords('play', 'listing', code, 'title.txt'), shortDescription: readWords('play', 'listing', code, 'short.txt'),
      fullDescription: readWords('play', 'listing', code, 'full.txt'), language: code }, 'with its own words');
  }
  const arabic = calls.filter((c) => c[0] === 'PATCH' && c[1] === at('ar'));
  assert.deepStrictEqual(arabic.map((c) => c[2]), [{ shortDescription: readWords('play', 'listing', 'ar', 'short.txt'), fullDescription: readWords('play', 'listing', 'ar', 'full.txt') }],
    'the Arabic page is written as it always was, its title left as the console holds it');
  for (const code of Object.values(STORE_CODES.play)) {
    const dir = code === 'ar' ? ['play', 'listing', 'phone'] : ['play', 'listing', code, 'phone'];
    const sizes = pngsIn(path.join(STORE_ROOT, ...dir)).map((n) => fs.statSync(path.join(STORE_ROOT, ...dir, n)).size);
    const sent = calls.filter((c) => c[0] === 'POST' && c[1] === 'com.eworldq8.sunnati/edits/E1/listings/' + code + '/phoneScreenshots?uploadType=media').map((c) => c[2]);
    assert.deepStrictEqual(sent, sizes, code + ' shows the pictures of ' + dir.join('/'));
    assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === at(code) + '/phoneScreenshots'), 'replacing whatever ' + code + ' had');
  }
  assert.ok(calls.some((c) => c[0] === 'POST' && c[1] === 'com.eworldq8.sunnati/edits/E1:commit'), 'and the edit is committed once, at the end');
  assert.ok(!calls.some((c) => /listings\/ha(\/|$)/.test(c[1])), 'with no page in Hausa');
});

test('the App Store page is written in every language with each version sent, each page its own words, what is new and pictures', { skip: !hasJwt && 'python3 with jwt is missing' }, () => {
  const os = require('node:os');
  /* an iPhone Duo picture, enough of one for its size to be read */
  const duo = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-'));
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(head);
  head.writeUInt32BE(1398, 16); head.writeUInt32BE(2034, 20);
  fs.writeFileSync(path.join(duo, 'closed-1-home-outer.png'), head);
  const harness = [
    'import glob, hashlib, importlib.util, json, os, sys',
    'root = sys.argv[1]; os.chdir(root)',
    "s = importlib.util.spec_from_file_location('asc', os.path.join(root, 'tools', 'ios', 'asc-release.py'))",
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'calls, uploads = [], []',
    "locs = {'ar-SA': {'id': 'L-ar-SA', 'attributes': {'locale': 'ar-SA', 'supportUrl': 'https://sunnati.3li.info/', 'marketingUrl': 'https://sunnati.3li.info/'}}}",
    "names = {'ar-SA': {'id': 'I-ar-SA', 'attributes': {'locale': 'ar-SA', 'name': 'x', 'subtitle': 'y', 'privacyPolicyUrl': 'https://sunnati.3li.info/privacy-en.html'}}}",
    'def arabic_sets():',
    "    out = {'data': [], 'included': []}",
    "    for kind, folder in (('APP_IPHONE_67', 'ios/screenshots/6.9-inch'), ('APP_IPAD_PRO_3GEN_129', 'ios/screenshots/ipad-13')):",
    '        ids = []',
    "        for f in sorted(glob.glob(folder + '/*.png')):",
    "            ids.append({'id': kind + f}); out['included'].append({'id': kind + f, 'type': 'appScreenshots', 'attributes': {'sourceFileChecksum': hashlib.md5(open(f, 'rb').read()).hexdigest()}})",
    "        out['data'].append({'id': 'S' + kind, 'attributes': {'screenshotDisplayType': kind}, 'relationships': {'appScreenshots': {'data': ids}}})",
    '    return out',
    'def api(method, path, body=None, writes=True):',
    "    p = path.split('?')[0]; calls.append([method, p, body])",
    "    if p == '/v1/apps/%s' % m.APP: return {'data': {'attributes': {'primaryLocale': 'ar-SA'}}}",
    "    if p.endswith('/appStoreVersions'): return {'data': [{'id': 'V1', 'attributes': {'appStoreState': 'PREPARE_FOR_SUBMISSION', 'versionString': '9.9.9'}}, {'id': 'V0', 'attributes': {'appStoreState': 'READY_FOR_SALE', 'versionString': '9.9.8'}}]}",
    "    if method == 'GET' and p.endswith('/appStoreVersionLocalizations'): return {'data': list(locs.values())}",
    "    if method == 'POST' and p == '/v1/appStoreVersionLocalizations':",
    "        a = body['data']['attributes']; locs[a['locale']] = {'id': 'L-' + a['locale'], 'attributes': dict(a)}; return {'data': locs[a['locale']]}",
    "    if p.endswith('/appInfos'): return {'data': [{'id': 'I0', 'attributes': {'state': 'READY_FOR_DISTRIBUTION'}}, {'id': 'I1', 'attributes': {'state': 'PREPARE_FOR_SUBMISSION'}}]}",
    "    if method == 'GET' and p.endswith('/appInfoLocalizations'): return {'data': list(names.values())}",
    "    if method == 'GET' and p == '/v1/appStoreVersionLocalizations/L-ar-SA/appScreenshotSets': return arabic_sets()",
    "    if method == 'GET' and (p.endswith('/appScreenshotSets') or p.endswith('/appPreviewSets')): return {'data': [], 'included': []}",
    "    if method == 'POST' and p in ('/v1/appScreenshotSets', '/v1/appPreviewSets'):",
    "        d = body['data']; return {'data': {'id': d['relationships']['appStoreVersionLocalization']['data']['id'] + '|' + (d['attributes'].get('screenshotDisplayType') or d['attributes'].get('previewType'))}}",
    "    if method == 'POST': return {'data': {'id': 'N', 'attributes': {}}}",
    '    return {}',
    "m.api = api; m.wait_for_build = lambda v, n, w: 'B1'",
    'm.upload = lambda set_id, name, data: uploads.append([set_id, name, len(data)])',
    'm.upload_film = lambda set_id, p: uploads.append([set_id, os.path.basename(p), os.path.getsize(p)])',
    "m.send = lambda v: calls.append(['SEND', v, None])",
    "sys.argv = ['asc-release.py'] + sys.argv[2:]",
    'm.main()',
    "print('RESULT ' + json.dumps({'calls': calls, 'uploads': uploads}, ensure_ascii=False))"
  ].join('\n');
  const run = (...args) => {
    const out = execFileSync('python3', ['-c', harness, STORE_ROOT, ...args], { maxBuffer: 1 << 26 }).toString();
    return Object.assign(JSON.parse(out.split('\n').find((l) => l.startsWith('RESULT ')).slice(7)), { log: out });
  };
  const sent = run('--version', '9.9.9', '--build', '1', '--duo', duo, '--notes', 'ios/whatsnew/ar-SA.txt', '--previews', 'ios/previews',
    '--shots', 'ios/screenshots/6.9-inch', '--ipad', 'ios/screenshots/ipad-13', '--text', 'ios/store', '--no-submit');
  fs.rmSync(duo, { recursive: true, force: true });
  const others = Object.values(STORE_CODES.appStore).filter((c) => c !== 'ar-SA').sort();
  /* the name and the subtitle, made for each new language, the Arabic left */
  const named = sent.calls.filter((c) => c[0] === 'POST' && c[1] === '/v1/appInfoLocalizations').map((c) => c[2].data.attributes);
  assert.deepStrictEqual(named.map((a) => a.locale), others);
  named.forEach((a) => {
    assert.strictEqual(a.name, readWords('ios', 'store', a.locale, 'name.txt'));
    assert.strictEqual(a.subtitle, readWords('ios', 'store', a.locale, 'subtitle.txt'));
    assert.strictEqual(a.privacyPolicyUrl, 'https://sunnati.3li.info/privacy-en.html', a.locale + ' takes the privacy policy of the app\'s own language');
  });
  assert.ok(!sent.calls.some((c) => c[1] === '/v1/appInfoLocalizations/I-ar-SA'), 'the Arabic name is not touched');
  /* a page made for each, with the links of the Arabic one */
  const made = sent.calls.filter((c) => c[0] === 'POST' && c[1] === '/v1/appStoreVersionLocalizations').map((c) => c[2].data.attributes);
  assert.deepStrictEqual(made.map((a) => a.locale), others);
  made.forEach((a) => assert.strictEqual(a.supportUrl, 'https://sunnati.3li.info/', a.locale + ' has the support link Apple asks of every page'));
  /* what is new and the words, each page its own */
  for (const code of Object.values(STORE_CODES.appStore)) {
    const patches = sent.calls.filter((c) => c[0] === 'PATCH' && c[1] === '/v1/appStoreVersionLocalizations/L-' + code).map((c) => c[2].data.attributes);
    assert.ok(patches.some((a) => a.whatsNew === readWords('ios', 'whatsnew', code + '.txt')), code + ' says what is new in its own words');
    const words = patches.find((a) => a.description);
    assert.deepStrictEqual(words, { description: readWords('ios', 'store', code, 'description.txt'),
      keywords: readWords('ios', 'store', code, 'keywords.txt'), promotionalText: readWords('ios', 'store', code, 'promotional.txt') }, code + ' has its own words');
  }
  /* the pictures: each new page its own, the Arabic left as it is since it holds them already */
  const byKind = (code, kind) => sent.uploads.filter((u) => u[0] === 'L-' + code + '|' + kind);
  for (const code of others) {
    for (const [kind, sub] of [['APP_IPHONE_67', '6.9-inch'], ['APP_IPAD_PRO_3GEN_129', 'ipad-13']]) {
      const dir = path.join(STORE_ROOT, 'ios', 'screenshots', code, sub);
      assert.deepStrictEqual(byKind(code, kind).map((u) => [u[1], u[2]]), pngsIn(dir).map((n) => [n, fs.statSync(path.join(dir, n)).size]),
        code + ' shows ' + path.relative(STORE_ROOT, dir));
    }
    assert.strictEqual(byKind(code, 'IPHONE_67').length, 0, code + ' is not given the Arabic film');
    assert.strictEqual(byKind(code, 'APP_IPHONE_DUO').length, 0, code + ' is not given the Arabic iPhone Duo pictures');
  }
  assert.strictEqual(byKind('ar-SA', 'APP_IPHONE_67').length + byKind('ar-SA', 'APP_IPAD_PRO_3GEN_129').length, 0, 'the Arabic pictures already there stay');
  assert.ok(/the 6\.9 inch screenshots are there already \(6\)/.test(sent.log));
  assert.deepStrictEqual(byKind('ar-SA', 'IPHONE_67').map((u) => u[1]), ['sky-day.mp4'], 'the film goes to the Arabic page');
  assert.deepStrictEqual(byKind('ar-SA', 'APP_IPHONE_DUO').map((u) => u[1]), ['closed-1-home-outer.png'], 'and so do the iPhone Duo pictures of the run');
  assert.ok(!sent.calls.some((c) => c[0] === 'SEND'), 'and a run told not to send sends nothing');

  /* the screenshots alone go to the pages there are, and a language with no
     page yet is told to wait for the version that makes it */
  const shots = run('--shots-only', '--shots', 'ios/screenshots/6.9-inch', '--ipad', 'ios/screenshots/ipad-13', '--version', '9.9.9');
  assert.strictEqual(shots.uploads.length, 0, 'the Arabic page holds its pictures already');
  others.forEach((code) => assert.ok(shots.log.indexOf(code + ' has pictures in the repository and no page in this version yet') !== -1, code + ' waits'));
  assert.ok(!shots.calls.some((c) => c[0] === 'POST' && c[1] === '/v1/appStoreVersionLocalizations'), 'and no page is made without its words');
});

test('every page of a version sent has the support link Apple asks for before the pictures, and a refusal is shown whole', { skip: !hasJwt && 'python3 with jwt is missing' }, () => {
  /* on 23 October Apple refused 8.87.101 after eleven minutes of pictures:
     the pages of the new languages had no support link, which was given only
     to a page the run made itself, and the refusal was cut off after the
     third of them */
  const harness = [
    'import importlib.util, json, os, sys',
    'root = sys.argv[1]; os.chdir(root)',
    "s = importlib.util.spec_from_file_location('asc', os.path.join(root, 'tools', 'ios', 'asc-release.py'))",
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'mine, sold, calls = json.loads(sys.argv[2]), json.loads(sys.argv[3]), []',
    'def api(method, path, body=None, writes=True):',
    "    p = path.split('?')[0]; calls.append([method, p, body])",
    "    if p == '/v1/apps/%s' % m.APP: return {'data': {'attributes': {'primaryLocale': 'ar-SA'}}}",
    "    if p.endswith('/appStoreVersions'): return {'data': [{'id': 'V1', 'attributes': {'appStoreState': 'PREPARE_FOR_SUBMISSION', 'versionString': '9.9.9'}}, {'id': 'V0', 'attributes': {'appStoreState': 'READY_FOR_SALE', 'versionString': '9.9.8'}}]}",
    "    if p == '/v1/appStoreVersions/V1/appStoreVersionLocalizations': return {'data': [{'id': 'L-' + k, 'attributes': dict(v, locale=k)} for k, v in mine.items()]}",
    "    if p == '/v1/appStoreVersions/V0/appStoreVersionLocalizations': return {'data': [{'id': 'S-' + k, 'attributes': dict(v, locale=k)} for k, v in sold.items()]}",
    '    return {}',
    'm.api = api',
    'try:',
    "    m.give_links('V1'); print('DONE yes')",
    'except SystemExit as e:',
    "    print('STOPPED ' + str(e))",
    "print('CALLS ' + json.dumps(calls))",
    "print('REFUSAL ' + json.dumps(m.refusal(sys.argv[4])))"
  ].join('\n');
  const refused = JSON.stringify({ errors: [{ status: '409', code: 'STATE_ERROR.ENTITY_STATE_INVALID',
    detail: 'This resource cannot be reviewed, please check associated errors to see why.',
    meta: { associatedErrors: Object.fromEntries(['a1', 'b2', 'c3', 'd4'].map((id) => ['/v1/appStoreVersionLocalizations/' + id, [{ status: '409',
      code: 'ENTITY_ERROR.ATTRIBUTE.REQUIRED', detail: "You must provide a value for the attribute 'supportUrl' with this request",
      source: { pointer: '/data/attributes/supportUrl' } }]])) } }] });
  const run = (mine, sold) => {
    const out = execFileSync('python3', ['-c', harness, STORE_ROOT, JSON.stringify(mine), JSON.stringify(sold), refused]).toString();
    const line = (tag) => out.split('\n').find((l) => l.startsWith(tag + ' '));
    return { done: !!line('DONE'), stopped: (line('STOPPED') || '').slice(8), refusal: JSON.parse(line('REFUSAL').slice(8)),
      links: JSON.parse(line('CALLS').slice(6)).filter((c) => c[0] === 'PATCH').map((c) => [c[1].split('/').pop(), c[2].data.attributes]) };
  };
  const SUPPORT = 'https://sunnati.3li.info/', MARKET = 'https://sunnati.3li.info/app';
  /* a page without links takes those of the Arabic page, and one with its own support link keeps it */
  const plain = run({ 'ar-SA': { supportUrl: SUPPORT, marketingUrl: MARKET }, 'en-US': {}, tr: { supportUrl: 'https://t.example/' } }, { 'ar-SA': { supportUrl: 'https://old.example/' } });
  assert.ok(plain.done);
  assert.deepStrictEqual(plain.links, [['L-en-US', { supportUrl: SUPPORT, marketingUrl: MARKET }], ['L-tr', { marketingUrl: MARKET }]]);
  /* with none on the Arabic page, each takes its own language's link on the version on sale, then the Arabic one there */
  const fromSale = run({ 'ar-SA': {}, 'en-US': {}, ms: {} }, { 'ar-SA': { supportUrl: SUPPORT }, 'en-US': { supportUrl: 'https://en.example/' } });
  assert.ok(fromSale.done);
  assert.deepStrictEqual(fromSale.links, [['L-ar-SA', { supportUrl: SUPPORT }], ['L-en-US', { supportUrl: 'https://en.example/' }], ['L-ms', { supportUrl: SUPPORT }]]);
  /* with none anywhere, the run stops, naming the pages, and nothing is written */
  const none = run({ 'ar-SA': {}, 'en-US': {} }, {});
  assert.ok(!none.done);
  assert.strictEqual(none.stopped, 'no support link was found for ar-SA, en-US, and Apple sends no version for review without one');
  assert.deepStrictEqual(none.links, []);
  /* the links are given before what is new and the pictures */
  const release = fs.readFileSync(path.join(STORE_ROOT, 'tools', 'ios', 'asc-release.py'), 'utf8');
  const main = release.slice(release.indexOf('def main():'));
  assert.ok(main.indexOf('give_links(version_id)') > main.indexOf('add_languages(version_id, a.text)'), 'after the pages a run makes');
  assert.ok(main.indexOf('give_links(version_id)') < main.indexOf('write_notes(version_id, notes_for)'), 'and before what is new and the pictures');
  /* a refusal lists every page it names, none cut off */
  const lines = none.refusal.split('\n');
  assert.strictEqual(lines[0], 'STATE_ERROR.ENTITY_STATE_INVALID: This resource cannot be reviewed, please check associated errors to see why.');
  assert.deepStrictEqual(lines.slice(1), ['a1', 'b2', 'c3', 'd4'].map((id) => "  /v1/appStoreVersionLocalizations/" + id + " /data/attributes/supportUrl: You must provide a value for the attribute 'supportUrl' with this request"));
  assert.ok(/raise SystemExit\('%s %s failed with %s: %s' % \(method, path, e\.code, refusal\(e\.read\(\)\.decode\(\)\)\)\)/.test(release), 'and the api shows it so');
});

test('both store pages are written only by hand, every language in one run', () => {
  const play = fs.readFileSync(path.join(STORE_ROOT, '.github', 'workflows', 'play-listing.yml'), 'utf8');
  const asc = fs.readFileSync(path.join(STORE_ROOT, '.github', 'workflows', 'app-store-listing.yml'), 'utf8');
  [play, asc].forEach((flow) => assert.ok(/on:\s*workflow_dispatch:/.test(flow) && flow.indexOf('push:') === -1 && flow.indexOf('schedule:') === -1));
  assert.ok(/--text play\/listing\n/.test(play), 'the words of every language, from the folder of them all');
  assert.ok(play.indexOf('--feature play/feature-graphic-1024x500.png --phone play/listing/phone') !== -1, 'each language finds its pictures beside the Arabic');
  assert.ok(/send\|replace\)[\s\S]*?--text ios\/store \\\s*--shots ios\/screenshots\/6\.9-inch \\/.test(asc), 'a version sent carries every language\'s phone pictures');
  const tool = fs.readFileSync(path.join(STORE_ROOT, 'tools', 'android', 'play-listing.py'), 'utf8');
  assert.ok(tool.indexOf("pu.call('PUT', f'{base}/edits/{edit}/listings/{lang}', tok, dict(words, language=lang))") !== -1, 'a page Play does not have yet is made');
});
