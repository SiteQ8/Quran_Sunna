/* ============================================================
   سُنّتي  ·  app controller
   Routing, the prayer clock, the reader, the trackers and the
   settings. No framework and no build step, so the file that
   ships is the file that runs.
   ============================================================ */
(function (window, document) {
  'use strict';

  var VERSION = '6.1.0';
  var DEFAULT_PLACE = { n: 'الكويت', lat: 29.3759, lng: 47.9774, tz: 3, z: 'Asia/Kuwait', method: 'Kuwait' };
  var ARC_LENGTH = 314.16;
  var TOTAL_PAGES = 604;

  var PRAYERS = [
    { key: 'fajr', ar: 'الفجر' },
    { key: 'sunrise', ar: 'الشروق' },
    { key: 'dhuhr', ar: 'الظهر' },
    { key: 'asr', ar: 'العصر' },
    { key: 'maghrib', ar: 'المغرب' },
    { key: 'isha', ar: 'العشاء' }
  ];

  /* The midday prayer keeps its slot all week, but on Friday it is the
     jumuah, so the screen should call it by the name people are waiting for. */
  function isFriday(date) { return (date || new Date()).getDay() === 5; }

  function prayerName(key, date) {
    if (key === 'dhuhr' && isFriday(date)) return 'الجمعة';
    for (var i = 0; i < PRAYERS.length; i++) if (PRAYERS[i].key === key) return PRAYERS[i].ar;
    return key;
  }

  /* Which slice of the day we are in decides the accent colour. */
  var WINDOWS = ['fajr', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'];

  var TABS = ['home', 'quran', 'azkar', 'tracker', 'more'];

  var OWNED_BY = {
    reader: 'quran', search: 'quran', bookmarks: 'quran', khatma: 'quran',
    'azkar-list': 'azkar'
  };

  var state = {
    times: null,
    place: null,
    view: 'home',
    surah: 1,
    browse: 'surah',
    filter: '',
    azkarKey: null,
    query: '',
    tasbih: { index: 0, count: 0 },
    audio: null,
    playing: null,
    sleepTimer: null,
    sleepEndsAt: 0,
    notified: {},
    heading: null,
    repeat: null,
    wakeLock: null,
    installOffer: null,
    updateOffered: false,
    qibla: null,
    dailyAyah: null
  };

  /* Which groups the reader has left open. Everything starts open, and a group
     they shut stays shut while they work. */
  var openGroups = {};

  /* ---------------- helpers ---------------- */

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function ar(value) {
    return String(value).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d]; });
  }

  function esc(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(name, cls) {
    /* The sprite is drawn in a twenty four unit square. Without saying so, the
       browser shows only the top left corner of it at whatever size the icon
       is given, which crops every glyph in the app. */
    return '<svg class="icon' + (cls ? ' ' + cls : '') +
      '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Arabic counts one, two, a few and many differently, so ٣ يوماً reads as a
     mistake where ٣ أيام is right. */
  function days(n) {
    if (n === 1) return 'يوم واحد';
    if (n === 2) return 'يومان';
    if (n >= 3 && n <= 10) return ar(n) + ' أيام';
    return ar(n) + ' يوماً';
  }


  /* The lam of ownership swallows the alef of the article, so الكويت becomes
     للكويت rather than لـالكويت. */
  function withLam(name) {
    var text = String(name || '');
    return 'ل' + (text.indexOf('ال') === 0 ? text.slice(1) : text);
  }

  /* Every other number in the app is written in arabic numerals, so a clock in
     latin ones beside ٢٢ ربيع الأول reads as a leftover from another screen. */
  function clockText(minutes) { return ar(PrayerEngine.format(minutes)); }

  function buzz(ms) {
    if (!Store.get('vibrate')) return;
    if (window.navigator && window.navigator.vibrate) window.navigator.vibrate(ms || 10);
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-open');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.classList.remove('is-open'); }, 2600);
  }

  function openSheet(title, html) {
    var sheet = $('sheet');
    if (!sheet) return;
    $('sheet-title').textContent = title;
    $('sheet-body').innerHTML = html;
    sheet.classList.add('is-open');
  }

  function closeSheet() {
    var sheet = $('sheet');
    if (sheet) sheet.classList.remove('is-open');
  }

  function empty(message, actionLabel, actionNav) {
    var button = actionLabel
      ? '<button class="btn btn-primary" data-go="' + esc(actionNav) + '" style="margin-top:12px">' + esc(actionLabel) + '</button>'
      : '';
    return '<div class="empty">' + esc(message) + button + '</div>';
  }

  function skeleton(rows) {
    var out = '';
    for (var i = 0; i < (rows || 3); i++) {
      out += '<div class="skeleton" style="width:' + (100 - i * 12) + '%"></div>';
    }
    return out;
  }

  function surahMeta(n) {
    for (var i = 0; i < SURAHS.length; i++) if (SURAHS[i].n === n) return SURAHS[i];
    return null;
  }

  function copyText(text) {
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      return window.navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('no clipboard'));
  }

  function shareText(title, text) {
    if (window.navigator && window.navigator.share) {
      return window.navigator.share({ title: title, text: text }).catch(function () { return null; });
    }
    return copyText(text).then(function () { toast('نُسخ النص'); }, function () { toast('تعذّرت المشاركة'); });
  }

  /* ---------------- appearance ---------------- */

  function applyTheme() {
    var choice = Store.get('theme');
    var dark = choice === 'dark';
    if (choice === 'auto' && window.matchMedia) {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  function applyFont() {
    var scale = Store.get('fontScale') / 100;
    document.documentElement.style.setProperty('--quran-scale', String(scale));
    if ($('font-value')) $('font-value').textContent = ar(Store.get('fontScale')) + '٪';
  }

  var ACCENT_TOKEN = {
    fajr: '--w-fajr', duha: '--w-duha', dhuhr: '--w-dhuhr',
    asr: '--w-asr', maghrib: '--w-maghrib', isha: '--w-isha'
  };

  /* Falls back to literal values because a headless DOM returns nothing
     for a custom property that was never resolved by a real engine. */
  var ACCENT_FALLBACK = {
    fajr: '#4c5da8', duha: '#c98b2c', dhuhr: '#2f7fc0',
    asr: '#b5643a', maghrib: '#a84a6b', isha: '#5b4a99'
  };

  /* The colour that fills a shape is often too pale to read as a word, so each
     window carries a second one for text that clears four and a half to one. */
  var ACCENT_INK_FALLBACK = {
    fajr: '#4c5da8', duha: '#885e1e', dhuhr: '#26689c',
    asr: '#945230', maghrib: '#9c4564', isha: '#5b4a99'
  };

  function token(name, fallback) {
    var value = '';
    if (name && window.getComputedStyle) {
      try { value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
      catch (e) { value = ''; }
    }
    return value || fallback;
  }

  function applyAccent(windowKey) {
    var root = document.documentElement;
    var name = ACCENT_TOKEN[windowKey];
    var fill = token(name, ACCENT_FALLBACK[windowKey] || '#1e6f47');
    var ink = token(name ? name + '-ink' : null, ACCENT_INK_FALLBACK[windowKey] || fill);
    root.style.setProperty('--accent', fill);
    root.style.setProperty('--accent-ink', ink);
    root.style.setProperty('--accent-wash', hexToWash(fill));
    root.setAttribute('data-window', windowKey);
  }

  function hexToWash(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    if (!m) return 'rgba(30,111,71,.1)';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',.12)';
  }

  /* ---------------- routing ---------------- */

  function tabOwner(name) {
    if (TABS.indexOf(name) !== -1) return name;
    return OWNED_BY[name] || 'more';
  }

  /* Every view has an address. That makes the phone back button walk back
     through the app instead of leaving it, and it lets the shortcuts on the
     home screen open a view directly. */
  function addressOf(name) {
    if (name === 'reader') return '#reader/' + state.surah;
    if (name === 'azkar-list') return '#azkar/' + (state.azkarKey || 'morning');
    return '#' + name;
  }

  function readAddress(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (!raw) return null;
    var parts = raw.split('/');
    var name = parts[0];
    if (name === 'reader') {
      return { name: 'reader', surah: Math.max(1, Math.min(114, parseInt(parts[1], 10) || 1)) };
    }
    if (name === 'azkar' && parts[1]) return { name: 'azkar-list', azkar: parts[1] };
    return $('v-' + name) ? { name: name } : null;
  }

  function go(name, silent) {
    var target = $('v-' + name);
    if (!target) return;
    $$('.view').forEach(function (v) { v.classList.remove('is-open'); });
    target.classList.add('is-open');
    state.view = name;

    var owner = tabOwner(name);
    $$('.tab').forEach(function (t) {
      if (t.getAttribute('data-go') === owner) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });

    closeSheet();
    if (name !== 'reader' && state.repeat) stopRepeat();
    if (window.scrollTo) window.scrollTo(0, 0);
    if (RENDERERS[name]) RENDERERS[name]();
    updateReadProgress();

    if (!silent) pushAddress(name);
  }

  function pushAddress(name) {
    if (!window.history || !window.history.pushState) return;
    var next = addressOf(name);
    if (window.location.hash === next) return;
    try { window.history.pushState({ view: name }, '', next); } catch (e) { /* file:// refuses */ }
  }

  function followAddress() {
    var route = readAddress(window.location.hash);
    if (!route) { go('home', true); return; }
    if (route.surah) state.surah = route.surah;
    if (route.azkar && AZKAR_DB[route.azkar]) state.azkarKey = route.azkar;
    go(route.name, true);
  }

  /* ---------------- place and prayer times ---------------- */

  function place() {
    if (state.place) return state.place;
    var s = Store.settings();
    if (typeof s.lat === 'number' && typeof s.lng === 'number') {
      state.place = {
        n: s.city || 'موقعك', lat: s.lat, lng: s.lng,
        tz: s.tzOffset, z: s.zone, method: s.method
      };
    } else {
      state.place = DEFAULT_PLACE;
    }
    return state.place;
  }

  function calculator() {
    var p = place();
    return new PrayerEngine.Calculator({
      lat: p.lat, lng: p.lng,
      method: Store.get('method'),
      asr: Store.get('asr'),
      highLat: Store.get('highLat')
    });
  }

  /* A stored number is only right for half the year in a country that moves
     its clocks, so the zone is asked for the offset on the day being shown and
     the stored number is only a fallback. */
  function offsetFor(date) {
    var p = place();
    var live = PrayerEngine.zoneOffset(p.z, date);
    if (typeof live === 'number') return live;
    if (typeof p.tz === 'number') return p.tz;
    return undefined;
  }

  function computeTimes(date) {
    var when = date || new Date();
    return calculator().timesFor(when, offsetFor(when));
  }

  function refreshTimes() {
    state.times = computeTimes(new Date());
    return state.times;
  }

  function methodName(key) {
    var m = PrayerEngine.METHODS[key];
    return m ? m.name : key;
  }

  function setPlace(next, remember) {
    state.place = next;
    if (remember) {
      Store.setMany({
        lat: next.lat, lng: next.lng, city: next.n,
        tzOffset: typeof next.tz === 'number' ? next.tz : null,
        zone: next.z || null
      });
      if (next.method) Store.set('method', next.method);
    }
    refreshTimes();
    computeQibla();
    renderHome();
    renderSettings();
    renderQibla();
  }

  function locate() {
    if (!window.navigator || !window.navigator.geolocation) {
      toast('المتصفح لا يتيح تحديد الموقع، فاختر مدينة من القائمة');
      return;
    }
    toast('جارٍ تحديد موقعك');
    window.navigator.geolocation.getCurrentPosition(function (pos) {
      var tz = -new Date().getTimezoneOffset() / 60;
      var zone = null;
      try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { zone = null; }
      setPlace({
        n: 'موقعك الحالي', lat: pos.coords.latitude, lng: pos.coords.longitude,
        tz: tz, z: zone
      }, true);
      toast('ضُبطت المواقيت على موقعك');
    }, function () {
      toast('تعذّر تحديد الموقع، فاختر مدينة من القائمة');
    }, { enableHighAccuracy: true, timeout: 9000 });
  }

  /* Minutes since midnight as a float, so the arc moves smoothly. */
  function nowMinutes(date) {
    var d = date || new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }

  /* Which prayer comes next, and how much of the current window has passed. */
  function clockState(date) {
    var t = state.times || refreshTimes();
    var now = nowMinutes(date);
    var marks = PRAYERS.map(function (p) {
      return { key: p.key, ar: prayerName(p.key, date), at: t[p.key] };
    });

    var nextIndex = -1;
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].at > now) { nextIndex = i; break; }
    }

    var next, prev, remaining, span;
    if (nextIndex === -1) {
      var tomorrow = computeTimes(new Date((date || new Date()).getTime() + 86400000));
      next = { key: 'fajr', ar: prayerName('fajr'), at: tomorrow.fajr };
      prev = marks[marks.length - 1];
      remaining = (1440 - now) + tomorrow.fajr;
      span = (1440 - prev.at) + tomorrow.fajr;
    } else {
      next = marks[nextIndex];
      prev = nextIndex === 0
        ? { key: 'isha', ar: prayerName('isha'), at: t.isha - 1440 }
        : marks[nextIndex - 1];
      remaining = next.at - now;
      span = next.at - prev.at;
    }

    var elapsed = span - remaining;
    var progress = span > 0 ? Math.max(0, Math.min(1, elapsed / span)) : 0;
    var windowKey = prev.key === 'sunrise' ? 'duha' : prev.key;
    if (WINDOWS.indexOf(windowKey) === -1) windowKey = 'isha';

    return {
      marks: marks, next: next, prev: prev,
      remaining: remaining, progress: progress, windowKey: windowKey, now: now
    };
  }

  /* ---------------- the clock ---------------- */

  function tick() {
    if (!$('arc-count')) return;
    var c = clockState();
    applyAccent(c.windowKey);

    var total = Math.max(0, Math.round(c.remaining * 60));
    var hrs = Math.floor(total / 3600);
    var mins = Math.floor((total % 3600) / 60);
    var secs = total % 60;

    $('arc-count').textContent = ar(pad(hrs) + ':' + pad(mins) + ':' + pad(secs));
    $('arc-name').textContent = c.next.ar;
    $('arc-at').textContent = clockText(c.next.at);
    if ($('arc-label')) $('arc-label').textContent = 'يبقى على';

    /* Two dashes rather than one offset, so the drawn run is plainly the first
       part of the path and no reasoning about which way an offset shifts is
       needed. The path itself starts on the right, so the arc empties the way
       the page is read. */
    var drawn = ARC_LENGTH * c.progress;
    var fill = $('arc-fill');
    if (fill) {
      fill.setAttribute('stroke-dasharray', drawn.toFixed(2) + ' ' + (ARC_LENGTH - drawn).toFixed(2));
      fill.setAttribute('stroke-dashoffset', '0');
    }

    var dot = $('arc-dot');
    if (dot) {
      /* The same parameter as the fill, so the dot always sits on its edge. */
      var angle = Math.PI * c.progress;
      dot.setAttribute('cx', (120 + 100 * Math.cos(angle)).toFixed(2));
      dot.setAttribute('cy', (140 - 100 * Math.sin(angle)).toFixed(2));
    }

    renderWindows(c);
    maybeNotify(c);
  }

  function renderWindows(c) {
    var host = $('windows');
    if (!host) return;
    host.innerHTML = c.marks.map(function (m) {
      var cls = 'window';
      if (m.key === c.prev.key) cls += ' is-now';
      else if (m.at < c.now) cls += ' is-past';
      return '<div class="' + cls + '"><div class="window-name">' + esc(m.ar) + '</div>' +
        '<div class="window-time">' + esc(clockText(m.at)) + '</div></div>';
    }).join('');
  }

  function maybeNotify(c) {
    if (!Store.get('notify')) return;
    if (!window.Notification || window.Notification.permission !== 'granted') return;
    var key = Store.dayKey() + ':' + c.prev.key;
    if (state.notified[key]) return;
    if (c.now - c.prev.at > 2) return;
    state.notified[key] = true;
    try {
      new window.Notification('سُنّتي', { body: 'حان وقت ' + c.prev.ar, tag: key });
    } catch (e) { /* the browser may refuse outside a worker */ }
  }

  /* ---------------- home ---------------- */

  function renderDate() {
    var adjust = Store.get('hijriAdjust');
    var now = new Date();
    var h = Hijri.toHijri(now, adjust);
    if ($('hijri-date')) $('hijri-date').textContent = Hijri.format(h);
    if ($('greg-date')) {
      $('greg-date').textContent = h.weekday + '، ' +
        ar(now.getDate()) + '/' + ar(now.getMonth() + 1) + '/' + ar(now.getFullYear());
    }
  }

  function nudgeHijri(delta) {
    var next = Math.max(-2, Math.min(2, Store.get('hijriAdjust') + delta));
    Store.set('hijriAdjust', next);
    renderDate();
    renderCalendar();
    renderHome();
    toast(next === 0 ? 'التاريخ على الحساب الأصلي' : 'التاريخ معدّل ' + ar(Math.abs(next)) + (next > 0 ? ' يوماً للأمام' : ' يوماً للخلف'));
  }

  function currentWindowKey() { return clockState().windowKey; }

  /* On Friday the stretch from mid morning to the khutbah belongs to the
     jumuah, so the card offers the sunan of the day rather than those of the
     duha and the dhuhr it replaces. */
  function windowSunnah(key, date) {
    if (isFriday(date) && (key === 'duha' || key === 'dhuhr') &&
      typeof FRIDAY_SUNNAH !== 'undefined') {
      return { key: 'friday', block: FRIDAY_SUNNAH };
    }
    if (typeof CURRENT_SUNNAH === 'undefined') return null;
    return { key: key, block: CURRENT_SUNNAH[key] || CURRENT_SUNNAH.dhuhr };
  }

  function renderNowSunnah() {
    var host = $('now-list');
    if (!host) return;
    var pick = windowSunnah(currentWindowKey());
    if (!pick || !pick.block) { host.innerHTML = ''; return; }
    var key = pick.key;
    var block = pick.block;
    if ($('now-title')) $('now-title').textContent = block.l;
    var record = Store.day();
    var ids = block.items.map(function (_, i) { return 'now:' + key + ':' + i; });
    var done = ids.filter(function (id) { return !!record.sunnah[id]; }).length;

    if ($('now-tally')) {
      $('now-tally').textContent = ar(done) + ' من ' + ar(ids.length);
      if (done === ids.length) $('now-tally').classList.add('is-full');
      else $('now-tally').classList.remove('is-full');
    }

    var fold = $('now-fold');
    if (fold) {
      var open = openGroups.now !== false;
      fold.classList.toggle('is-open', open);
      var head = fold.querySelector('.fold-head');
      if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    host.innerHTML = '<p class="setting-note" style="margin-bottom:12px">' + esc(block.sub) + '</p>' +
      block.items.map(function (item, i) {
        var id = ids[i];
        return '<button class="check' + (record.sunnah[id] ? ' is-done' : '') +
          '" data-check="' + esc(id) + '">' +
          '<span class="check-box">' + icon('check') + '</span>' +
          '<span class="check-label">' + esc(item) + '</span></button>';
      }).join('');
  }

  /* Everything a person can tick today, so the meter can never read more done
     than there is to do. The windows the jumuah replaces drop out on Friday. */
  function totalSunnahCount(date) {
    var total = 0;
    if (typeof WIRD_ITEMS !== 'undefined') total += WIRD_ITEMS.length;
    if (typeof SUNNAH_TRACKER !== 'undefined') {
      SUNNAH_TRACKER.forEach(function (group) { total += group.i.length; });
    }
    if (typeof CURRENT_SUNNAH !== 'undefined') {
      var friday = isFriday(date);
      WINDOWS.forEach(function (key) {
        if (friday && (key === 'duha' || key === 'dhuhr')) return;
        if (CURRENT_SUNNAH[key]) total += CURRENT_SUNNAH[key].items.length;
      });
      if (friday && typeof FRIDAY_SUNNAH !== 'undefined') total += FRIDAY_SUNNAH.items.length;
    }
    return total;
  }

  function renderHeat(host, days) {
    if (!host) return;
    var cells = Store.heatmap(days, new Date(), totalSunnahCount());
    var todayKey = Store.dayKey();
    host.innerHTML = cells.map(function (cell) {
      var level = 0;
      if (cell.percent >= 80) level = 4;
      else if (cell.percent >= 55) level = 3;
      else if (cell.percent >= 30) level = 2;
      else if (cell.active) level = 1;
      return '<i data-level="' + level + '"' + (cell.key === todayKey ? ' data-today="1"' : '') +
        ' title="' + esc(cell.key) + '"></i>';
    }).join('');
  }

  function renderTodayMeter() {
    var total = totalSunnahCount();
    var c = Store.completion(new Date(), total);
    if ($('today-done')) $('today-done').textContent = ar(c.done);
    if ($('today-total')) $('today-total').textContent = ar(total);
    if ($('today-meter')) $('today-meter').style.width = c.percent + '%';
    if ($('streak-line')) {
      var s = Store.streak(new Date());
      $('streak-line').textContent = s.current > 0
        ? days(s.current) + ' متتابعة'
        : 'لم تبدأ اليوم بعد';
    }
    renderHeat($('home-heat'), 30);
  }

  var TILES = [
    { nav: 'tasbih', icon: 'beads', name: 'المسبحة', note: 'عدّاد بأهداف' },
    { nav: 'qibla', icon: 'compass', name: 'القبلة', note: 'بوصلة' },
    { nav: 'khatma', icon: 'target', name: 'الختمة', note: 'خطة قراءة' },
    { nav: 'hadith', icon: 'text', name: 'الأربعون', note: 'النووية' },
    { nav: 'ruqyah', icon: 'shield', name: 'الرقية', note: 'آيات وأدعية' },
    { nav: 'dua', icon: 'hands', name: 'الأدعية', note: 'مأثورة' }
  ];

  function renderTiles() {
    var host = $('home-tiles');
    if (!host) return;
    host.innerHTML = TILES.map(function (t) {
      return '<button class="tile" data-go="' + esc(t.nav) + '">' + icon(t.icon) +
        '<span class="tile-name">' + esc(t.name) + '</span>' +
        '<span class="tile-note">' + esc(t.note) + '</span></button>';
    }).join('');
  }

  function renderDailyAyah() {
    var host = $('daily-ayah');
    if (!host) return;
    if (!Mushaf.ready()) { host.innerHTML = skeleton(2); return; }
    var seed = Math.floor(Date.now() / 86400000) % 6236;
    var pos = Mushaf.fromGlobalIndex(seed + 1) || { s: 1, a: 1 };
    state.dailyAyah = pos;
    host.textContent = Mushaf.ayah(pos.s, pos.a);
    var meta = surahMeta(pos.s);
    if ($('daily-ayah-ref')) {
      $('daily-ayah-ref').textContent = 'سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(pos.a);
    }
  }

  function renderUpcoming() {
    var host = $('home-upcoming');
    if (!host) return;
    var list = Hijri.upcoming(new Date(), Store.get('hijriAdjust')).slice(0, 3);
    if (!list.length) { host.innerHTML = empty('لا مناسبة قريبة'); return; }
    host.innerHTML = list.map(function (o) {
      return '<div class="row" style="cursor:default"><span class="row-mark">' + esc(o.icon) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(o.name) + '</span>' +
        '<span class="row-note">' + (o.days === 0 ? 'اليوم' : 'بعد ' + days(o.days)) + '</span></span></div>';
    }).join('');
  }

  function renderHome() {
    if (!$('v-home')) return;
    refreshTimes();
    renderDate();
    tick();
    renderNowSunnah();
    renderTodayMeter();
    renderTiles();
    renderDailyAyah();
    renderUpcoming();
    var p = place();
    if ($('place-line')) {
      /* Two facts, the place and the reckoning, kept apart so neither leans on
         the other. Saying محسوبة للكويت بطريقة الكويت reads as a stutter and
         tells a person nothing about which body issues the times. */
      $('place-line').innerHTML =
        '<span class="place-where">' + icon('pin') + esc(p.n) + '</span>' +
        '<span class="place-how">تقويم ' + esc(methodName(Store.get('method'))) + '</span>';
    }
  }

  /* ---------------- the mushaf list ---------------- */

  function surahRow(meta) {
    var done = Store.progress().completed.indexOf(meta.n) !== -1;
    /* The transliterated name is kept for searching but never shown, because a
       reader who opens an arabic mushaf should not meet a latin word in it.
       The page it opens at is more use to them anyway. */
    var note = Mushaf.ready()
      ? 'تبدأ صفحة ' + ar(Mushaf.pageOf(meta.n, 1))
      : ar(meta.ay) + ' آية';
    return '<button class="row" data-surah="' + meta.n + '">' +
      '<span class="row-mark">' + ar(meta.n) + '</span>' +
      '<span class="row-body"><span class="row-title">' + esc(meta.ar) +
      (done ? ' ' + icon('check') : '') + '</span>' +
      '<span class="row-note">' + esc(note) + '</span></span>' +
      '<span class="row-meta">' + esc(meta.tp) + '، ' + ar(meta.ay) + ' آية</span></button>';
  }

  function juzRow(n) {
    var start = Mushaf.juzStart(n);
    if (!start) return '';
    var meta = surahMeta(start.s);
    return '<button class="row" data-surah="' + start.s + '" data-ayah="' + start.a + '">' +
      '<span class="row-mark">' + ar(n) + '</span>' +
      '<span class="row-body"><span class="row-title">الجزء ' + ar(n) + '</span>' +
      '<span class="row-note">يبدأ من ' + esc(meta ? meta.ar : '') + ' آية ' + ar(start.a) + '</span></span>' +
      '<span class="row-meta">' + icon('layers') + '</span></button>';
  }

  function matchesFilter(meta, needle) {
    if (!needle) return true;
    var plain = Mushaf.normalize(needle);
    if (Mushaf.normalize(meta.ar).indexOf(plain) !== -1) return true;
    if (meta.en.toLowerCase().indexOf(needle.toLowerCase()) !== -1) return true;
    if (String(meta.n) === needle.replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })) return true;
    return String(meta.n).indexOf(needle) === 0;
  }

  function renderSurahList() {
    var host = $('surah-list');
    if (!host) return;

    $$('#browse-mode .chip').forEach(function (chip) {
      if (chip.getAttribute('data-browse') === state.browse) chip.classList.add('is-on');
      else chip.classList.remove('is-on');
    });

    if (state.browse === 'juz') {
      if (!Mushaf.ready()) { host.innerHTML = skeleton(4); return; }
      var rows = '';
      for (var j = 1; j <= 30; j++) rows += juzRow(j);
      host.innerHTML = rows;
      return;
    }

    var needle = state.filter.trim();
    var list = SURAHS.filter(function (m) { return matchesFilter(m, needle); });
    if (!list.length) { host.innerHTML = empty('لا سورة بهذا الاسم'); return; }
    host.innerHTML = list.map(surahRow).join('');
  }

  function renderResume() {
    var card = $('resume-card');
    if (!card) return;
    var last = Store.get('lastRead');
    if (!last || !last.s) { card.hidden = true; return; }
    var meta = surahMeta(last.s);
    if (!meta) { card.hidden = true; return; }
    card.hidden = false;
    if ($('resume-num')) $('resume-num').textContent = ar(meta.n);
    if ($('resume-name')) $('resume-name').textContent = 'سورة ' + meta.ar;
    if ($('resume-note')) $('resume-note').textContent = 'توقفت عند آية ' + ar(last.a || 1);
  }

  function renderQuran() {
    renderResume();
    renderSurahList();
  }

  /* ---------------- the reader ---------------- */

  function rememberPlace(s, a) {
    state.surah = s;
    state.ayah = a || 1;
    Store.set('lastRead', { s: s, a: state.ayah });
  }

  /* Opens the mushaf at a page rather than a surah, which is how a khatma is
     actually read and how the plan describes it. */
  function openAtPage(page) {
    if (!Mushaf.ready()) { toast('نص المصحف لم يكتمل تحميله بعد'); return; }
    var start = Mushaf.pageStart(Math.max(1, Math.min(TOTAL_PAGES, page)));
    if (!start) return;
    openReader(start.s, start.a);
  }

  function openReader(n, ayah) {
    rememberPlace(Math.max(1, Math.min(114, n)), ayah);
    go('reader');
    if (ayah) scrollToAyah(ayah);
  }

  /* Coming back to a view that carries a name, such as a surah or a section of
     azkar, needs the name in hand before the address is written. */
  function openAzkar(key) {
    if (!AZKAR_DB[key]) return;
    state.azkarKey = key;
    go('azkar-list');
  }

  function updateReadProgress() {
    var fill = $('read-progress-fill');
    if (!fill || state.view !== 'reader') return;
    var doc = document.documentElement;
    var span = doc.scrollHeight - doc.clientHeight;
    var seen = span > 0 ? Math.min(1, Math.max(0, (window.pageYOffset || doc.scrollTop || 0) / span)) : 0;
    fill.style.width = (seen * 100).toFixed(1) + '%';
  }

  function scrollToAyah(a) {
    var el = document.querySelector('.ayah[data-a="' + a + '"]');
    if (!el) return;
    $$('.ayah').forEach(function (x) { x.classList.remove('is-active'); });
    el.classList.add('is-active');
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }

  function renderReader() {
    var body = $('reader-body');
    if (!body) return;
    var n = state.surah;
    var meta = surahMeta(n);
    if ($('reader-title')) $('reader-title').textContent = meta ? 'سورة ' + meta.ar : '';
    if ($('reader-meta')) {
      var virtue = typeof SURAH_VIRTUES !== 'undefined' ? SURAH_VIRTUES[n] : null;
      var where = Mushaf.ready()
        ? '، الجزء ' + ar(Mushaf.juzOf(n, state.ayah || 1)) +
          '، صفحة ' + ar(Mushaf.pageOf(n, state.ayah || 1))
        : '';
      $('reader-meta').textContent = meta
        ? meta.tp + '، ' + ar(meta.ay) + ' آية' + where + (virtue ? '، ' + virtue : '')
        : '';
    }

    if (!Mushaf.ready()) { body.innerHTML = skeleton(5); return; }

    var verses = Mushaf.surah(n);
    var marked = {};
    Store.bookmarks().forEach(function (b) { if (b.s === n) marked[b.a] = true; });

    var html = '';
    if (n !== 1 && n !== 9) html += '<p class="basmala">' + esc(Mushaf.basmala()) + '</p>';

    html += verses.map(function (text, i) {
      var a = i + 1;
      var cls = 'ayah' + (marked[a] ? ' is-marked' : '');
      var sajda = Mushaf.isSajda(n, a) ? '<span class="sajda-mark" title="موضع سجدة">۩</span>' : '';
      return '<span class="' + cls + '" data-ayah="' + n + ':' + a + '" data-a="' + a + '">' +
        esc(text) + sajda + '<span class="ayah-num">' + ar(a) + '</span></span> ';
    }).join('');

    body.className = 'reader-body';
    body.innerHTML = '<div class="ayah-block">' + html + '</div>';
    var last = Store.get('lastRead');
    rememberPlace(n, last && last.s === n ? last.a : 1);
  }

  /* ---------------- memorising ---------------- */

  /* Repeats a run of verses aloud a chosen number of times, marking the one
     being recited, with the option to dim the text so the tongue leads and the
     eye only checks. */
  function startRepeat(from, to, times, hide) {
    if (!Mushaf.ready()) { toast('نص المصحف لم يكتمل تحميله بعد'); return; }
    state.repeat = {
      surah: state.surah, from: from, to: to,
      times: times, round: 1, at: from, hide: !!hide
    };
    closeSheet();
    go('reader');
    if (hide) { var body = $('reader-body'); if (body) body.classList.add('is-hidden'); }
    keepAwake();
    reciteCurrent();
  }

  function stopRepeat() {
    state.repeat = null;
    stopAudio();
    var body = $('reader-body');
    if (body) body.classList.remove('is-hidden');
    $$('.ayah').forEach(function (el) { el.classList.remove('is-reciting'); });
    releaseAwake();
  }

  function markReciting(a) {
    $$('.ayah').forEach(function (el) { el.classList.remove('is-reciting'); });
    var el = document.querySelector('.ayah[data-a="' + a + '"]');
    if (el) {
      el.classList.add('is-reciting');
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
  }

  function reciteCurrent() {
    var r = state.repeat;
    if (!r) return;
    markReciting(r.at);
    var meta = surahMeta(r.surah);
    playAudio(
      'https://cdn.islamic.network/quran/audio/128/' + reciterId() + '/' + Mushaf.globalIndex(r.surah, r.at) + '.mp3',
      'آية ' + ar(r.at) + ' من ' + (meta ? meta.ar : ''),
      'الجولة ' + ar(r.round) + ' من ' + ar(r.times)
    );
    if (state.audio) state.audio.onended = nextInRepeat;
  }

  function nextInRepeat() {
    var r = state.repeat;
    if (!r) return;
    if (r.at < r.to) { r.at++; reciteCurrent(); return; }
    if (r.round < r.times) { r.round++; r.at = r.from; reciteCurrent(); return; }
    toast('أتممت ' + ar(r.times) + ' جولات على ' + ar(r.to - r.from + 1) + ' آيات');
    stopRepeat();
  }

  function repeatSheet(s, a) {
    var meta = surahMeta(s);
    var count = meta ? meta.ay : 1;
    function options(selected, upto, from) {
      var out = '';
      for (var i = from || 1; i <= upto; i++) {
        out += '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + ar(i) + '</option>';
      }
      return out;
    }
    openSheet('كرّر للحفظ', 
      '<p class="setting-note">اختر مدى الآيات وعدد الجولات، ويمكنك إخفاء النص لتسترجعه من حفظك.</p>' +
      '<div class="repeat-row"><label for="rep-from">من آية</label>' +
      '<select id="rep-from">' + options(a, count) + '</select></div>' +
      '<div class="repeat-row"><label for="rep-to">إلى آية</label>' +
      '<select id="rep-to">' + options(Math.min(count, a + 2), count) + '</select></div>' +
      '<div class="repeat-row"><label for="rep-times">عدد الجولات</label>' +
      '<select id="rep-times">' + options(3, 20) + '</select></div>' +
      '<div class="repeat-row"><label for="rep-hide">إخفاء النص</label>' +
      '<input type="checkbox" id="rep-hide"></div>' +
      '<button class="btn btn-primary btn-block" data-act="repeat-start" style="margin-top:12px">' +
      icon('play') + 'ابدأ</button>');
  }

  function verseSheet(s, a) {
    rememberPlace(s, a);
    var text = Mushaf.ayah(s, a);
    var meta = surahMeta(s);
    var saved = Store.isBookmarked(s, a);
    var html = '<p class="ayah-block" style="text-align:center;margin-bottom:6px">' + esc(text) + '</p>' +
      '<p class="source">سورة ' + esc(meta ? meta.ar : '') + '، آية ' + ar(a) +
      '، الجزء ' + ar(Mushaf.juzOf(s, a)) + '، صفحة ' + ar(Mushaf.pageOf(s, a)) + '</p>' +
      '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn ' + (saved ? 'btn-primary' : 'btn-ghost') + '" data-act="bookmark" data-ref="' + s + ':' + a + '">' +
      icon('bookmark') + (saved ? 'محفوظة' : 'احفظ') + '</button>' +
      '<button class="btn btn-ghost" data-act="share" data-ref="' + s + ':' + a + '">' + icon('share') + 'مشاركة</button>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn btn-ghost" data-act="copy" data-ref="' + s + ':' + a + '">' + icon('text') + 'نسخ</button>' +
      '<button class="btn btn-ghost" data-page="' + Mushaf.pageOf(s, a) + '">' + icon('book') + 'أول الصفحة</button>' +
      '</div>' +
      '<button class="btn btn-ghost btn-block" data-act="memorise" data-ref="' + s + ':' + a +
      '" style="margin-top:8px">' + icon('refresh') + 'كرّر للحفظ</button>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn btn-ghost" data-act="listen" data-ref="' + s + ':' + a + '">' + icon('play') + 'استماع</button>' +
      '<button class="btn btn-ghost" data-act="tafsir" data-ref="' + s + ':' + a + '">' + icon('info') + 'تفسير</button>' +
      '</div>' +
      '<div id="tafsir-slot" style="margin-top:12px"></div>';
    openSheet('آية ' + ar(a), html);
  }

  function loadTafsir(s, a) {
    var slot = $('tafsir-slot');
    if (!slot) return;
    slot.innerHTML = skeleton(2);
    var index = Mushaf.globalIndex(s, a);
    var edition = Store.get('tafsir');
    window.fetch('https://api.alquran.cloud/v1/ayah/' + index + '/' + edition)
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        var body = payload && payload.data && payload.data.text;
        slot.innerHTML = body
          ? '<p class="naskh" style="font-size:.95rem;line-height:2">' + esc(body) + '</p>'
          : '<p class="setting-note">لم يصل التفسير</p>';
      })
      .catch(function () {
        slot.innerHTML = '<p class="setting-note">التفسير يحتاج اتصالاً بالإنترنت</p>';
      });
  }

  function reciterId() {
    var list = typeof RECITERS !== 'undefined' ? RECITERS : [];
    var idx = Store.get('reciter');
    var pick = list[idx] || list[0];
    return pick ? pick.id : 'ar.alafasy';
  }

  function reciterName() {
    var list = typeof RECITERS !== 'undefined' ? RECITERS : [];
    var pick = list[Store.get('reciter')] || list[0];
    return pick ? pick.name : '';
  }

  function playAudio(url, title, sub) {
    stopAudio();
    var audio = new window.Audio();
    audio.src = url;
    state.audio = audio;
    state.playing = { title: title, sub: sub };
    var player = $('player');
    if (player) player.classList.add('is-open');
    if ($('player-title')) $('player-title').textContent = title;
    if ($('player-sub')) $('player-sub').textContent = sub || '';
    var play = audio.play();
    if (play && play.catch) play.catch(function () { toast('تعذّر التشغيل، فتأكد من الاتصال'); });
  }

  function keepAwake() {
    if (state.wakeLock || !window.navigator || !window.navigator.wakeLock) return;
    try {
      Promise.resolve(window.navigator.wakeLock.request('screen')).then(function (lock) {
        state.wakeLock = lock;
      }).catch(function () { /* the browser may refuse, which is fine */ });
    } catch (e) { /* older browsers have no lock at all */ }
  }

  function releaseAwake() {
    if (!state.wakeLock) return;
    try { state.wakeLock.release(); } catch (e) { /* already gone */ }
    state.wakeLock = null;
  }

  function stopAudio() {
    if (state.audio) {
      state.audio.onended = null;
      try { state.audio.pause(); } catch (e) { /* already stopped */ }
    }
    state.audio = null;
    state.playing = null;
    var player = $('player');
    if (player) player.classList.remove('is-open');
  }

  function playVerse(s, a) {
    var index = Mushaf.globalIndex(s, a);
    var meta = surahMeta(s);
    playAudio(
      'https://cdn.islamic.network/quran/audio/128/' + reciterId() + '/' + index + '.mp3',
      'سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(a),
      reciterName()
    );
  }

  function playSurah(n) {
    var meta = surahMeta(n);
    playAudio(
      'https://cdn.islamic.network/quran/audio-surah/128/' + reciterId() + '/' + n + '.mp3',
      'سورة ' + (meta ? meta.ar : ''),
      reciterName()
    );
  }

  /* ---------------- search ---------------- */

  function highlight(text, needle) {
    if (!needle) return esc(text);
    var span = Mushaf.spanFor(text, needle);
    if (!span) return esc(text);
    return esc(text.slice(0, span.start)) + '<mark>' + esc(text.slice(span.start, span.end)) +
      '</mark>' + esc(text.slice(span.end));
  }

  function renderSearch() {
    var host = $('search-results');
    if (!host) return;
    var field = $('quran-search');
    if (field && field.value !== state.query) field.value = state.query;

    if (!Mushaf.ready()) { host.innerHTML = skeleton(3); return; }
    var needle = state.query.trim();
    if (needle.length < 2) {
      if ($('search-count')) $('search-count').textContent = 'اكتب حرفين على الأقل';
      host.innerHTML = '';
      return;
    }

    var hits = Mushaf.search(needle, { limit: 60 });
    var total = Mushaf.countMatches(needle);
    if ($('search-count')) {
      $('search-count').textContent = total
        ? 'وردت في ' + ar(total) + ' آية، وهذه أول ' + ar(hits.length)
        : 'لا نتيجة';
    }
    if (!hits.length) { host.innerHTML = empty('لم نجد هذه الكلمة في المصحف'); return; }

    host.innerHTML = hits.map(function (hit) {
      var meta = surahMeta(hit.s);
      return '<button class="search-hit" data-hit="' + hit.s + ':' + hit.a + '">' +
        '<span class="search-hit-ref">' + esc(meta ? meta.ar : '') + '، آية ' + ar(hit.a) + '</span>' +
        highlight(hit.text, needle) + '</button>';
    }).join('');
  }

  /* ---------------- bookmarks ---------------- */

  function renderBookmarks() {
    var host = $('bookmark-list');
    if (!host) return;
    var list = Store.bookmarks();
    if (!list.length) {
      host.innerHTML = empty('لم تحفظ آية بعد، فافتح سورة واضغط على أي آية لحفظها', 'افتح المصحف', 'quran');
      return;
    }
    host.innerHTML = list.map(function (b) {
      var meta = surahMeta(b.s);
      var text = Mushaf.ready() ? Mushaf.ayah(b.s, b.a) : '';
      return '<button class="search-hit" data-hit="' + b.s + ':' + b.a + '">' +
        '<span class="search-hit-ref">' + esc(meta ? meta.ar : '') + '، آية ' + ar(b.a) + '</span>' +
        esc(text) + '</button>';
    }).join('') +
      '<button class="btn btn-ghost btn-block" data-act="clear-bookmarks" style="margin-top:14px">' +
      'امسح كل المحفوظات</button>';
  }

  /* ---------------- khatma ---------------- */

  var KHATMA_CHOICES = [7, 10, 15, 30, 60, 90];

  function khatmaElapsedDays() {
    var start = Store.get('khatmaStart');
    if (!start) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 86400000));
  }

  function renderKhatma() {
    var chips = $('khatma-days');
    if (!chips) return;
    var days = Store.get('khatmaDays');

    chips.innerHTML = KHATMA_CHOICES.map(function (d) {
      return '<button class="chip' + (d === days ? ' is-on' : '') + '" data-khatma="' + d + '">' +
        ar(d) + ' يوماً</button>';
    }).join('');

    var plan = Mushaf.khatmaPlan(days, 1);
    var perDay = Math.ceil(TOTAL_PAGES / days);
    if ($('khatma-rate')) {
      $('khatma-rate').textContent = 'نحو ' + ar(perDay) + ' صفحة كل يوم، أي قرابة ' +
        ar(Math.max(1, Math.round(perDay * 1.6))) + ' دقيقة من التلاوة';
    }

    var status = Mushaf.khatmaStatus(plan, khatmaElapsedDays(), Store.progress().pagesRead);
    var host = $('khatma-state');
    if (!host) return;

    var aheadLine;
    if (status.finished) aheadLine = 'أتممت الختمة، فتقبل الله منك';
    else if (status.ahead > 0) aheadLine = 'أنت متقدم بـ' + ar(status.ahead) + ' صفحة';
    else if (status.ahead < 0) aheadLine = 'عليك ' + ar(Math.abs(status.ahead)) + ' صفحة لتلحق بخطتك';
    else aheadLine = 'أنت في الموعد تماماً';

    var today = status.today || { from: null, to: null, pages: 0 };
    host.innerHTML =
      '<div class="meter-head"><span><b>' + ar(status.read) + '</b> من ' + ar(TOTAL_PAGES) + ' صفحة</span>' +
      '<span class="badge">' + ar(status.percent) + '٪</span></div>' +
      '<div class="meter"><span style="width:' + status.percent + '%"></span></div>' +
      '<p class="setting-note" style="margin-top:12px">' + esc(aheadLine) + '</p>' +
      (today.from
        ? '<p class="setting-note">ورد اليوم من صفحة ' + ar(today.from) + ' إلى ' + ar(today.to) + '</p>'
        : '') +
      (status.read < TOTAL_PAGES && Mushaf.ready()
        ? '<p class="setting-note">الصفحة القادمة تبدأ عند ' + esc(pageLabel(status.read + 1)) + '</p>' +
          '<button class="btn btn-primary btn-block" style="margin-top:14px" data-page="' +
          (status.read + 1) + '">' + icon('book') + 'تابع من صفحة ' + ar(status.read + 1) + '</button>'
        : '');
  }

  function pageLabel(page) {
    var start = Mushaf.pageStart(Math.max(1, Math.min(TOTAL_PAGES, page)));
    if (!start) return '';
    var meta = surahMeta(start.s);
    return (meta ? meta.ar : '') + ' آية ' + ar(start.a);
  }

  function stepKhatma(delta) {
    if (!Store.get('khatmaStart')) Store.set('khatmaStart', Date.now());
    var next = Store.addReadPages(delta);
    buzz(8);
    renderKhatma();
    renderTodayMeter();
    if (next >= TOTAL_PAGES) toast('أتممت الختمة، فتقبل الله منك');
  }

  /* ---------------- azkar ---------------- */

  function azkarSections() {
    return Object.keys(AZKAR_DB).map(function (key) {
      return { key: key, def: AZKAR_DB[key] };
    });
  }

  function renderAzkar() {
    var host = $('azkar-groups');
    if (!host) return;
    host.innerHTML = azkarSections().map(function (row) {
      var p = Store.azkarProgress(row.key, row.def.items.length);
      return '<button class="tile" data-azkar="' + esc(row.key) + '">' +
        '<span style="font-size:1.5rem">' + esc(row.def.icon) + '</span>' +
        '<span class="tile-name">' + esc(row.def.title) + '</span>' +
        '<span class="tile-note">' + ar(p.done) + ' من ' + ar(row.def.items.length) + '</span></button>';
    }).join('');
  }

  function renderAzkarList() {
    var host = $('azkar-items');
    if (!host) return;
    var key = state.azkarKey || 'morning';
    var def = AZKAR_DB[key];
    if (!def) return;
    if ($('azkar-list-title')) $('azkar-list-title').textContent = def.title;

    var record = Store.day();
    var counts = record.azkar[key] || {};

    host.innerHTML = def.items.map(function (item, i) {
      var target = item.c || 1;
      var left = Object.prototype.hasOwnProperty.call(counts, i) ? counts[i] : target;
      var done = left === 0;
      return '<div class="dhikr' + (done ? ' is-done' : '') + '" data-dhikr="' + i + '">' +
        '<p class="dhikr-text">' + esc(item.t) + '</p>' +
        '<div class="dhikr-foot"><span class="source">' + esc(item.r || '') + '</span>' +
        '<span class="dhikr-count">' + (done ? icon('check') : ar(left)) + '</span></div></div>';
    }).join('');

    var p = Store.azkarProgress(key, def.items.length);
    if ($('azkar-meter')) $('azkar-meter').style.width = p.percent + '%';
  }

  function countDhikr(index) {
    var key = state.azkarKey || 'morning';
    var def = AZKAR_DB[key];
    if (!def || !def.items[index]) return;
    var target = def.items[index].c || 1;
    var record = Store.day();
    var counts = record.azkar[key] || {};
    var left = Object.prototype.hasOwnProperty.call(counts, index) ? counts[index] : target;
    if (left === 0) return;
    Store.setAzkarCount(key, index, left - 1);
    buzz(left - 1 === 0 ? 24 : 8);
    renderAzkarList();
    renderTodayMeter();
    if (left - 1 === 0) {
      var p = Store.azkarProgress(key, def.items.length);
      if (p.done === def.items.length) toast('أتممت ' + def.title);
    }
  }

  function resetAzkar() {
    var key = state.azkarKey || 'morning';
    var def = AZKAR_DB[key];
    if (!def) return;
    Store.updateDay(function (rec) { delete rec.azkar[key]; });
    renderAzkarList();
    renderTodayMeter();
    toast('أُعيدت عدّادات ' + def.title);
  }

  /* ---------------- the sunnah tracker ---------------- */

  function renderTracker() {
    var host = $('tracker-list');
    if (!host) return;
    var record = Store.day();
    var total = totalSunnahCount();
    var c = Store.completion(new Date(), total);

    if ($('tracker-done')) $('tracker-done').textContent = ar(c.done);
    if ($('tracker-total')) $('tracker-total').textContent = ar(total);
    if ($('tracker-meter')) $('tracker-meter').style.width = c.percent + '%';
    if ($('tracker-streak')) {
      var s = Store.streak(new Date());
      $('tracker-streak').textContent = s.longest > 0
        ? 'أطول تتابع ' + days(s.longest)
        : 'لا تتابع بعد';
    }
    renderHeat($('tracker-heat'), 30);

    /* Forty odd deeds in one column is a wall to scroll past. Each group folds
       shut with its own tally on the head, so a person opens the one they are
       working on and the rest stay out of the way. */
    function fold(key, title, iconName, ids, rows) {
      var done = ids.filter(function (id) { return !!record.sunnah[id]; }).length;
      var open = openGroups[key] !== false;
      return '<section class="fold' + (open ? ' is-open' : '') + '" data-fold="' + esc(key) + '">' +
        '<button class="fold-head" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        (iconName ? icon(iconName) : '') +
        '<span class="fold-title">' + esc(title) + '</span>' +
        '<span class="fold-tally' + (done === ids.length ? ' is-full' : '') + '">' +
        ar(done) + ' من ' + ar(ids.length) + '</span>' +
        icon('chevron', 'fold-arrow') + '</button>' +
        '<div class="fold-body">' + rows + '</div></section>';
    }

    var html = '';

    if (typeof WIRD_ITEMS !== 'undefined') {
      var wirdIds = WIRD_ITEMS.map(function (item) { return 'wird:' + item.id; });
      html += fold('wird', 'الورد اليومي', 'fire', wirdIds,
        WIRD_ITEMS.map(function (item) {
          var id = 'wird:' + item.id;
          var done = !!record.sunnah[id];
          return '<button class="check' + (done ? ' is-done' : '') + '" data-check="' + esc(id) + '">' +
            '<span class="check-box">' + icon('check') + '</span>' +
            '<span class="check-label">' + esc(item.t) +
            '<span class="check-note">' + esc(item.n) + '</span></span></button>';
        }).join(''));
    }

    if (typeof SUNNAH_TRACKER !== 'undefined') {
      html += SUNNAH_TRACKER.map(function (group, gi) {
        var ids = group.i.map(function (_, ii) { return 'sunnah:' + gi + ':' + ii; });
        return fold('sunnah:' + gi, group.s, null, ids,
          group.i.map(function (item, ii) {
            var id = 'sunnah:' + gi + ':' + ii;
            var done = !!record.sunnah[id];
            return '<button class="check' + (done ? ' is-done' : '') + '" data-check="' + esc(id) + '">' +
              '<span class="check-box">' + icon('check') + '</span>' +
              '<span class="check-label">' + esc(item) + '</span></button>';
          }).join(''));
      }).join('');
    }

    host.innerHTML = html;
  }

  function toggleCheck(id) {
    Store.toggleSunnah(id);
    buzz(10);
    if (state.view === 'tracker') renderTracker();
    if (state.view === 'home') { renderNowSunnah(); renderTodayMeter(); }
    else renderTodayMeter();
  }

  /* ---------------- more ---------------- */

  var MORE_LINKS = [
    { nav: 'qibla', icon: 'compass', name: 'القبلة', note: 'اتجاه الكعبة من موقعك' },
    { nav: 'tasbih', icon: 'beads', name: 'المسبحة', note: 'عدّاد بأهداف محفوظة' },
    { nav: 'khatma', icon: 'target', name: 'خطة الختمة', note: 'وزّع المصحف على أيامك' },
    { nav: 'radio', icon: 'radio', name: 'الإذاعة', note: 'بث مباشر ومؤقت إيقاف' },
    { nav: 'hadith', icon: 'text', name: 'من الأربعين النووية', note: 'عشرون حديثاً جامعاً' },
    { nav: 'dua', icon: 'hands', name: 'الأدعية', note: 'من الكتاب والسنة' },
    { nav: 'ruqyah', icon: 'shield', name: 'الرقية الشرعية', note: 'آيات وأدعية ثابتة' },
    { nav: 'calendar', icon: 'calendar', name: 'التقويم الهجري', note: 'المناسبات والمواسم' },
    { nav: 'bookmarks', icon: 'bookmark', name: 'المحفوظات', note: 'آياتك المعلّمة' },
    { nav: 'settings', icon: 'settings', name: 'الإعدادات', note: 'الحساب والمظهر والنسخ' },
    { nav: 'about', icon: 'info', name: 'عن التطبيق', note: 'المصادر وما يحتاج إنترنت' }
  ];

  function renderMore() {
    var host = $('more-list');
    if (!host) return;
    host.innerHTML = MORE_LINKS.map(function (l) {
      return '<button class="row" data-go="' + esc(l.nav) + '">' +
        '<span class="row-mark">' + icon(l.icon) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(l.name) + '</span>' +
        '<span class="row-note">' + esc(l.note) + '</span></span></button>';
    }).join('');
    if ($('version-line')) $('version-line').textContent = 'النسخة ' + ar(VERSION);
  }

  /* ---------------- qibla ---------------- */

  function computeQibla() {
    var p = place();
    state.qibla = PrayerEngine.qibla(p.lat, p.lng);
    return state.qibla;
  }

  /* True north on the screen, once the phone tells us where it is pointing. */
  function roseTurn() {
    return state.heading === null ? 0 : -state.heading;
  }

  /* How far the top of the phone is from the qibla, as a number a person can
     act on: zero means they are facing it. */
  function offBy(bearing) {
    if (state.heading === null) return null;
    var d = Math.abs(((bearing - state.heading) % 360 + 540) % 360 - 180);
    return d;
  }

  function renderQibla() {
    if (!$('qibla-degrees')) return;
    var p = place();
    var bearing = state.qibla === null ? computeQibla() : state.qibla;
    var distance = PrayerEngine.distanceToKaaba(p.lat, p.lng);
    var off = offBy(bearing);

    $('qibla-degrees').textContent = ar(Math.round(bearing)) + '°';

    if ($('qibla-note')) {
      var where = 'من ' + p.n + ' إلى الكعبة ' + ar(Math.round(distance)) + ' كيلومتراً';
      if (state.heading === null) {
        $('qibla-note').textContent = where +
          '، والزاوية من الشمال الحقيقي، فوجّه أعلى الجهاز نحو الشمال ثم اتبع السهم';
      } else if (off <= 5) {
        $('qibla-note').textContent = where + '، وأنت الآن مواجه القبلة';
      } else {
        $('qibla-note').textContent = where + '، فأدر نفسك ' + ar(Math.round(off)) + ' درجة حتى يستقيم السهم لأعلى';
      }
    }

    /* The whole face turns so that الشمال keeps pointing at true north, and the
       needle sits inside it at the qibla angle. Turning the needle alone would
       leave the letter glued to the top of the screen while the phone moves,
       so the face and the needle would disagree about where north is. */
    var rose = $('compass-rose');
    if (rose) rose.style.transform = 'rotate(' + roseTurn().toFixed(2) + 'deg)';

    var needle = $('qibla-needle');
    if (needle) needle.setAttribute('transform', 'rotate(' + bearing.toFixed(2) + ' 100 100)');

    var face = $('compass-face');
    if (face) {
      if (off !== null && off <= 5) face.classList.add('is-aligned');
      else face.classList.remove('is-aligned');
    }

    var enable = $('qibla-enable');
    if (enable) {
      var needsPermission = window.DeviceOrientationEvent &&
        typeof window.DeviceOrientationEvent.requestPermission === 'function';
      enable.hidden = !needsPermission || state.heading !== null;
    }
  }

  var headingBound = false;
  function watchHeading() {
    if (!window.addEventListener || headingBound) return;
    headingBound = true;
    /* Only the absolute event is a compass. The plain one reports an angle
       measured from wherever the phone happened to be when the page opened,
       which is not north and drifts, so it is taken only when the phone says
       outright that it is absolute or hands over a compass heading. */
    window.addEventListener('deviceorientationabsolute', onHeading, true);
    window.addEventListener('deviceorientation', onHeading, true);
  }

  /* A phone held in landscape reports its angles about a turned screen, so the
     rotation of the screen itself is taken back out. */
  function screenAngle() {
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
      return window.screen.orientation.angle;
    }
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  function onHeading(event) {
    var heading = null;
    if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) {
      heading = event.webkitCompassHeading;
    } else if (event.absolute === true && typeof event.alpha === 'number' && event.alpha !== null) {
      heading = 360 - event.alpha;
    }
    if (heading === null || isNaN(heading)) return;
    heading = ((heading + screenAngle()) % 360 + 360) % 360;
    /* A compass jitters, so a reading is only taken up when it has really
       moved, or the needle shivers on the screen. */
    if (state.heading !== null && Math.abs(state.heading - heading) < 1) return;
    state.heading = heading;
    if (state.view === 'qibla') renderQibla();
  }

  function askCompass() {
    if (!window.DeviceOrientationEvent || typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
      watchHeading();
      return;
    }
    window.DeviceOrientationEvent.requestPermission().then(function (result) {
      if (result === 'granted') { watchHeading(); toast('فُعّلت البوصلة'); }
      else toast('لم يُسمح باستخدام البوصلة');
    }).catch(function () { toast('تعذّر تفعيل البوصلة'); });
  }

  /* ---------------- tasbih ---------------- */

  function phraseList() {
    return typeof TASBIH_PHRASES !== 'undefined' ? TASBIH_PHRASES : [{ t: 'سبحان الله', target: 33 }];
  }

  function renderTasbih() {
    if (!$('tasbih-value')) return;
    var list = phraseList();
    var current = list[state.tasbih.index] || list[0];

    $('tasbih-value').textContent = ar(state.tasbih.count);
    if ($('tasbih-phrase')) $('tasbih-phrase').textContent = current.t;
    if ($('tasbih-target')) {
      $('tasbih-target').textContent = 'الهدف ' + ar(current.target) +
        (state.tasbih.count >= current.target ? '، بلغت الهدف' : '');
    }
    if ($('tasbih-phrases')) {
      $('tasbih-phrases').innerHTML = list.map(function (p, i) {
        return '<button class="chip' + (i === state.tasbih.index ? ' is-on' : '') +
          '" data-phrase="' + i + '">' + esc(p.t) + '</button>';
      }).join('');
    }
    if ($('tasbih-total')) {
      $('tasbih-total').textContent = 'مجموع اليوم ' + ar(Store.day().tasbih || 0) + ' تسبيحة';
    }
  }

  function countTasbih() {
    var list = phraseList();
    var current = list[state.tasbih.index] || list[0];
    state.tasbih.count++;
    Store.updateDay(function (rec) { rec.tasbih = (rec.tasbih || 0) + 1; });
    buzz(state.tasbih.count === current.target ? 30 : 8);
    if (state.tasbih.count === current.target) toast('بلغت ' + ar(current.target) + ' في ' + current.t);
    renderTasbih();
  }

  /* ---------------- radio ---------------- */

  var SLEEP_CHOICES = [15, 30, 45, 60];

  function renderRadio() {
    var host = $('radio-list');
    if (!host || typeof RADIO_STATIONS === 'undefined') return;
    host.innerHTML = RADIO_STATIONS.map(function (s, i) {
      return '<button class="row" data-station="' + i + '">' +
        '<span class="row-mark">' + icon('radio') + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(s.name) + '</span>' +
        '<span class="row-note">' + esc(s.note) + '</span></span>' +
        '<span class="row-meta">' + icon('play') + '</span></button>';
    }).join('');

    var chips = $('sleep-timer');
    if (chips) {
      chips.innerHTML = SLEEP_CHOICES.map(function (m) {
        return '<button class="chip" data-sleep="' + m + '">' + ar(m) + ' دقيقة</button>';
      }).join('') + '<button class="chip" data-sleep="0">إلغاء</button>';
    }
    renderSleepNote();
  }

  function renderSleepNote() {
    var note = $('sleep-note');
    if (!note) return;
    if (!state.sleepTimer) { note.textContent = 'المؤقت متوقف'; return; }
    var left = Math.max(0, Math.round((state.sleepEndsAt - Date.now()) / 60000));
    note.textContent = 'سيتوقف البث بعد ' + ar(left) + ' دقيقة';
  }

  function setSleep(minutes) {
    if (state.sleepTimer) { window.clearTimeout(state.sleepTimer); state.sleepTimer = null; }
    if (!minutes) { renderSleepNote(); toast('أُلغي المؤقت'); return; }
    state.sleepEndsAt = Date.now() + minutes * 60000;
    state.sleepTimer = window.setTimeout(function () {
      stopAudio();
      state.sleepTimer = null;
      renderSleepNote();
      toast('توقف البث');
    }, minutes * 60000);
    renderSleepNote();
    toast('سيتوقف البث بعد ' + ar(minutes) + ' دقيقة');
  }

  /* ---------------- reference lists ---------------- */

  function renderHadith() {
    var host = $('hadith-list');
    if (!host || typeof HADITHS === 'undefined') return;
    host.innerHTML = HADITHS.map(function (h) {
      return '<div class="card"><div class="card-head"><h2>الحديث ' + ar(h.n) + '</h2></div>' +
        '<p class="naskh" style="font-size:1.02rem;line-height:2.1">' + esc(h.t) + '</p>' +
        '<p class="source">' + esc(h.s) + '، ' + esc(h.r) + '</p></div>';
    }).join('');
  }

  function renderDua() {
    var host = $('dua-list');
    if (!host || typeof DUAS === 'undefined') return;
    host.innerHTML = DUAS.map(function (group) {
      return '<h2 class="section-title">' + esc(group.cat) + '</h2>' +
        group.items.map(function (d) {
          return '<div class="card"><p class="naskh" style="font-size:1.02rem;line-height:2.1">' +
            esc(d.t) + '</p><p class="source">' + esc(d.r) + '</p></div>';
        }).join('');
    }).join('');
  }

  function renderRuqyah() {
    var host = $('ruqyah-list');
    if (!host || typeof RUQYAH === 'undefined') return;
    host.innerHTML = RUQYAH.map(function (r) {
      return '<div class="card"><p class="naskh" style="font-size:1.02rem;line-height:2.1">' +
        esc(r.t) + '</p><p class="source">' + esc(r.r) + '</p></div>';
    }).join('');
  }

  /* ---------------- calendar ---------------- */

  /* Which month the grid is showing. Null means the one today falls in. */
  var calendarMonth = null;

  function shownMonth() {
    if (calendarMonth) return calendarMonth;
    var h = Hijri.toHijri(new Date(), Store.get('hijriAdjust'));
    return { y: h.y, m: h.m };
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  /* A short label for the marks under a day, so the grid says what kind of day
     it is without needing to be read word by word. */
  var OCCASION_RANK = { eid: 5, month: 4, season: 4, night: 3, fast: 2, weekly: 1 };

  function strongest(list) {
    var best = null;
    list.forEach(function (o) {
      if (!best || (OCCASION_RANK[o.kind] || 0) > (OCCASION_RANK[best.kind] || 0)) best = o;
    });
    return best;
  }

  function renderCalendarGrid() {
    var grid = $('cal-grid');
    if (!grid) return;
    var adjust = Store.get('hijriAdjust');
    var month = shownMonth();
    var days = Hijri.monthDays(month.y, month.m, adjust);
    var today = new Date();

    if ($('cal-month')) {
      $('cal-month').textContent = Hijri.MONTHS[month.m - 1] + ' ' + ar(month.y) + ' هـ';
    }
    if ($('cal-span') && days.length) {
      var from = days[0].date, to = days[days.length - 1].date;
      var months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      $('cal-span').textContent = ar(from.getDate()) + ' ' + months[from.getMonth()] +
        ' إلى ' + ar(to.getDate()) + ' ' + months[to.getMonth()] + ' ' + ar(to.getFullYear());
    }

    var week = $('cal-week');
    if (week) {
      /* One letter each, as an arabic wall calendar writes them, because a three
         letter cut gives الأ for both الأحد and الأربعاء. */
      var initials = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
      week.innerHTML = initials.map(function (letter, i) {
        return '<span title="' + esc(Hijri.WEEKDAYS[i]) + '">' + letter + '</span>';
      }).join('');
    }

    if (!days.length) { grid.innerHTML = empty('تعذّر بناء هذا الشهر'); return; }

    var cells = '';
    /* The week starts on Sunday, so a month opening on a Wednesday leaves three
       empty places before it. */
    for (var blank = 0; blank < days[0].weekday; blank++) cells += '<span class="cal-cell is-empty"></span>';

    days.forEach(function (day) {
      var list = Hijri.occasions(day.date, adjust);
      var mark = strongest(list);
      var isToday = sameDay(day.date, today);
      var cls = 'cal-cell';
      if (isToday) cls += ' is-today';
      if (mark) cls += ' has-mark kind-' + mark.kind;
      var label = mark ? ' title="' + esc(mark.name) + '"' : '';
      cells += '<button class="' + cls + '" data-day="' + day.d + '"' + label +
        (isToday ? ' aria-current="date"' : '') + '>' +
        '<span class="cal-num">' + ar(day.d) + '</span>' +
        '<span class="cal-greg">' + ar(day.date.getDate()) + '</span>' +
        (mark ? '<span class="cal-dot"></span>' : '') + '</button>';
    });

    grid.innerHTML = cells;
    if ($('cal-today')) {
      var h = Hijri.toHijri(today, adjust);
      $('cal-today').hidden = (month.y === h.y && month.m === h.m);
    }
  }

  /* The day the reader has picked out of the grid, or today when none. */
  var pickedDay = null;

  function renderCalendarDay() {
    var adjust = Store.get('hijriAdjust');
    var date = pickedDay || new Date();
    var h = Hijri.toHijri(date, adjust);

    if ($('calendar-today')) {
      $('calendar-today').textContent = Hijri.format(h) + '، ' + h.weekday;
    }

    var host = $('calendar-occasions');
    if (!host) return;
    var list = Hijri.occasions(date, adjust);
    host.innerHTML = list.length
      ? list.map(function (o) {
        return '<div class="occasion kind-' + esc(o.kind) + '">' +
          '<div class="row-title">' + esc(o.name) + '</div>' +
          '<div class="row-note">' + esc(o.note) + '</div></div>';
      }).join('')
      : '<p class="setting-note">لا مناسبة مخصوصة في هذا اليوم، والعمل الصالح فيه محبوب على كل حال.</p>';
  }

  function renderCalendarUpcoming() {
    var list = $('calendar-upcoming');
    if (!list) return;
    var upcoming = Hijri.upcoming(new Date(), Store.get('hijriAdjust'));
    list.innerHTML = upcoming.map(function (o) {
      return '<div class="row" style="cursor:default"><span class="row-mark">' + esc(o.icon) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(o.name) + '</span>' +
        '<span class="row-note">' + (o.days === 0 ? 'اليوم' : 'بعد ' + days(o.days)) +
        '، ' + ar(o.hijriYear) + ' هـ</span></span></div>';
    }).join('');
  }

  function renderCalendar() {
    if (!$('cal-grid')) return;
    renderCalendarGrid();
    renderCalendarDay();
    renderCalendarUpcoming();
  }

  function stepCalendar(by) {
    var month = shownMonth();
    calendarMonth = Hijri.stepMonth(month.y, month.m, by);
    /* The card underneath should speak about the month on the screen, so it
       moves to the first of it rather than staying on today. */
    var days = Hijri.monthDays(calendarMonth.y, calendarMonth.m, Store.get('hijriAdjust'));
    pickedDay = days.length ? days[0].date : null;
    renderCalendar();
    if (days.length) markPicked(days[0].d);
  }

  function markPicked(hijriDay) {
    $$('#cal-grid .cal-cell').forEach(function (cell) {
      if (+cell.getAttribute('data-day') === hijriDay) cell.classList.add('is-picked');
      else cell.classList.remove('is-picked');
    });
  }

  function pickCalendarDay(hijriDay) {
    var month = shownMonth();
    var days = Hijri.monthDays(month.y, month.m, Store.get('hijriAdjust'));
    for (var i = 0; i < days.length; i++) {
      if (days[i].d === hijriDay) { pickedDay = days[i].date; break; }
    }
    renderCalendarGrid();
    renderCalendarDay();
    markPicked(hijriDay);
  }

  /* ---------------- settings ---------------- */

  function fillSelect(el, options, value) {
    if (!el) return;
    el.innerHTML = options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value) ? ' selected' : '') +
        '>' + esc(o.label) + '</option>';
    }).join('');
    el.value = String(value);
  }

  function setSwitch(el, on) {
    if (!el) return;
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    if (on) el.classList.add('is-on'); else el.classList.remove('is-on');
  }

  function renderSettings() {
    if (!$('settings-city')) return;
    var s = Store.settings();
    var p = place();

    if ($('settings-place')) {
      $('settings-place').textContent = p.n + '، ' +
        ar(p.lat.toFixed(2)) + '، ' + ar(p.lng.toFixed(2));
    }

    var cityOptions = [{ value: '', label: 'اختر مدينة' }].concat(
      (typeof CITIES !== 'undefined' ? CITIES : []).map(function (c, i) {
        return { value: String(i), label: c.n };
      })
    );
    var cityIndex = '';
    if (typeof CITIES !== 'undefined') {
      for (var i = 0; i < CITIES.length; i++) if (CITIES[i].n === p.n) { cityIndex = String(i); break; }
    }
    fillSelect($('settings-city'), cityOptions, cityIndex);

    fillSelect($('settings-method'), Object.keys(PrayerEngine.METHODS).map(function (k) {
      return { value: k, label: PrayerEngine.METHODS[k].name };
    }), s.method);

    if ($('settings-asr')) $('settings-asr').value = s.asr;
    if ($('settings-highlat')) $('settings-highlat').value = s.highLat;
    if ($('settings-theme')) $('settings-theme').value = s.theme;
    if ($('settings-tafsir')) $('settings-tafsir').value = s.tafsir;
    if ($('settings-font')) $('settings-font').value = String(s.fontScale);

    fillSelect($('settings-reciter'), (typeof RECITERS !== 'undefined' ? RECITERS : []).map(function (r, i) {
      return { value: String(i), label: r.name + '، ' + r.country };
    }), String(s.reciter));

    setSwitch($('settings-notify'), !!s.notify);
    setSwitch($('settings-vibrate'), !!s.vibrate);
    applyFont();

    var installRow = $('settings-install');
    if (installRow) {
      installRow.hidden = !state.installOffer || standalone();
    }
    if ($('offline-state')) {
      $('offline-state').textContent = Mushaf.ready()
        ? 'نص المصحف محمّل في جهازك، فالقراءة تعمل بلا إنترنت'
        : 'نص المصحف لم يكتمل تحميله بعد';
    }
    if ($('about-version')) $('about-version').textContent = 'النسخة ' + ar(VERSION);
  }

  function chooseCity(index) {
    if (typeof CITIES === 'undefined') return;
    var c = CITIES[index];
    if (!c) return;
    setPlace({ n: c.n, lat: c.lat, lng: c.lng, tz: c.tz, z: c.z, method: c.method }, true);
    toast('ضُبطت المواقيت على ' + c.n);
  }

  function askNotify() {
    var on = !Store.get('notify');
    if (!on) { Store.set('notify', false); setSwitch($('settings-notify'), false); return; }
    if (!window.Notification) { toast('المتصفح لا يتيح الإشعارات'); return; }
    window.Notification.requestPermission().then(function (result) {
      var granted = result === 'granted';
      Store.set('notify', granted);
      setSwitch($('settings-notify'), granted);
      toast(granted ? 'ستصلك تنبيهات الصلاة' : 'لم يُسمح بالإشعارات');
    });
  }

  function exportBackup() {
    var payload = Store.exportAll();
    var text = JSON.stringify(payload, null, 2);
    var blob = new window.Blob([text], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'sunnati-backup-' + Store.dayKey() + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
    toast('نُزّلت نسختك الاحتياطية');
  }

  function importBackup(file) {
    if (!file) return;
    var reader = new window.FileReader();
    reader.onload = function () {
      var result = Store.importAll(String(reader.result));
      if (!result.ok) { toast('الملف غير صالح'); return; }
      state.place = null;
      applyTheme();
      applyFont();
      refreshTimes();
      renderSettings();
      renderHome();
      toast('استُعيدت ' + ar(result.count) + ' مدخلة');
    };
    reader.readAsText(file);
  }

  function clearEverything() {
    var removed = Store.clearAll();
    state.place = null;
    state.tasbih = { index: 0, count: 0 };
    applyTheme();
    applyFont();
    refreshTimes();
    renderSettings();
    renderHome();
    toast('حُذفت ' + ar(removed) + ' مدخلة');
  }

  /* The last resort for a device holding an old copy: throw away every cache,
     let go of the worker, and ask the network for the whole thing again. */
  function refetchEverything() {
    toast('جارٍ جلب النسخة الأحدث');
    var jobs = [];
    if (window.caches && window.caches.keys) {
      jobs.push(window.caches.keys().then(function (names) {
        return Promise.all(names.map(function (n) { return window.caches.delete(n); }));
      }));
    }
    if (window.navigator && window.navigator.serviceWorker) {
      jobs.push(window.navigator.serviceWorker.getRegistrations().then(function (list) {
        return Promise.all(list.map(function (r) { return r.unregister(); }));
      }));
    }
    Promise.all(jobs).catch(function () { return null; }).then(function () {
      state.updateOffered = true;
      window.location.reload();
    });
  }

  function cacheEverything() {
    if (!window.caches) { toast('المتصفح لا يتيح التخزين للعمل بلا إنترنت'); return; }
    toast('جارٍ التحميل');
    window.caches.open('sunnati-v' + VERSION).then(function (cache) {
      return cache.addAll(['./', './index.html', './data/mushaf.json', './css/style.css']);
    }).then(function () {
      toast('صار كل شيء متاحاً بلا إنترنت');
    }).catch(function () {
      toast('تعذّر إكمال التحميل');
    });
  }

  /* ---------------- renderers by view ---------------- */

  var RENDERERS = {
    home: renderHome,
    quran: renderQuran,
    reader: renderReader,
    search: renderSearch,
    bookmarks: renderBookmarks,
    khatma: renderKhatma,
    azkar: renderAzkar,
    'azkar-list': renderAzkarList,
    tracker: renderTracker,
    more: renderMore,
    qibla: renderQibla,
    tasbih: renderTasbih,
    radio: renderRadio,
    hadith: renderHadith,
    dua: renderDua,
    ruqyah: renderRuqyah,
    calendar: renderCalendar,
    settings: renderSettings,
    about: renderSettings
  };

  var ACTIONS = {
    bookmark: function (ref) {
      var parts = ref.split(':');
      var s = +parts[0], a = +parts[1];
      var added = Store.toggleBookmark(s, a);
      toast(added ? 'حُفظت الآية' : 'أُزيلت من المحفوظات');
      verseSheet(s, a);
      if (state.view === 'reader') renderReader();
      if (state.view === 'bookmarks') renderBookmarks();
    },
    share: function (ref) {
      var parts = ref.split(':');
      var s = +parts[0], a = +parts[1];
      var meta = surahMeta(s);
      shareText('سُنّتي', Mushaf.ayah(s, a) + '\n\nسورة ' + (meta ? meta.ar : '') + ' آية ' + ar(a));
    },
    listen: function (ref) {
      var parts = ref.split(':');
      playVerse(+parts[0], +parts[1]);
    },
    tafsir: function (ref) {
      var parts = ref.split(':');
      loadTafsir(+parts[0], +parts[1]);
    },
    copy: function (ref) {
      var parts = ref.split(':');
      var sNum = +parts[0], aNum = +parts[1];
      var meta = surahMeta(sNum);
      copyText(Mushaf.ayah(sNum, aNum) + '\n\nسورة ' + (meta ? meta.ar : '') + '، آية ' + ar(aNum))
        .then(function () { toast('نُسخت الآية'); }, function () { toast('تعذّر النسخ'); });
    },
    memorise: function (ref) {
      var parts = ref.split(':');
      repeatSheet(+parts[0], +parts[1]);
    },
    'repeat-start': function () {
      var from = +$('rep-from').value;
      var to = Math.max(from, +$('rep-to').value);
      var times = +$('rep-times').value;
      startRepeat(from, to, times, $('rep-hide').checked);
    },
    'clear-bookmarks': function () {
      Store.clearBookmarks();
      renderBookmarks();
      toast('مُسحت المحفوظات');
    }
  };

  /* ---------------- wiring ---------------- */

  function onClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var nav = target.closest('[data-go]');
    if (nav) { go(nav.getAttribute('data-go')); return; }

    var surah = target.closest('[data-surah]');
    if (surah) {
      openReader(+surah.getAttribute('data-surah'), +surah.getAttribute('data-ayah') || 0);
      return;
    }

    var hit = target.closest('[data-hit]');
    if (hit) {
      var ref = hit.getAttribute('data-hit').split(':');
      openReader(+ref[0], +ref[1]);
      return;
    }

    var ayah = target.closest('[data-ayah]');
    if (ayah && ayah.classList.contains('ayah')) {
      var parts = ayah.getAttribute('data-ayah').split(':');
      verseSheet(+parts[0], +parts[1]);
      return;
    }

    var page = target.closest('[data-page]');
    if (page) { openAtPage(+page.getAttribute('data-page')); return; }

    var act = target.closest('[data-act]');
    if (act) {
      var fn = ACTIONS[act.getAttribute('data-act')];
      if (fn) fn(act.getAttribute('data-ref') || '');
      return;
    }

    var foldHead = target.closest('.fold-head');
    if (foldHead) {
      var section = foldHead.closest('[data-fold]');
      var key = section.getAttribute('data-fold');
      openGroups[key] = !section.classList.contains('is-open');
      section.classList.toggle('is-open');
      foldHead.setAttribute('aria-expanded', section.classList.contains('is-open') ? 'true' : 'false');
      return;
    }

    var check = target.closest('[data-check]');
    if (check) { toggleCheck(check.getAttribute('data-check')); return; }

    var azkar = target.closest('[data-azkar]');
    if (azkar) { openAzkar(azkar.getAttribute('data-azkar')); return; }

    var dhikr = target.closest('[data-dhikr]');
    if (dhikr) { countDhikr(+dhikr.getAttribute('data-dhikr')); return; }

    var browse = target.closest('[data-browse]');
    if (browse) { state.browse = browse.getAttribute('data-browse'); renderSurahList(); return; }

    var khatma = target.closest('[data-khatma]');
    if (khatma) {
      Store.set('khatmaDays', +khatma.getAttribute('data-khatma'));
      if (!Store.get('khatmaStart')) Store.set('khatmaStart', Date.now());
      renderKhatma();
      return;
    }

    var phrase = target.closest('[data-phrase]');
    if (phrase) {
      state.tasbih.index = +phrase.getAttribute('data-phrase');
      state.tasbih.count = 0;
      renderTasbih();
      return;
    }

    var station = target.closest('[data-station]');
    if (station && typeof RADIO_STATIONS !== 'undefined') {
      var s = RADIO_STATIONS[+station.getAttribute('data-station')];
      if (s) playAudio(s.url, s.name, s.note);
      return;
    }

    var day = target.closest('[data-day]');
    if (day) { pickCalendarDay(+day.getAttribute('data-day')); return; }

    var sleep = target.closest('[data-sleep]');
    if (sleep) { setSleep(+sleep.getAttribute('data-sleep')); return; }
  }

  function bind(id, event, handler) {
    var el = $(id);
    if (el) el.addEventListener(event, handler);
  }

  function wire() {
    document.addEventListener('click', onClick);

    window.addEventListener('scroll', updateReadProgress, { passive: true });

    window.addEventListener('popstate', function () {
      if ($('sheet') && $('sheet').classList.contains('is-open')) { closeSheet(); return; }
      followAddress();
    });

    bind('hijri-up', 'click', function () { nudgeHijri(1); });
    bind('hijri-down', 'click', function () { nudgeHijri(-1); });
    bind('ayah-share', 'click', function () {
      var pos = state.dailyAyah;
      if (!pos) return;
      ACTIONS.share(pos.s + ':' + pos.a);
    });

    bind('surah-filter', 'input', function (e) { state.filter = e.target.value; renderSurahList(); });
    bind('quran-search', 'input', function (e) { state.query = e.target.value; renderSearch(); });

    bind('resume-btn', 'click', function () {
      var last = Store.get('lastRead');
      if (last && last.s) openReader(last.s, last.a);
    });

    bind('reader-prev', 'click', function () { openReader(state.surah - 1); });
    bind('reader-next', 'click', function () { openReader(state.surah + 1); });
    bind('reader-play', 'click', function () { playSurah(state.surah); });
    bind('reader-done', 'click', function () {
      Store.markSurahRead(state.surah);
      toast('سُجّلت السورة في تقدمك');
      renderReader();
    });

    bind('khatma-page-plus', 'click', function () { stepKhatma(1); });
    bind('khatma-page-minus', 'click', function () { stepKhatma(-1); });
    bind('khatma-restart', 'click', function () {
      Store.setReadPages(0);
      Store.set('khatmaStart', Date.now());
      renderKhatma();
      toast('بدأت ختمة جديدة');
    });

    bind('azkar-reset', 'click', resetAzkar);

    bind('tasbih-tap', 'click', countTasbih);
    bind('tasbih-reset', 'click', function () {
      state.tasbih.count = 0;
      renderTasbih();
      toast('صُفّر العدّاد');
    });

    bind('cal-prev', 'click', function () { stepCalendar(-1); });
    bind('cal-next', 'click', function () { stepCalendar(1); });
    bind('cal-today', 'click', function () { calendarMonth = null; pickedDay = null; renderCalendar(); });

    bind('qibla-enable', 'click', askCompass);
    bind('qibla-locate', 'click', locate);
    bind('settings-locate', 'click', locate);

    bind('settings-city', 'change', function (e) {
      if (e.target.value === '') return;
      chooseCity(+e.target.value);
    });
    bind('settings-method', 'change', function (e) {
      Store.set('method', e.target.value);
      refreshTimes();
      renderHome();
      renderSettings();
    });
    bind('settings-asr', 'change', function (e) {
      Store.set('asr', e.target.value);
      refreshTimes();
      renderHome();
    });
    bind('settings-highlat', 'change', function (e) {
      Store.set('highLat', e.target.value);
      refreshTimes();
      renderHome();
    });
    bind('settings-theme', 'change', function (e) {
      Store.set('theme', e.target.value);
      applyTheme();
    });
    bind('settings-reciter', 'change', function (e) { Store.set('reciter', +e.target.value); });
    bind('settings-tafsir', 'change', function (e) { Store.set('tafsir', e.target.value); });
    bind('settings-font', 'input', function (e) {
      Store.set('fontScale', +e.target.value);
      applyFont();
    });
    bind('settings-notify', 'click', askNotify);
    bind('settings-vibrate', 'click', function () {
      var on = !Store.get('vibrate');
      Store.set('vibrate', on);
      setSwitch($('settings-vibrate'), on);
    });

    bind('data-export', 'click', exportBackup);
    bind('data-import', 'click', function () { if ($('data-file')) $('data-file').click(); });
    bind('data-file', 'change', function (e) { importBackup(e.target.files && e.target.files[0]); });
    bind('data-clear', 'click', clearEverything);
    bind('offline-cache', 'click', cacheEverything);
    bind('offline-refresh', 'click', refetchEverything);
    bind('settings-install', 'click', install);

    bind('banner-close', 'click', hideBanner);
    bind('sheet-close', 'click', closeSheet);
    bind('sheet', 'click', function (e) { if (e.target && e.target.id === 'sheet') closeSheet(); });

    bind('player-stop', 'click', stopAudio);
    bind('player-toggle', 'click', function () {
      if (!state.audio) return;
      if (state.audio.paused) { state.audio.play(); } else { state.audio.pause(); }
    });

    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-color-scheme: dark)');
      if (query.addEventListener) {
        query.addEventListener('change', function () { if (Store.get('theme') === 'auto') applyTheme(); });
      }
    }
  }

  /* The module wants a fetcher that hands back the parsed payload, so passing
     fetch itself would deliver a Response and the text would never arrive. */
  function fetchJson(url) {
    return window.fetch(url).then(function (r) {
      if (!r.ok) throw new Error('mushaf request failed with ' + r.status);
      return r.json();
    });
  }

  function loadMushaf() {
    if (Mushaf.ready()) { afterMushaf(); return; }
    if (!window.fetch) { toast('المتصفح لا يتيح تحميل نص المصحف'); return; }
    Mushaf.load(fetchJson)
      .then(afterMushaf)
      .catch(function () { toast('تعذّر تحميل نص المصحف'); });
  }

  function afterMushaf() {
    if (RENDERERS[state.view]) RENDERERS[state.view]();
    renderDailyAyah();
    if ($('offline-state')) {
      $('offline-state').textContent = 'نص المصحف محمّل في جهازك، فالقراءة تعمل بلا إنترنت';
    }
  }

  /* ---------------- the app as an app ---------------- */

  function showBanner(text, actionLabel, action) {
    var banner = $('banner');
    if (!banner) return;
    $('banner-text').textContent = text;
    var act = $('banner-act');
    if (actionLabel) {
      act.hidden = false;
      act.textContent = actionLabel;
      act.onclick = function () { hideBanner(); action(); };
    } else {
      act.hidden = true;
      act.onclick = null;
    }
    banner.hidden = false;
    /* It floats above the tab bar, so the page is told to leave room or the
       last row of whatever list is open sits underneath it. */
    window.setTimeout(function () {
      var height = banner.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--banner-room', Math.round(height + 12) + 'px');
    }, 0);
  }

  function hideBanner() {
    var banner = $('banner');
    if (banner) banner.hidden = true;
    document.documentElement.style.setProperty('--banner-room', '0px');
  }

  /* The browser offers to install once, and only once, so the offer is kept
     until the reader is ready for it rather than thrown away. */
  function watchInstall() {
    window.addEventListener('beforeinstallprompt', function (event) {
      if (event.preventDefault) event.preventDefault();
      state.installOffer = event;
      renderSettings();
      if (!Store.get('installAsked')) {
        Store.set('installAsked', true);
        showBanner('ثبّت سُنّتي على جهازك ليعمل بلا إنترنت', 'تثبيت', install);
      }
    });
    window.addEventListener('appinstalled', function () {
      state.installOffer = null;
      hideBanner();
      renderSettings();
      toast('تم التثبيت، فتجده الآن مع تطبيقاتك');
    });
  }

  function install() {
    var offer = state.installOffer;
    if (!offer) { toast('التثبيت يجري من قائمة المتصفح'); return; }
    offer.prompt();
    Promise.resolve(offer.userChoice).then(function (choice) {
      state.installOffer = null;
      renderSettings();
      if (choice && choice.outcome === 'accepted') toast('جارٍ التثبيت');
    }).catch(function () { state.installOffer = null; });
  }

  function standalone() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    return !!window.navigator.standalone;
  }

  function watchNetwork() {
    window.addEventListener('offline', function () {
      showBanner('لا اتصال الآن، والمصحف والأذكار والمواقيت تعمل كما هي');
    });
    window.addEventListener('online', hideBanner);
    if (window.navigator.onLine === false) {
      showBanner('لا اتصال الآن، والمصحف والأذكار والمواقيت تعمل كما هي');
    }
  }

  /* A worker that has installed but is waiting would otherwise sit unused until
     every tab closed, so the reader is told and can take it now. */
  /* An update is offered rather than forced, because swapping the files under
     someone who is reading is rude. But an offer that is never accepted leaves
     the device on old code for good, so the handover also happens by itself the
     moment the app goes out of sight, and the next visit is simply current. */
  function handOver(worker) {
    if (!worker) return;
    var asked = false;
    function apply() {
      if (asked) return;
      asked = true;
      worker.postMessage({ type: 'take-over' });
    }
    showBanner('وصل تحديث للتطبيق', 'حدّث الآن', apply);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) apply();
    });
    window.addEventListener('pagehide', apply);
  }

  function watchUpdate(registration) {
    if (!registration) return;
    function offer(worker) {
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed' && window.navigator.serviceWorker.controller) handOver(worker);
      });
    }
    if (registration.waiting && window.navigator.serviceWorker.controller) {
      handOver(registration.waiting);
    }
    registration.addEventListener('updatefound', function () { offer(registration.installing); });
    /* Ask the server whether anything newer exists, rather than waiting for the
       browser to get around to it. */
    window.setInterval(function () { registration.update(); }, 30 * 60 * 1000);
    /* Coming back to the app is the moment a person is most willing to wait a
       second for it to catch up. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { try { registration.update(); } catch (e) { /* offline */ } }
    });
  }

  function registerWorker() {
    if (!window.navigator || !window.navigator.serviceWorker) return;
    if (window.location.protocol === 'file:') return;

    /* The new worker takes over on its own, so this fires while someone may be
       mid ayah. They are offered the new version rather than dropped into a
       reload they did not ask for. */
    window.navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (state.updateOffered) return;
      state.updateOffered = true;
      showBanner('وصلت نسخة جديدة من التطبيق', 'تحديث', function () { window.location.reload(); });
    });

    /* Without this the browser may keep serving sw.js from its own cache for a
       day, and a fix waits a day before it is even noticed. */
    window.navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(watchUpdate)
      .catch(function () { /* offline install is optional */ });
  }

  function boot() {
    Store.attach();
    Store.migrate();
    Store.prune();
    applyTheme();
    applyFont();
    computeQibla();
    refreshTimes();
    wire();
    followAddress();
    renderSettings();
    watchHeading();
    watchInstall();
    watchNetwork();
    window.setInterval(tick, 1000);
    window.setInterval(renderSleepNote, 30000);
    loadMushaf();
    registerWorker();
  }

  window.App = {
    version: VERSION,
    boot: boot,
    go: go,
    state: state,
    clockState: clockState,
    computeTimes: computeTimes,
    setPlace: setPlace,
    render: RENDERERS,
    actions: ACTIONS,
    helpers: {
      ar: ar, esc: esc, icon: icon, highlight: highlight, hexToWash: hexToWash,
      tabOwner: tabOwner, prayerName: prayerName, windowSunnah: windowSunnah, withLam: withLam,
      isFriday: isFriday, totalSunnahCount: totalSunnahCount,
      addressOf: addressOf, readAddress: readAddress, standalone: standalone
    },
    repeat: { start: startRepeat, stop: stopRepeat, next: nextInRepeat },
    banner: { show: showBanner, hide: hideBanner }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window, document);
