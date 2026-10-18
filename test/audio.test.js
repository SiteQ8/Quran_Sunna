/* The sounds of the app: the adhan and its voices, the clips and the
   recitations, the radio, a surah kept for hearing offline, the worker that
   answers them, and what the two wrappers are handed. Boots docs/index.html in
   jsdom the way test/interface.test.js does, with the audio and the speech of
   the page recorded instead of played. */
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

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
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

const opened = [];
const { afterEach } = require('node:test');
afterEach(function () {
  while (opened.length) {
    const dom = opened.pop();
    try { dom.window.close(); } catch (e) { /* already gone */ }
  }
});

/* The page reads the wall clock, and its tick raises the prayer of the moment
   once notifications are granted. A run in the twenty minutes after any adhan
   at the default place heard that adhan raised over what the test played, so
   two tests failed five times a day and passed the rest. The page keeps
   today's date and its clock still runs, but its hour is set at ten in the
   morning, far from every prayer in Kuwait in any season, whether the times
   are read in the phone's zone or the place's. */
function steadyClock(win) {
  const Real = win.Date;
  const start = Real.now();
  const ten = new Real(start);
  ten.setHours(10, 0, 0, 0);
  const shift = ten.getTime() - start;
  function Clock(...args) {
    if (!new.target) return new Real(Real.now() + shift).toString();
    return args.length ? new Real(...args) : new Real(Real.now() + shift);
  }
  Clock.now = function () { return Real.now() + shift; };
  Clock.parse = Real.parse;
  Clock.UTC = Real.UTC;
  Clock.prototype = Real.prototype;
  win.Date = Clock;
}

/* Every Audio the page makes is kept in `heard`, and its play() is refused when
   it has no source, as a browser refuses it. Every oscillator the page starts
   is counted in `tones`, which is how a chime shows itself here. */
function boot(options) {
  const opts = options || {};
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://sunnati.3li.info/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const heard = [];
  const tones = { count: 0 };
  Object.defineProperty(win, 'localStorage', { value: opts.storage || memoryStorage(), configurable: true });
  win.matchMedia = function () { return { matches: false, addEventListener() {}, removeEventListener() {} }; };
  win.fetch = opts.fetch || function (url) {
    if (String(url).indexOf('mushaf.json') !== -1) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mushafPayload) });
    }
    return Promise.reject(new Error('offline in tests'));
  };
  win.Audio = function () {
    const clip = {
      src: '', paused: true, currentTime: 0, preload: '',
      play: function () {
        if (clip.hold) return clip.hold;
        if (!clip.src) return Promise.reject(new Error('NotSupportedError'));
        clip.paused = false;
        return Promise.resolve();
      },
      pause: function () { clip.paused = true; },
      removeAttribute: function (name) { if (name === 'src') clip.src = ''; },
      load: function () {}
    };
    /* a play the test wants left pending, armed before the clip is made */
    if (win.__holdNext) { clip.hold = win.__holdNext; win.__holdNext = null; }
    heard.push(clip);
    return clip;
  };
  win.AudioContext = function () {
    return {
      currentTime: 0, destination: {},
      createOscillator: function () { tones.count++; return { type: '', frequency: {}, connect: function (g) { return g; }, start: function () {}, stop: function () {} }; },
      createGain: function () { return { gain: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function (d) { return d; } }; },
      close: function () {}
    };
  };
  const session = { metadata: null, playbackState: 'none', setActionHandler: function () {} };
  Object.defineProperty(win.navigator, 'mediaSession', { value: session, configurable: true });
  win.MediaMetadata = function (m) { Object.assign(this, m); };
  if (opts.offline) Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
  if (opts.notifications) {
    const N = function (title, o) { (N.raised = N.raised || []).push({ title: title, body: o && o.body }); };
    N.permission = 'granted';
    N.requestPermission = function () { return Promise.resolve('granted'); };
    win.Notification = N;
  }
  win.navigator.vibrate = function () { return true; };
  win.scrollTo = function () {};
  if (opts.bridge) win.SunnatiApp = opts.bridge;
  steadyClock(win);
  SCRIPTS.forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, rel), 'utf8'), dom.getInternalVMContext(), { filename: rel });
  });
  win.Mushaf.init(mushafPayload);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  opened.push(dom);
  return { dom, win, doc: win.document, heard, tones, session };
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

const tick = () => new Promise((r) => setTimeout(r, 20));
const playing = (heard) => heard.filter((c) => !c.paused).map((c) => c.src);

/* The length an mp3 declares in its Info frame, which the encoder writes with
   the number of frames, so the file is read and not guessed from its size. */
