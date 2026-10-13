/* The verse made into a short video: the module that makes it, the sheet that
   offers it, the files it draws with, and what the packages do with it. The
   recording itself needs a real canvas and a real MediaRecorder, so what is
   tested here is everything around them: the words and their phrases, the
   layout, the timing, the light, the hand over, and the app's side. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const { JSDOM } = (function () {
  for (const where of ['jsdom', '/tmp/node_modules/jsdom']) {
    try { return require(where); } catch (e) { /* try the next */ }
  }
  throw new Error('jsdom is missing: run  npm install jsdom');
}());

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
/* the page's own scripts, with the video module before the app as the page has it */
const SCRIPTS = [
  'data/surahs.js', 'data/azkar.js', 'data/hisn.js', 'data/ojeiri.js', 'data/marks.js', 'data/adhan.js', 'data/umrah.js', 'data/dua-themes.js', 'data/duas.js', 'data/content.js', 'data/extras.js',
  'js/prayer-engine.js', 'js/hijri.js', 'js/store.js', 'js/mushaf.js', 'js/verse-video.js', 'js/app.js'
];

const mushafPayload = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'mushaf.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

function boot(options) {
  const opts = options || {};
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://siteq8.github.io/Quran_Sunna/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  Object.defineProperty(win, 'localStorage', { value: opts.storage || memoryStorage(), configurable: true });
  win.matchMedia = win.matchMedia || function () { return { matches: false, addEventListener() {}, removeEventListener() {} }; };
  win.fetch = opts.fetch || function (url) {
    if (String(url).indexOf('mushaf.json') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(mushafPayload) });
    return Promise.reject(new Error('offline in tests'));
  };
  win.Audio = function () { return { play: () => Promise.resolve(), pause() { this.paused = true; }, paused: false, src: '' }; };
  win.navigator.vibrate = function () { return true; };
  win.scrollTo = function () {};
  if (opts.bridge) win.SunnatiApp = opts.bridge;
  /* what a phone that can record has: WebAudio with a stream out of it, a
     canvas that can be captured, and a recorder that writes mp4 */
  if (opts.recorder) {
    win.AudioContext = function () {};
    win.AudioContext.prototype.createMediaStreamDestination = function () {};
    win.HTMLCanvasElement.prototype.captureStream = function () {};
    win.MediaStream = function () {};
    win.MediaRecorder = { isTypeSupported: (t) => /^video\/mp4;codecs=avc1/.test(t) };
  }
  SCRIPTS.forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, rel), 'utf8'), dom.getInternalVMContext(), { filename: rel });
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

/* the verse sheet, opened as a tap on the verse opens it */
function openVerse(win, doc, s, a) {
  win.App.go('quran');
  click(win, doc.querySelector('[data-surah="' + s + '"]'));
  click(win, doc.querySelector('[data-ayah="' + s + ':' + a + '"]'));
}

/* a bridge of a package that knows the video methods */
function videoBridge(log) {
  return {
    videoBegin: (n) => { log.push(['begin', n]); return true; },
    videoChunk: (b) => { log.push(['chunk', b]); return true; },
    videoShare: (w) => { log.push(['share', w]); return true; },
    videoAbort: () => { log.push(['abort']); return true; },
    shareImageWithText: () => true
  };
}

/* A 2d context that measures every letter at the same share of the size,
   the marks over and under the letters taking no room, as near the mushaf
   face as lines need to be laid without a real canvas. */
function fakeContext() {
  let size = 80, font = '';
  return {
    get font() { return font; },
    set font(f) { font = f; size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)[1]); },
    direction: 'rtl',
    measureText: (t) => ({
      width: t === ' ' ? size * 0.29 : String(t).replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u00a0]/g, '').length * size * 0.36
    })
  };
}

const V13_28 = 'ٱلَّذِينَ ءَامَنُوا۟ وَتَطْمَئِنُّ قُلُوبُهُم بِذِكْرِ ٱللَّهِ ۗ أَلَا بِذِكْرِ ٱللَّهِ تَطْمَئِنُّ ٱلْقُلُوبُ';

