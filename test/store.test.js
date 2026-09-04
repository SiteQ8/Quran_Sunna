/* Store behaviour against an in memory stand in for browser storage. */
const test = require('node:test');
const assert = require('node:assert');
const S = require('../docs/js/store.js');

function fakeStorage(seed) {
  const map = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    key: (i) => Object.keys(map)[i],
    get length() { return Object.keys(map).length; },
    _map: map
  };
}

function fresh(seed) {
  const st = fakeStorage(seed);
  S.attach(st);
  S.resetSettings();
  return st;
}

test('settings fall back to defaults and persist once changed', () => {
  fresh();
  assert.strictEqual(S.get('method'), 'Kuwait');
  assert.strictEqual(S.get('fontScale'), 100);
  S.set('method', 'Makkah');
  S.set('fontScale', 130);
  assert.strictEqual(S.get('method'), 'Makkah');
  assert.strictEqual(S.get('fontScale'), 130);
  assert.strictEqual(S.get('asr'), 'shafi', 'untouched settings keep their default');
});

test('settings survive a reload of the module cache', () => {
  const st = fresh();
  S.setMany({ city: 'الكويت', lat: 29.37, lng: 47.97 });
  S.attach(fakeStorage());
  assert.strictEqual(S.settings().city, '', 'a different backend starts clean');
  S.attach(st);
  assert.strictEqual(S.settings().city, 'الكويت', 'reattaching reads the saved values back');
  assert.strictEqual(S.settings().lat, 29.37);
});

test('broken json in storage does not take the app down', () => {
  fresh({ 'sunnati.settings': '{not json', 'sunnati.bookmarks': 'oops' });
  assert.strictEqual(S.get('method'), 'Kuwait');
  assert.deepStrictEqual(S.bookmarks(), []);
});

