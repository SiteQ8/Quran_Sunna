#!/usr/bin/env node
/* Writes a language's table, docs/i18n/<lang>.js, and checks it against the
   catalog of everything the app writes (tools/i18n/catalog.json).

     node tools/i18n/build.js en --from <dir>   merge the JSON parts in <dir>
                                                  into the table, then write it
     node tools/i18n/build.js en                 check the table as it stands
     node tools/i18n/build.js en --missing <f>   list what the table lacks, as
                                                  catalog items, into <f>

   The table file is the one source of a language's words: it is plain JSON
   inside one call, so it is read back by this tool and edited by hand alike.
   A line the catalog no longer holds is dropped from it; a line it lacks is
   reported, and the app shows that line in Arabic until it is added. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const lang = process.argv[2];
if (!lang || !/^[a-z]{2}$/.test(lang)) { console.error('which language?'); process.exit(2); }
const arg = function (name) { const at = process.argv.indexOf(name); return at === -1 ? null : process.argv[at + 1]; };

const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const DASH = /[–—]/;
const FILE = path.join(DOCS, 'i18n', lang + '.js');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
const order = new Map(catalog.map(function (e, i) { return [e.key, i]; }));

/* the languages written in the Arabic script keep its letters, and every
   language keeps a line the table sets to the Arabic itself on purpose */
const ARABIC_SCRIPT = { ur: true, fa: true };

function read() {
  if (!fs.existsSync(FILE)) return {};
  const src = fs.readFileSync(FILE, 'utf8');
  const at = src.indexOf('I18n.add(');
  return JSON.parse(src.slice(at + 'I18n.add('.length, src.lastIndexOf(');')));
}

function places(key) {
  return (key.match(/\{#?\d+(?::[a-z]+)?\}/g) || []).map(function (p) { return p.replace(/[#]|:[a-z]+/g, ''); }).sort();
}

function check(table) {
  const problems = [];
  Object.keys(table).forEach(function (key) {
    const value = table[key];
    const forms = typeof value === 'string' ? [value] : Object.values(value || {});
    if (!forms.length) problems.push(['empty', key]);
    forms.forEach(function (v) {
      if (typeof v !== 'string') { problems.push(['not text', key]); return; }
      if (DASH.test(v)) problems.push(['dash', key, v]);
      const want = places(key);
      const got = (v.match(/\{\d+\}/g) || []).sort();
      if (want.join() !== got.join()) problems.push(['places', key, v]);
      if (!ARABIC_SCRIPT[lang] && v !== key && AR.test(v.replace(/ﷺ/g, ''))) problems.push(['arabic left', key, v]);
    });
  });
  return problems;
}

/* a key whose places came to say what they hold, {0} becoming {0:surah}, is
   still the same line */
function bare(key) { return key.replace(/\{(#?\d+):[a-z]+\}/g, '{$1}'); }
const byBare = new Map(catalog.map(function (e) { return [bare(e.key), e.key]; }));

let table = read();
const from = arg('--from');
if (from) {
  fs.readdirSync(from).filter(function (f) { return /\.json$/.test(f); }).sort().forEach(function (f) {
    const part = JSON.parse(fs.readFileSync(path.join(from, f), 'utf8'));
    Object.keys(part).forEach(function (k) {
      const key = order.has(k) ? k : (byBare.get(bare(k)) || k);
      if (!Object.prototype.hasOwnProperty.call(table, key) || key === k) table[key] = part[k];
    });
  });
}

/* the catalog's order, the catalog's lines */
const dropped = Object.keys(table).filter(function (k) { return !order.has(k); });
const kept = {};
Object.keys(table).filter(function (k) { return order.has(k); })
  .sort(function (a, b) { return order.get(a) - order.get(b); })
  .forEach(function (k) { kept[k] = table[k]; });
table = kept;

const missing = catalog.filter(function (e) { return !Object.prototype.hasOwnProperty.call(table, e.key); });
const problems = check(table);

if (from || process.argv.indexOf('--write') !== -1) {
  const head = '/* سُنّتي in ' + lang + ': the app\'s own words, keyed by the Arabic exactly as the page writes it.\n' +
    '   Written by tools/i18n/build.js from tools/i18n/catalog.json; edit the words here, keep the keys. */\n';
  fs.writeFileSync(FILE, head + 'window.I18n && window.I18n.add(' + JSON.stringify(table, null, 1) + ');\n');
}
const missingOut = arg('--missing');
if (missingOut) fs.writeFileSync(missingOut, JSON.stringify(missing, null, 1));

console.log(lang + ': ' + Object.keys(table).length + ' lines, ' + missing.length + ' missing, ' +
  dropped.length + ' no longer in the catalog, ' + problems.length + ' problems');
problems.slice(0, 40).forEach(function (p) { console.log('  ' + p.join(' | ')); });
if (missing.length && !missingOut) missing.slice(0, 20).forEach(function (e) { console.log('  missing: ' + e.key + '  (' + e.where[0] + ')'); });
process.exit(problems.length ? 1 : 0);
