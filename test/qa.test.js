/* The defects a walk through the whole app turned up, each held to its fix:
   data that came back after it was deleted, buttons that wiped a record with
   one touch, reminders a browser never raised, the back button with a sheet
   open, and the smaller slips of wording and counting found on the way. */
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

function memoryStorage() {
  const map = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    key: (i) => Object.keys(map)[i],
    get length() { return Object.keys(map).length; },
    clear: () => { Object.keys(map).forEach((k) => delete map[k]); },
    _map: map
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

/* the boot of interface.test.js, with the address it opens at as an option */
function boot(options) {
  const opts = options || {};
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: opts.url || 'https://siteq8.github.io/Quran_Sunna/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const win = dom.window;

  Object.defineProperty(win, 'localStorage', { value: opts.storage || memoryStorage(), configurable: true });
  if (opts.now) {
    let fixed = opts.now.getTime();
    const Real = win.Date;
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
  if (opts.bridge) win.SunnatiApp = opts.bridge;
  if (opts.notification) win.Notification = opts.notification;

  SCRIPTS.forEach(function (rel) {
    const code = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    vm.runInContext(code, dom.getInternalVMContext(), { filename: rel });
  });

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

const toastOf = (doc) => doc.getElementById('toast').textContent;
/* what the page holds comes from its own realm, so it is compared as plain data */
const plain = (x) => JSON.parse(JSON.stringify(x));
const sheetOpen = (doc) => doc.getElementById('sheet').classList.contains('is-open');

/* ---------------- deleting, and asking before it ---------------- */

test('delete all asks first, names what goes, and the red button is the one that does it', () => {
  const { win, doc } = boot();
  win.Store.set('method', 'Qatar');
  win.App.go('settings');
  click(win, doc.getElementById('data-clear'));
  assert.ok(sheetOpen(doc), 'a sheet asks before anything is gone');
  assert.strictEqual(win.Store.get('method'), 'Qatar', 'and nothing is gone yet');
  const body = doc.getElementById('sheet-body');
  assert.ok(body.textContent.indexOf('إعداداتك') !== -1 && body.textContent.indexOf('التلاوات المحفوظة') !== -1,
    'it says what will be lost');
  const go = body.querySelector('.btn-danger[data-act="clear-everything"]');
  assert.ok(go, 'the button that deletes is the red one');
  /* taking it back leaves everything as it was */
  click(win, body.querySelector('[data-act="sheet-cancel"]'));
  assert.ok(!sheetOpen(doc));
  assert.strictEqual(win.Store.get('method'), 'Qatar');
  click(win, doc.getElementById('data-clear'));
  click(win, doc.querySelector('#sheet-body [data-act="clear-everything"]'));
  assert.ok(!sheetOpen(doc));
  assert.strictEqual(win.Store.get('method'), 'Ojeiri', 'and only the red button deletes');
});

test('delete all leaves nothing behind, not even after the next change and a reload', () => {
  const storage = memoryStorage();
  let { win, doc } = boot({ storage: storage });
  const pristine = JSON.parse(JSON.stringify(win.Store.DEFAULTS));
  /* the record of each kind that used to come back: umrah steps, the sound of
     a reminder, a surah kept for listening, the last choice of a list */
  win.App.go('umrah');
  /* each tick draws the stages again, so each step is found as it stands */
  click(win, doc.querySelectorAll('[data-umrah-step]')[0]);
  click(win, doc.querySelectorAll('[data-umrah-step]')[1]);
  assert.strictEqual(doc.getElementById('umrah-tally').textContent, '2 من 39');
  const sounds = win.Store.get('remindSound'); sounds.morningAdhkar = 'silent'; win.Store.set('remindSound', sounds);
  const kept = win.Store.get('audioSaved'); kept['ar.minshawi:112'] = Date.now(); win.Store.set('audioSaved', kept);
  win.App.helpers.setWhenOn('salawat', true);
  win.App.helpers.setWhenOn('salawat', false);
  assert.deepStrictEqual(plain(win.Store.DEFAULTS), pristine, 'a change to a setting never reaches the defaults');

  const deleted = [];
  win.caches = { delete: (name) => { deleted.push(name); return Promise.resolve(true); } };
  win.App.go('settings');
  click(win, doc.getElementById('data-clear'));
  click(win, doc.querySelector('#sheet-body [data-act="clear-everything"]'));
  assert.deepStrictEqual(plain(deleted), ['sunnati-audio'], 'the recitations kept offline go with their record');
  /* any change at all writes the settings again, which is when the deleted
     record used to be written back with them */
  win.Store.set('readPace', 'fast');

  ({ win, doc } = boot({ storage: storage }));
  assert.deepStrictEqual(plain(win.Store.get('umrah')), {}, 'no umrah steps');
  assert.strictEqual(win.Store.get('remindSound').morningAdhkar, 'device', 'no reminder sound');
  assert.deepStrictEqual(plain(win.Store.get('audioSaved')), {}, 'no surah kept');
  assert.deepStrictEqual(plain(win.Store.get('lastWhen')), pristine.lastWhen);
  win.App.go('umrah');
  assert.strictEqual(doc.getElementById('umrah-tally').textContent, '0 من 39');
  assert.strictEqual(win.Store.get('readPace'), 'fast', 'and what was set after the delete stays');
});

test('a default is handed out as a copy, so changing it in place changes nothing else', () => {
  const { win } = boot();
  const a = win.Store.get('umrah');
  a['before:0'] = 1;
  assert.deepStrictEqual(plain(win.Store.DEFAULTS.umrah), {});
  win.Store.clearAll();
  assert.deepStrictEqual(plain(win.Store.get('umrah')), {});
});

test('clearing every mark, starting the umrah over and a new khatma are all asked first', () => {
  const { win, doc } = boot();
  win.Store.toggleBookmark(2, 255, 'read');
  win.Store.toggleBookmark(18, 10, 'read');
  win.App.go('bookmarks');
  click(win, doc.querySelector('[data-act="clear-bookmarks"]'));
  assert.ok(sheetOpen(doc));
  assert.ok(doc.getElementById('sheet-body').textContent.indexOf('2') !== -1, 'it says how many');
  assert.strictEqual(win.Store.bookmarks().length, 2, 'nothing is cleared by the first touch');
  click(win, doc.querySelector('#sheet-body .btn-danger[data-act="clear-bookmarks-now"]'));
  assert.strictEqual(win.Store.bookmarks().length, 0);

  win.App.go('umrah');
  click(win, doc.querySelector('[data-act="umrah-reset"]'));
  assert.ok(!sheetOpen(doc), 'with no step marked there is nothing to ask about');
  assert.strictEqual(toastOf(doc), 'لم تعلّم خطوة بعد');
  click(win, doc.querySelector('[data-umrah-step]'));
  click(win, doc.querySelector('[data-act="umrah-reset"]'));
  assert.ok(sheetOpen(doc));
  assert.ok(doc.getElementById('sheet-body').textContent.indexOf('خطوة واحدة من 39') !== -1);
  assert.strictEqual(Object.keys(win.Store.get('umrah')).length, 1);
  click(win, doc.querySelector('#sheet-body .btn-danger[data-act="umrah-reset-now"]'));
  assert.deepStrictEqual(plain(win.Store.get('umrah')), {});

  win.App.go('khatma');
  for (let i = 0; i < 3; i++) click(win, doc.querySelector('[data-act="khatma-plus"]'));
  click(win, doc.querySelector('[data-act="khatma-restart"]'));
  assert.ok(doc.getElementById('sheet-body').textContent.indexOf('3 من 604') !== -1, 'it says what was read');
  click(win, doc.querySelector('#sheet-body [data-act="sheet-cancel"]'));
  assert.strictEqual(win.Store.progress().pagesRead, 3);
});

/* ---------------- the back button with a sheet open ---------------- */

test('the back button closes a sheet and leaves the screen and its address alone', async () => {
  const { win, doc } = boot();
  win.App.go('quran');
  win.App.state.surah = 112; win.App.go('reader');
  assert.strictEqual(win.location.hash, '#reader/112');
  const before = win.history.length;
  click(win, doc.querySelector('#reader-body [data-ayah="112:1"]'));
  assert.ok(sheetOpen(doc));
  assert.ok(win.history.state && win.history.state.sheet, 'the sheet takes a step of its own');
  win.history.back();
  await until(() => !sheetOpen(doc));
  assert.strictEqual(win.App.state.view, 'reader', 'still in the surah');
  assert.strictEqual(win.location.hash, '#reader/112', 'and the address still names it');
  assert.strictEqual(win.history.length, before + 1, 'the sheet\'s step is the only one added');
  /* the next back leaves the surah for the list, as it should */
  win.history.back();
  await until(() => win.App.state.view === 'quran');
});

test('a sheet shut by its own button hands its step back', async () => {
  const { win, doc } = boot();
  win.App.state.surah = 112; win.App.go('reader');
  click(win, doc.querySelector('#reader-body [data-ayah="112:2"]'));
  assert.ok(win.history.state.sheet);
  click(win, doc.getElementById('sheet-close'));
  await until(() => !(win.history.state && win.history.state.sheet));
  assert.strictEqual(win.location.hash, '#reader/112');
  assert.strictEqual(win.App.state.view, 'reader');
});

test('moving to another screen from a sheet leaves no dead step behind', async () => {
  const { win, doc } = boot();
  win.App.state.surah = 112; win.App.go('reader');
  click(win, doc.querySelector('#reader-body [data-ayah="112:3"]'));
  win.App.go('home');
  assert.ok(!sheetOpen(doc));
  assert.strictEqual(win.location.hash, '#home');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(win.location.hash, '#home', 'the step handed back did not undo the move');
  win.history.back();
  await until(() => win.App.state.view === 'reader');
  assert.strictEqual(win.location.hash, '#reader/112');
});

/* ---------------- the page view ---------------- */

test('the page view opens where it was left and does not move تابع القراءة', () => {
  const storage = memoryStorage();
  let { win, doc } = boot({ storage: storage });
  win.App.helpers.openPage(300);
  win.App.state.surah = 18; win.App.go('reader');
  win.Store.set('lastRead', { s: 18, a: 50 });
  ({ win, doc } = boot({ storage: storage }));
  win.App.go('page');
  assert.strictEqual(win.App.state.page, 300, 'the page last turned to');
  assert.ok(doc.getElementById('page-title').textContent.indexOf('٣٠٠') !== -1);
  const last = win.Store.get('lastRead');
  assert.strictEqual(last.s, 18, 'تابع القراءة still goes to الكهف');
  assert.strictEqual(last.a, 50);
});

test('a page turned to is the place to continue from', () => {
  const { win } = boot();
  win.App.helpers.openPage(2);
  const last = win.Store.get('lastRead');
  assert.strictEqual(last.s, 2);
  assert.strictEqual(last.a, 1);
});

test('a mark set from the page shows on the page at once', () => {
  const { win, doc } = boot();
  win.App.helpers.openPage(1);
  const verse = () => doc.querySelector('#page-body .ayah[data-ayah="1:2"]');
  click(win, verse());
  assert.ok(sheetOpen(doc));
  click(win, doc.querySelector('#sheet-body [data-act="bookmark"]'));
  assert.ok(verse().classList.contains('is-marked'), 'marked without turning the page');
  click(win, doc.querySelector('#sheet-body [data-act="bookmark"]'));
  assert.ok(!verse().classList.contains('is-marked'), 'and unmarked the same way');
});

test('the printed page is kept when chosen, and drawn as printed', async () => {
  const lines = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'madinah-lines.json'), 'utf8'));
  const fetcher = function (url) {
    if (String(url).indexOf('mushaf.json') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(mushafPayload) });
    if (String(url).indexOf('madinah-lines.json') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(lines) });
    return Promise.reject(new Error('offline in tests'));
  };
  const storage = memoryStorage();
  let { win, doc } = boot({ storage: storage, fetch: fetcher });
  win.App.go('settings');
  const pick = doc.getElementById('settings-page-layout');
  pick.value = 'madinah';
  fire(win, pick, 'change');
  assert.strictEqual(win.Store.get('pageLayout'), 'madinah', 'the choice is kept');
  win.App.helpers.openPage(3);
  await until(() => doc.querySelectorAll('#page-body .mad-line').length >= 15);

  ({ win, doc } = boot({ storage: storage, fetch: fetcher }));
  win.App.go('settings');
  assert.strictEqual(doc.getElementById('settings-page-layout').value, 'madinah', 'and still there after a reload');
  assert.strictEqual(doc.querySelector('.picker-btn.for-settings-page-layout').textContent.trim(), 'كما طُبعت');
});

