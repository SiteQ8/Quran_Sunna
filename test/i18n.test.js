/* The app in the reader's language: the engine in docs/js/i18n.js, the tables
   in docs/i18n/, and the screens drawn through them. Arabic is the app's own
   tongue and must come out exactly as it is written. */
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
const HTML = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const SCRIPTS = ['js/i18n.js'].concat((HTML.match(/<script src="((?:data|js)\/[^"]+)"><\/script>/g) || [])
  .map(function (t) { return /src="([^"]+)"/.exec(t)[1]; })
  .filter(function (s) { return s !== 'js/boot.js' && s !== 'js/i18n.js'; }));
const MUSHAF = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'mushaf.json'), 'utf8'));
const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const SACRED = /var SACRED = '([^']+)'/.exec(fs.readFileSync(path.join(DOCS, 'js', 'i18n.js'), 'utf8'))[1];
const KEEP = '[translate="no"],script,style,textarea,noscript,' + SACRED;

function memoryStorage(seed) {
  const map = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    key: (i) => Object.keys(map)[i],
    get length() { return Object.keys(map).length; },
    clear: () => { Object.keys(map).forEach((k) => delete map[k]); },
    dump: () => Object.assign({}, map)
  };
}

const opened = [];
test.afterEach(function () {
  while (opened.length) { try { opened.pop().window.close(); } catch (e) { /* gone */ } }
});

/* opts: storage (seed), languages (the phone's), table (an object handed to
   I18n.add), file (a language whose docs/i18n/<lang>.js is read), now, and
   shipped (only the languages whose tables ship are offered) */
