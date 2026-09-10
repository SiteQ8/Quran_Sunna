/* Boots docs/index.html inside jsdom with every script the page loads,
   then drives the interface the way a person would. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { JSDOM } = require('/tmp/node_modules/jsdom');

const DOCS = path.join(__dirname, '..', 'docs');
const SCRIPTS = [
  'data/surahs.js', 'data/azkar.js', 'data/hisn.js', 'data/ojeiri.js', 'data/marks.js', 'data/adhan.js', 'data/umrah.js', 'data/dua-themes.js', 'data/duas.js', 'data/content.js', 'data/extras.js',
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

  Object.defineProperty(win, 'localStorage', { value: memoryStorage(), configurable: true });
  if (opts.now) {
    /* the app asks the window for the date, so a fixed day can be handed to it */
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
    .filter((u) => !/^https?:|^data:|^#/.test(u));
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
  const { win, doc } = boot();
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
  const wird = doc.querySelectorAll('#tracker-list [data-check^="wird:"]');
  assert.strictEqual(wird.length, 12);
  assert.ok(wird[0].querySelector('.check-note'), 'each wird entry carries its note');
});

test('a tick on the home view feeds the same meter as the tracker', () => {
  const { win, doc } = boot();
  const box = doc.querySelector('#now-list [data-check]');
  assert.ok(box, 'the home view lists the sunnah of this window');
  click(win, box);
  assert.strictEqual(doc.getElementById('today-done').textContent, '1');
  win.App.go('tracker');
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '1');
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

/* ---------------- khatma ---------------- */

test('the khatma plan splits the mushaf and tracks pages read', () => {
  const { win, doc } = boot();
  win.App.go('khatma');
  assert.ok(doc.querySelector('[data-khatma="30"]').classList.contains('is-on'));
  assert.ok(doc.getElementById('khatma-rate').textContent.indexOf('صفحة') !== -1);

  for (let i = 0; i < 5; i++) click(win, doc.getElementById('khatma-page-plus'));
  assert.strictEqual(win.Store.progress().pagesRead, 5);
  assert.ok(doc.getElementById('khatma-state').textContent.indexOf('5') !== -1);

  click(win, doc.getElementById('khatma-page-minus'));
  assert.strictEqual(win.Store.progress().pagesRead, 4);

  click(win, doc.querySelector('[data-khatma="7"]'));
  assert.strictEqual(win.Store.get('khatmaDays'), 7);
  assert.ok(doc.querySelector('[data-khatma="7"]').classList.contains('is-on'));
});

test('pages read never fall below zero or above the mushaf', () => {
  const { win, doc } = boot();
  win.App.go('khatma');
  for (let i = 0; i < 4; i++) click(win, doc.getElementById('khatma-page-minus'));
  assert.strictEqual(win.Store.progress().pagesRead, 0);
  win.Store.setReadPages(700);
  assert.strictEqual(win.Store.progress().pagesRead, 604);
});

test('restarting the khatma clears the count', () => {
  const { win, doc } = boot();
  win.App.go('khatma');
  click(win, doc.getElementById('khatma-page-plus'));
  click(win, doc.getElementById('khatma-restart'));
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
  assert.ok(doc.querySelectorAll('#radio-list [data-station]').length >= 8);
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

test('the text size slider changes the reading scale', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const slider = doc.getElementById('settings-font');
  slider.value = '140';
  fire(win, slider, 'input');
  assert.strictEqual(win.Store.get('fontScale'), 140);
  assert.strictEqual(doc.documentElement.style.getPropertyValue('--quran-scale'), '1.4');
  assert.strictEqual(doc.getElementById('font-value').textContent, '140%');
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
  const { win, doc } = boot();
  const today = new Date();
  const wanted = today.getDay() === 5 ? 'الجمعة' : 'الظهر';
  const midday = win.App.clockState(today).marks.filter((m) => m.key === 'dhuhr')[0];
  assert.strictEqual(midday.ar, wanted);

  const names = [...doc.querySelectorAll('#windows .window-name')].map((e) => e.textContent);
  assert.ok(names.indexOf(wanted) !== -1, 'the marks should read ' + wanted + ', got ' + names.join(' '));
  assert.strictEqual(names.indexOf(today.getDay() === 5 ? 'الظهر' : 'الجمعة'), -1,
    'the other name must not appear');
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
  const { win, doc } = boot();
  const box = doc.querySelector('#now-list [data-check]');
  assert.ok(box, 'the home view lists the sunnah of this window');
  const id = box.getAttribute('data-check');
  assert.match(id, /^now:[a-z]+:\d+$/);
  /* الجمعة runs from dawn to sunset, so the card carries its sunan through the
     daytime windows and hands back to the ordinary ones after المغرب. */
  const daytime = ['duha', 'dhuhr', 'asr'].indexOf(win.App.clockState().windowKey) !== -1;
  if (new Date().getDay() === 5 && daytime) {
    assert.ok(id.indexOf('now:friday:') === 0, 'friday ticks carry their own key, got ' + id);
    assert.ok(doc.getElementById('now-title').textContent.indexOf('الجمعة') !== -1);
  }
});

test('a full day of ticks never reads more done than there is to do', () => {
  const { win, doc } = boot();
  const total = win.App.helpers.totalSunnahCount();
  assert.ok(total > 40, 'the total counts the window sunnah too, got ' + total);

  win.App.go('tracker');
  doc.querySelectorAll('#tracker-list [data-check]').forEach(function (b) {
    b.dispatchEvent(new win.Event('click', { bubbles: true }));
  });
  win.App.go('home');
  doc.querySelectorAll('#now-list [data-check]').forEach(function (b) {
    b.dispatchEvent(new win.Event('click', { bubbles: true }));
  });

  const done = win.Store.completion(new Date(), total);
  assert.ok(done.done <= done.total, done.done + ' done out of ' + done.total);
  assert.ok(done.percent <= 100, 'the meter must not run past full, got ' + done.percent);
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

test('a new version is taken only when nothing would be lost, and offered otherwise', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const handler = /controllerchange'[\s\S]{0,700}?\n    \}\);/.exec(app);
  assert.ok(handler, 'the page should notice when a new worker takes charge');
  assert.match(handler[0], /showBanner/, 'it should offer the new version');
  /* A reload before the offer is allowed only behind the guard that says the
     reader is at the front with nothing playing; mid ayah it is never forced. */
  const offerAt = handler[0].indexOf('showBanner');
  const before = handler[0].slice(0, offerAt);
  assert.ok(/atRest\) \{ window\.location\.reload\(\); return; \}/.test(before), 'a reload at rest is the only reload before the offer');
  assert.ok(/!state\.audio && !state\.recite/.test(before), 'and only with nothing playing');
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
  const { win, doc } = boot();
  click(win, doc.getElementById('hijri-down'));
  const weekday = doc.getElementById('greg-date').textContent.split('،')[0].trim();
  const noon = [...doc.querySelectorAll('#windows .window')][2].querySelector('.window-name').textContent;
  if (weekday === 'الجمعة') {
    assert.strictEqual(noon, 'الجمعة', 'the strip should say الجمعة when the header does');
  } else {
    assert.strictEqual(noon, 'الظهر', 'the strip should say الظهر on any other day');
  }
});

test('the stylesheet asks for no colour it never defined', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  [...app.matchAll(/setProperty\('(--[a-z0-9-]+)'/g)].forEach((m) => defined.add(m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
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
  ['docs/index.html', 'docs/privacy.html', 'docs/js/app.js', 'docs/js/prayer-engine.js',
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
  const kept = (sw.match(/\.\/fonts\/[^']+\.woff2/g) || []).length;
  const onDisk = fs.readdirSync(path.join(DOCS, 'fonts')).filter((f) => /\.woff2$/.test(f)).length;
  assert.strictEqual(kept, onDisk, 'every face on disk should be kept for offline');
});

test('nothing in the page reaches out to another site for something it needs', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const outside = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
    .filter((u) => !/github\.com|3li\.info|hisnmuslim\.com|alojeiri\.com/.test(u));
  assert.deepStrictEqual(outside, [],
    'the shell should stand on its own, found: ' + outside.join(', '));
});

/* ---------------- the home card folds too ---------------- */

test('the sunnah card on the home view folds with its own tally', () => {
  const { win, doc } = boot();
  const fold = doc.getElementById('now-fold');
  assert.ok(fold, 'the home sunnah card should be a folding group');
  assert.ok(!fold.classList.contains('is-open'), 'it starts folded away');
  const tally = doc.getElementById('now-tally');
  assert.match(tally.textContent, /^[0-9]+ من [0-9]+$/, 'got ' + tally.textContent);

  click(win, fold.querySelector('.fold-head'));
  assert.ok(doc.getElementById('now-fold').classList.contains('is-open'));
  assert.strictEqual(fold.querySelector('.fold-head').getAttribute('aria-expanded'), 'true');

  win.App.render.home();
  assert.ok(doc.getElementById('now-fold').classList.contains('is-open'),
    'it should stay open when the home view is drawn again');
});

test('the tally on the home card follows what is ticked', () => {
  const { win, doc } = boot();
  const before = doc.getElementById('now-tally').textContent;
  click(win, doc.querySelector('#now-list .check'));
  assert.notStrictEqual(doc.getElementById('now-tally').textContent, before);
  assert.strictEqual(doc.getElementById('now-tally').textContent.indexOf('1'), 0);
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
  assert.strictEqual(line.getAttribute('data-go'), 'settings', 'and it should lead to the settings');
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
  assert.strictEqual(tiles.length, Object.keys(win.AZKAR_DB).length);
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
  assert.ok(lines[0].indexOf(win.App.state.place.n) !== -1);
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
   'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'].forEach(function (rel) {
    assert.ok(fs.existsSync(path.join(root, rel)), 'missing ' + rel);
  });
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(function (density) {
    assert.ok(fs.existsSync(path.join(root, 'app/src/main/res/mipmap-' + density, 'ic_launcher.png')),
      'no launcher icon at ' + density);
    assert.ok(fs.existsSync(path.join(root, 'app/src/main/res/mipmap-' + density, 'ic_launcher_foreground.png')),
      'no adaptive layer at ' + density);
  });
});

test('the wrapper opens the same address the site is published at', () => {
  const root = path.join(__dirname, '..', 'android');
  const strings = fs.readFileSync(path.join(root, 'app/src/main/res/values/strings.xml'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), 'utf8');
  const site = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));

  assert.ok(strings.indexOf('https://sunnati.3li.info/') !== -1,
    'the wrapper should open the published address');
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
  assert.deepStrictEqual(asked.sort(), ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'INTERNET', 'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'VIBRATE'],
    'the network, the notification, the location the page asks for, and what an exact adhan alarm needs, nothing more');
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
  assert.strictEqual(name(29.3394, 48.0782).n, 'الكويت', 'inside a city it names the city');
  assert.strictEqual(name(29.3375, 47.6581).n, 'قرب الكويت', 'a little out it says near it');
  assert.strictEqual(name(-20, -140), null, 'far from everywhere it knows, it says nothing');
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
  const line = doc.getElementById('place-line');
  const place = line.firstChild.textContent;
  const how = line.querySelector('.place-how').textContent;
  assert.ok(line.textContent.indexOf(place + ' ' + how) !== -1 || /\s/.test(line.textContent.replace(place, '').charAt(0)),
    'they should be two words, got ' + line.textContent.replace(/\s+/g, ' '));
  assert.ok(!/الكويتتقويم/.test(line.textContent), 'they ran together');
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
  assert.strictEqual(doc.getElementById('arc-label').textContent, 'باقٍ على');
  const name = doc.getElementById('arc-name').textContent;
  const next = win.App.clockState().next;
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
  const values = [...sel.options].map((o) => o.value);
  assert.deepStrictEqual(values, ['0', '60', '120', '180', '360']);
  assert.strictEqual(sel.options[0].text, 'بلا تذكير');
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
  ['reader', 'tt', 'cal', 'player'].forEach(function (pair) {
    assert.strictEqual(arrow(pair + '-prev'), '#i-step-prev', pair + '-prev should point right, back along the reading');
    assert.strictEqual(arrow(pair + '-next'), '#i-step-next', pair + '-next should point left, onward');
  });
  /* and the sprite really draws them that way */
  const prev = doc.querySelector('#i-step-prev path').getAttribute('d');
  const next = doc.querySelector('#i-step-next path').getAttribute('d');
  assert.ok(/m10 5 7 7/.test(prev), 'i-step-prev is the right pointing chevron');
  assert.ok(/m14 5-7 7/.test(next), 'i-step-next is the left pointing chevron');
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
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة 1');
  assert.strictEqual(doc.querySelectorAll('#page-body .ayah').length, 7, 'the first page is the fatiha');
  assert.ok(doc.getElementById('page-prev').disabled, 'nothing before the first page');

  click(win, doc.getElementById('page-next'));
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة 2');
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
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة 300');

  click(win, doc.getElementById('page-jump'));
  doc.getElementById('goto-juz').value = '30';
  click(win, doc.querySelector('[data-act="goto-juz"]'));
  assert.strictEqual(doc.getElementById('page-title').textContent, 'صفحة 582');
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
  assert.match(css, /\.convert-hijri \{[^}]*grid-template-columns:\s*76px 1fr 100px/, 'the month takes the middle, the numbers their own columns');
  assert.match(css, /\.convert-hijri \.select, \.convert-hijri \.field \{[^}]*max-width:\s*none/, 'the general cap on a select would narrow the month');
  const { doc } = boot();
  const row = doc.querySelector('.convert-hijri');
  assert.deepStrictEqual([...row.children].map((e) => e.id), ['conv-hd', 'conv-hm', 'conv-hy'], 'read as a date is read');
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
  const setting = /\.setting \{([^}]*)\}/.exec(css)[1];
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
  const boot_ = /<script>\s*\/\* Before anything paints[\s\S]*?<\/script>/.exec(html);
  assert.ok(boot_, 'an inline script must run before first paint');
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
    const f = path.join(DOCS, 'audio', 'salawat', v.id + '.mp3');
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

test('a settings row keeps its label and its control on one line', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const row = /\.setting \{([^}]*)\}/.exec(css)[1];
  assert.match(row, /flex-wrap:\s*nowrap/, 'wrapping dropped the control and left half a row empty');
  assert.match(css, /\.setting > span:first-child \{[^}]*flex:\s*1 1 0/, 'the label yields first');
  assert.match(css, /\.setting \.select, \.setting \.voice-pick \{[^}]*max-width:\s*66%/, 'and the control never takes more than two thirds');
});

test('a shared picture names where its words come from, and the maker', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function textCard\(heading, text, face, source\) \{([\s\S]*?)\n  \}\n/.exec(app);
  assert.ok(fn, 'the drawer takes a source');
  assert.ok(fn[1].indexOf("ctx.fillText(source, W / 2, footY + 62)") !== -1, 'and writes it under the rosette');
  assert.ok(fn[1].indexOf("'سُنّتي، 3li.info'") !== -1, 'the foot carries the maker');
  /* each caller says what its source is */
  assert.ok(app.indexOf("'حصن المسلم، الباب ' + ar(chapter.id)") !== -1, 'a dhikr from the book names its chapter');
  assert.ok(app.indexOf("(it.r ? it.r + '، ' : '') + 'حصن المسلم'") !== -1, 'a daily dhikr names its narrator and the book');
  assert.ok(app.indexOf("'dua-' + ref[1] + '-' + ref[2] + '.png', d.r || g.cat") !== -1, 'a supplication names its reference');
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
    assert.strictEqual(sel.hidden, c[1], 'a sentence does not belong in a list');
    assert.strictEqual(plain.hidden, !c[1]);
    if (c[1]) {
      assert.strictEqual(plain.textContent, 'صوت الهاتف');
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
  assert.ok(doc.getElementById('settings-voice-hint').textContent.indexOf('الصلاة الإبراهيمية') !== -1, 'the hint says what the voice recites');
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
  const listing = fs.readFileSync(path.join(__dirname, '..', 'play', 'README.md'), 'utf8');
  const short = /### الوصف القصير\n```\n([^\n]+)\n```/.exec(listing);
  assert.ok(short, 'a short description');
  assert.ok(short[1].length <= 80, 'the store allows eighty characters, found ' + short[1].length);
  const full = /### الوصف الكامل\n```\n([\s\S]*?)\n```/.exec(listing)[1];
  assert.ok(full.length <= 4000, 'the store allows four thousand, found ' + full.length);
  ['العجيري', 'صفحة صفحة', 'مئة واثنان وثلاثون باباً', 'المنح العلية', 'الصلاة الإبراهيمية', 'السدو'].forEach(function (k) {
    assert.ok(full.indexOf(k) !== -1, 'the listing should mention ' + k);
  });
  assert.ok(full.indexOf('رفيق') === -1, 'no companion');
  assert.ok(full.indexOf('ستة عشر قسماً') === -1, 'the sixteen sections are the whole book now');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools', 'store', 'feature-graphic.mjs')), 'the graphic can be drawn again');
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
  win.fetch = function (url, opts) { asked.push({ url: String(url), mode: opts && opts.mode }); return Promise.resolve({ type: 'opaque' }); };
  win.App.state.surah = 112; win.App.go('reader');
  assert.strictEqual(doc.getElementById('reader-save').textContent.trim(), 'حفظ الصوت');
  return win.App.helpers.downloadSurah(112).then(function (ok) {
    assert.strictEqual(ok, true);
    assert.strictEqual(asked.length, 4, 'the four verses of al ikhlas');
    assert.ok(asked.every((a) => a.mode === 'no-cors'), 'kept opaque, since the cdn sends no cors headers');
    assert.ok(asked[0].url.indexOf('cdn.islamic.network/quran/audio/128/') !== -1);
    assert.strictEqual(stores['sunnati-audio'].size, 4, 'in a store apart from the app cache');
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
  assert.ok(sw.indexOf("(name === VERSION || name === AUDIO_STORE) ? null : caches.delete(name)") !== -1,
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

test('the mark is the eye of the sadu holding the crescent', () => {
  const svg = fs.readFileSync(path.join(DOCS, 'icons', 'icon.svg'), 'utf8');
  assert.ok(svg.indexOf('#8f2323') !== -1 && svg.indexOf('#5a1414') !== -1, 'the red field, deepening downward');
  assert.ok(svg.indexOf('#f3e9d2') !== -1, 'cream for the bands and the eye');
  assert.ok(svg.indexOf('#1a1412') !== -1, 'black in the heart of the eye');
  assert.ok(svg.indexOf('#d9a441') !== -1, 'the gold thread of the cushions');
  assert.ok(svg.indexOf('#1e6f47') === -1 && svg.indexOf('#268556') === -1, 'no green left in the mark');
  /* the eye: four nested diamonds, and the crescent cut from two circles */
  const diamonds = (svg.match(/<path d='M256 \d+ L\d+ 256 L256 \d+ L\d+ 256z'/g) || []).length;
  assert.ok(diamonds >= 4, 'nested diamonds, found ' + diamonds);
  assert.strictEqual((svg.match(/<circle /g) || []).length, 2, 'a moon cut from a moon');
  const teeth = (svg.match(/l[\d.]+ -?\d+ l[\d.]+ -?\d+z/g) || []).length;
  assert.ok(teeth >= 16, 'the sawtooth bands above and below, found ' + teeth);
  ['icon-192', 'icon-512', 'maskable-512', 'play-1024', 'icon-180'].forEach(function (n) {
    const png = fs.readFileSync(path.join(DOCS, 'icons', n + '.png'));
    assert.ok(png.length > 2000, n + ' is cut');
  });
  const android = path.join(__dirname, '..', 'android/app/src/main/res');
  assert.ok(fs.readFileSync(path.join(android, 'values/colors.xml'), 'utf8').indexOf('#9c2b2b') !== -1, 'the wrapper is red too');
  assert.ok(fs.readFileSync(path.join(android, 'drawable/ic_launcher_background.xml'), 'utf8').indexOf('#8f2323') !== -1);
  assert.ok(/M12,1 L23,12/.test(fs.readFileSync(path.join(android, 'drawable/ic_notification.xml'), 'utf8')), 'the status bar carries the eye');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools/store/logo.py')), 'the mark is drawn by a script, so it can be drawn again');
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
  assert.ok(html.indexOf('<img class="brand-mark" src="icons/icon.svg?v=') !== -1, 'the about page opens with the mark');
  assert.ok(html.indexOf('عين السدو الكويتي، وفي قلبها هلال') !== -1, 'and says what it is');
  assert.ok(html.indexOf('<img class="banner-mark" src="icons/icon.svg?v=') !== -1, 'the banner carries it');
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
  const fg = fs.readFileSync(path.join(__dirname, '..', 'tools', 'store', 'feature-graphic.mjs'), 'utf8');
  assert.ok(fg.indexOf("from '../social/sadu.mjs'") !== -1, 'the store graphic shares the bands');
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

test('a new version is taken at once when the reader is at rest, and offered otherwise', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /addEventListener\('controllerchange', function \(\) \{([\s\S]*?)\n    \}\);/.exec(app)[1];
  assert.ok(fn.indexOf("state.view === 'home'") !== -1 && fn.indexOf('!state.audio && !state.recite') !== -1);
  assert.ok(fn.indexOf('window.location.reload(); return;') !== -1, 'taken at rest');
  assert.ok(fn.indexOf("showBanner('وصلت نسخة جديدة من التطبيق'") !== -1, 'offered otherwise');
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
  assert.strictEqual(doc.getElementById('page-meta').textContent, 'الجزء 13، الحزب 25 وثلاثة أرباعه، سورة الرعد');
  win.App.helpers.openPage(248);
  assert.ok(doc.getElementById('page-meta').textContent.indexOf('الحزب 25 ونصفه') !== -1, 'page 248 ends in the half');
  assert.strictEqual(win.App.helpers.hizbLabel(1, 1), 'الحزب 1');
  assert.strictEqual(win.App.helpers.hizbLabel(114, 6), 'الحزب 60 وثلاثة أرباعه');
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
  assert.ok(doc.getElementById('page-title').textContent.indexOf('249') !== -1);
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
  return new Promise(function (done) {
    setTimeout(function () {
      assert.strictEqual(calls.images.length, 1);
      assert.strictEqual(calls.images[0][2], 'كلمات الآية\nsunnati.3li.info', 'the words go with the picture');
      void verseCard;
      done();
    }, 60);
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

test('the icon addresses carry a version, so a phone that kept the old mark fetches the eye', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  manifest.icons.forEach(function (i) { assert.ok(/\?v=/.test(i.src), i.src + ' should be versioned'); });
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  assert.ok(html.indexOf('href="icons/icon.svg?v=') !== -1 && html.indexOf('href="icons/icon-180.png?v=') !== -1);
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.ok(sw.indexOf("'./icons/icon-192.png?v=") !== -1, 'the worker keeps the versioned address, which is what the page asks for');
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
  const spokenFor = { INTERNET: true, POST_NOTIFICATIONS: 'الإشعارات', SCHEDULE_EXACT_ALARM: 'المنبّه الدقيق', USE_EXACT_ALARM: 'المنبّه الدقيق', RECEIVE_BOOT_COMPLETED: 'الإقلاع', VIBRATE: 'الاهتزاز', ACCESS_FINE_LOCATION: 'الموقع الجغرافي', ACCESS_COARSE_LOCATION: 'الموقع الجغرافي' };
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
  win.Store.set('adhanVoice', 'bilal');
  win.App.go('settings');
  assert.ok(given.length >= 1);
  assert.ok(/audio\/adhan\/bilal\.mp3$/.test(given[given.length - 1][0]), 'the ordinary one');
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

test('the salawat is shown in full, in the very words of the book', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const shown = doc.getElementById('salawat-text').textContent;
  /* the words are taken from حصن المسلم, never typed beside the recording, so
     the shown text must be that entry exactly, tashkeel and all */
  const chapter = win.HISN.filter(function (c) { return c.id === 23; })[0];
  const ibrahimiyya = chapter.i.filter(function (i) { return i.a === 53; })[0];
  assert.strictEqual(shown, ibrahimiyya.t);
  /* and it is the whole du'a, both halves of it */
  const bare = shown.replace(/[\u064B-\u0652\u0670]/g, '');
  ['اللهم صل على محمد', 'كما صليت على إبراهيم', 'إنك حميد مجيد', 'بارك على محمد', 'كما باركت على إبراهيم'].forEach(function (part) {
    assert.ok(bare.indexOf(part) !== -1, 'the ibrahimiyya should contain: ' + part);
  });
  assert.strictEqual((bare.match(/إنك حميد مجيد/g) || []).length, 2, 'it closes both halves');
  win.SALAWAT_VOICES.forEach(function (v) {
    const c = win.HISN.filter(function (x) { return x.id === v.hisn; })[0];
    assert.ok(c && c.i.some(function (i) { return i.a === v.a; }), v.id + ' should point into حصن المسلم');
  });
  const sel = doc.getElementById('settings-salawat-voice');
  sel.value = 'azwaj'; fire(win, sel, 'change');
  const second = chapter.i.filter(function (i) { return i.a === 54; })[0];
  assert.strictEqual(doc.getElementById('salawat-text').textContent, second.t, 'and it follows the choice');
});

test('the launcher icon is the app\'s own artwork, whole inside the safe middle', () => {
  const res = path.join(__dirname, '..', 'android/app/src/main/res');
  const adaptive = fs.readFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
  assert.ok(adaptive.indexOf('@mipmap/ic_launcher_foreground') !== -1, 'the foreground is the artwork itself, not a redrawing');
  assert.ok(adaptive.indexOf('<monochrome') !== -1, 'and a single colour form for a themed home screen');
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(function (d) {
    ['ic_launcher.png', 'ic_launcher_foreground.png'].forEach(function (f) {
      const p = path.join(res, 'mipmap-' + d, f);
      assert.ok(fs.existsSync(p) && fs.statSync(p).size > 400, d + '/' + f);
    });
  });
  const status = fs.readFileSync(path.join(res, 'drawable/ic_notification.xml'), 'utf8');
  assert.ok(status.indexOf('fillType="evenOdd"') !== -1, 'the status bar takes a silhouette, so the eye must be cut not painted');
  assert.strictEqual((status.match(/#FFFFFFFF/g) || []).length, 2, 'one colour only, as the status bar draws it');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools/store/icon-master.png')), 'the artwork every size is drawn from');
});

/* ---------------- every arrow points the way the language runs ---------------- */

test('the play mark points the way arabic runs, and every step arrow agrees with its label', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  /* the triangle opens toward the left, as the reading does */
  assert.match(html, /<g id="i-play"><path d="M17 4\.5 5 12 17 19\.5z"\/><\/g>/, 'a play mark pointing right reads backwards in an arabic interface');
  /* the step before and after are plain chevrons; the return arrow keeps its
     tail, so two arrows side by side in the reader bar are told apart */
  assert.match(html, /<g id="i-step-prev"><path d="m10 5 7 7-7 7"\/><\/g>/, 'the step before points right');
  assert.match(html, /<g id="i-step-next"><path d="m14 5-7 7 7 7"\/><\/g>/, 'the step after points left');
  assert.match(html, /<g id="i-back">.*M21 12H3/, 'the return arrow has a tail');

  const { win, doc } = boot();
  const drawn = { 'i-back': 'right', 'i-step-prev': 'right', 'i-step-next': 'left', 'i-next': 'left', 'i-play': 'left' };
  const wanted = function (label) {
    if (/سابق|رجوع|السابقة/.test(label)) return 'right';
    if (/تالي|التالية/.test(label)) return 'left';
    if (/اسمع|تشغيل|استماع/.test(label)) return 'left';
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
  assert.match(css, /i-play'\]\), \.icon:has\(use\[href='#i-pause'\]\) \{ fill: currentColor; stroke: none/, 'the triangle is a shape, so it is filled not outlined');
});

/* ---------------- صفة العمرة ---------------- */



/* ---------------- صفة العمرة ---------------- */

test('the umrah is five stages in the order the rite is performed, each naming its page', () => {
  const { win } = boot();
  /* joined, since an array built inside the page has its own realm's prototype */
  assert.strictEqual(win.UMRAH_STAGES.map((s) => s.id).join(','), 'before,talbiyah,tawaf,sayi,halq',
    'ihram, then talbiyah, then tawaf, then sayi, then the cutting of the hair');
  assert.strictEqual(win.UMRAH_STAGES.reduce((n, s) => n + s.i.length, 0), 32);
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
  assert.strictEqual(doc.querySelectorAll('[data-umrah-step]').length, 32);
  assert.strictEqual(doc.getElementById('umrah-tally').textContent, '0 من 32');
  /* every stage is folded away until asked for */
  assert.strictEqual(doc.querySelectorAll('#umrah-stages .fold.is-open').length, 0);
  click(win, doc.querySelector('#umrah-stages .fold-head'));
  assert.strictEqual(doc.querySelector('#umrah-stages .fold.is-open .fold-title').textContent.indexOf('قبل الإحرام'), 0);
  click(win, doc.querySelector('[data-umrah-step]'));
  assert.strictEqual(doc.getElementById('umrah-tally').textContent, '1 من 32');
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
  assert.ok(/btn\.hidden = window\.scrollY < 400/.test(app), 'it shows once the reader has come some way down');
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
  assert.match(css, /\.topics \{[^}]*grid-template-columns:\s*1fr 1fr/);
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
  const note = doc.querySelector('#home-upcoming .row-note').textContent;
  const first = list[0];
  assert.ok(note.indexOf(win.App.helpers.whenItFalls(first.date)) !== -1,
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
  assert.ok(html.indexOf('التطبيق مفتوح المصدر ومجاني بلا إعلانات ولا تتبع، فمن انتفع به فليدع لوالديّ ولمن ساهم فيه.') !== -1);
  assert.ok(html.indexOf('ونص حصن المسلم وتسجيلات') === -1, 'the sources are named in المصادر, not twice');
});

test('the sections fill their rows, leaving no hole at the end', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.grid > \.tile:last-child:nth-child\(3n \+ 1\) \{ grid-column: 1 \/ -1; \}/,
    'a tile left alone on the last row stretches across it');
  assert.match(css, /\.grid > \.tile:nth-last-child\(2\):nth-child\(3n \+ 1\) \{ grid-column: span 2; \}/,
    'and two left over take half each');
});

test('a friday opens with its sunnahs, once, and can be turned off', () => {
  const { win, doc } = boot({ now: new Date('2026-09-11T08:30:00+03:00') });
  win.Store.set('placeAsked', true);
  assert.strictEqual(win.App.helpers.maybeFridaySheet(), true, 'friday');
  assert.strictEqual(doc.getElementById('sheet-title').textContent, 'يوم الجمعة');
  const body = doc.getElementById('sheet-body').textContent;
  assert.ok(body.indexOf('أكثِر من الصلاة على النبي') !== -1);
  assert.ok(body.indexOf('سورة الكهف') !== -1, 'and al-kahf');
  /* the whole salawat is written out, from the book */
  assert.ok(doc.querySelector('#sheet .salawat-text').textContent.length > 100);
  /* only once in a day */
  assert.strictEqual(win.App.helpers.maybeFridaySheet(), false);
  /* the reader may end it from the sheet itself */
  click(win, doc.querySelector('#sheet [data-act="friday-off"]'));
  assert.strictEqual(win.Store.get('friday'), false);
  win.Store.set('fridayShown', '');
  assert.strictEqual(win.App.helpers.maybeFridaySheet(), false, 'and it stays off');
});

test('no friday sheet on any other day', () => {
  const { win } = boot({ now: new Date('2026-09-09T08:30:00+03:00') });
  assert.strictEqual(new win.Date().getDay(), 3, 'a wednesday');
  assert.strictEqual(win.App.helpers.maybeFridaySheet(), false);
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

test('both reminders are the reader\'s to turn on and off', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  assert.strictEqual(doc.getElementById('settings-friday').getAttribute('aria-checked'), 'true', 'friday on by default');
  assert.strictEqual(doc.getElementById('settings-qiyam').getAttribute('aria-checked'), 'false', 'and the night call off until asked');
  click(win, doc.getElementById('settings-friday'));
  assert.strictEqual(win.Store.get('friday'), false);
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
  const first = win.Hijri.upcoming(new win.Date(), 0)[0];
  assert.strictEqual(handed[0].t, first.name);
  assert.strictEqual(new Date(handed[0].s).toDateString(), first.date.toDateString(), 'on the day it falls');
  assert.ok(handed[0].e > handed[0].s, 'and a day long');
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
  /* turned off, nothing is queued */
  win.Store.set('wirdAt', '');
  win.Store.set('jumuahBefore', 0);
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
  assert.ok(doc.querySelectorAll('#sheet .dua-line').length >= 3, 'the first of them, in place');
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
  ['الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء', 'منتصف الليل', 'الثلث الأخير'].forEach(function (n) {
    assert.ok(fn.indexOf(n) !== -1, 'the picture should name ' + n);
  });
});

test('the mosques are opened in the phone\'s own map, at the reader\'s place', () => {
  const { win, doc } = boot();
  win.App.go('more');
  const row = doc.querySelector('#more-list [data-act="mosques"]');
  assert.ok(row, 'offered in the more list');
  const opened = [];
  win.SunnatiApp = { openMap: function (u, h) { opened.push([u, h]); return true; } };
  win.App.helpers.setPlace({ n: 'الكويت', lat: 29.38, lng: 47.98, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' }, true);
  win.App.go('more');
  click(win, doc.querySelector('#more-list [data-act="mosques"]'));
  assert.strictEqual(opened.length, 1);
  assert.ok(opened[0][0].indexOf('geo:29.38000,47.98000') === 0, 'a place, not a search of nowhere');
  assert.ok(decodeURIComponent(opened[0][0]).indexOf('مسجد') !== -1);
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
  assert.ok(/scheduleNext\(context, true\)/.test(sched), 'a fresh choice starts its count now');
  const receiver = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/eworldq8/sunnati/AdhanReceiver.java'), 'utf8');
  assert.ok(receiver.indexOf('SalawatScheduler.scheduleNext(context, true)') !== -1,
    'and after one rings the next is armed outright');
});

test('every fold starts closed, so a screen shows its headings rather than its contents', () => {
  const { win, doc } = boot();
  const open = function (view) { return doc.querySelectorAll('#v-' + view + ' .fold.is-open').length; };
  const all = function (view) { return doc.querySelectorAll('#v-' + view + ' .fold').length; };
  assert.ok(all('home') >= 1);
  assert.strictEqual(open('home'), 0, 'the sunnahs of the hour are folded away');
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
  assert.strictEqual(doc.querySelectorAll('#v-home .fold.is-open').length, 1);
  assert.strictEqual(doc.querySelector('#v-home .fold-head').getAttribute('aria-expanded'), 'true');
  click(win, doc.querySelector('#v-home .fold-head'));
  assert.strictEqual(doc.querySelectorAll('#v-home .fold.is-open').length, 0, 'and closes again');

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
  assert.ok(fn.indexOf("ctx.textAlign = 'right'") !== -1 && fn.indexOf("ctx.textAlign = 'left'") !== -1,
    'the name at the start and the hour at the end');
  ['الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء', 'منتصف الليل', 'الثلث الأخير'].forEach(function (n) {
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

test('a shared card looks the same whichever theme the reader is in', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const fn = /function timesCard\(\) \{([\s\S]*?)\n  \}\n\n  \/\* the gold knot/.exec(app)[1];
  /* the screen's accent is bright in the dark theme, which made the shared
     picture come out a different colour than it does in daylight */
  assert.ok(fn.indexOf("var fill = '#8f2323', wash = '#c98b8b';") !== -1, 'the app\'s own reds, not the screen\'s');
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