function mp3Seconds(file) {
  const b = fs.readFileSync(file);
  let i = 0;
  if (b.slice(0, 3).toString('latin1') === 'ID3') {
    i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + ((b[5] & 0x10) ? 10 : 0);
  }
  while (i < b.length - 4 && !(b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0)) i++;
  const version = (b[i + 1] >> 3) & 3;
  const rate = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[version][(b[i + 2] >> 2) & 3];
  const head = b.slice(i, i + 200);
  let at = head.indexOf('Xing');
  if (at < 0) at = head.indexOf('Info');
  assert.ok(at > 0, path.basename(file) + ' carries no Info frame');
  assert.ok(head.readUInt32BE(at + 4) & 1, path.basename(file) + ' does not count its frames');
  return head.readUInt32BE(at + 8) * (version === 3 ? 1152 : 576) / rate;
}

/* The codec and the length a CAF file declares: iOS plays a notification sound
   only in a codec it knows and only when it is under thirty seconds. */
function cafInfo(file) {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.slice(0, 4).toString('latin1'), 'caff', path.basename(file) + ' is not a CAF file');
  let i = 8;
  let desc = null;
  let data = null;
  while (i + 12 <= b.length) {
    const type = b.slice(i, i + 4).toString('latin1');
    const size = Number(b.readBigInt64BE(i + 4));
    const body = i + 12;
    if (type === 'desc') {
      desc = { rate: b.readDoubleBE(body), format: b.slice(body + 8, body + 12).toString('latin1'),
        bytesPerPacket: b.readUInt32BE(body + 16), framesPerPacket: b.readUInt32BE(body + 20) };
    }
    if (type === 'data') data = (size < 0 ? b.length - body : size) - 4;
    if (size < 0) break;
    i = body + size;
  }
  return { format: desc.format, seconds: data / desc.bytesPerPacket * desc.framesPerPacket / desc.rate };
}

function fakeCaches(win, full) {
  const stores = {};
  let puts = 0;
  win.caches = {
    open: function (name) {
      if (!stores[name]) stores[name] = new Map();
      const m = stores[name];
      return Promise.resolve({
        match: function (u) { return Promise.resolve(m.get(String(u)) || undefined); },
        put: function (u, r) {
          puts++;
          if (full && puts >= full) {
            const e = new Error('the quota has been exceeded');
            e.name = 'QuotaExceededError';
            return Promise.reject(e);
          }
          m.set(String(u), r);
          return Promise.resolve();
        },
        delete: function (u) { return Promise.resolve(m.delete(String(u))); },
        keys: function () { return Promise.resolve([...m.keys()].map((u) => ({ url: u }))); }
      });
    },
    keys: function () { return Promise.resolve(Object.keys(stores)); }
  };
  return stores;
}

/* ---------------- the adhan ---------------- */

test('each adhan recording is named for what it is, and the first fajr is al-Mujallad\'s own', () => {
  const { win } = boot();
  /* spread, since an array from the page's realm is not reference-equal to one made here */
  const voices = [...win.ADHAN_VOICES].map((v) => v.id);
  assert.deepStrictEqual(voices, ['assaf', 'jazi', 'mujallad', 'bilal']);
  /* the voice listed as حاج سليمان مختار was a recording of al-Mujallad */
  assert.ok(voices.indexOf('mukhtar') === -1);
  const files = fs.readdirSync(path.join(DOCS, 'audio', 'adhan')).sort();
  assert.deepStrictEqual(files, ['assaf.mp3', 'bilal-fajr.mp3', 'jazi.mp3', 'mujallad-fajr.mp3', 'mujallad.mp3'],
    'every recording is named for what it is, and nothing else lies there');
  assert.strictEqual(win.ADHAN_VOICES.filter((v) => v.fajr)[0].id, 'mujallad',
    'the fajr that stands in for a voice with none is al-Mujallad\'s real fajr');

  const at = (f) => mp3Seconds(path.join(DOCS, 'audio', 'adhan', f));
  /* one performance: the fajr is the ordinary adhan with its two phrases more */
  const extra = at('mujallad-fajr.mp3') - at('mujallad.mp3');
  assert.ok(extra > 20 && extra < 30, 'the fajr runs the two phrases longer, found ' + extra.toFixed(1) + ' s');
  win.ADHAN_VOICES.forEach(function (v) {
    const own = v.plain || !v.fajr ? v.id + '.mp3' : v.id + '-fajr.mp3';
    assert.ok(Math.abs(at(own) - v.s) < 1.5, v.id + ' says ' + v.s + ' s and runs ' + at(own).toFixed(1));
  });
});

