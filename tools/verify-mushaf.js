#!/usr/bin/env node
/* Checks the shipped mushaf against the counts every printed copy agrees on.
   Run with: node tools/verify-mushaf.js
   Exits non zero if anything is off, so a bad text can never ship quietly. */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'mushaf.json'), 'utf8'));

/* Verse counts in the reading of Hafs an Asim, the counting of Kufa. */
const AYAH_COUNTS = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109,
  123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60,
  34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45,
  60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
  28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20,
  15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3,
  5, 4, 5, 6
];

/* Where each of the thirty parts begins. */
const JUZ_STARTS = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41],
  [9, 93], [11, 6], [12, 53], [15, 1], [17, 1], [18, 75], [21, 1], [23, 1], [25, 21], [27, 56],
  [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1]
];

/* The fifteen places of prostration. */
const SAJDAS = [
  [7, 206], [13, 15], [16, 50], [17, 109], [19, 58], [22, 18], [22, 77], [25, 60],
  [27, 26], [32, 15], [38, 24], [41, 38], [53, 62], [84, 21], [96, 19]
];

const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

/* A shadda and a vowel on the same letter may be stored in either order and
   still be the same text, so every comparison goes through NFC first. */
function same(a, b) { return String(a).normalize('NFC') === String(b).normalize('NFC'); }
function starts(a, b) { return String(a).normalize('NFC').indexOf(String(b).normalize('NFC')) === 0; }
function holds(a, b) { return String(a).normalize('NFC').indexOf(String(b).normalize('NFC')) !== -1; }

/* Letters, marks and the space are all that a verse may contain. */
const ALLOWED = /^[\u0621-\u065F\u0670\u0671-\u06D5\u06D6-\u06ED\u0640\u08F0-\u08FF ]+$/;

let failures = 0;
let checks = 0;

function check(label, ok, detail) {
  checks++;
  if (!ok) {
    failures++;
    console.log('  FAIL  ' + label + (detail ? '  ::  ' + detail : ''));
  }
  return ok;
}

function section(name) { console.log('\n' + name); }

/* ---------------- shape ---------------- */

section('shape of the payload');
check('one hundred and fourteen surahs', payload.a.length === 114, 'found ' + payload.a.length);
check('thirty parts', payload.j.length === 30, 'found ' + payload.j.length);
check('six hundred and four pages', payload.p.length === 604, 'found ' + payload.p.length);
check('fifteen places of prostration', payload.s.length === 15, 'found ' + payload.s.length);
check('the basmala is carried once', same(payload.b, BASMALA), JSON.stringify(payload.b));

/* ---------------- verse counts ---------------- */

section('verse counts, surah by surah');
let total = 0;
for (let i = 0; i < 114; i++) {
  const got = payload.a[i] ? payload.a[i].length : 0;
  total += got;
  check('surah ' + (i + 1) + ' holds ' + AYAH_COUNTS[i] + ' verses', got === AYAH_COUNTS[i], 'found ' + got);
}
const expectedTotal = AYAH_COUNTS.reduce((a, b) => a + b, 0);
check('the table itself sums to 6236', expectedTotal === 6236, 'sums to ' + expectedTotal);
check('the text holds 6236 verses', total === 6236, 'found ' + total);

/* ---------------- every verse is real text ---------------- */

section('every verse carries text');
let empties = 0, strange = 0, shortest = { len: Infinity }, longest = { len: 0 };
for (let s = 0; s < 114; s++) {
  for (let a = 0; a < payload.a[s].length; a++) {
    const verse = payload.a[s][a];
    const ref = (s + 1) + ':' + (a + 1);
    if (typeof verse !== 'string' || !verse.trim().length) { empties++; console.log('  FAIL  empty verse at ' + ref); continue; }
    if (!ALLOWED.test(verse)) {
      strange++;
      if (strange <= 5) {
        const bad = [...verse].filter((c) => !ALLOWED.test(c));
        console.log('  FAIL  ' + ref + ' holds ' + JSON.stringify(bad.slice(0, 4).join('')) +
          ' (' + bad.slice(0, 4).map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ') + ')');
      }
    }
    if (verse.length < shortest.len) shortest = { len: verse.length, ref: ref, text: verse };
    if (verse.length > longest.len) longest = { len: verse.length, ref: ref };
    if (verse !== verse.trim()) console.log('  FAIL  ' + ref + ' has loose space at an edge');
  }
}
check('no verse is empty', empties === 0, empties + ' empty');
check('no verse holds a character outside arabic', strange === 0, strange + ' with strange characters');
console.log('  shortest verse ' + shortest.ref + ' (' + shortest.len + ' chars) ' + shortest.text);
console.log('  longest verse  ' + longest.ref + ' (' + longest.len + ' chars)');

/* ---------------- the basmala ---------------- */

