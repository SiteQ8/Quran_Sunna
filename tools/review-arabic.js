#!/usr/bin/env node
/* Reads every Arabic sentence the app puts in front of a person and holds it to
   the rules of أدوات الربط: a full stop ends a sentence, it does not sit in the
   middle of one, and clauses are joined with و أو ف أو ثم أو لأن أو لذا أو لكن
   أو بينما rather than being cut apart.

   Quoted sources are left alone. The Quran, the hadiths, the azkar and the
   supplications are transmitted text and are not ours to rewrite.

   node tools/review-arabic.js
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

/* Words that join one clause to the next, from the article on أدوات الربط. */
const JOINERS = [
  'ثم', 'لأن', 'لأنه', 'لأنها', 'لذا', 'لذلك', 'إذن', 'أي', 'أعني',
  'لكن', 'لكنه', 'لكنها', 'غير أن', 'بيد أن', 'إلا أن', 'على الرغم',
  'بينما', 'في المقابل', 'بل', 'بالإضافة إلى', 'علاوة على', 'بناء على',
  'حيث', 'إذ', 'كما', 'حتى', 'فإن', 'فقد', 'فلا', 'فهو', 'فهي', 'فما'
];

const ARABIC = /[\u0621-\u064A]/;

const findings = [];
function flag(where, rule, text, hint) {
  findings.push({ where, rule, text: text.length > 96 ? text.slice(0, 96) + '…' : text, hint });
}

/* ---------------- gathering what a person actually reads ---------------- */