/* ---------------- the recitations ---------------- */

test('every reciter of the app has a recitation the video can read, by the verse', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const ids = win.RECITERS.map((r) => r.id);
  assert.deepStrictEqual(Object.keys(V.AUDIO).sort(), Array.from(ids).sort(), 'one folder for each reciter, and no other');
  ids.forEach(function (id) {
    assert.ok(V.hasVoice(id));
    /* WebAudio reads only a file sent with Access-Control-Allow-Origin, which
       everyayah.com sends and the app's own source does not */
    assert.match(V.AUDIO[id], /^https:\/\/everyayah\.com\/data\/[^/]+\/$/, id);
  });
  assert.strictEqual(V.audioUrl('ar.minshawi', 13, 28), 'https://everyayah.com/data/Minshawy_Murattal_128kbps/013028.mp3');
  assert.strictEqual(V.audioUrl('ar.husary', 2, 255), 'https://everyayah.com/data/Husary_128kbps/002255.mp3');
  assert.strictEqual(V.audioUrl('ar.someoneelse', 1, 1), '', 'a voice without a folder has no video');
  assert.ok(!V.hasVoice('toString'), 'and nothing inherited passes for a reciter');
});

test('the word timings are asked of quran.com for the three it times, and of nobody for the rest', async () => {
  const asked = [];
  const { win } = boot({
    fetch: (url) => {
      asked.push(String(url));
      if (/api\.quran\.com/.test(url)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ audio_files: [{ segments: [[0, 1, 0, 400]] }] }) });
      }
      if (/mushaf\.json/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve(mushafPayload) });
      return Promise.reject(new Error('offline'));
    }
  });
  const V = win.VerseVideo;
  asked.length = 0;
  assert.strictEqual(await V.timings('ar.husary', 13, 28), null);
  assert.strictEqual(asked.length, 0, 'nothing is asked for a voice quran.com does not time');
  assert.deepStrictEqual(await V.timings('ar.minshawi', 13, 28), [[0, 1, 0, 400]]);
  assert.strictEqual(asked[0], 'https://api.quran.com/api/v4/recitations/9/by_ayah/13:28?fields=segments');
  assert.deepStrictEqual(Object.keys(V.TIMED).sort(), ['ar.minshawi', 'ar.saoodshuraym', 'ar.shaatree']);
});

/* ---------------- the words and their phrases ---------------- */

test('a waqf mark rides on the word before it and closes a phrase', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const words = V.tokens(V13_28);
  assert.strictEqual(words.length, 11, 'eleven words, the mark not counted as one');
  assert.strictEqual(words[5].t, 'ٱللَّهِ ۗ', 'set on its word over a space that does not break');
  assert.ok(words[5].stop && !words[4].stop);
  assert.strictEqual(V.wordCount(V13_28), 11);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(V.phrasesByMarks(words))), [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);
});

test('the one short word the paired marks leave alone rides with the phrase after it', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const words = V.tokens(win.Mushaf.ayah(2, 2));
  const groups = V.phrasesByMarks(words);
  /* ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ */
  assert.strictEqual(groups.length, 2, 'فِيهِ is not a phrase of its own');
  assert.ok(groups[1].map((i) => words[i].t).join(' ').indexOf('فِيهِ') === 0);
});

test('no verse longer than the video holds is offered, and every other one is', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  let longest = 0, over = 0, total = 0;
  for (let s = 1; s <= 114; s++) {
    for (let a = 1; win.Mushaf.ayah(s, a); a++) {
      const n = V.wordCount(win.Mushaf.ayah(s, a));
      total++;
      if (n > V.MAX_WORDS) over++; else longest = Math.max(longest, n);
    }
  }
  assert.strictEqual(total, 6236);
  assert.strictEqual(longest, V.MAX_WORDS, 'the limit is a length some verse has');
  assert.ok(over / total < 0.01, 'all but a few verses fit, got ' + over + ' over');
});

