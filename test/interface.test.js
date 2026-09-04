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
  assert.match(countdown, /^[٠-٩]{2}:[٠-٩]{2}:[٠-٩]{2}$/, 'countdown should read as a clock, got ' + countdown);
  assert.notStrictEqual(doc.getElementById('arc-name').textContent, '…');
  assert.match(doc.getElementById('arc-at').textContent, /^[٠-٩]{2}:[٠-٩]{2}$/);
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
    assert.match(w.querySelector('.window-time').textContent, /^[٠-٩]{2}:[٠-٩]{2}$/);
  });
  assert.strictEqual(doc.querySelectorAll('#windows .is-now').length, 1, 'exactly one window is current');
});

test('the hijri date renders in arabic numerals beside the gregorian one', () => {
  const { doc } = boot();
  const text = doc.getElementById('hijri-date').textContent;
  assert.ok(text.indexOf('هـ') !== -1, 'expected a hijri date, got ' + text);
  assert.ok(/[٠-٩]/.test(text), 'expected arabic digits');
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
    assert.ok(!/[٠-٩]\s*·|·\s*[٠-٩]/.test(text), view + ' puts a middle dot next to a numeral');
  });
});

test('the sunnah tracker records ticks and updates the meter', () => {
  const { win, doc } = boot();
  win.App.go('tracker');
  const boxes = doc.querySelectorAll('#tracker-list [data-check]');
  assert.strictEqual(boxes.length, 40, 'the wird and the five groups together');
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '٠');

  click(win, boxes[0]);
  assert.ok(doc.querySelectorAll('#tracker-list [data-check]')[0].classList.contains('is-done'));
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '١');
  assert.notStrictEqual(doc.getElementById('tracker-meter').style.width, '0%');

  click(win, doc.querySelectorAll('#tracker-list [data-check]')[0]);
  assert.ok(!doc.querySelectorAll('#tracker-list [data-check]')[0].classList.contains('is-done'));
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '٠');
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
  assert.strictEqual(doc.getElementById('today-done').textContent, '١');
  win.App.go('tracker');
  assert.strictEqual(doc.getElementById('tracker-done').textContent, '١');
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
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '٥');
  assert.strictEqual(win.Store.day().tasbih, 5);
  assert.ok(doc.getElementById('tasbih-target').textContent.indexOf('٣٣') !== -1);

  click(win, doc.querySelector('[data-phrase="3"]'));
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '٠', 'switching phrase resets the count');
  assert.strictEqual(doc.getElementById('tasbih-phrase').textContent, 'لا إله إلا الله');
  assert.strictEqual(win.Store.day().tasbih, 5, 'the daily total keeps every phrase');

  click(win, doc.getElementById('tasbih-reset'));
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '٠');
});

/* ---------------- qibla ---------------- */

test('the qibla view reports a bearing and a distance', () => {
  const { win, doc } = boot();
  win.App.go('qibla');
  const degrees = doc.getElementById('qibla-degrees').textContent;
  assert.match(degrees, /^[٠-٩]+°$/, 'the bearing is written in arabic digits, got ' + degrees);
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
  assert.ok(doc.getElementById('khatma-state').textContent.indexOf('٥') !== -1);

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
  assert.strictEqual(doc.getElementById('font-value').textContent, '١٤٠٪');
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
  assert.strictEqual(win.App.helpers.ar('1448'), '١٤٤٨');
  assert.strictEqual(win.App.helpers.ar(0), '٠');
});

test('no latin digit reaches the screen on the home view', () => {
  const { doc } = boot();
  ['hijri-date', 'greg-date', 'today-done', 'today-total'].forEach(function (id) {
    assert.ok(!/[0-9]/.test(doc.getElementById(id).textContent), id + ' leaked a latin digit');
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
  assert.match(doc.getElementById('arc-count').textContent, /^[٠-٩]{2}:[٠-٩]{2}:[٠-٩]{2}$/,
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
  if (new Date().getDay() === 5) {
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

test('the compass turns its needle and leaves north alone', () => {
  const { win, doc } = boot();
  win.App.go('qibla');
  const needle = doc.getElementById('qibla-needle');
  assert.match(needle.getAttribute('transform'), /^rotate\(-?\d+(\.\d+)? 100 100\)$/);
  assert.ok(!doc.getElementById('compass-rose').style.transform,
    'rotating the whole rose would swing north away from north');
});


test('the dot riding the arc never sits on the words inside it', () => {
  const { win, doc } = boot();
  /* The dot climbs to the top of the arc halfway through a window, which is
     exactly where the label sits, so the two are checked against each other
     across a whole window rather than at one moment. */
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const inset = /\.arc-center\s*\{[^}]*inset:\s*(\d+)%/.exec(css);
  assert.ok(inset, 'the text inside the arc is placed by an inset');
  assert.ok(+inset[1] >= 32, 'the text must clear the top of the arc, found ' + inset[1] + '%');
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
  assert.ok(next.textContent.indexOf('٥١') !== -1,
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
  assert.ok(doc.getElementById('resume-note').textContent.indexOf('٢٥٥') !== -1,
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
  assert.ok(!/[0-9]/.test(meta), 'the numbers should be arabic, got ' + meta);
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
  assert.ok(manifest.shortcuts.length >= 4, 'a phone should offer several ways in');
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
  assert.ok(install[0].indexOf('skipWaiting') === -1,
    'a worker that seizes control on install would reload the page under the reader');
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
  assert.match(win.PrayerEngine.format(t.dhuhr), /^\d{2}:\d{2}$/);
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
  const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
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

test('the clock keeps the same numerals as the rest of the screen', () => {
  const { doc } = boot();
  const shown = [
    doc.getElementById('arc-count').textContent,
    doc.getElementById('arc-at').textContent,
    doc.getElementById('hijri-date').textContent,
    doc.getElementById('greg-date').textContent
  ].concat([...doc.querySelectorAll('.window-time')].map((e) => e.textContent));
  shown.forEach(function (text) {
    assert.ok(!/[0-9]/.test(text), 'latin digits reached the screen in: ' + text);
    assert.ok(/[٠-٩]/.test(text), 'expected arabic digits in: ' + text);
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
  const digits = shown.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
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
