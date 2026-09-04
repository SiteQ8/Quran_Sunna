/* Sunnati mushaf module
   Holds the whole Uthmani text in memory once it loads, so reading, searching and
   khatma planning all work with the network switched off. */
(function (root) {
  'use strict';

  var data = null;
  var normalized = null;
  var expanded = null;
  var index = null;

  function isMark(code) {
    return (code >= 0x0610 && code <= 0x061A) ||
      (code >= 0x064B && code <= 0x065F) ||
      (code >= 0x06D6 && code <= 0x06ED) ||
      code === 0x0640;
  }

  /* Folds a verse down to bare letters and records, for every letter kept, the
     position it came from. Search needs the fold and highlighting needs the
     positions, so producing both in one walk stops them drifting apart, which
     is what makes a highlight land on the wrong word.

     When wide is true the three small letters that stand for a whole sound are
     written out, because the Uthmani script hides a long vowel inside a mark,
     so الصابرين is carried as الصٰبرين and الصلاة as الصلوٰة. */
  function foldMap(text, wide) {
    var src = String(text === null || text === undefined ? '' : text);
    var out = [];
    var from = [];
    var i, code, piece, k;

    for (i = 0; i < src.length; i++) {
      code = src.charCodeAt(i);

      if (code === 0x0670) {
        if (!wide) piece = '';
        else if (out.length && out[out.length - 1] === '\u0648') {
          /* A waw carrying the dagger alef reads as one alef. */
          out.pop(); from.pop();
          piece = '\u0627';
        } else piece = '\u0627';
      } else if (code === 0x06E5) piece = wide ? '\u0648' : '';
      else if (code === 0x06E6) piece = wide ? '\u064A' : '';
      else if (isMark(code)) piece = '';
      else if (code === 0x0622 || code === 0x0623 || code === 0x0625 ||
        (code >= 0x0671 && code <= 0x0673)) piece = '\u0627';
      else if (code === 0x0624) piece = '\u0648';
      else if (code === 0x0621) piece = '';
      else if (code === 0x0626 || code === 0x0649) piece = '\u064A';
      else if (code === 0x0629) piece = '\u0647';
      else if (/\s/.test(src[i])) {
        piece = (out.length && out[out.length - 1] !== ' ') ? ' ' : '';
      } else piece = src[i];

      for (k = 0; k < piece.length; k++) { out.push(piece[k]); from.push(i); }
    }

    while (out.length && out[out.length - 1] === ' ') { out.pop(); from.pop(); }
    var head = 0;
    while (head < out.length && out[head] === ' ') head++;
    if (head) { out = out.slice(head); from = from.slice(head); }

    return { plain: out.join(''), from: from };
  }

  /* The fold most people type. The small letters go away here, which is the
     spelling of a word like الرحمن. */
  function normalize(text) {
    return foldMap(text, false).plain;
  }

  /* The same fold with the small letters written out, so a reader who types
     الصابرين reaches the same verses as one who types الصبرين. */
  function expand(text) {
    return foldMap(text, true).plain;
  }

  /* Where the query sits inside the pointed text, tried against both folds.
     Returns positions into the original verse, so a caller can wrap the match
     without disturbing a single letter or mark. */
  function spanFor(text, query) {
    var needle = normalize(query);
    if (!needle) return null;
    var folds = [false, true];
    for (var f = 0; f < folds.length; f++) {
      var fold = foldMap(text, folds[f]);
      var at = fold.plain.indexOf(needle);
      if (at === -1) continue;
      var start = fold.from[at];
      var last = fold.from[at + needle.length - 1];
      if (start === undefined || last === undefined) continue;
      return { start: start, end: last + 1, wide: folds[f] };
    }
    return null;
  }

  function buildIndex() {
    normalized = [];
    expanded = null;
    index = [];
    var running = 0;
    for (var s = 0; s < data.a.length; s++) {
      var verses = data.a[s];
      var row = new Array(verses.length);
      for (var a = 0; a < verses.length; a++) row[a] = normalize(verses[a]);
      normalized.push(row);
      index.push(running);
      running += verses.length;
    }
    return running;
  }

  /* The second fold is only needed once somebody searches, so a reader who
     never opens the search field never pays for it. */
  function wideIndex() {
    if (expanded) return expanded;
    expanded = [];
    for (var s = 0; s < data.a.length; s++) {
      var verses = data.a[s];
      var wide = new Array(verses.length);
      for (var a = 0; a < verses.length; a++) wide[a] = expand(verses[a]);
      expanded.push(wide);
    }
    return expanded;
  }

  function init(payload) {
    if (!payload || !payload.a || payload.a.length !== 114) throw new Error('mushaf payload is not valid');
    data = payload;
    var total = buildIndex();
    if (total !== 6236) throw new Error('expected 6236 verses, found ' + total);
    return api;
  }

  function ready() { return !!data; }

  function load(fetcher) {
    if (data) return Promise.resolve(api);
    var get = fetcher || function (url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('mushaf request failed with ' + r.status);
        return r.json();
      });
    };
    return Promise.resolve(get('data/mushaf.json')).then(init);
  }

  function surah(n) {
    if (!data) return [];
    return data.a[n - 1] || [];
  }

  function ayah(s, a) {
    var list = surah(s);
    return list[a - 1] || '';
  }

  function basmala() { return data ? data.b : ''; }

  function verseCount(s) { return surah(s).length; }

  function totalVerses() { return 6236; }

  /* One based running number of a verse across the whole mushaf. */
  function globalIndex(s, a) {
    if (!data) return 0;
    return index[s - 1] + a;
  }

  function fromGlobalIndex(n) {
    if (!data || n < 1 || n > 6236) return null;
    for (var s = 113; s >= 0; s--) {
      if (index[s] < n) return { s: s + 1, a: n - index[s] };
    }
    return null;
  }

  function boundaryOf(list, s, a) {
    var target = globalIndex(s, a);
    var found = 1;
    for (var i = 0; i < list.length; i++) {
      if (globalIndex(list[i][0], list[i][1]) <= target) found = i + 1; else break;
    }
    return found;
  }

  function juzOf(s, a) { return data ? boundaryOf(data.j, s, a) : 1; }
  function pageOf(s, a) { return data ? boundaryOf(data.p, s, a) : 1; }
  function juzStart(n) { return data && data.j[n - 1] ? { s: data.j[n - 1][0], a: data.j[n - 1][1] } : null; }
  function pageStart(n) { return data && data.p[n - 1] ? { s: data.p[n - 1][0], a: data.p[n - 1][1] } : null; }

  function isSajda(s, a) {
    if (!data) return false;
    for (var i = 0; i < data.s.length; i++) {
      if (data.s[i][0] === s && data.s[i][1] === a) return true;
    }
    return false;
  }

  function sajdaList() { return data ? data.s.slice() : []; }

  /* Substring search over the folded text. Returns verses in mushaf order. */
  /* A query is matched against both folds, so either spelling of a word that
     hides a long vowel behind a mark finds the verse. */
  function locate(s, a, needle) {
    var at = normalized[s][a].indexOf(needle);
    if (at !== -1) return { at: at, plain: normalized[s][a], wide: false };
    var wide = wideIndex();
    at = wide[s][a].indexOf(needle);
    if (at !== -1) return { at: at, plain: wide[s][a], wide: true };
    return null;
  }

  function search(query, opts) {
    opts = opts || {};
    var limit = opts.limit || 50;
    var needle = normalize(query);
    if (!data || needle.length < 2) return [];
    var out = [];
    for (var s = 0; s < normalized.length; s++) {
      if (opts.surah && opts.surah !== s + 1) continue;
      var row = normalized[s];
      for (var a = 0; a < row.length; a++) {
        var found = locate(s, a, needle);
        if (!found) continue;
        out.push({
          s: s + 1, a: a + 1, text: data.a[s][a],
          at: found.at, plain: found.plain, wide: found.wide
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  function countMatches(query) {
    var needle = normalize(query);
    if (!data || needle.length < 2) return 0;
    var total = 0;
    for (var s = 0; s < normalized.length; s++) {
      for (var a = 0; a < normalized[s].length; a++) {
        if (locate(s, a, needle)) total++;
      }
    }
    return total;
  }

  /* Splits the 604 pages of the mushaf across a chosen number of days. */
  function khatmaPlan(days, startPage) {
    days = Math.max(1, Math.min(365, Math.round(days || 30)));
    var first = Math.max(1, Math.min(604, startPage || 1));
    var remaining = 604 - first + 1;
    var base = Math.floor(remaining / days);
    var extra = remaining % days;
    var plan = [];
    var cursor = first;
    for (var i = 0; i < days; i++) {
      var take = base + (i < extra ? 1 : 0);
      if (take <= 0) { plan.push({ day: i + 1, from: null, to: null, pages: 0 }); continue; }
      plan.push({ day: i + 1, from: cursor, to: cursor + take - 1, pages: take });
      cursor += take;
    }
    return plan;
  }

  /* Where a reader should be today given the plan and how far they have read. */
  function khatmaStatus(plan, elapsedDays, pagesRead) {
    var dayIndex = Math.max(0, Math.min(plan.length - 1, elapsedDays));
    var target = 0;
    for (var i = 0; i <= dayIndex; i++) target += plan[i].pages;
    var done = Math.max(0, Math.min(604, pagesRead || 0));
    return {
      today: plan[dayIndex],
      dueByToday: target,
      read: done,
      ahead: done - target,
      percent: Math.round((done / 604) * 100),
      finished: done >= 604
    };
  }

  var api = {
    normalize: normalize,
    expand: expand,
    spanFor: spanFor,
    init: init,
    load: load,
    ready: ready,
    surah: surah,
    ayah: ayah,
    basmala: basmala,
    verseCount: verseCount,
    totalVerses: totalVerses,
    globalIndex: globalIndex,
    fromGlobalIndex: fromGlobalIndex,
    juzOf: juzOf,
    pageOf: pageOf,
    juzStart: juzStart,
    pageStart: pageStart,
    isSajda: isSajda,
    sajdaList: sajdaList,
    search: search,
    countMatches: countMatches,
    khatmaPlan: khatmaPlan,
    khatmaStatus: khatmaStatus
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Mushaf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