/* ---------------- the layout ---------------- */

test('lines are balanced as text-wrap: balance would set them', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const widths = [200, 180, 220, 160, 240, 120, 90];
  const lines = V.balanced(widths, 20, 888);
  const greedy = [[0, 1, 2, 3], [4, 5, 6]];
  assert.strictEqual(lines.length, greedy.length, 'no more lines than plain wrapping needs');
  const len = (ids) => ids.reduce((s, i) => s + widths[i], 0) + 20 * (ids.length - 1);
  const spread = (ls) => Math.max.apply(null, ls.map(len)) - Math.min.apply(null, ls.map(len));
  assert.ok(spread(lines) < spread(greedy), 'and closer to equal than plain wrapping');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(V.balanced([300], 20, 888))), [[0]]);
});

test('a short verse stands at full size from the overlay\'s top, a long one smaller and lifted', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const face = "'Amiri Quran', serif";
  const words = V.tokens(V13_28);
  const lay = V.arrange(fakeContext(), words, V.phrasesByMarks(words), face);
  assert.strictEqual(lay.size, 80);
  assert.strictEqual(lay.lift, 0);
  assert.ok(Math.abs(lay.lh - 80 * 2.08) < 1e-9, 'line height 2.08');
  /* each phrase starts a line of its own */
  const firstOfSecond = lay.lines.findIndex((ln) => ln.ids.indexOf(6) !== -1);
  assert.strictEqual(lay.lines[firstOfSecond].ids[0], 6);
  const long = V.tokens(win.Mushaf.ayah(2, 255));
  const big = V.arrange(fakeContext(), long, V.phrasesByMarks(long), face);
  assert.ok(big.size < 80 && big.size >= 44, 'smaller, got ' + big.size);
  assert.ok(big.lift > 0 && big.lift <= 300, 'and lifted no more than the sky allows, got ' + big.lift);
});

test('each lit unit gets a band that holds its lines and what reaches past them', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const words = V.tokens(V13_28);
  const groups = V.phrasesByMarks(words);
  const lay = V.arrange(fakeContext(), words, groups, "'Amiri Quran'");
  const units = V.unitSpans(lay, V.litUnits(words, groups, lay));
  assert.strictEqual(units.length, 2);
  units.forEach(function (u) {
    const lines = lay.lines.filter((ln) => ln.ids.some((id) => u.ids.indexOf(id) !== -1));
    assert.ok(u.top <= lines[0].top - lay.size * 0.5, 'room above for the marks over the first line');
    assert.ok(u.bottom >= lines[lines.length - 1].top + lay.lh + lay.size * 0.5, 'and below for the tails under the last');
  });
  assert.ok(units[0].bottom > units[1].top, 'neighbouring bands overlap, each drawn at its own strength');
  /* a verse with no marks is lit a line at a time */
  const plain = V.tokens(win.Mushaf.ayah(1, 2));
  const one = V.phrasesByMarks(plain);
  const lay2 = V.arrange(fakeContext(), plain, one, "'Amiri Quran'");
  assert.strictEqual(V.litUnits(plain, one, lay2).length, lay2.lines.length);
});

/* ---------------- when each phrase is lit ---------------- */

/* a recording as WebAudio hands it over, of tone and silence */
function recording(rate, parts) {
  const n = Math.round(parts.reduce((s, p) => s + p[1], 0) * rate);
  const data = new Float32Array(n);
  let at = 0;
  parts.forEach(function (p) {
    const len = Math.round(p[1] * rate);
    for (let i = 0; i < len; i++) data[at + i] = p[0] ? 0.5 * Math.sin(2 * Math.PI * 220 * i / rate) : 0.0002 * Math.sin(i);
    at += len;
  });
  return { length: n, sampleRate: rate, numberOfChannels: 1, duration: n / rate, getChannelData: () => data };
}

