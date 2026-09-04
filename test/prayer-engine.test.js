/* Validates the offline prayer engine against reference timings captured from
   api.aladhan.com for ten cities across three dates and eight calculation methods.
   Run with: node --test test/prayer-engine.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PE = require('../docs/js/prayer-engine.js');

const METHOD_BY_ID = {};
Object.keys(PE.METHODS).forEach(function (k) { METHOD_BY_ID[PE.METHODS[k].id] = k; });

function toMinutes(hhmm) {
  const p = hhmm.split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

function loadReference() {
  const p = path.join(__dirname, 'fixtures', 'timings.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('every calculation method carries a name and an isha rule', () => {
  Object.keys(PE.METHODS).forEach(function (k) {
    const m = PE.METHODS[k];
    assert.ok(m.name.length > 0, k + ' needs a name');
    assert.ok(typeof m.isha === 'number' || typeof m.ishaMin === 'number', k + ' needs an isha rule');
    assert.ok(m.fajr > 0 && m.fajr < 25, k + ' fajr angle out of range');
  });
});

test('prayer times match reference timings', () => {
  const ref = loadReference();
  assert.ok(ref.length >= 20, 'fixture set too small');
  const keys = { Fajr: 'fajr', Sunrise: 'sunrise', Dhuhr: 'dhuhr', Asr: 'asr', Maghrib: 'maghrib', Isha: 'isha' };
  let checked = 0, exact = 0, sum = 0;
  const worst = { delta: 0, where: '' };

  ref.forEach(function (row) {
    const method = METHOD_BY_ID[row.method];
    assert.ok(method, 'unknown method id ' + row.method);
    const parts = row.date.split('-');
    const date = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]), 12, 0, 0);
    const calc = new PE.Calculator({ lat: row.lat, lng: row.lng, method: method });
    const got = calc.timesFor(date, row.tz);

    Object.keys(keys).forEach(function (label) {
      const expected = toMinutes(row.t[label]);
      const actual = got[keys[label]];
      assert.ok(!isNaN(actual), row.city + ' ' + label + ' produced NaN');
      let delta = Math.abs(actual - expected);
      if (delta > 720) delta = 1440 - delta;
      if (delta === 0) exact++;
      sum += delta;
      if (delta > worst.delta) { worst.delta = delta; worst.where = row.city + ' ' + row.date + ' ' + label; }
      assert.ok(delta <= 2,
        row.city + ' ' + row.date + ' ' + label + ' expected ' + row.t[label] +
        ' got ' + PE.format(actual) + ' (delta ' + delta + ' min)');
      checked++;
    });
  });

  const mean = sum / checked;
  assert.ok(checked >= 120, 'expected at least 120 comparisons, ran ' + checked);
  assert.ok(mean < 0.15, 'mean absolute delta ' + mean.toFixed(3) + ' min is too high');
  // The engine refines the sun position at each computed time, while the reference
  // service refines once from a fixed guess, so a few asr values at high latitude
  // land a minute or two apart. Every other prayer agrees to the minute.
  assert.ok(exact / checked > 0.85, 'only ' + exact + ' of ' + checked + ' timings matched to the minute');
  console.log('    compared ' + checked + ' timings, ' + exact + ' exact, mean ' +
    mean.toFixed(3) + ' min, worst ' + worst.delta + ' min at ' + worst.where);
});

test('fajr, dhuhr and maghrib match the reference to the minute everywhere', () => {
  const ref = loadReference();
  ref.forEach(function (row) {
    const parts = row.date.split('-');
    const date = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]), 12, 0, 0);
    const got = new PE.Calculator({ lat: row.lat, lng: row.lng, method: METHOD_BY_ID[row.method] }).timesFor(date, row.tz);
    ['Fajr', 'Dhuhr', 'Maghrib'].forEach(function (label) {
      const key = label.toLowerCase();
      assert.strictEqual(PE.format(got[key]), row.t[label],
        row.city + ' ' + row.date + ' ' + label);
    });
  });
});

test('hanafi asr falls after shafi asr', () => {
  const date = new Date(2026, 8, 4, 12);
  const shafi = new PE.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Kuwait', asr: 'shafi' }).timesFor(date, 3);
  const hanafi = new PE.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Kuwait', asr: 'hanafi' }).timesFor(date, 3);
  assert.ok(hanafi.asr > shafi.asr, 'hanafi asr should be later');
  assert.ok(hanafi.asr - shafi.asr > 20, 'hanafi asr should be meaningfully later');
  assert.strictEqual(shafi.fajr, hanafi.fajr, 'asr school must not move fajr');
});

test('fixed interval isha methods sit ninety minutes after maghrib', () => {
  const date = new Date(2026, 2, 15, 12);
  const t = new PE.Calculator({ lat: 21.4225, lng: 39.8262, method: 'Makkah' }).timesFor(date, 3);
  assert.strictEqual(t.isha - t.maghrib, 90);
});

test('high latitude nights still produce a fajr and an isha', () => {
  const date = new Date(2026, 5, 21, 12);
  const t = new PE.Calculator({ lat: 64.1466, lng: -21.9426, method: 'MWL', highLat: 'nightMiddle' }).timesFor(date, 0);
  ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(function (k) {
    assert.ok(!isNaN(t[k]), k + ' should not be NaN at high latitude');
  });
});

test('manual offsets shift only the prayer they target', () => {
  const date = new Date(2026, 8, 4, 12);
  const base = new PE.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Kuwait' }).timesFor(date, 3);
  const tuned = new PE.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Kuwait', offsets: { fajr: -5, isha: 7 } }).timesFor(date, 3);
  assert.strictEqual(tuned.fajr, base.fajr - 5);
  assert.strictEqual(tuned.isha, base.isha + 7);
  assert.strictEqual(tuned.asr, base.asr);
});

test('qibla bearing and distance are correct for known cities', () => {
  const cases = [
    { name: 'Kuwait', lat: 29.3759, lng: 47.9774, bearing: 224.6, km: 1195 },
    { name: 'Cairo', lat: 30.0444, lng: 31.2357, bearing: 136, km: 1268 },
    { name: 'Jakarta', lat: -6.2088, lng: 106.8456, bearing: 295, km: 7912 },
    { name: 'London', lat: 51.5074, lng: -0.1278, bearing: 119, km: 4770 }
  ];
  cases.forEach(function (c) {
    const b = PE.qibla(c.lat, c.lng);
    const d = PE.distanceToKaaba(c.lat, c.lng);
    assert.ok(Math.abs(b - c.bearing) <= 2, c.name + ' bearing ' + b.toFixed(1) + ' expected near ' + c.bearing);
    assert.ok(Math.abs(d - c.km) <= 60, c.name + ' distance ' + d + ' expected near ' + c.km);
  });
  assert.strictEqual(PE.distanceToKaaba(21.4224779, 39.8251832), 0);
});

test('formatting pads hours and minutes and wraps past midnight', () => {
  assert.strictEqual(PE.format(0), '00:00');
  assert.strictEqual(PE.format(65), '01:05');
  assert.strictEqual(PE.format(1439), '23:59');
  assert.strictEqual(PE.format(1500), '01:00');
  assert.strictEqual(PE.format(NaN), '--:--');
});

test('times stay ordered through a full year in Kuwait', () => {
  const calc = new PE.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Kuwait' });
  for (let day = 0; day < 365; day += 5) {
    const d = new Date(2026, 0, 1 + day, 12);
    const t = calc.timesFor(d, 3);
    assert.ok(t.fajr < t.sunrise, 'fajr before sunrise on day ' + day);
    assert.ok(t.sunrise < t.dhuhr, 'sunrise before dhuhr on day ' + day);
    assert.ok(t.dhuhr < t.asr, 'dhuhr before asr on day ' + day);
    assert.ok(t.asr < t.maghrib, 'asr before maghrib on day ' + day);
    assert.ok(t.maghrib < t.isha, 'maghrib before isha on day ' + day);
  }
});

/* ---------------- clocks that move ---------------- */

