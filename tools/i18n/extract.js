#!/usr/bin/env node
/* Every piece of Arabic the app can show, listed for the language tables.

   The page is written in Arabic, and docs/js/i18n.js renders it in another
   language through a table keyed by the Arabic exactly as the page writes it.
   This reads the page and the code that draws its screens and lists what the
   tables must hold: each line the page writes whole, and each line the code
   composes from pieces, written with numbered places where the code puts
   something in, {0} for anything and {#0} for a number.

   What is set in the Quran's face or the naskh, or marked translate="no", is
   left out: it is never translated.

     node tools/i18n/extract.js            writes tools/i18n/catalog.json
     node tools/i18n/extract.js --print    prints it instead */
'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const parse5 = require('parse5');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');

const AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/* what stays Arabic, read from the engine itself so the two never differ */
const SACRED = /var SACRED = '([^']+)'/.exec(fs.readFileSync(path.join(DOCS, 'js', 'i18n.js'), 'utf8'))[1]
  .split(',').map(function (c) { return c.replace(/^\./, ''); });
const ATTRS = ['aria-label', 'title', 'alt', 'placeholder', 'aria-valuetext', 'aria-roledescription'];

/* the code that draws what the reader sees */
const JS = ['js/boot.js', 'js/app.js', 'js/hijri.js', 'js/store.js', 'js/prayer-engine.js', 'js/mushaf.js', 'js/verse-video.js'];

/* calls that hand back markup rather than words */
const MARKUP = /^(icon|empty|skeleton|clockMarkup|svg|glyph|spark|ring|chip|row|badge|stars|mark)$|Html$|Markup$|^render|^draw/;
/* calls that hand back a number written out */
const NUMBER = /^(ar|pad|count2)$/;

const TEXT = '\uE000';
const NUM = '\uE002';
const HTML = '\uE003';
const END = '\uE001';

const catalog = new Map();

function norm(text) {
  return String(text).replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '');
}

/* A piece the page joins to the one before it with «، » is looked up
   without it: the engine takes the comma off and puts the language's own
   back. */
function edges(key) {
  return key.replace(/^[\s\u060C\u061B]+|[\s\u060C\u061B]+$/g, '');
}