test('without word timings, each phrase begins where the reciter takes up again after a pause', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const buffer = recording(8000, [[0, 0.2], [1, 1.2], [0, 0.6], [1, 1.0], [0, 0.6], [1, 0.8], [0, 0.4]]);
  const units = [{ ids: [0], weight: 12 }, { ids: [1], weight: 10 }, { ids: [2], weight: 8 }];
  const t = V.pauseTiming(buffer, units);
  assert.ok(Math.abs(t.starts[0] - 0.2) < 0.05, 'the first as the voice starts, got ' + t.starts[0]);
  assert.ok(Math.abs(t.starts[1] - 2.0) < 0.06, 'the second as the voice takes up after the first pause, got ' + t.starts[1]);
  assert.ok(Math.abs(t.starts[2] - 3.6) < 0.06, 'the third after the second, got ' + t.starts[2]);
  assert.ok(Math.abs(t.end - 4.4) < 0.05, 'and the recitation ends where the voice does, got ' + t.end);
});

test('with word timings, the light follows them, and a list that misses the last word is not trusted', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const words = V.tokens(V13_28);
  const units = V.litUnits(words, V.phrasesByMarks(words), { lines: [] });
  const segs = [[0, 1, 0, 700], [1, 2, 700, 1300], [2, 3, 1300, 2000], [3, 4, 2000, 2600], [4, 5, 2600, 3100], [5, 6, 3100, 3900],
    [6, 7, 4600, 5000], [7, 8, 5000, 5500], [8, 9, 5500, 6100], [9, 10, 6100, 6900], [10, 11, 6900, 8000]];
  const timed = V.segmentTiming(segs, words, units);
  assert.strictEqual(timed.end, 8);
  const events = V.lightEvents(timed, units, 9);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(events)), [{ t: 0, unit: 0 }, { t: 4.6, unit: 1 }]);
  assert.strictEqual(V.segmentTiming(segs.slice(0, 10), words, units), null, 'a count of words that is not the mushaf\'s');
  assert.strictEqual(V.segmentTiming([[0, 1, 500, 200]], words, units), null, 'a word that ends before it starts');
});

test('the phrase being recited is full and the rest dim, and the whole verse comes up at its end', () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const events = [{ t: 0.2, unit: 0 }, { t: 2.0, unit: 1 }, { t: 3.6, unit: 2 }];
  const at = (tau) => Array.from(V.lights(events, 3, tau, 4.4)).map((x) => Math.round(x * 100) / 100);
  assert.deepStrictEqual(at(-0.6), [0, 0, 0], 'nothing before the voice');
  assert.deepStrictEqual(at(0.3), [1, 0, 0], 'the first phrase, lit half a second before it is said');
  assert.deepStrictEqual(at(1.6), [0.82, 0.18, 0], 'crossing to the next in the pause');
  assert.deepStrictEqual(at(2.5), [0, 1, 0]);
  assert.deepStrictEqual(at(5.2), [1, 1, 1], 'all of it once the last word is said');
  assert.strictEqual(V.DIM, 0.42, 'the rest at forty two per cent, as approved');
});

/* ---------------- the hand over ---------------- */

test('the video goes to the package in pieces of whole base64, and comes out byte for byte', async () => {
  const { win } = boot();
  const V = win.VerseVideo;
  const bytes = new Uint8Array(V.PIECE * 2 + 1234);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255;
  const log = [];
  const ok = await V.handOver(videoBridge(log), new win.Blob([bytes], { type: 'video/mp4' }), 'ayah-13-28.mp4', 'words');
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(log[0], ['begin', 'ayah-13-28.mp4']);
  const chunks = log.filter((e) => e[0] === 'chunk').map((e) => e[1]);
  assert.strictEqual(chunks.length, 3);
  assert.strictEqual(chunks[0].length, V.PIECE / 3 * 4, 'each piece is whole base64 on its own');
  const back = Buffer.concat(chunks.map((c) => Buffer.from(c, 'base64')));
  assert.ok(back.equals(Buffer.from(bytes)), 'every byte arrives');
  assert.deepStrictEqual(log[log.length - 1], ['share', 'words']);
  /* a package that refuses a piece is told to let the half-written file go */
  const refused = [];
  const bridge = videoBridge(refused);
  bridge.videoChunk = () => false;
  assert.strictEqual(await V.handOver(bridge, new win.Blob([bytes]), 'x.mp4', ''), false);
  assert.deepStrictEqual(refused[refused.length - 1], ['abort']);
});