test('every prayer is given the right recording, and the preview plays the muadhin\'s own', () => {
  const { win, doc, heard } = boot();
  const url = win.App.helpers.adhanUrl;
  assert.strictEqual(url('assaf', false), 'audio/adhan/assaf.mp3');
  assert.strictEqual(url('assaf', true), 'audio/adhan/mujallad-fajr.mp3', 'a voice with no fajr borrows the first fajr');
  assert.strictEqual(url('mujallad', false), 'audio/adhan/mujallad.mp3', 'al-Mujallad in his own ordinary adhan');
  assert.strictEqual(url('mujallad', true), 'audio/adhan/mujallad-fajr.mp3');
  assert.strictEqual(url('bilal', true), 'audio/adhan/bilal-fajr.mp3');
  assert.strictEqual(url('bilal', false), 'audio/adhan/assaf.mp3',
    'a fajr recording is never heard at the other prayers');

  win.App.go('settings');
  const sel = doc.getElementById('settings-adhan-voice');
  const label = (v) => [...sel.options].filter((o) => o.value === v)[0].text;
  assert.strictEqual(label('mujallad'), 'أحمد نواف المجلاد', 'he has both, so he is not marked as fajr alone');
  assert.ok(label('bilal').indexOf('أذان الفجر') !== -1, 'a fajr alone says so');

  sel.value = 'bilal'; fire(win, sel, 'change');
  assert.deepStrictEqual(playing(heard), ['audio/adhan/bilal-fajr.mp3'], 'his own recording, not another voice');
  win.App.helpers.stopSpeaking();
  sel.value = 'mujallad'; fire(win, sel, 'change');
  assert.deepStrictEqual(playing(heard), ['audio/adhan/mujallad.mp3']);
});

test('a reader who chose the voice that was really al-Mujallad is carried to him', () => {
  const storage = memoryStorage();
  storage.setItem('sunnati.settings', JSON.stringify({ adhanVoice: 'mukhtar' }));
  const given = [];
  const { win, doc } = boot({ storage: storage, bridge: { setAdhanSound: function (a, b) { given.push([a, b]); } } });
  assert.strictEqual(win.Store.get('adhanVoice'), 'mujallad');
  win.App.go('settings');
  assert.strictEqual(doc.getElementById('settings-adhan-voice').value, 'mujallad');
  assert.ok(given.length, 'the wrapper is handed the adhan at the opening, not only in the settings');
  assert.deepStrictEqual(given[given.length - 1], ['https://sunnati.3li.info/audio/adhan/mujallad.mp3',
    'https://sunnati.3li.info/audio/adhan/mujallad-fajr.mp3']);
});

test('the adhan sounds at the five prayers alone, on its own, and silence is silence', async () => {
  const at = async function (voice, key) {
    const { win, heard, tones } = boot({ notifications: true });
    win.Store.set('notify', true);
    win.Store.set('adhanVoice', voice);
    win.Store.set('notified', {});
    heard.length = 0; tones.count = 0;
    win.App.helpers.maybeNotify({ prev: { key: key, at: 599 }, now: 600 });
    await tick();
    return { sounds: heard.map((c) => c.src), tones: tones.count, raised: (win.Notification.raised || []).length };
  };
  const dhuhr = await at('assaf', 'dhuhr');
  assert.deepStrictEqual(dhuhr.sounds, ['audio/adhan/assaf.mp3']);
  assert.strictEqual(dhuhr.tones, 0, 'nothing chimes over the adhan');
  assert.deepStrictEqual((await at('assaf', 'fajr')).sounds, ['audio/adhan/mujallad-fajr.mp3']);
  const sunrise = await at('assaf', 'sunrise');
  assert.deepStrictEqual(sunrise.sounds, [], 'no adhan at the sunrise');
  assert.strictEqual(sunrise.raised, 1, 'though the sunrise is still told');
  const silent = await at('silent', 'dhuhr');
  assert.deepStrictEqual(silent.sounds, [], 'silence plays no recording');
  assert.strictEqual(silent.tones, 0, 'and no chime, where it used to chime twice');
  const tone = await at('none', 'dhuhr');
  assert.deepStrictEqual(tone.sounds, []);
  assert.ok(tone.tones > 0, 'the phone\'s tone is answered with the app\'s chime, as before');
});

test('the wrappers are told of silence even when they fetch no recording', () => {
  /* the iPhone package declares no setAdhanSound, and the call used to stop
     there, before silence was ever told */
  const told = [];
  const ios = {
    platform: function () { return 'ios'; }, canNotify: function () { return true; },
    setAdhanSilent: function (v) { told.push(['silent', v]); },
    setAdhanSound: function (a, b) { told.push(['sound', a, b]); },
    setPrayerTimes: function () {}, setReminders: function () {}, setQiyamTimes: function () {}, setQiyamSound: function () {}
  };
  const { win, doc } = boot({ bridge: ios });
  win.App.go('settings');
  const sel = doc.getElementById('settings-adhan-voice');
  told.length = 0;
  sel.value = 'silent'; fire(win, sel, 'change');
  assert.deepStrictEqual(told.filter((t) => t[0] === 'silent').pop(), ['silent', true]);
  assert.deepStrictEqual(told.filter((t) => t[0] === 'sound').pop(), ['sound', '', '']);
  delete ios.setAdhanSound;
  told.length = 0;
  sel.value = 'jazi'; fire(win, sel, 'change');
  assert.deepStrictEqual(told, [['silent', false]], 'a wrapper with no recordings still hears it');
});