test('a zone reports the offset it is actually on for the day', () => {
  const june = new Date('2026-06-21T12:00:00Z');
  const december = new Date('2026-12-21T12:00:00Z');
  const pairs = [
    ['Europe/London', 1, 0], ['Europe/Paris', 2, 1],
    ['America/New_York', -4, -5], ['Australia/Sydney', 10, 11],
    ['Asia/Kuwait', 3, 3], ['Asia/Dubai', 4, 4]
  ];
  pairs.forEach(function (p) {
    assert.strictEqual(PE.zoneOffset(p[0], june), p[1], p[0] + ' in june');
    assert.strictEqual(PE.zoneOffset(p[0], december), p[2], p[0] + ' in december');
  });
});

test('an unknown or missing zone says so rather than guessing', () => {
  assert.strictEqual(PE.zoneOffset('Not/AZone', new Date()), null);
  assert.strictEqual(PE.zoneOffset(null, new Date()), null);
  assert.strictEqual(PE.zoneOffset('', new Date()), null);
});

test('a stored offset would put iftar an hour late in ramadan', () => {
  /* Morocco keeps one hour ahead all year and steps back for ramadan, so a
     number saved once is wrong for the whole month. This is the case that
     made the zone lookup necessary. */
  const inRamadan = new Date('2026-03-10T12:00:00Z');
  const live = PE.zoneOffset('Africa/Casablanca', inRamadan);
  assert.strictEqual(live, 0, 'morocco steps back to GMT for ramadan');

  const rabat = new PE.Calculator({ lat: 34.0209, lng: -6.8416, method: 'Morocco' });
  const correct = rabat.timesFor(new Date('2026-03-10T12:00:00'), live);
  const stale = rabat.timesFor(new Date('2026-03-10T12:00:00'), 1);
  assert.strictEqual(stale.maghrib - correct.maghrib, 60, 'the stored number is a full hour out');

  const ordinary = new Date('2026-06-21T12:00:00Z');
  assert.strictEqual(PE.zoneOffset('Africa/Casablanca', ordinary), 1, 'and one hour ahead the rest of the year');
});

