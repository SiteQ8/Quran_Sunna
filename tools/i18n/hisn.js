#!/usr/bin/env node
/* The meanings of Hisn al-Muslim in English, from the book's own site,
   hisnmuslim.com, which publishes it with an English translation of every
   dhikr. The app's chapters (HISN in docs/data/hisn.js) carry the site's own
   numbers, chapter and dhikr alike, so each dhikr is matched by its number;
   the app's daily adhkar (AZKAR_DB in docs/data/azkar.js) are the same texts
   in its own order, often cut into the pieces the reader says one by one, and
   are matched by their Arabic to the chapters' dhikr.

   A meaning is shown only where it is that dhikr's: the daily text has to be
   found in the book's, and the book's in it, both nearly whole; a phrase of
   a few words only where the book has that phrase alone; and of two with the
   same words, the one said as many times as the app counts. A daily text the
   app stops short of, or cuts into pieces, carries the meaning of the book's
   whole dhikr on its first piece; a few the reading cannot settle are read
   by hand (HAND). What is not matched shows its Arabic alone: the app never
   writes a meaning of its own.

   Written into docs/data/meanings/hisn-en.json: by the dhikr's number, the
   translation as published; and by the daily list and place, the number.

     node tools/i18n/hisn.js              read the site, then match
     node tools/i18n/hisn.js --offline    match again from the file written
     node tools/i18n/hisn.js --review     and print every daily decision */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'data', 'meanings');
const FILE = path.join(OUT, 'hisn-en.json');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const res = await fetch(url);
      if (res.ok) return JSON.parse((await res.text()).replace(/^\uFEFF/, ''));
    } catch (e) { /* again */ }
    await wait(1500 * (tries + 1));
  }
  throw new Error('could not read ' + url);
}

/* The app's typography writes no long dash: the few the site's English has
   become the hyphen, where they stand, every word and space as published. */
function dashes(text) {
  return String(text).replace(/[\u2013\u2014]/g, '-');
}

/* the letters without their vowel marks */
function plain(text) {
  return String(text || '').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '');
}

function bare(text) {
  return plain(text)
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A]+/g, ' ').trim();
}

/* what is compared: the words alone, with what only one side writes taken
   out (how many times, said in brackets; the blessing written as words where
   the other has ﷺ), and the evening's words read as the morning's, since the
   book gives a dhikr once with its evening wording beside it */
const TIMES = /\(([^()]*?(?:مرة|مره|مرات|ثلاث|سبع|عشر|مائ|مئ|أربع|اربع)[^()]*?)\)/g;
/* and how many times said at the end without brackets, «عشر مرات بعد صلاة المغرب» */
const AFTER = /\s(?:ثلاث|سبع|عشر|مائة|مئة|أربع)\S*\s+مر\S*[^()]*$/;
const EVENING = { 'امسينا': 'اصبحنا', 'امسي': 'اصبح', 'امسيت': 'اصبحت', 'الليله': 'اليوم', 'بعدها': 'بعده', 'هذه': 'هذا' };
function words(text) {
  const s = (' ' + bare(plain(text).replace(TIMES, ' ').replace(AFTER, ' ')) + ' ').replace(/ صلي الله عليه وسلم /g, ' ');
  return s.trim().split(' ').filter(Boolean).map(function (w) {
    const joined = /^([وف]?)(.+)$/.exec(w);
    return EVENING[joined[2]] ? joined[1] + EVENING[joined[2]] : w;
  });
}

/* how much of a is found in b, counting each word once: a dhikr that says
   «الله» five times is not five times more like another that says it once */
function cover(a, b) {
  const own = Array.from(new Set(a));
  if (!own.length) return 0;
  const set = new Set(b);
  let hit = 0;
  own.forEach(function (w) { if (set.has(w)) hit++; });
  return hit / own.length;
}

/* Daily texts the reading above cannot settle, read by hand against the
   book: the number of the dhikr whose meaning is theirs. Each says what the
   book's says, in other words: the app writes the instruction around it
   in its own way, or keeps the blessing on the Prophet ﷺ where the app's
   copy of the chapter put it in a note. */
const HAND = {
  'mosque#0': 20,     /* entering the mosque, the blessing in the book's note */
  'adhan#2': 24,      /* the blessing on the Prophet ﷺ after the adhan */
  'istighfar#0': 250, /* the book gives it inside the hadith that teaches it */
  'sick#3': 243,      /* the hand on the pain, Bismillah three times, then seven */
  'food#1': 178,      /* Bismillah at its beginning and end, for one who forgot */
  'afterprayer#0': 66, /* forgiveness three times, then As-Salam: one dhikr in the book */
  'afterprayer#7': 69, /* the hundredth after the three thirty-threes, as the book says it */
  'food#4': 179,      /* after food, and after milk: one dhikr in the book */
  'toilet#0': 10,     /* Bismillah, which the app's copy of the chapter keeps in a note */
  'evening#16': 89    /* its evening wording, which the book gives in a note beside the morning's */
};

function load() {
  const box = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'hisn.js'), 'utf8'), box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'azkar.js'), 'utf8'), box);
  return { HISN: vm.runInContext('HISN', box), AZKAR: vm.runInContext('AZKAR_DB', box) };
}