/* ---------------- one sound at a time, named for what it is ---------------- */

test('one sound at a time: a clip and a recitation never sound together', async () => {
  const { win, heard, tones } = boot();
  win.Store.set('reciter', 'ar.minshawi');
  win.App.helpers.playVerse(1, 1);
  assert.deepStrictEqual(playing(heard), ['https://cdn.islamic.network/quran/audio/128/ar.minshawi/1.mp3']);
  win.Store.set('voice', 'recording');
  win.App.helpers.speak('اللهم صلِّ وسلِّم على نبينا محمد', 'try');
  await tick();
  assert.deepStrictEqual(playing(heard), ['audio/salawat/buhendi.mp3'], 'the recitation gave way to the clip');
  assert.strictEqual(win.App.state.audio, null);
  win.App.helpers.playVerse(1, 2);
  await tick();
  assert.deepStrictEqual(playing(heard), ['https://cdn.islamic.network/quran/audio/128/ar.minshawi/2.mp3'],
    'and the clip gives way to the recitation');
  assert.strictEqual(win.App.state.voiceClip, null);
  assert.strictEqual(tones.count, 0);

  /* a clip that gave way before it began is refused as it stops: that is no
     failure, and it must neither ring the chime nor clear the clip after it */
  win.App.helpers.stopAudio();
  let refuse;
  win.__holdNext = new Promise(function (ok, no) { refuse = no; });
  win.App.helpers.speak('اللهم صلِّ وسلِّم على نبينا محمد', 'try');
  win.App.go('settings');
  const sel = win.document.getElementById('settings-adhan-voice');
  sel.value = 'jazi'; fire(win, sel, 'change');
  refuse(new Error('AbortError'));
  await tick();
  assert.strictEqual(tones.count, 0, 'no chime from the clip that gave way');
  assert.ok(win.App.state.voiceClip && win.App.state.voiceClip.src === 'audio/adhan/jazi.mp3', 'and the new clip is still the one playing');
});

test('the salawat reminder does not cut off what is already sounding', async () => {
  const { win, heard } = boot({ notifications: true });
  win.Store.set('salawat', 30);
  win.Store.set('salawatAt', 0);
  win.App.helpers.playVerse(2, 255);
  const n = heard.length;
  win.App.helpers.maybeSalawat(true);
  await tick();
  assert.strictEqual(heard.length, n, 'the notice comes, and the voice waits');
  assert.strictEqual(win.Notification.raised.length, 1);
});

test('the phone\'s player names the voice heard, not one name for every clip', async () => {
  const shade = [];
  const { win, doc, session } = boot({ bridge: { showSounding: function (t, s) { shade.push([t, s]); }, setSounding: function () {} } });
  win.App.go('settings');
  const sel = doc.getElementById('settings-adhan-voice');
  sel.value = 'bilal'; fire(win, sel, 'change');
  assert.strictEqual(session.metadata.artist, 'بصوت بلال محمود');
  assert.deepStrictEqual(shade[shade.length - 1], ['الأذان، بلال محمود', 'بصوت بلال محمود']);

  win.App.helpers.stopSpeaking();
  win.Store.set('salawatVoice', 'ibrahimiyya');
  win.App.helpers.speak('اللهم صلِّ وسلِّم على نبينا محمد', 'try');
  assert.strictEqual(session.metadata.artist, 'من تسجيلات حصن المسلم');

  win.App.helpers.stopSpeaking();
  win.Store.set('salawatVoice', 'buhendi');
  win.App.helpers.speak('اللهم صلِّ وسلِّم على نبينا محمد', 'try');
  assert.strictEqual(session.metadata.artist, 'بصوت خالد بوهندي');

  /* at the fajr a voice with no fajr is heard in another's, and that one is named */
  win.App.helpers.stopSpeaking();
  win.Store.set('adhanVoice', 'jazi');
  win.App.helpers.soundAdhan('fajr');
  assert.strictEqual(session.metadata.title, 'أذان الفجر');
  assert.strictEqual(session.metadata.artist, 'بصوت أحمد نواف المجلاد');
});

