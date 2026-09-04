/* Checks the hijri conversion, the day shift control and occasion detection. */
const test = require('node:test');
const assert = require('node:assert');
const H = require('../docs/js/hijri.js');

test('platform calendar is available in this runtime', () => {
  assert.ok(H.hasPlatformCalendar(), 'expected Umm al Qura support');
});

test('known civil dates convert to the expected hijri dates', () => {
  const cases = [
    { g: [2026, 8, 4], h: [1448, 3, 22] },
    { g: [2025, 2, 30], h: [1446, 10, 1] },   // eid al fitr 1446
    { g: [2025, 5, 6], h: [1446, 12, 10] },   // eid al adha 1446
    { g: [2026, 1, 18], h: [1447, 9, 1] }     // first of ramadan 1447
  ];
  cases.forEach(function (c) {
    const d = new Date(c.g[0], c.g[1], c.g[2]);
    const h = H.toHijri(d, 0);
    assert.strictEqual(h.y, c.h[0], 'year for ' + d.toDateString());
    assert.strictEqual(h.m, c.h[1], 'month for ' + d.toDateString());
    assert.strictEqual(h.d, c.h[2], 'day for ' + d.toDateString());
  });
});

test('month and weekday names come back in arabic', () => {
  const h = H.toHijri(new Date(2026, 8, 4), 0);
  assert.strictEqual(h.monthName, 'ربيع الأول');
  assert.strictEqual(h.weekday, 'الجمعة');
  assert.strictEqual(H.format(h), '٢٢ ربيع الأول ١٤٤٨ هـ');
});

test('the day shift control moves the hijri date by whole days', () => {
  const d = new Date(2026, 8, 4);
  const base = H.toHijri(d, 0);
  assert.strictEqual(H.toHijri(d, 1).d, base.d + 1);
  assert.strictEqual(H.toHijri(d, -1).d, base.d - 1);
});

test('arabic digits replace every latin digit', () => {
  assert.strictEqual(H.toArabicDigits(1448), '١٤٤٨');
  assert.strictEqual(H.toArabicDigits('9:05'), '٩:٠٥');
  assert.strictEqual(H.toArabicDigits(0), '٠');
});

test('round trip between the two calendars is stable across a hijri year', () => {
  for (let m = 1; m <= 12; m++) {
    for (const d of [1, 15, 29]) {
      const g = H.toGregorian(1448, m, d, 0);
      assert.ok(g, 'no civil date for 1448/' + m + '/' + d);
      const back = H.toHijri(g, 0);
      assert.strictEqual(back.y, 1448, 'year round trip 1448/' + m + '/' + d);
      assert.strictEqual(back.m, m, 'month round trip 1448/' + m + '/' + d);
      assert.strictEqual(back.d, d, 'day round trip 1448/' + m + '/' + d);
    }
  }
});

test('mondays and thursdays are flagged for fasting', () => {
  const monday = new Date(2026, 8, 7);
  const thursday = new Date(2026, 8, 10);
  const tuesday = new Date(2026, 8, 8);
  assert.strictEqual(monday.getDay(), 1);
  assert.ok(H.occasions(monday, 0).some(function (o) { return o.key === 'mondayThursday'; }));
  assert.ok(H.occasions(thursday, 0).some(function (o) { return o.key === 'mondayThursday'; }));
  assert.ok(!H.occasions(tuesday, 0).some(function (o) { return o.key === 'mondayThursday'; }));
});

test('the white days are flagged on the thirteenth through fifteenth', () => {
  for (const day of [13, 14, 15]) {
    const g = H.toGregorian(1448, 4, day, 0);
    assert.ok(H.occasions(g, 0).some(function (o) { return o.key === 'white'; }), 'day ' + day);
  }
  const g12 = H.toGregorian(1448, 4, 12, 0);
  assert.ok(!H.occasions(g12, 0).some(function (o) { return o.key === 'white'; }));
});

test('arafah, ashura and both eids are detected', () => {
  const checks = [
    { m: 12, d: 9, key: 'arafah' },
    { m: 12, d: 10, key: 'eidAdha' },
    { m: 1, d: 10, key: 'ashura' },
    { m: 10, d: 1, key: 'eidFitr' }
  ];
  checks.forEach(function (c) {
    const g = H.toGregorian(1448, c.m, c.d, 0);
    assert.ok(g, 'missing civil date for ' + c.key);
    const keys = H.occasions(g, 0).map(function (o) { return o.key; });
    assert.ok(keys.indexOf(c.key) !== -1, c.key + ' not detected, got ' + keys.join(','));
  });
});

test('ramadan days report the month and the odd nights of the last ten', () => {
  const mid = H.toGregorian(1448, 9, 15, 0);
  assert.ok(H.occasions(mid, 0).some(function (o) { return o.key === 'ramadan'; }));
  const night27 = H.toGregorian(1448, 9, 27, 0);
  const keys = H.occasions(night27, 0).map(function (o) { return o.key; });
  assert.ok(keys.indexOf('laylatQadr') !== -1);
});

test('upcoming events are sorted and never negative', () => {
  const list = H.upcoming(new Date(2026, 8, 4), 0);
  assert.ok(list.length >= 4, 'expected several upcoming events');
  for (let i = 0; i < list.length; i++) {
    assert.ok(list[i].days >= 0, list[i].name + ' should not be in the past');
    if (i > 0) assert.ok(list[i].days >= list[i - 1].days, 'events out of order');
  }
  const ramadan = list.filter(function (x) { return x.name === 'رمضان'; })[0];
  assert.ok(ramadan && ramadan.days > 0 && ramadan.days < 400);
});

test('days between ignores the clock and counts calendar days', () => {
  const a = new Date(2026, 8, 4, 23, 59);
  const b = new Date(2026, 8, 5, 0, 1);
  assert.strictEqual(H.daysBetween(a, b), 1);
  assert.strictEqual(H.daysBetween(a, a), 0);
});

test('the day of the week belongs to the date, not to the adjustment', () => {
  const friday = new Date(2026, 8, 4);
  assert.strictEqual(friday.getDay(), 5, 'the fixture is a friday');
  const names = [-2, -1, 0, 1, 2].map(function (a) { return H.toHijri(friday, a).weekday; });
  assert.deepStrictEqual(new Set(names).size, 1, 'the weekday moved: ' + names.join(', '));
  assert.strictEqual(names[0], 'الجمعة');

  /* the month day is what the adjustment is for, and it does move */
  const days = [-1, 0, 1].map(function (a) { return H.toHijri(friday, a).d; });
  assert.strictEqual(days[1] - days[0], 1);
  assert.strictEqual(days[2] - days[1], 1);
});