function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(HTML, { url: 'https://sunnati.3li.info/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const storage = memoryStorage(opts.storage);
  Object.defineProperty(win, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(win.navigator, 'languages', { value: opts.languages || ['ar-KW'], configurable: true });
  Object.defineProperty(win.navigator, 'language', { value: (opts.languages || ['ar-KW'])[0], configurable: true });
  const fixed = (opts.now || new Date(2026, 9, 14, 9, 30)).getTime();
  const Real = win.Date;
  function Fixed(...args) { return args.length ? new Real(...args) : new Real(fixed); }
  Fixed.prototype = Real.prototype; Fixed.now = () => fixed; Fixed.parse = Real.parse; Fixed.UTC = Real.UTC;
  win.Date = Fixed;
  win.matchMedia = function () { return { matches: false, addEventListener() {}, removeEventListener() {} }; };
  win.fetch = function (url) {
    if (String(url).indexOf('mushaf.json') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(MUSHAF) });
    return Promise.reject(new Error('offline in tests'));
  };
  win.Audio = function () { return { play: () => Promise.resolve(), pause() {}, paused: true, src: '' }; };
  win.scrollTo = function () {};
  win.__reloaded = 0;
  const ctx = dom.getInternalVMContext();
  SCRIPTS.forEach(function (rel, i) {
    let src = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    /* the engine is tried here in every language it knows, each with a table
       of the test's own, unless the test asks for the languages that ship */
    if (i === 0 && !opts.shipped) src = src.replace(/var READY = \[[^\]]*\];/, 'var READY = LANGS.map(function (l) { return l.code; });');
    vm.runInContext(src, ctx, { filename: rel });
    if (i !== 0) return;
    /* the page reloads to change language; here the reload is only counted */
    win.I18n.reload = function () { win.__reloaded++; };
    if (opts.file) vm.runInContext(fs.readFileSync(path.join(DOCS, 'i18n', opts.file + '.js'), 'utf8'), ctx, { filename: 'i18n/' + opts.file + '.js' });
    if (opts.table) win.I18n.add(opts.table);
  });
  win.Mushaf.init(MUSHAF);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  opened.push(dom);
  return { dom: dom, win: win, doc: win.document, storage: storage };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* every piece of Arabic on the page that is not the Quran, a hadith or a
   remembrance */
function arabicLeft(doc) {
  const left = [];
  const walker = doc.createTreeWalker(doc.body, 5, {
    acceptNode: function (n) {
      if (n.nodeType === 3) return 1;
      if (n.matches(KEEP)) return 2;
      ['aria-label', 'title', 'alt', 'placeholder'].forEach(function (a) {
        const v = n.getAttribute(a);
        if (v && AR.test(v)) left.push(a + ': ' + v);
      });
      return 3;
    }
  });
  let n;
  while ((n = walker.nextNode())) if (AR.test(n.data)) left.push(n.data.trim());
  return left;
}

/* ---------------- who reads which language ---------------- */

test('an Arabic reader gets the page exactly as it is written, and the engine stays out of it', async () => {
  const { win, doc } = boot({ languages: ['ar-KW'] });
  await tick();
  assert.strictEqual(win.I18n.lang, 'ar');
  assert.strictEqual(doc.documentElement.getAttribute('lang'), 'ar');
  assert.strictEqual(doc.documentElement.getAttribute('dir'), 'rtl');
  assert.strictEqual(doc.getElementById('settings-title').textContent, 'الإعدادات');
  assert.ok(!doc.querySelector('.ayah-block[lang]'), 'nothing is marked when nothing is translated');
  assert.strictEqual(win.I18n.tx('سورة البقرة، آية 255'), 'سورة البقرة، آية 255');
});

test('someone who used the app before keeps Arabic after the update, whatever their phone is set to', async () => {
  const { win, storage } = boot({ languages: ['en-US'], storage: { 'sunnati.settings': '{"clock":"24"}' } });
  await tick();
  assert.strictEqual(win.I18n.lang, 'ar');
  assert.strictEqual(storage.getItem('sunnati.lang'), 'ar', 'and keeps it: the choice is theirs from now');
});

test('a phone the app meets for the first time is read in its own language, and English when it has none of them', () => {
  const fr = boot({ languages: ['fr-FR', 'en-US'], table: { 'الإعدادات': 'Réglages' } });
  assert.strictEqual(fr.win.I18n.lang, 'fr');
  assert.strictEqual(fr.storage.getItem('sunnati.lang'), 'auto', 'it follows the phone until the reader chooses');
  assert.strictEqual(fr.doc.documentElement.getAttribute('dir'), 'ltr');
  const de = boot({ languages: ['de-DE'], table: { 'الإعدادات': 'Settings' } });
  assert.strictEqual(de.win.I18n.lang, 'en');
  const ur = boot({ languages: ['ur-PK'], table: { 'الإعدادات': 'ترتیبات' } });
  assert.strictEqual(ur.win.I18n.lang, 'ur');
  assert.strictEqual(ur.doc.documentElement.getAttribute('dir'), 'rtl', 'Urdu runs right to left');
  /* android still calls Indonesian «in» */
  const id = boot({ languages: ['in-ID'], table: { 'الإعدادات': 'Pengaturan' } });
  assert.strictEqual(id.win.I18n.lang, 'id');
});

test('a language whose table never came leaves the page as written', () => {
  const { win, doc } = boot({ languages: ['en-US'] });
  assert.strictEqual(win.I18n.lang, 'ar');
  assert.strictEqual(doc.documentElement.getAttribute('dir'), 'rtl');
  assert.strictEqual(doc.getElementById('settings-title').textContent, 'الإعدادات');
});

test('the first open of a new phone is still a first open, though the language was noted', () => {
  const { win, storage } = boot({ languages: ['en-US'], table: { 'الإعدادات': 'Settings' } });
  assert.strictEqual(storage.getItem('sunnati.lang'), 'auto');
  assert.strictEqual(win.App.helpers.tourState.returning, false, 'the walkthrough still meets it as new');
});

/* ---------------- how a line is put into the language ---------------- */

const TABLE = {
  'سورة {0}، آية {#1}': 'Surah {0}, verse {1}',
  'البقرة': 'Al-Baqarah',
  'بعد {0}': 'in {0}',
  '{#0} أيام': '{0} days',
  'ص': 'AM',
  'م': 'PM',
  'الإثنين': 'Monday',
  'أكتوبر': 'October',
  'الفجر': 'Fajr',
  'بلا علامة': 'not marked',
  'مسلم، حديث جبريل': 'Muslim, the hadith of Jibril',
  'عمر بن الخطاب رضي الله عنه': 'Umar ibn al-Khattab (may Allah be pleased with him)',
  'و{0}': 'and {0}',
  'الحمد لله': 'Alhamdulillah',
  'سُنّتي': 'Sunnati'
};

test('whole lines, composed lines, lists, names among figures and times all find their way', () => {
  const { win } = boot({ languages: ['en-US'], table: TABLE });
  const tx = win.I18n.tx;
  assert.strictEqual(tx('سورة البقرة، آية 255'), 'Surah Al-Baqarah, verse 255');
  assert.strictEqual(tx('بعد 3 أيام'), 'in 3 days', 'a count inside a line, never a line inside a count');
  /* a time keeps its mark and a day its month at the end of a line */
  assert.strictEqual(tx('5:30 ص'), '5:30\u00A0AM');
  assert.strictEqual(tx('الإثنين 19 أكتوبر 2026'), 'Monday 19\u00A0October\u00A02026');
  assert.strictEqual(tx('الفجر 15، بلا علامة'), 'Fajr 15, not marked');
  assert.strictEqual(tx('عمر بن الخطاب رضي الله عنه، مسلم، حديث جبريل'),
    'Umar ibn al-Khattab (may Allah be pleased with him), Muslim, the hadith of Jibril');
  assert.strictEqual(tx('1/10 4:22 ص 5:41 ص 11:38 ص'), '1/10\u00A04:22\u00A0AM 5:41\u00A0AM 11:38\u00A0AM');
  assert.strictEqual(tx('الفجر 21 و23'), 'Fajr 21\u00A0and 23');
  /* a line the table does not know stays as it is written */
  assert.strictEqual(tx('سطر لا يعرفه الجدول'), 'سطر لا يعرفه الجدول');
  /* and the words handed to another app are put in a line at a time */
  assert.strictEqual(tx('ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ\n\nسورة البقرة، آية 255'), 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ\n\nSurah Al-Baqarah, verse 255');
});

test('the languages with their own figures count in them, and an address keeps its own', () => {
  const fa = boot({ languages: ['fa-IR'], table: { 'بعد {0}': '{0} بعد', '{#0} أيام': '{0} روز' } });
  assert.strictEqual(fa.win.I18n.tx('بعد 3 أيام'), '۳ روز بعد');
  assert.strictEqual(fa.win.I18n.tx('sunnati.3li.info'), 'sunnati.3li.info');
  const bn = boot({ languages: ['bn-BD'], table: { 'صفحة {0}': 'পৃষ্ঠা {0}' } });
  assert.strictEqual(bn.win.I18n.tx('صفحة 604'), 'পৃষ্ঠা ৬০৪');
  /* drawn once already, a line is read back with the page's own figures */
  const doc = fa.doc;
  const p = doc.createElement('p');
  p.textContent = 'بعد 4 أيام';
  doc.body.appendChild(p);
  fa.win.I18n.apply(p);
  assert.strictEqual(p.textContent, '۴ روز بعد');
  fa.win.I18n.apply(p);
  assert.strictEqual(p.textContent, '۴ روز بعد', 'and a second pass changes nothing');
});

test('Urdu counts in the figures its phones write, and Persian in its own', () => {
  const ur = boot({ languages: ['ur-PK'], table: { 'صفحة {0}': 'صفحہ {0}' } });
  assert.strictEqual(ur.win.I18n.tx('صفحة 604'), 'صفحہ 604');
  const fa = boot({ languages: ['fa-IR'], table: { 'صفحة {0}': 'صفحهٔ {0}' } });
  assert.strictEqual(fa.win.I18n.tx('صفحة 604'), 'صفحهٔ ۶۰۴');
});

test('in a right-to-left page a time with a Latin mark is one phrase, its figures before its mark', () => {
  const table = { 'ص': 'AM', 'م': 'PM', 'منتصف الليل': 'آدھی رات' };
  const ur = boot({ languages: ['ur-PK'], table: table });
  assert.strictEqual(ur.win.I18n.tx('10:54 م'), '\u206610:54\u00A0PM\u2069', 'set apart, or the order of the two directions shows PM 10:54');
  const night = ur.doc.createElement('p');
  night.innerHTML = '<span class="night-name">منتصف الليل</span> 10:54 م';
  ur.doc.body.appendChild(night);
  ur.win.I18n.apply(night);
  assert.strictEqual(night.textContent, 'آدھی رات \u206610:54\u00A0PM\u2069');
  /* a left-to-right page needs nothing of it */
  const en = boot({ languages: ['en-US'], table: table });
  assert.strictEqual(en.win.I18n.tx('10:54 م'), '10:54\u00A0PM');
});

test('on a Friday the noon prayer is named as the prayer, and the day keeps its own name', async () => {
  const friday = new Date(2026, 9, 16, 9, 30);
  const { win, doc } = boot({ languages: ['en-US'], file: 'en', now: friday });
  win.App.go('home');
  await tick();
  const names = Array.from(doc.querySelectorAll('#windows .window-name')).map(function (n) { return n.textContent; });
  assert.ok(names.indexOf("Jumu'ah") !== -1, 'the strip names the prayer: ' + names.join(', '));
  assert.ok(names.indexOf('Friday') === -1);
  const tx = win.I18n.tx;
  assert.strictEqual(tx('أذان الجمعة'), "Jumu'ah adhan");
  assert.strictEqual(tx('حان وقت الجمعة'), "It's time for Jumu'ah");
  assert.strictEqual(tx('الجمعة 16 أكتوبر'), 'Friday 16\u00A0October', 'a date still says the day');
  /* every table names the prayer, and the places that hold a prayer's name say so */
  const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'i18n', 'catalog.json'), 'utf8'));
  ['أذان {0:prayer}', 'صلاة {0:prayer}، {1}', 'حان وقت {0:prayer}', 'حان وقت صلاة {0:prayer}', 'prayer:الجمعة'].forEach(function (key) {
    assert.ok(CATALOG.some(function (e) { return e.key === key; }), key + ' is in the catalog');
  });
});

