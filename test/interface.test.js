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
  'data/surahs.js', 'data/azkar.js', 'data/content.js', 'data/extras.js',
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
    assert.ok(fs.existsSync(path.join(DOCS, rel)), 'missing asset ' + rel);
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
    assert.match(w.querySelector('.window-time').textContent, /^\d{1,2}:\d{2} [صم]$/);
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
  assert.strictEqual(boxes.length, 40, 'the wird and the five groups together');
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
  assert.strictEqual(doc.getElementById('settings-method').value, 'Kuwait');

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
  ['quran', 'azkar', 'tracker', 'more', 'home'].forEach(function (name) {
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
    'azkar-list': 'azkar', qibla: 'more', tasbih: 'more', radio: 'more',
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
  assert.strictEqual(win.Store.get('method'), 'Kuwait');
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
    assert.ok(fs.existsSync(path.join(DOCS, i.src)), 'missing icon ' + i.src);
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

test('a new version is offered rather than forced on the reader', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const handler = /controllerchange'[\s\S]{0,400}?\}\);/.exec(app);
  assert.ok(handler, 'the page should notice when a new worker takes charge');
  assert.match(handler[0], /showBanner/, 'it should offer the new version');
  /* A reload may only sit inside what the offer runs when it is pressed, never
     before it, or a reader is thrown out of the middle of an ayah unasked. */
  const offerAt = handler[0].indexOf('showBanner');
  const before = handler[0].slice(0, offerAt);
  assert.ok(!/location\.reload/.test(before),
    'the page reloaded before anyone was asked');
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
  assert.ok(list.textContent.indexOf('تبدأ صفحة') !== -1, 'the note names the page instead');

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
  assert.match(css, /\.chip \{[^}]*padding:\s*14px/, 'a chip should be tall enough on its own');
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

test('the shell is fetched from the network first', () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  /* The last respondWith in the file handles code and markup. It must reach for
     the network before the cache, or a fix can be published and never arrive. */
  const tail = sw.slice(sw.lastIndexOf('event.respondWith'));
  const network = tail.indexOf('fetch(request)');
  const cache = tail.indexOf('caches.match');
  assert.ok(network !== -1 && cache !== -1, 'it should try both');
  assert.ok(network < cache,
    'the cache must be the fallback for code, not the first answer');
  assert.match(sw, /isSettled/, 'the mushaf and the icons may still come from the cache first');
  assert.match(sw, /take-over[\s\S]{0,120}skipWaiting/,
    'and it should hand over as soon as the page asks');
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
  const shown = doc.getElementById('version-line').textContent;
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
    assert.strictEqual(g.querySelector('.fold-head').getAttribute('aria-expanded'), 'true');
  });
});

test('a group shuts when its head is pressed and stays shut', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const head = doc.querySelectorAll('#tracker-list .fold-head')[1];
  click(win, head);
  assert.strictEqual(doc.querySelectorAll('#tracker-list .fold:not(.is-open)').length, 1);
  assert.strictEqual(head.getAttribute('aria-expanded'), 'false');

  click(win, doc.querySelector('#tracker-list .fold.is-open .check'));
  assert.strictEqual(doc.querySelectorAll('#tracker-list .fold:not(.is-open)').length, 1,
    'ticking a deed must not fling every group back open');
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
    assert.ok(fs.existsSync(path.join(DOCS, entry.src)), 'missing ' + entry.src);
  });
  m.shortcuts.forEach(function (s) {
    s.icons.forEach(function (i) { assert.ok(fs.existsSync(path.join(DOCS, i.src)), 'missing ' + i.src); });
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
  ['docs/js', 'docs/data', 'docs/css', 'tools', 'play'].forEach(function (d) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  });
  ['docs/index.html', 'docs/privacy.html', 'docs/js/app.js', 'docs/js/prayer-engine.js',
   'docs/js/hijri.js', 'docs/js/store.js', 'docs/data/surahs.js', 'docs/data/azkar.js',
   'docs/data/content.js', 'docs/data/extras.js', 'README.md', 'play/README.md',
   'tools/review-arabic.js'].forEach(function (f) {
    fs.copyFileSync(path.join(root, f), path.join(dir, f));
  });
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
    .filter((u) => !/github\.com/.test(u));
  assert.deepStrictEqual(outside, [],
    'the shell should stand on its own, found: ' + outside.join(', '));
});

/* ---------------- the home card folds too ---------------- */

test('the sunnah card on the home view folds with its own tally', () => {
  const { win, doc } = boot();
  const fold = doc.getElementById('now-fold');
  assert.ok(fold, 'the home sunnah card should be a folding group');
  assert.ok(fold.classList.contains('is-open'), 'it starts open');
  const tally = doc.getElementById('now-tally');
  assert.match(tally.textContent, /^[0-9]+ من [0-9]+$/, 'got ' + tally.textContent);

  click(win, fold.querySelector('.fold-head'));
  assert.ok(!doc.getElementById('now-fold').classList.contains('is-open'));
  assert.strictEqual(fold.querySelector('.fold-head').getAttribute('aria-expanded'), 'false');

  win.App.render.home();
  assert.ok(!doc.getElementById('now-fold').classList.contains('is-open'),
    'it should stay shut when the home view is drawn again');
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
  assert.ok(how.indexOf('وزارة الأوقاف') !== -1,
    'a method should name the body that issues it, got ' + how);
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
    assert.match(cell.textContent, /^\d{1,2}:\d{2} [صم]$/, 'got ' + cell.textContent);
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
  const home = [...doc.querySelectorAll('.window-time')].map((e) => e.textContent);
  win.App.go('timetable');
  const row = doc.querySelector('#tt-table tr.is-today');
  const table = [...row.querySelectorAll('td')].map((e) => e.textContent);
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

  assert.ok(strings.indexOf('https://siteq8.github.io/Quran_Sunna/') !== -1,
    'the wrapper should open the published address');
  assert.ok(manifest.indexOf('android:host="siteq8.github.io"') !== -1,
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
  assert.deepStrictEqual(asked.sort(), ['INTERNET', 'POST_NOTIFICATIONS'],
    'an app that stores nothing off the device needs no more than these');
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