/* ---------------- reminders in a browser ---------------- */

function grantedBrowser(shown) {
  return {
    notification: Object.assign(function () {}, { permission: 'granted', requestPermission: () => Promise.resolve('granted') }),
    worker: { ready: Promise.resolve({ showNotification: function (t, o) { shown.push({ t: t, o: o }); return Promise.resolve(); } }) }
  };
}

test('a reminder switched on in a browser is raised at its minute, once', async () => {
  const shown = [];
  const browser = grantedBrowser(shown);
  const storage = memoryStorage();
  const start = new Date(2026, 9, 12, 3, 0, 0);
  const { win } = boot({ storage: storage, now: start, notification: browser.notification });
  win.navigator.serviceWorker = browser.worker;
  /* as the switch does: kept, then handed on, which draws the plan again */
  win.Store.set('morningAdhkar', true);
  win.App.helpers.handRemindersToApp();
  const due = win.App.helpers.reminderList().filter((r) => r.k === 'morningAdhkar')[0];
  assert.ok(due, 'the morning adhkar are on the list');
  assert.strictEqual(win.App.helpers.remindInPage(), 0, 'the plan is drawn, nothing is due yet');

  win.__setNow(new Date(due.at + 90 * 1000));
  assert.strictEqual(win.App.helpers.remindInPage(), 1, 'its minute has come');
  await until(() => shown.length === 1);
  assert.strictEqual(shown[0].t, 'أذكار الصباح');
  assert.ok(!shown[0].o.silent, 'with the phone\'s own sound, as chosen');
  assert.strictEqual(win.App.helpers.remindInPage(), 0, 'and not again');
  assert.ok(win.Store.get('reminded')['morningAdhkar:' + due.at], 'what was raised is kept');
});

