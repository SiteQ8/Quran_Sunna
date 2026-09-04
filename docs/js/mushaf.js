/* Sunnati mushaf module
   Holds the whole Uthmani text in memory once it loads, so reading, searching and
   khatma planning all work with the network switched off. */
(function (root) {
  'use strict';

  var data = null;
  var normalized = null;
  var expanded = null;
  var index = null;

  var DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

  /* Every mark except the three small letters that stand in for a whole sound. */
  var MARKS_ONLY = /[\u0610-\u061A\u064B-\u065F\u06D6-\u06E4\u06E7-\u06ED\u0640]/g;

  function fold(text) {
    return text
      .replace(/[\u0622\u0623\u0625\u0671\u0672\u0673]/g, '\u0627')
      .replace(/\u0624/g, '\u0648')
      .replace(/\u0621/g, '')
      .replace(/[\u0626\u0649]/g, '\u064A')
      .replace(/\u0629/g, '\u0647')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Folds a verse down to bare letters so a search without vowel marks still hits.
     The small letters go away here, which is the spelling most people type for a
     word like الرحمن. */
  function normalize(text) {
    if (!text) return '';
    return fold(String(text).replace(DIACRITICS, ''));
  }

  /* The same fold, except the dagger alef and the small waw and yeh are written
     out in full. The Uthmani script hides a long vowel inside a mark, so الصابرين
     is carried as الصٰبرين and الصلاة as الصلوٰة, and a reader who types either
     spelling deserves the same verse. */
  function expand(text) {
    if (!text) return '';
    return fold(String(text)
      .replace(MARKS_ONLY, '')
      .replace(/\u0648\u0670/g, '\u0627')
      .replace(/\u0670/g, '\u0627')
      .replace(/\u06E5/g, '\u0648')
      .replace(/\u06E6/g, '\u064A'));
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