test('a month over its timetable is said the way a heading says it', async () => {
  const { win, doc } = boot({ languages: ['ru-RU'], file: 'ru' });
  win.App.go('timetable');
  await tick();
  assert.strictEqual(doc.getElementById('tt-month').textContent, 'Октябрь\u00A02026', 'alone, the month is not the month of a day');
  assert.strictEqual(win.I18n.tx('19 أكتوبر 2026'), '19\u00A0октября\u00A02026', 'after a day it is still that day\'s month');
  const CSS = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(CSS, /html:not\(\[lang='ar'\]\) \.cal-month::first-letter \{ text-transform: uppercase; \}/);
});

test('the compass keeps its north mark where north is still the Arabic letter', () => {
  const CSS = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.match(CSS, /html:not\(\[lang='ar'\]\):not\(\[lang='ur'\]\):not\(\[lang='fa'\]\) \.compass-north \{ display: none; \}/);
  ['ur', 'fa'].forEach(function (code) {
    const src = fs.readFileSync(path.join(DOCS, 'i18n', code + '.js'), 'utf8');
    assert.ok(src.indexOf('"compass:ش": "ش"') !== -1, code + ' names north with the same letter');
  });
});

test('a new reader tells the time the way their language does, until they choose', () => {
  ['fr-FR', 'tr-TR', 'ru-RU', 'id-ID', 'fa-IR'].forEach(function (phone) {
    const { win } = boot({ languages: [phone], table: { 'الإعدادات': 'x' } });
    assert.strictEqual(win.Store.get('clock'), '24', phone + ' runs the day to twenty four hours');
  });
  ['en-US', 'ms-MY', 'bn-BD', 'ur-PK', 'ha-NG', 'ar-KW'].forEach(function (phone) {
    const { win } = boot({ languages: [phone], table: { 'الإعدادات': 'x' } });
    assert.strictEqual(win.Store.get('clock'), '12', phone + ' keeps the twelve hours');
  });
  /* a reader who chose keeps their choice, whatever the language */
  const chose = boot({ languages: ['fr-FR'], storage: { 'sunnati.settings': JSON.stringify({ clock: '12' }) }, table: { 'الإعدادات': 'x' } });
  assert.strictEqual(chose.win.Store.get('clock'), '12');
});