test('a reminder late by more than twenty minutes is let go, and a silent one makes no sound', async () => {
  const shown = [];
  const browser = grantedBrowser(shown);
  const { win } = boot({ now: new Date(2026, 9, 12, 3, 0, 0), notification: browser.notification });
  win.navigator.serviceWorker = browser.worker;
  win.Store.set('morningAdhkar', true);
  win.Store.set('eveningAdhkar', true);
  const sounds = win.Store.get('remindSound'); sounds.eveningAdhkar = 'silent'; win.Store.set('remindSound', sounds);
  win.App.helpers.handRemindersToApp();
  const list = win.App.helpers.reminderList();
  const morning = list.filter((r) => r.k === 'morningAdhkar')[0];
  const evening = list.filter((r) => r.k === 'eveningAdhkar')[0];
  win.App.helpers.remindInPage();
  win.__setNow(new Date(morning.at + 25 * 60000));
  assert.strictEqual(win.App.helpers.remindInPage(), 0, 'the morning has gone by');
  win.__setNow(new Date(evening.at - 30 * 1000));
  win.App.helpers.handRemindersToApp();
  win.App.helpers.remindInPage();
  win.__setNow(new Date(evening.at + 1000));
  assert.strictEqual(win.App.helpers.remindInPage(), 1);
  await until(() => shown.length === 1);
  assert.strictEqual(shown[0].t, 'أذكار المساء');
  assert.strictEqual(shown[0].o.silent, true, 'silent means silent');
});

