#!/usr/bin/env node
'use strict';
/* The names the app gives a reader's place, built from GeoNames into the one
   file the page fetches whole: docs/data/places.json.

   The page names where a reader is without asking any server: it fetches this
   file, the same file for every reader, so the request says nothing about
   where they are, and finds the nearest place in it on the device.

   What goes in:
     cities15000.zip       every town of 15000 people or more, the world over
     cities1000.zip        every town of 1000 or more, for KW SA AE QA BH OM
                           only, so the Gulf is named down to its areas
     KW BH QA .zip         every populated place of Kuwait, Bahrain and
                           Qatar, the quarters of their towns among them
     SA AE OM .zip         the quarters of the towns of Saudi Arabia, the
                           Emirates and Oman, so a reader in north Riyadh is
                           told the quarter and not the next town
     alternateNamesV2.zip  every name of each, with the language it is in

   Each place keeps its latitude and longitude to two decimals, and these:
     ar  the name in the Arabic script, as GeoNames gives it in Arabic (the
         one it marks preferred, else the one it was given first), else the
         one in the Arabic script with no Persian or Urdu letter, else one in
         the Arabic script at all, its vowel marks taken off
     la  the name GeoNames gives in English (the one it marks preferred, else
         the first it was given), else the title of the article of the
         English Wikipedia it links to when that is the same name, else the
         plain ASCII name (asciiname) rather than the one with diacritics
     ru  the name in Russian, else a Cyrillic one with no letter Russian lacks
     bn  the name in Bengali, else one in the Bengali script
   A place with no name in the Arabic script is dropped only when a place with
   one, twice its people or more, stands within ten kilometres; no name is
   ever made up. Of places that fall on the same point at two decimals, the
   better named and the bigger is kept.

     node tools/places/build.js               downloads the nine into a cache
                                              folder and writes the file
     node tools/places/build.js --from <dir>  reads the nine zips from <dir>
     node tools/places/build.js --cache <dir> downloads into <dir>

   The worker keeps the file once a reader has fetched it and carries it
   across every update of the app, as it does the tafsir, so a file built
   again with other names goes out under a new name, and PLACES_URL in
   docs/js/app.js with it.

   The data is GeoNames' (https://www.geonames.org/), under the Creative
   Commons Attribution 4.0 licence, and the app credits it in its sources. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'data', 'places.json');
const BASE = 'https://download.geonames.org/export/dump/';
const GULF = new Set(['KW', 'SA', 'AE', 'QA', 'BH', 'OM']);
/* From the whole list of each Gulf country: every populated place of these
   three, down to the quarters of their towns, and of the other three their
   quarters alone, since cities1000 already holds their towns. */
const WHOLE = new Set(['KW', 'BH', 'QA']);
/* abandoned and destroyed: nobody is in them to be told so */
const GONE = new Set(['PPLQ', 'PPLW']);
/* the sectors of Abu Dhabi's grid, U01 and W66, whose Arabic names are a
   number after a word, غير معرّف 1: a reader is in a quarter with a name, and
   the quarters with names are kept */
const SECTOR = /^[A-Za-z]{1,3}_?[0-9]+([_-][0-9]+)?$/;
/* a nameless place within this of a named one twice its size is left to it */
const NEIGHBOUR_KM = 10;
const NEIGHBOUR_TIMES = 2;

const arg = function (name) { const at = process.argv.indexOf(name); return at === -1 ? null : process.argv[at + 1]; };

/* ---------------- fetching and unpacking ---------------- */

async function download(name, dir) {
  const target = path.join(dir, name);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(dir, { recursive: true });
  process.stderr.write('downloading ' + BASE + name + '\n');
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(BASE + name + ' answered ' + res.status);
  const part = target + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
  fs.renameSync(part, target);
  return target;
}

/* One entry of a zip as a stream of its text, read from the zip's own central
   directory, so nothing outside node is needed. */
