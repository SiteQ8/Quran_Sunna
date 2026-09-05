/* ============================================================
   سُنّتي  ·  app controller
   Routing, the prayer clock, the reader, the trackers and the
   settings. No framework and no build step, so the file that
   ships is the file that runs.
   ============================================================ */
(function (window, document) {
  'use strict';

  var VERSION = '7.8.0';
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

  var TABS = ['home', 'quran', 'tasbih', 'tracker', 'more'];

  var OWNED_BY = {
    reader: 'quran', search: 'quran', bookmarks: 'quran', khatma: 'quran', page: 'quran',
    azkar: 'tasbih', 'azkar-list': 'tasbih', hisn: 'tasbih'
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
    recite: null,
    scope: 'quran',
    page: 1,
    hisn: 27,
    dailyAyah: null
  };

  /* Which groups the reader has left open. Everything starts open, and a group
     they shut stays shut while they work. */
  var openGroups = {};

  /* ---------------- helpers ---------------- */

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* Numbers are written with the figures a Kuwaiti reader sees on every clock
     and price tag, so the app keeps to one set throughout and does not mix. */
  function ar(value) {
    return String(value === null || value === undefined ? '' : value);
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

  /* Arabic counts one, two, a few and many differently, so 3 يوماً reads as a
     mistake where 3 أيام is right. */
  function daysOf(n) { return count(n, 'يوم واحد', 'يومان', 'أيام', 'يوماً'); }
  function ayat(n) { return count(n, 'آية واحدة', 'آيتان', 'آيات', 'آية'); }
  function pages(n) { return count(n, 'صفحة واحدة', 'صفحتان', 'صفحات', 'صفحة'); }
  function minutesOf(n) { return count(n, 'دقيقة واحدة', 'دقيقتان', 'دقائق', 'دقيقة'); }
  function entries(n) { return count(n, 'مدخلة واحدة', 'مدخلتان', 'مدخلات', 'مدخلة'); }
  function tasbihat(n) { return count(n, 'تسبيحة واحدة', 'تسبيحتان', 'تسبيحات', 'تسبيحة'); }
  function rounds(n) { return count(n, 'جولة واحدة', 'جولتان', 'جولات', 'جولة'); }

  /* The four forms arabic counts by: one, two, three to ten, and above. */
  function count(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return ar(n) + ' ' + few;
    return ar(n) + ' ' + many;
  }


  /* The lam of ownership swallows the alef of the article, so الكويت becomes
     للكويت rather than لـالكويت. */
  function withLam(name) {
    var text = String(name || '');
    return 'ل' + (text.indexOf('ال') === 0 ? text.slice(1) : text);
  }

  /* The prayer engine writes the time on twelve hours with صباحاً or مساءً,
     which is how a clock is read here, and the figures match the rest. */
  /* The ص or م after a time is set smaller and bound to the figures with a
     joiner, so a narrow column cannot push it onto a line of its own. */
  function clockMarkup(minutes) {
    var text = clockText(minutes);
    var parts = text.split(' ');
    if (parts.length !== 2) return esc(text);
    return esc(parts[0]) + '\u2060<small class="ampm">' + esc(parts[1]) + '</small>';
  }

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
    patternStamp = '';
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
    if ($('font-value')) $('font-value').textContent = ar(Store.get('fontScale')) + '%';
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

  /* A colour the reader picks, instead of the one the hour brings. Each carries
     a second, darker or lighter form for text, fitted so it clears four and a
     half to one against the page, the card and its own tinted panel. */
  var PALETTES = {
    green:  { name: 'أخضر',    light: '#1e6f47', lightInk: '#1e6f47', dark: '#30b171' },
    gold:   { name: 'ذهبي',    light: '#b08833', lightInk: '#7d6124', dark: '#bb9036' },
    maroon: { name: 'عنّابي',  light: '#a84a6b', lightInk: '#9c4564', dark: '#f66c9d' },
    blue:   { name: 'أزرق',    light: '#2f7fc0', lightInk: '#26689c', dark: '#399ae8' },
    violet: { name: 'بنفسجي',  light: '#5b4a99', lightInk: '#5b4a99', dark: '#a889ff' },
    teal:   { name: 'فيروزي',  light: '#1a8a8a', lightInk: '#156e6e', dark: '#1fa6a6' },
    copper: { name: 'نحاسي',   light: '#b5643a', lightInk: '#945230', dark: '#dd7a47' },
    sadu:   { name: 'أحمر السدو', light: '#9c2b2b', lightInk: '#9c2b2b', dark: '#ff6969' }
  };

  function darkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function applyAccent(windowKey) {
    var root = document.documentElement;
    var chosen = PALETTES[Store.get('accent')];
    var fill, ink;
    if (chosen) {
      /* A fixed colour stays through the day, so the hour no longer changes it. */
      fill = darkTheme() ? chosen.dark : chosen.light;
      ink = darkTheme() ? chosen.dark : chosen.lightInk;
    } else {
      var name = ACCENT_TOKEN[windowKey];
      fill = token(name, ACCENT_FALLBACK[windowKey] || '#1e6f47');
      ink = token(name ? name + '-ink' : null, ACCENT_INK_FALLBACK[windowKey] || fill);
    }
    root.style.setProperty('--accent', fill);
    root.style.setProperty('--accent-ink', ink);
    root.style.setProperty('--accent-wash', hexToWash(fill));
    root.setAttribute('data-window', windowKey);
    applyPattern();
    /* the bar the browser paints above the app follows the app's colour */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', darkTheme() ? '#10161a' : ink);
  }

  /* Two patterns to lay under the app, both drawn here so each takes the colour
     the reader has chosen rather than carrying one of its own. */
  var PATTERNS = {
    star: {
      name: 'النجمة الثمانية',
      size: 112,
      weight: .22,
      draw: function (c) {
        var square = function (x, y, cx, cy) {
          return "<rect x='" + x + "' y='" + y + "' width='26' height='26'/>" +
            "<rect x='" + x + "' y='" + y + "' width='26' height='26' transform='rotate(45 " + cx + " " + cy + ")'/>";
        };
        return "<svg xmlns='http://www.w3.org/2000/svg' width='112' height='112' viewBox='0 0 80 80'>" +
          "<g fill='none' stroke='" + c + "' stroke-width='1'>" +
          square(27, 27, 40, 40) + square(-13, -13, 0, 0) + square(67, -13, 80, 0) +
          square(-13, 67, 0, 80) + square(67, 67, 80, 80) + "</g>" +
          "<g fill='none' stroke='" + c + "' stroke-width='.7' opacity='.7'>" +
          "<path d='M40 0v80M0 40h80'/></g></svg>";
      }
    },
    /* السدو، نسيج البادية الكويتية: عصائب أفقية فيها العين والأضلاع. */
    sadu: {
      name: 'السدو الكويتي',
      size: 60,
      weight: .14,
      draw: function (c) {
        return "<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'>" +
          "<g fill='" + c + "'>" +
          "<path d='M0 4h60v2H0z'/><path d='M0 54h60v2H0z'/>" +
          "<path d='M30 12 42 24 30 36 18 24z'/>" +
          "<path d='M0 12 6 24 0 36zM60 12 54 24 60 36z'/>" +
          "<path d='M10 44 16 50 4 50zM30 44 36 50 24 50zM50 44 56 50 44 50z'/>" +
          "</g>" +
          "<g fill='none' stroke='" + c + "' stroke-width='1.6'>" +
          "<path d='M0 24h18M42 24h18'/></g></svg>";
      }
    },
    none: { name: 'بلا زخرفة', size: 80, weight: 0, draw: null }
  };

  var patternStamp = '';

  function applyPattern() {
    var key = Store.get('pattern');
    var def = PATTERNS[key] || PATTERNS.star;
    var colour = document.documentElement.style.getPropertyValue('--accent-ink').trim() || '#1e6f47';
    var stamp = key + colour;
    if (stamp === patternStamp) return;
    patternStamp = stamp;
    var root = document.documentElement;
    if (!def.draw) { root.style.setProperty('--pattern', 'none'); return; }
    root.style.setProperty('--pattern',
      'url("data:image/svg+xml,' + encodeURIComponent(def.draw(colour)) + '")');
    root.style.setProperty('--pattern-size', def.size + 'px ' + def.size + 'px');
    root.style.setProperty('--pattern-weight', String(def.weight));
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
    if (state.view === 'settings' && name !== 'settings') stopSpeaking();
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

  /* Naming where a person is, without asking any server. The cities the app
     already carries are enough to say "الكويت" or "قرب الدوحة", and anything
     far from all of them falls back to the coordinates themselves. */
  function nameForPlace(lat, lng) {
    if (typeof CITIES === 'undefined') return null;
    var best = null;
    for (var i = 0; i < CITIES.length; i++) {
      var c = CITIES[i];
      var km = PrayerEngine.between(lat, lng, c.lat, c.lng);
      if (!best || km < best.km) best = { city: c, km: km };
    }
    if (!best) return null;
    if (best.km <= 25) return { n: best.city.n, z: best.city.z, method: best.city.method };
    if (best.km <= 120) {
      return { n: 'قرب ' + best.city.n, z: best.city.z, method: best.city.method };
    }
    return null;
  }

  function coordsLabel(lat, lng) {
    var ns = lat >= 0 ? 'شمالاً' : 'جنوباً';
    var ew = lng >= 0 ? 'شرقاً' : 'غرباً';
    return Math.abs(lat).toFixed(2) + '° ' + ns + '، ' + Math.abs(lng).toFixed(2) + '° ' + ew;
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
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      var near = nameForPlace(lat, lng);
      setPlace({
        n: near ? near.n : coordsLabel(lat, lng),
        lat: lat, lng: lng, tz: tz, z: (near && near.z) || zone
      }, true);
      toast('ضُبطت المواقيت على ' + (near ? near.n : 'موقعك'));
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
    var fasting = Hijri.toHijri(new Date(), Store.get('hijriAdjust')).m === 9;
    $('arc-name').textContent = c.next.key === 'sunrise' ? c.next.ar
      : (fasting && c.next.key === 'maghrib') ? 'الإفطار' : 'أذان ' + c.next.ar;
    $('arc-at').textContent = clockText(c.next.at);
    /* باقٍ على أذان العصر is how it is said. The sunrise has no adhan, so it
       is named on its own. */
    if ($('arc-label')) $('arc-label').textContent = 'باقٍ على';

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
    maybeSalawat(false);
    if (state.scheduledFor !== Store.dayKey()) { state.scheduledFor = Store.dayKey(); scheduleForWorker(); }
    if (!state.askedPlace) { state.askedPlace = true; window.setTimeout(maybeAskPlace, 1500); }
  }

  function renderWindows(c) {
    var host = $('windows');
    if (!host) return;
    host.innerHTML = c.marks.map(function (m) {
      var cls = 'window';
      if (m.key === c.prev.key) cls += ' is-now';
      else if (m.at < c.now) cls += ' is-past';
      return '<div class="' + cls + '" role="listitem" aria-label="' + esc(m.ar + ' ' + clockText(m.at)) +
        (m.key === c.prev.key ? '، الوقت الحالي' : '') + '">' +
        '<div class="window-name" aria-hidden="true">' + esc(m.ar) + '</div>' +
        '<div class="window-time" aria-hidden="true">' + clockMarkup(m.at) + '</div></div>';
    }).join('');
  }

  /* On a phone a page may not raise a notification itself: android throws on
     new Notification and the old code swallowed the error, so nothing ever
     appeared. The worker can, so it is asked to, and the direct call is kept
     for a desktop browser without one. */
  function notify(title, body, tag) {
    if (!window.Notification || window.Notification.permission !== 'granted') return Promise.resolve(false);
    var options = {
      body: body, tag: tag, lang: 'ar', dir: 'rtl',
      icon: 'icons/icon-192.png', badge: 'icons/icon-96.png',
      vibrate: Store.get('vibrate') ? [200, 100, 200] : undefined,
      data: { url: './' }
    };
    function direct() {
      try { new window.Notification(title, options); return true; } catch (e) { return false; }
    }
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      return navigator.serviceWorker.ready.then(function (reg) {
        if (reg && typeof reg.showNotification === 'function') {
          return reg.showNotification(title, options).then(function () { return true; }, direct);
        }
        return direct();
      }).catch(direct);
    }
    return Promise.resolve(direct());
  }

  /* A phone slows a page's clock to a crawl in the background, so a check that
     only fires within two minutes of the time misses it more often than not.
     The window is twenty minutes, the record of what was raised is kept on
     disk rather than in memory so a reload cannot raise it twice, and the
     check runs again the moment the app comes back to the front. */
  function maybeNotify(c) {
    if (!Store.get('notify')) return;
    if (!window.Notification || window.Notification.permission !== 'granted') return;
    var key = Store.dayKey() + ':' + c.prev.key;
    var raised = Store.get('notified') || {};
    if (raised[key]) return;
    if (c.now - c.prev.at > 20) return;
    raised[key] = Date.now();
    Object.keys(raised).forEach(function (k) { if (Date.now() - raised[k] > 2 * 86400000) delete raised[k]; });
    Store.set('notified', raised);
    var name = prayerName(c.prev.key, new Date());
    var sunrise = c.prev.key === 'sunrise';
    /* the word carries a sunnah of the hour from the book, so it reminds
       rather than only rings */
    var block = windowSunnah(c.prev.key, new Date());
    var lead = block && block.block && block.block.items && block.block.items[0];
    var body = sunrise ? 'طلعت الشمس' : 'الله أكبر، حيّ على الصلاة';
    if (lead) body += (sunrise ? '، ' : '، ومن سنن الوقت: ') + lead.replace(/،.*$/, '');
    notify('حان وقت ' + name, body, key);
    if (!sunrise) speak('حان وقت صلاة ' + name.replace(/^أذان /, ''), 'adhan');
    maybeSalawat(true);
  }

  /* ---------------- a voice for the reminder ---------------- */

  /* A short chime, drawn from the device's own oscillator so no file is needed. */
  function chime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      var ctx = new Ctx();
      [[660, 0], [880, 0.22], [660, 0.48]].forEach(function (pair) {
        var osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = pair[0];
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + pair[1]);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + pair[1] + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + pair[1] + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + pair[1]); osc.stop(ctx.currentTime + pair[1] + 0.55);
      });
      return true;
    } catch (e) { return false; }
  }

  /* The phone's own arabic voice speaks the line, where it has one. Nothing is
     downloaded and it works with the connection off. */
  /* The book's own recording of الصلاة على النبي, a man reciting it, which
     needs no speech engine at all. Fetched once and kept by the worker. */
  var SALAWAT_RECORDING = 'audio/salawat.mp3';

  function playRecording(url) {
    try {
      var clip = new window.Audio();
      clip.src = url;
      state.voiceClip = clip;
      clip.onended = function () { if (state.voiceClip === clip) { state.voiceClip = null; markVoiceButton(false); } };
      clip.play().catch(function () { state.voiceClip = null; markVoiceButton(false); chime(); });
      markVoiceButton(true);
      return true;
    } catch (e) { return chime(); }
  }

  /* Whatever the sample is, a clip or the phone's own speech, one call ends it. */
  function stopSpeaking() {
    if (state.voiceClip) {
      try { state.voiceClip.pause(); state.voiceClip.removeAttribute('src'); state.voiceClip.load(); } catch (e) { /* gone */ }
      state.voiceClip = null;
    }
    if (window.speechSynthesis && window.speechSynthesis.cancel) {
      try { window.speechSynthesis.cancel(); } catch (e2) { /* nothing speaking */ }
    }
    state.speaking = false;
    markVoiceButton(false);
  }

  function isSpeaking() {
    return !!state.voiceClip || !!state.speaking;
  }

  /* The one button starts the sample and, while it plays, stops it. */
  function markVoiceButton(playing) {
    var btn = $('settings-voice-try');
    if (!btn) return;
    btn.innerHTML = icon(playing ? 'pause' : 'play');
    btn.setAttribute('aria-label', playing ? 'أوقف الصوت' : 'اسمع الصوت');
    btn.classList.toggle('is-playing', playing);
  }

  function speak(text, why) {
    var mode = Store.get('voice') || 'recording';
    if (mode === 'none') return false;
    if (mode === 'tone') return chime();
    if (mode === 'recording') return why === 'adhan' ? chime() : playRecording(SALAWAT_RECORDING);
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return chime();
    try {
      var line = new window.SpeechSynthesisUtterance(text);
      line.lang = 'ar-SA';
      line.rate = 0.85;
      /* pitched low, so that whatever voice the phone offers sits nearer a
         man's register */
      line.pitch = 0.75;
      var chosen = pickVoice();
      if (chosen) line.voice = chosen;
      else if ((window.speechSynthesis.getVoices() || []).length) return chime();
      line.onend = function () { state.speaking = false; markVoiceButton(false); };
      line.onerror = line.onend;
      state.speaking = true;
      markVoiceButton(true);
      chime();
      window.setTimeout(function () { if (state.speaking) window.speechSynthesis.speak(line); }, 700);
      return true;
    } catch (e) { return chime(); }
  }

  /* The arabic voices the phone carries. Google names its arabic voices
     ar-xa-x-arc, ar-xa-x-ard and so on without saying which is a man, so the
     reader picks by ear from the list and the app remembers the name. Until
     they do, a voice whose name says male is preferred, then the deepest set. */
  function arabicVoices() {
    if (!window.speechSynthesis) return [];
    return (window.speechSynthesis.getVoices() || []).filter(function (v) {
      return /^ar/i.test(v.lang || '') || /arab|عرب/i.test(v.name || '');
    });
  }

  /* A phone hands its voices over late, sometimes seconds after the page
     asks, so the list is asked for again a few times before giving up. */
  function showDeviceVoiceRow() {
    var row = $('settings-device-voice');
    if (!row) return;
    var mode = Store.get('voice') || 'recording';
    row.hidden = mode !== 'speech';
    var hint = $('settings-voice-hint');
    if (hint) {
      hint.textContent = {
        recording: 'صوت قارئ يتلو الصلاة الإبراهيمية، ويُسمع ما دام التطبيق مفتوحاً',
        tone: 'نغمة قصيرة من الجهاز',
        speech: 'الهاتف ينطق الصلاة على النبي بصوته',
        none: 'يصل التنبيه صامتاً'
      }[mode] || '';
    }
  }

  function fillVoiceListSoon() {
    fillVoiceList();
    [300, 1200, 3000].forEach(function (wait) { window.setTimeout(fillVoiceList, wait); });
  }

  function pickVoice() {
    var list = arabicVoices();
    if (!list.length) return null;
    var wanted = Store.get('voiceName');
    var named = list.filter(function (v) { return v.name === wanted; })[0];
    if (named) return named;
    var male = list.filter(function (v) { return /male|man|رجل|ard|ar-xa-x-ar[bdfh]/i.test(v.name) && !/female/i.test(v.name); })[0];
    return male || list[0];
  }

  /* Chrome on a phone speaks through the system's voice but hands the page
     no list of voices at all, so an empty list means the phone chooses, not
     that it has no arabic. The words say which of the two it is, and where
     on the phone the voice is changed. */
  function fillVoiceList() {
    var sel = $('settings-voice-name');
    if (!sel) return;
    var list = arabicVoices();
    var current = Store.get('voiceName') || '';
    var plain = $('settings-voice-plain');
    var note = $('settings-voice-note');
    if (list.length) {
      var options = [{ value: '', label: 'الأنسب من أصوات جهازك' }]
        .concat(list.map(function (v, i) {
          /* the codes google gives its voices mean nothing to a listener, so
             each is numbered and the code kept small beside it */
          var short = v.name.replace(/^ar[-_]/i, '').replace(/-(local|network)$/i, '');
          return { value: v.name, label: 'الصوت ' + ar(i + 1) + '، ' + short };
        }));
      fillSelect(sel, options, current);
      sel.hidden = false;
      if (plain) plain.hidden = true;
      if (note) note.textContent = 'اختر صوتاً واضغط زر السماع';
    } else {
      /* a sentence does not fit in a list, so with nothing to choose from
         the list goes and two plain words take its place */
      sel.hidden = true;
      if (plain) { plain.hidden = false; plain.textContent = 'صوت الهاتف'; }
      if (note) note.textContent = 'لتغييره افتح إعدادات الهاتف، ثم تحويل النص إلى كلام، ثم اللغة العربية';
    }
  }

  /* A reminder to send blessings on the Prophet, every so many minutes that
     the reader chooses, and more insistently on Friday. */
  var SALAWAT_LINES = [
    'اللهم صلِّ وسلِّم على نبينا محمد',
    'اللهم صلِّ على محمد وعلى آل محمد كما صليت على إبراهيم وعلى آل إبراهيم',
    'من صلى عليَّ صلاةً صلى الله عليه بها عشراً',
    'أكثروا الصلاة عليَّ يوم الجمعة وليلة الجمعة'
  ];

  function maybeSalawat(force) {
    var every = +Store.get('salawat') || 0;
    if (!every) return;
    if (!window.Notification || window.Notification.permission !== 'granted') return;
    var last = +Store.get('salawatAt') || 0;
    var due = Date.now() - last >= every * 60000;
    if (!due && !force) return;
    if (force && Date.now() - last < 10 * 60000) return;
    Store.set('salawatAt', Date.now());
    var friday = isFriday(new Date());
    var line = friday ? SALAWAT_LINES[3] : SALAWAT_LINES[Math.floor(Math.random() * 3)];
    notify('صلِّ على النبي ﷺ', line, 'salawat');
    speak('اللهم صلِّ وسلِّم على نبينا محمد', 'salawat');
  }

  function askPeriodicWake() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (!reg.periodicSync) return;
      reg.periodicSync.register('sunnati-reminders', { minInterval: 60 * 60 * 1000 }).catch(function () {});
    }).catch(function () {});
  }

  /* On the first open the times are for الكويت, which is right for most who
     install this and wrong for everyone else. Once, the app asks. The device's
     own zone is a good hint: a phone set to Asia/Kuwait is not asked at all. */
  function maybeAskPlace() {
    if (Store.get('placeAsked')) return;
    var p = place();
    if (!p || p.n !== 'الكويت') { Store.set('placeAsked', true); return; }
    var zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { zone = ''; }
    Store.set('placeAsked', true);
    if (zone === 'Asia/Kuwait') return;
    showBanner('المواقيت الآن للكويت، فإن كنت في مكان آخر فحدّد موقعك', 'حدّد موقعي', function () {
      go('settings');
      locate();
    });
  }

  function scheduleForWorker() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    askPeriodicWake();
    var times = computeTimes(new Date());
    var today = new Date();
    var list = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map(function (k) {
      var at = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      at.setMinutes(times[k]);
      return { key: k, name: prayerName(k, today), at: at.getTime() };
    });
    navigator.serviceWorker.controller.postMessage({
      type: 'schedule',
      notify: !!Store.get('notify'),
      prayers: list,
      salawatEvery: +Store.get('salawat') || 0,
      salawatAt: +Store.get('salawatAt') || 0
    });
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
    if ($('hijri-reset')) {
      var shift = +adjust || 0;
      $('hijri-reset').hidden = shift === 0;
      $('hijri-reset').textContent = shift === 0 ? '' :
        'معدّل ' + (shift > 0 ? '+' : '−') + ar(Math.abs(shift));
    }
  }

  function nudgeHijri(delta) {
    var next = Math.max(-2, Math.min(2, Store.get('hijriAdjust') + delta));
    Store.set('hijriAdjust', next);
    renderDate();
    renderCalendar();
    renderHome();
    toast(next === 0 ? 'التاريخ على الحساب الأصلي' : 'التاريخ معدّل ' + daysOf(Math.abs(next)) + (next > 0 ? ' للأمام' : ' للخلف'));
  }

  function currentWindowKey() { return clockState().windowKey; }

  /* The sunan of الجمعة belong to the whole of the day, from the ghusl before
     morning to the hour of answer in العصر, so the card carries them through
     those windows. الفجر keeps its own emphasised rakahs, and after المغرب the
     night already belongs to the next day. */
  function windowSunnah(key, date) {
    var daytime = key === 'duha' || key === 'dhuhr' || key === 'asr';
    if (isFriday(date) && daytime && typeof FRIDAY_SUNNAH !== 'undefined') {
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
          '" data-check="' + esc(id) + '" role="checkbox" aria-checked="' + (record.sunnah[id] ? 'true' : 'false') + '">' +
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
        ? daysOf(s.current) + ' متتابعة'
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
      return '<div class="row" style="cursor:default"><span class="row-mark">' + icon(o.icon) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(o.name) + '</span>' +
        '<span class="row-note">' + (o.days === 0 ? 'اليوم' : 'بعد ' + daysOf(o.days)) + '</span></span></div>';
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
        ' <span class="place-how">تقويم ' + esc(methodName(Store.get('method'))) + '</span>';
    }
  }

  /* ---------------- the mushaf list ---------------- */

  function surahRow(meta) {
    var done = Store.progress().completed.indexOf(meta.n) !== -1;
    /* The transliterated name is kept for searching but never shown, because a
       reader who opens an arabic mushaf should not meet a latin word in it.
       The page it opens at is more use to them anyway. */
    var note = Mushaf.ready()
      ? 'تبدأ في صفحة ' + ar(Mushaf.pageOf(meta.n, 1))
      : ayat(meta.ay);
    return '<button class="row" data-surah="' + meta.n + '">' +
      '<span class="row-mark">' + ar(meta.n) + '</span>' +
      '<span class="row-body"><span class="row-title">' + esc(meta.ar) +
      (done ? ' ' + icon('check') : '') + '</span>' +
      '<span class="row-note">' + esc(note) + '</span></span>' +
      '<span class="row-meta">' + esc(meta.tp) + '، ' + ayat(meta.ay) + '</span></button>';
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
    if (String(meta.n) === needle.replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })) return true;
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
        ? meta.tp + '، ' + ayat(meta.ay) + where + (virtue ? '، ' + virtue : '')
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
        esc(text) + sajda + '\u2060<span class="ayah-num" data-n="' + a + '" aria-label="آية ' + a + '"></span></span> ';
    }).join('');

    body.className = 'reader-body';
    body.innerHTML = '<div class="ayah-block">' + html + '</div>';
    if (state.recite && state.recite.s === n) markReciting(state.recite.a);
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
    toast('أتممت ' + rounds(r.times) + ' على ' + ayat(r.to - r.from + 1));
    stopRepeat();
  }

  function repeatSheet(s, a) {
    var meta = surahMeta(s);
    var total = meta ? meta.ay : 1;
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
      '<select id="rep-from">' + options(a, total) + '</select></div>' +
      '<div class="repeat-row"><label for="rep-to">إلى آية</label>' +
      '<select id="rep-to">' + options(Math.min(total, a + 2), total) + '</select></div>' +
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
      '<button class="btn btn-ghost" data-act="picture" data-ref="' + s + ':' + a + '">' + icon('star') + 'صورة</button>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn btn-ghost" data-act="copy" data-ref="' + s + ':' + a + '">' + icon('text') + 'نسخ</button>' +
      '<button class="btn btn-ghost" data-page="' + Mushaf.pageOf(s, a) + '">' + icon('book') + 'أول الصفحة</button>' +
      '</div>' +
      '<button class="btn btn-ghost btn-block" data-act="memorise" data-ref="' + s + ':' + a +
      '" style="margin-top:8px">' + icon('refresh') + 'كرّر للحفظ</button>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn btn-ghost" data-act="listen" data-ref="' + s + ':' + a + '">' + icon('play') + 'استماع</button>' +
      '<button class="btn btn-ghost" data-act="recite" data-ref="' + s + ':' + a + '">' + icon('play') + 'اقرأ من هنا</button>' +
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
      state.audio.oncanplay = null;
      state.audio.onerror = null;
      try { state.audio.pause(); } catch (e) { /* already stopped */ }
      /* a clip still loading would start on its own once it arrived */
      try { state.audio.removeAttribute('src'); state.audio.load(); } catch (e2) { /* not an element */ }
    }
    state.audio = null;
    state.playing = null;
    var player = $('player');
    if (player) player.classList.remove('is-open');
  }

  /* ---------------- reciting along ---------------- */

  /* A recitation walks the verses one at a time, so the page can mark the verse
     being read and carry it into view. A single long file for a whole surah
     cannot say where in the text it has reached. */
  function reciteFrom(s, a, to) {
    if (!Mushaf.ready()) { toast('نص المصحف لم يكتمل تحميله بعد'); return; }
    var total = Mushaf.surah(s).length;
    state.recite = {
      s: s,
      a: Math.max(1, Math.min(total, a || 1)),
      to: Math.max(1, Math.min(total, to || total))
    };
    keepAwake();
    reciteVerse();
  }

  /* Named apart from the repeat run, which owns reciteCurrent, since two
     declarations of one name leave only the last and the other feature dies
     without a sound. */
  function reciteVerse() {
    var r = state.recite;
    if (!r) return;
    if (r.a > r.to) {
      var done = surahMeta(r.s);
      stopRecite();
      toast('تمت تلاوة ' + (done ? 'سورة ' + done.ar : 'الورد'));
      return;
    }
    markReciting(r.a);
    var meta = surahMeta(r.s);
    playAudio(
      'https://cdn.islamic.network/quran/audio/128/' + reciterId() + '/' +
        Mushaf.globalIndex(r.s, r.a) + '.mp3',
      'سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(r.a),
      reciterName()
    );
    if (state.audio) {
      state.audio.onended = function () {
        if (!state.recite) return;
        state.recite.a++;
        reciteVerse();
      };
    }
  }

  function stepRecite(by) {
    if (!state.recite) return;
    var total = Mushaf.surah(state.recite.s).length;
    state.recite.a = Math.max(1, Math.min(total, state.recite.a + by));
    if (state.recite.a > state.recite.to) state.recite.to = total;
    reciteVerse();
  }

  /* The stop on the player bar stops whatever is running: a walk through the
     surah, a repeat run for memorising, or a single clip. Stopping one while
     another kept going was how the sound went on after the button was pressed. */
  function stopRecite() {
    state.recite = null;
    if (state.repeat) {
      state.repeat = null;
      var body = $('reader-body');
      if (body) body.classList.remove('is-hidden');
    }
    releaseAwake();
    $$('.ayah').forEach(function (el) { el.classList.remove('is-reciting'); });
    stopAudio();
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
    reciteFrom(n, state.ayah || 1);
  }

  /* ---------------- reading by the page ---------------- */

  /* The mushaf turned page by page, as a printed one is. A new surah on the
     page opens with its name in a cartouche and its basmala, and every verse
     answers to a tap as it does in the surah reader. */
  var PAGES_IN_MUSHAF = 604;

  function openPage(n) {
    state.page = Math.max(1, Math.min(PAGES_IN_MUSHAF, n || 1));
    Store.set('lastPage', state.page);
    go('page');
  }

  function renderPage() {
    var body = $('page-body');
    if (!body) return;
    if (!Mushaf.ready()) { body.innerHTML = empty('نص المصحف لم يكتمل تحميله بعد'); return; }
    var n = state.page || +Store.get('lastPage') || 1;
    state.page = n;
    var verses = Mushaf.pageVerses(n);
    if (!verses.length) { body.innerHTML = empty('تعذّر بناء هذه الصفحة'); return; }

    var first = verses[0], last = verses[verses.length - 1];
    var firstMeta = surahMeta(first.s), lastMeta = surahMeta(last.s);
    if ($('page-title')) $('page-title').textContent = 'صفحة ' + ar(n);
    if ($('page-meta')) {
      $('page-meta').textContent = 'الجزء ' + ar(Mushaf.juzOf(first.s, first.a)) + '، ' +
        (first.s === last.s ? 'سورة ' + firstMeta.ar : 'من ' + firstMeta.ar + ' إلى ' + lastMeta.ar);
    }

    var marked = {};
    Store.bookmarks().forEach(function (b) { marked[b.s + ':' + b.a] = true; });

    var html = '', current = 0;
    verses.forEach(function (v) {
      if (v.s !== current) {
        current = v.s;
        if (v.a === 1) {
          var meta = surahMeta(v.s);
          html += '<div class="surah-frame page-surah"><h2>سورة ' + esc(meta.ar) + '</h2></div>';
          if (v.s !== 1 && v.s !== 9) html += '<p class="basmala">' + esc(Mushaf.basmala()) + '</p>';
        }
      }
      var cls = 'ayah' + (marked[v.s + ':' + v.a] ? ' is-marked' : '');
      var sajda = Mushaf.isSajda(v.s, v.a) ? '<span class="sajda-mark" title="موضع سجدة">۩</span>' : '';
      html += '<span class="' + cls + '" data-ayah="' + v.s + ':' + v.a + '" data-a="' + v.a + '">' +
        esc(v.text) + sajda + '\u2060<span class="ayah-num" data-n="' + v.a + '" aria-label="آية ' + v.a + '"></span></span> ';
    });
    body.innerHTML = '<div class="ayah-block">' + html + '</div>' +
      '<div class="page-foot"><span class="page-foot-num">' + ar(n) + '</span></div>';

    if ($('page-prev')) $('page-prev').disabled = n <= 1;
    if ($('page-next')) $('page-next').disabled = n >= PAGES_IN_MUSHAF;
    /* the place is remembered as a verse too, so تابع القراءة finds it */
    rememberPlace(first.s, first.a);
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  function turnPage(by) {
    var n = (state.page || 1) + by;
    if (n < 1 || n > PAGES_IN_MUSHAF) return;
    openPage(n);
  }

  /* ---------------- going straight to a place ---------------- */

  function openGoTo() {
    var meta = surahMeta(state.surah || 1);
    openSheet('اذهب إلى',
      '<div class="goto-row"><label class="setting-label" for="goto-page">صفحة</label>' +
      '<input class="field" id="goto-page" type="number" inputmode="numeric" min="1" max="604" placeholder="1 إلى 604">' +
      '<button class="btn btn-primary" data-act="goto-page">افتح</button></div>' +
      '<div class="goto-row"><label class="setting-label" for="goto-juz">جزء</label>' +
      '<input class="field" id="goto-juz" type="number" inputmode="numeric" min="1" max="30" placeholder="1 إلى 30">' +
      '<button class="btn btn-primary" data-act="goto-juz">افتح</button></div>' +
      '<div class="goto-row"><label class="setting-label" for="goto-surah">سورة وآية</label>' +
      '<select class="select" id="goto-surah">' +
      SURAHS.map(function (m) { return '<option value="' + m.n + '"' + (m.n === (state.surah || 1) ? ' selected' : '') + '>' + ar(m.n) + '، ' + esc(m.ar) + '</option>'; }).join('') +
      '</select>' +
      '<input class="field" id="goto-ayah" type="number" inputmode="numeric" min="1" max="' + (meta ? meta.ay : 286) + '" placeholder="الآية">' +
      '<button class="btn btn-primary" data-act="goto-ayah">افتح</button></div>'
    );
  }

  function goToPage() {
    var n = +($('goto-page') || {}).value;
    if (!n || n < 1 || n > PAGES_IN_MUSHAF) { toast('اكتب رقم صفحة من 1 إلى 604'); return; }
    closeSheet(); openPage(n);
  }

  function goToJuz() {
    var n = +($('goto-juz') || {}).value;
    if (!n || n < 1 || n > 30) { toast('اكتب رقم جزء من 1 إلى 30'); return; }
    var start = Mushaf.juzStart(n);
    closeSheet();
    if (start) openPage(Mushaf.pageOf(start.s, start.a));
  }

  function goToAyah() {
    var s = +($('goto-surah') || {}).value, a = +($('goto-ayah') || {}).value || 1;
    var meta = surahMeta(s);
    if (!meta) return;
    if (a < 1 || a > meta.ay) { toast('سورة ' + meta.ar + ' فيها ' + ayat(meta.ay)); return; }
    closeSheet(); openReader(s, a);
  }

  /* ---------------- a verse as a picture ---------------- */

  /* A verse drawn on a card with the app's own ornament, so it can be sent as
     a picture rather than as a line of text. Drawn on a canvas, in the
     mushaf typeface, at twice the size for a sharp result. */
  function verseCard(s, a) {
    var meta = surahMeta(s);
    var text = Mushaf.ayah(s, a);
    if (!text) return Promise.resolve(null);
    return textCard('سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(a), text, "'Amiri Quran', 'Amiri', serif", 'القرآن الكريم');
  }

  /* Any words on the same card: a dhikr from the book, a supplication, a
     hadith. The heading names where it is from. */
  function textCard(heading, text, face, source) {
    if (!text) return Promise.resolve(null);

    var W = 1080, PAD = 96;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);

    var fill = document.documentElement.style.getPropertyValue('--accent-ink').trim() || '#1e6f47';
    var wash = document.documentElement.style.getPropertyValue('--accent').trim() || fill;

    function ready() {
      return document.fonts && document.fonts.load
        ? Promise.all([document.fonts.load("400 60px 'Amiri Quran'"), document.fonts.load("700 40px 'IBM Plex Sans Arabic'"),
            document.fonts.load("400 30px 'IBM Plex Sans Arabic'")]).catch(function () {})
        : Promise.resolve();
    }

    function wrap(context, words, maxWidth) {
      var lines = [], line = '';
      words.forEach(function (word) {
        var probe = line ? line + ' ' + word : word;
        if (context.measureText(probe).width > maxWidth && line) { lines.push(line); line = word; }
        else line = probe;
      });
      if (line) lines.push(line);
      return lines;
    }

    function star(context, cx, cy, r) {
      context.save();
      context.translate(cx, cy);
      context.strokeStyle = '#b08833';
      context.lineWidth = 3;
      [0, Math.PI / 4].forEach(function (rot) {
        context.save(); context.rotate(rot);
        context.strokeRect(-r, -r, r * 2, r * 2);
        context.restore();
      });
      context.restore();
    }

    return ready().then(function () {
      var quranFace = face || "'Amiri', serif";
      var size = text.length > 400 ? 44 : (text.length > 220 ? 52 : 60);
      ctx.font = '400 ' + size + 'px ' + quranFace;
      ctx.direction = 'rtl';
      var lines = wrap(ctx, text.split(' '), W - PAD * 2 - 40);
      var lineHeight = Math.round(size * 2.2);
      var H = PAD * 2 + 140 + lines.length * lineHeight + (source ? 220 : 160);
      canvas.width = W; canvas.height = H;
      ctx = canvas.getContext('2d');

      /* paper, with a faint lattice and a gold frame */
      ctx.fillStyle = '#f7f5ef';
      ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalAlpha = 0.07;
      for (var y = 40; y < H; y += 112) for (var x = 40; x < W; x += 112) star(ctx, x, y, 22);
      ctx.restore();
      ctx.strokeStyle = wash; ctx.lineWidth = 6;
      ctx.strokeRect(36, 36, W - 72, H - 72);
      ctx.strokeStyle = '#b08833'; ctx.lineWidth = 2;
      ctx.strokeRect(52, 52, W - 104, H - 104);
      star(ctx, 52, 52, 14); star(ctx, W - 52, 52, 14); star(ctx, 52, H - 52, 14); star(ctx, W - 52, H - 52, 14);

      /* the surah, up top */
      ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = fill;
      ctx.font = "700 40px 'IBM Plex Sans Arabic', sans-serif";
      ctx.fillText(heading, W / 2, PAD + 40);

      /* the words, line by line */
      ctx.fillStyle = '#16241c';
      ctx.font = '400 ' + size + 'px ' + quranFace;
      var top = PAD + 175;
      lines.forEach(function (line, i) { ctx.fillText(line, W / 2, top + i * lineHeight); });

      /* the rosette that closes it, then where the words come from, then the
         app and its maker */
      var footY = top + lines.length * lineHeight + 20;
      star(ctx, W / 2, footY, 16);
      ctx.fillStyle = '#5e6c65';
      if (source) {
        ctx.font = "400 30px 'IBM Plex Sans Arabic', sans-serif";
        ctx.fillText(source, W / 2, footY + 62);
      }
      ctx.font = "400 28px 'IBM Plex Sans Arabic', sans-serif";
      ctx.fillText('سُنّتي، 3li.info', W / 2, H - PAD + 10);

      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
      });
    });
  }

  function shareVerseCard(s, a) {
    var meta = surahMeta(s);
    return sharePicture(verseCard(s, a), 'ayah-' + s + '-' + a + '.png', 'سورة ' + (meta ? meta.ar : '') + ' آية ' + ar(a));
  }

  function shareTextCard(heading, text, filename, source) {
    return sharePicture(textCard(heading, text, null, source), filename, heading);
  }

  function sharePicture(drawing, name, title) {
    toast('جارٍ تجهيز الصورة');
    return drawing.then(function (blob) {
      if (!blob) { toast('تعذّر رسم الصورة'); return false; }
      var file = null;
      try { file = new window.File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
      if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: title })
          .then(function () { return true; }, function () { return false; });
      }
      /* no sharing on this device, so the picture is handed over as a download */
      var url = window.URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = name;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 2000);
      toast('نُزّلت الصورة');
      return true;
    });
  }

  /* ---------------- search ---------------- */

  function highlight(text, needle) {
    if (!needle) return esc(text);
    var span = Mushaf.spanFor(text, needle);
    if (!span) return esc(text);
    return esc(text.slice(0, span.start)) + '<mark>' + esc(text.slice(span.start, span.end)) +
      '</mark>' + esc(text.slice(span.end));
  }

  /* The azkar, the hadiths and the supplications are searched by the same fold
     the mushaf uses, so the diacritics in them do not get in the way. */
  function searchTexts(scope, needle) {
    var plain = Mushaf.normalize(needle);
    var out = [];
    function take(text, where, key) {
      if (out.length >= 60) return;
      if (Mushaf.normalize(text).indexOf(plain) !== -1 || Mushaf.expand(text).indexOf(plain) !== -1) {
        out.push({ text: text, where: where, key: key });
      }
    }
    if (scope === 'sunan' && typeof SUNNAH_TRACKER !== 'undefined') {
      SUNNAH_TRACKER.forEach(function (g) {
        g.i.forEach(function (line) { take(line, g.s + '، ص ' + ar(g.p), 'tracker'); });
      });
      WIRD_ITEMS.forEach(function (w) { take(w.t + (w.n ? '، ' + w.n : ''), 'الورد اليومي', 'tracker'); });
    } else if (scope === 'azkar' && typeof AZKAR_DB !== 'undefined') {
      Object.keys(AZKAR_DB).forEach(function (k) {
        AZKAR_DB[k].items.forEach(function (item, i) { take(item.t, AZKAR_DB[k].title, 'azkar:' + k); });
      });
    } else if (scope === 'hadith' && typeof HADITHS !== 'undefined') {
      HADITHS.forEach(function (h) { take(h.t, 'الحديث ' + ar(h.n) + '، ' + h.r, 'hadith'); });
    } else if (scope === 'dua' && typeof DUAS !== 'undefined') {
      DUAS.forEach(function (group) {
        group.items.forEach(function (d) { take(d.t, group.cat + '، ' + (d.r || ''), 'dua'); });
      });
    }
    return out;
  }

  function renderTextHits(host, hits, needle) {
    if (!hits.length) { host.innerHTML = empty('لا نتيجة في هذا المجال'); return; }
    host.innerHTML = hits.map(function (hit) {
      var target = hit.key.indexOf('azkar:') === 0 ? ' data-azkar="' + esc(hit.key.slice(6)) + '"' :
        ' data-go="' + esc(hit.key) + '"';
      return '<button class="search-hit"' + target + '>' +
        '<span class="search-hit-ref">' + esc(hit.where) + '</span>' +
        highlight(hit.text, needle) + '</button>';
    }).join('');
  }

  function renderSearch() {
    var host = $('search-results');
    if (!host) return;
    var field = $('quran-search');
    if (field && field.value !== state.query) field.value = state.query;

    $$('#search-scope .chip').forEach(function (chip) {
      var on = chip.getAttribute('data-scope') === (state.scope || 'quran');
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    if ((state.scope || 'quran') !== 'quran') {
      var needleText = state.query.trim();
      if (needleText.length < 2) {
        if ($('search-count')) $('search-count').textContent = 'اكتب حرفين على الأقل';
        host.innerHTML = '';
        return;
      }
      var found = searchTexts(state.scope, needleText);
      if ($('search-count')) {
        $('search-count').textContent = found.length
          ? 'وجدنا ' + count(found.length, 'نتيجة واحدة', 'نتيجتين', 'نتائج', 'نتيجة')
          : 'لا نتيجة';
      }
      renderTextHits(host, found, needleText);
      return;
    }

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
        ? 'وردت في ' + ayat(total) + '، وهذه أول ' + ar(hits.length)
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
        daysOf(d) + '</button>';
    }).join('');

    var plan = Mushaf.khatmaPlan(days, 1);
    var perDay = Math.ceil(TOTAL_PAGES / days);
    if ($('khatma-rate')) {
      $('khatma-rate').textContent = 'نحو ' + pages(perDay) + ' كل يوم، أي قرابة ' +
        minutesOf(Math.max(1, Math.round(perDay * 1.6))) + ' من التلاوة';
    }

    var status = Mushaf.khatmaStatus(plan, khatmaElapsedDays(), Store.progress().pagesRead);
    var host = $('khatma-state');
    if (!host) return;

    var aheadLine;
    if (status.finished) aheadLine = 'أتممت الختمة، فتقبل الله منك';
    else if (status.ahead > 0) aheadLine = 'أنت متقدم ' + pages(status.ahead);
    else if (status.ahead < 0) aheadLine = 'عليك ' + pages(Math.abs(status.ahead)) + ' لتلحق بخطتك';
    else aheadLine = 'أنت في الموعد';

    var today = status.today || { from: null, to: null, pages: 0 };
    host.innerHTML =
      '<div class="meter-head"><span>قرأت <b>' + ar(status.read) + '</b> من ' + ar(TOTAL_PAGES) + ' صفحة</span>' +
      '<span class="badge">' + ar(status.percent) + '%</span></div>' +
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

  /* Which of the daily sections belongs to this hour, read from the prayer
     windows rather than the clock alone, so it follows the day wherever the
     reader is. */
  function azkarForNow() {
    var c = clockState();
    var key = c.prev.key;
    if (key === 'fajr' || key === 'sunrise' || key === 'duha') return 'morning';
    if (key === 'dhuhr') return 'afterPrayer';
    if (key === 'asr' || key === 'maghrib') return 'evening';
    return 'sleep';
  }

  var NOW_NOTES = {
    morning: 'من بعد الفجر إلى الضحى',
    afterPrayer: 'بعد كل صلاة مكتوبة',
    evening: 'من بعد العصر إلى العشاء',
    sleep: 'قبل أن تنام'
  };

  /* A ring that fills as a thing is done, drawn small enough to sit beside a
     number. */
  function ring(done, total) {
    var r = 17, c = 2 * Math.PI * r;
    var share = total ? Math.min(1, done / total) : 0;
    return '<svg viewBox="0 0 40 40" class="ring" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="' + r + '" class="ring-track"/>' +
      /* a zero length dash with round caps still draws a dot, so at zero the
         fill is left out altogether */
      (share > 0 ? '<circle cx="20" cy="20" r="' + r + '" class="ring-fill" stroke-dasharray="' + (c * share).toFixed(1) + ' ' + c.toFixed(1) + '"/>' : '') +
      '</svg>';
  }

  function renderAzkarNow() {
    var card = $('azkar-now');
    if (!card || typeof AZKAR_DB === 'undefined') return;
    var key = azkarForNow();
    var def = AZKAR_DB[key];
    if (!def) { card.hidden = true; return; }
    var p = Store.azkarProgress(key, def.items.length);
    card.hidden = false;
    card.setAttribute('data-azkar', key);
    if ($('azkar-now-glyph')) $('azkar-now-glyph').innerHTML = icon(def.icon);
    if ($('azkar-now-title')) $('azkar-now-title').textContent = def.title;
    if ($('azkar-now-note')) {
      $('azkar-now-note').textContent = (p.done >= def.items.length ? 'أتممتها اليوم، ' : ar(p.done) + ' من ' + ar(def.items.length) + '، ') + NOW_NOTES[key];
    }
    if ($('azkar-now-ring')) $('azkar-now-ring').innerHTML = ring(p.done, def.items.length);
    card.classList.toggle('is-complete', p.done >= def.items.length);
  }

  /* The whole book, in its own order, each chapter a row that opens it. */
  function renderHisn() {
    var host = $('hisn-groups');
    if (!host || typeof HISN === 'undefined') return;
    var needle = Mushaf.normalize(($('hisn-filter') || {}).value || '');
    var byId = {};
    HISN.forEach(function (c) { byId[c.id] = c; });
    var html = HISN_GROUPS.map(function (g) {
      var rows = g.ids.map(function (id) { return byId[id]; }).filter(function (c) {
        return c && (!needle || Mushaf.normalize(c.t).indexOf(needle) !== -1 ||
          c.i.some(function (it) { return Mushaf.normalize(it.t).indexOf(needle) !== -1; }));
      });
      if (!rows.length) return '';
      return '<section class="fold is-open"><div class="fold-head fold-static">' +
        '<span class="fold-title">' + esc(g.t) + '</span>' +
        '<span class="fold-tally">' + ar(rows.length) + '</span></div><div class="fold-body">' +
        rows.map(function (c) {
          var p = Store.hisnProgress(c.id, c.i.length);
          return '<button class="row" data-hisn="' + c.id + '"><span class="row-mark">' + ar(c.id) + '</span>' +
            '<span class="row-body"><span class="row-title">' + esc(c.t) + '</span>' +
            '<span class="row-note">' + count(c.i.length, 'ذكر واحد', 'ذكران', 'أذكار', 'ذكراً') +
            (p.done ? '، أدّيت ' + ar(p.done) : '') + '</span></span>' +
            (p.done >= c.i.length ? '<span class="row-meta">' + icon('check') + '</span>' : '') + '</button>';
        }).join('') + '</div></section>';
    }).join('');
    host.innerHTML = html || empty('لا باب بهذا الاسم');
  }

  function renderHisnChapter() {
    var host = $('hisn-list');
    if (!host || typeof HISN === 'undefined') return;
    var chapter = null;
    HISN.forEach(function (c) { if (c.id === state.hisn) chapter = c; });
    if (!chapter) { host.innerHTML = empty('لم نجد هذا الباب'); return; }
    if ($('hisn-title')) $('hisn-title').textContent = chapter.t;
    var counts = (Store.day().hisn || {})[chapter.id] || {};
    var done = 0;
    var html = chapter.i.map(function (item, i) {
      var target = item.r || 1;
      var left = Object.prototype.hasOwnProperty.call(counts, i) ? counts[i] : target;
      var isDone = left <= 0;
      if (isDone) done++;
      return dhikrCard({ t: item.t, n: item.n }, i, target, left, isDone, 'hisn');
    }).join('');
    if ($('hisn-meta')) {
      $('hisn-meta').textContent = 'الباب ' + ar(chapter.id) + '، ' + ar(done) + ' من ' + ar(chapter.i.length);
    }
    host.innerHTML = html;
  }

  /* One dhikr on a card: the words, how often it is said, and a ring that
     fills as it is counted. Tapping anywhere on the card counts it. */
  function dhikrCard(item, i, target, left, isDone, kind) {
    var said = target - left;
    var foot = item.r ? esc(item.r) : '';
    if (target > 1) foot += (foot ? '، ' : '') + count(target, 'مرة واحدة', 'مرتان', 'مرات', 'مرة');
    return '<div class="dhikr' + (isDone ? ' is-done' : '') + '" data-dhikr="' + i + '"' +
      (kind === 'hisn' ? ' data-kind="hisn"' : '') + ' role="button" tabindex="0">' +
      '<p class="dhikr-text">' + esc(item.t) + '</p>' +
      (item.n ? '<p class="dhikr-note">' + esc(item.n) + '</p>' : '') +
      '<div class="dhikr-foot"><span class="source">' + foot + '</span>' +
      '<button class="dhikr-share" data-picture="' + kind + ':' + i + '" aria-label="صورة للمشاركة">' + icon('share') + '</button>' +
      '<span class="dhikr-count' + (isDone ? ' is-done' : '') + '">' +
      ring(said, target) + '<span class="dhikr-left">' + (isDone ? icon('check') : ar(left)) + '</span></span></div></div>';
  }

  function renderAzkar() {
    renderAzkarNow();
    renderHisn();
    var host = $('azkar-groups');
    if (!host) return;
    host.innerHTML = azkarSections().map(function (row) {
      var p = Store.azkarProgress(row.key, row.def.items.length);
      return '<button class="tile" data-azkar="' + esc(row.key) + '">' +
        '<span class="tile-glyph">' + icon(row.def.icon) + '</span>' +
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
      return dhikrCard({ t: item.t, r: item.r, n: item.n }, i, target, left, done, 'daily');
    }).join('');

    var p = Store.azkarProgress(key, def.items.length);
    if ($('azkar-meter')) $('azkar-meter').style.width = p.percent + '%';
  }

  function countHisn(index) {
    var chapter = null;
    HISN.forEach(function (c) { if (c.id === state.hisn) chapter = c; });
    if (!chapter || !chapter.i[index]) return;
    var target = chapter.i[index].r || 1;
    var counts = (Store.day().hisn || {})[chapter.id] || {};
    var left = Object.prototype.hasOwnProperty.call(counts, index) ? counts[index] : target;
    if (left <= 0) return;
    Store.setHisnCount(chapter.id, index, left - 1);
    buzz(left - 1 === 0 ? 24 : 8);
    renderHisnChapter();
    if (left - 1 === 0) {
      var p = Store.hisnProgress(chapter.id, chapter.i.length);
      if (p.done === chapter.i.length) toast('أتممت ' + chapter.t);
    }
  }

  function countDhikr(index, inBook) {
    if (inBook) return countHisn(index);
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
        ? 'أطول تتابع ' + daysOf(s.longest)
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
          return '<button class="check' + (done ? ' is-done' : '') + '" data-check="' + esc(id) + '" role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '">' +
            '<span class="check-box">' + icon('check') + '</span>' +
            '<span class="check-label">' + esc(item.t) +
            '<span class="check-note">' + esc(item.n) + '</span></span></button>';
        }).join(''));
    }

    if (typeof SUNNAH_TRACKER !== 'undefined') {
      html += SUNNAH_TRACKER.map(function (group, gi) {
        var ids = group.i.map(function (_, ii) { return 'sunnah:' + gi + ':' + ii; });
        return fold('sunnah:' + gi, group.s, group.icon || null, ids,
          (group.p ? '<p class="fold-source">' + esc(SUNNAH_SOURCE.t) + '، ص ' + ar(group.p) + '</p>' : '') +
          group.i.map(function (item, ii) {
            var id = 'sunnah:' + gi + ':' + ii;
            var done = !!record.sunnah[id];
            return '<button class="check' + (done ? ' is-done' : '') + '" data-check="' + esc(id) + '" role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '">' +
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
    { nav: 'azkar', icon: 'hands', name: 'الأذكار', note: 'الأذكار اليومية وحصن المسلم كاملاً' },
    { nav: 'khatma', icon: 'target', name: 'خطة الختمة', note: 'وزّع المصحف على أيامك' },
    { nav: 'radio', icon: 'radio', name: 'الإذاعة', note: 'بث مباشر ومؤقت إيقاف' },
    { nav: 'hadith', icon: 'text', name: 'من الأربعين النووية', note: 'عشرون حديثاً جامعاً' },
    { nav: 'dua', icon: 'hands', name: 'الأدعية', note: 'من الكتاب والسنة' },
    { nav: 'ruqyah', icon: 'shield', name: 'الرقية الشرعية', note: 'آيات وأدعية ثابتة' },
    { nav: 'timetable', icon: 'clock', name: 'جدول الشهر', note: 'مواقيت كل يوم في صفحة' },
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

  function renderTasbihAzkarCard() {
    var note = $('tasbih-azkar-note');
    if (!note || typeof AZKAR_DB === 'undefined') return;
    var key = azkarForNow();
    var def = AZKAR_DB[key];
    if (!def) return;
    var p = Store.azkarProgress(key, def.items.length);
    note.textContent = 'أذكار هذا الوقت: ' + def.title + '، ' + ar(p.done) + ' من ' + ar(def.items.length) + '، وحصن المسلم كاملاً';
  }

  function renderTasbih() {
    renderTasbihAzkarCard();
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
      $('tasbih-total').textContent = 'مجموع اليوم ' + tasbihat(Store.day().tasbih || 0);
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
        return '<button class="chip" data-sleep="' + m + '">' + minutesOf(m) + '</button>';
      }).join('') + '<button class="chip" data-sleep="0">إلغاء</button>';
    }
    renderSleepNote();
  }

  function renderSleepNote() {
    var note = $('sleep-note');
    if (!note) return;
    if (!state.sleepTimer) { note.textContent = 'المؤقت متوقف'; return; }
    var left = Math.max(0, Math.round((state.sleepEndsAt - Date.now()) / 60000));
    note.textContent = 'سيتوقف البث بعد ' + minutesOf(left);
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
    toast('سيتوقف البث بعد ' + minutesOf(minutes));
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
    host.innerHTML = DUAS.map(function (group, gi) {
      return '<h2 class="section-title">' + esc(group.cat) + '</h2>' +
        group.items.map(function (d, di) {
          return '<div class="card"><p class="naskh" style="font-size:1.02rem;line-height:2.1">' +
            esc(d.t) + '</p><div class="dhikr-foot"><p class="source">' + esc(d.r) + '</p>' +
            '<button class="dhikr-share" data-picture="dua:' + gi + ':' + di + '" aria-label="صورة للمشاركة">' + icon('share') + '</button></div></div>';
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

  var GREG_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

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
      $('cal-span').textContent = ar(from.getDate()) + ' ' + GREG_MONTHS[from.getMonth()] +
        ' إلى ' + ar(to.getDate()) + ' ' + GREG_MONTHS[to.getMonth()] + ' ' + ar(to.getFullYear());
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
      /* A screen reader would otherwise read 22 4 and nothing more, so every
         cell says the whole date and what falls on it. */
      var spoken = ar(day.d) + ' ' + Hijri.MONTHS[month.m - 1] + '، ' + Hijri.WEEKDAYS[day.weekday] +
        ' ' + ar(day.date.getDate()) + ' ' + GREG_MONTHS[day.date.getMonth()] +
        (mark ? '، ' + mark.name : '') + (isToday ? '، اليوم' : '');
      cells += '<button class="' + cls + '" data-day="' + day.d + '" aria-label="' + esc(spoken) + '"' +
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
      return '<div class="row" style="cursor:default"><span class="row-mark">' + icon(o.icon) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(o.name) + '</span>' +
        '<span class="row-note">' + (o.days === 0 ? 'اليوم' : 'بعد ' + daysOf(o.days)) +
        '، ' + ar(o.hijriYear) + ' هـ</span></span></div>';
    }).join('');
  }

  /* Turning a date one way or the other, with the app's own reckoning and the
     reader's own adjustment, so it agrees with the rest of the screen. */
  function fillConverter() {
    var hm = $('conv-hm');
    if (!hm || hm.options.length) return;
    fillSelect(hm, Hijri.MONTHS.map(function (name, i) { return { value: String(i + 1), label: name }; }), '');
    var today = new Date();
    if ($('conv-greg') && !$('conv-greg').value) {
      $('conv-greg').value = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    }
    var h = Hijri.toHijri(today, Store.get('hijriAdjust'));
    if ($('conv-hd') && !$('conv-hd').value) $('conv-hd').value = h.d;
    if ($('conv-hy') && !$('conv-hy').value) $('conv-hy').value = h.y;
    hm.value = String(h.m);
    convertGregorian();
    convertHijri();
  }

  function convertGregorian() {
    var out = $('conv-greg-out');
    var field = $('conv-greg');
    if (!out || !field) return;
    var parts = String(field.value || '').split('-');
    if (parts.length !== 3) { out.textContent = ''; return; }
    var date = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    if (isNaN(date.getTime())) { out.textContent = 'تاريخ غير صالح'; return; }
    var h = Hijri.toHijri(date, Store.get('hijriAdjust'));
    out.textContent = h.weekday + '، ' + Hijri.format(h);
  }

  function convertHijri() {
    var out = $('conv-hijri-out');
    if (!out || !$('conv-hd')) return;
    var d = +$('conv-hd').value, m = +$('conv-hm').value, y = +$('conv-hy').value;
    if (!d || !m || !y) { out.textContent = ''; return; }
    var length = Hijri.monthDays(y, m, Store.get('hijriAdjust')).length;
    if (length && d > length) {
      out.textContent = Hijri.MONTHS[m - 1] + ' ' + ar(y) + ' فيه ' + daysOf(length) + ' فقط';
      return;
    }
    var date = Hijri.toGregorian(y, m, d, Store.get('hijriAdjust'));
    if (!date) { out.textContent = 'تاريخ غير صالح'; return; }
    out.textContent = Hijri.WEEKDAYS[date.getDay()] + '، ' + ar(date.getDate()) + ' ' +
      GREG_MONTHS[date.getMonth()] + ' ' + ar(date.getFullYear());
  }

  function renderCalendar() {
    if (!$('cal-grid')) return;
    renderCalendarGrid();
    renderCalendarDay();
    renderCalendarUpcoming();
    fillConverter();
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

  /* ---------------- the month at a glance ---------------- */

  /* Which month of the gregorian calendar the table is showing, since prayer
     times are worked out for a date and a place, not for a lunar month. */
  var timetableMonth = null;

  function timetableAt() {
    if (timetableMonth) return timetableMonth;
    var now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  }

  var TABLE_KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

  function timetableRows() {
    var at = timetableAt();
    var adjust = Store.get('hijriAdjust');
    var last = new Date(at.y, at.m + 1, 0).getDate();
    var rows = [];
    for (var d = 1; d <= last; d++) {
      var date = new Date(at.y, at.m, d);
      rows.push({
        date: date,
        hijri: Hijri.toHijri(date, adjust),
        times: computeTimes(date),
        friday: isFriday(date)
      });
    }
    return rows;
  }

  function renderTimetable() {
    var table = $('tt-table');
    if (!table) return;
    var at = timetableAt();
    var rows = timetableRows();
    var today = new Date();

    if ($('tt-month')) $('tt-month').textContent = GREG_MONTHS[at.m] + ' ' + ar(at.y);
    if ($('tt-place')) {
      $('tt-place').textContent = place().n + '، تقويم ' + methodName(Store.get('method'));
    }
    if ($('tt-today')) {
      $('tt-today').hidden = (at.y === today.getFullYear() && at.m === today.getMonth());
    }

    /* Through ramadan the table carries the imsak, ten minutes before the
       fajr as the calendars print it, so a fasting reader has it in one place. */
    var ramadan = rows.some(function (r) { return r.hijri.m === 9; });
    var head = '<thead><tr><th>اليوم</th>' +
      (ramadan ? '<th>الإمساك</th>' : '') +
      TABLE_KEYS.map(function (k) { return '<th>' + esc(prayerName(k, rows[0].date)) + '</th>'; }).join('') +
      '</tr></thead>';

    /* A gregorian month straddles two hijri ones, so the name is written where
       it changes and the days between carry their number alone. Cutting the
       name to fit would break it mid word, and ربيع ا is not a month. */
    var lastMonth = null;
    var body = rows.map(function (row) {
      var isToday = sameDay(row.date, today);
      var showName = row.hijri.monthName !== lastMonth;
      lastMonth = row.hijri.monthName;
      return '<tr' + (isToday ? ' class="is-today"' : '') + (row.friday ? ' data-friday="1"' : '') + '>' +
        '<th scope="row"><span class="tt-day">' + ar(row.date.getDate()) + '</span>' +
        '<span class="tt-hijri">' + ar(row.hijri.d) +
        (showName ? ' ' + esc(row.hijri.monthName) : '') + '</span></th>' +
        (ramadan ? '<td>' + (row.hijri.m === 9 ? clockMarkup(row.times.fajr - 10) : '') + '</td>' : '') +
        TABLE_KEYS.map(function (k) {
          return '<td>' + clockMarkup(row.times[k]) + '</td>';
        }).join('') + '</tr>';
    }).join('');

    table.innerHTML = head + '<tbody>' + body + '</tbody>';

    var current = table.querySelector('tr.is-today');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'center' });
  }

  function stepTimetable(by) {
    var at = timetableAt();
    var next = new Date(at.y, at.m + by, 1);
    timetableMonth = { y: next.getFullYear(), m: next.getMonth() };
    renderTimetable();
  }

  /* Plain text, because a timetable is a thing people paste into a message to
     the family or pin up in the mosque. */
  function timetableText() {
    var at = timetableAt();
    var lines = ['مواقيت ' + GREG_MONTHS[at.m] + ' ' + ar(at.y) + ' لـ' + place().n,
      'حساب ' + methodName(Store.get('method')), ''];
    timetableRows().forEach(function (row) {
      lines.push(ar(row.date.getDate()) + '/' + ar(at.m + 1) + '  ' +
        TABLE_KEYS.map(function (k) { return clockText(row.times[k]); }).join('  '));
    });
    return lines.join('\n');
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

    fillSelect($('settings-salawat'), [
      { value: '0', label: 'بلا تذكير' },
      { value: '60', label: 'كل ساعة' },
      { value: '120', label: 'كل ساعتين' },
      { value: '180', label: 'كل ثلاث ساعات' },
      { value: '360', label: 'كل ست ساعات' }
    ], String(s.salawat || 0));
    fillVoiceListSoon();
    fillSelect($('settings-voice'), [
      { value: 'recording', label: 'صوت قارئ' },
      { value: 'tone', label: 'نغمة' },
      { value: 'speech', label: 'صوت الهاتف ينطقها' },
      { value: 'none', label: 'بلا صوت' }
    ], s.voice || 'recording');
    showDeviceVoiceRow();
    fillSelect($('settings-accent'),
      [{ value: 'auto', label: 'يتبع وقت الصلاة' }].concat(
        Object.keys(PALETTES).map(function (k) { return { value: k, label: PALETTES[k].name }; })),
      s.accent);
    fillSelect($('settings-pattern'),
      Object.keys(PATTERNS).map(function (k) { return { value: k, label: PATTERNS[k].name }; }),
      s.pattern);
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
      if (granted) {
        notify('سُنّتي', 'هكذا يصلك التنبيه عند دخول الوقت', 'welcome');
        scheduleForWorker();
      }
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
      toast('استُعيدت ' + entries(result.count));
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
    toast('حُذفت ' + entries(removed));
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
    timetable: renderTimetable,
    page: renderPage,
    hisn: renderHisnChapter,
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
    'goto-page': goToPage,
    'goto-juz': goToJuz,
    'goto-ayah': goToAyah,
    picture: function (ref) {
      var parts = ref.split(':');
      shareVerseCard(+parts[0], +parts[1]);
    },
    listen: function (ref) {
      var parts = ref.split(':');
      playVerse(+parts[0], +parts[1]);
    },
    recite: function (ref) {
      var parts = ref.split(':');
      closeSheet();
      openReader(+parts[0], +parts[1]);
      reciteFrom(+parts[0], +parts[1]);
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

    var picture = target.closest('[data-picture]');
    if (picture) {
      var ref = picture.getAttribute('data-picture').split(':');
      var index = +ref[1];
      if (ref[0] === 'dua') {
        var g = DUAS[+ref[1]], d = g && g.items[+ref[2]];
        if (d) shareTextCard(g.cat, d.t, 'dua-' + ref[1] + '-' + ref[2] + '.png', d.r || g.cat);
      } else if (ref[0] === 'hisn') {
        var chapter = null;
        HISN.forEach(function (c) { if (c.id === state.hisn) chapter = c; });
        if (chapter && chapter.i[index]) {
          shareTextCard(chapter.t, chapter.i[index].t, 'dhikr-' + chapter.id + '-' + index + '.png',
            'حصن المسلم، الباب ' + ar(chapter.id) + (chapter.i[index].r > 1 ? '، ' + count(chapter.i[index].r, 'مرة واحدة', 'مرتان', 'مرات', 'مرة') : ''));
        }
      } else {
        var def = AZKAR_DB[state.azkarKey || 'morning'];
        if (def && def.items[index]) {
          var it = def.items[index];
          shareTextCard(def.title, it.t, 'dhikr-' + (state.azkarKey || 'morning') + '-' + index + '.png',
            (it.r ? it.r + '، ' : '') + 'حصن المسلم' + (it.c > 1 ? '، ' + count(it.c, 'مرة واحدة', 'مرتان', 'مرات', 'مرة') : ''));
        }
      }
      return;
    }

    var dhikr = target.closest('[data-dhikr]');
    if (dhikr) { countDhikr(+dhikr.getAttribute('data-dhikr'), dhikr.getAttribute('data-kind') === 'hisn'); return; }

    var scope = target.closest('[data-scope]');
    if (scope) { state.scope = scope.getAttribute('data-scope'); renderSearch(); return; }

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

    var chapter = target.closest('[data-hisn]');
    if (chapter) { state.hisn = +chapter.getAttribute('data-hisn'); go('hisn'); return; }

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

    bind('hisn-filter', 'input', renderHisn);
    bind('hisn-reset', 'click', function () {
      Store.resetHisn(state.hisn);
      renderHisnChapter();
      toast('أُعيدت عدّادات هذا الباب');
    });

    bind('page-prev', 'click', function () { turnPage(1 * -1); });
    bind('page-next', 'click', function () { turnPage(1); });
    bind('page-random', 'click', function () { openPage(1 + Math.floor(Math.random() * PAGES_IN_MUSHAF)); });
    bind('page-jump', 'click', openGoTo);
    (function () {
      var startX = null, startY = null;
      var body = $('page-body');
      if (!body) return;
      body.addEventListener('touchstart', function (e) {
        var t = e.touches && e.touches[0];
        if (t) { startX = t.clientX; startY = t.clientY; }
      }, { passive: true });
      body.addEventListener('touchend', function (e) {
        var t = e.changedTouches && e.changedTouches[0];
        if (!t || startX === null) return;
        var dx = t.clientX - startX, dy = t.clientY - startY;
        startX = startY = null;
        if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
        /* the page reads from the right, so a swipe to the right turns back */
        turnPage(dx > 0 ? -1 : 1);
      }, { passive: true });
    })();
    bind('quran-goto', 'click', openGoTo);

    bind('tt-prev', 'click', function () { stepTimetable(-1); });
    bind('tt-next', 'click', function () { stepTimetable(1); });
    bind('tt-today', 'click', function () { timetableMonth = null; renderTimetable(); });
    bind('tt-copy', 'click', function () {
      copyText(timetableText()).then(
        function () { toast('نُسخ جدول الشهر'); },
        function () { toast('تعذّر النسخ'); });
    });

    bind('hijri-reset', 'click', function () {
      Store.set('hijriAdjust', 0);
      renderDate(); renderHome();
      if (state.view === 'calendar') renderCalendar();
      toast('عاد التاريخ إلى حساب أم القرى');
    });

    bind('conv-greg', 'change', convertGregorian);
    bind('conv-greg', 'input', convertGregorian);
    ['conv-hd', 'conv-hm', 'conv-hy'].forEach(function (id) {
      bind(id, 'change', convertHijri);
      bind(id, 'input', convertHijri);
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
      applyAccent(currentWindowKey());
    });
    /* The clock runs slow in the background, so the moment the app is back in
       front the check runs and anything that fell due is raised. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });

    bind('settings-salawat', 'change', function (e) {
      Store.set('salawat', +e.target.value);
      if (+e.target.value && window.Notification && window.Notification.permission !== 'granted') {
        window.Notification.requestPermission().then(function (r) {
          toast(r === 'granted' ? 'سيصلك تذكير بالصلاة على النبي ﷺ' : 'لم يُسمح بالإشعارات');
        });
      } else if (+e.target.value) {
        toast('سيصلك تذكير بالصلاة على النبي ﷺ');
      }
      scheduleForWorker();
    });
    bind('settings-voice', 'change', function (e) {
      Store.set('voice', e.target.value);
      stopSpeaking();
      showDeviceVoiceRow();
      if (e.target.value !== 'none') speak('اللهم صلِّ وسلِّم على نبينا محمد', 'try');
    });
    bind('settings-voice-name', 'change', function (e) {
      Store.set('voiceName', e.target.value);
      Store.set('voice', 'speech');
      if ($('settings-voice')) $('settings-voice').value = 'speech';
      stopSpeaking();
      speak('اللهم صلِّ وسلِّم على نبينا محمد', 'try');
    });
    bind('settings-voice-try', 'click', function () {
      if (isSpeaking()) { stopSpeaking(); return; }
      if ((Store.get('voice') || 'recording') === 'none') {
        Store.set('voice', 'recording');
        if ($('settings-voice')) $('settings-voice').value = 'recording';
        showDeviceVoiceRow();
      }
      speak('اللهم صلِّ وسلِّم على نبينا محمد', 'try');
    });
    if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener('voiceschanged', fillVoiceList);
    }
    bind('settings-accent', 'change', function (e) {
      Store.set('accent', e.target.value);
      applyAccent(currentWindowKey());
    });
    bind('settings-pattern', 'change', function (e) {
      Store.set('pattern', e.target.value);
      patternStamp = '';
      applyPattern();
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

    bind('player-stop', 'click', stopRecite);
    bind('player-prev', 'click', function () { stepRecite(-1); });
    bind('player-next', 'click', function () { stepRecite(1); });
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
      toast('ثُبّت سُنّتي، وتجده الآن مع تطبيقاتك');
    });
  }

  function install() {
    var offer = state.installOffer;
    if (!offer) { toast('من قائمة المتصفح اختر: إضافة إلى الشاشة الرئيسية'); return; }
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
      tabOwner: tabOwner, prayerName: prayerName, nameForPlace: nameForPlace, coordsLabel: coordsLabel, count: count,
      applyAccent: applyAccent, palettes: PALETTES,
      notify: notify, maybeSalawat: maybeSalawat, maybeNotify: maybeNotify, scheduleForWorker: scheduleForWorker, speak: speak, chime: chime, stopSpeaking: stopSpeaking, isSpeaking: isSpeaking,
      verseCard: verseCard, textCard: textCard, openPage: openPage, methodName: methodName, computeTimes: computeTimes,
      maybeAskPlace: maybeAskPlace, pickVoice: pickVoice, arabicVoices: arabicVoices, azkarForNow: azkarForNow, windowSunnah: windowSunnah, withLam: withLam,
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