test('nothing is raised by the page without permission, or where the app rings them itself', () => {
  const asked = [];
  const { win } = boot({
    now: new Date(2026, 9, 12, 3, 0, 0),
    notification: Object.assign(function () {}, { permission: 'default', requestPermission: () => Promise.resolve('default') })
  });
  win.Store.set('morningAdhkar', true);
  win.App.helpers.handRemindersToApp();
  const due = win.App.helpers.reminderList().filter((r) => r.k === 'morningAdhkar')[0];
  win.App.helpers.remindInPage();
  win.__setNow(new Date(due.at + 1000));
  assert.strictEqual(win.App.helpers.remindInPage(), 0, 'not allowed, so not raised');

  const inApp = boot({
    now: new Date(2026, 9, 12, 3, 0, 0),
    bridge: { setReminders: (json) => asked.push(json), notify: () => asked.push('notify') },
    notification: Object.assign(function () {}, { permission: 'granted' })
  });
  inApp.win.Store.set('morningAdhkar', true);
  inApp.win.App.helpers.handRemindersToApp();
  inApp.win.App.helpers.remindInPage();
  inApp.win.__setNow(new Date(due.at + 1000));
  assert.strictEqual(inApp.win.App.helpers.remindInPage(), 0, 'the wrapper rings its own list');
  assert.ok(asked.indexOf('notify') === -1);
});