function entry(file, name) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLength = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLength);
    fs.readSync(fd, tail, 0, tailLength, size - tailLength);
    let end = -1;
    for (let i = tailLength - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end === -1) throw new Error(file + ' is not a zip');
    const count = tail.readUInt16LE(end + 10);
    const dirSize = tail.readUInt32LE(end + 12);
    const dirAt = tail.readUInt32LE(end + 16);
    if (dirAt === 0xFFFFFFFF) throw new Error(file + ' is a zip64, which this does not read');
    const dir = Buffer.alloc(dirSize);
    fs.readSync(fd, dir, 0, dirSize, dirAt);
    for (let at = 0, i = 0; i < count; i++) {
      if (dir.readUInt32LE(at) !== 0x02014b50) throw new Error(file + ': a broken central directory');
      const method = dir.readUInt16LE(at + 10);
      const packed = dir.readUInt32LE(at + 20);
      const nameLength = dir.readUInt16LE(at + 28);
      const local = dir.readUInt32LE(at + 42);
      if (dir.toString('utf8', at + 46, at + 46 + nameLength) === name) {
        const head = Buffer.alloc(30);
        fs.readSync(fd, head, 0, 30, local);
        if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(file + ': a broken entry for ' + name);
        const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        const raw = fs.createReadStream(file, { start: start, end: start + packed - 1 });
        if (method === 0) return raw;
        if (method !== 8) throw new Error(name + ' is packed in a way this does not read: ' + method);
        const out = zlib.createInflateRaw();
        raw.on('error', function (e) { out.destroy(e); });
        return raw.pipe(out);
      }
      at += 46 + nameLength + dir.readUInt16LE(at + 30) + dir.readUInt16LE(at + 32);
    }
    throw new Error(name + ' is not in ' + file);
  } finally {
    fs.closeSync(fd);
  }
}

function eachLine(stream, fn) {
  return new Promise(function (done, fail) {
    stream.on('error', fail);
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    lines.on('line', fn);
    lines.on('close', done);
  });
}

/* ---------------- the scripts ---------------- */

/* the marks over and under the letters, and the stretch between them */
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
/* the marks that only steer the direction of the text, which no name needs */
const STEERING = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
/* the letters of Arabic itself */
const ARABIC_LETTER = /[\u0621-\u063A\u0641-\u064A]/;
/* any letter of the Arabic script */
const SCRIPT_LETTER = /[\u0621-\u063A\u0641-\u064A\u066E-\u06D3\u06D5\u06EE\u06EF\u06FA-\u06FF]/;
const ARABIC_NAME = /^[\u0621-\u063A\u0641-\u064A\u066E-\u06D3\u06D5\u06EE\u06EF\u06FA-\u06FF0-9\u0660-\u0669\u06F0-\u06F9 \-\u200C]+$/;
/* the name of the province or the emirate rather than of the town in it */
const PROVINCE = /^(ولاية|قضاء|ناحية|شعبية|محافظة|إمارة|امارة|بلدية|منطقة|مقاطعة|إقليم|اقليم|ضلع) /;
/* Uyghur, and Pashto with it: ې ۆ ۇ ۈ ۋ ە, a ى inside a word, a ئ that begins
   one. Arabic writes none of these, and a reader of it would stumble on them. */
const UYGHUR = /[\u06D0\u06C6\u06C7\u06C8\u06CB\u06D5]|\u0649(?=[\u0621-\u064A\u066E-\u06D3])|(^|\s)\u0626/;
const CYRILLIC_NAME = /^[\u0400-\u04FF0-9 \-]+$/;
/* letters of the other languages written in Cyrillic, which Russian has not,
   and the hard sign standing as a vowel, as Bulgarian has it */
const NOT_RUSSIAN = /[\u0400\u0402-\u040F\u0450\u0452-\u045F\u0460-\u04FF]|\u044A(?![\u0435\u0451\u044E\u044F])/i;
const BENGALI_NAME = /^[\u0980-\u09FF0-9 \-]+$/;
/* the two letters Assamese writes and Bengali does not */
const ASSAMESE = /[\u09F0\u09F1]/;

/* languages that write Arabic itself, its own forms in each country */
const ARABIC_TONGUES = new Set(['', 'ar', 'arz', 'ary', 'arq', 'aeb', 'apc', 'ajp', 'acm', 'afb', 'ayl', 'acw', 'ars', 'shu', 'apd', 'abv']);
const URDU_TONGUES = new Set(['ur', 'pnb', 'skr', 'bgn']);
/* not languages at all: links, codes and the like */
const NOT_A_LANGUAGE = new Set(['link', 'post', 'iata', 'icao', 'faac', 'tcid', 'unlc', 'abbr', 'wkdt', 'fr_1793']);

