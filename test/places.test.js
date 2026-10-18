/* The name of the reader's place: the gazetteer in docs/data/places.json,
   built from GeoNames by tools/places/build.js, and the page that names the
   nearest place in it on the device, in the reader's language, and never
   says that a reader is near somewhere. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

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
const PLACES_FILE = path.join(DOCS, 'data', 'places.json');
const PLACES_TEXT = fs.readFileSync(PLACES_FILE, 'utf8');
const PLACES = JSON.parse(PLACES_TEXT);

const CITIES = (function () {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(DOCS, 'data', 'extras.js'), 'utf8') + '\nthis.CITIES = CITIES;', ctx);
  return ctx.CITIES;
}());

/* the gazetteer read here on its own, to say what the page should find */
const GAZ = (function () {
  const ar = PLACES.ar.split('|'), la = PLACES.la.split('|'), ru = PLACES.ru.split('|'), bn = PLACES.bn.split('|');
  const out = [];
  let y = 0, x = 0;
  for (let i = 0; i < PLACES.lat.length; i++) {
    y += PLACES.lat[i]; x += PLACES.lng[i];
    out.push({ lat: y / 100, lng: x / 100, ar: ar[i], la: la[i], ru: ru[i], bn: bn[i] });
  }
  return out;
}());

function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * r / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function nearestInFile(lat, lng) {
  let best = null, least = Infinity;
  GAZ.forEach(function (p) { const d = km(lat, lng, p.lat, p.lng); if (d < least) { least = d; best = p; } });
  return { place: best, km: least };
}

function nearestCityKm(lat, lng) {
  return Math.min.apply(null, CITIES.map(function (c) { return km(lat, lng, c.lat, c.lng); }));
}

const QURB = 'قرب';
/* Latin letters with the marks of their own, and the signs a name is written
   with: the English names carry their marks, Évreux, and the plain ASCII names
   whatever GeoNames wrote in them */
const LATIN = /^(?=.*[A-Za-z])[\x20-\x7E\u00C0-\u024F\u1E00-\u1EFF\u2018\u2019\u02BB\u02BC]+$/;

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
test.afterEach(function () {
  while (opened.length) { try { opened.pop().window.close(); } catch (e) { /* gone */ } }
});

/* opts: storage (seed), languages (the phone's), file (a language whose table
   is read), offline (the gazetteer cannot be fetched) */
function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(HTML, { url: 'https://sunnati.3li.info/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const storage = memoryStorage(opts.storage);
  Object.defineProperty(win, 'localStorage', { value: storage, configurable: true });
  const langs = opts.languages || ['ar-KW'];
  Object.defineProperty(win.navigator, 'languages', { value: langs, configurable: true });
  Object.defineProperty(win.navigator, 'language', { value: langs[0], configurable: true });
  const fixed = new Date(2026, 9, 14, 9, 30).getTime();
  const Real = win.Date;
  function Fixed(...args) { return args.length ? new Real(...args) : new Real(fixed); }
  Fixed.prototype = Real.prototype; Fixed.now = () => fixed; Fixed.parse = Real.parse; Fixed.UTC = Real.UTC;
  win.Date = Fixed;
  win.matchMedia = function () { return { matches: false, addEventListener() {}, removeEventListener() {} }; };
  win.__asked = [];
  win.__offline = !!opts.offline;
  win.fetch = function (url) {
    const u = String(url);
    win.__asked.push(u);
    if (u.indexOf('mushaf.json') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(MUSHAF) });
    if (u.indexOf('places.json') !== -1 && !win.__offline) return Promise.resolve({ ok: true, json: () => Promise.resolve(PLACES) });
    return Promise.reject(new Error('offline in tests'));
  };
  win.Audio = function () { return { play: () => Promise.resolve(), pause() {}, paused: true, src: '' }; };
  win.scrollTo = function () {};
  const ctx = dom.getInternalVMContext();
  SCRIPTS.forEach(function (rel, i) {
    let src = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    if (i === 0) src = src.replace(/var READY = \[[^\]]*\];/, 'var READY = LANGS.map(function (l) { return l.code; });');
    vm.runInContext(src, ctx, { filename: rel });
    if (i !== 0) return;
    win.I18n.reload = function () {};
    if (opts.file) vm.runInContext(fs.readFileSync(path.join(DOCS, 'i18n', opts.file + '.js'), 'utf8'), ctx, { filename: 'i18n/' + opts.file + '.js' });
  });
  win.Mushaf.init(MUSHAF);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  opened.push(dom);
  return { dom: dom, win: win, doc: win.document, storage: storage };
}