test('the qiyam of the last third is raised by the page too', async () => {
  const shown = [];
  const browser = grantedBrowser(shown);
  const { win } = boot({ now: new Date(2026, 9, 12, 21, 0, 0), notification: browser.notification });
  win.navigator.serviceWorker = browser.worker;
  win.Store.set('qiyam', true);
  win.App.helpers.handRemindersToApp();
  const at = win.App.helpers.qiyamAt(new win.Date(2026, 9, 12));
  win.App.helpers.remindInPage();
  win.__setNow(new Date(at.getTime() + 1000));
  assert.strictEqual(win.App.helpers.remindInPage(), 1);
  await until(() => shown.length === 1);
  assert.strictEqual(shown[0].t, 'قيام الليل');
});

test('switching a reminder on in a browser asks for permission, and says so when refused', async () => {
  let asked = 0;
  const { win, doc } = boot({
    notification: Object.assign(function () {}, { permission: 'default', requestPermission: () => { asked++; return Promise.resolve('denied'); } })
  });
  win.App.go('settings');
  click(win, doc.getElementById('settings-salawat-on'));
  assert.strictEqual(asked, 1, 'the salawat switch asks');
  click(win, doc.getElementById('settings-morningAdhkar'));
  assert.strictEqual(asked, 2, 'and so does every reminder of the reader\'s own');
  /* switching off asks nothing */
  click(win, doc.getElementById('settings-morningAdhkar'));
  assert.strictEqual(asked, 2);
  await until(() => toastOf(doc) === 'لم يُسمح بالإشعارات، فلن يصلك التذكير');

  const inApp = boot({ bridge: { setReminders() {} },
    notification: Object.assign(function () {}, { permission: 'default', requestPermission: () => { asked++; return Promise.resolve('granted'); } }) });
  inApp.win.App.go('settings');
  click(inApp.win, inApp.doc.getElementById('settings-duha'));
  assert.strictEqual(asked, 2, 'inside the app the wrapper holds the permission');
});

/* ---------------- what is kept across a reload ---------------- */

test('a chapter of the book keeps its address, so a reload opens it again', () => {
  const { win } = boot();
  win.App.state.hisn = 32;
  win.App.go('hisn');
  assert.strictEqual(win.location.hash, '#hisn/32');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(win.App.helpers.readAddress('#hisn/32'))), { name: 'hisn', hisn: 32 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(win.App.helpers.readAddress('#hisn/9999'))), { name: 'hisn' }, 'no such chapter');
  const again = boot({ url: 'https://siteq8.github.io/Quran_Sunna/#hisn/32' });
  assert.strictEqual(again.win.App.state.view, 'hisn');
  assert.strictEqual(again.win.App.state.hisn, 32);
});

test('the tasbih keeps its count and its phrase through a reload, and starts afresh the next day', () => {
  const storage = memoryStorage();
  const day = new Date(2026, 9, 12, 10, 0, 0);
  let { win, doc } = boot({ storage: storage, now: day });
  win.App.go('tasbih');
  click(win, doc.querySelectorAll('#tasbih-phrases [data-phrase]')[1]);
  for (let i = 0; i < 5; i++) click(win, doc.getElementById('tasbih-tap'));
  const phrase = doc.getElementById('tasbih-phrase').textContent;
  ({ win, doc } = boot({ storage: storage, now: day }));
  win.App.go('tasbih');
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '5');
  assert.strictEqual(doc.getElementById('tasbih-phrase').textContent, phrase);
  ({ win, doc } = boot({ storage: storage, now: new Date(2026, 9, 13, 10, 0, 0) }));
  win.App.go('tasbih');
  assert.strictEqual(doc.getElementById('tasbih-value').textContent, '0', 'a new day, a new count');
  assert.strictEqual(doc.getElementById('tasbih-phrase').textContent, phrase, 'on the same phrase');
});

test('the pickers say what their lists hold after a delete', () => {
  const { win, doc } = boot();
  win.Store.set('tafsir', 'ar.jalalayn');
  win.Store.set('sleepAt', '21:30');
  win.App.go('settings');
  win.App.helpers.renderSettings();
  const label = (id) => doc.querySelector('#' + id).parentNode.querySelector('.picker-btn').textContent.trim();
  assert.strictEqual(label('settings-tafsir'), 'الجلالين');
  click(win, doc.getElementById('data-clear'));
  click(win, doc.querySelector('#sheet-body [data-act="clear-everything"]'));
  assert.strictEqual(doc.getElementById('settings-tafsir').value, 'ar.muyassar');
  assert.strictEqual(label('settings-tafsir'), 'الميسر', 'the button follows its list');
  assert.strictEqual(label('settings-sleep-at'), win.App.helpers.clockText(22 * 60 + 30), 'and the bedtime its value');
});

