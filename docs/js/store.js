/* Sunnati store
   One place for settings, daily worship records and backups, so the rest of the
   app never touches raw storage keys and an older install keeps its progress. */
(function (root) {
  'use strict';

  var PREFIX = 'sunnati.';
  var DAY_PREFIX = PREFIX + 'day.';
  var KEEP_DAYS = 400;

  var DEFAULTS = {
    theme: 'auto',
    accent: 'sadu',
    pattern: 'sadu',
    fontScale: 100,
    quranFont: 'amiri',
    method: 'Ojeiri',
    asr: 'shafi',
    highLat: 'angleBased',
    hijriAdjust: 0,
    lat: null,
    lng: null,
    city: '',
    tzOffset: null,
    zone: null,
    notify: false,
    salawat: 0,
    salawatAt: 0,
    umrah: {},
    readPace: 'mid',
    clock: '12',
    listenAs: '',
    friday: true,
    fridayShown: '',
    eidShown: '',
    qiyam: false,
    duha: false,
    wirdAt: '',
    jumuahBefore: 0,
    jumuahNight: true,
    qadaDone: {},
    afterPrayerOff: false,
    afterPrayerShown: '',
    fastOwed: 0,
    fastDone: 0,
    adhanVoice: 'none',
    salawatVoice: 'ibrahimiyya',
    voice: 'recording',
    voiceName: '',
    placeAsked: false,
    notifyAsked: false,
    inApp: false,
    chromeExplained: false,
    audioSaved: {},
    lastPage: 1,
    notified: {},
    reciter: 'ar.minshawi',
    tafsir: 'ar.muyassar',
    khatmaDays: 30,
    khatmaStart: null,
    vibrate: true,
    lastRead: null,
    tour: false
  };

  var memory = {};
  var backend = null;

  function memoryBackend() {
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null; },
      setItem: function (k, v) { memory[k] = String(v); },
      removeItem: function (k) { delete memory[k]; },
      key: function (i) { return Object.keys(memory)[i]; },
      get length() { return Object.keys(memory).length; }
    };
  }

  function attach(storage) {
    cache = null;
    if (storage) { backend = storage; return backend; }
    try {
      var probe = PREFIX + 'probe';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      backend = root.localStorage;
    } catch (e) {
      backend = memoryBackend();
    }
    return backend;
  }

  function store() { return backend || attach(); }

  function readJSON(key, fallback) {
    try {
      var raw = store().getItem(key);
      if (raw === null || raw === undefined) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null ? fallback : parsed;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { store().setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function keys() {
    var out = [];
    var s = store();
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (k && k.indexOf(PREFIX) === 0) out.push(k);
    }
    return out;
  }

  /* Settings */

  var cache = null;

  function settings() {
    if (cache) return cache;
    var saved = readJSON(PREFIX + 'settings', {});
    cache = {};
    for (var k in DEFAULTS) cache[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : DEFAULTS[k];
    return cache;
  }

  function set(key, value) {
    var s = settings();
    s[key] = value;
    writeJSON(PREFIX + 'settings', s);
    return value;
  }

  function setMany(patch) {
    var s = settings();
    for (var k in patch) s[k] = patch[k];
    writeJSON(PREFIX + 'settings', s);
    return s;
  }

  function get(key) {
    var s = settings();
    return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : DEFAULTS[key];
  }

  function resetSettings() {
    cache = null;
    try { store().removeItem(PREFIX + 'settings'); } catch (e) { /* nothing to clear */ }
    return settings();
  }

  /* Daily records */

  function dayKey(date) {
    var d = date || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function emptyDay() {
    return { azkar: {}, hisn: {}, sunnah: {}, wird: {}, prayers: {}, tasbih: 0, pages: 0, ayahs: 0 };
  }

  function day(date) {
    var rec = readJSON(DAY_PREFIX + dayKey(date), null);
    if (!rec) return emptyDay();
    var base = emptyDay();
    for (var k in base) if (Object.prototype.hasOwnProperty.call(rec, k)) base[k] = rec[k];
    return base;
  }

  function saveDay(rec, date) {
    return writeJSON(DAY_PREFIX + dayKey(date), rec);
  }

  function updateDay(mutator, date) {
    var rec = day(date);
    mutator(rec);
    saveDay(rec, date);
    return rec;
  }

  function toggleSunnah(id, date) {
    var rec = day(date);
    rec.sunnah[id] = !rec.sunnah[id];
    saveDay(rec, date);
    return rec.sunnah[id];
  }

  function setAzkarCount(section, itemIndex, count, date) {
    var rec = day(date);
    if (!rec.azkar[section]) rec.azkar[section] = {};
    rec.azkar[section][itemIndex] = count;
    saveDay(rec, date);
    return count;
  }

  /* The counters of the book's chapters, kept beside the daily ones and reset
     with the day like them. */
  function setHisnCount(chapter, itemIndex, count, date) {
    var record = day(date);
    if (!record.hisn) record.hisn = {};
    if (!record.hisn[chapter]) record.hisn[chapter] = {};
    record.hisn[chapter][itemIndex] = Math.max(0, count);
    saveDay(record, date);
  }

  function resetHisn(chapter, date) {
    var record = day(date);
    if (record.hisn) delete record.hisn[chapter];
    saveDay(record, date);
  }

  function hisnProgress(chapter, total, date) {
    var counts = (day(date).hisn || {})[chapter] || {};
    var done = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] === 0) done++; });
    return { done: done, total: total, percent: total ? Math.round(done / total * 100) : 0 };
  }

  /* The five prayers of a day, each marked how it was prayed: in congregation,
     on time, made up later, or not yet. A blank means nothing was said. */
  var PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  var PRAYER_STATES = ['jamaah', 'ontime', 'late', 'missed'];

  function setPrayer(key, state, date) {
    if (PRAYER_KEYS.indexOf(key) === -1) return;
    var record = day(date);
    if (!record.prayers) record.prayers = {};
    if (!state || PRAYER_STATES.indexOf(state) === -1) delete record.prayers[key];
    else record.prayers[key] = state;
    saveDay(record, date);
  }

  function prayersOf(date) {
    return (day(date).prayers) || {};
  }

  /* How the last so many days went: prayed in time (jamaah or ontime), made
     up, missed, and the run of days with all five in time ending today. */
  /* What is owed and what has been made up. A prayer marked missed is owed
     until it is made up; the count of made-up ones is kept apart so the
     record of the day itself is never rewritten. */
  function qadaOwed() {
    var missed = {};
    PRAYER_KEYS.forEach(function (k) { missed[k] = 0; });
    keys().forEach(function (k) {
      if (k.indexOf(DAY_PREFIX) !== 0) return;
      var prayers = (readJSON(k, {}) || {}).prayers || {};
      PRAYER_KEYS.forEach(function (p) { if (prayers[p] === 'missed') missed[p]++; });
    });
    var done = readJSON(PREFIX + 'qadaDone', {});
    var out = {};
    PRAYER_KEYS.forEach(function (k) { out[k] = Math.max(0, missed[k] - (done[k] || 0)); });
    return out;
  }

  function markQada(key, by) {
    if (PRAYER_KEYS.indexOf(key) === -1) return;
    var done = readJSON(PREFIX + 'qadaDone', {});
    done[key] = Math.max(0, (done[key] || 0) + (by || 1));
    writeJSON(PREFIX + 'qadaDone', done);
  }

  /* The days of ramadan owed, and those already fasted for them. */
  function fastOwed() {
    return Math.max(0, (+get('fastOwed') || 0) - (+get('fastDone') || 0));
  }

  function setFastOwed(n) { set('fastOwed', Math.max(0, n | 0)); }

  function markFast(by) {
    set('fastDone', Math.max(0, (+get('fastDone') || 0) + (by || 1)));
  }

  function prayerStats(days, from) {
    var end = from ? new Date(from.getTime()) : new Date();
    var out = { days: days, prayed: 0, inTime: 0, jamaah: 0, late: 0, missed: 0, full: 0, streak: 0 };
    var streakAlive = true;
    for (var i = 0; i < days; i++) {
      var d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
      var rec = prayersOf(d);
      var inTimeToday = 0;
      PRAYER_KEYS.forEach(function (k) {
        var st = rec[k];
        if (!st) return;
        if (st === 'missed') { out.missed++; return; }
        out.prayed++;
        if (st === 'late') { out.late++; return; }
        out.inTime++; inTimeToday++;
        if (st === 'jamaah') out.jamaah++;
      });
      if (inTimeToday === 5) out.full++;
      /* the run counts whole days with all five in time; today may still be
         under way, so it joins the run only when full and breaks it only if a
         prayer today was already late or missed */
      if (streakAlive) {
        var spoiled = PRAYER_KEYS.some(function (k) { return rec[k] === 'late' || rec[k] === 'missed'; });
        if (inTimeToday === 5) out.streak++;
        else if (spoiled || i > 0) streakAlive = false;
      }
    }
    return out;
  }

  function azkarProgress(section, total, date) {
    var rec = day(date);
    var done = 0;
    var counts = rec.azkar[section] || {};
    for (var k in counts) if (counts[k] === 0) done++;
    return { done: done, total: total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  function addPages(count, date) {
    return updateDay(function (rec) { rec.pages = Math.max(0, (rec.pages || 0) + count); }, date);
  }

  function completion(date, totalSunnah) {
    var rec = day(date);
    var done = 0;
    for (var k in rec.sunnah) if (rec.sunnah[k]) done++;
    var total = totalSunnah || 0;
    return { done: done, total: total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  /* An active day is one where the reader ticked a sunnah, read, or made dhikr. */
  function wasActive(date) {
    var rec = day(date);
    for (var k in rec.sunnah) if (rec.sunnah[k]) return true;
    for (var s in rec.wird) if (rec.wird[s]) return true;
    if (rec.tasbih > 0 || rec.pages > 0 || rec.ayahs > 0) return true;
    for (var a in rec.azkar) {
      var counts = rec.azkar[a];
      for (var i in counts) if (counts[i] === 0) return true;
    }
    return false;
  }

  function streak(today) {
    var base = today || new Date();
    var current = 0;
    var cursor = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    if (!wasActive(cursor)) cursor.setDate(cursor.getDate() - 1);
    for (var i = 0; i < KEEP_DAYS; i++) {
      if (!wasActive(cursor)) break;
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }
    var longest = 0, run = 0;
    var scan = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    scan.setDate(scan.getDate() - KEEP_DAYS);
    for (var j = 0; j <= KEEP_DAYS; j++) {
      if (wasActive(scan)) { run++; if (run > longest) longest = run; } else run = 0;
      scan.setDate(scan.getDate() + 1);
    }
    return { current: current, longest: Math.max(longest, current) };
  }

  function heatmap(days, today, totalSunnah) {
    var out = [];
    var base = today || new Date();
    var start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    start.setDate(start.getDate() - (days - 1));
    for (var i = 0; i < days; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var c = completion(d, totalSunnah);
      out.push({ key: dayKey(d), date: d, percent: c.percent, active: wasActive(d) });
    }
    return out;
  }

  /* Bookmarks */

  function bookmarks() { return readJSON(PREFIX + 'bookmarks', []); }

  /* a note the reader wrote on a verse, kept by surah and verse */
  function notes() { return readJSON(PREFIX + 'notes', {}); }
  function note(s, a) { return notes()[s + ':' + a] || ''; }
  function setNote(s, a, text) {
    var all = notes();
    if (text && text.trim()) all[s + ':' + a] = text.trim(); else delete all[s + ':' + a];
    writeJSON(PREFIX + 'notes', all);
  }

  function isBookmarked(s, a) {
    return bookmarks().some(function (b) { return b.s === s && b.a === a; });
  }

  /* A bookmark is of a kind: reading, review, memorising, or reflection. The
     same kind pressed again removes it; another kind changes it. */
  var BOOKMARK_KINDS = ['read', 'review', 'memo', 'ponder'];

  function bookmarkKind(s, a) {
    var hit = bookmarks().filter(function (b) { return b.s === s && b.a === a; })[0];
    return hit ? (hit.c || 'read') : null;
  }

  function toggleBookmark(s, a, kind) {
    var want = BOOKMARK_KINDS.indexOf(kind) !== -1 ? kind : 'read';
    var list = bookmarks();
    var at = -1;
    for (var i = 0; i < list.length; i++) if (list[i].s === s && list[i].a === a) { at = i; break; }
    if (at >= 0) {
      if ((list[at].c || 'read') === want) { list.splice(at, 1); writeJSON(PREFIX + 'bookmarks', list); return false; }
      list[at].c = want; list[at].at = Date.now();
      writeJSON(PREFIX + 'bookmarks', list);
      return true;
    }
    list.unshift({ s: s, a: a, c: want, at: Date.now() });
    if (list.length > 300) list.pop();
    writeJSON(PREFIX + 'bookmarks', list);
    return true;
  }

  function clearBookmarks() { writeJSON(PREFIX + 'bookmarks', []); }

  /* Quran reading progress */

  function progress() { return readJSON(PREFIX + 'progress', { completed: [], ayahs: {}, pagesRead: 0 }); }

  function markSurahRead(n) {
    var p = progress();
    if (p.completed.indexOf(n) === -1) p.completed.push(n);
    writeJSON(PREFIX + 'progress', p);
    return p;
  }

  function markAyahRead(s, a) {
    var p = progress();
    if (!p.ayahs[s]) p.ayahs[s] = [];
    if (p.ayahs[s].indexOf(a) === -1) p.ayahs[s].push(a);
    writeJSON(PREFIX + 'progress', p);
    return p;
  }

  /* Cumulative khatma pages, kept apart from the per day record so a plan
     survives a quiet week and never drifts outside the mushaf. */
  function addReadPages(delta, date) {
    var p = progress();
    p.pagesRead = Math.max(0, Math.min(604, (p.pagesRead || 0) + delta));
    writeJSON(PREFIX + 'progress', p);
    if (delta > 0) addPages(delta, date);
    return p.pagesRead;
  }

  function setReadPages(value) {
    var p = progress();
    p.pagesRead = Math.max(0, Math.min(604, value || 0));
    writeJSON(PREFIX + 'progress', p);
    return p.pagesRead;
  }

  function resetProgress() { writeJSON(PREFIX + 'progress', { completed: [], ayahs: {}, pagesRead: 0 }); }

  /* Migration from the keys the earlier release used. */
  function migrate() {
    var moved = 0;
    var s = store();
    function old(key) { try { return s.getItem(key); } catch (e) { return null; } }

    if (!old(PREFIX + 'settings')) {
      var patch = {};
      var fs = old('sunnati_fontSize');
      if (fs) { patch.fontScale = parseInt(fs, 10) || 100; moved++; }
      var adj = old('sunnati_hijri_adj');
      if (adj) { patch.hijriAdjust = parseInt(adj, 10) || 0; moved++; }
      var dark = old('sunnati_dark');
      if (dark === '1' || dark === 'true') { patch.theme = 'dark'; moved++; }
      if (moved) setMany(patch);
    }

    var oldProgress = old('sunnati_quran_progress');
    if (oldProgress && !old(PREFIX + 'progress')) {
      try {
        var parsed = JSON.parse(oldProgress);
        writeJSON(PREFIX + 'progress', {
          completed: parsed.completed || [],
          ayahs: parsed.ayahs || {},
          pagesRead: parsed.pagesRead || 0
        });
        moved++;
      } catch (e) { /* leave the old value alone */ }
    }
    return moved;
  }

  function prune(today) {
    var base = today || new Date();
    var cutoff = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    var removed = 0;
    keys().forEach(function (k) {
      if (k.indexOf(DAY_PREFIX) !== 0) return;
      var stamp = k.slice(DAY_PREFIX.length);
      var parts = stamp.split('-');
      if (parts.length !== 3) return;
      var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (d < cutoff) { try { store().removeItem(k); removed++; } catch (e) { /* skip */ } }
    });
    return removed;
  }

  /* Backup */

  function exportAll() {
    var out = { app: 'sunnati', version: 5, exported: new Date().toISOString(), data: {} };
    keys().forEach(function (k) {
      try { out.data[k] = store().getItem(k); } catch (e) { /* skip unreadable key */ }
    });
    return JSON.stringify(out, null, 2);
  }

  function importAll(json) {
    var parsed;
    try { parsed = typeof json === 'string' ? JSON.parse(json) : json; }
    catch (e) { return { ok: false, error: 'الملف غير صالح', count: 0 }; }
    if (!parsed || parsed.app !== 'sunnati' || !parsed.data) {
      return { ok: false, error: 'هذا الملف ليس نسخة احتياطية من التطبيق', count: 0 };
    }
    var count = 0;
    for (var k in parsed.data) {
      if (k.indexOf(PREFIX) !== 0) continue;
      try { store().setItem(k, parsed.data[k]); count++; } catch (e) { /* skip */ }
    }
    cache = null;
    return { ok: true, count: count };
  }

  function clearAll() {
    var removed = 0;
    keys().forEach(function (k) { try { store().removeItem(k); removed++; } catch (e) { /* skip */ } });
    cache = null;
    return removed;
  }

  var api = {
    DEFAULTS: DEFAULTS,
    attach: attach,
    settings: settings,
    get: get,
    set: set,
    setMany: setMany,
    resetSettings: resetSettings,
    dayKey: dayKey,
    day: day,
    saveDay: saveDay,
    updateDay: updateDay,
    toggleSunnah: toggleSunnah,
    setAzkarCount: setAzkarCount,
    azkarProgress: azkarProgress,
    setPrayer: setPrayer,
    prayersOf: prayersOf,
    prayerStats: prayerStats,
    qadaOwed: qadaOwed,
    markQada: markQada,
    fastOwed: fastOwed,
    setFastOwed: setFastOwed,
    markFast: markFast,
    PRAYER_KEYS: PRAYER_KEYS,
    PRAYER_STATES: PRAYER_STATES,
    setHisnCount: setHisnCount,
    resetHisn: resetHisn,
    hisnProgress: hisnProgress,
    addPages: addPages,
    completion: completion,
    wasActive: wasActive,
    streak: streak,
    heatmap: heatmap,
    bookmarks: bookmarks,
    isBookmarked: isBookmarked,
    toggleBookmark: toggleBookmark,
    bookmarkKind: bookmarkKind,
    notes: notes,
    note: note,
    setNote: setNote,
    BOOKMARK_KINDS: BOOKMARK_KINDS,
    clearBookmarks: clearBookmarks,
    progress: progress,
    addReadPages: addReadPages,
    setReadPages: setReadPages,
    markSurahRead: markSurahRead,
    markAyahRead: markAyahRead,
    resetProgress: resetProgress,
    migrate: migrate,
    prune: prune,
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll,
    readJSON: readJSON,
    writeJSON: writeJSON
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
