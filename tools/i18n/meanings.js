#!/usr/bin/env node
/* The meanings of the Quran in each language the app speaks, from the
   publishers who stand behind them, written into docs/data/meanings/ for the
   app to show under the Arabic.

   QuranEnc.com (the encyclopedia of the translated meanings of the Quran)
   publishes the translations it has reviewed through its API, each with its
   version; for Bengali, Malay and Russian it has none there, so those come
   from Tanzil's set through api.alquran.cloud. Both ask that the text is not
   changed and that it is named with its source, so it is kept exactly as
   published, footnotes and their marks included, and every file names its
   translator, its publisher and where it is read.

     node tools/i18n/meanings.js            every language
     node tools/i18n/meanings.js en fr      the ones named */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'docs', 'data', 'meanings');

const SOURCES = {
  en: { quranenc: 'english_saheeh', by: 'Saheeh International' },
  ur: { quranenc: 'urdu_junagarhi' },
  id: { quranenc: 'indonesian_affairs' },
  tr: { quranenc: 'turkish_rwwad' },
  fr: { quranenc: 'french_montada' },
  fa: { quranenc: 'persian_ih' },
  ha: { quranenc: 'hausa_gummi' },
  bn: { tanzil: 'bn.bengali', name: 'মুহিউদ্দীন খান', by: 'Muhiuddin Khan' },
  ms: { tanzil: 'ms.basmeih', name: 'Abdullah Muhammad Basmeih', by: 'Abdullah Muhammad Basmeih' },
  ru: { tanzil: 'ru.kuliev', name: 'Эльмир Кулиев', by: 'Elmir Kuliev' }
};

const AYAT = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77,
  227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96,
  29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19,
  26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6];

/* The app's typography writes no long dash: the few a translation has become
   the hyphen, where they stand, every word and space as published. */
/* A translation that writes the verse's number before its meaning, «54. Et
   lorsque», says what the Arabic beside it already shows: the number goes. */
function numberless(text, aya) {
  const at = /^\s*(\d+)\.\s+/.exec(text);
  return at && +at[1] === aya ? text.slice(at[0].length) : text;
}

function dashes(text) {
  return String(text).replace(/[\u2013\u2014]/g, '-');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const res = await fetch(url, { headers: { 'accept': 'application/json' } });
      if (res.ok) return await res.json();
    } catch (e) { /* again */ }
    await wait(1500 * (tries + 1));
  }
  throw new Error('could not read ' + url);
}

async function fromQuranEnc(lang, src) {
  const key = src.quranenc;
  const list = await json('https://quranenc.com/api/v1/translations/list');
  const meta = (list.translations || []).filter(function (t) { return t.key === key; })[0];
  if (!meta) throw new Error(key + ' is not on QuranEnc');
  const a = [];
  const f = {};
  for (let s = 1; s <= 114; s++) {
    const got = await json('https://quranenc.com/api/v1/translation/sura/' + key + '/' + s);
    const rows = got.result || [];
    if (rows.length !== AYAT[s - 1]) throw new Error(key + ' surah ' + s + ' has ' + rows.length + ' verses');
    a.push(rows.map(function (r) {
      if (r.footnotes && String(r.footnotes).trim()) f[s + ':' + r.aya] = dashes(String(r.footnotes).trim());
      return dashes(numberless(String(r.translation || '').trim(), +r.aya));
    }));
    await wait(120);
  }
  return {
    lang: lang, key: key, name: meta.title, by: src.by || meta.title.replace(/^.* - /, ''), version: meta.version,
    source: 'QuranEnc.com', url: 'https://quranenc.com/en/browse/' + key, a: a, f: f
  };
}

async function fromTanzil(lang, src) {
  const got = await json('https://api.alquran.cloud/v1/quran/' + src.tanzil);
  const surahs = got.data && got.data.surahs;
  if (!surahs || surahs.length !== 114) throw new Error(src.tanzil + ' is not whole');
  const a = surahs.map(function (s, i) {
    if (s.ayahs.length !== AYAT[i]) throw new Error(src.tanzil + ' surah ' + (i + 1) + ' has ' + s.ayahs.length + ' verses');
    return s.ayahs.map(function (v) { return dashes(String(v.text || '').trim()); });
  });
  return {
    lang: lang, key: src.tanzil, name: src.name, by: src.by, version: (got.data.edition && got.data.edition.identifier) || src.tanzil,
    source: 'Tanzil.net', url: 'https://tanzil.net/trans/' + src.tanzil, a: a, f: {}
  };
}

/* The verses' meanings in one file, read with every surah, and the
   translator's notes in another, read only when a verse is opened on its
   own: the notes of some translations are four times the text. */
function write(lang, book) {
  const notes = book.f || {};
  delete book.f;
  book.notes = Object.keys(notes).length > 0;
  const file = path.join(OUT, 'quran-' + lang + '.json');
  fs.writeFileSync(file, JSON.stringify(book));
  const noteFile = path.join(OUT, 'quran-' + lang + '-notes.json');
  if (book.notes) fs.writeFileSync(noteFile, JSON.stringify(notes));
  else if (fs.existsSync(noteFile)) fs.unlinkSync(noteFile);
  console.log(lang, book.key, book.version, (fs.statSync(file).size / 1024).toFixed(0) + ' KB',
    book.notes ? '+ notes ' + (fs.statSync(noteFile).size / 1024).toFixed(0) + ' KB' : '');
}

/* the files already written, with the dashes and the names as this tool now
   writes them, without reading the sources again */
if (process.argv[2] === '--tidy') {
  Object.keys(SOURCES).forEach(function (lang) {
    const file = path.join(OUT, 'quran-' + lang + '.json');
    if (!fs.existsSync(file)) return;
    const book = JSON.parse(fs.readFileSync(file, 'utf8'));
    book.a = book.a.map(function (s) { return s.map(function (t, i) { return dashes(numberless(t, i + 1)); }); });
    if (SOURCES[lang].by) book.by = SOURCES[lang].by;
    const noteFile = path.join(OUT, 'quran-' + lang + '-notes.json');
    if (fs.existsSync(noteFile)) {
      const notes = JSON.parse(fs.readFileSync(noteFile, 'utf8'));
      Object.keys(notes).forEach(function (k) { notes[k] = dashes(notes[k]); });
      book.f = notes;
    }
    write(lang, book);
  });
  process.exit(0);
}

if (process.argv[2] === '--split') {
  /* the files already written, split as write() would */
  fs.readdirSync(OUT).filter(function (f) { return /^quran-[a-z]+\.json$/.test(f); }).forEach(function (f) {
    const book = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    if (book.f) write(book.lang, book);
  });
  process.exit(0);
}

(async function main() {
  const asked = process.argv.slice(2);
  const langs = asked.length ? asked : Object.keys(SOURCES);
  for (const lang of langs) {
    const src = SOURCES[lang];
    if (!src) { console.error('no source for ' + lang); continue; }
    const book = src.quranenc ? await fromQuranEnc(lang, src) : await fromTanzil(lang, src);
    write(lang, book);
  }
})().catch(function (e) { console.error(e.message); process.exit(1); });