/* ---------------- small things that misled ---------------- */

test('a dimmed list says why when it is touched', () => {
  const { win, doc } = boot();
  win.App.go('settings');
  const btn = doc.querySelector('#settings-salawat').parentNode.querySelector('.picker-btn');
  assert.ok(btn.disabled, 'the salawat is off, so its list is dimmed');
  /* a browser gives a disabled button no click, but the finger's lift arrives */
  fire(win, btn, 'pointerup');
  assert.strictEqual(toastOf(doc), 'شغّل التذكير أولاً من المفتاح');
});

test('touching the lit reading button stops the reading and opens nothing', () => {
  const { win, doc } = boot();
  win.requestAnimationFrame = function () { return 1; };
  win.cancelAnimationFrame = function () {};
  win.App.state.surah = 1; win.App.go('reader');
  win.App.helpers.startAutoScroll();
  const btn = doc.getElementById('reader-autoscroll');
  fire(win, btn, 'pointerdown');
  assert.strictEqual(win.App.helpers.autoScrolling(), true, 'the touch on the button is left to the button');
  click(win, btn);
  assert.strictEqual(win.App.helpers.autoScrolling(), false);
  assert.ok(!sheetOpen(doc), 'and the paces do not open again');
  /* a touch anywhere else still stops it */
  win.App.helpers.startAutoScroll();
  fire(win, doc.getElementById('reader-body'), 'pointerdown');
  assert.strictEqual(win.App.helpers.autoScrolling(), false);
});

test('the sleep timer needs something playing, and lights the time it runs for', () => {
  const { win, doc } = boot();
  win.App.go('radio');
  click(win, doc.querySelector('[data-sleep="30"]'));
  assert.strictEqual(toastOf(doc), 'شغّل إذاعة أولاً ثم اختر متى يتوقف البث');
  assert.strictEqual(doc.getElementById('sleep-note').textContent, 'المؤقت متوقف');
  click(win, doc.querySelector('[data-station="0"]'));
  click(win, doc.querySelector('[data-sleep="30"]'));
  assert.ok(doc.querySelector('[data-sleep="30"]').classList.contains('is-on'));
  assert.strictEqual(doc.querySelectorAll('#sleep-timer .is-on').length, 1);
  click(win, doc.querySelector('[data-sleep="0"]'));
  assert.strictEqual(doc.querySelectorAll('#sleep-timer .is-on').length, 0);
});

test('the days of ramadan owed read one way between − and + and in the badge', () => {
  const { win, doc } = boot();
  win.App.go('qada');
  const owed = () => doc.getElementById('qada-fast-owed').textContent;
  const badge = () => doc.getElementById('qada-fast-tally').textContent;
  assert.strictEqual(owed(), 'لا شيء عليك');
  for (let i = 0; i < 3; i++) click(win, doc.querySelector('[data-act="fast-owed"][data-ref="1"]'));
  assert.strictEqual(owed(), '3 أيام عليك');
  click(win, doc.querySelector('[data-act="fast-done"]'));
  assert.strictEqual(owed(), 'يومان عليك');
  assert.strictEqual(badge(), 'بقي يومان');
  for (let i = 0; i < 3; i++) click(win, doc.querySelector('[data-act="fast-owed"][data-ref="-1"]'));
  assert.strictEqual(owed(), 'لا شيء عليك');
  assert.strictEqual(badge(), 'لا شيء عليك');
  /* a day added now is owed, not swallowed by the day fasted before */
  click(win, doc.querySelector('[data-act="fast-owed"][data-ref="1"]'));
  assert.strictEqual(owed(), 'يوم واحد عليك');
  assert.strictEqual(badge(), 'بقي يوم واحد');
  click(win, doc.querySelector('[data-act="fast-done"]'));
  assert.strictEqual(toastOf(doc), 'تقبّل الله، وقضيت كل ما عليك');
});