/* ---------------- the app's side ---------------- */

test('the verse sheet offers «مقطع فيديو» where the phone can record and send one', () => {
  const log = [];
  const { win, doc } = boot({ recorder: true, bridge: videoBridge(log) });
  openVerse(win, doc, 13, 28);
  const button = doc.querySelector('[data-act="share-video"]');
  assert.ok(button, 'the button is there');
  assert.strictEqual(button.textContent.trim(), 'مقطع فيديو');
  assert.strictEqual(button.getAttribute('data-ref'), '13:28');
  /* it sits after the share of the verse as a picture */
  const acts = [...doc.querySelectorAll('.service-grid .service')].map((b) => b.getAttribute('data-act'));
  assert.strictEqual(acts.indexOf('share-video'), acts.indexOf('share') + 1);
});

test('no video is offered where it cannot be made or cannot leave the app', () => {
  /* no recorder in this browser */
  let { win, doc } = boot({ bridge: videoBridge([]) });
  openVerse(win, doc, 13, 28);
  assert.ok(!doc.querySelector('[data-act="share-video"]'));
  /* an android package from before the video methods, which has no share sheet for it */
  ({ win, doc } = boot({ recorder: true, bridge: { shareImageWithText: () => true } }));
  openVerse(win, doc, 13, 28);
  assert.ok(!doc.querySelector('[data-act="share-video"]'));
  /* a verse longer than the video holds */
  ({ win, doc } = boot({ recorder: true, bridge: videoBridge([]) }));
  assert.strictEqual(win.App.helpers.canMakeVideo(2, 282), false);
  assert.strictEqual(win.App.helpers.canMakeVideo(13, 28), true);
});

test('the video is made with the verse, its surah and number, the reciter, and the app, and stops with its sheet', () => {
  const { win, doc } = boot({ recorder: true, bridge: videoBridge([]) });
  let made = null, cancelled = 0;
  win.VerseVideo.make = function (o) {
    made = o;
    return { promise: new Promise(function () {}), cancel: function () { cancelled++; } };
  };
  openVerse(win, doc, 13, 28);
  click(win, doc.querySelector('[data-act="share-video"]'));
  assert.ok(made, 'the recording was started from the tap itself');
  assert.strictEqual(made.text, win.Mushaf.ayah(13, 28));
  assert.strictEqual(made.surah, 'سورة الرعد');
  assert.strictEqual(made.number, '٢٨', 'the number in the mushaf\'s own figures, in the rosette');
  assert.strictEqual(made.by, 'بصوت');
  assert.strictEqual(made.voice, 'محمد صديق المنشاوي');
  assert.strictEqual(made.name, 'سُنّتي');
  assert.strictEqual(made.audioUrl, 'https://everyayah.com/data/Minshawy_Murattal_128kbps/013028.mp3');
  assert.strictEqual(made.keepCanvas, true);
  assert.strictEqual(made.host, doc.getElementById('video-host'));
  assert.ok(doc.getElementById('video-host').classList.contains('video-frame'));
  assert.strictEqual(cancelled, 0);
  click(win, doc.querySelector('[data-act="video-stop"]'));
  assert.strictEqual(cancelled, 1, 'stopped with its sheet');
  assert.ok(!doc.getElementById('sheet').classList.contains('is-open'));
});