function match(byId, review) {
  const app = load();
  /* the book's dhikr as the app's chapters write them, by the site's number */
  const pool = [];
  app.HISN.forEach(function (c) {
    c.i.forEach(function (it) {
      if (it.a && byId[it.a]) pool.push({ a: it.a, w: words(it.t), r: it.r || 1 });
    });
  });

  const daily = {};
  const lines = [];
  let found = 0, all = 0;
  Object.keys(app.AZKAR).forEach(function (k) {
    const items = app.AZKAR[k].items;
    const ids = items.map(function () { return null; });
    const how = items.map(function () { return ''; });
    const inside = items.map(function () { return []; });
    items.forEach(function (it, i) {
      const w = words(it.t);
      const short = w.length <= 3;
      let best = null, first = null;
      pool.forEach(function (p) {
        const cd = cover(w, p.w);
        const ch = cover(p.w, w);
        if (cd >= 0.85) inside[i].push(p.a);
        /* the same dhikr: each found in the other, nearly whole; and of two
           alike, the one the book says as many times as the app counts */
        if (short ? cd === 1 && ch === 1 : cd >= 0.8 && ch >= 0.6) {
          const score = Math.min(cd, ch) + (p.r === (it.c || 1) ? 0.1 : 0);
          if (!best || score > best.score) best = { a: p.a, score: score };
        }
        /* the beginning of the book's dhikr, which the app stops short of */
        if (!short && w.length >= 6) {
          const head = cover(w, p.w.slice(0, w.length + 2));
          if (head >= 0.85 && (!first || head > first.score)) first = { a: p.a, score: head };
        }
      });
      if (best) { ids[i] = best.a; how[i] = 'whole'; }
      else if (first) { ids[i] = first.a; how[i] = 'its beginning'; }
    });
    /* a dhikr the app says in pieces: consecutive texts with no match of their
       own, each found in the same dhikr of the book and together most of it,
       give it to the first of them */
    for (let i = 0; i < items.length; i++) {
      if (ids[i]) continue;
      inside[i].forEach(function (a) {
        if (ids[i]) return;
        const p = pool.filter(function (x) { return x.a === a; })[0];
        let j = i;
        let union = [];
        while (j < items.length && !ids[j] && inside[j].indexOf(a) !== -1) { union = union.concat(words(items[j].t)); j++; }
        if (j - i >= 2 && cover(p.w, union) >= 0.6) { ids[i] = a; how[i] = 'in pieces, ' + i + ' to ' + (j - 1); }
      });
    }
    Object.keys(HAND).forEach(function (place) {
      const at = place.split('#');
      if (at[0] === k) { ids[+at[1]] = HAND[place]; how[+at[1]] = 'by hand'; }
    });
    /* the next piece of a dhikr already shown carries nothing of its own */
    for (let i = items.length - 1; i > 0; i--) {
      if (ids[i] && ids[i] === ids[i - 1]) { ids[i] = null; how[i] = 'shown above'; }
    }
    ids.forEach(function (id, i) {
      all++;
      if (id) found++;
      if (review) lines.push((id ? 'a' + id : '--') + '  ' + k + '#' + i + ' ' + (how[i] ? '(' + how[i] + ') ' : '') +
        items[i].t.replace(/\s+/g, ' ').slice(0, 70) + (id ? '\n        ' + byId[id].t.replace(/\s+/g, ' ').slice(0, 110) : ''));
    });
    daily[k] = ids;
  });
  if (review) console.log(lines.join('\n'));
  return { daily: daily, found: found, all: all };
}

async function fetchBook() {
  const index = await json('https://www.hisnmuslim.com/api/en/husn_en.json');
  const chapters = index.English || [];
  const byId = {};
  const missed = [];
  for (const c of chapters) {
    let got;
    /* a chapter the site will not hand over is left out, and named */
    try { got = await json('https://www.hisnmuslim.com/api/en/' + c.ID + '.json'); } catch (e) { missed.push(c.ID); continue; }
    const items = got[Object.keys(got)[0]] || [];
    items.forEach(function (it) {
      const t = String(it.TRANSLATED_TEXT || '').trim();
      if (!t) return;
      byId[it.ID] = { t: dashes(t), n: String(it.LANGUAGE_ARABIC_TRANSLATED_TEXT || '').trim() };
    });
    await wait(60);
  }
  return { byId: byId, missed: missed };
}

(async function main() {
  const offline = process.argv.indexOf('--offline') !== -1;
  const review = process.argv.indexOf('--review') !== -1;
  let byId, missed = [];
  if (offline) {
    byId = JSON.parse(fs.readFileSync(FILE, 'utf8')).d;
    Object.keys(byId).forEach(function (id) { byId[id].t = dashes(byId[id].t); });
  } else {
    const got = await fetchBook();
    byId = got.byId;
    missed = got.missed;
  }
  const app = load();
  let hisnFound = 0, hisnAll = 0;
  app.HISN.forEach(function (c) { c.i.forEach(function (it) { hisnAll++; if (it.a && byId[it.a]) hisnFound++; }); });
  const m = match(byId, review);
  const out = { lang: 'en', source: 'HisnMuslim.com', url: 'https://www.hisnmuslim.com', d: byId, daily: m.daily };
  fs.writeFileSync(FILE, JSON.stringify(out));
  console.log('hisn-en: ' + Object.keys(byId).length + ' dhikr; the chapters ' + hisnFound + ' of ' + hisnAll +
    ', the daily lists ' + m.found + ' of ' + m.all + (missed.length ? '; not handed over: ' + missed.join(', ') : ''));
})().catch(function (e) { console.error(e.message); process.exit(1); });