/* the phone says it is here, and the app is left to settle the name */
function fixAt(win, lat, lng) {
  win.navigator.geolocation = { getCurrentPosition: function (ok) { ok({ coords: { latitude: lat, longitude: lng } }); } };
  return new Promise(function (done) { win.App.helpers.locateQuietly(function () { done(); }); });
}

/* what the page wrote is put into the language a moment after it is written */
const tick = () => new Promise((r) => setTimeout(r, 0));

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

/* an object made inside the page, read as a plain one here */
function plainCopy(value) { return JSON.parse(JSON.stringify(value)); }

function shownPlace(doc) {
  const where = doc.querySelector('#place-line .place-where');
  return where ? where.textContent.trim() : '';
}

/* ---------------- the file ---------------- */

test('the gazetteer is one file of columns that agree, credited to GeoNames, and light enough to fetch once', () => {
  assert.deepStrictEqual(Object.keys(PLACES), ['about', 'lat', 'lng', 'ar', 'la', 'ru', 'bn']);
  assert.match(PLACES.about, /GeoNames/);
  assert.match(PLACES.about, /CC BY 4\.0/);
  const n = PLACES.lat.length;
  assert.ok(n > 20000, 'the towns of the world and the areas of the Gulf, got ' + n);
  assert.strictEqual(PLACES.lng.length, n);
  ['ar', 'la', 'ru', 'bn'].forEach(function (k) { assert.strictEqual(PLACES[k].split('|').length, n, k + ' has a name, or nothing, for each place'); });

  const marks = new RegExp('[' + String.fromCharCode(0x64B) + '-' + String.fromCharCode(0x652) + String.fromCharCode(0x670) + ']');
  const seen = new Set();
  GAZ.forEach(function (p) {
    assert.ok(Number.isInteger(Math.round(p.lat * 100)) && p.lat >= -90 && p.lat <= 90, 'a latitude: ' + p.lat);
    assert.ok(p.lng >= -180 && p.lng <= 180, 'a longitude: ' + p.lng);
    assert.ok(LATIN.test(p.la), 'every place has a name in Latin letters: ' + JSON.stringify(p.la));
    if (p.ar) {
      assert.ok(/[ء-ي]/.test(p.ar) && !/[A-Za-z]/.test(p.ar), 'the Arabic name is in the Arabic script: ' + p.ar);
      assert.ok(!marks.test(p.ar), 'and written without its vowel marks: ' + p.ar);
      assert.ok(p.ar.indexOf(QURB) !== 0, 'and a place is never near another: ' + p.ar);
    }
    if (p.ru) assert.ok(/^[\u0400-\u04FF0-9 \-]+$/.test(p.ru), 'a Cyrillic name: ' + p.ru);
    if (p.bn) assert.ok(/^[\u0980-\u09FF0-9 \-]+$/.test(p.bn), 'a Bengali name: ' + p.bn);
    const at = Math.round(p.lat * 100) + ':' + Math.round(p.lng * 100);
    assert.ok(!seen.has(at), 'one place to a point, two at ' + at);
    seen.add(at);
  });
  /* two decimals and no more, so the file says where towns are and nothing finer */
  PLACES.lat.concat(PLACES.lng).forEach(function (v) { assert.ok(Number.isInteger(v), 'kept in hundredths of a degree'); });

  /* the Gulf down to its areas */
  const arabic = new Set(GAZ.map(function (p) { return p.ar; }));
  ['السالمية', 'حولي', 'الجهراء', 'الفروانية', 'الفحيحيل', 'صباح السالم', 'الأحمدي', 'مدينة الكويت', 'الرياض', 'المحرق', 'الشارقة',
    'كيفان', 'الشويخ', 'الصباحية', 'الجابرية', 'الربيع', 'المدينة المنورة']
    .forEach(function (name) { assert.ok(arabic.has(name), name + ' is in it'); });
  /* and the grid of Abu Dhabi, whose sectors are numbers, is not */
  assert.ok(!GAZ.some(function (p) { return /^[A-Za-z]{1,3}_?[0-9]+$/.test(p.la) || p.ar.indexOf('غير معرّف') !== -1; }));

  const raw = fs.statSync(PLACES_FILE).size;
  const packed = zlib.gzipSync(PLACES_TEXT, { level: 9 }).length;
  assert.ok(raw <= 1600000, 'the file stays under 1.6 MB, got ' + raw);
  assert.ok(packed <= 500000, 'and travels compressed in under 500 kB, got ' + packed);
});

