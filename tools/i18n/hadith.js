#!/usr/bin/env node
/* The meanings of the hadiths the app quotes, from HadeethEnc.com (the
   encyclopedia of translated prophetic hadiths), which publishes each hadith
   with its translation into many languages, its grade and its source.

   The app's own collection, the forty of an-Nawawi it carries (HADITHS in
   docs/data/content.js), is found in HadeethEnc by its Arabic, and each one
   it holds is written, in every language HadeethEnc has it in, into
   docs/data/meanings/hadith-<lang>.json, keyed by the hadith's number in the
   app. The text is kept as published, with the id it is read by there.

     node tools/i18n/hadith.js           read HadeethEnc and write
     node tools/i18n/hadith.js --tidy    the files already written, tidied again */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'data', 'meanings');
const LANGS = ['en', 'ur', 'id', 'tr', 'fr', 'bn', 'fa', 'ms', 'ru', 'ha'];
const API = 'https://hadeethenc.com/api/v1/';

/* The app's typography writes no long dash: the few a translation has become
   the hyphen, where they stand, every word and space as published. */
function dashes(text) {
  return String(text).replace(/[\u2013\u2014]/g, '-');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return await res.json();
    } catch (e) { /* again */ }
    await wait(1500 * (tries + 1));
  }
  throw new Error('could not read ' + url);
}

/* letters alone, so a text with its vowels and one without are the same */
function bare(text) {
  return String(text || '')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06EDـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A]+/g, ' ').trim();
}

/* the files already written, with the dashes as this tool now writes them */
if (process.argv[2] === '--tidy') {
  LANGS.forEach(function (lang) {
    const file = path.join(OUT, 'hadith-' + lang + '.json');
    if (!fs.existsSync(file)) return;
    const out = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.keys(out.h).forEach(function (n) {
      ['t', 'r', 'g'].forEach(function (k) { out.h[n][k] = dashes(out.h[n][k]); });
    });
    fs.writeFileSync(file, JSON.stringify(out));
  });
  process.exit(0);
}

(async function main() {
  const box = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'content.js'), 'utf8'), box);
  const mine = vm.runInContext('HADITHS', box);

  /* every hadith HadeethEnc holds, by its Arabic title, which is the hadith's
     own opening words */
  const roots = await json(API + 'categories/roots/?language=ar');
  const all = new Map();
  for (const root of roots) {
    for (let page = 1; page < 200; page++) {
      const got = await json(API + 'hadeeths/list/?language=ar&category_id=' + root.id + '&page=' + page + '&per_page=100');
      (got.data || []).forEach(function (h) { all.set(h.id, bare(h.title)); });
      if (!got.meta || +got.meta.current_page >= +got.meta.last_page) break;
      await wait(100);
    }
  }
  console.error(all.size + ' hadiths on HadeethEnc');

  /* one of ours is found when the opening words of one side begin the other */
  const found = {};
  mine.forEach(function (h) {
    const text = bare(h.t);
    let best = null;
    all.forEach(function (title, id) {
      if (title.length < 12) return;
      const a = text.slice(0, 60), b = title.slice(0, 60);
      if (text.indexOf(b) === 0 || title.indexOf(a) === 0 || text.indexOf(title.slice(0, 40)) !== -1) {
        if (!best || title.length > best.len) best = { id: id, len: title.length };
      }
    });
    if (best) found[h.n] = best.id;
  });
  /* three whose opening HadeethEnc words differently, found by hand there:
     «دعوني ما تركتكم», «أوصني، قال: لا تغضب» and «يا غلام، إني أعلمك كلمات» */
  Object.assign(found, { 9: '66517', 16: '4709', 19: '66522' });
  console.error(Object.keys(found).length + ' of ' + mine.length + ' found: ' + JSON.stringify(found));

  for (const lang of LANGS) {
    const out = { lang: lang, source: 'HadeethEnc.com', url: 'https://hadeethenc.com', h: {} };
    for (const n of Object.keys(found)) {
      const id = found[n];
      const one = await json(API + 'hadeeths/one/?language=ar&id=' + id);
      if ((one.translations || []).indexOf(lang) === -1) continue;
      const tr = await json(API + 'hadeeths/one/?language=' + lang + '&id=' + id);
      if (!tr.hadeeth) continue;
      out.h[n] = { id: id, t: dashes(String(tr.hadeeth).trim()), r: dashes(String(tr.attribution || '').trim()), g: dashes(String(tr.grade || '').trim()) };
      await wait(80);
    }
    fs.writeFileSync(path.join(OUT, 'hadith-' + lang + '.json'), JSON.stringify(out));
    console.log(lang + ': ' + Object.keys(out.h).length + ' hadiths');
  }
})().catch(function (e) { console.error(e.message); process.exit(1); });