/* The app's own words, as its language tables are keyed: a place whose
   Arabic name is one of them, المدينة or الشروق, would be read as that word in
   every other language, City or Sunrise. So a name that is not one is chosen
   where GeoNames has one, المدينة المنورة rather than المدينة, and where it
   has none the name is closed with a mark nobody sees, the zero width non
   joiner, which the page shows as nothing and the tables never take for the
   word. The cities of the app's own list are places in the tables too, and
   are left as they are. */
const UNSEEN = String.fromCharCode(0x200C);
const APP_WORDS = (function () {
  const words = new Set();
  JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'i18n', 'catalog.json'), 'utf8')).forEach(function (e) {
    if (e.key.indexOf('{') !== -1) return;
    if (e.where.every(function (w) { return w.indexOf('data/extras.js CITIES') === 0; })) return;
    words.add(e.key.replace(/^[a-z]+:/, ''));
  });
  return words;
}());

function arabicForm(text) {
  return text.normalize('NFKC').replace(STEERING, '').replace(MARKS, '').replace(/\u0671/g, '\u0627').replace(/\s+/g, ' ').trim();
}

function plainForm(text) {
  return text.normalize('NFC').replace(STEERING, '').replace(/\s+/g, ' ').trim();
}

/* lower is better, compared item by item */
function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function best(candidates) {
  let pick = null;
  candidates.forEach(function (c) { if (c && (!pick || compare(c.rank, pick.rank) < 0)) pick = c; });
  return pick || { text: '', rank: [] };
}

function arabicCandidate(row) {
  const text = arabicForm(row.name);
  if (!text || !ARABIC_NAME.test(text) || !SCRIPT_LETTER.test(text) || UYGHUR.test(text)) return null;
  let foreign = 0;
  for (const ch of text) if (SCRIPT_LETTER.test(ch) && !ARABIC_LETTER.test(ch)) foreign++;
  const tongue = row.lang === 'ar' ? 0 : ARABIC_TONGUES.has(row.lang) ? 1 : URDU_TONGUES.has(row.lang) ? 3 : 2;
  /* Of two names alike in all of that, the one GeoNames was given first: in
     the Gulf that is the one written with its vowels, which spells the name
     as the country does, الفحيحيل and الأحمدي and المحرق, where a later hand
     wrote الفحاحيل, الاحمدي and محرق. A name written in the Persian forms of
     kaf and yeh is still the name, and Arabic writes those two its own way. */
  return {
    text: foreign ? text.replace(/\u06A9/g, '\u0643').replace(/\u06CC/g, '\u064A') : text,
    rank: [foreign ? 1 : 0, tongue, APP_WORDS.has(text) ? 1 : 0, row.preferred ? 0 : 1, PROVINCE.test(text) ? 1 : 0, row.short ? 1 : 0, foreign, row.seq]
  };
}

function cyrillicCandidate(row) {
  const text = plainForm(row.name);
  if (!CYRILLIC_NAME.test(text) || !/[\u0400-\u04FF]/.test(text) || NOT_RUSSIAN.test(text)) return null;
  const tongue = row.lang === 'ru' ? 0 : row.lang === '' ? 1 : 2;
  return { text: text, rank: [tongue, row.preferred ? 0 : 1, row.short ? 1 : 0, row.seq] };
}

function bengaliCandidate(row) {
  const text = plainForm(row.name);
  if (!BENGALI_NAME.test(text) || !/[\u0980-\u09FF]/.test(text) || ASSAMESE.test(text)) return null;
  const tongue = row.lang === 'bn' ? 0 : row.lang === '' ? 1 : 2;
  return { text: text, rank: [tongue, row.preferred ? 0 : 1, row.short ? 1 : 0, row.seq] };
}

/* ---------------- the build ---------------- */