test('the adhan preview and the hear buttons ring no notification beside the clip', () => {
  const asked = [];
  const { win, doc } = boot({ bridge: { notify: function (t) { asked.push(t); }, setSounding: function () {}, showSounding: function () {} } });
  win.App.go('settings');
  win.Store.set('adhanVoice', 'assaf');
  click(win, doc.getElementById('settings-adhan-try'));
  win.App.helpers.stopSpeaking();
  win.App.state.hisn = 32; win.App.go('hisn');
  click(win, doc.querySelector('[data-act="hear-hisn"]'));
  assert.deepStrictEqual(asked, [], 'inside the package each one rang the phone\'s tone over the clip');
});

test('a reminder in the reciter\'s voice rings the quiet chime, and the recitation is heard when opened', () => {
  const { win, heard } = boot();
  win.Store.set('sleepKursi', true);
  win.Store.set('remindSound', Object.assign({}, win.Store.get('remindSound'), { sleepKursi: 'buhendi' }));
  const row = win.App.helpers.reminderList().filter((r) => r.k === 'sleepKursi')[0];
  assert.strictEqual(row.s, 'chime', 'never silent, which is what it was');
  win.App.helpers.cameFrom('sleepKursi');
  assert.deepStrictEqual(playing(heard), ['audio/dua/kursi-buhendi.mp3']);
  win.Store.set('remindSound', Object.assign({}, win.Store.get('remindSound'), { sleepKursi: 'chime' }));
  win.App.helpers.stopSpeaking();
  win.App.helpers.cameFrom('sleepKursi');
  assert.deepStrictEqual(playing(heard), [], 'only when the reciter was the choice');
});

/* ---------------- the radio and the whole surahs ---------------- */

/* The owner's word: nothing of Mishary Alafasy, ever, in any form. Not a
   station, not a reciter, not a recording, not his name, in the app, its
   packages or its store pages; and no station that mixes reciters, since no
   one can say who is heard on it. */
test('nothing of Mishary Alafasy is anywhere in the app', () => {
  const ROOT = path.join(__dirname, '..');
  const BANNED = /alafas|afasy|afasi|العفاسي|العفاسى/i;
  const found = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      if (['node_modules', '.git', 'build', '.gradle', '.cxx'].indexOf(e.name) !== -1) return;
      const p = path.join(dir, e.name);
      if (BANNED.test(e.name)) found.push(path.relative(ROOT, p));
      if (e.isDirectory()) { walk(p); return; }
      if (!/\.(js|mjs|json|html|css|txt|xml|swift|java|kt|yml|plist|md|webmanifest|strings|py)$/.test(e.name)) return;
      if (BANNED.test(fs.readFileSync(p, 'utf8'))) found.push(path.relative(ROOT, p));
    });
  })(ROOT);
  assert.deepStrictEqual(found.filter((f) => !/^test\//.test(f)), []);
  const { win } = boot();
  assert.ok(![...win.RADIO_STATIONS].some((s) => /tarateel/.test(s.url)), 'a station of many reciters');
});

test('the stations are the addresses the radio list gives today', () => {
  const { win } = boot();
  assert.deepStrictEqual([...win.RADIO_STATIONS].map((s) => s.url), [
    'https://backup.qurango.net/radio/abdulrahman_alsudaes',
    'https://backup.qurango.net/radio/abdulbasit_abdulsamad',
    'https://backup.qurango.net/radio/maher',
    'https://backup.qurango.net/radio/saud_alshuraim',
    'https://backup.qurango.net/radio/ahmad_alajmy',
    'https://backup.qurango.net/radio/yasser_aldosari',
    'https://backup.qurango.net/radio/hazza'
  ]);
});

test('a whole surah comes straight from the source\'s own address, with no redirect between', () => {
  const { win } = boot();
  const expected = {
    'ar.mahermuaiqly': 'maher-muaiqly/r1', 'ar.minshawi': 'muhammad-minshawi/r1', 'ar.husary': 'mahmoud-husary/r1',
    'ar.abdurrahmaansudais': 'abdulrahman-sudais/r1', 'ar.ahmedajamy': 'ahmad-ajmi/r1', 'ar.shaatree': 'abubakr-shatri/r1',
    'ar.muhammadjibreel': 'muhammad-jibreel/r1', 'ar.abdulsamad': 'abdulbasit-abdulsamad/r3', 'ar.saoodshuraym': 'saud-shuraim/r1',
    'ar.hudhaify': 'ali-hudhaifi/r1', 'ar.muhammadayyoub': 'muhammad-ayyub/r1', 'ar.hanirifai': 'hani-rifai/r1',
    'ar.abdullahbasfar': 'abdullah-basfar/r1', 'ar.ibrahimakhbar': 'ibrahim-akhdar/r1', 'ar.husarymujawwad': 'mahmoud-husary/r2'
  };
  win.RECITERS.forEach(function (r) {
    win.Store.set('reciter', r.id);
    const at = win.App.helpers.surahAudioUrl(2);
    if (!expected[r.id]) { assert.strictEqual(at, null, r.id + ' has no whole recording and keeps the walk'); return; }
    assert.strictEqual(at, 'https://cdn.mp3quran.net/audio/' + expected[r.id] + '/002.mp3', r.id);
  });
});