test('the gazetteer is built by a script anyone can run again, from GeoNames alone', () => {
  const build = fs.readFileSync(path.join(__dirname, '..', 'tools', 'places', 'build.js'), 'utf8');
  ['cities15000.zip', 'cities1000.zip', 'alternateNamesV2.zip', 'https://download.geonames.org/export/dump/', "c + '.zip'"]
    .forEach(function (part) { assert.ok(build.indexOf(part) !== -1, 'the build names its source: ' + part); });
  assert.ok(build.indexOf("new Set(['KW', 'SA', 'AE', 'QA', 'BH', 'OM'])") !== -1, 'the Gulf to its towns of a thousand');
  assert.ok(build.indexOf("const WHOLE = new Set(['KW', 'BH', 'QA']);") !== -1, 'and Kuwait, Bahrain and Qatar to every populated place');
  assert.ok(build.indexOf("WHOLE.has(c) || f[7] === 'PPLX'") !== -1, 'the quarters of the towns of the other three');
  assert.ok(build.indexOf("require('") !== -1 && !/require\('(?!fs|os|path|zlib|readline|stream)/.test(build),
    'node alone, with nothing to install');
});

/* ---------------- the name ---------------- */

test('the nearest place is named, and near is never said, 30, 80 and 200 km from any listed city', async () => {
  const { win, doc } = boot();
  const points = [
    { at: [29.341, 47.664], band: [25, 35] },
    { at: [28.645, 47.935], band: [75, 85] },
    { at: [32.175, 46.045], band: [190, 210] }
  ];
  for (const point of points) {
    const [lat, lng] = point.at;
    const far = nearestCityKm(lat, lng);
    assert.ok(far >= point.band[0] && far <= point.band[1], 'the point lies ' + far.toFixed(1) + ' km from the nearest listed city');
    await fixAt(win, lat, lng);
    const want = nearestInFile(lat, lng).place;
    const said = win.App.helpers.place().n;
    assert.strictEqual(said, want.ar || want.la, 'the nearest place in the file names it');
    assert.ok(said.indexOf(QURB) === -1, 'never near anything, got ' + said);
    assert.strictEqual(shownPlace(doc), said, 'and the home card says so');
    assert.strictEqual(win.localStorage.getItem('sunnati.greet'), said, 'and the opening greets by it next time');
  }
  /* the three, as they are called */
  assert.deepStrictEqual(points.map(function (p) { return win.App.helpers.nameForPlace(p.at[0], p.at[1]).n; }),
    ['الجهراء', 'الوفرة', 'الحي']);
  assert.ok(doc.getElementById('place-line').textContent.indexOf(QURB) === -1);
});

test('inside Kuwait the reader is told the area they are in, not the country', async () => {
  const { win, doc } = boot();
  const areas = [
    [29.334, 48.076, 'السالمية'],
    [29.3328, 48.0286, 'حولي'],
    [29.337, 47.658, 'الجهراء'],
    [29.2775, 47.9586, 'الفروانية'],
    [29.0825, 48.13, 'الفحيحيل'],
    [29.257, 48.057, 'صباح السالم'],
    [29.336, 47.957, 'كيفان'],
    [29.322, 48.024, 'الجابرية']
  ];
  for (const [lat, lng, name] of areas) {
    await fixAt(win, lat, lng);
    assert.strictEqual(win.App.helpers.place().n, name);
    assert.strictEqual(shownPlace(doc), name);
    assert.strictEqual(win.Store.get('city'), name, 'kept for the next opening');
    assert.strictEqual(win.Store.get('method'), 'Ojeiri', 'and reckoned by Kuwait\'s own table, which belongs to the country');
    assert.strictEqual(win.Store.get('zone'), 'Asia/Kuwait');
  }
  /* the toast says the area too, once the name has come */
  win.navigator.geolocation = { getCurrentPosition: function (ok) { ok({ coords: { latitude: 29.334, longitude: 48.076 } }); } };
  win.App.actions.locate();
  await until(function () { return doc.getElementById('toast').textContent.indexOf('ضُبطت المواقيت على السالمية') !== -1; });
});

test('in Riyadh the reader is told the quarter, and north Riyadh is no longer the next town', async () => {
  const { win } = boot();
  await fixAt(win, 24.80, 46.66);
  assert.strictEqual(win.App.helpers.place().n, 'الربيع', 'Ar Rabi, a quarter of north Riyadh, where الدرعية was said');
  assert.strictEqual(win.Store.get('method'), 'Makkah', 'and Riyadh\'s reckoning');
  const en = boot({ languages: ['en-US'], file: 'en' });
  await fixAt(en.win, 24.80, 46.66);
  assert.strictEqual(shownPlace(en.doc), "Ar Rabi'");
});

test('the gazetteer is fetched only to name a place, as one file that says nothing of where the reader is', async () => {
  const { win } = boot();
  await new Promise(function (r) { setTimeout(r, 20); });
  assert.ok(!win.__asked.some(function (u) { return u.indexOf('places') !== -1; }), 'not asked for until a place needs a name');
  await fixAt(win, 29.334, 48.076);
  const asked = win.__asked.filter(function (u) { return u.indexOf('places') !== -1; });
  assert.deepStrictEqual(asked, ['data/places.json'], 'the same address for every reader, with nothing of the fix in it');
  await fixAt(win, 24.7136, 46.6753);
  assert.strictEqual(win.__asked.filter(function (u) { return u.indexOf('places') !== -1; }).length, 1, 'read once, then kept');
  const quarter = nearestInFile(24.7136, 46.6753).place.ar;
  assert.strictEqual(win.App.helpers.place().n, quarter, 'the quarter of Riyadh it is in');
  assert.strictEqual(win.Store.get('method'), 'Makkah', 'Riyadh still reckons by Umm al-Qura');

  /* the next opening, a few steps away, keeps the name it has without reading the file */
  const next = boot({ storage: { 'sunnati.settings': win.localStorage.getItem('sunnati.settings') } });
  await fixAt(next.win, 24.7140, 46.6760);
  assert.strictEqual(next.win.App.helpers.place().n, quarter);
  assert.ok(!next.win.__asked.some(function (u) { return u.indexOf('places') !== -1; }), 'nothing fetched to say the same name again');
});

test('offline on the very first fix a listed city names a place within 25 km, and coordinates anywhere else, never near', async () => {
  const { win } = boot({ offline: true });
  await fixAt(win, 29.334, 48.076);
  assert.strictEqual(win.App.helpers.place().n, 'الكويت', 'the listed city it is within 25 km of');
  await fixAt(win, 28.645, 47.935);
  const label = win.App.helpers.coordsLabel(28.645, 47.935);
  assert.strictEqual(win.App.helpers.place().n, label, '82 km out it is given by its coordinates');
  assert.ok(label.indexOf(QURB) === -1);
  /* and named properly once the file can be had */
  win.__offline = false;
  await fixAt(win, 28.645, 47.935);
  assert.strictEqual(win.App.helpers.place().n, 'الوفرة');
});

test('the name is written in the reader\'s language: Latin in English, Cyrillic in Russian, the Persian letters in Persian', async () => {
  const en = boot({ languages: ['en-US'], file: 'en' });
  await fixAt(en.win, 29.334, 48.076);
  assert.strictEqual(en.win.App.helpers.place().n, 'السالمية', 'the place keeps its Arabic name');
  assert.strictEqual(shownPlace(en.doc), 'Salmiya', 'and English shows the name in English');
  assert.strictEqual(en.win.I18n.tx('ضُبطت المواقيت على السالمية'), 'Prayer times set for Salmiya', 'in every line that names it');
  assert.deepStrictEqual(plainCopy(en.win.Store.get('cityNames')), { la: 'Salmiya', ru: 'Сальмия' }, 'kept with the place');
  await fixAt(en.win, 29.337, 47.658);
  assert.strictEqual(shownPlace(en.doc), 'Al Jahra', 'the English name GeoNames gives, not its letter by letter Al Jahra\'');
  await fixAt(en.win, 29.336, 47.957);
  assert.strictEqual(shownPlace(en.doc), 'Kaifan');

  const ru = boot({ languages: ['ru-RU'], file: 'ru' });
  await fixAt(ru.win, 29.334, 48.076);
  assert.strictEqual(shownPlace(ru.doc), 'Сальмия');
  await fixAt(ru.win, 29.0825, 48.13);
  assert.strictEqual(shownPlace(ru.doc), 'Fahaheel', 'a place with no Cyrillic name is given its Latin one');

  const fa = boot({ languages: ['fa-IR'], file: 'fa' });
  await fixAt(fa.win, 29.334, 48.076);
  assert.strictEqual(shownPlace(fa.doc), 'السالمیة', 'the Arabic name in Persian letters');

  const bn = boot({ languages: ['bn-BD'], file: 'bn' });
  await fixAt(bn.win, 29.337, 47.658);
  assert.strictEqual(shownPlace(bn.doc), 'আল জাহরা');

  /* a place GeoNames names in no Arabic is shown in Latin on the Arabic page,
     and still in Cyrillic to a Russian reader */
  const lone = GAZ.find(function (p) {
    return !p.ar && p.ru && /^[A-Za-z ]+$/.test(p.la) && GAZ.every(function (q) { return q === p || km(p.lat, p.lng, q.lat, q.lng) > 5; });
  });
  assert.ok(lone, 'there is such a place');
  await fixAt(ru.win, lone.lat, lone.lng);
  assert.strictEqual(ru.win.App.helpers.place().n, lone.la);
  assert.strictEqual(shownPlace(ru.doc), lone.ru);
  const ar = boot();
  await fixAt(ar.win, lone.lat, lone.lng);
  assert.strictEqual(shownPlace(ar.doc), lone.la);
});

test('the name keeps its language after a restart, and a name the table holds is never taken from it', async () => {
  const first = boot({ languages: ['en-US'], file: 'en' });
  await fixAt(first.win, 29.337, 47.658);
  const again = boot({ storage: { 'sunnati.settings': first.win.localStorage.getItem('sunnati.settings'), 'sunnati.lang': 'en' }, file: 'en' });
  assert.strictEqual(again.win.I18n.lang, 'en');
  await tick();
  assert.strictEqual(shownPlace(again.doc), 'Al Jahra', 'named in English from the moment the app opens');
  assert.ok(!again.win.__asked.some(function (u) { return u.indexOf('places') !== -1; }), 'from what was kept, without the file');

  /* a town that shares its name with a prayer does not rename the prayer */
  again.win.App.helpers.setPlace({ n: 'المغرب', names: { la: 'Al Maghrib' }, lat: 30, lng: 31, tz: 2, z: 'Africa/Cairo' }, true);
  assert.strictEqual(again.win.I18n.tx('المغرب'), 'Maghrib');
  /* nor does a listed city lose the word the table gives it */
  again.win.App.helpers.setPlace({ n: 'مكة المكرمة', names: { la: 'Mecca' }, lat: 21.42, lng: 39.83, tz: 3, z: 'Asia/Riyadh' }, true);
  await tick();
  assert.strictEqual(shownPlace(again.doc), 'Makkah');

  /* The gazetteer itself keeps clear of the app's words: the city of the
     Prophet is المدينة المنورة, not المدينة, which the tables read as City,
     and a town whose only name is a word of the app, الشروق, carries a mark
     nobody sees, so it is El Shorouk to an English reader while the sunrise
     stays the sunrise */
  await fixAt(again.win, 24.4686, 39.6142);
  assert.strictEqual(again.win.App.helpers.place().n, 'المدينة المنورة');
  assert.strictEqual(shownPlace(again.doc), 'Madinah');
  const unseen = String.fromCharCode(0x200C);
  const shorouk = GAZ.find(function (p) { return p.la === 'El Shorouk'; });
  assert.strictEqual(shorouk.ar, 'الشروق' + unseen);
  await fixAt(again.win, shorouk.lat, shorouk.lng);
  assert.strictEqual(shownPlace(again.doc), 'El Shorouk');
  assert.strictEqual(again.win.I18n.tx('الشروق'), 'Sunrise');
  const arabic = boot();
  await fixAt(arabic.win, shorouk.lat, shorouk.lng);
  assert.strictEqual(shownPlace(arabic.doc).replace(unseen, ''), 'الشروق', 'and the Arabic page shows the name as it is written');
});

/* ---------------- the names the older code gave ---------------- */

test('a place stored as near a city is named again from its coordinates at the start', async () => {
  const settings = { lat: 29.3375, lng: 47.65806, city: 'قرب الكويت', placeFrom: 'fix', tzOffset: 3, zone: 'Asia/Kuwait', method: 'Ojeiri', methodFrom: 'hand' };
  const { win, doc } = boot({ storage: { 'sunnati.settings': JSON.stringify(settings) } });
  await until(function () { return win.App.helpers.place().n === 'الجهراء'; });
  assert.strictEqual(win.Store.get('city'), 'الجهراء');
  assert.deepStrictEqual(plainCopy(win.Store.get('cityNames')), { la: 'Al Jahra', ru: 'Эль-Джахра', bn: 'আল জাহরা' });
  assert.strictEqual(win.Store.get('method'), 'Ojeiri', 'only the name changes, not the reckoning the reader chose');
  assert.strictEqual(win.Store.get('lat'), 29.3375, 'nor where the place is');
  assert.strictEqual(shownPlace(doc), 'الجهراء');
  assert.strictEqual(win.localStorage.getItem('sunnati.greet'), 'الجهراء');

  /* with no network at the start it loses the near at once, and is given its coordinates */
  const offline = boot({ offline: true, storage: { 'sunnati.settings': JSON.stringify(settings) } });
  assert.strictEqual(offline.win.App.helpers.place().n, offline.win.App.helpers.coordsLabel(29.3375, 47.65806));
  assert.ok(shownPlace(offline.doc).indexOf(QURB) === -1);

  /* a place the older code named after the city it was in is named again too */
  const old = { lat: 29.334, lng: 48.076, city: 'الكويت', placeFrom: 'fix', tzOffset: 3, zone: 'Asia/Kuwait', method: 'Ojeiri' };
  const kw = boot({ storage: { 'sunnati.settings': JSON.stringify(old) } });
  await until(function () { return kw.win.App.helpers.place().n === 'السالمية'; });

  /* while a city the reader picked by hand is theirs, and the file is not even fetched */
  const picked = Object.assign({}, old, { lat: 29.3759, lng: 47.9774, placeFrom: 'pick' });
  const hand = boot({ storage: { 'sunnati.settings': JSON.stringify(picked) } });
  await new Promise(function (r) { setTimeout(r, 30); });
  assert.strictEqual(hand.win.App.helpers.place().n, 'الكويت');
  assert.ok(!hand.win.__asked.some(function (u) { return u.indexOf('places') !== -1; }));
});

/* ---------------- the worker and the credit ---------------- */

test('the worker keeps the gazetteer once it is fetched, never in the shell, and carries it across updates', async () => {
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  const shell = /var SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
  assert.ok(shell.indexOf('places') === -1, 'not every reader carries the names of the world');
  const carry = /function carryOver\(cache\) \{([\s\S]*?)\n\}/.exec(sw)[1];
  assert.ok(/\|places\)\\\.json\$/.test(carry), 'an update moves the kept copy across as it is');

  /* asked for once with the network, then answered without it */
  const kept = new Map();
  const listeners = {};
  const net = { online: true, asked: 0 };
  const ctx = {
    location: new URL('https://sunnati.3li.info/sw.js'),
    caches: {
      open: () => Promise.resolve({ put: (r, res) => { kept.set(String(r.url || r), res); return Promise.resolve(); }, match: () => Promise.resolve(undefined), keys: () => Promise.resolve([]) }),
      match: (r) => { const hit = kept.get(String(r.url || r)); return Promise.resolve(hit ? hit.clone() : undefined); },
      keys: () => Promise.resolve([]), delete: () => Promise.resolve(true)
    },
    fetch: () => {
      net.asked++;
      if (!net.online) return Promise.reject(new TypeError('offline'));
      const res = new Response('{"lat":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
      Object.defineProperty(res, 'type', { value: 'basic' });
      return Promise.resolve(res);
    },
    Request, Response, Headers, URL, Promise, console, setTimeout
  };
  ctx.self = { addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {},
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) }, location: ctx.location,
    registration: { showNotification: () => Promise.resolve() } };
  vm.createContext(ctx);
  vm.runInContext(sw, ctx, { filename: 'sw.js' });
  const ask = function (url) {
    let answer = null;
    listeners.fetch({ request: new Request(url), respondWith: (p) => { answer = Promise.resolve(p); } });
    return answer;
  };
  const url = 'https://sunnati.3li.info/data/places.json';
  assert.strictEqual((await ask(url)).status, 200);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(kept.has(url), 'kept the first time');
  net.online = false;
  const again = await ask(url);
  assert.strictEqual(again.status, 200, 'and answered offline');
  assert.strictEqual(net.asked, 1, 'from the kept copy');
});

test('the sources credit GeoNames for the names of the places, in every language', () => {
  const sources = /<h2>المصادر<\/h2><\/div>([\s\S]*?)<\/div>/.exec(HTML)[1];
  assert.ok(sources.indexOf('<p class="setting-note">أسماء الأماكن من <a href="https://www.geonames.org/">GeoNames</a></p>') !== -1);
  ['en', 'id', 'ms', 'fr', 'ha', 'tr', 'ru', 'bn', 'ur', 'fa'].forEach(function (lang) {
    const table = fs.readFileSync(path.join(DOCS, 'i18n', lang + '.js'), 'utf8');
    assert.ok(/"أسماء الأماكن من": "[^"]+"/.test(table), lang + ' says it');
    assert.ok(table.indexOf('"قرب {0}"') === -1, lang + ' has no near left to say');
  });
});