test('counts are read the way arabic reads them', () => {
  const { win } = boot();
  const h = win.App.helpers;
  assert.strictEqual(h.daysOf(2), 'يومان');
  assert.strictEqual(h.daysOf(2, true), 'يومين', 'after بعد the dual is يومين');
  assert.strictEqual(h.daysOf(5, true), '5 أيام');
  assert.strictEqual(h.daysOf(11), '11 يوماً');
  assert.strictEqual(h.count(103, 'آية واحدة', 'آيتان', 'آيات', 'آية'), '103 آيات', 'past a hundred the last figures decide');
  assert.strictEqual(h.count(286, 'آية واحدة', 'آيتان', 'آيات', 'آية'), '286 آية');
  assert.strictEqual(h.daysOf(200), '200 يوم', 'a round hundred takes no tanween');
  assert.strictEqual(h.daysOf(111), '111 يوماً');
  assert.strictEqual(h.inARow(1), 'يوم واحد');
  assert.strictEqual(h.inARow(2), 'يومان متتابعان');
  assert.strictEqual(h.inARow(3), '3 أيام متتابعة');
  assert.strictEqual(h.inARow(12), '12 يوماً متتابعاً');
  /* every count after بعد is written in the oblique form */
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const after = [...app.matchAll(/بعد ' \+ (daysOf|minutesOf|ayat|pages|rounds)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)];
  assert.ok(after.length >= 6);
  after.forEach(function (m) { assert.ok(/, true$/.test(m[2]), m[0]); });
});

test('a month that opens on a friday still heads its noon column الظهر, and the copy joins its lam', () => {
  const { win, doc } = boot({ now: new Date(2027, 0, 10, 10, 0, 0) });
  win.App.go('timetable');
  const heads = [...doc.querySelectorAll('#tt-table thead th')].map((t) => t.textContent);
  assert.ok(heads.indexOf('الظهر') !== -1, 'got ' + heads.join('، '));
  assert.ok(heads.indexOf('الجمعة') === -1);
  const first = win.App.helpers.timetableText().split('\n')[0];
  assert.strictEqual(first, 'مواقيت يناير 2027 للكويت');
});

test('a thursday evening calls its own noon الظهر, and friday calls it الجمعة', () => {
  const thursday = boot({ now: new Date(2026, 9, 15, 21, 30, 0) });
  const marks = thursday.win.App.clockState().marks;
  assert.strictEqual(marks.filter((m) => m.key === 'dhuhr')[0].ar, 'الظهر');
  const friday = boot({ now: new Date(2026, 9, 16, 9, 0, 0) });
  assert.strictEqual(friday.win.App.clockState().marks.filter((m) => m.key === 'dhuhr')[0].ar, 'الجمعة');
});

test('a time the sun never reaches is dashes, never NaN', async () => {
  const { win, doc } = boot({ now: new Date(2026, 5, 21, 23, 30, 0) });
  win.Store.set('highLat', 'none');
  win.App.setPlace({ n: 'لندن', lat: 51.5074, lng: -0.1278, tz: 1, z: 'Europe/London', method: 'MWL' }, true);
  assert.strictEqual(win.App.helpers.clockText(NaN), '--:--');
  assert.strictEqual(win.App.helpers.clockText(undefined), '--:--');
  await until(() => doc.getElementById('arc-count').textContent.indexOf('--') !== -1, 3000);
  assert.ok(doc.getElementById('arc-count').textContent.indexOf('NaN') === -1);
  assert.ok(doc.getElementById('arc-at').textContent.indexOf('ص') === -1, 'no morning sign on a missing time');
});

test('a surah is found by a name with hamza, and by its number in either figures', () => {
  const { win, doc } = boot();
  const h = win.App.helpers;
  ['الأنعام', 'إبراهيم', 'الإسراء'].forEach(function (name) {
    assert.ok(h.surahsNamed(name).length >= 1, name + ' is found');
  });
  assert.strictEqual(h.surahsNamed('١٨')[0].n, 18);
  win.App.go('search');
  const f = doc.getElementById('quran-search');
  f.value = '18'; fire(win, f, 'input');
  assert.notStrictEqual(doc.getElementById('search-count').textContent, 'لا نتيجة', 'a surah was found, so there is a result');
});

test('a hit in the book names its chapter', () => {
  const { win } = boot();
  const hits = win.App.helpers.searchTexts('hisn', 'اللهم');
  assert.ok(new Set(hits.map((h) => h.where)).size > 1, 'hits from several chapters');
  hits.forEach(function (hit) {
    assert.ok(hit.where.indexOf('undefined') === -1, hit.where);
    assert.ok(hit.where.indexOf('حصن المسلم، ') === 0);
  });
});

test('the text size reaches the hadiths, the duas, the ruqyah and the verse of the day', () => {
  const { win, doc } = boot();
  ['hadith', 'dua', 'ruqyah'].forEach(function (view) {
    win.App.go(view);
    const styled = [...doc.querySelectorAll('#v-' + view + ' .naskh')].filter((p) => /font-size/.test(p.getAttribute('style') || ''));
    assert.strictEqual(styled.length, 0, view + ' sets no size of its own over the reader\'s');
  });
  assert.ok(/var\(--quran-scale\)/.test(doc.getElementById('daily-ayah').getAttribute('style')));
});

test('the picture of the day\'s sunan is titled with the day, not with the prayers', () => {
  const app = fs.readFileSync(path.join(DOCS, 'js', 'app.js'), 'utf8');
  const body = /'share-sunan': function \(\) \{([\s\S]*?)\n    \},/.exec(app)[1];
  const under = /listCard\('سنن اليوم', rows, ([^\n]*)\),/.exec(body)[1];
  assert.ok(under.indexOf('الرواتب') === -1, under);
  assert.ok(under.indexOf('Hijri.format') !== -1, 'the hijri day it is for');
});

/* ---------------- آية الكرسي and the quls in the morning and evening ---------------- */

test('the morning and evening lists open with آية الكرسي and the three quls, as the book does', () => {
  const { win, doc } = boot();
  const book = win.HISN.filter((c) => c.id === 27)[0].i;
  ['morning', 'evening'].forEach(function (key) {
    const items = win.AZKAR_DB[key].items;
    assert.strictEqual(items[0].t, book[0].t, key + ': the words of the book');
    assert.strictEqual(items[0].c, book[0].r);
    /* the count is the counter's, not a note in brackets after the words */
    assert.strictEqual(items[1].t, book[1].t.replace(/\s*\([^()]*\)$/, ''));
    assert.strictEqual(items[1].c, book[1].r);
    assert.strictEqual(items[1].c, 3);
  });
  win.App.go('azkar');
  click(win, doc.querySelector('[data-azkar="morning"]'));
  assert.ok(doc.querySelector('[data-dhikr="0"] [data-hear="kursi-buhendi.mp3"]'), 'and the recording of the kursi plays from its card');
});

test('a day counted before the two were added keeps its counts on the same adhkar', () => {
  const storage = memoryStorage();
  const key = 'sunnati.day.2026-10-11';
  storage.setItem(key, JSON.stringify({ azkar: { morning: { 0: 0, 5: 2 }, evening: { 3: 0 }, sleep: { 1: 0 } }, sunnah: {} }));
  let { win } = boot({ storage: storage, now: new Date(2026, 9, 12, 9, 0, 0) });
  let rec = JSON.parse(storage.getItem(key));
  assert.deepStrictEqual(rec.azkar.morning, { 2: 0, 7: 2 }, 'moved along by the two at the head');
  assert.deepStrictEqual(rec.azkar.evening, { 5: 0 });
  assert.deepStrictEqual(rec.azkar.sleep, { 1: 0 }, 'other lists are as they were');
  ({ win } = boot({ storage: storage, now: new Date(2026, 9, 12, 9, 0, 0) }));
  rec = JSON.parse(storage.getItem(key));
  assert.deepStrictEqual(rec.azkar.morning, { 2: 0, 7: 2 }, 'and moved once only');

  /* a day counted now carries the order it was counted in */
  win.Store.setAzkarCount('morning', 0, 0);
  assert.strictEqual(JSON.parse(storage.getItem('sunnati.day.2026-10-12')).azkarOrder, win.Store.AZKAR_ORDER);
  win.App.helpers.settleAzkar();
  assert.deepStrictEqual(JSON.parse(storage.getItem('sunnati.day.2026-10-12')).azkar.morning, { 0: 0 });

  /* and a backup from before brings its days into the new order */
  const old = { app: 'sunnati', version: 5, data: { 'sunnati.day.2026-10-10': JSON.stringify({ azkar: { morning: { 1: 0 } } }) } };
  win.Store.importAll(JSON.stringify(old));
  win.App.helpers.settleAzkar();
  assert.deepStrictEqual(JSON.parse(storage.getItem('sunnati.day.2026-10-10')).azkar.morning, { 3: 0 });
});

test('the shortcut named أذكار الصباح opens the morning list', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  const item = manifest.shortcuts.filter((s) => s.name === 'أذكار الصباح')[0];
  assert.strictEqual(item.url, './#azkar/morning');
  const { win } = boot({ url: 'https://siteq8.github.io/Quran_Sunna/#azkar/morning' });
  assert.strictEqual(win.App.state.view, 'azkar-list');
  assert.strictEqual(win.App.state.azkarKey, 'morning');
});