test('a kept surah, or any surah with no network, is heard from its verses', () => {
  const { win, heard } = boot();
  win.Store.set('reciter', 'ar.minshawi');
  win.Store.set('listenAs', 'whole');
  win.App.helpers.playSurah(112);
  assert.deepStrictEqual(playing(heard), ['https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/112.mp3'], 'online, the whole recording');
  win.App.helpers.stopAudio();
  win.Store.set('audioSaved', { 'ar.minshawi': { 112: { v: 4, at: 1, k: 128 } } });
  win.App.state.ayah = 1;
  win.App.helpers.playSurah(112);
  assert.deepStrictEqual(playing(heard), [win.App.helpers.verseUrl(112, 1)], 'kept, it walks the kept verses');
  assert.ok(win.App.state.recite, 'verse by verse');
  win.App.helpers.stopAudio();
  win.App.helpers.playWholeSurah(112);
  assert.deepStrictEqual(playing(heard), [win.App.helpers.verseUrl(112, 1)], 'whichever way it is asked for');

  const off = boot({ offline: true });
  off.win.App.state.ayah = 1;
  off.win.Store.set('reciter', 'ar.minshawi');
  off.win.Store.set('listenAs', 'whole');
  off.win.App.helpers.playSurah(1);
  assert.deepStrictEqual(playing(off.heard), [off.win.App.helpers.verseUrl(1, 1)], 'and with no network at all');
});

/* ---------------- a surah kept for hearing offline ---------------- */

test('every reciter names his everyayah folder, in his own voice and style', () => {
  const { win } = boot();
  const ea = {};
  win.RECITERS.forEach((r) => { ea[r.id] = r.ea; });
  assert.deepStrictEqual(ea, {
    'ar.abdulsamad': 'AbdulSamad_64kbps_QuranExplorer.Com', 'ar.abdurrahmaansudais': 'Abdurrahmaan_As-Sudais_64kbps',
    'ar.mahermuaiqly': 'Maher_AlMuaiqly_64kbps', 'ar.saoodshuraym': 'Saood_ash-Shuraym_128kbps',
    'ar.husary': 'Husary_128kbps', 'ar.husarymujawwad': 'Husary_128kbps_Mujawwad',
    'ar.minshawi': 'Minshawy_Murattal_128kbps', 'ar.shaatree': 'Abu_Bakr_Ash-Shaatree_128kbps',
    'ar.ahmedajamy': 'Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net', 'ar.hudhaify': 'Hudhaify_128kbps',
    'ar.hanirifai': 'Hani_Rifai_64kbps', 'ar.ibrahimakhbar': 'Ibrahim_Akhdar_32kbps',
    'ar.muhammadayyoub': 'Muhammad_Ayyoub_64kbps', 'ar.muhammadjibreel': 'Muhammad_Jibreel_64kbps',
    'ar.abdullahbasfar': 'Abdullah_Basfar_64kbps', 'ar.aymanswoaid': 'Ayman_Sowaid_64kbps'
  });
});

test('a kept verse comes from everyayah, readable, and is kept under the address the player asks for', () => {
  const { win } = boot();
  const stores = fakeCaches(win);
  const asked = [];
  win.fetch = function (url, opts) {
    asked.push({ url: String(url), mode: opts && opts.mode });
    return Promise.resolve({ ok: true, status: 200, type: 'cors' });
  };
  win.Store.set('reciter', 'ar.minshawi');
  return win.App.helpers.downloadSurah(112).then(function (ok) {
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(asked.map((a) => a.url).sort(), ['001', '002', '003', '004'].map((a) =>
      'https://everyayah.com/data/Minshawy_Murattal_128kbps/112' + a + '.mp3'));
    assert.ok(asked.every((a) => a.mode === 'cors'), 'readable, so it is kept at its real size');
    assert.deepStrictEqual([...stores['sunnati-audio'].keys()].sort(),
      [1, 2, 3, 4].map((a) => win.App.helpers.verseUrl(112, a)).sort(), 'under the address the worker is asked for');
    assert.ok(win.App.helpers.isSurahSaved(112));
  });
});