test('day keys are zero padded and stable', () => {
  fresh();
  assert.strictEqual(S.dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.strictEqual(S.dayKey(new Date(2026, 11, 31)), '2026-12-31');
});

test('sunnah ticks toggle and persist per day', () => {
  fresh();
  const today = new Date(2026, 8, 4);
  assert.strictEqual(S.toggleSunnah('siwak', today), true);
  assert.strictEqual(S.toggleSunnah('duha', today), true);
  assert.strictEqual(S.toggleSunnah('siwak', today), false);
  const c = S.completion(today, 10);
  assert.strictEqual(c.done, 1);
  assert.strictEqual(c.percent, 10);
  const other = new Date(2026, 8, 5);
  assert.strictEqual(S.completion(other, 10).done, 0, 'days do not bleed into each other');
});

test('azkar counters record completion when they reach zero', () => {
  fresh();
  const d = new Date(2026, 8, 4);
  S.setAzkarCount('morning', 0, 2, d);
  assert.strictEqual(S.azkarProgress('morning', 19, d).done, 0);
  S.setAzkarCount('morning', 0, 0, d);
  S.setAzkarCount('morning', 1, 0, d);
  const p = S.azkarProgress('morning', 19, d);
  assert.strictEqual(p.done, 2);
  assert.strictEqual(p.total, 19);
  assert.strictEqual(p.percent, 11);
});

test('a day counts as active only once something is recorded', () => {
  fresh();
  const d = new Date(2026, 8, 4);
  assert.strictEqual(S.wasActive(d), false);
  S.toggleSunnah('siwak', d);
  assert.strictEqual(S.wasActive(d), true);
  S.toggleSunnah('siwak', d);
  assert.strictEqual(S.wasActive(d), false);
  S.updateDay((rec) => { rec.tasbih = 33; }, d);
  assert.strictEqual(S.wasActive(d), true);
});

test('streaks count back from today and tolerate an unfinished today', () => {
  fresh();
  const today = new Date(2026, 8, 4);
  for (let i = 1; i <= 5; i++) {
    const d = new Date(2026, 8, 4 - i);
    S.toggleSunnah('siwak', d);
  }
  let s = S.streak(today);
  assert.strictEqual(s.current, 5, 'yesterday backwards still counts while today is open');
  S.toggleSunnah('siwak', today);
  s = S.streak(today);
  assert.strictEqual(s.current, 6);
  assert.ok(s.longest >= 6);
});

test('a gap breaks the streak', () => {
  fresh();
  const today = new Date(2026, 8, 10);
  [1, 2, 4, 5, 6].forEach((back) => S.toggleSunnah('siwak', new Date(2026, 8, 10 - back)));
  const s = S.streak(today);
  assert.strictEqual(s.current, 2);
  assert.strictEqual(s.longest, 3);
});

test('the heatmap returns one entry per day in order', () => {
  fresh();
  const today = new Date(2026, 8, 4);
  S.toggleSunnah('siwak', new Date(2026, 8, 2));
  const map = S.heatmap(30, today, 10);
  assert.strictEqual(map.length, 30);
  assert.strictEqual(map[29].key, '2026-09-04');
  assert.strictEqual(map[0].key, '2026-08-06');
  const hit = map.filter((m) => m.key === '2026-09-02')[0];
  assert.strictEqual(hit.percent, 10);
  assert.strictEqual(hit.active, true);
});

test('bookmarks toggle, report state and cap their length', () => {
  fresh();
  assert.strictEqual(S.isBookmarked(2, 255), false);
  assert.strictEqual(S.toggleBookmark(2, 255, 'آية الكرسي'), true);
  assert.strictEqual(S.isBookmarked(2, 255), true);
  assert.strictEqual(S.bookmarks()[0].note, 'آية الكرسي');
  assert.strictEqual(S.toggleBookmark(2, 255), false);
  assert.strictEqual(S.isBookmarked(2, 255), false);
  for (let i = 1; i <= 310; i++) S.toggleBookmark(1, i);
  assert.strictEqual(S.bookmarks().length, 300);
});

test('reading progress records surahs and ayahs without duplicates', () => {
  fresh();
  S.markSurahRead(1);
  S.markSurahRead(1);
  S.markAyahRead(2, 255);
  S.markAyahRead(2, 255);
  S.markAyahRead(2, 256);
  const p = S.progress();
  assert.deepStrictEqual(p.completed, [1]);
  assert.deepStrictEqual(p.ayahs['2'], [255, 256]);
  S.resetProgress();
  assert.deepStrictEqual(S.progress().completed, []);
});

test('an older install keeps its font size, hijri shift and quran progress', () => {
  fresh({
    'sunnati_fontSize': '130',
    'sunnati_hijri_adj': '-1',
    'sunnati_dark': '1',
    'sunnati_quran_progress': JSON.stringify({ completed: [1, 112], ayahs: { '2': [255] } })
  });
  const moved = S.migrate();
  assert.ok(moved >= 2, 'expected migration to move several values');
  assert.strictEqual(S.get('fontScale'), 130);
  assert.strictEqual(S.get('hijriAdjust'), -1);
  assert.strictEqual(S.get('theme'), 'dark');
  assert.deepStrictEqual(S.progress().completed, [1, 112]);
});

test('migration leaves a current install untouched', () => {
  fresh();
  S.set('fontScale', 90);
  S.migrate();
  assert.strictEqual(S.get('fontScale'), 90);
});

test('export and import round trip every key the app owns', () => {
  const st = fresh();
  S.set('method', 'Makkah');
  S.toggleBookmark(36, 1);
  S.toggleSunnah('duha', new Date(2026, 8, 4));
  const dump = S.exportAll();
  assert.ok(dump.indexOf('sunnati.settings') !== -1);

  const target = fakeStorage();
  S.attach(target);
  S.resetSettings();
  assert.strictEqual(S.get('method'), 'Kuwait', 'the new storage starts empty');
  const result = S.importAll(dump);
  assert.strictEqual(result.ok, true);
  assert.ok(result.count >= 3);
  assert.strictEqual(S.get('method'), 'Makkah');
  assert.strictEqual(S.isBookmarked(36, 1), true);
  assert.strictEqual(S.completion(new Date(2026, 8, 4), 10).done, 1);
  assert.ok(Object.keys(st._map).length > 0);
});

test('import refuses files that are not our backups', () => {
  fresh();
  assert.strictEqual(S.importAll('not json').ok, false);
  assert.strictEqual(S.importAll(JSON.stringify({ app: 'other', data: {} })).ok, false);
  assert.strictEqual(S.importAll(JSON.stringify({ app: 'sunnati' })).ok, false);
});

test('import ignores keys outside the app namespace', () => {
  fresh();
  const res = S.importAll(JSON.stringify({
    app: 'sunnati',
    data: { 'sunnati.settings': '{"method":"Egypt"}', 'evil.key': 'x' }
  }));
  assert.strictEqual(res.count, 1);
  assert.strictEqual(S.get('method'), 'Egypt');
});

test('pruning drops records older than the retention window', () => {
  const st = fresh();
  S.toggleSunnah('siwak', new Date(2024, 0, 1));
  S.toggleSunnah('siwak', new Date(2026, 8, 3));
  const removed = S.prune(new Date(2026, 8, 4));
  assert.strictEqual(removed, 1);
  assert.strictEqual(st._map['sunnati.day.2026-09-03'] !== undefined, true);
  assert.strictEqual(st._map['sunnati.day.2024-01-01'], undefined);
});

test('clearing removes only keys the app owns', () => {
  const st = fresh({ 'unrelated': 'keep me' });
  S.set('method', 'Qatar');
  S.toggleBookmark(1, 1);
  S.clearAll();
  assert.strictEqual(st._map['unrelated'], 'keep me');
  assert.strictEqual(S.get('method'), 'Kuwait');
});

test('a storage backend that refuses writes does not throw', () => {
  S.attach({
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('nope'); },
    key: () => undefined,
    length: 0
  });
  S.resetSettings();
  assert.doesNotThrow(() => S.set('method', 'Dubai'));
  assert.doesNotThrow(() => S.toggleBookmark(1, 1));
  assert.doesNotThrow(() => S.clearAll());
});

test('khatma pages accumulate and stay inside the mushaf', () => {
  fresh();
  S.resetProgress();
  assert.strictEqual(S.progress().pagesRead, 0);
  assert.strictEqual(S.addReadPages(5), 5);
  assert.strictEqual(S.addReadPages(3), 8);
  assert.strictEqual(S.addReadPages(-2), 6);
  assert.strictEqual(S.addReadPages(-100), 0, 'a reader cannot owe pages');
  assert.strictEqual(S.setReadPages(9999), 604, 'the mushaf ends at six hundred and four');
  assert.strictEqual(S.setReadPages(-5), 0);
});

test('reading pages also marks the day as active', () => {
  fresh();
  S.resetProgress();
  assert.strictEqual(S.wasActive(new Date()), false);
  S.addReadPages(2);
  assert.strictEqual(S.day().pages, 2);
  assert.strictEqual(S.wasActive(new Date()), true);
});

test('stepping back does not undo the day record', () => {
  fresh();
  S.resetProgress();
  S.addReadPages(4);
  S.addReadPages(-1);
  assert.strictEqual(S.progress().pagesRead, 3);
  assert.strictEqual(S.day().pages, 4, 'the day still saw four pages read');
});