test('a verse whose recitation cannot be fetched goes as a picture instead', async () => {
  const pictures = [];
  const bridge = videoBridge([]);
  bridge.shareImage = () => true;
  bridge.shareImageWithText = (d, n, w) => { pictures.push([n, w]); return true; };
  const { win, doc } = boot({ recorder: true, bridge: bridge });
  win.VerseVideo.make = function () {
    const e = new Error('audio'); e.code = 'audio';
    return { promise: Promise.reject(e), cancel: function () {} };
  };
  openVerse(win, doc, 13, 28);
  click(win, doc.querySelector('[data-act="share-video"]'));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!doc.getElementById('sheet').classList.contains('is-open'), 'the sheet of the video goes');
  /* jsdom draws no canvas, so the picture itself cannot be made here; what
     the reader is last told is about the picture being made in its place */
  assert.match(doc.getElementById('toast').textContent, /الصورة/);
});

/* ---------------- the files ---------------- */

test('the video\'s stylesheet and module are linked and kept by the worker, its scene only once a video is made', () => {
  const html = read('docs/index.html');
  const sw = read('docs/sw.js');
  assert.ok(html.indexOf('<link rel="stylesheet" href="css/verse-video.css">') > html.indexOf('<link rel="stylesheet" href="css/style.css">'));
  assert.ok(html.indexOf('<script src="js/verse-video.js"></script>') < html.indexOf('<script src="js/app.js"></script>'));
  ['./css/verse-video.css', './js/verse-video.js', './img/badges/app-store-ar.svg', './img/badges/google-play-ar.png'].forEach(function (f) {
    assert.ok(sw.indexOf("'" + f + "'") !== -1, f + ' is not in the shell');
  });
  assert.ok(sw.indexOf('img/verse/') === -1, 'the scene is fetched when a video is made, then kept, not with the shell');
  ['docs/img/verse/night-sea.webp', 'docs/img/verse/night-sea-loop.mp4', 'docs/icons/icon-192.png'].forEach(function (f) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  });
  const css = read('docs/css/verse-video.css');
  assert.ok(css.indexOf('.service-grid .service:last-child:nth-child(odd) { grid-column: 1 / -1; }') !== -1, 'the odd last button takes its row');
  assert.ok(read('docs/css/style.css').indexOf('video-frame') === -1, 'the feature keeps to its own stylesheet');
});

test('the store badges are the stores\' own files, unaltered', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  assert.strictEqual(sha('docs/img/badges/app-store-ar.svg'), '1824fcf05bd3d5a01d0992f6eae6f6d5b26e4a2db07a144d56fa0e12216c238d');
  assert.strictEqual(sha('docs/img/badges/google-play-ar.png'), '29e74ca0db2b79c6a6d70ab3c63c8c1bf7a0574a0f91058d5743c9072ace7383');
  const { win } = boot();
  const B = win.VerseVideo.BADGES;
  /* Google's PNG carries a margin of its own, so its black shape is the box
     drawn to the height of Apple's whole badge */
  assert.deepStrictEqual(Array.from(B.google.box), [41, 41, 605, 209]);
  assert.strictEqual(B.apple.box[3], B.apple.h);
  const source = read('docs/js/verse-video.js');
  assert.ok(/the badges are never faded or moved/.test(source));
});

test('no web address is drawn on the video or on the picture card', () => {
  const source = read('docs/js/verse-video.js');
  assert.ok(source.indexOf('3li.info') === -1, 'the video names no address');
  const app = read('docs/js/app.js');
  const card = /function textCard\(heading, text, face, source\) \{([\s\S]*?)\n  \}\n/.exec(app)[1];
  assert.ok(card.indexOf('3li.info') === -1, 'the card names no address');
  assert.ok(card.indexOf('storeMarks()') !== -1 && card.indexOf('drawBadges(') !== -1, 'the badges say where the app is');
  assert.ok(card.indexOf("'سُنّتي'") !== -1, 'beside the app\'s icon and name');
});