test('when everyayah does not answer, the verse is kept opaque from the app\'s own source', () => {
  const { win } = boot();
  const stores = fakeCaches(win);
  const asked = [];
  win.fetch = function (url, opts) {
    asked.push({ url: String(url), mode: opts && opts.mode });
    if (String(url).indexOf('everyayah.com') !== -1) return Promise.reject(new TypeError('failed to fetch'));
    return Promise.resolve({ type: 'opaque', status: 0 });
  };
  win.Store.set('reciter', 'ar.abdulsamad');
  return win.App.helpers.downloadSurah(112).then(function (ok) {
    assert.strictEqual(ok, true);
    const fallback = asked.filter((a) => a.url.indexOf('cdn.islamic.network') !== -1);
    assert.strictEqual(fallback.length, 4);
    assert.ok(fallback.every((a) => a.mode === 'no-cors'));
    assert.strictEqual(stores['sunnati-audio'].size, 4);
  });
});

test('a phone out of room is told so, and keeps no part of the surah', () => {
  const { win, doc } = boot();
  const stores = fakeCaches(win, 3);
  win.fetch = function () { return Promise.resolve({ ok: true, status: 200, type: 'cors' }); };
  win.Store.set('reciter', 'ar.minshawi');
  return win.App.helpers.downloadSurah(112).then(function (ok) {
    assert.strictEqual(ok, false);
    assert.strictEqual(stores['sunnati-audio'].size, 0, 'what came is taken back');
    assert.ok(!win.App.helpers.isSurahSaved(112));
    const said = doc.getElementById('toast').textContent;
    assert.ok(said.indexOf('لا تتسع مساحة الحفظ') !== -1, 'the reader is told the truth, got ' + said);
    assert.ok(said.indexOf('الاتصال') === -1, 'not sent to check a connection that is fine');
  });
});

/* ---------------- the worker ---------------- */

function worker() {
  const listeners = {};
  const stores = {};
  const store = function (name) {
    if (!stores[name]) stores[name] = new Map();
    const m = stores[name];
    return {
      /* a cache hands out a fresh copy every time, as the real one does */
      match: (u) => { const r = m.get(String(u && u.url || u)); return Promise.resolve(r && r.clone ? r.clone() : r); },
      put: (u, r) => { m.set(String(u && u.url || u), r); return Promise.resolve(); },
      keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), add: () => Promise.resolve(), addAll: () => Promise.resolve()
    };
  };
  const net = { online: false, asked: [] };
  const ctx = {
    location: new URL('https://sunnati.3li.info/sw.js'),
    caches: {
      open: (name) => Promise.resolve(store(name)),
      match: (u) => {
        for (const name of Object.keys(stores)) {
          const hit = stores[name].get(String(u && u.url || u));
          if (hit) return Promise.resolve(hit.clone ? hit.clone() : hit);
        }
        return Promise.resolve(undefined);
      },
      keys: () => Promise.resolve(Object.keys(stores)), delete: () => Promise.resolve(true)
    },
    fetch: (r) => {
      net.asked.push(String(r && r.url || r));
      if (!net.online) return Promise.reject(new TypeError('offline'));
      /* the site's own answer, which a browser marks basic */
      const res = new Response(new Uint8Array(1000), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      Object.defineProperty(res, 'type', { value: 'basic' });
      return Promise.resolve(res);
    },
    Request, Response, Headers, URL, Promise, console, setTimeout
  };
  ctx.self = { addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {},
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) }, location: ctx.location,
    registration: { showNotification: () => Promise.resolve() } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
  const version = vm.runInContext('VERSION', ctx);
  const ask = function (url, range) {
    let answer = null;
    const headers = range ? { range: range } : {};
    listeners.fetch({ request: new Request(url, { headers: headers }), respondWith: (p) => { answer = Promise.resolve(p); } });
    return answer;
  };
  return { ask, store, net, version, stores };
}