test('Russian nouns change with the number, as the table says', () => {
  const { win } = boot({ languages: ['ru-RU'], table: {
    'بعد {0}': 'через {0}',
    '{#0} أيام': { one: '{0} день', few: '{0} дня', many: '{0} дней', other: '{0} дня' },
    '{#0} يوماً': { one: '{0} день', few: '{0} дня', many: '{0} дней', other: '{0} дня' }
  } });
  assert.strictEqual(win.I18n.tx('بعد 3 أيام'), 'через 3 дня');
  assert.strictEqual(win.I18n.tx('بعد 5 أيام'), 'через 5 дней');
  assert.strictEqual(win.I18n.tx('بعد 21 يوماً'), 'через 21 день');
});

/* ---------------- the page ---------------- */

test('the Quran, the hadith and the adhkar stay in Arabic and say so, while what is around them is translated', async () => {
  const { win, doc } = boot({ languages: ['en-US'], table: Object.assign({ 'الأذكار': 'Adhkar' }, TABLE) });
  win.App.go('azkar');
  doc.querySelector('[data-azkar="morning"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  assert.ok(doc.getElementById('v-azkar-list').classList.contains('is-open'));
  const dhikr = doc.querySelector('.dhikr-text');
  assert.ok(dhikr && AR.test(dhikr.textContent), 'the dhikr is drawn, in Arabic');
  assert.strictEqual(dhikr.getAttribute('lang'), 'ar');
  assert.strictEqual(dhikr.getAttribute('dir'), 'rtl');
  assert.strictEqual(doc.getElementById('azkar-title').textContent, 'Adhkar');
  /* a phrase of the table inside a sacred text is never touched */
  const p = doc.createElement('p');
  p.className = 'dhikr-text';
  p.textContent = 'الحمد لله';
  doc.body.appendChild(p);
  await tick();
  assert.strictEqual(p.textContent, 'الحمد لله');
});

test('the page runs the way the language runs, and the mushaf keeps its own', () => {
  const { doc } = boot({ languages: ['en-US'], table: TABLE });
  assert.strictEqual(doc.documentElement.getAttribute('lang'), 'en');
  assert.strictEqual(doc.documentElement.getAttribute('dir'), 'ltr');
  assert.strictEqual(doc.getElementById('v-page').getAttribute('dir'), 'rtl', 'a printed page reads from the right');
  const css = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf('text-align: right') === -1, 'text starts where its line starts, in either direction');
  assert.match(css, /html\[dir='ltr'\] \.switch\[aria-checked='true'\]::after \{ transform: translateX\(19px\); \}/);
  assert.match(css, /html\[dir='ltr'\] use\[href='#i-back'\]/, 'the back arrow points back in either direction');
  assert.match(css, /html\[dir='ltr'\] \[dir='rtl'\] use \{ transform: none; \}/, 'and the mushaf keeps its arrows');
});

