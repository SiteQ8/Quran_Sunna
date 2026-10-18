/* The app in the reader's own language.

   Arabic is the app's own tongue and nothing of it changes here: the page is
   written in Arabic, and for an Arabic reader this file sets nothing and
   stays out of the way. For any other language it loads that language's
   table, keyed by the Arabic exactly as the page writes it, and every piece of
   text the reader is shown goes through it, as the page is built and every
   time a screen is redrawn. The code that draws the screens is the same in
   every language, so a fix made once reaches every reader.

   What is never put into another language is the word of Allah and the words
   of the Prophet, peace be upon him, and the remembrances taken from them: the
   page sets them in the mushaf's face or the naskh, and whatever is set so is
   left as it was written. Their meanings, where a trusted translation exists,
   are shown under them by the screens themselves.

   Runs in the head, after boot.js and before anything is drawn, so the page
   opens in its own direction and the table is in hand before the first
   screen is written. */
(function (window, document) {
  'use strict';

  /* one engine to a page, however often the file is read */
  if (window.I18n) return;

  /* Each language in its own name, the way its script runs, the voice the
     phone reads it in, and the figures it counts in where they are its own. */
  var LANGS = [
    { code: 'ar', name: 'العربية', dir: 'rtl', speech: 'ar-SA' },
    { code: 'en', name: 'English', dir: 'ltr', speech: 'en-US' },
    { code: 'id', name: 'Bahasa Indonesia', dir: 'ltr', speech: 'id-ID' },
    { code: 'ms', name: 'Bahasa Melayu', dir: 'ltr', speech: 'ms-MY' },
    { code: 'fr', name: 'Français', dir: 'ltr', speech: 'fr-FR' },
    { code: 'ha', name: 'Hausa', dir: 'ltr', speech: 'ha-NG' },
    { code: 'tr', name: 'Türkçe', dir: 'ltr', speech: 'tr-TR' },
    { code: 'ru', name: 'Русский', dir: 'ltr', speech: 'ru-RU' },
    { code: 'bn', name: 'বাংলা', dir: 'ltr', speech: 'bn-BD', digits: '০১২৩৪৫৬৭৮৯' },
    { code: 'ur', name: 'اردو', dir: 'rtl', speech: 'ur-PK', digits: '۰۱۲۳۴۵۶۷۸۹', comma: '، ' },
    { code: 'fa', name: 'فارسی', dir: 'rtl', speech: 'fa-IR', digits: '۰۱۲۳۴۵۶۷۸۹', comma: '، ' }
  ];
  var BY_CODE = {};
  LANGS.forEach(function (l) { BY_CODE[l.code] = l; });

  /* The languages whose table ships with the app. The rest are known here,
     how they run and how they count, and join the list in the settings and
     the phone's own choice as their tables come: a phone set to one of them
     meanwhile is met in English, never with a page that falls back half way. */
  var READY = ['ar', 'en'];
  function ready(code) { return !!BY_CODE[code] && READY.indexOf(code) !== -1; }

  var KEY = 'sunnati.lang';

  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* a store that refuses keeps nothing */ }
  }

  /* The languages the phone is set to, in its own order. The packages may
     hand them over themselves, since a web view inside an app can report only
     the languages the app was built with. */
  function deviceLanguages() {
    var list = [];
    try {
      var app = window.SunnatiApp;
      if (app && typeof app.languages === 'function') list = String(app.languages() || '').split(',');
    } catch (e) { list = []; }
    var nav = window.navigator || {};
    if (nav.languages && nav.languages.length) list = list.concat(Array.prototype.slice.call(nav.languages));
    if (nav.language) list.push(nav.language);
    return list;
  }

  /* The first of the phone's languages the app speaks. A phone set to none
     of them gets English, which more of the world reads than any other of
     the eleven. «in» is the old name android still gives Indonesian. */
  function fromDevice() {
    var list = deviceLanguages();
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || '').trim().toLowerCase().split(/[-_]/)[0];
      if (code === 'in') code = 'id';
      if (code === 'zsm') code = 'ms';
      if (ready(code)) return code;
    }
    return list.length ? 'en' : 'ar';
  }

  /* Someone who has used the app before this file existed read it in Arabic,
     and an update must not hand them a screen in another language because
     their phone happens to be set to one: they keep Arabic until they choose.
     Someone opening it for the first time is met in the phone's language, and
     follows it until they choose one of their own here. */
  function chosen() {
    var stored = read(KEY);
    if (stored && ready(stored)) return stored;
    if (stored !== 'auto') {
      if (usedBefore()) { write(KEY, 'ar'); return 'ar'; }
      write(KEY, 'auto');
    }
    return fromDevice();
  }

  function usedBefore() {
    try {
      var store = window.localStorage;
      for (var i = 0; i < store.length; i++) {
        var k = store.key(i);
        if (k && k.indexOf('sunnati.') === 0 && k !== KEY) return true;
      }
    } catch (e) { /* no store, nothing remembered */ }
    return false;
  }

  var lang = chosen();
  var info = BY_CODE[lang];
  var root = document.documentElement;
  var active = lang !== 'ar';

  if (active) {
    root.setAttribute('lang', lang);
    root.setAttribute('dir', info.dir);
  }

  /* ---------------- the table ---------------- */

  /* Arabic letters, wherever Unicode keeps them */
  var AR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDEF\uFE70-\uFEFF]/;
  /* a word, with its vowel marks, which «سُنّتي» carries; and a letter that
     stands alone, ص for a page, م for metres, beside a number */
  var WORD = /[\u0621-\u065F\u0670-\u06D3\u06FA-\u06FF]{2,}/g;
  var LETTERS = /[\u0621-\u065F\u0670-\u06D3\u06FA-\u06FF]+/g;

  var exact = Object.create(null);
  var entries = 0;
  /* the composed lines, filed under the longest word they always carry, so a
     line is tried only against the few that could be it */
  var byWord = Object.create(null);
  var prefixes = Object.create(null);
  var memo = Object.create(null);
  var memoSize = 0;

  /* The page is written with newlines and indents in it, and a screen built
     in code puts spaces wherever the pieces meet, so a line is looked up with
     its runs of space made one, and nothing else touched: a no-break space is
     part of what the line says. */
  function norm(text) {
    return String(text).replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '');
  }

  /* {0} holds whatever the page put there, {#0} only a number: «بعد 3 أيام»
     is «بعد» around a count of days, never a count of «بعد 3». {0:surah} holds
     a name of that kind: الفجر in «سورة الفجر» is the surah, not the prayer. */
  var PLACE = /\{(#?\d+(?::[a-z]+)?)\}/;
  function addPattern(key, value) {
    var parts = key.split(PLACE);
    var lits = [];
    var order = [];
    var counts = [];
    var kinds = [];
    var words = [];
    var fixed = 0;
    for (var i = 0; i < parts.length; i++) {
      if (i % 2) {
        var place = /^(#?)(\d+)(?::([a-z]+))?$/.exec(parts[i]);
        order.push(+place[2]);
        counts.push(place[1] === '#');
        kinds.push(place[3] || null);
        continue;
      }
      lits.push(parts[i]);
      fixed += parts[i].length;
      words = words.concat(parts[i].match(WORD) || []);
    }
    /* a letter the page joins to the front of what follows, «و{0}», is kept
       apart and tried only on a line that begins with it */
    if (!words.length && order.length === 1 && lits.length === 2 && lits[0] && !lits[1] && AR.test(lits[0])) {
      prefixes[lits[0]] = { value: value, count: counts[0], kind: kinds[0] };
      return;
    }
    /* a line with no word of its own to find it by would be tried against
       everything, and would match far more than it means, unless its one
       letter stands by a number, «ص {#0}», «{#0} م»; and two places with
       nothing between them cannot be told apart */
    if (!words.length && counts.indexOf(true) !== -1) {
      lits.forEach(function (l) { words = words.concat(l.match(LETTERS) || []); });
    }
    if (!words.length) return;
    for (var j = 1; j < lits.length - 1; j++) if (!lits[j]) return;
    var anchor = words.sort(function (a, b) { return b.length - a.length; })[0];
    (byWord[anchor] = byWord[anchor] || []).push({ lits: lits, order: order, counts: counts, kinds: kinds, value: value, fixed: fixed });
  }

  /* A table is one object, the Arabic as the page writes it on the left and
     the language's own on the right. A line with {0} in it is a line the page
     composes, the numbered places standing for what it puts in them. A value
     may be an object of plural forms, chosen by the number put into the line,
     for the languages whose nouns change with it. */
  function add(table) {
    for (var key in table) {
      if (!Object.prototype.hasOwnProperty.call(table, key)) continue;
      var value = table[key];
      if (value === null || value === undefined) continue;
      var k = norm(key);
      if (PLACE.test(k)) addPattern(k, value);
      else exact[k] = value;
      entries++;
    }
    memo = Object.create(null);
    memoSize = 0;
    /* whatever was drawn before the table came is drawn again with it */
    if (typeof WeakMap === 'function') done = new WeakMap();
    if (active && document.body) walk(document.documentElement);
  }

  var plurals = null;
  function pluralOf(n) {
    try {
      if (!plurals) plurals = new Intl.PluralRules(info.speech);
      return plurals.select(n);
    } catch (e) { return n === 1 ? 'one' : 'other'; }
  }

  function form(value, number) {
    if (typeof value === 'string') return value;
    if (!value) return null;
    var cat = number === null ? 'other' : pluralOf(number);
    return value[cat] !== undefined ? value[cat] : value.other;
  }

  /* A time on the twelve hour clock carries ص or م after it, which the table
     says in the language's own way. An hour alone, «5 م», is a time only in
     the time picker, which says so; elsewhere it is five metres. */
  var TIME = /^(\d{1,2}:\d{2})[\s\u2060]*(ص|م)$/;
  var HOUR = /^(\d{1,2})[\s\u2060]*(ص|م)$/;

  /* the kind of name the line being read holds, while it is read: a place
     of a composed line says it, or the page around the words does with
     data-tr, as a list of surahs does */
  var kind = null;
  function known(text) {
    if (kind && (kind + ':' + text) in exact) return kind + ':' + text;
    return text in exact ? text : null;
  }

  function lookup(text, depth) {
    var hit0 = known(text);
    if (hit0 !== null) return form(exact[hit0], null);
    if (!AR.test(text)) return text;
    var time = TIME.exec(text) || (kind === 'time' ? HOUR.exec(text) : null);
    if (time) return time[1] + ' ' + (lookup(time[2], depth + 1) || time[2]);
    if (depth > 3) return null;
    /* a piece the page joined to the one before it with a comma carries
       the comma with it */
    var edge = /^([\s\u060C\u061B]*)([\s\S]*?)([\s\u060C\u061B]*)$/.exec(text);
    if (edge[1] || edge[3]) {
      var inner = edge[2] ? lookup(edge[2], depth + 1) : '';
      return inner === null ? null : commas(edge[1]) + inner + commas(edge[3]);
    }
    /* a composed line read whole wins; one with a piece the table does not
       know waits until the other readings have had their turn */
    var partial = null;
    var hit = composed(text, depth);
    if (hit !== null) {
      if (hit.whole) return hit.text;
      partial = hit.text;
    }
    hit = joined(text, depth);
    if (hit !== null) return hit;
    hit = listed(text, depth);
    if (hit !== null) return hit;
    hit = named(text, depth);
    return hit !== null ? hit : partial;
  }

  function whole(r) { return r && r.whole ? r.text : null; }

  /* «ونبذة مختصرة…», «و23»: the letter the page joined on, and the rest */
  function joined(text, depth) {
    for (var p in prefixes) {
      if (text.indexOf(p) !== 0 || text.length === p.length) continue;
      var rest = text.slice(p.length);
      var got = /^\d[\d.,:]*$/.test(rest) ? rest : (prefixes[p].count ? null : part(rest, depth, prefixes[p].kind || kind));
      if (got !== null) return form(prefixes[p].value, null).replace(/\{#?0(?::[a-z]+)?\}/, got);
    }
    return null;
  }

  function commas(text) {
    return text.replace(/\u060C/g, info.comma ? '\u060C' : ',').replace(/\u061B/g, info.comma ? '\u061B' : ';');
  }

  /* A line of names the table knows with figures among them, the way the
     page writes a date, «الإثنين 19 أكتوبر 2026», or a reference, «البقرة
     201», or a prayer on a day, «الفجر 15»: each name put into the language
     where it stands, and a count with its noun, «3 أيام», as one. Only a
     short line with a figure in it, so a sentence is never put together word
     by word. */
  function named(text, depth) {
    var words = text.split(' ');
    if (words.length > 10 || !/\d/.test(text)) return null;
    var out = [];
    for (var i = 0; i < words.length;) {
      var got = null;
      for (var n = Math.min(4, words.length - i); n > 1 && got === null; n--) {
        var run = words.slice(i, i + n).join(' ');
        if (!AR.test(run)) continue;
        var key = known(run);
        got = key !== null ? form(exact[key], null) : (depth < 3 ? whole(composed(run, depth + 1)) : null);
        if (got !== null) i += n;
      }
      if (got === null) {
        var one = words[i];
        var single = known(one);
        if (!AR.test(one)) got = one;
        else if (single !== null) got = form(exact[single], null);
        else got = joined(one, depth + 1);
        if (got === null) return null;
        i++;
      }
      out.push(got);
    }
    return out.join(' ');
  }

  /* What the page put into a composed line is translated too, when it is
     something the table knows: a prayer's name, a surah's, a month's. The lam
     of «للكويت» swallowed the alef of the name it was joined to, so the name
     is looked for with it put back. Null when it is Arabic the table does not
     know. */
  function part(text, depth, of) {
    if (of !== undefined && of !== kind) {
      var was = kind;
      kind = of;
      try { return part(text, depth); } finally { kind = was; }
    }
    var t = norm(text);
    if (!AR.test(t)) return t;
    var got = lookup(t, depth + 1);
    if (got !== null) return got;
    if (t.indexOf('لل') === 0) {
      got = lookup('ال' + t.slice(2), depth + 1);
      if (got !== null) return got;
    }
    if (t.charAt(0) === 'ل' && t.length > 2) {
      got = lookup(t.slice(1), depth + 1);
      if (got !== null) return got;
    }
    return null;
  }

  /* Every way the line can be cut along the fixed words of a composed one,
     shortest first. A month of two words, «ربيع الآخر», in a date the page
     wrote as day, month and year with spaces between, is cut where it reads
     right only because the cut that reads wrong leaves «ربيع» on its own and
     «الآخر 1448» after it, which nothing knows. */
  function cuts(p, text) {
    var lits = p.lits;
    var last = lits.length - 1;
    if (text.indexOf(lits[0]) !== 0) return [];
    var end = text.length - lits[last].length;
    if (end < lits[0].length || text.slice(end) !== lits[last]) return [];
    var found = [];
    (function next(i, at, taken) {
      if (found.length >= 12) return;
      if (i === last) {
        /* the last place may be empty, a tail the page adds only sometimes,
           when nothing follows it */
        if (end > at || (end === at && !lits[last])) found.push(taken.concat(text.slice(at, end)));
        return;
      }
      for (var from = at + 1; from < end; from++) {
        var pos = text.indexOf(lits[i], from);
        if (pos === -1 || pos + lits[i].length > end) return;
        next(i + 1, pos + lits[i].length, taken.concat(text.slice(at, pos)));
        if (found.length >= 12) return;
        from = pos;
      }
    })(1, lits[0].length, []);
    return found;
  }

  function fill(p, taken, depth) {
    var values = {};
    var number = null;
    var whole = true;
    for (var j = 0; j < p.order.length; j++) {
      var raw = taken[j];
      if (p.counts[j] && !/^\s*\d[\d.,:]*\s*$/.test(raw)) return null;
      if (number === null && /^\s*\d+\s*$/.test(raw)) number = +raw;
      var got = part(raw, depth, p.kinds[j] || kind);
      if (got === null) { whole = false; got = norm(raw); }
      values[p.order[j]] = got;
    }
    var out = form(p.value, number);
    if (out === null) return null;
    return {
      whole: whole,
      text: out.replace(/\{#?(\d+)(?::[a-z]+)?\}/g, function (all, n) { return values[n] !== undefined ? values[n] : ''; })
    };
  }

  /* The composed lines the text could be, longest fixed words first, and the
     first cut of them whose every piece is known. Failing that, the best of
     them with the unknown pieces left as they are, which reads better than
     the whole line left in Arabic. */
  function composed(text, depth) {
    var words = text.match(LETTERS);
    if (!words) return null;
    var seen = {};
    var found = [];
    for (var w = 0; w < words.length; w++) {
      if (seen[words[w]]) continue;
      seen[words[w]] = true;
      var list = byWord[words[w]];
      if (list) found = found.concat(list);
    }
    if (!found.length) return null;
    found.sort(function (a, b) { return b.fixed - a.fixed; });
    var fallback = null;
    for (var i = 0; i < found.length; i++) {
      var ways = cuts(found[i], text);
      for (var k = 0; k < ways.length; k++) {
        var r = fill(found[i], ways[k], depth);
        if (!r) continue;
        if (r.whole) return r;
        if (fallback === null) fallback = r;
      }
    }
    return fallback;
  }

  /* A line the page joined from pieces with a comma or a dot between them,
     when every piece is one the table knows. A piece may itself hold a
     comma, «مسلم، حديث جبريل», so the longest run the table knows is taken
     first. */
  var JOINS = ['\u060C ', ' \u00B7 '];
  function listed(text, depth) {
    for (var j = 0; j < JOINS.length; j++) {
      if (text.indexOf(JOINS[j]) === -1) continue;
      var pieces = text.split(JOINS[j]);
      var out = [];
      for (var i = 0; i < pieces.length;) {
        var got = null;
        for (var n = pieces.length - i; n > 0 && got === null; n--) {
          if (n === pieces.length) continue;
          var run = norm(pieces.slice(i, i + n).join(JOINS[j]));
          if (!AR.test(run)) got = run;
          else if (n === 1) got = lookup(run, depth + 1);
          else got = known(run) !== null ? form(exact[known(run)], null) : whole(composed(run, depth + 1));
          if (got !== null) i += n;
        }
        if (got === null) return null;
        out.push(got);
      }
      return out.join(j === 0 ? (info.comma || ', ') : JOINS[j]);
    }
    return null;
  }

  /* The figures, in the scripts that have their own. A run of them touching
     a Latin letter is part of a name or an address and is left as it is:
     sunnati.3li.info is not a number. */
  function figures(text) {
    var digits = info.digits;
    if (!digits || !/\d/.test(text)) return text;
    return text.replace(/\d+/g, function (run, at, all) {
      if (/[A-Za-z]/.test(all.charAt(at - 1)) || /[A-Za-z]/.test(all.charAt(at + run.length))) return run;
      return run.replace(/\d/g, function (d) { return digits.charAt(+d); });
    });
  }

  /* One line, its leading and trailing space kept where they were, since
     they are what separates it from the words beside it. */
  /* A line drawn once already had its figures put in the language's own
     script; read again, it is read with the page's figures, which the table
     is written in. The mushaf counts its pages in the Arabic figures, and
     what of it is put into another language counts in that language's. */
  function plain(text) {
    return text.replace(/[\u0660-\u0669\u06F0-\u06F9\u09E6-\u09EF]/g, function (d) {
      var c = d.charCodeAt(0);
      return String(c - (c >= 0x09E6 ? 0x09E6 : c >= 0x06F0 ? 0x06F0 : 0x0660));
    });
  }

  function line(text, of) {
    var raw = plain(String(text));
    if (!AR.test(raw)) return figures(raw);
    var core = norm(raw);
    if (!core) return raw;
    var got;
    var mark = (of || '') + '\u0000' + core;
    if (mark in memo) got = memo[mark];
    else {
      kind = of || null;
      try { got = lookup(core, 0); } finally { kind = null; }
      if (memoSize > 4000) { memo = Object.create(null); memoSize = 0; }
      memo[mark] = got;
      memoSize++;
    }
    if (got === null) {
      var times = core.replace(/(\d{1,2}:\d{2})[\s\u2060]+(ص|م)(?=\s|$)/g, function (all, t, half) {
        return t + ' ' + (lookup(half, 1) || half);
      });
      if (AR.test(times)) return figures(raw);
      got = times;
    }
    var lead = /^[ \t\n\r\f]*/.exec(raw)[0];
    var tail = /[ \t\n\r\f]*$/.exec(raw)[0];
    return figures(lead + got + tail);
  }

  /* For what never reaches the page: a notification, a line the phone
     speaks, the words that go with a shared picture, a title. Each line of it
     on its own, so a verse quoted above its reference keeps its Arabic while
     the reference beneath it is translated. */
  function tx(text) {
    if (!active || text === null || text === undefined) return text;
    return String(text).split('\n').map(line).join('\n');
  }

  /* ---------------- the page ---------------- */

  /* what only ever holds the Quran or a remembrance; the hadith, the
     supplications and the tafsir, set in the naskh like some of the app's own
     words, are marked translate="no" where they are drawn */
  var SACRED = '.ayah-block,.basmala,.quran,.dhikr-text,.dhikr-note,.counter-phrase,.mad-page,.page-surah,.page-foot-num,.salawat-text,.hit-text';
  var KEEP = '[translate="no"],script,style,textarea,noscript,' + SACRED;
  var ATTRS = ['aria-label', 'title', 'alt', 'placeholder', 'aria-valuetext', 'aria-roledescription'];
  var done = typeof WeakMap === 'function' ? new WeakMap() : null;

  function kept(el) {
    return !!(el.matches && el.matches(KEEP));
  }

  /* Arabic kept as Arabic is said to be so, for the reader's screen reader
     and for the browser's choice of face and direction. */
  function markArabic(el) {
    if (!el.matches || !el.matches(SACRED)) return;
    if (!el.hasAttribute('lang')) el.setAttribute('lang', 'ar');
    if (!el.hasAttribute('dir')) el.setAttribute('dir', 'rtl');
  }

  function kindAt(el) {
    var host = el && el.closest ? el.closest('[data-tr]') : null;
    return host ? host.getAttribute('data-tr') : null;
  }

  function textNode(node) {
    var data = node.data;
    if (done && done.get(node) === data) return;
    var next = line(data, kindAt(node.parentNode));
    if (next !== data) node.data = next;
    if (done) done.set(node, next);
  }

  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (!v || !AR.test(v)) continue;
      var next = line(v, kindAt(el));
      if (next !== v) el.setAttribute(ATTRS[i], next);
    }
  }

  function walk(start) {
    /* nothing to draw with until the table has come */
    if (!start || !entries) return;
    if (start.nodeType === 3) { textNode(start); return; }
    if (start.nodeType !== 1 && start.nodeType !== 9 && start.nodeType !== 11) return;
    if (start.nodeType === 1) {
      if (kept(start)) { markArabic(start); return; }
      attrs(start);
    }
    var walker = document.createTreeWalker(start, 5 /* elements and text */, {
      acceptNode: function (n) {
        if (n.nodeType === 3) return 1;
        if (kept(n)) { markArabic(n); return 2; }
        attrs(n);
        return 3;
      }
    });
    var n;
    while ((n = walker.nextNode())) textNode(n);
  }

  function inside(node) {
    var el = node.nodeType === 1 ? node : node.parentNode;
    if (!el || el.nodeType !== 1) return true;
    return !(el.closest && el.closest(KEEP));
  }

  var observer = null;
  function onChange(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        if (!inside(r.target)) continue;
        for (var j = 0; j < r.addedNodes.length; j++) {
          var added = r.addedNodes[j];
          if (added.parentNode) walk(added);
        }
      } else if (r.type === 'characterData') {
        if (inside(r.target)) textNode(r.target);
      } else if (r.type === 'attributes') {
        if (inside(r.target)) attrs(r.target);
      }
    }
    /* what was just written here raised records of its own, and they are
       not news */
    if (observer) observer.takeRecords();
  }

  function watch() {
    if (!active || observer || typeof window.MutationObserver !== 'function') return;
    observer = new window.MutationObserver(onChange);
    observer.observe(document, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  /* Draws now what would otherwise be drawn a moment later, for code that
     measures what it has just written. */
  function apply(node) {
    if (!active) return;
    if (observer) onChange(observer.takeRecords());
    walk(node || document);
  }

  /* A language chosen by the reader, or «auto» to follow the phone. The page
     opens again in it: every screen is drawn once, in one language. */
  function choose(code) {
    if (code !== 'auto' && !ready(code)) return;
    write(KEY, code);
    try { window.I18n.reload(); } catch (e) { /* a page that cannot reload keeps its language until it opens next */ }
  }

  window.I18n = {
    lang: lang,
    dir: info.dir,
    speech: info.speech,
    langs: LANGS.filter(function (l) { return ready(l.code); }).map(function (l) { return { code: l.code, name: l.name, dir: l.dir }; }),
    stored: function () { return read(KEY) || 'auto'; },
    device: fromDevice,
    add: add,
    tx: tx,
    apply: apply,
    choose: choose,
    reload: function () { window.location.reload(); },
    figures: function (text) { return active ? figures(String(text)) : String(text); }
  };

  if (!active) return;

  /* The language's table is read before the rest of the page is parsed, so
     not a single screen is drawn without it. A page already parsed, as in a
     test, is handed its table by whoever opened it. */
  if (document.currentScript && document.readyState === 'loading' && typeof document.write === 'function') {
    document.write('<script src="i18n/' + lang + '.js"><\/script>');
  }

  watch();
  walk(document.documentElement);

  /* A table that never came, offline on a first run in a new language, leaves
     the page as it was written rather than Arabic running the wrong way. */
  document.addEventListener('DOMContentLoaded', function () {
    if (entries) return;
    active = false;
    if (observer) { observer.disconnect(); observer = null; }
    root.setAttribute('lang', 'ar');
    root.setAttribute('dir', 'rtl');
    window.I18n.lang = 'ar';
    window.I18n.dir = 'rtl';
  });
})(window, document);
