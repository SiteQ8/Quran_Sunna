/* Exercises the offline mushaf against the shipped data file. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../docs/js/mushaf.js');
const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'mushaf.json'), 'utf8'));
M.init(payload);

test('the data file holds the complete mushaf', () => {
  assert.ok(M.ready());
  assert.strictEqual(M.totalVerses(), 6236);
  assert.strictEqual(M.verseCount(1), 7);
  assert.strictEqual(M.verseCount(2), 286);
  assert.strictEqual(M.verseCount(9), 129);
  assert.strictEqual(M.verseCount(114), 6);
});

test('the basmala is separate from the opening verse of every surah but two', () => {
  const b = M.basmala();
  assert.ok(b.indexOf('بِسْمِ') === 0, 'basmala should start with bismi');
  assert.strictEqual(M.ayah(1, 1), b, 'in al fatiha the basmala is the first verse');
  assert.ok(M.ayah(2, 1).indexOf('بِسْمِ') === -1, 'al baqara should not repeat the basmala');
  assert.ok(M.normalize(M.ayah(9, 1)).indexOf('براه') === 0, 'at tawba opens with baraa');
  for (let s = 2; s <= 114; s++) {
    if (s === 9) continue;
    assert.ok(M.ayah(s, 1).indexOf('بِسْمِ ٱللَّهِ') !== 0, 'surah ' + s + ' still carries the basmala');
  }
});

test('folding strips vowel marks and unifies letter shapes', () => {
  assert.strictEqual(M.normalize('ٱلرَّحْمَٰنِ'), 'الرحمن');
  assert.strictEqual(M.normalize('إِنَّآ أَعْطَيْنَٰكَ'), 'انا اعطينك');
  assert.strictEqual(M.normalize('ٱلصَّلَوٰةُ'), 'الصلوه');
  assert.strictEqual(M.normalize('شَىْءٍ'), 'شي');
  assert.strictEqual(M.normalize('رَحْمَةً'), 'رحمه');
  assert.strictEqual(M.normalize(''), '');
  assert.strictEqual(M.normalize(null), '');
});

test('search finds verses when the query carries no vowel marks', () => {
  const hits = M.search('الرحمن الرحيم', { limit: 10 });
  assert.ok(hits.length > 0, 'expected matches for a common phrase');
  assert.strictEqual(hits[0].s, 1);
  const withMarks = M.search('ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', { limit: 10 });
  assert.strictEqual(withMarks.length, hits.length, 'marks should not change the result count');
});

test('search returns verses in mushaf order and respects the limit', () => {
  const hits = M.search('الله', { limit: 25 });
  assert.strictEqual(hits.length, 25);
  for (let i = 1; i < hits.length; i++) {
    assert.ok(M.globalIndex(hits[i].s, hits[i].a) > M.globalIndex(hits[i - 1].s, hits[i - 1].a), 'out of order');
  }
});

test('search can be scoped to a single surah', () => {
  const hits = M.search('الجنه', { surah: 2, limit: 100 });
  hits.forEach(function (h) { assert.strictEqual(h.s, 2); });
});

test('short and empty queries return nothing', () => {
  assert.deepStrictEqual(M.search('', {}), []);
  assert.deepStrictEqual(M.search('ا', {}), []);
});

test('known phrase counts are stable', () => {
  assert.strictEqual(M.countMatches('فباي الاء ربكما تكذبان'), 31, 'ar rahman refrain');
  assert.strictEqual(M.countMatches('الحمد لله'), 23);
  assert.strictEqual(M.countMatches('قل هو الله احد'), 1);
});

test('global numbering runs from one to six thousand two hundred and thirty six', () => {
  assert.strictEqual(M.globalIndex(1, 1), 1);
  assert.strictEqual(M.globalIndex(2, 1), 8);
  assert.strictEqual(M.globalIndex(114, 6), 6236);
  assert.deepStrictEqual(M.fromGlobalIndex(1), { s: 1, a: 1 });
  assert.deepStrictEqual(M.fromGlobalIndex(8), { s: 2, a: 1 });
  assert.deepStrictEqual(M.fromGlobalIndex(6236), { s: 114, a: 6 });
  assert.strictEqual(M.fromGlobalIndex(0), null);
  assert.strictEqual(M.fromGlobalIndex(9999), null);
});

test('numbering round trips for every verse', () => {
  for (let n = 1; n <= 6236; n++) {
    const p = M.fromGlobalIndex(n);
    assert.strictEqual(M.globalIndex(p.s, p.a), n, 'round trip broke at ' + n);
  }
});

test('juz and page boundaries land where the mushaf places them', () => {
  assert.strictEqual(M.juzOf(1, 1), 1);
  assert.strictEqual(M.juzOf(2, 142), 2);
  assert.strictEqual(M.juzOf(18, 75), 16);
  assert.strictEqual(M.juzOf(114, 6), 30);
  assert.deepStrictEqual(M.juzStart(1), { s: 1, a: 1 });
  assert.deepStrictEqual(M.juzStart(30), { s: 78, a: 1 });
  assert.strictEqual(M.pageOf(1, 1), 1);
  assert.strictEqual(M.pageOf(114, 6), 604);
  assert.deepStrictEqual(M.pageStart(1), { s: 1, a: 1 });
});

test('juz numbers rise monotonically through the mushaf', () => {
  let last = 1;
  for (let n = 1; n <= 6236; n += 7) {
    const p = M.fromGlobalIndex(n);
    const j = M.juzOf(p.s, p.a);
    assert.ok(j >= last, 'juz went backwards at ' + n);
    assert.ok(j >= 1 && j <= 30, 'juz out of range at ' + n);
    last = j;
  }
});

test('the fifteen places of prostration are marked', () => {
  assert.strictEqual(M.sajdaList().length, 15);
  assert.ok(M.isSajda(32, 15));
  assert.ok(M.isSajda(96, 19));
  assert.ok(!M.isSajda(1, 1));
});

test('a khatma plan covers all six hundred and four pages', () => {
  [30, 60, 7, 90, 1].forEach(function (days) {
    const plan = M.khatmaPlan(days, 1);
    assert.strictEqual(plan.length, days);
    const total = plan.reduce(function (sum, d) { return sum + d.pages; }, 0);
    assert.strictEqual(total, 604, days + ' day plan should cover the mushaf');
    assert.strictEqual(plan[0].from, 1);
    assert.strictEqual(plan[plan.length - 1].to, 604);
  });
});

test('a khatma plan can start mid mushaf and stays contiguous', () => {
  const plan = M.khatmaPlan(30, 100);
  assert.strictEqual(plan[0].from, 100);
  assert.strictEqual(plan[plan.length - 1].to, 604);
  for (let i = 1; i < plan.length; i++) {
    assert.strictEqual(plan[i].from, plan[i - 1].to + 1, 'gap at day ' + (i + 1));
  }
});

test('khatma status reports whether the reader is ahead or behind', () => {
  const plan = M.khatmaPlan(30, 1);
  const behind = M.khatmaStatus(plan, 9, 100);
  assert.strictEqual(behind.dueByToday, 204);
  assert.ok(behind.ahead < 0);
  assert.strictEqual(behind.finished, false);
  const done = M.khatmaStatus(plan, 29, 604);
  assert.strictEqual(done.percent, 100);
  assert.strictEqual(done.finished, true);
});

test('bad payloads are rejected rather than half loaded', () => {
  assert.throws(function () { M.init({ a: [] }); }, /not valid/);
  assert.throws(function () { M.init(null); }, /not valid/);
});

test('the dagger alef is searchable in both spellings', () => {
  assert.strictEqual(M.expand('ٱلصَّٰبِرِينَ'), 'الصابرين');
  assert.strictEqual(M.normalize('ٱلصَّٰبِرِينَ'), 'الصبرين');
  assert.strictEqual(M.expand('ٱلصَّلَوٰةُ'), 'الصلاه', 'waw plus dagger alef reads as alef');
  assert.strictEqual(M.expand('دَاوُۥدَ'), 'داوود', 'the small waw is a whole letter');

  const tight = M.countMatches('الصبرين');
  const loose = M.countMatches('الصابرين');
  assert.ok(loose > 0, 'the spelling a reader types must find verses');
  assert.strictEqual(tight, loose, 'both spellings name the same verses');
  assert.strictEqual(M.countMatches('الصلاة'), M.countMatches('الصلوة'));
  assert.ok(M.countMatches('رب العالمين') > 0);
});

test('a hit reports which fold matched it', () => {
  const wide = M.search('الصابرين', { limit: 3 });
  assert.ok(wide.length > 0);
  assert.strictEqual(wide[0].wide, true);
  const tight = M.search('الرحمن الرحيم', { limit: 3 });
  assert.strictEqual(tight[0].wide, false);
  assert.ok(tight[0].plain.indexOf('الرحمن') !== -1);
});

test('a match maps back onto the exact letters of the pointed verse', () => {
  const cases = [
    [2, 153, 'الصابرين'],
    [2, 155, 'الصابرين'],
    [2, 177, 'الصابرين'],
    [3, 17, 'الصابرين'],
    [1, 2, 'الحمد'],
    [2, 255, 'الحي القيوم']
  ];
  cases.forEach(function (c) {
    const text = M.ayah(c[0], c[1]);
    const span = M.spanFor(text, c[2]);
    assert.ok(span, 'no span for ' + c[2] + ' in ' + c[0] + ':' + c[1]);
    const cut = text.slice(span.start, span.end);
    const want = M.normalize(c[2]);
    assert.ok(M.normalize(cut) === want || M.expand(cut) === want,
      'the wrapped letters should fold to the query, got ' + cut);
  });
});

test('the span survives spaces and multi word queries', () => {
  const text = M.ayah(1, 2);
  const span = M.spanFor(text, 'رب العالمين');
  assert.ok(span, 'a two word query should map');
  const cut = text.slice(span.start, span.end);
  assert.ok(cut.indexOf(' ') !== -1, 'the span should run across the space');
  assert.strictEqual(M.expand(cut), 'رب العالمين');
});

test('a query that is not there maps to nothing', () => {
  assert.strictEqual(M.spanFor(M.ayah(1, 1), 'الصابرين'), null);
  assert.strictEqual(M.spanFor('نص', ''), null);
});