test('the language list names each language in its own words, and choosing one opens the app again in it', async () => {
  const { win, doc, storage } = boot({ languages: ['ar-KW'] });
  win.App.go('settings');
  await tick();
  const sel = doc.getElementById('settings-lang');
  assert.ok(sel, 'the row is in the settings');
  const own = Array.prototype.filter.call(sel.options, function (o) { return o.value !== 'auto'; });
  assert.strictEqual(own.length, 11, 'Arabic and the ten');
  own.forEach(function (o) {
    assert.strictEqual(o.getAttribute('translate'), 'no', o.value + ' is named in its own words, never translated');
    assert.strictEqual(o.getAttribute('lang'), o.value);
  });
  assert.deepStrictEqual(own.map(function (o) { return o.value; }).sort(),
    Array.from(win.I18n.langs, function (l) { return l.code; }).sort(), 'the list and the engine know the same languages');
  sel.value = 'en';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.strictEqual(storage.getItem('sunnati.lang'), 'en');
});

test('only the languages whose words ship are offered, and a phone set to another is met in English', async () => {
  const SRC = fs.readFileSync(path.join(DOCS, 'js', 'i18n.js'), 'utf8');
  const READY = JSON.parse(/var READY = (\[[^\]]*\]);/.exec(SRC)[1].replace(/'/g, '"'));
  const KNOWN = [...SRC.matchAll(/\{ code: '([a-z]+)'/g)].map(function (m) { return m[1]; });
  /* every language offered has its table, complete as the catalog has it */
  READY.filter(function (c) { return c !== 'ar'; }).forEach(function (code) {
    assert.ok(fs.existsSync(path.join(DOCS, 'i18n', code + '.js')), code + ' is offered with no table');
  });
  const de = boot({ languages: ['de-DE'], shipped: true, file: 'en' });
  assert.strictEqual(de.win.I18n.device(), 'en', 'a language the app does not speak');
  assert.strictEqual(de.win.I18n.lang, 'en');
  const waiting = KNOWN.filter(function (c) { return READY.indexOf(c) === -1; });
  if (waiting.length) {
    const early = boot({ languages: [waiting[0] + '-XX', 'ar-KW'], shipped: true });
    assert.strictEqual(early.win.I18n.device(), 'ar', 'the next of the phone\'s languages the app speaks');
    const chosen = boot({ languages: ['en-US'], storage: { 'sunnati.lang': waiting[0] }, shipped: true, file: 'en' });
    assert.strictEqual(chosen.win.I18n.lang, 'en', 'a language chosen before its words came is read as the phone\'s choice');
  }
  const listed = boot({ languages: ['ar-KW'], shipped: true });
  listed.win.App.go('settings');
  await tick();
  const values = Array.from(listed.doc.getElementById('settings-lang').options, function (o) { return o.value; });
  assert.deepStrictEqual(values, ['auto'].concat(KNOWN.filter(function (c) { return READY.indexOf(c) !== -1; })));
  assert.deepStrictEqual(Array.from(listed.win.I18n.langs, function (l) { return l.code; }), KNOWN.filter(function (c) { return READY.indexOf(c) !== -1; }));
});

test('a picker copies an option written in its own language with its language, so it is never translated', async () => {
  const { win, doc } = boot({ storage: { 'sunnati.lang': 'en' }, table: Object.assign({ 'العربية': 'Arabic', 'لغة الجهاز': 'Device language' }, TABLE) });
  win.App.go('settings');
  await tick();
  const sel = doc.getElementById('settings-lang');
  const label = sel.parentNode.querySelector('.picker-label');
  assert.strictEqual(label.textContent, 'English');
  assert.strictEqual(label.getAttribute('translate'), 'no');
  sel.parentNode.querySelector('.picker-btn').dispatchEvent(new win.Event('click', { bubbles: true }));
  await tick();
  const items = Array.from(doc.querySelectorAll('.picker-panel .picker-item span'), function (s) { return s.textContent; });
  assert.ok(items.indexOf('العربية') !== -1, 'Arabic is still called العربية, got ' + items.join(' | '));
  assert.ok(items[0].indexOf('Device language') === 0, 'while the app\'s own words are translated: ' + items[0]);
});

/* ---------------- the home card in a longer language ---------------- */

test('the home card holds its pieces together when the words are longer than the Arabic', () => {
  const CSS = fs.readFileSync(path.join(DOCS, 'css', 'style.css'), 'utf8');
  const APP = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  /* each date whole, the second under the first when they do not share a line */
  assert.match(CSS, /html:not\(\[lang='ar'\]\) #hijri-date, html:not\(\[lang='ar'\]\) #greg-date \{ display: inline-block; \}/);
  /* the six windows fall back to the two rows the large text already had, by
     measuring the words in the reader's language, not by a guess at a width */
  assert.match(CSS, /\.windows\.is-two-rows \{ flex-wrap: wrap; row-gap: 4px; \}/);
  assert.match(APP, /function fitWindows\(host, html\) \{[\s\S]*?I18n\.apply\(host\)[\s\S]*?scrollWidth > host\.clientWidth \+ 1 \|\| namesWrap\(host\)\) host\.classList\.add\('is-two-rows'\)/);
  /* and a name of two words that wrapped inside its window, which leaves its
     time lower than the others, counts as not fitting */
  assert.match(APP, /function namesWrap\(host\) \{[\s\S]*?selectNodeContents\(names\[i\]\)[\s\S]*?getClientRects\(\)/);
  /* the button that fetches the place stays beside the place's name */
  assert.match(CSS, /\.place-line\.is-stacked \.place-tap \{ flex-direction: column;/);
  assert.match(APP, /function fitPlaceLine\(\) \{[\s\S]*?I18n\.apply\(line\)[\s\S]*?classList\.add\('is-stacked'\)/);
  /* the night's two marks and the day's tally wrap whole */
  assert.match(CSS, /html:not\(\[lang='ar'\]\) \.night-line \{ flex-wrap: wrap;/);
  assert.match(CSS, /html:not\(\[lang='ar'\]\) \.meter-head \{ flex-wrap: wrap;/);
  /* and the Arabic page is drawn as it was: nothing measured here changes it
     while its words fit */
  const { win, doc } = boot({ languages: ['ar-KW'] });
  win.App.go('home');
  assert.ok(!doc.getElementById('windows').classList.contains('is-two-rows'));
  assert.ok(!doc.getElementById('place-line').classList.contains('is-stacked'));
});

test('the English table says a recording\'s size and a city\'s timetable once each', () => {
  const { win } = boot({ languages: ['en-US'], file: 'en' });
  const tx = win.I18n.tx;
  assert.strictEqual(tx('12.5 م.ب'), '12.5 MB', 'a size beside its unit, which no place of a line used to find');
  assert.strictEqual(tx('مواقيت أكتوبر 2026 لدبي'), 'October 2026 prayer times for Dubai', 'the lam is the line\'s own «for», said once');
  assert.strictEqual(tx('الحساب والمظهر والنسخ'), 'Calculation, appearance and backup', 'the reckoning of the times, not an account');
});