test('the worker answers the app\'s own recordings with no network, and any piece asked for', async () => {
  const w = worker();
  const own = 'https://sunnati.3li.info/audio/salawat/buhendi.mp3';
  await w.store(w.version).put(own, new Response(new Uint8Array(1000).map((x, i) => i % 256), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
  const whole = await w.ask(own);
  assert.ok(whole, 'answered by the worker, where it used to go to the network and fail');
  assert.strictEqual(whole.status, 200);
  const head = await w.ask(own, 'bytes=0-1');
  assert.strictEqual(head.status, 206);
  assert.strictEqual(head.headers.get('content-range'), 'bytes 0-1/1000');
  assert.strictEqual((await head.arrayBuffer()).byteLength, 2);
  const rest = await w.ask(own, 'bytes=100-');
  assert.strictEqual(rest.headers.get('content-range'), 'bytes 100-999/1000');
  const bytes = new Uint8Array(await rest.arrayBuffer());
  assert.strictEqual(bytes[0], 100, 'the piece is cut from the right place');
  assert.strictEqual((await w.ask(own, 'bytes=-10')).headers.get('content-range'), 'bytes 990-999/1000');
  assert.strictEqual((await w.ask(own, 'bytes=5000-')).status, 416);
  assert.deepStrictEqual(w.net.asked, [], 'and the network was never asked');
});

test('the worker keeps a recording whole the first time, and answers a kept verse in pieces', async () => {
  const w = worker();
  w.net.online = true;
  const adhan = 'https://sunnati.3li.info/audio/adhan/jazi.mp3';
  const first = await w.ask(adhan, 'bytes=0-');
  assert.strictEqual(first.status, 206);
  assert.deepStrictEqual(w.net.asked, [adhan], 'the whole file, not the piece the player asked for');
  await tick();
  assert.ok(w.stores[w.version].get(adhan), 'and it is kept');
  w.net.online = false;
  assert.strictEqual((await w.ask(adhan, 'bytes=0-1')).status, 206, 'then it answers with no network');

  const verse = 'https://cdn.islamic.network/quran/audio/128/ar.minshawi/6222.mp3';
  await w.store('sunnati-audio').put(verse, new Response(new Uint8Array(500), { status: 200 }));
  assert.strictEqual((await w.ask(verse, 'bytes=0-99')).headers.get('content-range'), 'bytes 0-99/500');
  /* an opaque copy cannot be read, so it goes back as it is */
  const opaque = { type: 'opaque', status: 0 };
  await w.store('sunnati-audio').put(verse, opaque);
  assert.strictEqual(await w.ask(verse, 'bytes=0-'), opaque);
  /* a whole surah and a station from another site are left to the network */
  assert.strictEqual(w.ask('https://cdn.mp3quran.net/audio/maher-muaiqly/r1/002.mp3', 'bytes=0-'), null);
  assert.strictEqual(w.ask('https://backup.qurango.net/radio/maher'), null);
});

/* ---------------- the two wrappers ---------------- */

test('android keeps the pair it fetched, and its player rings no tone', () => {
  const java = (f) => fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/eworldq8/sunnati', f), 'utf8');
  const sound = java('AdhanSound.java');
  assert.ok(sound.indexOf('String pair = url + "|" + fajrUrl;') !== -1, 'the pair is what is compared');
  assert.ok(/pair\.equals\(prefs\(c\)\.getString\(KEY_HAVE, null\)\) && have\(c, false\) && have\(c, true\)/.test(sound));
  const service = java('AudioService.java');
  assert.ok(service.indexOf('AdhanReceiver.CHANNEL_PLAYING') !== -1, 'the player has its own channel');
  assert.ok(service.indexOf('.setOnlyAlertOnce(true)') !== -1, 'and it alerts once at most');
  const receiver = java('AdhanReceiver.java');
  const made = /getNotificationChannel\(CHANNEL_PLAYING\) == null\) \{([\s\S]*?)\n        \}/.exec(receiver)[1];
  assert.ok(made.indexOf('IMPORTANCE_LOW') !== -1 && made.indexOf('setSound(null, null)') !== -1 && made.indexOf('enableVibration(false)') !== -1,
    'a channel that never sounds or buzzes');
});

test('the iPhone carries a clip of every muadhin it may be asked for, and plays it', () => {
  const { win } = boot();
  win.ADHAN_VOICES.forEach(function (v) {
    const clip = path.join(ROOT, 'ios', 'Sunnati', 'adhan-' + v.id + '.caf');
    assert.ok(fs.existsSync(clip), 'no clip for ' + v.id);
    const info = cafInfo(clip);
    assert.strictEqual(info.format, 'ima4', v.id + ' in a codec iOS plays as a notification');
    assert.ok(info.seconds > 25 && info.seconds < 30, v.id + ' runs ' + info.seconds.toFixed(2) + ' s, and iOS plays nothing of 30 or more');
  });
  const chime = cafInfo(path.join(ROOT, 'ios', 'Sunnati', 'chime.caf'));
  assert.ok(chime.seconds < 30);

  const swift = (f) => fs.readFileSync(path.join(ROOT, 'ios', 'Sunnati', f), 'utf8');
  const notifier = swift('Notifier.swift');
  assert.ok(notifier.indexOf('return "adhan-\\(id).caf"') !== -1, 'the address of an adhan becomes its clip');
  assert.ok(/if item\.chime == \.silent \{ return nil \}/.test(notifier), 'and silence wins over any clip');
  const reader = swift('ReaderController.swift');
  assert.ok(reader.indexOf("setAdhanSound: call('setAdhanSound')") !== -1 && reader.indexOf("setQiyamSound: call('setQiyamSound')") !== -1,
    'the bridge declares both, so the page reaches them');
  assert.ok(reader.indexOf('as? [Double]') !== -1, 'qiyam is read as the list of times the page sends');
  assert.ok(reader.indexOf('setActive(true)') === -1, 'opening the app no longer silences the reader\'s own music');
});