function km(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* the order of the kinds of populated place, the capital first */
const KIND = ['PPLC', 'PPLA', 'PPLG', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPL', 'PPLX', 'PPLL', 'PPLS', 'PPLR', 'PPLF', 'PPLH', 'STLMT'];
function kindRank(code) { const i = KIND.indexOf(code); return i === -1 ? KIND.length : i; }

/* ---------------- the name in Latin letters ---------------- */

/* Letters of the Latin script, with the marks some names carry, and the few
   signs a name is written with. A name with a comma or a bracket in it is a
   title, «Gosnells, Western Australia», and not a name. */
const LATIN_NAME = /^[A-Za-z\u00C0-\u024F\u1E00-\u1EFF0-9 '\u2018\u2019\u02BB\u02BC.\-]+$/;
const WIKI = /^https?:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)$/;

/* the title of an article of the English Wikipedia, without the place it is
   told apart by: «Simmering (Vienna)», «Al Karama, Dubai» */
function wikiTitle(url) {
  const m = WIKI.exec(url);
  if (!m) return '';
  let title = '';
  try { title = decodeURIComponent(m[1]); } catch (e) { return ''; }
  return plainForm(title.replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*$/, '').replace(/,.*$/, ''));
}

/* What is left of a word written in Latin letters once its vowels and its
   doubled letters are taken off, which two hands spelling one Arabic name
   differently still share: Salmiya leaves slm, the start of slmh, which is
   what Salimiyah leaves. */
function skeleton(word) {
  return word.replace(/[aeiouwy]/g, '').replace(/(.)\1+/g, '$1');
}

/* the words of a name in plain letters, its articles left out */
const ARTICLES = new Set(['al', 'el', 'as', 'ash', 'ad', 'adh', 'ar', 'at', 'ath', 'az', 'an', 'ud', 'ul']);
function words(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase().split(/[\s-]+/)
    .map(function (w) { return w.replace(/[^a-z]/g, ''); })
    .filter(function (w) { return w && !ARTICLES.has(w); });
}

function dice(a, b) {
  const pairs = function (s) { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
  const x = pairs(a);
  const pool = pairs(b);
  if (!x.length || !pool.length) return 0;
  const size = x.length + pool.length;
  let same = 0;
  x.forEach(function (p) { const at = pool.indexOf(p); if (at !== -1) { same++; pool.splice(at, 1); } });
  return 2 * same / size;
}

function sameWord(a, b) {
  const x = skeleton(a);
  const y = skeleton(b);
  if (!x || !y) return a === b;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 2) return false;
  return x.indexOf(y) === 0 || y.indexOf(x) === 0 || dice(x, y) >= 0.6;
}

/* whether a title says the same name as the one GeoNames writes: each of its
   words is one of the name's, so «Shuwaikh Port» is not Ash Shuwaykh */
function alike(title, name) {
  const theirs = words(name);
  const mine = words(title);
  return mine.length > 0 && mine.every(function (w) { return theirs.some(function (v) { return sameWord(w, v); }); });
}

/* Some quarters of the Gulf came to GeoNames with their words run together,
   HayyarRashidiyah and AsSafaTis'ah, and are parted where a word plainly
   begins: Hayy ar Rashidiyah, As Safa Tis'ah. */
function unjoin(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])'([A-Z])/g, '$1 \'$2')
    .replace(/\b(Hayy|Jabal|Wadi|Ras|Bab|Dar|Bayt|Bir|Shib|Ayn)(al|an|ar|as|ash|at|ath|ad|adh|az)\b/g, '$1 $2');
}

/* The name in Latin letters, which every language that writes them shows:
   the one GeoNames gives in English, the one it marks preferred and else the
   first it was given, so Kuwait City is Kuwait City and Mecca is Mecca. A
   place with no English name is called by the title of its article in the
   English Wikipedia, which GeoNames links it to, when the title is the same
   name written as the country writes it in English, Salmiya for As
   Salimiyah: a link to another place, a suburb to the town around it, is
   told apart because its letters are not the same. Failing both, the plain
   ASCII name, its backticks written as apostrophes. */