function note(key, kind, where, filled) {
  const of = /^([a-z]+):/.exec(key);
  key = (of ? of[0] : '') + edges(norm(of ? key.slice(of[0].length) : key));
  if (!key || !AR.test(key.replace(/\{#?\d+(?::[a-z]+)?\}/g, ''))) return;
  /* a lone letter is a piece the code matches on, not words it shows, and a
     run of figures or signs is not words at all */
  if (key.length === 1 && key !== 'ص' && key !== 'م') return;
  if (!/[\u0621-\u064A\u066E-\u06D3\u06FA-\u06FF]/.test(key.replace(/\{#?\d+(?::[a-z]+)?\}/g, ''))) return;
  let entry = catalog.get(key);
  if (!entry) {
    entry = { key: key, kind: kind, where: [] };
    if (filled && filled.some(Boolean)) entry.holes = filled;
    catalog.set(key, entry);
  }
  if (entry.where.length < 6 && entry.where.indexOf(where) === -1) entry.where.push(where);
}

/* A segment of a composed line, its tokens made into numbered places. */
/* what the code puts in each place of the line being read, by token */
let holes = {};
/* the code that hands a surah's name to a line */
const SURAH_HOLE = /\b(meta|firstMeta|lastMeta|sm|done)\.ar\b|surahMeta\([^)]*\)\s*\|\|\s*\{\}\)\.ar|^esc\(m\.ar\)$/;
/* the code that hands a prayer's name to a line about a prayer: on a Friday
   the noon prayer is الجمعة, the day's own name, and a table that calls the
   day one thing and the prayer another needs to know which it is reading */
const PRAYER_HOLE = /^(c\.(prev|next)\.ar|PRAYER_NAMES\[\w+\]|name(\.replace\(.*\))?)$/;
const PRAYER_LINE = /أذان|صلاة|وقت/;

function emit(segment, kind, where) {
  let n = 0;
  const filled = [];
  let key = segment.replace(new RegExp('([' + TEXT + NUM + '])(\\d+)' + END, 'g'), function (all, type, at) {
    const hole = holes[at] || '';
    filled.push(hole);
    /* a surah's name is told apart from the same word as a prayer's or a
       day's, الفجر, العصر, الجمعة, and from ص after a time */
    const surah = type !== NUM && SURAH_HOLE.test(hole);
    const prayer = type !== NUM && !surah && PRAYER_HOLE.test(hole) && PRAYER_LINE.test(segment);
    return '{' + (type === NUM ? '#' : '') + (n++) + (surah ? ':surah' : prayer ? ':prayer' : '') + '}';
  });
  /* «النسخة {#0}{1}»: what the page adds after the last place is a piece of
     its own, joined with a comma, so the line is listed without it */
  key = edges(norm(key));
  while (/\{#?\d+\}\{#?\d+\}$/.test(key)) { key = key.replace(/\{#?\d+\}$/, ''); n--; }
  if (!AR.test(key.replace(/\{#?\d+\}/g, ''))) return;
  /* places side by side cannot be told apart, so the words between them are
     listed on their own: the page's commas still part them on the screen */
  if (/\}\{/.test(key)) {
    key.split(/\{#?\d+\}/).forEach(function (piece) { note(piece, 'text', where); });
    return;
  }
  note(key, n ? 'pattern' : kind, where, n ? filled.slice(0, n) : null);
}

/* text split where markup was put in, since the page shows each side
   apart, and at each line break, since the words handed to another app are
   put into the language a line at a time */
function emitText(text, where) {
  text.split(new RegExp(HTML + '\\d+' + END + '|\n')).forEach(function (piece) { emit(piece, 'text', where); });
}

function sacred(attrs) {
  for (const a of attrs) {
    if (a.name === 'translate' && a.value === 'no') return true;
    if (a.name === 'class') {
      const cls = a.value.split(/\s+/);
      if (SACRED.some(function (c) { return cls.indexOf(c) !== -1; })) return true;
    }
  }
  return false;
}

function walkHtml(node, where) {
  if (node.nodeName === 'script' || node.nodeName === 'style' || node.nodeName === 'textarea') return;
  if (node.attrs) {
    if (sacred(node.attrs)) return;
    for (const a of node.attrs) if (ATTRS.indexOf(a.name) !== -1) emitText(a.value, where);
  }
  if (node.nodeName === '#text') { emitText(node.value, where); return; }
  const kids = node.content ? node.content.childNodes : node.childNodes;
  (kids || []).forEach(function (k) { walkHtml(k, where); });
}

/* ---------------- the page ---------------- */

function fromPage(rel) {
  const html = fs.readFileSync(path.join(DOCS, rel), 'utf8');
  const doc = parse5.parse(html, { sourceCodeLocationInfo: true });
  (function visit(node, of) {
    if (node.nodeName === 'script' || node.nodeName === 'style') return;
    if (node.attrs && sacred(node.attrs)) return;
    /* data-tr names the kind of words an element holds, «date:اليوم» */
    const own = node.attrs ? node.attrs.filter(function (a) { return a.name === 'data-tr'; })[0] : null;
    if (own) of = own.value;
    const pre = of ? of + ':' : '';
    const line = node.sourceCodeLocation ? node.sourceCodeLocation.startLine : 0;
    const where = rel + ':' + line;
    if (node.attrs) for (const a of node.attrs) if (ATTRS.indexOf(a.name) !== -1) note(pre + a.value, 'attr', where);
    if (node.nodeName === '#text') { note(pre + node.value, 'text', where); return; }
    const kids = node.content ? node.content.childNodes : node.childNodes;
    (kids || []).forEach(function (k) { visit(k, of); });
  })(doc, null);
}

/* ---------------- the code ---------------- */

function flat(node) {
  if (node.type === 'BinaryExpression' && node.operator === '+') return flat(node.left).concat(flat(node.right));
  return [node];
}

function calleeName(node) {
  if (node.type !== 'CallExpression') return '';
  const c = node.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed) return c.property.name;
  return '';
}

function kindOf(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return NUM;
  const name = calleeName(node);
  if (name === 'join') {
    const arg = node.arguments[0];
    return arg && arg.type === 'Literal' && arg.value === '' ? HTML : TEXT;
  }
  if (name && MARKUP.test(name)) return HTML;
  if (name && NUMBER.test(name)) return NUM;
  if (name === 'toFixed' || name === 'getDate' || name === 'getFullYear' || name === 'round' || name === 'floor' || name === 'ceil') return NUM;
  if (node.type === 'MemberExpression' && !node.computed && node.property.name === 'length') return NUM;
  if (node.type === 'Identifier' && /html|markup/i.test(node.name)) return HTML;
  return TEXT;
}

const LOGIC_METHODS = ['replace', 'indexOf', 'lastIndexOf', 'split', 'startsWith', 'endsWith', 'includes', 'test', 'match', 'search'];

/* Whether a string is something the code checks for rather than shows. */
function logic(node, parent) {
  if (!parent) return false;
  if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!='].indexOf(parent.operator) !== -1) return true;
  if (parent.type === 'Property' && parent.key === node) return true;
  if (parent.type === 'SwitchCase') return true;
  if (parent.type === 'MemberExpression' && parent.computed && parent.property === node) return true;
  if (parent.type === 'NewExpression' && parent.callee.name === 'RegExp') return true;
  if (parent.type === 'CallExpression' && parent.arguments[0] === node) {
    const name = calleeName(parent);
    if (LOGIC_METHODS.indexOf(name) !== -1) return true;
  }
  /* what a replace puts in is a piece of a word, «ين» for «ان», not words */
  if (parent.type === 'CallExpression' && calleeName(parent) === 'replace' && parent.arguments.indexOf(node) !== -1) return true;
  return false;
}

/* «'، وحزمة ' + (ios ? 'آيفون ' : 'أندرويد ') + ar(v)» is two lines, not
   one line with two places side by side, so a choice between written words
   is written out each way, up to eight ways a line. */
function ways(operands) {
  let out = [[]];
  for (const op of operands) {
    const pick = op.type === 'ConditionalExpression' &&
      op.consequent.type === 'Literal' && typeof op.consequent.value === 'string' &&
      op.alternate.type === 'Literal' && typeof op.alternate.value === 'string';
    if (pick && out.length < 8) {
      const next = [];
      out.forEach(function (w) {
        next.push(w.concat([op.consequent]));
        next.push(w.concat([op.alternate]));
      });
      out = next;
    } else out.forEach(function (w) { w.push(op); });
  }
  return out;
}

function fromChain(operands, where) {
  ways(operands).forEach(function (way) { oneWay(way, where); });
}

let SOURCE = '';

function oneWay(operands, where) {
  let template = '';
  holes = {};
  operands.forEach(function (op, i) {
    if (op.type === 'Literal' && typeof op.value === 'string') template += op.value;
    else {
      template += kindOf(op) + i + END;
      holes[i] = SOURCE.slice(op.start, op.end).replace(/\s+/g, ' ').slice(0, 80);
    }
  });
  if (!AR.test(template)) return;
  /* a tag whose name the code chooses, «'<' + tag + …», is read as a tag */
  template = template.replace(new RegExp('<[' + TEXT + NUM + HTML + ']\\d+' + END, 'g'), '<span');
  if (/<[a-zA-Z\/!]/.test(template)) {
    const frag = parse5.parseFragment(template);
    walkHtml(frag, where);
  } else {
    emitText(template, where);
  }
}

/* Lists the code keeps of names a screen shows under a kind of their own,
   as data-tr names them where they are drawn: the sections of the home
   screen, whose names stand on a card a third of a phone wide. */
const CODE_KINDS = { 'js/app.js': { TILES: { kind: 'tile', field: 'name' } } };

function fromCode(rel) {
  const src = fs.readFileSync(path.join(DOCS, rel), 'utf8');
  SOURCE = src;
  const ast = acorn.parse(src, { ecmaVersion: 2022, locations: true, sourceType: 'script', allowReturnOutsideFunction: true });
  const kinds = CODE_KINDS[rel] || {};
  walk.fullAncestor(ast, function (node, state, ancestors) {
    const parent = ancestors[ancestors.length - 2];
    const where = rel + ':' + node.loc.start.line;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && kinds[node.id.name] &&
        node.init && node.init.type === 'ArrayExpression') {
      const of = kinds[node.id.name];
      node.init.elements.forEach(function (el) {
        (el && el.properties || []).forEach(function (prop) {
          if (prop.key && prop.key.name === of.field && prop.value.type === 'Literal') note(of.kind + ':' + prop.value.value, 'data', where);
        });
      });
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      if (parent && parent.type === 'BinaryExpression' && parent.operator === '+') return;
      if (logic(node, parent)) return;
      fromChain(flat(node), where);
      return;
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && AR.test(node.value)) {
      if (parent && parent.type === 'BinaryExpression' && parent.operator === '+') return;
      if (logic(node, parent)) return;
      fromChain([node], where);
      return;
    }
    /* the counted nouns: one, two, a few and many, with the number before
       the last two, as count() writes them */
    if (node.type === 'CallExpression' && calleeName(node) === 'count' && node.arguments.length >= 5) {
      const a = node.arguments.map(function (x) { return x.type === 'Literal' ? x.value : null; });
      if (typeof a[3] !== 'string' || typeof a[4] !== 'string') return;
      note(a[1], 'text', where);
      note(a[2], 'text', where);
      note(a[2].replace(/ان$/, 'ين'), 'text', where);
      note('{#0} ' + a[3], 'pattern', where);
      note('{#0} ' + a[4], 'pattern', where);
      note('{#0} ' + a[4].replace(/اً$/, ''), 'pattern', where);
    }
  });
}

/* ---------------- the data ----------------

   The data files hold the Quran's and the Sunnah's words beside the names
   and notes the screens show with them. Only these are listed: titles,
   names, sources and the app's own explanations. A path is the global, then
   a key, «*» for every key of an object and «[]» for every item of a list. */
const DATA = {
  'surahs.js': ['surah:SURAHS[].ar', 'SURAHS[].tp'],
  'azkar.js': ['AZKAR_DB.*.title', 'AZKAR_DB.*.items[].r'],
  'hisn.js': ['HISN[].t', 'HISN_GROUPS[].t'],
  'adhan.js': ['ADHAN_VOICES[].n', 'SALAWAT_VOICES[].n', 'SALAWAT_SOURCE.n', 'SALAWAT_RECITER.n', 'SALAWAT_RECITER.w'],
  'umrah.js': ['UMRAH_STAGES[].t', 'UMRAH_STAGES[].note', 'UMRAH_STAGES[].i[]', 'UMRAH_STAGES[].calm', 'UMRAH_ALLOWED[]',
    'UMRAH_FORBIDDEN[]', 'UMRAH_MAWAQIT[].n', 'UMRAH_MAWAQIT[].w', 'UMRAH_MAWAQIT[].now', 'UMRAH_MISTAKES[]',
    'UMRAH_SOURCE.b', 'UMRAH_SOURCE.a', 'UMRAH_SOURCE_2.b', 'UMRAH_SOURCE_2.a'],
  'dua-themes.js': ['DUA_THEMES[].n', 'DUA_THEMES_SOURCE.b', 'DUA_THEMES_SOURCE.n'],
  'duas.js': ['DUA_BOOK[].n', 'DUA_BOOK_SOURCE.b', 'DUA_BOOK_SOURCE.n'],
  'content.js': ['HADITHS[].s', 'HADITHS[].r', 'RUQYAH[].r', 'DUAS[].cat', 'DUAS[].items[].r', 'CURRENT_SUNNAH.*.l',
    'CURRENT_SUNNAH.*.sub', 'CURRENT_SUNNAH.*.items[]', 'FRIDAY_SUNNAH.l', 'FRIDAY_SUNNAH.sub', 'FRIDAY_SUNNAH.items[]', 'SUNNAH_SOURCE.t',
    'SUNNAH_SOURCE.a', 'SUNNAH_TRACKER[].s', 'SUNNAH_TRACKER[].i[]'],
  'extras.js': ['CITIES[].n', 'PROPHET_DAY[].time', 'PROPHET_DAY[].items[]', 'RADIO_STATIONS[].name', 'RADIO_STATIONS[].note',
    'SURAH_VIRTUES.*', 'TASBIH_PHRASES[].t', 'WIRD_ITEMS[].t', 'WIRD_ITEMS[].n', 'RECITERS[].name', 'RECITERS[].country']
};

function pick(value, steps, out) {
  if (!steps.length) {
    if (typeof value === 'string') out.push(value);
    return;
  }
  const step = steps[0];
  const rest = steps.slice(1);
  if (value === null || value === undefined) return;
  if (step === '[]') { if (Array.isArray(value)) value.forEach(function (v) { pick(v, rest, out); }); return; }
  if (step === '*') { Object.keys(value).forEach(function (k) { pick(value[k], rest, out); }); return; }
  pick(value[step], rest, out);
}

function fromData(rel, paths) {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(DOCS, 'data', rel), 'utf8'), sandbox);
  paths.forEach(function (p) {
    /* «surah:» before a path lists its names under that kind */
    const of = /^([a-z]+):/.exec(p);
    if (of) p = p.slice(of[0].length);
    const steps = p.replace(/\[\]/g, '.[]').split('.').filter(Boolean);
    const got = [];
    pick(vm.runInContext('typeof ' + steps[0] + ' === "undefined" ? undefined : ' + steps[0], sandbox), steps.slice(1), got);
    if (!got.length) throw new Error('nothing at ' + rel + ' ' + p + ': the data changed shape');
    got.forEach(function (v) {
      if (of) { note(of[1] + ':' + v, 'data', 'data/' + rel + ' ' + p); return; }
      note(v, 'data', 'data/' + rel + ' ' + p);
      /* the page quotes a sunnah up to its first comma in a notification */
      if (v.indexOf('\u060C ') !== -1) note(v.replace(/\u060C [\s\S]*$/, ''), 'data', 'data/' + rel + ' ' + p + ' (up to its comma)');
    });
  });
}

/* Lines the code makes in a way no reading of it finds. */
/* the Friday prayer, whose name is the day's, as a place about a prayer
   reads it */
note('prayer:الجمعة', 'text', 'js/app.js prayerName');
/* a month that heads a timetable before its year is said alone, which some
   languages say otherwise than the month after a day: «октября» after 19,
   «Октябрь» over the month */
['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'].forEach(function (month) {
  note('month:' + month, 'text', 'index.html #tt-month');
});
/* the halves of the day the prayer engine writes after a time */
note('ص', 'text', 'js/prayer-engine.js format');
note('م', 'text', 'js/prayer-engine.js format');
/* «و» joined to the front of the next piece, a name or a figure */
note('و{0}', 'pattern', 'js/app.js spanOf, umrah-source');
/* hizbLabel picks the quarter out of a list by number */
['', ' وربعه', ' ونصفه', ' وثلاثة أرباعه'].forEach(function (part) {
  note('الحزب {#0}' + part, 'pattern', 'js/app.js hizbLabel');
});

fromPage('index.html');
JS.forEach(fromCode);
Object.keys(DATA).forEach(function (rel) { fromData(rel, DATA[rel]); });

const list = Array.from(catalog.values()).sort(function (a, b) {
  return a.where[0].localeCompare(b.where[0], 'en', { numeric: true });
});
const out = JSON.stringify(list, null, 1);
if (process.argv.indexOf('--print') !== -1) process.stdout.write(out + '\n');
else {
  fs.writeFileSync(path.join(__dirname, 'catalog.json'), out + '\n');
  const counts = list.reduce(function (c, e) { c[e.kind] = (c[e.kind] || 0) + 1; return c; }, {});
  console.log(list.length + ' lines: ' + JSON.stringify(counts));
}
