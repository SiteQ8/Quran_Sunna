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
    /* null means «whatever the phone is set to»; true or false is the reader
       saying otherwise here */
    contrast: null,
    lessMotion: null,
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
    pageLayout: 'flow',
    qiyam: false,
    duha: false,
    /* the reader's own reminders, off until turned on */
    morningAdhkar: false,
    eveningAdhkar: false,
    sleepIstighfar: false,
    sleepMulk: false,
    sleepKursi: false,
    sleepAt: '22:30',
    /* the sound each makes: device, chime, or silent */
    remindSound: { morningAdhkar: 'device', eveningAdhkar: 'device', sleepIstighfar: 'device',
      sleepMulk: 'device', sleepKursi: 'device', duha: 'device', qiyam: 'device', wird: 'device',
      jumuahNight: 'device', fastNote: 'device', jumuahBefore: 'device' },
    wirdAt: '',
    /* which eid greeting was already shown, so it greets once a day */
    eidShown: '',
    jumuahBefore: 0,
    jumuahNight: true,
    fastNote: true,
    jumuahNightAt: 0,
    /* when the reader put tonight's sheet off, kept apart from the moment the
       notification is armed for: one key meaning two things made the sheet
       silence itself for the two minutes it was arming the notice */
    jumuahNightQuiet: 0,
    /* the sheet that greets the reader on the night itself, apart from the
       notification: a reader who wants no notice at night may still want the
       app to tell him which night it is when he opens it */
    jumuahNightSheet: true,
    /* the painted sky of the hour in the niche of the clock */
    sky: true,
    jumuahNightArmed: '',
    qadaDone: {},
    afterPrayerOff: false,
    afterPrayerShown: '',
    fastOwed: 0,
    fastDone: 0,
    adhanVoice: 'none',
    salawatVoice: 'buhendi',
    voice: 'recording',
    voiceName: '',
    placeAsked: false,
    placeFrom: '',
    /* what each of the three was set to before it was switched off, so
       turning it back on returns the reader to their own choice */
    lastWhen: { jumuahBefore: 60, salawat: 60, wirdAt: '20:00' },
    methodFrom: '',
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
    /* the walkthrough of the app, shown once to whoever opens it new */
    tour: false,
    /* the days the app has been opened, each counted once, and whether the
       reader has been asked to rate it, which happens once at most */
    usedDays: 0,
    usedOn: '',
    rateAsked: false,
    /* the count on the tasbih and the phrase it is on, kept with the day it
       was counted on, so a reload or the phone closing the app does not lose
       a count halfway to its hundred */
    tasbihNow: null,
    /* the reminders a browser has already raised, by their key and minute,
       so a reload never raises the same one twice */
    reminded: {}
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

  /* A default that is an object is handed out as a copy of its own. The
     settings used to hold the very object kept in DEFAULTS, so a caller that
     added to it in place (a step of the umrah, the sound of a reminder, a
     surah kept for listening) changed the default itself, and deleting all
     the data rebuilt the settings from those changed defaults and wrote the
     deleted record back with the next change of anything. */
  function fresh(value) {
    return value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  function settings() {
    if (cache) return cache;
    var saved = readJSON(PREFIX + 'settings', {});
    cache = {};
    for (var k in DEFAULTS) cache[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : fresh(DEFAULTS[k]);
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
    return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : fresh(DEFAULTS[key]);
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

  /* The order of the morning and evening lists a day was counted in. A dhikr
     is counted by its place in its list, and آية الكرسي and the three quls
     were set at the head of both, so a day without this mark was counted in
     the older order and the app moves its counts along once. */
  var AZKAR_ORDER = 1;

  /* marked: what a row of the hour card marked by itself, by the row, so a
     second touch can take back only that, even after the app was closed */
  function emptyDay() {
    return { azkar: {}, hisn: {}, sunnah: {}, marked: {}, wird: {}, prayers: {}, tasbih: 0, pages: 0, ayahs: 0, azkarOrder: AZKAR_ORDER };
  }

  /* A field of the wrong kind, which a hand-edited backup or an old build can
     leave behind ("sunnah": null), keeps its empty default: one bad day used
     to stop the whole home screen from drawing. */
  function day(date) {
    var rec = readJSON(DAY_PREFIX + dayKey(date), null);
    if (!rec || typeof rec !== 'object') return emptyDay();
    var base = emptyDay();
    for (var k in base) {
      if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
      var v = rec[k];
      var fits = typeof base[k] === 'object'
        ? (v !== null && typeof v === 'object' && !Array.isArray(v))
        : (typeof v === 'number' && isFinite(v));
      if (fits) base[k] = v;
    }
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

  /* Lowering the days owed below the days fasted lowers the fasted with them.
     The fasted days once outran the owed: every day added after was swallowed
     by them, and the counter read one day owed and nothing owed at once. */
  function setFastOwed(n) {
    var owed = Math.max(0, n | 0);
    set('fastOwed', owed);
    if ((+get('fastDone') || 0) > owed) set('fastDone', owed);
  }

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

  /* How much of a day's list is done. The app hands in the ticks the list
     offers that day, and only those are counted: a tick kept from an older
     list, or brought back by a backup, stands for no row and is not counted,
     so the meter cannot read more done than there is to do. A bare number is
     still read as the size of the list, the way the first callers asked. */
  function completion(date, countable) {
    var rec = day(date);
    var done = 0, total = 0;
    if (Array.isArray(countable)) {
      total = countable.length;
      countable.forEach(function (id) { if (rec.sunnah[id]) done++; });
    } else {
      total = countable || 0;
      for (var k in rec.sunnah) if (rec.sunnah[k]) done++;
      done = Math.min(done, total);
    }
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

  /* Each day is measured against its own list when a function hands one for
     it: a friday offers its own sunan, a monday its fast, and a day scored
     against another day's list reads too full or too empty. */
  function heatmap(days, today, countable) {
    var out = [];
    var base = today || new Date();
    var start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    start.setDate(start.getDate() - (days - 1));
    for (var i = 0; i < days; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var c = completion(d, typeof countable === 'function' ? countable(d) : countable);
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

  /* Every day kept, handed in turn to a function that may change it in
     place. The days it says it changed are written back, the rest are left
     as they were, and the number written is returned. */
  function eachDay(change) {
    var written = 0;
    keys().forEach(function (k) {
      if (k.indexOf(DAY_PREFIX) !== 0) return;
      var rec = readJSON(k, null);
      if (!rec || typeof rec !== 'object') return;
      if (change(rec, k.slice(DAY_PREFIX.length)) && writeJSON(k, rec)) written++;
    });
    return written;
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
    AZKAR_ORDER: AZKAR_ORDER,
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
    eachDay: eachDay,
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