function latinName(p) {
  const english = p.rows.filter(function (r) { return r.lang === 'en' && LATIN_NAME.test(plainForm(r.name)); })
    .sort(function (a, b) { return (b.preferred - a.preferred) || (a.seq - b.seq); })[0];
  if (english) return { text: plainForm(english.name), how: 'en' };
  let ascii = plainForm(/^[\x20-\x7E]+$/.test(p.ascii) && p.ascii.trim() ? p.ascii : p.name).replace(/`/g, '\'');
  if (GULF.has(p.cc)) ascii = unjoin(ascii);
  for (const url of p.links) {
    const title = wikiTitle(url);
    if (title && LATIN_NAME.test(title) && alike(title, ascii)) return { text: title, how: 'wiki' };
  }
  return { text: ascii, how: 'ascii' };
}

async function main() {
  const from = arg('--from');
  const dir = from || arg('--cache') || path.join(os.tmpdir(), 'sunnati-geonames');
  const files = {};
  const zips = ['cities15000.zip', 'cities1000.zip', 'alternateNamesV2.zip'].concat(Array.from(GULF).map(function (c) { return c + '.zip'; }));
  for (const name of zips) {
    files[name] = from ? path.join(from, name) : await download(name, dir);
    if (!fs.existsSync(files[name])) throw new Error('missing ' + files[name]);
  }

  /* the places */
  const places = new Map();
  const take = function (wanted) {
    return function (line) {
      if (!line) return;
      const f = line.split('\t');
      if (f[6] !== 'P' || GONE.has(f[7]) || SECTOR.test(f[2]) || !wanted(f)) return;
      places.set(f[0], {
        id: f[0], name: f[1], ascii: f[2], alts: f[3] ? f[3].split(',') : [],
        lat: +f[4], lng: +f[5], code: f[7], cc: f[8], pop: +f[14] || 0, rows: [], links: []
      });
    };
  };
  await eachLine(entry(files['cities15000.zip'], 'cities15000.txt'), take(function () { return true; }));
  await eachLine(entry(files['cities1000.zip'], 'cities1000.txt'), take(function (f) { return GULF.has(f[8]); }));
  for (const c of GULF) {
    await eachLine(entry(files[c + '.zip'], c + '.txt'), take(function (f) { return WHOLE.has(c) || f[7] === 'PPLX'; }));
  }

  /* their names in the three scripts and in English, with the language each
     is written in, and the article of the English Wikipedia each links to */
  const SCRIPTS = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0400-\u04FF\u0980-\u09FF]/;
  await eachLine(entry(files['alternateNamesV2.zip'], 'alternateNamesV2.txt'), function (line) {
    const f = line.split('\t');
    const place = places.get(f[1]);
    if (!place) return;
    if (f[2] === 'link') { if (WIKI.test(f[3])) place.links.push(f[3]); return; }
    if (NOT_A_LANGUAGE.has(f[2]) || (f[2] !== 'en' && !SCRIPTS.test(f[3]))) return;
    /* a name used only until a date is a name of the past */
    if (f[6] === '1' || f[7] === '1' || (f[9] && f[9].trim())) return;
    place.rows.push({ seq: +f[0], lang: f[2], name: f[3], preferred: f[4] === '1', short: f[5] === '1' });
  });

  /* each place's names */
  const list = [];
  places.forEach(function (p) {
    /* the short list in the cities file holds a name or two the long one may
       not, written in no language in particular */
    const rows = p.rows.slice();
    const seen = new Set(rows.map(function (r) { return r.name; }));
    p.alts.forEach(function (a, i) { if (!seen.has(a) && SCRIPTS.test(a)) rows.push({ seq: 1e12 + i, lang: '', name: a, preferred: false, short: false }); });
    const la = latinName(p);
    if (!la.text) return;
    const ar = best(rows.map(arabicCandidate));
    if (APP_WORDS.has(ar.text)) ar.text += UNSEEN;
    const ru = best(rows.map(cyrillicCandidate));
    const bn = best(rows.map(bengaliCandidate));
    list.push({
      id: p.id, cc: p.cc, code: p.code, pop: p.pop, lat: p.lat, lng: p.lng,
      y: Math.round(p.lat * 100), x: Math.round(p.lng * 100),
      ar: ar.text, la: la.text, ru: ru.text, bn: bn.text,
      /* how each was found, for the count at the end */
      how: { ar: ar.rank.slice(0, 2).join(''), la: la.how, ru: String(ru.rank[0]), bn: String(bn.rank[0]) }
    });
  });

  /* one place to a point */
  const atPoint = new Map();
  list.forEach(function (p) {
    const key = p.y + ':' + p.x;
    const was = atPoint.get(key);
    if (!was || compare([p.ar ? 0 : 1, -p.pop, kindRank(p.code), +p.id], [was.ar ? 0 : 1, -was.pop, kindRank(was.code), +was.id]) < 0) atPoint.set(key, p);
  });
  let kept = Array.from(atPoint.values());

  /* a place with no name in the Arabic script, beside a bigger one with */
  const grid = new Map();
  kept.forEach(function (p) {
    if (!p.ar) return;
    const key = Math.floor(p.lat) + ':' + Math.floor(p.lng);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  });
  const covered = function (p) {
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const lngCell = ((Math.floor(p.lng) + b + 180) % 360 + 360) % 360 - 180;
        const cell = grid.get((Math.floor(p.lat) + a) + ':' + lngCell);
        if (!cell) continue;
        for (const q of cell) if (q.pop >= NEIGHBOUR_TIMES * p.pop && km(p, q) <= NEIGHBOUR_KM) return true;
      }
    }
    return false;
  };
  const before = kept.length;
  kept = kept.filter(function (p) { return p.ar || !covered(p); });
  const dropped = before - kept.length;

  /* in bands of one degree from the south, each band walked east and the
     next west, so a place's neighbour in the list is its neighbour on the
     ground and the steps between them stay short */
  kept.sort(function (a, b) {
    const band = Math.floor(a.y / 100) - Math.floor(b.y / 100);
    if (band) return band;
    return (Math.floor(a.y / 100) % 2 ? b.x - a.x : a.x - b.x) || a.y - b.y || (+a.id) - (+b.id);
  });

  /* Written by columns: the latitudes and the longitudes in hundredths of a
     degree, each as its step from the place before, and each kind of name as
     one string, the places parted by «|». A place with no name of a kind has
     nothing between its two bars. */
  const join = function (key) {
    return kept.map(function (p) {
      if (p[key].indexOf('|') !== -1) throw new Error('a name with a bar in it: ' + p[key]);
      return p[key];
    }).join('|');
  };
  const out = {
    about: 'GeoNames, geonames.org, CC BY 4.0. Built by tools/places/build.js',
    lat: kept.map(function (p, i) { return i ? p.y - kept[i - 1].y : p.y; }),
    lng: kept.map(function (p, i) { return i ? p.x - kept[i - 1].x : p.x; }),
    ar: join('ar'),
    la: join('la'),
    ru: join('ru'),
    bn: join('bn')
  };
  const text = JSON.stringify(out) + '\n';
  fs.writeFileSync(OUT, text);

  const count = function (key) { return kept.filter(function (p) { return p[key]; }).length; };
  const ways = function (key) {
    const tally = {};
    kept.forEach(function (p) { if (p[key]) tally[p.how[key]] = (tally[p.how[key]] || 0) + 1; });
    return JSON.stringify(tally);
  };
  console.log(path.relative(ROOT, OUT) + ': ' + kept.length + ' places, ' + count('ar') + ' with an Arabic name, ' +
    count('ru') + ' Cyrillic, ' + count('bn') + ' Bengali; ' + dropped + ' left to a bigger named neighbour, ' +
    (list.length - atPoint.size) + ' sharing a point with a better one');
  /* ar: the letters (0 Arabic alone, 1 with others) then the language (0 Arabic,
     1 a form of Arabic or none given, 2 Persian and the like, 3 Urdu and the
     like); la: en, wiki or ascii; ru and bn: 0 that language, 1 none given,
     2 another */
  console.log('found by: ar ' + ways('ar') + ', la ' + ways('la') + ', ru ' + ways('ru') + ', bn ' + ways('bn'));
  console.log(text.length + ' characters, ' + Buffer.byteLength(text) + ' bytes, ' + zlib.gzipSync(text, { level: 9 }).length + ' gzipped');
}

main().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