section('the basmala');
check('al fatiha counts it as its first verse', same(payload.a[0][0], BASMALA), JSON.stringify(payload.a[0][0]));
let carried = 0;
for (let s = 1; s < 114; s++) {
  if (starts(payload.a[s][0], 'بِسْمِ ٱللَّهِ')) { carried++; console.log('  FAIL  surah ' + (s + 1) + ' still carries the basmala in its first verse'); }
}
check('no other surah repeats it inside the text', carried === 0, carried + ' surahs do');
check('at tawba opens with baraa', starts(payload.a[8][0], 'بَرَآءَة'), JSON.stringify(payload.a[8][0].slice(0, 20)));
check('an naml carries it inside verse thirty', holds(payload.a[26][29], 'بِسْمِ ٱللَّهِ'),
  'the letter of Sulayman should quote it');

/* ---------------- the parts ---------------- */

section('the thirty parts');
for (let i = 0; i < 30; i++) {
  const got = payload.j[i];
  const want = JUZ_STARTS[i];
  check('part ' + (i + 1) + ' begins at ' + want[0] + ':' + want[1],
    got && got[0] === want[0] && got[1] === want[1], 'found ' + JSON.stringify(got));
}

/* ---------------- the pages ---------------- */

section('the pages');
check('page one opens the mushaf', payload.p[0][0] === 1 && payload.p[0][1] === 1, JSON.stringify(payload.p[0]));
check('page one hundred opens in an nisa', payload.p[99][0] === 4, JSON.stringify(payload.p[99]));
let backwards = 0, outside = 0;
for (let i = 1; i < 604; i++) {
  const prev = payload.p[i - 1], now = payload.p[i];
  if (now[0] < prev[0] || (now[0] === prev[0] && now[1] <= prev[1])) {
    backwards++;
    if (backwards <= 3) console.log('  FAIL  page ' + (i + 1) + ' starts at ' + now + ' which is not after page ' + i + ' at ' + prev);
  }
  if (now[0] < 1 || now[0] > 114 || now[1] < 1 || now[1] > AYAH_COUNTS[now[0] - 1]) {
    outside++;
    if (outside <= 3) console.log('  FAIL  page ' + (i + 1) + ' points at ' + now + ' which is not a verse');
  }
}
check('every page starts after the one before it', backwards === 0, backwards + ' out of order');
check('every page points at a verse that exists', outside === 0, outside + ' outside the text');
check('the last page opens with al ikhlas', payload.p[603][0] === 112 && payload.p[603][1] === 1,
  JSON.stringify(payload.p[603]));
check('the three closing surahs share the last page',
  payload.p[602][0] === 109, JSON.stringify(payload.p[602]));

/* ---------------- the prostrations ---------------- */

section('the places of prostration');
const shipped = payload.s.map((x) => x.join(':')).sort();
const wanted = SAJDAS.map((x) => x.join(':')).sort();
check('the fifteen match the printed copy', shipped.join(',') === wanted.join(','),
  '\n    shipped ' + shipped.join(' ') + '\n    wanted  ' + wanted.join(' '));
payload.s.forEach(function (pair) {
  check('prostration at ' + pair.join(':') + ' names a real verse',
    pair[0] >= 1 && pair[0] <= 114 && pair[1] >= 1 && pair[1] <= AYAH_COUNTS[pair[0] - 1]);
});

/* ---------------- landmarks a reader would notice ---------------- */

section('verses a reader knows by heart');
const LANDMARKS = [
  [1, 2, 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'],
  [2, 255, 'ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلْحَىُّ ٱلْقَيُّومُ'],
  [112, 1, 'قُلْ هُوَ ٱللَّهُ أَحَدٌ'],
  [114, 6, 'مِنَ ٱلْجِنَّةِ وَٱلنَّاسِ']
];
LANDMARKS.forEach(function (row) {
  const verse = payload.a[row[0] - 1][row[1] - 1];
  check(row[0] + ':' + row[1] + ' reads as it should', starts(verse, row[2]),
    '\n    got  ' + JSON.stringify(verse.slice(0, 60)) + '\n    want ' + JSON.stringify(row[2]));
});
check('the longest verse is the verse of debt, 2:282', longest.ref === '2:282', 'longest is ' + longest.ref);

/* ---------------- the text as a whole ---------------- */

section('the text as a whole');
/* Taken once from a run where all 6236 verses were compared, letter for letter,
   against the Tanzil uthmani edition served by api.alquran.cloud. Any later
   change to a single mark anywhere will move this. */
const KNOWN_DIGEST = '58ab3a39d8d7f8aa3daade1ee3993421814e06e5534ba443448aae5f12c5cf0f';
const digest = crypto.createHash('sha256')
  .update(payload.a.map(function (s) { return s.join('\n'); }).join('\n'), 'utf8')
  .digest('hex');
check('the text still matches the copy that was verified verse by verse',
  digest === KNOWN_DIGEST, '\n    found ' + digest + '\n    known ' + KNOWN_DIGEST);

/* ---------------- verdict ---------------- */

console.log('\n' + (failures ? 'FAILED ' + failures + ' of ' + checks + ' checks'
  : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
