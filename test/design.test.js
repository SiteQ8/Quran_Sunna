/* The design pass, what a person sees and touches, checked the way a person
   meets it and booted as interface.test.js boots the page, inside jsdom with
   every script the page loads. */
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

const mushafPayload = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'mushaf.json'), 'utf8'));
const CSS = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
const HTML = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');

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

/* as in interface.test.js, with one more door: «before» is handed the window
   ahead of the scripts, so a test can put there what a wrapper would */
function boot(options) {
  const opts = options || {};
  const dom = new JSDOM(HTML, {
    url: 'https://siteq8.github.io/Quran_Sunna/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;
  Object.defineProperty(win, 'localStorage', { value: opts.storage || memoryStorage(), configurable: true });
  win.matchMedia = win.matchMedia || function () {
    return { matches: !!opts.dark, addEventListener() {}, removeEventListener() {} };
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
  if (opts.before) opts.before(win);
  SCRIPTS.forEach(function (rel) {
    const code = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    vm.runInContext(code, dom.getInternalVMContext(), { filename: rel });
  });
  win.Mushaf.init(mushafPayload);
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

/* a pointer at a height on the screen and a moment in time; jsdom has no
   PointerEvent, and the handlers read only the type, the height, the moment
   and the pointer */
function pointer(win, el, type, y, t) {
  const e = new win.MouseEvent(type, { bubbles: true, clientY: y });
  if (t !== undefined) Object.defineProperty(e, 'timeStamp', { value: t });
  el.dispatchEvent(e);
}

/* ---------------- the controls ---------------- */

test('the hijri month of the converter shows the month it holds', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const hm = doc.getElementById('conv-hm');
  assert.ok(hm.value, 'a month is chosen');
  const label = hm.parentNode.querySelector('.picker-label');
  assert.ok(label, 'the month list is our own picker');
  assert.strictEqual(label.textContent, hm.options[hm.selectedIndex].text,
    'the button says the month the list has ticked, where it stood empty');
});

test('a date field shows the day in words over the phone\'s own field', () => {
  const { win, doc } = boot();
  win.App.go('calendar');
  const field = doc.getElementById('conv-greg');
  const wrap = field.parentNode;
  assert.ok(wrap.classList.contains('datepick'), 'the field is wrapped');
  assert.strictEqual(field.type, 'date', 'and is still the phone\'s own, so a tap opens its calendar');
  const face = wrap.querySelector('.datepick-face');
  assert.ok(face.textContent.indexOf('، ') !== -1, 'the weekday, then the date');
  assert.ok(!/\//.test(face.textContent), 'in words, not in figures and slashes: ' + face.textContent);
  field.value = '2026-03-20';
  fire(win, field, 'change');
  assert.strictEqual(face.textContent, 'الجمعة، 20 مارس 2026');
  /* the prayers' field holds no day until one is chosen, and says so */
  win.App.go('prayers');
  const day = doc.getElementById('prayers-day').parentNode.querySelector('.datepick-face');
  assert.strictEqual(day.textContent, 'اختر يوماً');
  assert.ok(day.classList.contains('is-empty'));
  assert.match(CSS, /\.datepick > input\[type="date"\] \{[^}]*color: transparent/, 'the phone\'s own figures are not shown');
  assert.match(CSS, /\.datepick-face \{[^}]*pointer-events: none/, 'and the face lets a tap through to the field');
});

test('the date at the head of the home is written in words', () => {
  const { doc } = boot();
  const line = doc.getElementById('greg-date').textContent;
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  assert.ok(months.some(function (m) { return line.indexOf(m) !== -1; }), 'a month by name: ' + line);
  assert.ok(line.indexOf('/') === -1, 'no figures and slashes');
  assert.strictEqual(line.split('،').length, 2, 'the weekday, then the date');
});

test('every control the page draws is the theme\'s own, the native ones too', () => {
  assert.match(CSS, /:root \{[\s\S]*?color-scheme: light;/, 'light by day');
  assert.match(CSS, /\[data-theme='dark'\] \{[\s\S]*?color-scheme: dark;/, 'and dark by night');
});

test('the iPhone is told the theme, and its status bar follows it', () => {
  const sent = [];
  const before = function (win) {
    win.webkit = { messageHandlers: { sunnati: { postMessage: function (m) { sent.push(m); } } } };
  };
  const storage = memoryStorage();
  storage.setItem('sunnati.settings', JSON.stringify({ theme: 'dark' }));
  boot({ before: before, storage: storage });
  const themes = sent.filter(function (m) { return m.fn === 'setTheme'; });
  assert.ok(themes.length >= 1, 'the page names its theme');
  /* the array was made in the page's own window, so its word is read alone */
  assert.strictEqual(themes[themes.length - 1].args[0], 'dark');
  /* a page outside the iPhone app has no handler, and nothing breaks */
  const { doc } = boot();
  assert.ok(doc.documentElement.getAttribute('data-theme'));

  const swift = fs.readFileSync(path.join(__dirname, '..', 'ios/Sunnati/ReaderController.swift'), 'utf8');
  assert.ok(/case "setTheme":[\s\S]{0,200}setNeedsStatusBarAppearanceUpdate\(\)/.test(swift), 'the wrapper hears it');
  assert.ok(/preferredStatusBarStyle: UIStatusBarStyle \{ pageDark \? \.lightContent : \.darkContent \}/.test(swift),
    'and draws the clock light on the dark page');
});

/* ---------------- the player ---------------- */

test('the player\'s steps show only on a walk through the verses', () => {
  const { win, doc } = boot();
  const player = doc.getElementById('player');
  win.App.helpers.reciteFrom(2, 5);
  assert.ok(player.classList.contains('is-open'));
  assert.ok(player.classList.contains('can-step'), 'a walk has a verse before and after');
  win.App.helpers.stopAudio();
  win.App.state.recite = null;
  win.App.helpers.playVerse(2, 255);
  assert.ok(player.classList.contains('is-open'));
  assert.ok(!player.classList.contains('can-step'), 'a single verse has nothing to step to');
  win.Store.set('reciter', 'ar.minshawi');
  win.App.helpers.playWholeSurah(18);
  assert.ok(!player.classList.contains('can-step'), 'nor a whole surah in one recording');
  win.App.go('radio');
  click(win, doc.querySelector('[data-station]'));
  assert.ok(!player.classList.contains('can-step'), 'nor the radio');
  assert.match(CSS, /\.player:not\(\.can-step\) #player-prev, \.player:not\(\.can-step\) #player-next \{ display: none; \}/);
});

test('the player keeps the foot of the page clear while it is open', () => {
  const { win, doc } = boot();
  const root = doc.documentElement;
  win.App.helpers.playVerse(1, 1);
  assert.match(root.style.getPropertyValue('--player-room'), /^\d+px$/, 'the room it takes is said');
  win.App.helpers.stopAudio();
  assert.strictEqual(root.style.getPropertyValue('--player-room'), '0px', 'and given back');
  assert.match(CSS, /padding-bottom: calc\([^;]*var\(--player-room, 0px\)\);/, 'the page leaves that room at its foot');
  assert.match(CSS, /\.to-top \{[^}]*bottom: calc\([^;]*var\(--player-room, 0px\)/, 'the arrow to the top stands above it');
  assert.match(CSS, /\.toast \{[^}]*env\(safe-area-inset-bottom\) \+ var\(--player-room, 0px\)/, 'and so does a toast, above the inset');
});

test('the player\'s controls are a thumb wide and read as playback does', () => {
  assert.match(CSS, /\.player button \{[^}]*width: 44px; height: 44px;/);
  const order = (id) => +(new RegExp('#' + id + ' \\{ order: (\\d); \\}').exec(CSS) || [])[1];
  /* right to left the bar runs: the words, then next, pause, previous, stop,
     which leaves previous on the left of the pause and next on its right */
  assert.ok(order('player-next') < order('player-toggle') && order('player-toggle') < order('player-prev'));
  assert.ok(order('player-prev') < order('player-stop'));
  const { doc } = boot();
  assert.strictEqual(doc.querySelector('#player-prev use').getAttribute('href'), '#i-media-prev');
  assert.strictEqual(doc.querySelector('#player-next use').getAttribute('href'), '#i-media-next');
  assert.match(HTML, /<g id="i-play"><path d="M7 4\.5 19 12 7 19\.5z"\/><\/g>/, 'the play mark points right');
});

/* ---------------- the sheet ---------------- */

test('a sheet is pulled down by its grip, and settles back if let go early', () => {
  const timers = [];
  const { win, doc } = boot();
  win.setTimeout = function (fn) { timers.push(fn); return timers.length; };
  const sheet = doc.getElementById('sheet');
  const panel = sheet.querySelector('.sheet-panel');
  Object.defineProperty(panel, 'offsetHeight', { value: 500, configurable: true });
  const head = panel.querySelector('.card-head h2');

  win.App.helpers.paceSheet();
  assert.ok(sheet.classList.contains('is-open'));
  /* a short pull, the finger at rest before it lifts */
  pointer(win, head, 'pointerdown', 100, 1000);
  pointer(win, head, 'pointermove', 160, 1100);
  assert.strictEqual(panel.style.transform, 'translateY(60px)', 'the sheet follows the finger');
  pointer(win, head, 'pointerup', 160, 1500);
  timers.splice(0).forEach(function (fn) { fn(); });
  assert.ok(sheet.classList.contains('is-open'), 'a pull short of a quarter settles back');
  assert.strictEqual(panel.style.transform, '');

  /* past a quarter of its height it goes */
  pointer(win, head, 'pointerdown', 100, 2000);
  pointer(win, head, 'pointermove', 260, 2400);
  pointer(win, head, 'pointerup', 260, 2900);
  timers.splice(0).forEach(function (fn) { fn(); });
  assert.ok(!sheet.classList.contains('is-open'), 'a long pull closes the sheet');
  assert.strictEqual(panel.style.transform, '', 'and leaves nothing behind for the next one');

  /* and so does a short one still moving fast when the finger lifts */
  win.App.helpers.paceSheet();
  pointer(win, head, 'pointerdown', 100, 3000);
  pointer(win, head, 'pointermove', 130, 3010);
  pointer(win, head, 'pointerup', 130, 3015);
  timers.splice(0).forEach(function (fn) { fn(); });
  assert.ok(!sheet.classList.contains('is-open'), 'a flick closes it');

  /* upward it does not move, and the close is still only a button */
  win.App.helpers.paceSheet();
  pointer(win, head, 'pointerdown', 300, 4000);
  pointer(win, head, 'pointermove', 100, 4100);
  assert.strictEqual(panel.style.transform, '');
  pointer(win, head, 'pointerup', 100, 4200);
  pointer(win, doc.getElementById('sheet-close'), 'pointerdown', 100, 5000);
  pointer(win, doc.getElementById('sheet-close'), 'pointermove', 400, 5100);
  assert.strictEqual(panel.style.transform, '', 'the close is not a grip');
  assert.match(CSS, /animation: sheet-up [^;]* backwards;/, 'the opening does not hold a transform over the finger\'s');
  assert.match(CSS, /#sheet-close \{[^}]*width: 44px; height: 44px;/, 'and its close is a thumb wide');
});

/* ---------------- lists ---------------- */

test('the more list stands on shelves, each one card', () => {
  const { win, doc } = boot();
  win.App.go('more');
  const host = doc.getElementById('more-list');
  const titles = [...host.querySelectorAll('.section-title')].map(function (t) { return t.textContent; });
  assert.ok(titles.length >= 3, 'shelves under their names: ' + titles.join(', '));
  [...host.querySelectorAll('.section-title')].forEach(function (t) {
    assert.ok(t.nextElementSibling.classList.contains('row-group'), t.textContent + ' heads a card of rows');
  });
  const rows = host.querySelectorAll('.row-group > .row');
  assert.strictEqual(rows.length, host.querySelectorAll('.row').length, 'every row is on a shelf');
  assert.ok(rows.length >= 16, 'and none went missing, got ' + rows.length);
  const last = host.querySelectorAll('.row-group')[host.querySelectorAll('.row-group').length - 1];
  assert.ok(last.querySelector('[data-go="settings"]'), 'the settings are with the app, at the end');
  assert.match(CSS, /#more-list \.row::after \{/, 'each entry says it opens a screen');
});

test('the surahs are one card, and an empty filter is not', () => {
  const { win, doc } = boot();
  win.App.go('quran');
  const host = doc.getElementById('surah-list');
  assert.ok(host.classList.contains('row-group'));
  assert.strictEqual(host.querySelectorAll('.row').length, 114);
  const filter = doc.getElementById('surah-filter');
  filter.value = 'لا سورة كهذه';
  fire(win, filter, 'input');
  assert.ok(host.querySelector('.empty'));
  assert.ok(!host.classList.contains('row-group'), 'an empty word stands on its own');
  assert.match(CSS, /\.row-group > \.row \{[^}]*box-shadow: none;/, 'no card inside the card');
});

test('an empty screen has a mark and a ground, and the way on only when it is empty', () => {
  const { win, doc } = boot();
  win.App.go('bookmarks');
  const empty = doc.querySelector('#bookmark-list .empty');
  assert.ok(empty.querySelector('svg.icon use'), 'the mark of what would fill it');
  const way = doc.querySelector('#v-bookmarks > .btn');
  assert.ok(!way.hidden, 'and the way to the mushaf under it');
  win.Store.toggleBookmark ? win.Store.toggleBookmark(2, 255) : win.Store.set('bookmarks', [{ s: 2, a: 255 }]);
  win.App.go('home');
  win.App.go('bookmarks');
  assert.ok(doc.querySelectorAll('#bookmark-list .search-hit').length >= 1);
  assert.ok(way.hidden, 'a full list does not carry it');
  assert.match(CSS, /\.empty \{[^}]*background: var\(--raised\);/);
  assert.match(CSS, /\.card \.empty, \.sheet \.empty \{ background: none;/, 'inside a card it needs no second ground');
});

test('a search with nothing typed offers words to start from, each one found', () => {
  const { win, doc } = boot();
  win.App.go('search');
  const words = [...doc.querySelectorAll('#search-results [data-suggest]')];
  assert.strictEqual(words.length, 6);
  words.forEach(function (w) {
    assert.ok(win.Mushaf.countMatches(w.getAttribute('data-suggest')) > 0, w.textContent + ' is in the mushaf');
  });
  click(win, words[0]);
  assert.strictEqual(doc.getElementById('quran-search').value, words[0].getAttribute('data-suggest'));
  assert.ok(doc.querySelectorAll('#search-results [data-hit]').length > 0, 'and a tap searches it');
  assert.ok(!doc.querySelector('#v-search > .btn'), 'no button to the mushaf under the field');
});

/* ---------------- the home, the tasbih and the reminders ---------------- */

test('the hour\'s sunnahs carry no second way to the full list', () => {
  const { doc } = boot();
  assert.strictEqual(doc.querySelectorAll('#now-fold [data-go="tracker"]').length, 0,
    'the card under it already has «كل السنن»');
  assert.ok(doc.querySelector('#home-progress [data-go="tracker"]'));
});

test('the counter is the first thing on the tasbih, and the way to the azkar a row under it', () => {
  const { doc } = boot();
  const view = doc.getElementById('v-tasbih');
  const kids = [...view.children];
  const counter = kids.indexOf(view.querySelector('.counter'));
  const route = doc.getElementById('tasbih-azkar');
  assert.ok(route.classList.contains('row'), 'a row, not a loud card');
  assert.ok(kids.indexOf(route) > counter, 'under the counter');
  assert.ok(!route.querySelector('.now-azkar-kicker'), 'and no kicker over its name');
});

test('a reminder that is off keeps its sound and its hour out of sight', () => {
  const { win, doc } = boot();
  win.App.go('reminders');
  const sw = doc.getElementById('settings-duha');
  const row = sw.parentNode;
  assert.ok(row.querySelector(':scope > .remind-controls'));
  assert.strictEqual(sw.getAttribute('aria-checked'), 'false');
  assert.ok(row.classList.contains('is-off'), 'off, and marked so');
  click(win, sw);
  assert.strictEqual(sw.getAttribute('aria-checked'), 'true');
  assert.ok(!row.classList.contains('is-off'), 'on, and its controls are back');
  /* a switch with no controls of its own is left as it is */
  const plain = doc.getElementById('settings-jumuah-sheet').parentNode;
  assert.ok(!plain.classList.contains('is-off'));
  assert.match(CSS, /\.setting\.is-off > \.remind-controls, \.setting\.is-off \+ \.setting-sub \{ display: none; \}/);
});

test('the arrow to the top shows on the way back up and steps aside at rest', () => {
  const timers = [];
  const { win, doc } = boot();
  win.setTimeout = function (fn) { timers.push(fn); return timers.length; };
  win.clearTimeout = function () {};
  const btn = doc.getElementById('to-top');
  const at = function (y) {
    Object.defineProperty(win, 'scrollY', { value: y, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
  };
  assert.ok(btn.hidden, 'nothing to return to at the top');
  at(900);
  assert.ok(btn.hidden, 'reading on down, it stays out of the way');
  at(1600);
  assert.ok(btn.hidden);
  at(1200);
  assert.ok(!btn.hidden, 'coming back up, it is there');
  timers.splice(0).forEach(function (fn) { fn(); });
  assert.ok(btn.hidden, 'and once the page rests it goes');
  at(1000);
  at(300);
  assert.ok(btn.hidden, 'near the top there is nothing to come back from');
});

/* ---------------- the stylesheet ---------------- */

test('no word is drawn under twelve points', () => {
  /* two stand apart: the names of the azkar groups, which a test of their
     own holds at .74rem in their tiles, and the month table on phones under
     three hundred and forty points, where seven columns must fit */
  const small = [...CSS.matchAll(/font-size: (\.\d+)rem/g)].map((m) => +m[1]).filter((v) => v < 0.75);
  assert.deepStrictEqual(small.sort(), [0.72, 0.74], 'smaller than the floor: ' + small.join(', '));
  assert.match(CSS, /--step--2: \.75rem;/);
  assert.match(CSS, /\.tab \{[^}]*font-size: var\(--step--2\)/, 'the names of the tabs among them');
});

test('the six windows take two rows of three when their words outgrow one', () => {
  assert.match(CSS, /\.clock \{[^}]*container-type: inline-size;/);
  assert.match(CSS, /@container \(max-width: 18\.5rem\) \{\s*\.windows \{ flex-wrap: wrap;/);
});

test('the cards of a screen share their edges and their corners', () => {
  ['view-head', 'clock', 'compass-panel'].forEach(function (cls) {
    const rule = new RegExp('\\.' + cls + ' \\{[^}]*margin: [^;]*;').exec(CSS)[0];
    assert.ok(rule.indexOf('calc(var(--s2) * -1)') === -1, cls + ' reaches past the cards beneath it');
  });
  assert.match(CSS, /--r-md: 16px;/);
});

test('the bars of the mushaf hold below the clock and the island', () => {
  assert.match(CSS, /\.reader-bar \{[^}]*position: sticky; top: env\(safe-area-inset-top, 0px\);/);
  assert.match(CSS, /\.read-progress \{[^}]*top: env\(safe-area-inset-top, 0px\);/);
  assert.match(CSS, /\.reader-bar::before \{[^}]*height: env\(safe-area-inset-top, 0px\); background: var\(--paper\); display: none;/,
    'with paper over the strip of the inset');
  assert.match(CSS, /html\.is-scrolled \.reader-bar::before \{ display: block; \}/, 'once the bar is held there');
  /* at the top of the page the strip shows the pattern as the rest does */
  const { win, doc } = boot();
  const at = function (y) {
    Object.defineProperty(win, 'scrollY', { value: y, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
  };
  at(600);
  assert.ok(doc.documentElement.classList.contains('is-scrolled'));
  at(0);
  assert.ok(!doc.documentElement.classList.contains('is-scrolled'));
});

test('a prayer missed is told from one in congregation by its shape', () => {
  assert.match(CSS, /\.pg\.missed \{ background: transparent; box-shadow: inset 0 0 0 2px var\(--danger/);
  assert.match(CSS, /\.pg\.jamaah \{ background: var\(--accent-solid\); \}/, 'congregation stays solid');
});

test('the seasons of the calendar wear their own colours, lighter by night', () => {
  ['eid', 'fast', 'month', 'night', 'weekly'].forEach(function (k) {
    assert.match(CSS, new RegExp('--occ-' + k + ': #'), k + ' by day');
  });
  const night = /\[data-theme='dark'\] \{([\s\S]*?)\n\}/.exec(CSS)[1];
  ['fast', 'month', 'night', 'weekly'].forEach(function (k) {
    assert.ok(night.indexOf('--occ-' + k + ':') !== -1, k + ' by night');
  });
  assert.ok(!/\.cal-cell\.kind-[a-z]+ \.cal-dot, \.occasion\.kind-[a-z]+ \{ --occ: #/.test(CSS), 'no colour written by hand');
  assert.ok(!/\.row-mark\.kind-[a-z, .-]+\{ color: #/.test(CSS));
});

test('a day of the month is a thumb wide on a phone of three hundred and sixty points', () => {
  assert.match(CSS, /\.card\.cal-card \{ padding-inline: var\(--s2\); \}/, 'the card lends its grid half its padding');
  assert.match(CSS, /\.cal-week, \.cal-grid \{[^}]*gap: 2px;/);
  assert.match(CSS, /\.cal-dot \{[^}]*top: 5px; inset-inline-end: 5px;/, 'and the mark of a season sits in its corner');
  const { doc } = boot();
  assert.ok(doc.querySelector('#v-calendar .card.cal-card #cal-grid'));
});

test('the sky\'s words stand on a shade, and the download\'s bar is drawn', () => {
  assert.match(CSS, /\.skyview::after \{[^}]*linear-gradient\(to top/);
  assert.match(CSS, /\.meter span, \.meter \.meter-fill \{ display: block;/);
});

test('every small close and dismiss is a thumb wide', () => {
  assert.match(CSS, /\.banner-close \{[^}]*width: 44px; height: 44px;/);
  assert.match(CSS, /\.banner-act \{[^}]*min-height: 44px;/);
  assert.match(CSS, /\.map-zoom \{[^}]*width: 44px; height: 44px;/);
});

test('the page bar gives its room to the two turns of the page', () => {
  const { doc } = boot();
  const random = doc.getElementById('page-random');
  assert.strictEqual(random.textContent.trim(), '', 'the random page is a mark');
  assert.ok(random.getAttribute('aria-label'), 'with its name read out');
  assert.strictEqual(random.querySelector('use').getAttribute('href'), '#i-shuffle');
  assert.match(CSS, /#page-random, #page-autoscroll \{ flex: 0 0 48px;/);
  assert.ok(!/\.bar-word \{ display: none; \}/.test(CSS), '«التالية» keeps its word as «السابقة» does');
});