test('a method carries the minute adjustments its authority publishes', () => {
  const turkey = new PE.Calculator({ lat: 41.0082, lng: 28.9784, method: 'Turkey' });
  assert.deepStrictEqual(turkey.offsets, { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7 });

  const dubai = new PE.Calculator({ lat: 25.2048, lng: 55.2708, method: 'Dubai' });
  assert.deepStrictEqual(dubai.offsets, { dhuhr: 3, maghrib: 3 });

  const morocco = new PE.Calculator({ lat: 34.0209, lng: -6.8416, method: 'Morocco' });
  assert.deepStrictEqual(morocco.offsets, { dhuhr: 5, maghrib: 5 });

  const kuwait = new PE.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Kuwait' });
  assert.deepStrictEqual(kuwait.offsets, {}, 'a method without adjustments gets none');
});

test('the published adjustments actually move the times', () => {
  const plain = new PE.Calculator({ lat: 41.0082, lng: 28.9784, method: 'MWL' });
  const diyanet = new PE.Calculator({ lat: 41.0082, lng: 28.9784, method: 'Turkey' });
  const a = plain.timesFor(new Date('2026-09-04T12:00:00'), 3);
  const b = diyanet.timesFor(new Date('2026-09-04T12:00:00'), 3);
  /* both use eighteen and seventeen degrees, so only the adjustments differ */
  assert.strictEqual(b.sunrise - a.sunrise, -7);
  assert.strictEqual(b.dhuhr - a.dhuhr, 5);
  assert.strictEqual(b.maghrib - a.maghrib, 7);
  assert.strictEqual(b.fajr - a.fajr, 0);
});

test('a caller can adjust on top of what the method already carries', () => {
  const c = new PE.Calculator({ lat: 41.0082, lng: 28.9784, method: 'Turkey', offsets: { dhuhr: 2, fajr: -1 } });
  assert.strictEqual(c.offsets.dhuhr, 7, 'the two add together');
  assert.strictEqual(c.offsets.fajr, -1);
  assert.strictEqual(c.offsets.maghrib, 7, 'and the rest are left alone');
});

test('the far north keeps its prayers in order whichever rule is chosen', () => {
  const solstice = new Date('2026-06-21T12:00:00');
  ['angleBased', 'nightMiddle', 'oneSeventh'].forEach(function (rule) {
    const t = new PE.Calculator({ lat: 51.5074, lng: -0.1278, method: 'MWL', highLat: rule })
      .timesFor(solstice, 1);
    ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(function (k) {
      assert.ok(!isNaN(t[k]), rule + ' left ' + k + ' undefined');
    });
    assert.ok(t.fajr < t.sunrise, rule + ' put fajr after sunrise');
    assert.ok(t.sunrise < t.dhuhr && t.dhuhr < t.asr && t.asr < t.maghrib,
      rule + ' put the day out of order');
  });
});