test('every host the video reaches is named in both privacy pages', () => {
  const source = read('docs/js/verse-video.js');
  const hosts = [...new Set([...source.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]))];
  assert.deepStrictEqual(hosts.sort(), ['api.quran.com', 'everyayah.com']);
  ['docs/privacy.html', 'docs/privacy-en.html'].forEach(function (page) {
    const text = read(page);
    hosts.forEach((h) => assert.ok(text.indexOf(h) !== -1, h + ' is not named in ' + page));
  });
});

test('the english policy says what the arabic one says', () => {
  const ar = read('docs/privacy.html');
  const en = read('docs/privacy-en.html');
  const named = (html) => [...new Set([...html.matchAll(/<span dir="ltr">([^<]+)<\/span>/g)].map((m) => m[1]))];
  named(ar).forEach((h) => assert.ok(en.indexOf(h) !== -1, h + ' is in the arabic policy and not the english'));
  assert.strictEqual((en.match(/<section>/g) || []).length, (ar.match(/<section>/g) || []).length, 'a card for every card');
  ['FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'Exact alarms', 'radio', 'Overpass', 'temporary storage'].forEach(function (needle) {
    assert.ok(en.indexOf(needle) !== -1, 'the english policy says nothing of ' + needle);
  });
  assert.ok(/lang="en"/.test(en) && en.indexOf('icons/icon-192.png') !== -1);
});

/* ---------------- the packages ---------------- */

test('android takes the video in pieces, makes it a plain mp4, and shares it from its cache', () => {
  const bridge = read('android/app/src/main/java/com/eworldq8/sunnati/Bridge.java');
  ['videoBegin', 'videoChunk', 'videoShare', 'videoAbort'].forEach(function (m) {
    assert.ok(new RegExp('@JavascriptInterface\\s+public synchronized \\w+ ' + m + '\\(').test(bridge), m);
  });
  assert.ok(bridge.indexOf('Mp4Remux.plain(videoPart, done)') !== -1);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.ok(/android:name="\.SharedFiles"[\s\S]*?android:exported="false"[\s\S]*?android:grantUriPermissions="true"/.test(manifest));
  assert.ok(read('android/app/proguard-rules.pro').indexOf('-keep class com.eworldq8.sunnati.SharedFiles') !== -1);
});

test('android 8 and 9 share a picture from the cache, and 10 on keep the gallery as before', () => {
  const bridge = read('android/app/src/main/java/com/eworldq8/sunnati/Bridge.java');
  const fn = /public boolean shareImageWithText\(String dataUrl, String name, String text\) \{([\s\S]*?)\n    \}\n/.exec(bridge)[1];
  const early = fn.indexOf('if (Build.VERSION.SDK_INT < 29) return offer(cachedPicture(bytes, name), "image/png", text);');
  assert.ok(early !== -1, 'before 29 the picture goes through the shared folder');
  assert.ok(fn.indexOf('MediaStore.Images.Media.RELATIVE_PATH') > early, 'from 29 the gallery path is unchanged');
  const shared = read('android/app/src/main/java/com/eworldq8/sunnati/SharedFiles.java');
  assert.ok(shared.indexOf('if (low.endsWith(".png")) return "image/png";') !== -1, 'and is read as a picture');
  assert.ok(bridge.indexOf('SharedFiles.sweep(dir, false);') !== -1, 'a picture leaves a video being written alone');
});

test('the iPhone takes the video in pieces and offers it once it is a plain mp4', () => {
  const swift = read('ios/Sunnati/ReaderController.swift');
  ['videoBegin', 'videoChunk', 'videoShare', 'videoAbort'].forEach(function (m) {
    assert.ok(swift.indexOf(m + ": call('" + m + "')") !== -1, m + ' is passed to the page');
    assert.ok(swift.indexOf('case "' + m + '":') !== -1, m + ' is answered');
  });
  assert.ok(swift.indexOf('AVAssetExportPresetPassthrough') !== -1, 'rewritten without being encoded again');
  assert.ok(swift.indexOf('App.helpers.videoHandedOver') !== -1, 'and the page is told');
});