function stringsFrom(file) {
  /* Comments carry apostrophes of their own, and they throw a quote matcher
     out of step for the rest of the file, so they go first. */
  const source = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const value = (m[1] !== undefined ? m[1] : m[2]).replace(/\\n/g, '\n');
    if (ARABIC.test(value)) {
      out.push({ text: value, line: source.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

function textFromMarkup(file) {
  const html = fs.readFileSync(file, 'utf8');
  const body = html
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<span[^>]*dir="ltr"[^>]*>[\s\S]*?<\/span>/g, 'س')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ');
  const out = [];
  const re = />([^<>]{4,})</g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const value = m[1].replace(/\s+/g, ' ').trim();
    if (ARABIC.test(value)) out.push({ text: value, line: body.slice(0, m.index).split('\n').length });
  }
  /* attributes a person reads too */
  const attrs = /(?:aria-label|title|placeholder)="([^"]+)"/g;
  while ((m = attrs.exec(html)) !== null) {
    if (ARABIC.test(m[1])) out.push({ text: m[1], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

function textFromMarkdown(file) {
  const md = fs.readFileSync(file, 'utf8');
  const out = [];
  let inFence = false;
  md.split('\n').forEach(function (line, i) {
    if (/^```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    if (/^\s*\|/.test(line)) return;
    const clean = line.replace(/`[^`]*`/g, 'س').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
    if (clean.length > 3 && ARABIC.test(clean)) out.push({ text: clean, line: i + 1 });
  });
  return out;
}

/* ---------------- the rules ---------------- */

function startsWithJoiner(clause) {
  const first = clause.trim();
  if (!first) return true;
  /* و and ف join by being prefixed to the next word, so they are letters not words */
  if (/^[وف]/.test(first)) return true;
  return JOINERS.some(function (j) { return first.indexOf(j) === 0; });
}

/* The writing guide's own lists, read from the files it came with: phrases
   that a model writes and a person does not, and the misspellings that recur.
   A marker is only a marker when it stands as a whole word or phrase. */
const GUIDE = JSON.parse(fs.readFileSync(path.join(__dirname, 'arabic', 'rules.json'), 'utf8'));
const EDGE = '(^|[\\s،؛:.!؟"«»()])';
const END = '(?=$|[\\s،؛:.!؟"«»()])';
const MARKERS = GUIDE.markers.map((m) => ({ m, re: new RegExp(EDGE + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + END) }));
const SPELLING = GUIDE.misspellings.map((p) => ({ wrong: p[0], right: p[1], re: new RegExp(EDGE + p[0] + END) }));

function transmitted(t) {
  /* a verse, a hadith or a dhikr carries its own wording and is not edited */
  return /[\u064B-\u0652]{2}/.test(t) || /ﷺ|رواه|متفق عليه|صحيح|سنن|قال رسول|اللهم/.test(t);
}

function check(where, entry) {
  const t = entry.text;
  const at = where + ':' + entry.line;

  if (!transmitted(t)) {
    MARKERS.forEach(function (x) {
      if (x.re.test(t)) flag(at, 'بصمة آلية: ' + x.m, t, 'احذفها أو قل الشيء المحدد بدلها');
    });
    SPELLING.forEach(function (x) {
      if (x.re.test(t)) flag(at, 'إملاء: ' + x.wrong, t, 'الصواب ' + x.right);
    });
    /* a verb ordered through قم بـ is a translation, the verb itself is the arabic */
    if (/(^|\s)قم ب/.test(t)) flag(at, 'قم بـ', t, 'استعمل الفعل نفسه: حمّل، افتح، اضغط');
    /* the reader is one person, addressed as one */
    if (/(^|\s)(المستخدمون|المستخدمين|المتابعون|المتابعين)(\s|$)/.test(t)) flag(at, 'الراوي البعيد', t, 'خاطب القارئ: أنت');
  }

  /* Latin punctuation inside arabic */
  if (/[\u0621-\u064A]\s*,/.test(t)) flag(at, 'فاصلة لاتينية', t, 'استعمل ، بدل ,');
  if (/[\u0621-\u064A]\s*;/.test(t)) flag(at, 'فاصلة منقوطة لاتينية', t, 'استعمل ؛ بدل ;');
  if (/[\u0621-\u064A]\s*\?/.test(t)) flag(at, 'علامة استفهام لاتينية', t, 'استعمل ؟ بدل ?');

  /* spacing around punctuation */
  if (/\s+[،؛؟.]/.test(t)) flag(at, 'مسافة قبل علامة الترقيم', t, 'تلتصق العلامة بما قبلها');
  if (/[،؛](?=[\u0621-\u064A])/.test(t)) flag(at, 'لا مسافة بعد الفاصلة', t, 'ضع مسافة بعد ،');
  if (/ {2,}/.test(t)) flag(at, 'مسافة مكررة', t, '');
  /* A tatweel after a single letter is the ordinary way of writing a prefix,
     as in هـ for هجري and بـ and كـ and لـ. It is only a fault when it is used
     to stretch a word. */
  if (/[\u0621-\u064A]{2}\u0640/.test(t)) flag(at, 'تطويل داخل كلمة', t, 'احذف حرف التطويل');

  /* the rule from the article: a full stop closes a sentence, it does not
     stand between two clauses that a joiner would carry */
  if (t.length >= 40) {
    const parts = t.split(/\.\s+/);
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        if (!startsWithJoiner(parts[i]) && ARABIC.test(parts[i]) && parts[i].trim().length > 12) {
          flag(at, 'نقطة في وسط الكلام', parts.slice(i - 1, i + 1).join(' . '),
            'اربط بحرف عطف أو أداة تعليل بدل القطع');
        }
      }
    }
  }

  /* A label or a note in the interface does not end with a full stop, while a
     paragraph in a written document does, so only the interface is held to it. */
  const isProseFile = /\.md$/.test(where) || /privacy/.test(where);
  /* A full sentence closes with a stop and should. This is about a label, which
     is a few words with no clause in it and wants no stop after them. */
  const isLabel = t.length < 34 && t.indexOf('،') === -1;
  if (!isProseFile && isLabel && /[\u0621-\u064A]\.$/.test(t)) {
    flag(at, 'نقطة في نهاية عنوان قصير', t, 'العناوين والملاحظات القصيرة بلا نقطة');
  }
}

/* ---------------- run ---------------- */

const files = [];
files.push(['index.html', textFromMarkup(path.join(DOCS, 'index.html'))]);
files.push(['privacy.html', textFromMarkup(path.join(DOCS, 'privacy.html'))]);
files.push(['js/app.js', stringsFrom(path.join(DOCS, 'js', 'app.js'))]);
files.push(['js/prayer-engine.js', stringsFrom(path.join(DOCS, 'js', 'prayer-engine.js'))]);
files.push(['js/hijri.js', stringsFrom(path.join(DOCS, 'js', 'hijri.js'))]);
files.push(['js/store.js', stringsFrom(path.join(DOCS, 'js', 'store.js'))]);
files.push(['README.md', textFromMarkdown(path.join(ROOT, 'README.md'))]);
files.push(['play/README.md', textFromMarkdown(path.join(ROOT, 'play', 'README.md'))]);
files.push(['android/README.md', textFromMarkdown(path.join(ROOT, 'android', 'README.md'))]);

files.forEach(function (pair) {
  pair[1].forEach(function (entry) { check(pair[0], entry); });
});

/* The data files hold transmitted text beside our own labels, so only the
   labels we wrote are held to the rules. */
const ctx = vm.createContext({});
['surahs', 'azkar', 'content', 'extras'].forEach(function (name) {
  vm.runInContext(fs.readFileSync(path.join(DOCS, 'data', name + '.js'), 'utf8'), ctx, { filename: name });
});
function value(name) { try { return vm.runInContext(name, ctx); } catch (e) { return null; } }

const AZKAR = value('AZKAR_DB') || {};
Object.keys(AZKAR).forEach(function (key) {
  check('data/azkar.js', { text: AZKAR[key].title, line: 0 });
});
const NOW = value('CURRENT_SUNNAH') || {};
Object.keys(NOW).forEach(function (key) {
  check('data/content.js', { text: NOW[key].l, line: 0 });
  check('data/content.js', { text: NOW[key].sub, line: 0 });
});
(value('WIRD_ITEMS') || []).forEach(function (item) {
  check('data/content.js', { text: item.t, line: 0 });
  check('data/content.js', { text: item.n, line: 0 });
});
(value('SUNNAH_TRACKER') || []).forEach(function (group) {
  check('data/content.js', { text: group.s, line: 0 });
  group.i.forEach(function (item) { check('data/content.js', { text: item, line: 0 }); });
});

/* ---------------- report ---------------- */

const byRule = {};
findings.forEach(function (f) { (byRule[f.rule] = byRule[f.rule] || []).push(f); });

Object.keys(byRule).sort().forEach(function (rule) {
  console.log('\n' + rule + '  (' + byRule[rule].length + ')');
  byRule[rule].slice(0, 12).forEach(function (f) {
    console.log('  ' + f.where);
    console.log('     ' + f.text);
    if (f.hint) console.log('     ← ' + f.hint);
  });
  if (byRule[rule].length > 12) console.log('  … و' + (byRule[rule].length - 12) + ' غيرها');
});

console.log('\n' + (findings.length ? findings.length + ' ملحوظة' : 'لا ملحوظات'));
process.exit(findings.length ? 1 : 0);
