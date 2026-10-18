/* ============================================================
   سُنّتي  ·  app controller
   Routing, the prayer clock, the reader, the trackers and the
   settings. No framework and no build step, so the file that
   ships is the file that runs.
   ============================================================ */
(function (window, document) {
  'use strict';

  var VERSION = '8.87.89';
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
  /* A day in the sharia begins at maghrib, not at midnight. So the sunan of
     friday are due from the maghrib of thursday and are done by the fajr of
     friday: someone reading them at eleven on thursday night is in ليلة
     الجمعة, and the app used to answer that it was still thursday because the
     calendar said so.
     A date handed in is still read as the calendar day it is, since it came
     from a calendar and a stored record should not shift by three hours. */
  function isFriday(date) {
    if (date) return date.getDay() === 5;
    var now = new Date();
    if (now.getDay() === 5) return true;
    if (now.getDay() !== 4) return false;
    var t = computeTimes(now);
    if (typeof t.maghrib !== 'number') return false;
    return (now.getHours() * 60 + now.getMinutes()) >= t.maghrib;
  }

  function prayerName(key, date) {
    if (key === 'dhuhr' && isFriday(date)) return 'الجمعة';
    for (var i = 0; i < PRAYERS.length; i++) if (PRAYERS[i].key === key) return PRAYERS[i].ar;
    return key;
  }

  /* Which slice of the day we are in decides the accent colour. */
  var WINDOWS = ['fajr', 'duha', 'dhuhr', 'asr', 'maghrib', 'isha'];

  var TABS = ['home', 'quran', 'tasbih', 'tracker', 'more'];

  var OWNED_BY = {
    reader: 'quran', search: 'quran', bookmarks: 'quran', khatma: 'quran', page: 'quran', prayers: 'tracker',
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
    /* none until a page is turned to: the page view opens where it was left */
    page: null,
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

  /* What the reader meets off the page, a notification, a spoken line, a
     picture or words handed to another app, in the language they read the
     app in. The page itself is put into it by i18n.js as it is drawn. */
  function tongue(text) {
    return window.I18n && typeof window.I18n.tx === 'function' ? window.I18n.tx(text) : text;
  }

  /* The Quran, the hadith, the supplications and the tafsir are said as they
     were said: marked as Arabic and never translated, by i18n.js or by a
     browser's own translator. The faces alone do not say it, since the naskh
     sets the app's own words too here and there. */
  var SAID = ' translate="no" lang="ar" dir="rtl"';

  function icon(name, cls) {
    /* The sprite is drawn in a twenty four unit square. Without saying so, the
       browser shows only the top left corner of it at whatever size the icon
       is given, which crops every glyph in the app. */
    /* the name travels as a class too: :has() is not on every android browser,
       and a rule that needs it silently does nothing there, which is why the
       play triangle stayed hollow on the reader's phone */
    return '<svg class="icon ic-' + name + (cls ? ' ' + cls : '') +
      '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Arabic counts one, two, a few and many differently, so 3 يوماً reads as a
     mistake where 3 أيام is right. The last argument says the count stands
     after a preposition or as an object, where the dual is يومين and not
     يومان: «بعد يومان» was on the home screen twice a week. */
  function daysOf(n, oblique) { return count(n, 'يوم واحد', 'يومان', 'أيام', 'يوماً', oblique); }
  function ayat(n, oblique) { return count(n, 'آية واحدة', 'آيتان', 'آيات', 'آية', oblique); }
  function pages(n, oblique) { return count(n, 'صفحة واحدة', 'صفحتان', 'صفحات', 'صفحة', oblique); }
  function minutesOf(n, oblique) { return count(n, 'دقيقة واحدة', 'دقيقتان', 'دقائق', 'دقيقة', oblique); }
  function entries(n, oblique) { return count(n, 'مدخلة واحدة', 'مدخلتان', 'مدخلات', 'مدخلة', oblique); }
  function tasbihat(n, oblique) { return count(n, 'تسبيحة واحدة', 'تسبيحتان', 'تسبيحات', 'تسبيحة', oblique); }
  function rounds(n, oblique) { return count(n, 'جولة واحدة', 'جولتان', 'جولات', 'جولة', oblique); }

  /* The four forms arabic counts by: one, two, three to ten, and above. Past
     a hundred the last two figures decide, so 503 آيات and 286 آية, and a
     round hundred takes its noun without the tanween, 200 يوم. */
  function count(n, one, two, few, many, oblique) {
    if (n === 1) return one;
    if (n === 2) return oblique ? two.replace(/ان$/, 'ين') : two;
    var tail = n % 100;
    if ((n >= 3 && n <= 10) || (n > 100 && tail >= 3 && tail <= 10)) return ar(n) + ' ' + few;
    if (n >= 100 && tail <= 2) return ar(n) + ' ' + many.replace(/اً$/, '');
    return ar(n) + ' ' + many;
  }

  /* Days in a row, with the word agreeing with the count: يومان متتابعان,
     3 أيام متتابعة, 11 يوماً متتابعاً, and a single day is just a day. */
  function inARow(n) {
    if (n === 1) return 'يوم واحد';
    if (n === 2) return 'يومان متتابعان';
    var tail = n % 100;
    if ((n >= 3 && n <= 10) || (n > 100 && tail >= 3 && tail <= 10)) return ar(n) + ' أيام متتابعة';
    return ar(n) + ' يوماً متتابعاً';
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

  /* the reader chooses whether the hours run to twelve or to twenty four */
  function clockText(minutes) {
    /* a time the sun never reaches, an isha far north in summer with no rule
       chosen for it, is dashes alone: the ص after them made it a morning time */
    if (!isFinite(minutes)) return '--:--';
    return ar(PrayerEngine.format(minutes, Store.get('clock') === '24' ? '24' : null));
  }

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

  /* A sheet takes a step of its own in the history, as the sky and the
     walkthrough do, so the back button of a phone closes the sheet and goes
     nowhere else. Without it the back button closed the sheet and took the
     screen's own step as well: the address named the screen before while
     this one stayed, the next back skipped a screen, and a reload opened the
     wrong one. */
  var sheetStep = { pushed: false, spent: false, skipPop: false };

  function openSheet(title, html) {
    var sheet = $('sheet');
    if (!sheet) return;
    stopVideo();
    /* a sheet the app raises on its own, at a night of jumuah or after a
       prayer, is not left hidden under the sky */
    if (skyview.open) closeSkyview();
    var fresh = !sheet.classList.contains('is-open');
    $('sheet-title').textContent = title;
    $('sheet-body').innerHTML = html;
    sheet.classList.add('is-open');
    if (!fresh || sheetStep.pushed) return;
    /* shut and opened again in one breath: the step already taken serves */
    if (sheetStep.spent) { sheetStep.spent = false; sheetStep.pushed = true; return; }
    try {
      if (window.history && window.history.pushState) {
        window.history.pushState({ view: state.view, sheet: true }, '');
        sheetStep.pushed = true;
      }
    } catch (e) { /* file:// refuses */ }
  }

  /* popped: the back button has already taken the sheet's step */
  function closeSheet(popped) {
    var sheet = $('sheet');
    if (sheet) sheet.classList.remove('is-open');
    stopVideo();
    if (!sheetStep.pushed) return;
    sheetStep.pushed = false;
    if (popped === true) return;
    /* The step is handed back once this turn is over, unless the screen moves
       on in the meantime: go() then writes the new address over it, and the
       back button returns to the screen the sheet was over. Handed back at
       once, it raced the new address and took it instead. */
    sheetStep.spent = true;
    window.setTimeout(function () {
      if (!sheetStep.spent) return;
      sheetStep.spent = false;
      /* someone else's step stands on it, the walkthrough's: it is left */
      if (!(window.history.state && window.history.state.sheet)) return;
      sheetStep.skipPop = true;
      try { window.history.back(); } catch (e) { sheetStep.skipPop = false; }
    }, 0);
  }

  /* What cannot be taken back is asked about first: the sheet says what goes,
     and the button that does it is the red one. */
  function confirmSheet(title, note, label, act) {
    openSheet(title,
      '<p class="setting-note">' + esc(note) + '</p>' +
      '<button class="btn btn-danger btn-block" data-act="' + esc(act) + '" style="margin-top:14px">' + esc(label) + '</button>' +
      '<button class="btn btn-ghost btn-block" data-act="sheet-cancel" style="margin-top:8px">تراجع</button>');
  }

  /* The grip says the sheet can be pulled down, so from the grip or the title
     the sheet follows the finger with the veil behind it lightening as it
     goes, and let go past a quarter of its height or flicked down it leaves
     the screen while short of that it settles back, but upward it does not
     move and a button in the title is still only a button. */
  function bindSheetDrag() {
    var sheet = $('sheet');
    var panel = sheet ? sheet.querySelector('.sheet-panel') : null;
    if (!panel) return;
    var EASE = 'cubic-bezier(.32, .72, 0, 1)';
    var drag = null;
    var swallowUntil = 0;
    /* the moment of a touch is the event's own, which runs on whatever the
       page's clock is set to */
    function when(e) { return e.timeStamp || Date.now(); }
    function pull(dy) {
      panel.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
      var left = 1 - Math.min(1, dy / Math.max(1, panel.offsetHeight));
      sheet.style.backgroundColor = dy ? 'rgba(10, 16, 13, ' + (0.5 * left).toFixed(3) + ')' : '';
    }
    panel.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (!t || !t.closest || t.closest('button')) return;
      if (!t.closest('.sheet-grip, .sheet-panel > .card-head')) return;
      drag = { y: e.clientY, dy: 0, at: when(e), v: 0, id: e.pointerId, moved: false };
    });
    panel.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = Math.max(0, e.clientY - drag.y);
      var now = when(e);
      if (!drag.moved) {
        if (dy < 4) return;
        drag.moved = true;
        try { panel.setPointerCapture(drag.id); } catch (err) { /* the move is still heard on the panel */ }
        panel.style.transition = 'none';
        sheet.style.transition = 'none';
      }
      drag.v = (dy - drag.dy) / Math.max(1, now - drag.at);
      drag.dy = dy;
      drag.at = now;
      pull(dy);
    });
    function release(e) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (!d.moved) return;
      swallowUntil = when(e) + 350;
      /* a flick is a finger still moving when it lifts, not one that came to
         rest first */
      var speed = when(e) - d.at > 80 ? 0 : d.v;
      var gone = e.type !== 'pointercancel' && (d.dy > panel.offsetHeight * 0.25 || speed > 0.11);
      panel.style.transition = 'transform .24s ' + EASE;
      sheet.style.transition = 'background-color .24s ' + EASE;
      if (gone) {
        panel.style.transform = 'translateY(100%)';
        sheet.style.backgroundColor = 'rgba(10, 16, 13, 0)';
      } else {
        pull(0);
      }
      window.setTimeout(function () {
        if (gone) closeSheet();
        panel.style.transition = '';
        sheet.style.transition = '';
        pull(0);
      }, 240);
    }
    panel.addEventListener('pointerup', release);
    panel.addEventListener('pointercancel', release);
    /* the press that ended a pull is not also a tap on what lay under it */
    panel.addEventListener('click', function (e) {
      if (when(e) < swallowUntil) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }


  /* an empty screen may carry the mark of what would fill it, over its words */
  function empty(message, actionLabel, actionNav, glyph) {
    var button = actionLabel
      ? '<button class="btn btn-primary" data-go="' + esc(actionNav) + '" style="margin-top:12px">' + esc(actionLabel) + '</button>'
      : '';
    return '<div class="empty">' + (glyph ? icon(glyph) : '') + esc(message) + button + '</div>';
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

  /* ---------------- appearance ---------------- */

  function applyTheme() {
    patternStamp = '';
    var choice = Store.get('theme');
    var dark = choice === 'dark';
    if (choice === 'auto' && window.matchMedia) {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    /* The iPhone draws its clock and battery over the page, so it is told the
       theme and draws them light on the dark one, where they were black on
       black, and elsewhere there is no such handler and nothing is sent. */
    try { window.webkit.messageHandlers.sunnati.postMessage({ fn: 'setTheme', args: [dark ? 'dark' : 'light'] }); } catch (e) { /* not the iPhone app */ }
  }

  /* The reader's answer wins; with no answer the phone's own setting does.
     Someone who has already asked their phone for stronger contrast or less
     motion should not have to ask a second time here. */
  function prefers(query) {
    return !!(window.matchMedia && window.matchMedia(query).matches);
  }

  /* A scroll the script asks to be smooth is smooth whatever the stylesheet
     says: scroll-behavior in .less-motion governs the page, not a call that
     names its own behaviour. So the call asks first, and a reader who turned
     on Reduce Motion, here or on the phone, is moved without the slide. */
  function glide() {
    return document.documentElement.classList.contains('less-motion') ? 'auto' : 'smooth';
  }

  function applyAccess() {
    var root = document.documentElement;
    var contrast = Store.get('contrast');
    var motion = Store.get('lessMotion');
    root.classList.toggle('want-contrast',
      contrast === null || contrast === undefined ? prefers('(prefers-contrast: more)') : !!contrast);
    root.classList.toggle('less-motion',
      motion === null || motion === undefined ? prefers('(prefers-reduced-motion: reduce)') : !!motion);
  }

  /* ---------------- the book ----------------

     iPhone Duo opens like a book, and its fold then runs down the middle of
     an inner display some nine hundred and fifty points wide; an iPad on its
     side and a desktop window are as wide. Safari does not say where the fold
     is (the viewport segments api is Chromium's alone), so the page does not
     ask: on any screen this wide nothing is laid across the middle. The right
     half is the app as on a phone, the left half keeps the hour, and the
     mushaf opens on both halves with the fold for its spine.

     It wants height as well as width. A large phone turned on its side in a
     browser is as wide as the book and only some four hundred points tall,
     and there the hour and the two pages were cut off at top and bottom. A
     phone on its side stays a phone. */
  var BOOK = window.matchMedia
    ? window.matchMedia('(min-width: 860px) and (min-height: 520px) and (min-aspect-ratio: 6/5)') : null;

  function isBook() { return !!(BOOK && BOOK.matches); }

  function applyBook() {
    var root = document.documentElement;
    var was = root.classList.contains('book');
    root.classList.toggle('book', isBook());
    placeSide(isBook());
    if (was !== isBook() && state.view === 'page') renderPage();
  }

  /* The left half of the book is the day: the hour with the day's prayers,
     and under it the count of the day's sunnahs, the two standing together
     from the top of the half to the line the tabs end on, beside whichever
     screen the right half shows. The hour alone stood in the upper part of
     the half with nothing beneath it, and the half looked unfinished.

     They are moved, not drawn twice, so every number in them stays the one
     the home screen keeps up to date, and each is put back where it came
     from when the screen narrows again. */
  var SIDE = null;

  function placeSide(book) {
    var home = $('v-home');
    if (!SIDE) {
      if (!book || !home) return;
      SIDE = { box: document.createElement('aside'), items: [home.querySelector('.clock'), $('home-progress')], marks: [] };
      SIDE.box.className = 'book-side';
      SIDE.box.setAttribute('aria-label', 'اليوم');
      document.body.appendChild(SIDE.box);
    }
    if (book) {
      SIDE.items.forEach(function (el) {
        if (!el || el.parentNode === SIDE.box) return;
        var mark = document.createComment('book-side');
        el.parentNode.insertBefore(mark, el);
        SIDE.marks.push([mark, el]);
        SIDE.box.appendChild(el);
      });
    } else {
      SIDE.marks.forEach(function (m) {
        m[0].parentNode.insertBefore(m[1], m[0]);
        m[0].parentNode.removeChild(m[0]);
      });
      SIDE.marks = [];
    }
  }

  function applyFont() {
    var scale = Store.get('fontScale') / 100;
    document.documentElement.style.setProperty('--quran-scale', String(scale));
    if ($('font-value')) $('font-value').textContent = ar(Store.get('fontScale')) + '%';
    /* the spread takes the reader's size as a scale on the fitted page */
    refitSpread();
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
      fill = token(name, ACCENT_FALLBACK[windowKey] || '#9c2b2b');
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
    var colour = document.documentElement.style.getPropertyValue('--accent-ink').trim() || '#9c2b2b';
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

  function hexToWash(hex, alpha) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    var a = typeof alpha === 'number' ? alpha : 0.12;
    if (!m) return 'rgba(156,43,43,' + a + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
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
    /* a chapter of the book names itself too: a reload in دعاء الكرب used to
       open أذكار الصباح والمساء, the chapter the app starts on */
    if (name === 'hisn') return '#hisn/' + state.hisn;
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
    if (name === 'hisn' && parts[1]) {
      var chapter = parseInt(parts[1], 10);
      var known = typeof HISN !== 'undefined' && HISN.some(function (c) { return c.id === chapter; });
      return known ? { name: 'hisn', hisn: chapter } : { name: 'hisn' };
    }
    return $('v-' + name) ? { name: name } : null;
  }

  function go(name, silent) {
    /* the page walks only while the reader is on the screen that walks */
    if (state.autoScroll && name !== state.view) stopAutoScroll(true);
    /* the voice preview lives on the reminders screen now, so leaving
       either screen must silence it */
    if ((state.view === 'settings' || state.view === 'reminders') &&
        name !== 'settings' && name !== 'reminders') stopSpeaking();
    var target = $('v-' + name);
    if (!target) return;
    if (skyview.open) closeSkyview(true);
    $$('.view').forEach(function (v) { v.classList.remove('is-open'); });
    target.classList.add('is-open');
    state.view = name;
    /* the stylesheet lays the book out by what is open: the hour stays on the
       left half beside every screen but the mushaf, which takes both */
    document.documentElement.setAttribute('data-view', name);

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
    try {
      /* a sheet shut on the way here left its step behind, and the new screen
         is written over it, so back returns to the screen the sheet was over */
      if (sheetStep.spent && window.history.state && window.history.state.sheet) {
        sheetStep.spent = false;
        window.history.replaceState({ view: name }, '', next);
      } else {
        window.history.pushState({ view: name }, '', next);
      }
    } catch (e) { /* file:// refuses */ }
  }

  function followAddress() {
    var route = readAddress(window.location.hash);
    if (!route) { go('home', true); return; }
    if (route.surah) state.surah = route.surah;
    if (route.azkar && AZKAR_DB[route.azkar]) state.azkarKey = route.azkar;
    if (route.hisn) state.hisn = route.hisn;
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
    handTimesToApp();
    handQiyamToApp();
    handRemindersToApp();
    /* the adhan's sound too, so a wrapper hears the reader's voice at every
       opening and not only once the settings are visited */
    handAdhanSoundToApp();
    /* the times are worked out from the place, so this is where the place is
       settled and the right moment to hand it over for the next opening */
    tellPlace();
    tellSun(state.times);
    return state.times;
  }

  /* The opening screen paints its night or its day before any of this has
     run, so the place's own fajr and maghrib are left where boot.js can read
     them, with the day they belong to: boot.js trusts them only on that day
     and keeps to the clock on any other. */
  function tellSun(times) {
    var t = times || computeTimes(new Date());
    if (!t || typeof t.fajr !== 'number' || typeof t.maghrib !== 'number' ||
        !isFinite(t.fajr) || !isFinite(t.maghrib)) return false;
    try {
      window.localStorage.setItem('sunnati.sun', JSON.stringify({
        d: Store.dayKey(), f: Math.round(t.fajr), m: Math.round(t.maghrib)
      }));
      return true;
    } catch (e) { return false; }
  }

  /* boot.js picks the painting by the zone the reader set, else the phone's
     own, and this is the same table so the paintings warmed are the ones the
     next opening asks for. */
  var SPLASH_LANDS = { 'Asia/Kuwait': 'kw', 'Asia/Riyadh': 'sa', 'Asia/Dubai': 'ae', 'Asia/Qatar': 'qa',
    'Asia/Bahrain': 'bh', 'Asia/Muscat': 'om' };

  function splashLand() {
    var zone = Store.get('zone');
    if (typeof zone !== 'string' || !zone) {
      try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { zone = ''; }
    }
    return Object.prototype.hasOwnProperty.call(SPLASH_LANDS, zone) ? SPLASH_LANDS[zone] : 'default';
  }

  /* Only the two plain paintings come with the app; a country's own pair is
     fetched once the app is up, so the worker has it for the next opening
     and the sky does not wait on the network then. The worker keeps only
     what passes through it, so on a first visit, before it has taken the
     page, the pair waits until it has. */
  function warmSplash() {
    var sw = window.navigator && window.navigator.serviceWorker;
    if (sw && !sw.controller && sw.addEventListener) {
      var once = function () { sw.removeEventListener('controllerchange', once); warmSplash(); };
      sw.addEventListener('controllerchange', once);
      return [];
    }
    var land = splashLand();
    return ['day', 'night'].map(function (half) {
      var src = 'img/splash/' + land + '-' + half + '.webp';
      try { var img = new window.Image(); img.decoding = 'async'; img.src = src; } catch (e) { /* no pictures here */ }
      return src;
    });
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

  /* Takes a fix and makes it the place. Returns whether the place moved. */
  function adoptFix(pos) {
    var tz = -new Date().getTimezoneOffset() / 60;
    var zone = null;
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { zone = null; }
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    var near = nameForPlace(lat, lng);
    var before = place();
    var moved = !before || before.n !== (near ? near.n : coordsLabel(lat, lng));
    var next = {
      n: near ? near.n : coordsLabel(lat, lng),
      lat: lat, lng: lng, tz: tz, z: (near && near.z) || zone
    };
    /* The reckoning follows the place: every listed city carries the method
       its own authority uses, and a fix that named the city without taking
       its method left five capitals on the Ojeiri table, which is Kuwait's.
       Far from any listed city the Muslim World League serves, since it is
       written for nowhere in particular. And the method is set only when the
       place has moved, so a reader who chose a different method by hand for
       where they are is not put back every morning. */
    /* Whether the place moved is not the question; whether the method was the
       reader's own choice is. It was, and a reader who had located with the
       older code, which left the method on Kuwait's table, kept that table for
       as long as they stayed in their city, since the place had not moved. So
       the method remembers where it came from: only one set by hand is kept. */
    if (Store.get('methodFrom') !== 'hand') {
      next.method = near ? near.method : 'MWL';
      Store.set('methodFrom', 'fix');
    }
    setPlace(next, true);
    Store.set('placeFrom', 'fix');
    return moved;
  }

  function locate(then) {
    if (!window.navigator || !window.navigator.geolocation) {
      toast('تعذّر تحديد موقعك، فاختر مدينة من القائمة');
      return;
    }
    toast('جاري تحديد موقعك');
    window.navigator.geolocation.getCurrentPosition(function (pos) {
      adoptFix(pos);
      toast('ضُبطت المواقيت على ' + place().n);
      if (typeof then === 'function') then();
    }, function () {
      toast('تعذّر تحديد الموقع، فاختر مدينة من القائمة');
    }, { enableHighAccuracy: true, timeout: 9000 });
  }

  /* The same, at boot, without a word unless there is news. A fix the phone
     already has is taken rather than waited for, and a phone that says no is
     not asked to explain. A city the reader picked by hand is left alone. */
  function locateQuietly(then) {
    var done = function (ok) { if (typeof then === 'function') then(ok); };
    if (Store.get('placeFrom') === 'pick') return done(true);
    if (!window.navigator || !window.navigator.geolocation) return done(false);
    window.navigator.geolocation.getCurrentPosition(function (pos) {
      var moved = adoptFix(pos);
      if (moved) toast('ضُبطت المواقيت على ' + place().n);
      done(true);
    }, function () {
      done(false);
    }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 8000 });
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
    /* the marks are this day's prayers, so they are named for this day: named
       for the night of jumuah, a thursday evening called its own noon الجمعة */
    var day = date || new Date();
    var marks = PRAYERS.map(function (p) {
      return { key: p.key, ar: prayerName(p.key, day), at: t[p.key] };
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

  /* ---------------- the sky of the hour ---------------- */

  /* Eight paintings of one shore of the Gulf, the same horizon, minaret and
     palms in each, lit as the day lights them. The niche shows the one the
     sky is in now and passes from each to the next on the place's own times:
     the dawn comes in on this town's fajr and the glow fades with its maghrib,
     so the window turns with the real sun and not with the clock. The light
     falls from the left in the morning and from the right in the evening, as
     it does through a window that faces the qibla from the Gulf. */
  var SKY_DARK = { night: 1, dusk: .8, fajr: .55, sunset: .15, sunrise: .05, morning: 0, noon: 0, afternoon: 0 };

  function skyStops(t) {
    var ok = function (v) { return typeof v === 'number' && isFinite(v); };
    if (!t || !ok(t.sunrise) || !ok(t.dhuhr) || !ok(t.maghrib)) return null;
    var f = ok(t.fajr) ? t.fajr : t.sunrise - 80;
    var i = ok(t.isha) ? t.isha : t.maghrib + 80;
    var a = ok(t.asr) ? t.asr : (t.dhuhr + t.maghrib) / 2;
    var list = [
      [f - 10, 'night'],
      [f + (t.sunrise - f) * .5, 'fajr'],
      [t.sunrise + 12, 'sunrise'],
      [t.sunrise + (t.dhuhr - t.sunrise) * .45, 'morning'],
      [t.dhuhr - 25, 'noon'],
      [t.dhuhr + 30, 'noon'],
      [a + (t.maghrib - a) * .55, 'afternoon'],
      [t.maghrib + 6, 'sunset'],
      [t.maghrib + (i - t.maghrib) * .55, 'dusk'],
      [i + 20, 'night']
    ];
    /* a summer far north squeezes the day until two turns meet; each is kept
       a minute past the one before so the blend never runs backwards */
    for (var k = 1; k < list.length; k++) if (list[k][0] <= list[k - 1][0]) list[k][0] = list[k - 1][0] + 1;
    return list;
  }

  /* The two paintings the sky is between at a minute of the day, and how far
     it has gone from the first to the second. */
  function skyAt(t, minute) {
    var stops = skyStops(t);
    if (!stops) return { a: 'noon', b: 'noon', mix: 0 };
    if (minute <= stops[0][0]) return { a: 'night', b: 'night', mix: 0 };
    for (var k = 1; k < stops.length; k++) {
      if (minute <= stops[k][0]) {
        var from = stops[k - 1], to = stops[k];
        var x = (minute - from[0]) / (to[0] - from[0]);
        /* eased, so a change of light starts and settles gently */
        return { a: from[1], b: to[1], mix: x * x * (3 - 2 * x) };
      }
    }
    return { a: 'night', b: 'night', mix: 0 };
  }

  /* The moon as it stands tonight. Its age is counted on the mean month from
     a new moon known to the minute, which is right to within hours; how much
     of it is lit follows from the age, and since it rises about fifty minutes
     later each day it is up from its rising to its setting on that lag behind
     the sun. So the white days show it full the night through, and the first
     nights of a month show a thin crescent low in the west after maghrib. */
  var NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
  var SYNODIC = 29.530588853;

  function moonAt(when, t) {
    var age = ((when.getTime() - NEW_MOON) / 86400000) % SYNODIC;
    if (age < 0) age += SYNODIC;
    var out = { age: age, lit: (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2, waxing: age < SYNODIC / 2, up: false, along: 0 };
    if (!t || typeof t.sunrise !== 'number' || typeof t.maghrib !== 'number') return out;
    var lag = age / SYNODIC * 1440;
    var rise = (t.sunrise + lag) % 1440;
    var span = ((t.maghrib + lag) % 1440 - rise + 1440) % 1440;
    var since = (nowMinutes(when) - rise + 1440) % 1440;
    out.up = since <= span;
    out.along = span ? since / span : 0;
    return out;
  }

  /* The lit part of a disc: the bright limb on one side, and on the other the
     line between light and dark, half an ellipse that bows out for a crescent
     and in for a moon past its half. */
  function moonPath(lit, waxing, r) {
    var rx = Math.abs(1 - 2 * lit) * r;
    var crescent = lit < .5;
    var limb = waxing ? 1 : 0;
    var edge = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
    return 'M0 ' + (-r) + 'A' + r + ' ' + r + ' 0 0 ' + limb + ' 0 ' + r +
      'A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + edge + ' 0 ' + (-r) + 'Z';
  }

  var skyShown = '';

  function skyOn() { return Store.get('sky') !== false; }

  /* What the hour adds over its painting: the colour and weight of the
     clouds drifting across it, the glow on the horizon and the side it rises
     on, the lantern of the minaret, and how dark it is for the stars. */
  var SKY_CLOUD = {
    night: ['#93a3c9', .12], fajr: ['#d8def4', .3], sunrise: ['#ffd9c6', .5], morning: ['#ffffff', .55],
    noon: ['#ffffff', .4], afternoon: ['#ffe6b5', .5], sunset: ['#ffb08d', .55], dusk: ['#b8a3d8', .28]
  };
  var SKY_GLOW = { fajr: ['#cfd8ff', .35, -1], sunrise: ['#ffc9a0', .55, -1], sunset: ['#ff9a6b', .6, 1], dusk: ['#ff8a70', .32, 1] };
  var SKY_LANTERN = { night: 1, dusk: .9, fajr: .6, sunset: .25 };

  function mixHex(c1, c2, t) {
    var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    var r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
    var g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
    var u = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + u).toString(16).slice(1);
  }

  function skyLook(sky) {
    var m = sky.mix;
    var ca = SKY_CLOUD[sky.a], cb = SKY_CLOUD[sky.b];
    var ga = SKY_GLOW[sky.a], gb = SKY_GLOW[sky.b];
    var glowA = ga ? ga[1] * (1 - m) : 0, glowB = gb ? gb[1] * m : 0;
    return {
      dark: SKY_DARK[sky.a] * (1 - m) + SKY_DARK[sky.b] * m,
      cloud: mixHex(ca[0], cb[0], m),
      clouds: ca[1] * (1 - m) + cb[1] * m,
      glowColour: mixHex((ga || gb || ['#ffffff'])[0], (gb || ga || ['#ffffff'])[0], m),
      glow: glowA + glowB,
      glowSide: glowA >= glowB ? (ga ? ga[2] : 1) : gb[2],
      lantern: (SKY_LANTERN[sky.a] || 0) * (1 - m) + (SKY_LANTERN[sky.b] || 0) * m
    };
  }

  /* the colour of the clouds and the glow is held in their gradients, which
     the niche and the whole screen share by class */
  function tintSky(look) {
    $$('.cloud-stop').forEach(function (stop) { stop.setAttribute('stop-color', look.cloud); });
    $$('.glow-stop').forEach(function (stop) { stop.setAttribute('stop-color', look.glowColour); });
  }

  function renderSky(force) {
    var root = document.documentElement;
    if (!skyOn() || !$('sky')) {
      root.classList.remove('has-sky'); skyShown = '';
      if ($('arc-wrap')) $('arc-wrap').removeAttribute('tabindex');
      return;
    }
    var t = state.times || refreshTimes();
    var now = new Date();
    var minute = nowMinutes(now);
    /* drawn again when the minute or the day's times move, not every second */
    var stamp = Math.floor(minute) + '|' + (t && t.fajr) + '|' + (t && t.maghrib);
    if (!force && stamp === skyShown) return;
    skyShown = stamp;
    root.classList.add('has-sky');
    if ($('arc-wrap')) {
      $('arc-wrap').setAttribute('tabindex', '0');
      $('arc-wrap').setAttribute('title', 'المس لترى السماء على الشاشة كلها');
    }
    var sky = skyAt(t, minute);
    var look = skyLook(sky);
    var a = $('sky-a'), b = $('sky-b');
    var hrefA = 'img/sky/' + sky.a + '.webp', hrefB = 'img/sky/' + sky.b + '.webp';
    if (a.getAttribute('href') !== hrefA) a.setAttribute('href', hrefA);
    if (b.getAttribute('href') !== hrefB) b.setAttribute('href', hrefB);
    b.setAttribute('opacity', sky.mix.toFixed(3));
    tintSky(look);
    $('sky-clouds').setAttribute('opacity', look.clouds.toFixed(3));
    $('sky-glow').setAttribute('opacity', look.glow.toFixed(3));
    $('sky-glow-shape').setAttribute('cx', look.glowSide < 0 ? '30' : '210');
    $('sky-lantern').setAttribute('opacity', look.lantern.toFixed(3));
    $('sky-stars').setAttribute('opacity', Math.max(0, (look.dark - .35) / .65).toFixed(3));
    var moon = moonAt(now, t);
    var shown = moon.up && moon.lit > .02 ? Math.max(0, Math.min(1, (look.dark - .3) / .5)) : 0;
    var g = $('sky-moon');
    g.setAttribute('opacity', shown.toFixed(3));
    if (shown) {
      /* from its rising on the left to its setting on the right, inside the
         arc of the countdown and above the shore */
      var angle = (126 - 72 * moon.along) * Math.PI / 180;
      var x = 120 + 80 * Math.cos(angle), y = 140 - 80 * Math.sin(angle);
      /* the lit side faces the sun under the horizon, on the side it set for an
         evening moon and the side it will rise for a morning one, so a young
         crescent lies tilted like a boat as it does over the Gulf */
      var sunX = moon.waxing ? 250 : -10;
      var turn = Math.atan2(110 - y, sunX - x) * 180 / Math.PI - (moon.waxing ? 0 : 180);
      g.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + turn.toFixed(1) + ')');
      $('moon-lit').setAttribute('d', moonPath(Math.max(moon.lit, .08), moon.waxing, 6));
    }
    if (skyview.open) renderSkyview(sky, look, moon, shown);
  }

  /* ---------------- the sky on the whole screen ---------------- */

  /* A touch on the niche opens its sky on the whole screen with the
     countdown over it: the painting moves slowly along the shore as an eye
     would, the clouds cross, the lantern trembles, and the screen is kept
     awake while it is open, so it can stand by the bed through the night or
     keep a moment of dhikr. A touch anywhere closes it. */
  var skyview = { open: false, lock: null, pan: null, starred: false, pushed: false, skipPop: false };
  /* the walkthrough: which step, whether it took a step in the history, and
     whether this phone had the app open before today's start */
  var tour = { open: false, at: 0, pushed: false, skipPop: false, returning: null, back: null, swap: 0 };

  function fillSkyviewStars() {
    if (skyview.starred || !$('sv-stars')) return;
    skyview.starred = true;
    var html = '';
    for (var k = 0; k < 70; k++) {
      var x = ((k * 0.6180339 + .05) % 1) * 1000;
      var y = 18 + ((k * 0.4142136 + .17) % 1) * 280;
      html += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (k % 6 ? 1.3 : 2.2) + '"/>';
    }
    $('sv-stars').innerHTML = html;
  }

  function panSkyview() {
    var scene = $('skyview-scene');
    if (!scene) return;
    if (skyview.pan) { try { skyview.pan.cancel(); } catch (e) { /* gone */ } skyview.pan = null; }
    var w = scene.getBoundingClientRect().width, vw = window.innerWidth;
    var room = Math.max(0, w - vw);
    /* it opens on the minaret, then drifts along the shore to the open sea */
    var from = -Math.min(room, Math.max(0, w * .746 - vw * .62));
    var to = -Math.min(room, Math.max(0, w * .2 - vw * .3));
    if (document.documentElement.classList.contains('less-motion') || !scene.animate || Math.abs(from - to) < 2) {
      scene.style.transform = 'translateX(' + from + 'px)';
      return;
    }
    scene.style.transform = '';
    skyview.pan = scene.animate([
      { transform: 'translateX(' + from + 'px)' },
      { transform: 'translateX(' + to + 'px)' }
    ], { duration: Math.max(60000, Math.abs(from - to) * 160), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  }

  function holdSkyAwake(on) {
    try {
      if (on && navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (lock) {
          if (!skyview.open) { lock.release(); return; }
          skyview.lock = lock;
          /* let go of by the phone itself when the app went behind another */
          if (lock.addEventListener) lock.addEventListener('release', function () { if (skyview.lock === lock) skyview.lock = null; });
        }).catch(function () { /* the device keeps its own rule */ });
      } else if (!on && skyview.lock) {
        skyview.lock.release();
        skyview.lock = null;
      }
    } catch (e) { /* no wake lock here */ }
  }

  function skyviewText() {
    if (!skyview.open) return;
    ['label', 'name', 'count'].forEach(function (part) {
      var from = $('arc-' + part), to = $('skyview-' + part);
      if (from && to && to.textContent !== from.textContent) to.textContent = from.textContent;
    });
    var where = place();
    var date = ($('hijri-date') ? $('hijri-date').textContent : '') + (where && where.n ? '، ' + where.n : '');
    if ($('skyview-date') && $('skyview-date').textContent !== date) $('skyview-date').textContent = date;
    /* and the day by the calendar of the phone under it, as the picture of the
       day's times carries both: a reader who keeps an appointment by the
       month of the year had to close the sky to learn the date */
    var greg = gregorianLine(new Date());
    if ($('skyview-greg') && $('skyview-greg').textContent !== greg) $('skyview-greg').textContent = greg;
  }

  function renderSkyview(sky, look, moon, shown) {
    var a = $('skyview-a'), b = $('skyview-b');
    if (!a || !b) return;
    var srcA = 'img/sky/' + sky.a + '.webp', srcB = 'img/sky/' + sky.b + '.webp';
    if (a.getAttribute('src') !== srcA) a.setAttribute('src', srcA);
    if (b.getAttribute('src') !== srcB) b.setAttribute('src', srcB);
    b.style.opacity = sky.mix.toFixed(3);
    $('sv-clouds').setAttribute('opacity', (look.clouds * 1.1).toFixed(3));
    $('sv-glow').setAttribute('opacity', look.glow.toFixed(3));
    $('sv-glow-shape').setAttribute('cx', look.glowSide < 0 ? '120' : '880');
    $('sv-lantern').setAttribute('opacity', look.lantern.toFixed(3));
    $('sv-stars').setAttribute('opacity', Math.max(0, (look.dark - .35) / .65).toFixed(3));
    var g = $('sv-moon');
    g.setAttribute('opacity', shown.toFixed(3));
    if (shown) {
      /* placed on the screen rather than on the painting: the horizon is
         where the painting puts it, a little below the middle */
      var vw = window.innerWidth, vh = window.innerHeight;
      var r = Math.max(10, Math.round(Math.min(vw, vh) * .036));
      $('skyview-far').setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
      var at = moonPlace(moon, vw * .06, vh * .1, vw * .88, vh * .7);
      $('sv-moon-disc').setAttribute('r', r);
      $('sv-moon-halo').setAttribute('r', r * 2.8);
      g.setAttribute('transform', 'translate(' + at.x.toFixed(1) + ' ' + at.y.toFixed(1) + ') rotate(' + (at.turn * 180 / Math.PI).toFixed(1) + ')');
      $('sv-moon-lit').setAttribute('d', moonPath(Math.max(moon.lit, .06), moon.waxing, r));
    }
    /* the night is shown dim, for a room where someone is sleeping, and the
       dimming comes on with the dark rather than at once at one minute */
    var dim = Math.max(0, Math.min(1, (look.dark - .55) / .35));
    $('skyview').style.filter = dim > 0 ? 'brightness(' + (1 - .18 * dim).toFixed(3) + ')' : '';
    skyviewText();
  }

  /* It opens as a step of its own in the history, so the back button of a
     phone closes the sky and leaves the reader on the screen they were on,
     and the keyboard is taken into it and handed back to the niche. */
  function openSkyview() {
    var view = $('skyview');
    if (!view || !skyOn() || skyview.open) return;
    skyview.open = true;
    fillSkyviewStars();
    view.hidden = false;
    renderSky(true);
    window.requestAnimationFrame(function () {
      /* closed again before the frame came: nothing to fade in */
      if (!skyview.open) return;
      view.classList.add('is-open');
      panSkyview();
    });
    holdSkyAwake(true);
    try {
      if (window.history && window.history.pushState) {
        window.history.pushState({ view: state.view, sky: true }, '');
        skyview.pushed = true;
      }
    } catch (e) { /* file:// refuses */ }
    try { view.focus({ preventScroll: true }); } catch (e) { /* not focusable here */ }
  }

  /* popped: the history has already stepped back, so it is not stepped
     back again */
  function closeSkyview(popped) {
    var view = $('skyview');
    if (!view || !skyview.open) return;
    skyview.open = false;
    view.classList.remove('is-open');
    holdSkyAwake(false);
    if (skyview.pan) { try { skyview.pan.cancel(); } catch (e) { /* gone */ } skyview.pan = null; }
    if (skyview.pushed) {
      skyview.pushed = false;
      if (popped !== true) {
        skyview.skipPop = true;
        try { window.history.back(); } catch (e) { skyview.skipPop = false; }
      }
    }
    if (view.contains(document.activeElement) && $('arc-wrap')) {
      try { $('arc-wrap').focus({ preventScroll: true }); } catch (e) { /* gone */ }
    }
    window.setTimeout(function () { if (!skyview.open) view.hidden = true; }, 700);
  }

  /* Where the moon stands in the arch at the head of a picture, rising on
     the left and setting on the right as it does in the niche, and which way
     its lit side turns. */
  function moonPlace(moon, x0, y0, w, h) {
    var x = x0 + w * (.15 + .7 * moon.along);
    var y = y0 + h * (.66 - .48 * Math.sin(Math.PI * moon.along));
    var sunX = moon.waxing ? x0 + w + w * .1 : x0 - w * .1;
    var turn = Math.atan2(y0 + h * .8 - y, sunX - x) - (moon.waxing ? 0 : Math.PI);
    return { x: x, y: y, turn: turn };
  }

  function loadPlate(name) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = 'img/sky/' + name + '.webp';
    });
  }

  /* The sky of the moment a picture is made, at its head under an arch like
     the niche's, so times shared at maghrib carry the sunset and those shared
     at night carry tonight's moon. */
  function paintSky(ctx, plates, sky, moon, x0, y0, w, h, paper) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h);
    ctx.lineTo(x0, y0 + h * .5);
    ctx.ellipse(x0 + w / 2, y0 + h * .5, w / 2, h * .5, 0, Math.PI, 0);
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
    var arch = new Path2D();
    arch.moveTo(x0, y0 + h); arch.lineTo(x0, y0 + h * .5);
    arch.ellipse(x0 + w / 2, y0 + h * .5, w / 2, h * .5, 0, Math.PI, 0);
    arch.lineTo(x0 + w, y0 + h);
    ctx.clip();
    /* the shore stands a little above the foot, where the arch begins to fade */
    var ih = w * 538 / 960, iy = y0 + h * .74 - ih * .5825;
    if (plates[0]) ctx.drawImage(plates[0], x0, iy, w, ih);
    if (plates[1] && sky.mix > 0) { ctx.globalAlpha = sky.mix; ctx.drawImage(plates[1], x0, iy, w, ih); ctx.globalAlpha = 1; }
    var dark = SKY_DARK[sky.a] * (1 - sky.mix) + SKY_DARK[sky.b] * sky.mix;
    var stars = Math.max(0, (dark - .35) / .65);
    if (stars > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (.75 * stars).toFixed(3) + ')';
      for (var k = 0; k < 46; k++) {
        var sx = x0 + w * ((k * 0.6180339 + .07) % 1), sy = y0 + h * (.08 + .5 * ((k * 0.4142136 + .13) % 1));
        ctx.beginPath(); ctx.arc(sx, sy, k % 5 ? 1.6 : 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    var shown = moon.up && moon.lit > .02 ? Math.max(0, Math.min(1, (dark - .3) / .5)) : 0;
    if (shown > 0) {
      var at = moonPlace(moon, x0, y0, w, h);
      var r = Math.round(w * .032);
      ctx.save();
      ctx.translate(at.x, at.y); ctx.rotate(at.turn);
      ctx.globalAlpha = shown;
      var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
      glow.addColorStop(0, 'rgba(255,246,220,.45)'); glow.addColorStop(1, 'rgba(255,246,220,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f7f0da';
      ctx.fill(new Path2D(moonPath(Math.max(moon.lit, .08), moon.waxing, r)));
      ctx.restore();
    }
    /* and the sea fades into the paper at the foot of the arch */
    var fade = ctx.createLinearGradient(0, y0 + h * .78, 0, y0 + h);
    fade.addColorStop(0, paper.replace('1)', '0)')); fade.addColorStop(1, paper);
    ctx.fillStyle = fade;
    ctx.fillRect(x0, y0 + h * .78, w, h * .22 + 1);
    ctx.restore();
    ctx.strokeStyle = '#b08833'; ctx.lineWidth = 2;
    ctx.stroke(arch);
  }

  /* ---------------- the clock ---------------- */

  function tick() {
    if (!$('arc-count')) return;
    var c = clockState();
    applyAccent(c.windowKey);

    /* and the wait for such a time is not counted: it read NaN:NaN:NaN */
    var known = isFinite(c.remaining);
    var total = known ? Math.max(0, Math.round(c.remaining * 60)) : 0;
    var hrs = Math.floor(total / 3600);
    var mins = Math.floor((total % 3600) / 60);
    var secs = total % 60;

    var fasting = Hijri.toHijri(new Date(), Store.get('hijriAdjust')).m === 9;
    /* For the half hour after an adhan the reader wants to know how long it
       has been, since that is the window of the prayer; after it, the wait for
       the next is what matters. The sunrise has no adhan, so nothing is
       counted from it. */
    var sinceAdhan = c.prev && c.prev.key !== 'sunrise' ? c.now - c.prev.at : -1;
    var fresh = sinceAdhan >= 0 && sinceAdhan < AFTER_ADHAN_MINUTES;
    if (fresh) {
      var up = Math.max(0, Math.round(sinceAdhan * 60));
      $('arc-count').textContent = ar(pad(Math.floor(up / 3600)) + ':' + pad(Math.floor((up % 3600) / 60)) + ':' + pad(up % 60));
      $('arc-label').textContent = 'مضى على';
      $('arc-name').textContent = 'أذان ' + c.prev.ar;
      $('arc-at').textContent = clockText(c.prev.at);
    } else {
      $('arc-count').textContent = known ? ar(pad(hrs) + ':' + pad(mins) + ':' + pad(secs)) : '--:--:--';
      $('arc-name').textContent = c.next.key === 'sunrise' ? c.next.ar
        : (fasting && c.next.key === 'maghrib') ? 'الإفطار' : 'أذان ' + c.next.ar;
      $('arc-at').textContent = clockText(c.next.at);
      /* باقٍ على أذان العصر is how it is said. The sunrise has no adhan, so it
         is named on its own. */
      if ($('arc-label')) $('arc-label').textContent = 'باقٍ على';
    }

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
    renderSky();
    skyviewText();
    /* The hour card follows the hour and the list its day. A screen left
       open across the fajr, or across the start of a window, used to go on
       showing what had passed, and a touch on it landed on a day it no
       longer showed, so both are drawn again the moment either moves on. */
    var shownDay = Store.dayKey(sunnahDay());
    var was = state.shownSunnah;
    if (was && (was.day !== shownDay || was.hour !== c.windowKey)) renderNowSunnah();
    if (was && was.day !== shownDay) {
      renderTodayMeter();
      if (state.view === 'tracker') renderTracker();
    }
    state.shownSunnah = { day: shownDay, hour: c.windowKey };
    maybeNotify(c);
    maybeSalawat(false);
    remindInPage();
    if (state.scheduledFor !== Store.dayKey()) { state.scheduledFor = Store.dayKey(); scheduleForWorker(); tellSun(computeTimes(new Date())); }
    if (!state.askedPlace) {
      state.askedPlace = true;
      adoptGrantedNotifications();
      /* the app holds its splash until the page says it has painted, and the
         page's own splash goes at the same moment; a wrapper with no splash of
         its own has nothing to hand over to, so there the page's is held and
         faded as in a browser */
      var app = bridge();
      if (app && app.pageReady) { try { app.pageReady(); } catch (e) { /* older package */ } }
      dismissBootSplash(appDrawsSplash());
      /* and once the first screen is up, the country's own paintings are
         fetched for the next opening */
      window.setTimeout(warmSplash, 4000);
      if (Store.get('pageLayout') === 'madinah') loadMadinahLines().then(function () { if (state.view === 'page') renderPage(); });
      /* The sheets are checked when the app opens, and again whenever the
         reader comes back to it. Without the second check a phone left open
         since before maghrib never learns that friday night began, and the
         reader who taps the notification finds the app as he left it. */
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) window.setTimeout(showDueSheets, 300);
      });
      /* and the worker speaks to a window that is already open rather than
     reopening it */
  if (window.navigator && window.navigator.serviceWorker) {
    window.navigator.serviceWorker.addEventListener('message', function (event) {
      var d = event.data || {};
      if (d.type === 'came-from' && d.kind) cameFrom(String(d.kind).replace(/[^a-zA-Z]/g, ''));
    });
  }

  /* the wrapper opens the site with ?from=<kind> when a notification was
         tapped and the app was not already running */
      var from = (window.location.search.match(/[?&]from=([a-zA-Z]+)/) || [])[1];
      if (from) window.setTimeout(function () { cameFrom(from); }, 1800);
      window.setTimeout(function () {
        maybeExplainChrome();
        var sheet = showDueSheets();
        /* the phone is asked where it is; the banner that asks the reader to
           say so is only for when the phone will not */
        locateQuietly(function (found) { if (!found && !sheet) maybeAskPlace(); });
      }, 1500);
    }
  }

  function renderWindows(c) {
    var host = $('windows');
    if (!host) return;
    var marks = Store.prayersOf(new Date());
    /* The strip marks what the arc is counting: the prayer just past while its
       half hour runs, and the coming one after that. Fajr is over once the sun
       is up, so the mark moves to dhuhr rather than staying on sunrise. */
    var sinceAdhan = c.prev && c.prev.key !== 'sunrise' ? c.now - c.prev.at : -1;
    var marked = (sinceAdhan >= 0 && sinceAdhan < AFTER_ADHAN_MINUTES) ? c.prev.key : c.next.key;
    var html = c.marks.map(function (m) {
      var cls = 'window';
      if (m.key === marked) cls += ' is-now';
      else if (m.at < c.now) cls += ' is-past';
      var prayer = Store.PRAYER_KEYS.indexOf(m.key) !== -1;
      var came = m.at <= c.now;
      var state = marks[m.key] || '';
      if (state) cls += ' is-marked mark-' + state;
      var tag = prayer && came ? 'button' : 'div';
      return '<' + tag + ' class="' + cls + '" role="listitem" data-tr="prayer" aria-label="' + esc(m.ar + ' ' + clockText(m.at)) +
        (m.key === marked ? (sinceAdhan >= 0 && sinceAdhan < AFTER_ADHAN_MINUTES ? '، الوقت الحالي' : '، الصلاة القادمة') : '') + (state ? '، ' + esc(PRAYER_STATE_NAMES[state]) : '') +
        (prayer && came ? '، اضغط لتعلّمها' : '') + '"' +
        (prayer && came ? ' data-mark-prayer="' + m.key + '"' : '') + '>' +
        '<div class="window-name" aria-hidden="true">' + esc(m.ar) + '</div>' +
        '<div class="window-time" aria-hidden="true">' + clockMarkup(m.at) + '</div>' +
        (state ? '<div class="window-mark" aria-hidden="true">' + icon(state === 'missed' ? 'close' : 'check') + '</div>' : '') +
        '</' + tag + '>';
    }).join('');
    host.innerHTML = html;
    fitWindows(host, html);
    /* the place line is drawn far less often than this, but the room and the
       size of the words can change while the screen stays open */
    var line = $('place-line');
    if (line && line.getAttribute('data-fit') !== host.clientWidth + '|' + fontSizeOf(line)) fitPlaceLine();
    renderNightLine();
  }

  /* The six windows share one line while their words fit it. The phone's own
     text size grows the words and not the card, and another language writes
     longer ones than the Arabic, so whether they fit is measured, in the
     reader's language, and when they do not they stand in two rows of three
     instead of running off the card. The strip is drawn every second, so it
     is measured again only when what it holds or the room it has changes. */
  var windowsFit = '';
  function fitWindows(host, html) {
    var key = html + '|' + host.clientWidth + '|' + fontSizeOf(host);
    if (key === windowsFit) return;
    windowsFit = key;
    host.classList.remove('is-two-rows');
    if (window.I18n && window.I18n.apply) window.I18n.apply(host);
    if (host.scrollWidth > host.clientWidth + 1 || namesWrap(host)) host.classList.add('is-two-rows');
  }

  /* A name of two words, «طلوع آفتاب» or «Fitowar rana», wraps inside its
     window before the strip runs out of room, and its time then sits lower
     than the other five: the lines each name was laid out in are counted, and
     two rows give every name the room for one. */
  function namesWrap(host) {
    var range = document.createRange && document.createRange();
    if (!range || !range.getClientRects) return false;
    var names = host.querySelectorAll('.window-name');
    for (var i = 0; i < names.length; i++) {
      range.selectNodeContents(names[i]);
      var lines = range.getClientRects();
      for (var j = 1; j < lines.length; j++) {
        if (Math.abs(lines[j].top - lines[0].top) > 2) return true;
      }
    }
    return false;
  }

  function fontSizeOf(el) {
    return window.getComputedStyle ? window.getComputedStyle(el).fontSize : '';
  }

  /* The place and its calendar share one line while they fit it; when they do
     not, the calendar stands under the place, and the button that fetches the
     place stays beside its name. Measured with both held on one line. */
  function fitPlaceLine() {
    var line = $('place-line');
    if (!line || !line.firstChild) return;
    /* while the home is hidden nothing has a size, so it is fitted when shown */
    if (!line.getClientRects().length) { line.removeAttribute('data-fit'); return; }
    line.classList.remove('is-stacked');
    if (window.I18n && window.I18n.apply) window.I18n.apply(line);
    if (placeWraps(line)) line.classList.add('is-stacked');
    var strip = $('windows');
    line.setAttribute('data-fit', (strip ? strip.clientWidth : 0) + '|' + fontSizeOf(line));
  }

  /* The line is laid out as it is and read back, since the browser breaks it
     to a fraction of a pixel and a width rounded to whole pixels missed a line
     one pixel too long: while the button, the place and its calendar share a
     row, they share its middle too. */
  function placeWraps(line) {
    var parts = line.querySelectorAll('.place-locate, .place-where, .place-how');
    var mid = null;
    for (var i = 0; i < parts.length; i++) {
      var box = parts[i].getBoundingClientRect();
      if (!box.height) continue;
      var at = (box.top + box.bottom) / 2;
      if (mid === null) mid = at;
      else if (Math.abs(at - mid) > 4) return true;
    }
    return false;
  }

  /* after the faces arrive and whenever the room changes, both are measured
     again, since either changes how wide the words are */
  function refitHome() {
    var w = $('windows');
    if (w) { windowsFit = ''; fitWindows(w, w.innerHTML); }
    fitPlaceLine();
    var tt = $('tt-table');
    if (tt && tt.firstChild) fitTimetable(tt);
    var path = $('umrah-path');
    if (path && path.firstChild) fitJourney(path);
  }

  /* The night's own two marks, which are not prayers and so are not in the
     strip, but a reader who rises at night wants them. */
  function renderNightLine() {
    var host = $('night-line');
    if (!host) return;
    var marks = nightMarks(new Date());
    if (!marks) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML =
      '<span><span class="night-name">منتصف الليل</span> ' + clockText(marks.midnight) + '</span>' +
      '<span><span class="night-name">الثلث الأخير</span> ' + clockText(marks.lastThird) + '</span>';
  }

  /* ---------------- the five prayers, marked ---------------- */

  var PRAYER_STATE_NAMES = { jamaah: 'في جماعة', ontime: 'في الوقت', late: 'قضاء', missed: 'فاتت' };
  var PRAYER_ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

  function markPrayerSheet(key, date) {
    var when = date || new Date();
    var name = prayerName(key, when);
    var current = Store.prayersOf(when)[key] || '';
    var dayLabel = when.toDateString() === new Date().toDateString() ? 'اليوم' : Hijri.format(Hijri.toHijri(when, Store.get('hijriAdjust')));
    var stamp = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate());
    openSheet('صلاة ' + name + '، ' + dayLabel,
      '<div class="mark-choices">' +
      ['jamaah', 'ontime', 'late', 'missed'].map(function (st) {
        return '<button class="btn ' + (current === st ? 'btn-primary' : 'btn-ghost') + '" data-act="prayer-mark" data-ref="' + key + ':' + st + ':' + stamp + '">' +
          icon(st === 'missed' ? 'close' : 'check') + esc(PRAYER_STATE_NAMES[st]) + '</button>';
      }).join('') +
      (current ? '<button class="btn btn-ghost" data-act="prayer-mark" data-ref="' + key + '::' + stamp + '">امسح العلامة</button>' : '') +
      '</div>' +
      '<p class="setting-note" style="margin-top:12px">في جماعة وفي الوقت تُحسبان في وقتها، والقضاء ما صُلّي بعد خروج الوقت</p>');
  }

  /* A day gone by: the five prayers of that day, each with its own choice,
     written the moment it changes. */
  function markDaySheet(date) {
    var rec = Store.prayersOf(date);
    var stamp = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    var title = Hijri.WEEKDAYS[date.getDay()] + ' ' + ar(date.getDate()) + ' ' + GREG_MONTHS[date.getMonth()];
    openSheet(title,
      PRAYER_ORDER.map(function (k) {
        return '<div class="setting"><span class="setting-label">' + esc(prayerName(k, date)) + '</span>' +
          '<select class="select" data-day-prayer="' + k + '" data-date="' + stamp + '" aria-label="' + esc(prayerName(k, date)) + '">' +
          '<option value=""' + (!rec[k] ? ' selected' : '') + '>بلا علامة</option>' +
          ['jamaah', 'ontime', 'late', 'missed'].map(function (st) {
            return '<option value="' + st + '"' + (rec[k] === st ? ' selected' : '') + '>' + esc(PRAYER_STATE_NAMES[st]) + '</option>';
          }).join('') + '</select></div>';
      }).join(''));
  }

  function dateOfStamp(stamp) {
    var p = stamp.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function renderPrayers() {
    var today = $('prayers-today');
    if (!today) return;
    var now = new Date();
    var c = clockState();
    var marks = Store.prayersOf(now);
    today.innerHTML = PRAYER_ORDER.map(function (k) {
      var m = c.marks.filter(function (x) { return x.key === k; })[0];
      var came = m ? m.at <= c.now : true;
      var st = marks[k] || '';
      return '<button class="row prayer-row' + (st ? ' mark-' + st : '') + '"' + (came ? ' data-mark-prayer="' + k + '"' : ' disabled') + '>' +
        '<span class="row-mark">' + icon(st ? (st === 'missed' ? 'close' : 'check') : 'clock') + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(prayerName(k, now)) + '</span>' +
        '<span class="row-note">' + (m ? clockText(m.at) : '') + (st ? '، ' + esc(PRAYER_STATE_NAMES[st]) : (came ? '، لم تُعلَّم بعد' : '، لم يدخل وقتها')) + '</span></span></button>';
    }).join('');

    var stats = Store.prayerStats(30);
    if ($('prayers-streak')) {
      $('prayers-streak').textContent = stats.streak ? inARow(stats.streak) + ' بالخمس' : 'لا تتابع بعد';
    }
    if ($('prayers-stats')) {
      var total = stats.prayed + stats.missed;
      $('prayers-stats').innerHTML =
        stat(stats.inTime, 'في وقتها') + stat(stats.jamaah, 'في جماعة') + stat(stats.late, 'قضاء') + stat(stats.missed, 'فاتت') +
        '<p class="setting-note" style="grid-column:1/-1">' + prayerSummary(stats, total) + '</p>';
    }
    var grid = $('prayers-grid');
    if (grid) {
      var rows = '<div class="pg-row pg-head" role="row"><span role="columnheader"></span>' +
        PRAYER_ORDER.map(function (k) { return '<span role="columnheader">' + esc(prayerName(k, now).replace('أذان ', '')) + '</span>'; }).join('') + '</div>';
      for (var i = 29; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        var rec = Store.prayersOf(d);
        rows += '<div class="pg-row' + (i === 0 ? ' is-today' : '') + '" role="row"><span class="pg-day" role="rowheader">' + ar(d.getDate()) + '</span>' +
          PRAYER_ORDER.map(function (k) {
            var st = rec[k] || '';
            return '<span class="pg ' + (st || 'none') + '" role="cell" aria-label="' +
              esc(prayerName(k, d) + ' ' + ar(d.getDate()) + '، ' + (st ? PRAYER_STATE_NAMES[st] : 'بلا علامة')) + '"></span>';
          }).join('') + '</div>';
      }
      grid.innerHTML = rows;
    }
  }

  /* The month in one sentence. Few prayers are told in words, a percentage
     of one prayer being a nonsense; many are told with the share as well. */
  function prayerSummary(stats, total) {
    if (!total) return 'لم تُعلّم صلاة بعد، فاضغط أي صلاة في الأعلى أو في شريط المواقيت';
    var inTime = stats.inTime;
    if (total === 1) {
      return 'علّمت صلاة واحدة في آخر ثلاثين يوماً، و' + (inTime ? 'كانت في وقتها' : (stats.late ? 'كانت قضاءً' : 'فاتت'));
    }
    if (total === 2) {
      return 'علّمت صلاتين في آخر ثلاثين يوماً، ' + (inTime === 2 ? 'وكلتاهما في وقتها' : inTime === 1 ? 'إحداهما في وقتها' : 'ولا واحدة منهما في وقتها');
    }
    var head = 'علّمت ' + count(total, 'صلاة واحدة', 'صلاتين', 'صلوات', 'صلاة') + ' في آخر ثلاثين يوماً';
    if (inTime === total) return head + '، وكلها في وقتها';
    if (!inTime) return head + '، ولا واحدة منها في وقتها';
    var words = inTime === 1 ? 'واحدة منها' : inTime === 2 ? 'اثنتان منها' : ar(inTime) + ' منها';
    return head + '، ' + words + ' في وقتها' + (total >= 10 ? '، أي ' + ar(Math.round(inTime / total * 100)) + '%' : '');
  }

  function stat(n, label) {
    return '<div class="prayer-stat"><b>' + ar(n) + '</b><span>' + esc(label) + '</span></div>';
  }


  /* On a phone a page may not raise a notification itself: android throws on
     new Notification and the old code swallowed the error, so nothing ever
     appeared. The worker can, so it is asked to, and the direct call is kept
     for a desktop browser without one. */
  /* quiet: raised without the phone's sound, for a reminder the reader set
     to silence or to the app's own bells, which the page sounds itself */
  function notify(title, body, tag, quiet) {
    title = tongue(title);
    body = tongue(body);
    var app = bridge();
    if (app && app.notify) {
      try { app.notify(title, body, tag || 'page'); return Promise.resolve(true); } catch (e) { /* fall through */ }
    }
    if (!window.Notification || window.Notification.permission !== 'granted') return Promise.resolve(false);
    var options = {
      body: body, tag: tag || 'default',
      lang: (window.I18n && window.I18n.lang) || 'ar', dir: (window.I18n && window.I18n.dir) || 'rtl',
      icon: 'icons/icon-192.png', badge: 'icons/icon-96.png',
      vibrate: Store.get('vibrate') ? [200, 100, 200] : undefined,
      data: { url: './' },
      requireInteraction: false
    };
    if (quiet) { options.silent = true; options.vibrate = undefined; }
    function direct() {
      try { new window.Notification(title, options); return true; } catch (e) { return false; }
    }
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      return navigator.serviceWorker.ready.then(function (reg) {
        if (reg && typeof reg.showNotification === 'function') {
          return reg.showNotification(title, options).then(function () { return true; }, direct);
        }
        return direct();
      }).catch(function (e) { return direct(); });
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
    /* The adhan is for the five prayers and not for the sunrise. A recorded
       adhan is the whole sound of the moment, so nothing is chimed or spoken
       over it, and «صامت» means nothing at all. */
    var pick = adhanChoice();
    var played = !sunrise && soundAdhan(c.prev.key);
    if (!sunrise && !played && pick !== 'silent') speak('حان وقت صلاة ' + name.replace(/^أذان /, ''), 'adhan');
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
  /* The words of the chosen salawat, taken from wherever that voice recites
     from, the mushaf or the book, so the reader reads exactly what is recited. */
  function salawatText() {
    var v = salawatVoice();
    /* A recitation of an ayah takes its words from the mushaf, not from the
       book of duas: the recording that opens the app is سورة الأحزاب آية ٥٦
       from end to end, and showing the Ibrahimic salawat beside it would have
       had the reader reading one thing while hearing another. */
    if (v && v.q && typeof Mushaf !== 'undefined' && Mushaf.ready()) {
      return Mushaf.ayah(v.q[0], v.q[1]) || '';
    }
    if (!v || typeof HISN === 'undefined') return '';
    var chapter = HISN.filter(function (c) { return c.id === v.hisn; })[0];
    if (!chapter) return '';
    var item = chapter.i.filter(function (it) { return it.a === v.a; })[0];
    return item ? item.t : '';
  }

  /* Where the words of the chosen voice come from, said under them: a surah
     and an ayah for a recitation, the book for a dua. */
  function salawatFrom() {
    var v = salawatVoice();
    if (!v) return '';
    if (v.q) {
      var meta = surahMeta(v.q[0]);
      return 'سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(v.q[1]);
    }
    return typeof SALAWAT_SOURCE !== 'undefined' ? SALAWAT_SOURCE.n : '';
  }

  /* The chosen voice, falling back to the first in the list rather than to a
     name written out here, which would have to be changed in four places. */
  function salawatVoice() {
    var list = typeof SALAWAT_VOICES !== 'undefined' ? SALAWAT_VOICES : [];
    if (!list.length) return null;
    var id = Store.get('salawatVoice');
    return list.filter(function (x) { return x.id === id; })[0] || list[0];
  }

  /* the name of the chosen recitation, for the player the phone shows */
  function salawatName() {
    var v = salawatVoice();
    return v ? v.n : 'الصلاة على النبي';
  }

  function salawatUrl() {
    var v = salawatVoice();
    /* a recitation may live under audio/dua, where the chapter it belongs to
       already uses it: one file, not a second copy under another name */
    if (v && v.f) return v.f;
    return 'audio/salawat/' + (v ? v.id : 'ibrahimiyya') + '.mp3';
  }

  function playRecording(url, button, title) {
    if (!url) return false;
    /* One sound at a time. Whatever is sounding stops before this starts, a
       clip, the phone's speech, a recitation or a station, and it stops
       quietly, since this one raises the flag again at once. */
    hushVoice();
    if (state.audio) leaveRecitation();
    var from = recordingSource(url);
    try {
      var clip = new window.Audio();
      clip.src = url;
      state.voiceClip = clip;
      /* the element when we have one, an id when the caller only knows that */
      if (button && button.nodeType === 1) { state.voiceEl = button; state.voiceButton = null; }
      else { state.voiceButton = button || 'settings-voice-try'; state.voiceEl = null; }
      clip.onended = function () {
        if (state.voiceClip !== clip) return;
        state.voiceClip = null;
        markVoiceButton(false);
        clearMediaSession();
        /* a dhikr that finished on its own leaves nothing to press */
        if (!state.audio) { state.shaded = null; tellAppSounding(false); }
      };
      /* A clip that gave way to the next one is refused as it stops, and that
         refusal is no failure: it used to clear the new clip and ring the
         chime over it. Only the clip still current falls back to the chime. */
      clip.play().catch(function () {
        if (state.voiceClip !== clip) return;
        state.voiceClip = null; markVoiceButton(false); chime();
      });
      markVoiceButton(true);
      if (title) {
        showInMediaSession(title, from);
        /* The wrapper pauses the page when the reader leaves it unless it is
           told something is sounding, so a dhikr used to cut off at the door.
           And what the wrapper is not told about gets no notice in the shade,
           which is why nothing appeared there for the adhkar. */
        tellAppSounding(true);
        if (state.shaded !== title) {
          state.shaded = title;
          showInShade(title, from, true);
        }
      }
      return true;
    } catch (e) { return chime(); }
  }

  /* The clip or the phone's speech, silenced for a sound that follows at
     once. The flag stays up and the shade stays where it is, since lowering
     them and raising them a moment later is the stop overtaking its own start
     that once crashed the app. */
  function hushVoice() {
    var clip = state.voiceClip;
    state.voiceClip = null;
    if (clip) {
      try { clip.pause(); clip.removeAttribute('src'); clip.load(); } catch (e) { /* gone */ }
    }
    if (state.speaking && window.speechSynthesis && window.speechSynthesis.cancel) {
      state.utterance = null;
      try { window.speechSynthesis.cancel(); } catch (e2) { /* nothing speaking */ }
    }
    state.speaking = false;
    markVoiceButton(false);
  }

  /* A recitation or a station gives way to a clip the reader asked for: the
     walk, the repeat and the whole surah all end, quietly, since the clip
     raises the flag again at once. */
  function leaveRecitation() {
    state.recite = null;
    state.surahAudio = null;
    if (state.repeat) {
      state.repeat = null;
      var body = $('reader-body');
      if (body) body.classList.remove('is-hidden');
    }
    releaseAwake();
    $$('.ayah').forEach(function (el) { el.classList.remove('is-reciting'); });
    stopAudio(true);
  }

  /* Who is heard in a recording, read from where its file sits, so the
     phone's player names the muadhin, the reciter or the book, and not the
     one name it used to give every clip. */
  function recordingSource(url) {
    var m = /audio\/(adhan|salawat|dua)\/([a-z]+)[a-z-]*\.mp3/.exec(String(url || ''));
    if (!m) return '';
    var buhendi = typeof SALAWAT_RECITER !== 'undefined' ? 'بصوت ' + SALAWAT_RECITER.n : '';
    if (m[1] === 'adhan') {
      var v = adhanVoice(m[2]);
      return v ? 'بصوت ' + v.n : '';
    }
    if (m[1] === 'dua') return buhendi;
    var said = (typeof SALAWAT_VOICES !== 'undefined' ? SALAWAT_VOICES : []).filter(function (x) { return x.id === m[2]; })[0];
    if (said && said.q) return buhendi;
    return typeof SALAWAT_SOURCE !== 'undefined' ? 'من تسجيلات ' + SALAWAT_SOURCE.n : '';
  }

  /* A clip played from the page is invisible to the phone: nothing appears in
     the notification shade, so the only way to stop it is to find the app
     again. Naming it to the media session puts it there, with pause and stop
     where the reader expects them. */
  function showInMediaSession(title, artist) {
    try {
      var ms = navigator.mediaSession;
      if (!ms) return;
      if (window.MediaMetadata) {
        /* android often shows no player at all when the metadata carries no
           artwork, which is why nothing appeared in the shade to stop it with */
        ms.metadata = new window.MediaMetadata({
          title: title,
          artist: artist || 'سُنّتي',
          album: 'سُنّتي',
          artwork: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
        });
      }
      ms.playbackState = 'playing';
      ms.setActionHandler('pause', function () { 
        stopSpeaking();
        updateMediaSessionState();
      });
      ms.setActionHandler('stop', function () { 
        stopSpeaking();
        updateMediaSessionState();
      });
      ms.setActionHandler('play', function () { 
        if (state.voiceClip) {
          state.voiceClip.play();
          updateMediaSessionState();
        }
      });
    } catch (e) { /* an older phone without a media session */ }
  }

  function clearMediaSession() {
    try {
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      }
    } catch (e) { /* nothing to clear */ }
  }

  function updateMediaSessionState() {
    try {
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = isSpeaking() ? 'playing' : 'paused';
      }
    } catch (e) { /* older phone */ }
  }

  /* Whatever the sample is, a clip or the phone's own speech, one call ends it. */
  function stopSpeaking() {
    clearMediaSession();
    if (state.voiceClip) {
      try { state.voiceClip.pause(); state.voiceClip.removeAttribute('src'); state.voiceClip.load(); } catch (e) { /* gone */ }
      state.voiceClip = null;
    }
    if (window.speechSynthesis && window.speechSynthesis.cancel) {
      state.utterance = null;
      try { window.speechSynthesis.cancel(); } catch (e2) { /* nothing speaking */ }
    }
    state.speaking = false;
    state.voiceButton = null;
    state.voiceEl = null;
    /* Only when nothing at all is left sounding: a recitation running beside
       this one holds the shade, and taking it down would cut the recitation. */
    if (!state.audio) {
      state.shaded = null;
      tellAppSounding(false);
    }
    markVoiceButton(false);
    /* إعادة تحديث الأزرار لضمان إظهار أيقونة التشغيل بدلاً من الإيقاف */
    document.querySelectorAll('.try-sound, [data-hear], [data-act="hear-hisn"], #settings-voice-try, #settings-adhan-try').forEach(function (btn) {
      try { btn.innerHTML = icon('play'); } catch (e) { /* button gone */ }
    });
  }

  function isSpeaking() {
    return !!state.voiceClip || !!state.speaking;
  }

  /* The one button starts the sample and, while it plays, stops it. */
  /* Only the button that started the sound shows that it is playing; hearing
     the adhan must not light the reminder's button beside it. */
  /* Every button that can start a clip shows a pause while it plays. This used
     to name two buttons and no more, so the ones added later kept their play
     triangle while the sound ran, and there was no way to stop it from the row
     that had started it. The element itself is remembered, not just an id. */
  function markVoiceButton(playing) {
    var mineEl = state.voiceEl || null;
    var mineId = state.voiceButton || null;
    document.querySelectorAll('.try-sound, [data-hear], [data-act="hear-hisn"], #settings-voice-try, #settings-adhan-try')
      .forEach(function (btn) {
        var mine = !!playing && (btn === mineEl || (mineId && btn.id === mineId));
        var was = btn.getAttribute('data-label') || btn.getAttribute('aria-label') || 'اسمع الصوت';
        if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', was);
        btn.innerHTML = icon(mine ? 'pause' : 'play');
        btn.setAttribute('aria-label', mine ? 'أوقف الصوت' : btn.getAttribute('data-label'));
        btn.classList.toggle('is-playing', mine);
      });
    if (!playing) { state.voiceButton = null; state.voiceEl = null; }
  }

  function speak(text, why) {
    var mode = Store.get('voice') || 'recording';
    if (mode === 'none') return false;
    if (mode === 'recording') return why === 'adhan' ? chime() : playRecording(salawatUrl(), 'settings-voice-try', salawatName());
    /* a tone or the phone's speech asked for by the reader stops whatever else
       is sounding, as a recording does, so two are never heard at once */
    if (why === 'try') { hushVoice(); if (state.audio) stopRecite(); }
    if (mode === 'tone') return chime();
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return chime();
    try {
      /* the call to prayer is the app's own sentence, said in the reader's
         language by a voice of it; the salawat is said as it is, in Arabic */
      var own = why === 'adhan' && window.I18n && window.I18n.lang !== 'ar';
      var line = new window.SpeechSynthesisUtterance(own ? tongue(text) : text);
      line.lang = own ? window.I18n.speech : 'ar-SA';
      line.rate = 0.85;
      /* pitched low, so that whatever voice the phone offers sits nearer a
         man's register */
      line.pitch = 0.75;
      var chosen = own ? voiceFor(window.I18n.speech) : pickVoice();
      if (chosen) line.voice = chosen;
      else if ((window.speechSynthesis.getVoices() || []).length) return chime();
      /* a line that was cancelled for the next sound must not reset that
         sound's button when its own end arrives late */
      line.onend = function () {
        if (state.utterance !== line) return;
        state.utterance = null; state.speaking = false; markVoiceButton(false);
      };
      line.onerror = line.onend;
      state.utterance = line;
      state.speaking = true;
      markVoiceButton(true);
      chime();
      /* the chime first and the words after it, by which time the chime has
         fallen away to a whisper, and only if nothing has taken its place */
      window.setTimeout(function () { if (state.speaking && state.utterance === line) window.speechSynthesis.speak(line); }, 700);
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
      /* the recording is no longer always the ibrahimiyya, so the line names
         whatever is chosen rather than one of the four by name */
      var v = salawatVoice();
      hint.textContent = {
        recording: (v ? v.n + '، ' : '') + 'ويُسمع ما دام التطبيق مفتوحاً',
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

  /* a voice of the reader's own language, the phone's first of it */
  function voiceFor(tag) {
    if (!window.speechSynthesis) return null;
    var base = String(tag || '').split('-')[0].toLowerCase();
    return (window.speechSynthesis.getVoices() || []).filter(function (v) {
      return String(v.lang || '').toLowerCase().split(/[-_]/)[0] === base;
    })[0] || null;
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
  /* show or hide a select together with the picker drawn over it */
  function showPicker(sel, on) {
    if (!sel) return;
    var wrap = sel.parentNode && sel.parentNode.classList.contains('picker') ? sel.parentNode : sel;
    wrap.hidden = !on;
    if (wrap !== sel) sel.hidden = false;
  }

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
      /* the select now lives inside the picker we draw, and hiding the select
         leaves that wrapper on screen: an empty box beside the words. The
         wrapper is what shows or hides. */
      showPicker(sel, true);
      if (plain) plain.hidden = true;
      if (note) note.textContent = 'اختر صوتاً واضغط زر السماع';
    } else {
      /* a sentence does not fit in a list, so with nothing to choose from
         the list goes and two plain words take its place */
      showPicker(sel, false);
      if (plain) { plain.hidden = false; plain.textContent = 'يختاره هاتفك'; }
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
    /* A recitation, a station or an adhan already sounding is not cut off by
       the reminder: the notice carries it, and the voice waits for the next. */
    var busy = (state.audio && !state.audio.paused) || isSpeaking();
    if (!busy) speak('اللهم صلِّ وسلِّم على نبينا محمد', 'salawat');
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
  /* True inside the android package: the page is then opened by the app, and
     the first open arrives with the app's own referrer. Remembered, since a
     later navigation loses the referrer. */
  /* The android package hands the page a bridge named SunnatiApp; through it
     the app notifies, rings and shares by itself, with no browser between. */
  function bridge() {
    return typeof window.SunnatiApp !== 'undefined' ? window.SunnatiApp : null;
  }

  /* The opening screen is a picture made at build time, so it cannot know any
     city. The wrapper is told this one and greets with it at the next launch. */
  function tellPlace() {
    var p = place();
    /* The greeting names where the person is, and the built-in place is where
       nobody is until they say so: it is the app's fallback for reckoning the
       times, and a reader in Riyadh who has not yet let the app locate them
       was being greeted as one of the people of Kuwait. A name is passed on
       only once the place is the reader's own, found or chosen; until then
       the opening greets nobody in particular. */
    var own = p && p !== DEFAULT_PLACE && p.n && p.n !== 'موقعك';
    var name = own ? String(p.n) : '';
    try {
      if (name) window.localStorage.setItem('sunnati.greet', name);
      else window.localStorage.removeItem('sunnati.greet');
    } catch (e) { /* no store, no name */ }
    var app = bridge();
    if (!app || !app.setPlace) return false;
    try { app.setPlace(name); } catch (e) { return false; }
    return !!name;
  }

  /* The package version beside the page's, so one screenshot shows both. */
  function packageLine() {
    var app = bridge();
    if (!app || !app.version) return '';
    try {
      var v = app.version();
      if (!v) return '';
      /* the wrapper says which phone it is; the iPhone one used to be called
         an android package on its own about screen */
      var ios = app.platform && app.platform() === 'ios';
      return '، وحزمة ' + (ios ? 'آيفون ' : 'أندرويد ') + ar(v);
    } catch (e) { return ''; }
  }

  function inIosApp() {
    var app = bridge();
    try { return !!(app && app.platform && app.platform() === 'ios'); } catch (e) { return false; }
  }

  function inAndroidApp() {
    if (bridge()) { if (!Store.get('inApp')) Store.set('inApp', true); return true; }
    if (Store.get('inApp')) return true;
    var fromApp = (document.referrer || '').indexOf('android-app://com.eworldq8.sunnati') === 0;
    if (fromApp) Store.set('inApp', true);
    return fromApp;
  }

  /* The days ahead, for the reader's own place and method, handed to the app
     so its alarm rings at the right minute anywhere, not only in الكويت. */
  function handTimesToApp() {
    var app = bridge();
    if (!app || !app.setPrayerTimes) return false;
    var list = [];
    var now = new Date();
    for (var d = 0; d < 7; d++) {
      var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      var t = computeTimes(day);
      ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(function (k) {
        if (typeof t[k] !== 'number' || isNaN(t[k])) return;
        var at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t[k], 0, 0).getTime();
        if (at > Date.now()) list.push({ at: at, name: prayerName(k, day) });
      });
    }
    try { app.setPrayerTimes(JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  /* Inside the package the phone has already been asked about notifications,
     so a granted permission means the reader wants them: the switch goes on
     by itself the first time, rather than waiting to be found in the settings. */
  function adoptGrantedNotifications() {
    if (!window.Notification || Store.get('notifyAsked')) return;
    if (window.Notification.permission === 'granted' && !Store.get('notify')) {
      Store.set('notify', true);
      Store.set('notifyAsked', true);
      scheduleForWorker();
    }
  }

  /* Chrome tells the reader once that the app runs in chrome; a word from the
     app itself, once, keeps that from alarming anyone. */
  function maybeExplainChrome() {
    /* the page runs in the app's own web view now; there is no browser to explain */
  }

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
      var name = prayerName(k, today);
      return { key: k, name: name, at: at.getTime(), title: tongue('حان وقت ' + name), body: tongue('الله أكبر، حيّ على الصلاة') };
    });
    navigator.serviceWorker.controller.postMessage({
      type: 'schedule',
      notify: !!Store.get('notify'),
      lang: (window.I18n && window.I18n.lang) || 'ar',
      dir: (window.I18n && window.I18n.dir) || 'rtl',
      salawatTitle: tongue('صلِّ على النبي ﷺ'),
      salawatBody: tongue('اللهم صلِّ وسلِّم على نبينا محمد'),
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
    /* the day written in words, as the hijri one beside it is, since 12/10/2026
       is read the other way round in half the world and the date fields of the
       app wrote the same day as 10/12/2026, and without its year, which is
       today's and kept the line from fitting a phone of three hundred and sixty
       points */
    if ($('greg-date')) {
      $('greg-date').textContent = h.weekday + '، ' + ar(now.getDate()) + ' ' + GREG_MONTHS[now.getMonth()];
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
    toast(next === 0 ? 'التاريخ على الحساب الأصلي' : 'التاريخ معدّل ' + daysOf(Math.abs(next), true) + (next > 0 ? ' للأمام' : ' للخلف'));
  }

  function currentWindowKey() { return clockState().windowKey; }

  /* The sunan of الجمعة belong to the whole of the day, from the ghusl before
     morning to the hour of answer in العصر, so the card carries them through
     those windows. الفجر keeps its own emphasised rakahs, and after المغرب the
     night already belongs to the next day. */
  function windowSunnah(key, date) {
    /* the sunrise opens the window of the duha; it used to fall through to
       the dhuhr, and the sunrise notice quoted the rawatib of the dhuhr */
    if (key === 'sunrise') key = 'duha';
    var daytime = key === 'duha' || key === 'dhuhr' || key === 'asr';
    if (isFriday(date) && daytime && typeof FRIDAY_SUNNAH !== 'undefined') {
      return { key: 'friday', block: FRIDAY_SUNNAH };
    }
    if (typeof CURRENT_SUNNAH === 'undefined' || !CURRENT_SUNNAH[key]) return null;
    return { key: key, block: CURRENT_SUNNAH[key] };
  }

  function renderNowSunnah() {
    var host = $('now-list');
    if (!host) return;
    var pick = windowSunnah(currentWindowKey());
    if (!pick || !pick.block) { host.innerHTML = ''; return; }
    var block = pick.block;
    if ($('now-title')) $('now-title').textContent = block.l;
    var day = sunnahDay();
    var record = Store.day(day);
    host.setAttribute('data-sunnah-day', Store.dayKey(day));
    var rows = block.items.map(function (item, i) {
      return { ticks: rowTicks(pick.key, block, i), label: item };
    });
    var done = rows.filter(function (row) { return rowDone(row, record); }).length;

    if ($('now-tally')) {
      $('now-tally').textContent = ar(done) + ' من ' + ar(rows.length);
      if (done === rows.length) $('now-tally').classList.add('is-full');
      else $('now-tally').classList.remove('is-full');
    }

    var fold = $('now-fold');
    if (fold) {
      /* open unless the reader shut it: what can be done in this hour is the
         first thing under the clock, and it was folded away behind a tally */
      var open = openGroups.now !== false;
      fold.classList.toggle('is-open', open);
      var head = fold.querySelector('.fold-head');
      if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    host.innerHTML = '<p class="setting-note" style="margin-bottom:12px">' + esc(block.sub) + '</p>' +
      rows.map(function (row) { return checkRow(row, record); }).join('');
  }

  /* One tick button, for the hour card and for the list alike. A row may
     stand for more than one tick, when it says in one line what the list
     gives in two: it reads done when all of them are, and toggleCheck says
     what a touch on it marks and clears. */
  function rowDone(row, record) {
    return row.ticks.length > 0 && row.ticks.every(function (id) { return !!record.sunnah[id]; });
  }

  function checkRow(row, record) {
    var done = rowDone(row, record);
    return '<button class="check' + (done ? ' is-done' : '') + '" data-check="' + esc(row.ticks.join(' ')) +
      '" role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '">' +
      '<span class="check-box">' + icon('check') + '</span>' +
      '<span class="check-label">' + esc(row.label) +
      (row.note ? '<span class="check-note">' + esc(row.note) + '</span>' : '') + '</span></button>';
  }

  /* The days the sunnah marks out for fasting, which hijri.js already works
     out and tags. Ramadan is not among them: its fast is a duty and sits with
     the prayers, not the sunan. Nor are the two eids and the days of tashreeq,
     where the fast is forbidden and a tick would be an invitation to a wrong. */
  function fastToday(date) {
    if (typeof Hijri === 'undefined' || !Hijri.occasions) return [];
    var list = Hijri.occasions(date || new Date(), Store.get('hijriAdjust'));
    /* Ramadan carries mondays and white days of its own, and they must not be
       offered as voluntary: the month's fast is a duty already being kept. */
    var shut = list.some(function (o) { return o.kind === 'eid' || o.kind === 'month'; });
    if (shut) return [];
    return list.filter(function (o) { return o.kind === 'fast'; });
  }

  /* ---------------- one sunnah, one tick ---------------- */

  /* The day a tick belongs to. The card on the home screen says the count
     starts afresh every fajr, and so it does: the hours after midnight still
     belong to the night before, its witr and its sleep, and a tick made then
     used to land on a day whose fajr had not come, while the hour card went
     on showing the night. Where no time for the fajr can be worked out the
     calendar day stands. */
  function sunnahDay(now) {
    var d = now || new Date();
    var t = computeTimes(d);
    var back = t && typeof t.fajr === 'number' && isFinite(t.fajr) && nowMinutes(d) < t.fajr;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (back ? 1 : 0), 12);
  }

  /* The name a row of the list is ticked under. A row of the book that is a
     deed the daily wird already holds, or one the book gives twice, shares
     the tick of its other place, so the deed done once is marked wherever it
     is listed and counted once. */
  function tickOf(row) {
    return (typeof SUNNAH_SAME !== 'undefined' && SUNNAH_SAME[row]) || row;
  }

  /* What a row of the hour card ticks: the rows of the list it says again,
     never a tick of its own. It used to keep one, so the same sunnah was
     counted twice, once here and once in the list, and the list, which did
     not show these, could never be finished: 116 of 148 with everything in
     it ticked. The sunan of friday are rows of the list on a friday, under
     the names the card gives them. */
  function rowTicks(key, block, i) {
    if (key === 'friday') return ['now:friday:' + i];
    var t = block && block.t ? block.t[i] : null;
    var rows = Array.isArray(t) ? t : (t ? [t] : []);
    var out = [];
    rows.forEach(function (row) {
      var id = tickOf(row);
      if (out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  /* Everything «كل السنن» lists on a day, in its order: the sunan of
     friday on a friday, the fast on a day the sunnah marks for one, the
     daily wird, then the book. The meter counts from this same list, so it
     cannot ask for a tick the list does not offer, and it does not change
     in the middle of a day. */
  function sunnahSections(day) {
    var out = [];
    var date = day || sunnahDay();
    if (date.getDay() === 5 && typeof FRIDAY_SUNNAH !== 'undefined') {
      out.push({ key: 'friday', title: FRIDAY_SUNNAH.l, icon: 'star', note: FRIDAY_SUNNAH.sub,
        rows: FRIDAY_SUNNAH.items.map(function (item, i) { return { ticks: ['now:friday:' + i], label: item }; }) });
    }
    /* One tick for the day, with its reasons under it: a day can be a monday
       and one of the white days at once, and it is still one fast. */
    var fasts = fastToday(date);
    if (fasts.length) {
      out.push({ key: 'fast', title: 'صيام التطوع', icon: 'fast',
        note: fasts.length > 1 ? 'يجتمع في هذا اليوم أكثر من سبب للصيام' : fasts[0].note,
        rows: [{ ticks: ['fast'], label: fasts.map(function (f) { return f.name; }).join('، '),
          note: fasts.length > 1 ? fasts[0].note : '' }] });
    }
    if (typeof WIRD_ITEMS !== 'undefined') {
      out.push({ key: 'wird', title: 'الورد اليومي', icon: 'fire',
        rows: WIRD_ITEMS.map(function (item) { return { ticks: ['wird:' + item.id], label: item.t, note: item.n }; }) });
    }
    if (typeof SUNNAH_TRACKER !== 'undefined') {
      SUNNAH_TRACKER.forEach(function (group, gi) {
        out.push({ key: 'sunnah:' + gi, title: group.s, icon: group.icon || null, page: group.p,
          rows: group.i.map(function (item, ii) { return { ticks: [tickOf('sunnah:' + gi + ':' + ii)], label: item }; }) });
      });
    }
    return out;
  }

  /* The ticks a day offers, each once however many rows share it. */
  function sunnahTicks(day) {
    var seen = {}, out = [];
    sunnahSections(day).forEach(function (section) {
      section.rows.forEach(function (row) {
        row.ticks.forEach(function (id) {
          if (!seen[id]) { seen[id] = true; out.push(id); }
        });
      });
    });
    return out;
  }

  function totalSunnahCount(day) {
    return sunnahTicks(day).length;
  }

  /* Ticks kept under names that no longer stand for a row of their own: the
     hour card's (now:fajr:0 and the rest), and the rows of the book that
     share the tick of the wird. Each is carried to the tick its sunnah is
     kept under now and the old name dropped, so a day ticked before reads
     the same after. A name with nowhere to go is left as it was: the meter
     does not count it, and nothing is lost by keeping it. */
  /* A row of the card whose words were changed after its old name was last
     written keeps the meaning it had then: «الاستغفار والذكر» named no count,
     so an old tick of it is not taken for the hundred. */
  var OLD_CARD = { 'now:asr:3': ['sunnah:13:7'] };

  function movedTicks(id) {
    if (OLD_CARD[id]) return OLD_CARD[id].slice();
    var m = /^now:(fajr|duha|dhuhr|asr|maghrib|isha):(\d+)$/.exec(id);
    if (m) {
      var block = typeof CURRENT_SUNNAH !== 'undefined' ? CURRENT_SUNNAH[m[1]] : null;
      var to = block ? rowTicks(m[1], block, +m[2]) : [];
      return to.length ? to : null;
    }
    if (typeof SUNNAH_SAME !== 'undefined' && SUNNAH_SAME[id]) return [SUNNAH_SAME[id]];
    return null;
  }

  /* The list used to take on the sunan of friday at the maghrib of thursday
     and keep their ticks in thursday's record, where friday never found
     them. They belong to the friday after it, and are carried there. */
  function settleTicks() {
    var toFriday = [];
    var written = Store.eachDay(function (rec, key) {
      var s = rec.sunnah;
      if (!s || typeof s !== 'object') return false;
      var changed = false;
      Object.keys(s).forEach(function (id) {
        var to = movedTicks(id);
        if (!to) return;
        if (s[id]) to.forEach(function (t) { if (t !== id) s[t] = true; });
        delete s[id];
        changed = true;
      });
      var date = dayOfKey(key);
      if (date && date.getDay() === 4) {
        var early = Object.keys(s).filter(function (id) { return id.indexOf('now:friday:') === 0; });
        if (early.length) {
          toFriday.push({ day: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12),
            ids: early.filter(function (id) { return !!s[id]; }) });
          early.forEach(function (id) { delete s[id]; });
          changed = true;
        }
      }
      return changed;
    });
    toFriday.forEach(function (move) {
      if (!move.ids.length) return;
      Store.updateDay(function (rec) {
        move.ids.forEach(function (id) { rec.sunnah[id] = true; });
      }, move.day);
    });
    return written;
  }

  /* آية الكرسي and the three quls head the morning and the evening lists, as
     they head باب ٢٧ of the book, two entries in each. A dhikr is counted by
     its place in its list, so a day counted against the shorter lists, which
     carries no mark of the order, has its counts moved along by two, once, and
     every tap stays on the dhikr it was made on. A backup from before brings
     such days with it, so this runs after a restore as well as at the start. */
  var AZKAR_HEAD = { morning: 2, evening: 2 };

  function settleAzkar() {
    return Store.eachDay(function (rec) {
      if (+rec.azkarOrder >= Store.AZKAR_ORDER) return false;
      var changed = false;
      Object.keys(AZKAR_HEAD).forEach(function (list) {
        var counts = rec.azkar && rec.azkar[list];
        if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return;
        var moved = {};
        Object.keys(counts).forEach(function (i) {
          moved[/^\d+$/.test(i) ? +i + AZKAR_HEAD[list] : i] = counts[i];
        });
        rec.azkar[list] = moved;
        changed = true;
      });
      if (changed) rec.azkarOrder = Store.AZKAR_ORDER;
      return changed;
    });
  }

  function renderHeat(host, days) {
    if (!host) return;
    var day = sunnahDay();
    var cells = Store.heatmap(days, day, sunnahTicks);
    var todayKey = Store.dayKey(day);
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
    var day = sunnahDay();
    var c = Store.completion(day, sunnahTicks(day));
    if ($('today-done')) $('today-done').textContent = ar(c.done);
    if ($('today-total')) $('today-total').textContent = ar(c.total);
    if ($('today-meter')) $('today-meter').style.width = c.percent + '%';
    if ($('streak-line')) {
      var s = Store.streak(day);
      $('streak-line').textContent = s.current > 0
        ? inARow(s.current)
        : 'لم تبدأ اليوم بعد';
    }
    renderHeat($('home-heat'), 30);
  }

  /* Each section wears a small painting of the shore the sky of the hour is
     painted on, named after the section in img/sections. The painting only
     dresses the card, so it says nothing to a screen reader: the name and
     the note beneath it already say where the card goes. */
  var TILES = [
    { nav: 'azkar', name: 'الأذكار', note: 'أذكار وقتك وحصن المسلم' },
    { act: 'mosques', name: 'المساجد', note: 'أقرب المساجد إليك' },
    { nav: 'qada', name: 'القضاء', note: 'ما عليك من صلاة وصيام' },
    { nav: 'umrah', name: 'صفة العمرة', note: 'خطوات العمرة والمواقيت والمحظورات' },
    { nav: 'qibla', name: 'القبلة', note: 'اتجاه الكعبة' },
    { nav: 'khatma', name: 'الختمة', note: 'خطة قراءة' },
    { nav: 'hadith', name: 'الأربعون', note: 'النووية' },
    { nav: 'ruqyah', name: 'الرقية', note: 'آيات وأدعية' },
    { nav: 'dua', name: 'الأدعية', note: 'مأثورة' }
  ];

  /* The sections never change, so the grid is drawn once and kept. Drawing
     it on every return home made nine new pictures each time, and each was
     decoded again and blinked in. A grid found empty is drawn afresh. */
  function renderTiles() {
    var host = $('home-tiles');
    if (!host || host.firstElementChild) return;
    host.innerHTML = TILES.map(function (t) {
      var key = t.act || t.nav;
      return '<button class="tile" ' + (t.act ? 'data-act="' + esc(t.act) + '"' : 'data-go="' + esc(t.nav) + '"') + '>' +
        '<img class="tile-art" src="img/sections/' + esc(key) + '.webp" width="384" height="288" alt=""' +
        ' decoding="async" draggable="false">' +
        '<span class="tile-name" data-tr="tile">' + esc(t.name) + '</span>' +
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
    var said = $('daily-meaning');
    if (said) {
      said.hidden = !meaningsOn();
      if (meaningsOn()) {
        var put = function () { said.innerHTML = meaningHtml(pos.s, pos.a, false); };
        if (meanings.book) put(); else loadMeanings().then(put, function () { said.hidden = true; });
      }
    }
  }

  /* The day an occasion falls on, in the reckoning the reader lives by, so
     «بعد 152 يوماً» is answered with the date itself. */
  /* the nearest day it is recommended to fast, within the coming forty days,
     with when it falls said in words */
  /* The takbeer is not a calendar entry to be played any day of the year: it
     belongs to the days around the eid. Within three days of one, the app
     greets the reader once and offers the takbeer there, and says nothing for
     the rest of the year. Shown at most once each day. */
  function eidSoon() {
    var list = Hijri.upcoming(new Date(), Store.get('hijriAdjust')) || [];
    for (var i = 0; i < list.length; i++) {
      if (/عيد/.test(list[i].name) && list[i].days >= 0 && list[i].days <= 3) return list[i];
    }
    return null;
  }

  function offerEid() {
    var eid = eidSoon();
    if (!eid) return false;
    var mark = 'eid:' + eid.name + ':' + new Date().toDateString();
    if (Store.get('eidShown') === mark) return false;
    Store.set('eidShown', mark);
    var when = eid.days === 0 ? 'اليوم' : eid.days === 1 ? 'غداً' : 'بعد ' + daysOf(eid.days, true);
    openSheet(eid.name,
      /* the card wears the reader's own pattern and accent, not a look of its
         own: it is the app greeting them, in the app's clothes */
      '<div class="eid-card">' +
        '<div class="eid-inner">' +
          '<span class="eid-lamp">' + icon('crescent') + '</span>' +
          '<p class="eid-greet">كل عام وأنتم بخير</p>' +
          '<p class="eid-when">' + esc(eid.name + ' ' + when) + '</p>' +
          '<p class="eid-from">تهنئة من سُنّتي</p>' +
        '</div>' +
      '</div>' +
      '<div class="hisn-listen"><span class="row-body">' +
        '<span class="row-title">تكبيرات العيد</span>' +
        '<span class="row-note">بصوت خالد بوهندي</span></span>' +
        '<button class="btn btn-ghost btn-icon" data-hear="takbeer-buhendi.mp3"' +
        ' aria-label="استمع لتكبيرات العيد بصوت خالد بوهندي">' + icon('play') + '</button></div>');
    return true;
  }

  /* A tapped notification says which reminder it was, and the app opens on
     that subject. Otherwise the reader taps a friday night reminder and lands
     on the home screen, which says nothing about friday night. */
  /* Where each reminder lands when its notification is tapped. Every kind the
     app can send is named here: one that is not opens the home screen and
     says nothing more about itself, which is the whole complaint. The test
     beside this holds the two lists level. */
  var LANDINGS = {
    wird: 'quran',
    morningAdhkar: 'azkar',
    eveningAdhkar: 'azkar',
    sleepIstighfar: 'azkar',
    sleepMulk: 'quran',
    sleepKursi: 'azkar',
    duha: 'tracker',
    /* the calendar, because the reminder is about tomorrow's fast and that is
       where the fasts of the month are laid out */
    fastNote: 'calendar',
    jumuahBefore: 'tracker',
    qiyam: 'home',
    adhan: 'home'
  };

  function cameFrom(kind) {
    /* A reminder whose sound is the reciter's arrives with the quiet chime,
       since a recitation cannot be a notification's sound, and the recitation
       itself is heard once the reader opens it. */
    var recited = RECITED_SOUND[kind];
    if (recited && soundFor(kind) === 'buhendi') playRecording('audio/dua/' + recited.f, document.querySelector('.try-sound[data-try="' + kind + '"]') || 'recited-' + kind, recited.n);
    /* the night of jumuah has a sheet of its own, and that is better than a
       screen: it carries al-Kahf, the salawat and the supplication together */
    if (kind === 'jumuahNight' || kind === 'salawat') { showDueSheets(); return; }
    var where = LANDINGS[kind];
    if (where) { go(where); return; }
    showDueSheets();
  }

  function nextFast() {
    var today = new Date();
    /* A fast ends at maghrib, so after maghrib today's fast is over and the
       reader is looking for the next one, not the one he has just broken.
       Saying «صيام الخميس، اليوم» at eight in the evening is telling him about
       something already finished. */
    var past = false;
    var t = computeTimes(today);
    if (typeof t.maghrib === 'number') {
      past = (today.getHours() * 60 + today.getMinutes()) >= t.maghrib;
    }
    for (var d = 0; d < 40; d++) {
      if (d === 0 && past) continue;
      var day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
      var why = fastToday(day);
      if (!why.length) continue;
      return {
        date: day,
        days: d,
        names: why.map(function (w) { return w.name; }).join(' و'),
        when: d === 0 ? 'اليوم' : d === 1 ? 'غداً' : 'بعد ' + daysOf(d, true)
      };
    }
    return null;
  }

  function whenItFalls(g) {
    return Hijri.WEEKDAYS[g.getDay()] + ' ' + ar(g.getDate()) + ' ' + GREG_MONTHS[g.getMonth()] + ' ' + ar(g.getFullYear());
  }

  function renderUpcoming() {
    var host = $('home-upcoming');
    if (!host) return;
    var list = Hijri.upcoming(new Date(), Store.get('hijriAdjust')).slice(0, 3);
    /* The nearest voluntary fast belongs here too: it is the occasion closest
       to the reader nearly every week, and it was only on the reminders
       screen, which is not where one looks to see what is coming. */
    var fast = nextFast();
    var head = '';
    if (fast) {
      head = '<div class="row" style="cursor:default"><span class="row-mark">' + icon('fast') + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(fast.names) + '</span>' +
        '<span class="row-note">' + esc(fast.when + '، ' + whenItFalls(fast.date)) + '</span></span>' +
        '<button class="btn btn-ghost btn-icon" data-act="to-calendar" data-ref="' + esc(fast.names) + '|' + fast.date.getTime() +
        '" aria-label="أضف ' + esc(fast.names) + ' إلى تقويمك">' + icon('calendar') + '</button></div>';
    }
    if (!list.length && !head) { host.innerHTML = empty('لا مناسبة قريبة'); return; }
    host.innerHTML = head + list.map(function (o) {
      return '<div class="row" style="cursor:default"><span class="row-mark">' + icon(o.icon) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(o.name) + '</span>' +
        '<span class="row-note">' + (o.days === 0 ? 'اليوم' : 'بعد ' + daysOf(o.days, true)) +
        '، ' + whenItFalls(o.date) + '</span></span>' +
        '<button class="btn btn-ghost btn-icon" data-act="to-calendar" data-ref="' + esc(o.name) + '|' + o.date.getTime() +
        '" aria-label="أضف ' + esc(o.name) + ' إلى تقويمك">' + icon('calendar') + '</button></div>';
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
      /* The place is read here, so it is fetched here: it used to mean going to
         the settings or to the qibla to say «my place has changed». It stands
         at the head of the line, before the name it fetches, rather than at the
         far end where it read as an afterthought. */
      $('place-line').innerHTML =
        '<button class="place-locate" data-act="locate" aria-label="حدّث موقعي">' +
          icon('refresh') + '</button>' +
        '<button class="place-tap" data-go="settings" aria-label="غيّر الموقع وطريقة الحساب">' +
          '<span class="place-where">' + icon('pin') + esc(p.n) + '</span>' +
          ' <span class="place-how">تقويم ' + esc(methodName(Store.get('method'))) + '</span>' +
        '</button>';
      fitPlaceLine();
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
      '<span class="row-body"><span class="row-title" data-tr="surah">' + esc(meta.ar) +
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
      var on = chip.getAttribute('data-browse') === state.browse;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    /* the rows stand in one card, and a skeleton or an empty word does not */
    host.classList.remove('row-group');
    if (state.browse === 'juz') {
      if (!Mushaf.ready()) { host.innerHTML = skeleton(4); return; }
      var rows = '';
      for (var j = 1; j <= 30; j++) rows += juzRow(j);
      host.innerHTML = rows;
      host.classList.add('row-group');
      return;
    }

    var needle = state.filter.trim();
    var list = SURAHS.filter(function (m) { return matchesFilter(m, needle); });
    if (!list.length) { host.innerHTML = empty('لا سورة بهذا الاسم', null, null, 'search'); return; }
    host.innerHTML = list.map(surahRow).join('');
    host.classList.add('row-group');
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
    var keep = $('reader-save');
    if (keep) {
      var kept = isSurahSaved(n);
      keep.innerHTML = icon(kept ? 'check' : 'download') + '<span class="reader-save-word">' + (kept ? 'محفوظة' : 'حفظ الصوت') + '</span>';
      keep.classList.toggle('is-kept', kept);
      keep.setAttribute('aria-label', kept ? 'السورة محفوظة للاستماع بلا إنترنت، اضغط للحذف' : 'احفظ تلاوة السورة للاستماع بلا إنترنت');
      keep.setAttribute('data-surah-audio', n);
    }
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

    var spans = verses.map(function (text, i) {
      var a = i + 1;
      var cls = 'ayah' + (marked[a] ? ' is-marked' : '');
      var sajda = Mushaf.isSajda(n, a) ? '<span class="sajda-mark" title="موضع سجدة">۩</span>' : '';
      return '<span class="' + cls + '" data-ayah="' + n + ':' + a + '" data-a="' + a + '">' +
        esc(text) + sajda + '\u2060<span class="ayah-num" data-n="' + mushafDigits(a) + '" aria-label="آية ' + a + '"></span></span> ';
    });

    body.className = 'reader-body';
    /* in another language each verse stands with its meaning under it, once
       the meanings are in hand; until then, and in Arabic, the surah flows */
    if (meaningsOn() && !meanings.book) {
      loadMeanings().then(function () { if (state.view === 'reader' && state.surah === n) renderReader(); }, function () {});
    }
    if (meaningsOn() && meanings.book) {
      body.classList.add('with-meanings');
      body.innerHTML = (html ? '<div class="ayah-block">' + html + '</div>' : '') + spans.map(function (span, i) {
        return '<div class="verse-pair"><div class="ayah-block">' + span + '</div>' + meaningHtml(n, i + 1, false) + '</div>';
      }).join('') + '<p class="source meaning-source">' + esc(meaningSource()) + '</p>';
    } else {
      body.innerHTML = '<div class="ayah-block">' + html + spans.join('') + '</div>';
    }
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
      verseUrl(r.surah, r.at),
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
    toast('أتممت ' + rounds(r.times, true) + ' على ' + ayat(r.to - r.from + 1, true));
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

  /* Inside the mushaf the figures are the mushaf's own: ١٢٣, not 123. The
     rest of the app keeps the figures the reader chose. */
  function mushafDigits(n) {
    return String(n).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d]; });
  }

  var BOOKMARK_NAMES = { read: 'قراءة', review: 'مراجعة', memo: 'حفظ', ponder: 'تدبر' };

  function openNote(s, a) {
    var slot = $('tafsir-slot');
    if (!slot) return;
    var current = Store.note(s, a);
    slot.innerHTML = '<label class="setting-label" for="note-field">ملاحظتك على الآية</label>' +
      '<textarea class="field note-field" id="note-field" rows="4" placeholder="ما وقفت عنده في هذه الآية">' + esc(current) + '</textarea>' +
      '<button class="btn btn-primary btn-block" data-act="note-save" data-ref="' + s + ':' + a + '" style="margin-top:8px">احفظ الملاحظة</button>';
    var field = $('note-field');
    if (field) field.focus();
  }

  function verseSheet(s, a) {
    rememberPlace(s, a);
    var text = Mushaf.ayah(s, a);
    var meta = surahMeta(s);
    var kind = Store.bookmarkKind(s, a);
    var ref = s + ':' + a;
    var service = function (act, iconName, label, extra) {
      return '<button class="service" data-act="' + act + '" data-ref="' + ref + '"' + (extra || '') + '>' + icon(iconName) + '<span>' + label + '</span></button>';
    };
    var html = '<p class="ayah-block sheet-ayah">' + esc(text) + '</p>' +
      (meaningLang() ? '<div id="meaning-slot">' + meaningHtml(s, a, true) + '</div>' : '') +
      '<p class="source">سورة ' + esc(meta ? meta.ar : '') + '، آية ' + ar(a) +
      '، الجزء ' + ar(Mushaf.juzOf(s, a)) + '، صفحة ' + ar(Mushaf.pageOf(s, a)) + '</p>' +
      (Store.note(s, a) ? '<p class="verse-note">' + esc(Store.note(s, a)) + '</p>' : '') +
      '<div class="service-grid">' +
      service('listen', 'play', 'الاستماع للآية') +
      service('recite', 'play', 'التلاوة من هنا') +
      service('tafsir', 'info', 'تفسير الآية') +
      service('note', 'text', Store.note(s, a) ? 'ملاحظتك' : 'ملاحظة') +
      service('share', 'share', 'مشاركة الآية') +
      (canMakeVideo(s, a) ? service('share-video', 'play', 'مقطع فيديو') : '') +
      service('copy', 'text', 'نسخ الآية') +
      service('memorise', 'refresh', 'كرّر للحفظ') +
      '<button class="service" data-page="' + Mushaf.pageOf(s, a) + '">' + icon('book') + '<span>أول الصفحة</span></button>' +
      '</div>' +
      '<div class="marks" role="group" aria-label="علامة على الآية">' +
      Store.BOOKMARK_KINDS.map(function (k) {
        return '<button class="mark mark-' + k + (kind === k ? ' is-on' : '') + '" data-act="bookmark" data-ref="' + ref + '" data-kind="' + k + '" aria-pressed="' + (kind === k ? 'true' : 'false') + '">' +
          icon('bookmark') + '<span>' + BOOKMARK_NAMES[k] + '</span></button>';
      }).join('') + '</div>' +
      '<div id="tafsir-slot" style="margin-top:12px"></div>';
    openSheet('آية ' + ar(a), html);
    if (meaningLang()) {
      var fill = function () {
        var slot = $('meaning-slot');
        if (slot) slot.innerHTML = meaningHtml(s, a, true);
      };
      loadMeanings().then(function () { fill(); return loadNotes(); }).then(fill, function () {});
    }
  }

  /* ---------------- the meanings ----------------
     A reader of another language reads the Quran in Arabic, as it was sent
     down, with the meaning of each verse under it in their language, from a
     translation its publisher stands behind (docs/data/meanings, written by
     tools/i18n/meanings.js, each naming its translator and source). It is
     fetched whole once, the first time it is needed, and kept by the worker
     like the tafsir. */
  var meanings = { lang: null, book: null, loading: null, notes: null, notesLoading: null };

  function meaningLang() {
    return window.I18n && window.I18n.lang && window.I18n.lang !== 'ar' ? window.I18n.lang : null;
  }

  function meaningsOn() {
    return !!meaningLang() && Store.get('meanings') !== false;
  }

  function loadMeanings() {
    var lang = meaningLang();
    if (!lang) return Promise.resolve(null);
    if (meanings.book && meanings.lang === lang) return Promise.resolve(meanings.book);
    if (meanings.loading) return meanings.loading;
    meanings.loading = window.fetch('data/meanings/quran-' + lang + '.json')
      .then(function (r) { if (!r.ok) throw new Error('meanings ' + r.status); return r.json(); })
      .then(function (book) { meanings.book = book; meanings.lang = lang; meanings.loading = null; return book; })
      .catch(function (e) { meanings.loading = null; throw e; });
    return meanings.loading;
  }

  /* the translator's notes, kept apart and read only when a verse is opened
     on its own: some are four times the text */
  function loadNotes() {
    if (meanings.notes) return Promise.resolve(meanings.notes);
    if (!meanings.book || !meanings.book.notes) return Promise.resolve(null);
    if (meanings.notesLoading) return meanings.notesLoading;
    meanings.notesLoading = window.fetch('data/meanings/quran-' + meanings.lang + '-notes.json')
      .then(function (r) { if (!r.ok) throw new Error('notes ' + r.status); return r.json(); })
      .then(function (notes) { meanings.notes = notes; meanings.notesLoading = null; return notes; })
      .catch(function (e) { meanings.notesLoading = null; throw e; });
    return meanings.notesLoading;
  }

  function meaningOf(s, a) {
    var book = meanings.book;
    return book && book.a[s - 1] && book.a[s - 1][a - 1] ? book.a[s - 1][a - 1] : '';
  }

  /* the meaning as the page shows it: in the reader's language and marked so,
     never put through the table, which is for the app's own words */
  function meaningHtml(s, a, withNotes) {
    var text = meaningOf(s, a);
    if (!text) return '';
    var notes = withNotes && meanings.notes ? meanings.notes[s + ':' + a] : '';
    var said = ' lang="' + esc(meanings.lang) + '" dir="' + esc(window.I18n.dir) + '" translate="no"';
    return '<p class="meaning"' + said + '>' + noteMarks(text) + '</p>' +
      (notes ? '<p class="meaning-notes"' + said + '>' + noteMarks(notes) + '</p>' : '');
  }

  /* the translator's mark for a note, «[2]», written small and raised as a
     note's mark is, in the verse and before the note it points to */
  function noteMarks(text) {
    return esc(text).replace(/\[(\d+)\]/g, '<sup class="meaning-ref">$1</sup>');
  }

  /* The meanings of Hisn al-Muslim, in the languages the book's own site
     gives them, and of the forty hadiths, from HadeethEnc, in every language
     the app speaks (tools/i18n/hisn.js, tools/i18n/hadith.js). Fetched the
     first time a list of them is opened. */
  var BOOKS = { hisn: ['en'], hadith: ['en', 'ur', 'id', 'tr', 'fr', 'bn', 'fa', 'ms', 'ru', 'ha'] };
  var books = {};

  function loadBook(name) {
    var lang = meaningLang();
    if (!lang || (BOOKS[name] || []).indexOf(lang) === -1) return Promise.resolve(null);
    var held = books[name] || (books[name] = {});
    if (held.book) return Promise.resolve(held.book);
    if (held.loading) return held.loading;
    held.loading = window.fetch('data/meanings/' + name + '-' + lang + '.json')
      .then(function (r) { if (!r.ok) throw new Error(name + ' ' + r.status); return r.json(); })
      .then(function (book) { held.book = book; held.loading = null; return book; })
      .catch(function (e) { held.loading = null; throw e; });
    return held.loading;
  }

  /* the switch in the settings is the verses': it lets a surah run as in the
     mushaf, and a hadith or a dhikr keeps its meaning under it either way */
  function bookOf(name) {
    return meaningLang() && books[name] ? books[name].book || null : null;
  }

  /* a book's meanings are fetched once and the list drawn again with them */
  function withBook(name, redraw) {
    if (meaningLang() && !(books[name] && books[name].book)) loadBook(name).then(function (book) { if (book) redraw(); }, function () {});
  }

  function saidIn(text) {
    if (!text) return '';
    return '<p class="meaning" lang="' + esc(meaningLang()) + '" dir="' + esc(window.I18n.dir) + '" translate="no">' + esc(text) + '</p>';
  }

  /* the dhikr's meaning: a chapter's dhikr carries the book's own number, and
     the daily lists are matched to it by their Arabic */
  function dhikrMeaning(item, i, kind) {
    var hisn = bookOf('hisn');
    if (!hisn) return '';
    var id = kind === 'hisn' || kind === 'after' ? item.a
      : (kind === 'daily' && hisn.daily && hisn.daily[state.azkarKey] ? hisn.daily[state.azkarKey][i] : null);
    return id && hisn.d[id] ? saidIn(hisn.d[id].t) : '';
  }

  function bookSource(name) {
    var book = bookOf(name);
    return book ? '<p class="source meaning-source">' + esc('ترجمة المعاني: ' + book.source) + '</p>' : '';
  }

  /* who translated it and where it is read, in the app's words */
  function meaningSource() {
    var book = meanings.book;
    return book ? 'ترجمة المعاني: ' + book.by + '، ' + book.source : '';
  }

  /* The whole of التفسير الميسر ships with the app and is fetched once, the
     first time any tafsir is asked for, then kept by the worker; after that it
     opens at once and with the connection off. الجلالين still comes from the
     api, a verse at a time. */
  var tafsirBook = null, tafsirLoading = null;

  function loadTafsirBook() {
    if (tafsirBook) return Promise.resolve(tafsirBook);
    if (tafsirLoading) return tafsirLoading;
    tafsirLoading = window.fetch('data/tafsir-muyassar.json')
      .then(function (r) { if (!r.ok) throw new Error('tafsir ' + r.status); return r.json(); })
      .then(function (book) { tafsirBook = book; tafsirLoading = null; return book; })
      .catch(function (e) { tafsirLoading = null; throw e; });
    return tafsirLoading;
  }

  function tafsirReady() { return !!tafsirBook; }

  function loadTafsir(s, a) {
    var slot = $('tafsir-slot');
    if (!slot) return;
    slot.innerHTML = skeleton(2);
    var edition = Store.get('tafsir');
    var show = function (body, name) {
      slot.innerHTML = body
        ? '<p class="naskh"' + SAID + ' style="font-size:.95rem;line-height:2">' + esc(body) + '</p>' +
          (name ? '<p class="source">' + esc(name) + '</p>' : '')
        : '<p class="setting-note">لم يصل التفسير</p>';
    };
    if (edition === 'ar.muyassar') {
      if (!tafsirBook) slot.innerHTML = skeleton(2) + '<p class="setting-note">يُحمَّل التفسير الميسر كاملاً مرة واحدة، ثم يعمل بلا إنترنت</p>';
      loadTafsirBook().then(function (book) {
        var text = book.a[s - 1] && book.a[s - 1][a - 1];
        show(text, book.n + '، ' + book.s);
      }).catch(function () {
        slot.innerHTML = '<p class="setting-note">تحميل التفسير أول مرة يحتاج اتصالاً بالإنترنت</p>';
      });
      return;
    }
    var index = Mushaf.globalIndex(s, a);
    window.fetch('https://api.alquran.cloud/v1/ayah/' + index + '/' + edition)
      .then(function (r) { return r.json(); })
      .then(function (payload) { show(payload && payload.data && payload.data.text, 'تفسير الجلالين'); })
      .catch(function () {
        slot.innerHTML = '<p class="setting-note">التفسير يحتاج اتصالاً بالإنترنت</p>';
      });
  }

  /* The reciter is kept by id. A number stored by an older version counted
     into a list that began with a reciter since removed, so it is carried
     over: the first, the one removed, became the default, the rest moved up
     one. */
  var OLD_RECITER_IDS = [null, 'ar.abdulsamad', 'ar.abdurrahmaansudais', 'ar.mahermuaiqly', 'ar.saoodshuraym',
    'ar.husary', 'ar.husarymujawwad', 'ar.minshawi', 'ar.shaatree', 'ar.ahmedajamy', 'ar.hudhaify', 'ar.hanirifai',
    'ar.ibrahimakhbar', 'ar.muhammadayyoub', 'ar.muhammadjibreel', 'ar.abdullahbasfar', 'ar.aymanswoaid'];

  function reciter() {
    var list = typeof RECITERS !== 'undefined' ? RECITERS : [];
    var stored = Store.get('reciter');
    if (typeof stored === 'number') {
      var carried = OLD_RECITER_IDS[stored];
      stored = list.some(function (r) { return r.id === carried; }) ? carried : 'ar.minshawi';
      Store.set('reciter', stored);
    }
    return list.filter(function (r) { return r.id === stored; })[0] ||
      list.filter(function (r) { return r.id === 'ar.minshawi'; })[0] || list[0] || null;
  }

  function reciterId() {
    var pick = reciter();
    return pick ? pick.id : 'ar.minshawi';
  }

  function reciterName() {
    var pick = reciter();
    return pick ? pick.name : '';
  }

  function playAudio(url, title, sub) {
    stopAudio(true);
    /* one sound at a time: a dhikr, an adhan or the phone's speech still
       going stops here, quietly, and the name it gave the phone's player goes
       with it so the recitation is not shown under the reciter of a dua */
    if (isSpeaking()) { hushVoice(); clearMediaSession(); }
    /* if this very clip was fetched ahead while the last one sounded, that is
       the one that plays: fetching it again would put the wait back */
    var audio;
    if (state.warmClip && state.warmed === url) {
      audio = state.warmClip;
      state.warmClip = null;
      state.warmed = null;
    } else {
      audio = new window.Audio();
      audio.src = url;
    }
    try { if (audio.currentTime) audio.currentTime = 0; } catch (e) { /* not loaded yet */ }
    state.audio = audio;
    watchClip(audio);
    state.playing = { title: title, sub: sub, surah: state.recite ? state.recite.s : (state.surahAudio || null) };
    tellAppSounding(true);
    /* The shade names what is being listened to, not which verse is sounding:
       rebuilding it for every verse made the notice flash on each one, and a
       stop overtaking its own start crashed the app. */
    var sitting = state.recite ? 'سورة ' + (surahMeta(state.recite.s) || {}).ar
      : (state.surahAudio ? 'سورة ' + (surahMeta(state.surahAudio) || {}).ar : title);
    if (state.shaded !== sitting) {
      state.shaded = sitting;
      showInShade(sitting, sub, true);
    }
    var player = $('player');
    if (player) {
      player.classList.add('is-open');
      /* the previous and the next verse are a walk's alone: a single verse, a
         whole surah in one recording and the radio have nothing to step to */
      player.classList.toggle('can-step', !!state.recite);
    }
    markPlayerToggle();
    if ($('player-title')) $('player-title').textContent = title;
    if ($('player-sub')) $('player-sub').textContent = sub || '';
    /* and the page keeps its foot clear of it, as it does for the banner */
    if (player) document.documentElement.style.setProperty('--player-room', player.offsetHeight + 'px');
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

  /* The button on the bar shows what pressing it will do: pause while the
     sound plays, play while it is paused. Any clip the app starts reports its
     pauses and plays back here, so the button is never stale. */
  /* the muadhin's name, for the player the phone shows */
  function adhanName(id) {
    var list = typeof ADHAN_VOICES !== 'undefined' ? ADHAN_VOICES : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].n;
    return 'سُنّتي';
  }

  function playAdhanSample() {
    var id = adhanChoice();
    if (id === 'none') { chime(); return; }
    if (id === 'silent') return;
    /* Named, or the phone shows no player and the only way to stop it is to
       find the app again: the reader asked for this twice. And it is the
       muadhin's own recording, his adhan where he has one and his fajr where
       that is all he has, never another voice standing in for him. */
    playRecording(adhanOwnUrl(id), 'settings-adhan-try', 'الأذان، ' + adhanName(id));
  }

  /* At the prayer, with the app open, the adhan is heard in its voice. The
     phone's player names the voice actually heard, which at the fajr may be
     another muadhin's fajr standing in for one who has none, so the title
     carries the prayer and the recording carries the name. */
  function soundAdhan(key) {
    var id = adhanChoice();
    if (id === 'none' || id === 'silent' || !PRAYER_NAMES[key]) return false;
    return playRecording(adhanUrl(id, key === 'fajr'), 'settings-adhan-try', 'أذان ' + PRAYER_NAMES[key]);
  }

  /* ---------------- وضع القراءة ---------------- */

  /* The page walks down by itself so the eye can stay on the line. Three
     paces, kept between visits, and any touch gives the reader the page back. */
  var SCROLL_PACES = [
    { id: 'slow', n: 'متمهّل', px: 14 },
    { id: 'mid', n: 'متوسط', px: 26 },
    { id: 'fast', n: 'سريع', px: 44 }
  ];

  function autoScrolling() { return !!state.autoScroll; }

  function startAutoScroll() {
    stopAutoScroll(true);
    var pace = SCROLL_PACES.filter(function (p) { return p.id === (Store.get('readPace') || 'mid'); })[0] || SCROLL_PACES[1];
    var last = null;
    state.autoScroll = { pace: pace.id, frame: 0 };
    keepAwake();
    markAutoScroll(true);
    var step = function (now) {
      if (!state.autoScroll) return;
      if (last === null) last = now;
      var moved = (now - last) / 1000 * pace.px;
      if (moved >= 1) {
        last = now;
        var before = window.scrollY;
        window.scrollBy(0, moved);
        /* at the foot of the page there is nowhere left to go */
        if (window.scrollY <= before) { stopAutoScroll(true); toast('بلغت آخر الصفحة'); return; }
      }
      state.autoScroll.frame = window.requestAnimationFrame(step);
    };
    state.autoScroll.frame = window.requestAnimationFrame(step);
  }

  function stopAutoScroll(quiet) {
    if (!state.autoScroll) { markAutoScroll(false); return; }
    window.cancelAnimationFrame(state.autoScroll.frame);
    state.autoScroll = null;
    releaseAwake();
    markAutoScroll(false);
    if (!quiet) toast('توقفت القراءة');
  }

  function markAutoScroll(on) {
    ['reader-autoscroll', 'page-autoscroll'].forEach(function (id) {
      var btn = $(id);
      if (!btn) return;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function paceSheet() {
    openSheet('وضع القراءة',
      '<p class="setting-note">تتحرك الصفحة وحدها بالسرعة التي تختارها، فتقرأ بلا أن ترفع يدك، وتقف بلمسة على الشاشة</p>' +
      '<div class="mark-choices three">' +
      SCROLL_PACES.map(function (p) {
        return '<button class="btn ' + ((Store.get('readPace') || 'mid') === p.id ? 'btn-primary' : 'btn-ghost') + '" data-act="read-pace" data-ref="' + p.id + '">' + esc(p.n) + '</button>';
      }).join('') + '</div>');
  }

  function scrollToTop() {
    try { window.scrollTo({ top: 0, behavior: glide() }); } catch (e) { window.scrollTo(0, 0); }
  }

  /* The arrow shows while the reader scrolls back up, which is when it is
     wanted, and steps aside while they read on down or once the page has
     rested a moment: standing there for good it lay over a switch or a button
     on most of the long screens. */
  function watchScrollPosition() {
    var btn = $('to-top');
    if (!btn) return;
    var last = window.scrollY;
    var rest = null;
    var show = function () {
      var y = window.scrollY;
      var up = y < last;
      last = y;
      /* the bars of the mushaf hold under the clock once the page has moved
         past its top margin, and only then is the strip over them painted */
      document.documentElement.classList.toggle('is-scrolled', y > 18);
      window.clearTimeout(rest);
      btn.hidden = y < 400 || !up;
      if (!btn.hidden) rest = window.setTimeout(function () { btn.hidden = true; }, 2500);
    };
    window.addEventListener('scroll', show, { passive: true });
    btn.hidden = true;
  }

  /* ---------------- أدعية القرآن بمواضيعها ---------------- */

  /* The topics of the booklet: each holds its own supplications, and the
     verses of the qur'an that belong to it, which are read from the mushaf
     rather than written out a second time. */
  function duaTopics() {
    var book = typeof DUA_BOOK !== 'undefined' ? DUA_BOOK : [];
    var themes = typeof DUA_THEMES !== 'undefined' ? DUA_THEMES : [];
    var byId = {};
    book.forEach(function (t) { byId[t.id] = { id: t.id, n: t.n, i: t.i, v: [] }; });
    themes.forEach(function (t) {
      if (!byId[t.id]) byId[t.id] = { id: t.id, n: t.n, i: [], v: [] };
      byId[t.id].v = t.v.split(',');
    });
    var order = book.map(function (t) { return t.id; });
    themes.forEach(function (t) { if (order.indexOf(t.id) === -1) order.push(t.id); });
    return order.map(function (id) { return byId[id]; });
  }

  function renderDuaThemes() {
    var host = $('dua-themes');
    if (!host) return;
    var topics = duaTopics();
    host.innerHTML = topics.map(function (t) {
      return '<button class="topic" data-dua-theme="' + esc(t.id) + '">' +
        '<span class="topic-name">' + esc(t.n) + '</span>' +
        '<span class="topic-count">' + ar(t.i.length + t.v.length) + '</span></button>';
    }).join('');
    var tally = $('dua-book-tally');
    if (tally) tally.textContent = ar(topics.reduce(function (n, t) { return n + t.i.length; }, 0)) + ' دعاء';
    var src = $('dua-themes-source');
    if (src) src.textContent = 'أدعية مختارة من القرآن والسنة';
  }

  function openDuaTheme(id) {
    var topic = duaTopics().filter(function (t) { return t.id === id; })[0];
    if (!topic) return;
    var prose = topic.i.map(function (t, at) {
      return '<div class="dua-line"><span class="dua-text"' + SAID + '>' + esc(t) + '</span>' +
        '<button class="btn btn-ghost dua-share" data-act="share-dua" data-ref="' + esc(id) + ':' + at + '" aria-label="أرسل الدعاء صورة">' + icon('share') + '</button></div>';
    }).join('');
    var verses = topic.v.map(function (r) {
      var parts = r.split(':');
      var s = +parts[0], a = +parts[1];
      var meta = surahMeta(s);
      return '<div class="verse-line">' +
        '<button class="search-hit" data-hit="' + s + ':' + a + '">' +
        '<span class="search-hit-ref">' + esc(meta ? meta.ar : '') + '، آية ' + ar(a) + '</span>' +
        '<span class="hit-text">' + esc(Mushaf.ready() ? Mushaf.ayah(s, a) : '') + '</span></button>' +
        '<button class="btn btn-ghost dua-share" data-act="share" data-ref="' + s + ':' + a + '" aria-label="أرسل الآية صورة">' + icon('share') + '</button></div>';
    }).join('');
    openSheet('أدعية ' + topic.n,
      prose +
      (verses ? '<h2 class="section-title" style="margin-top:14px">من دعاء القرآن</h2>' + verses +
        '<p class="setting-note">اضغط أي آية لتفتحها في المصحف</p>' : ''));
  }

  function markPlayerToggle() {
    var btn = $('player-toggle');
    if (!btn) return;
    var paused = !state.audio || state.audio.paused;
    btn.innerHTML = icon(paused ? 'play' : 'pause');
    btn.setAttribute('aria-label', paused ? 'تشغيل' : 'إيقاف مؤقت');
  }

  function watchClip(clip) {
    clip.onplay = markPlayerToggle;
    clip.onpause = markPlayerToggle;
    clip.onplaying = markPlayerToggle;
  }

  /* The app keeps the page awake while something is sounding, so leaving the
     app does not cut the recitation off. */
  /* what is sounding, put in the phone's shade with something to press */
  function showInShade(title, sub, playing) {
    var app = bridge();
    if (!app || !app.showSounding) return;
    try { app.showSounding(tongue(title || ''), tongue(sub || ''), !!playing); } catch (e) { /* older package */ }
  }

  function togglePlay() {
    /* the pause in the shade, which may be sitting over a dhikr and not over a
       recitation at all */
    if (!state.audio && state.voiceClip) {
      var clip = state.voiceClip;
      try {
        if (clip.paused) { clip.play(); } else { clip.pause(); }
      } catch (e) { return; }
      updateMediaSessionState();
      if (state.shaded) showInShade(state.shaded, '', !clip.paused);
      return;
    }
    if (!state.audio) return;
    if (state.audio.paused) { state.audio.play(); } else { state.audio.pause(); }
    markPlayerToggle();
    if (state.playing) showInShade(state.playing.title, state.playing.sub, !state.audio.paused);
  }

  function tellAppSounding(on) {
    var app = bridge();
    if (!app || !app.setSounding) return;
    try { app.setSounding(!!on); } catch (e) { /* older package */ }
  }

  /* The pause between one verse and the next is not the end of listening, so
     the app is only told when the reader really stops. And «إيقاف» in the shade
     arrives here, so what it stops must be whatever is sounding: a dhikr sounds
     through the same shade and used to be left playing with no way to reach it.
     stopSpeaking runs while state.audio still stands, so it does not lower the
     flag first and leave this one lowering it twice. */
  function stopAudio(quiet) {
    if (!quiet) {
      if (state.voiceClip || state.speaking) stopSpeaking();
      tellAppSounding(false);
      state.shaded = null;
    }
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
    document.documentElement.style.setProperty('--player-room', '0px');
    markPlayerToggle();
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
      verseUrl(r.s, r.a),
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
    /* The next verse is fetched while this one is still sounding, or the
       recitation stops between every two while the app waits on the network. */
    warmNextVerse(r.s, r.a + 1);
  }

  function warmNextVerse(surah, ayah) {
    var total = Mushaf.surah(surah) ? Mushaf.surah(surah).length : 0;
    if (!total || ayah > total) return;
    var url = verseUrl(surah, ayah);
    if (state.warmed === url) return;
    state.warmed = url;
    try {
      var ahead = new window.Audio();
      ahead.preload = 'auto';
      ahead.src = url;
      ahead.load();
      state.warmClip = ahead;
    } catch (e) { /* the next one will simply be fetched when it is due */ }
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
    var meta = surahMeta(s);
    playAudio(
      verseUrl(s, a),
      'سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(a),
      reciterName()
    );
  }

  /* Where a whole surah is recorded as one file, that is what plays: the
     verse by verse files carry their own silence at each end, so a walk
     through them breaks the recitation however early each one is fetched.
     A reciter without such a recording keeps the walk, and the walk is what
     the repeat and the memorising still use. The addresses are the ones the
     source's own list of reciters gives today: the older serverN addresses
     answered every request with a redirect to these, a hop on every surah
     and a dependence on servers kept only for old links. */
  var SURAH_AUDIO = {
    'ar.mahermuaiqly': 'https://cdn.mp3quran.net/audio/maher-muaiqly/r1/',
    'ar.minshawi': 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/',
    'ar.husary': 'https://cdn.mp3quran.net/audio/mahmoud-husary/r1/',
    'ar.abdurrahmaansudais': 'https://cdn.mp3quran.net/audio/abdulrahman-sudais/r1/',
    'ar.ahmedajamy': 'https://cdn.mp3quran.net/audio/ahmad-ajmi/r1/',
    'ar.shaatree': 'https://cdn.mp3quran.net/audio/abubakr-shatri/r1/',
    'ar.muhammadjibreel': 'https://cdn.mp3quran.net/audio/muhammad-jibreel/r1/',
    'ar.abdulsamad': 'https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/',
    'ar.saoodshuraym': 'https://cdn.mp3quran.net/audio/saud-shuraim/r1/',
    'ar.hudhaify': 'https://cdn.mp3quran.net/audio/ali-hudhaifi/r1/',
    'ar.muhammadayyoub': 'https://cdn.mp3quran.net/audio/muhammad-ayyub/r1/',
    'ar.hanirifai': 'https://cdn.mp3quran.net/audio/hani-rifai/r1/',
    'ar.abdullahbasfar': 'https://cdn.mp3quran.net/audio/abdullah-basfar/r1/',
    'ar.ibrahimakhbar': 'https://cdn.mp3quran.net/audio/ibrahim-akhdar/r1/',
    'ar.husarymujawwad': 'https://cdn.mp3quran.net/audio/mahmoud-husary/r2/'
  };

  function surahAudioUrl(n) {
    var base = SURAH_AUDIO[reciterId()];
    if (!base) return null;
    var three = n < 10 ? '00' + n : (n < 100 ? '0' + n : String(n));
    return base + three + '.mp3';
  }

  /* Two ways to hear a surah, and they are not the same thing: the whole
     recording runs unbroken but cannot know which verse is sounding, while
     the walk marks each verse and turns the page but carries the silence at
     the ends of every file. The reader chooses, and the choice is kept. */
  function playSurah(n) {
    var whole = surahAudioUrl(n);
    if (!whole) { reciteFrom(n, state.ayah || 1); return; }
    if (walkKeptVerses(n)) { reciteFrom(n, state.ayah || 1); return; }
    var kept = Store.get('listenAs');
    if (kept === 'follow') { reciteFrom(n, state.ayah || 1); return; }
    if (kept === 'whole') { playWholeSurah(n); return; }
    askHowToListen(n);
  }

  function askHowToListen(n) {
    openSheet('كيف تستمع؟',
      '<p class="setting-note">تلاوة السورة كاملة بلا وقفة، من غير تعليم الآيات.</p>' +
      '<button class="btn btn-primary btn-block" data-act="listen-as" data-ref="whole:' + n + '" style="margin-top:14px">' +
        'استماع متّصل</button>' +
      '<p class="setting-note" style="margin-top: 12px;">يتم تحديد كل آية وهي تُتلى وتنتقل الصفحة معها، وبينها وقفة يسيرة.</p>' +
      '<button class="btn btn-ghost btn-block" data-act="listen-as" data-ref="follow:' + n + '" style="margin-top:14px">' +
        'تتبّع الآيات</button>' +
      '<label class="setting" style="margin-top:16px"><span class="setting-label">لا تسألني ثانية</span>' +
      '<button class="switch" id="listen-remember" role="switch" aria-checked="false" aria-label="لا تسألني ثانية"></button></label>');
    bind('listen-remember', 'click', function () {
      var on = $('listen-remember').getAttribute('aria-checked') !== 'true';
      setSwitch($('listen-remember'), on);
    });
  }

  /* A surah kept on the phone, or any surah with no network at all, is heard
     from its verses one by one: the whole recording is never kept, so it
     would only fail offline, while the kept verses answer from the phone
     itself and the network is not asked for what is already there. */
  function walkKeptVerses(n) {
    return isSurahSaved(n) || (window.navigator && window.navigator.onLine === false);
  }

  function playWholeSurah(n) {
    var whole = surahAudioUrl(n);
    if (!whole || walkKeptVerses(n)) { reciteFrom(n, state.ayah || 1); return; }
    stopRecite();
    var meta = surahMeta(n);
    state.surahAudio = n;
    playAudio(whole, 'سورة ' + (meta ? meta.ar : ''), reciterName());
    if (state.audio) {
      state.audio.onended = function () {
        state.surahAudio = null;
        stopAudio();
        toast('تمت تلاوة سورة ' + (meta ? meta.ar : ''));
      };
    }
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
    /* The page turned to is the place, so تابع القراءة finds it. Only a page
       turned to: the view opened as it was left moves nothing, since the
       reader may have read a surah since, and drawing page one at every
       opening put تابع القراءة back to الفاتحة. */
    var start = Mushaf.ready() ? Mushaf.pageStart(isBook() ? spreadOf(state.page).right : state.page) : null;
    if (start) rememberPlace(start.s, start.a);
  }

  /* One page of the mushaf as markup: the flowing text, or the printed page
     line by line. A spread is two of these side by side. */
  function pageMarkup(n, marked) {
    var verses = Mushaf.pageVerses(n);
    if (!verses.length) return empty('تعذّر بناء هذه الصفحة');
    if (Store.get('pageLayout') === 'madinah' && MADINAH_LINES) return printedPageMarkup(n, verses, marked);

    var html = '', current = 0;
    verses.forEach(function (v) {
      if (v.s !== current) {
        current = v.s;
        if (v.a === 1) {
          var meta = surahMeta(v.s);
          html += '<div class="surah-frame page-surah"><span class="surah-star"></span><h2>سورة ' + esc(meta.ar) + '</h2><span class="surah-star"></span></div>';
          if (v.s !== 1 && v.s !== 9) html += '<p class="basmala">' + esc(Mushaf.basmala()) + '</p>';
        }
      }
      var cls = 'ayah' + (marked[v.s + ':' + v.a] ? ' is-marked' : '');
      var sajda = Mushaf.isSajda(v.s, v.a) ? '<span class="sajda-mark" title="موضع سجدة">۩</span>' : '';
      html += '<span class="' + cls + '" data-ayah="' + v.s + ':' + v.a + '" data-a="' + v.a + '">' +
        esc(v.text) + sajda + '⁠<span class="ayah-num" data-n="' + mushafDigits(v.a) + '" aria-label="آية ' + v.a + '"></span></span> ';
    });
    return '<div class="ayah-block">' + html + '</div>' + pageFoot(n);
  }

  function pageFoot(n) {
    return '<div class="page-foot"><span class="page-foot-num" aria-label="صفحة ' + n + '">' + mushafDigits(n) + '</span></div>';
  }

  /* The spread a page belongs to. A printed mushaf opens with al-Fatiha on the
     right and the start of al-Baqara facing it, so a spread starts on an odd
     page, which stands on the right; the last, 604, faces 603. */
  function spreadOf(n) {
    var right = n % 2 ? n : n - 1;
    return { right: right, left: Math.min(PAGES_IN_MUSHAF, right + 1) };
  }

  function renderPage() {
    var body = $('page-body');
    if (!body) return;
    if (!Mushaf.ready()) { body.innerHTML = empty('نص المصحف لم يكتمل تحميله بعد'); return; }
    var n = state.page || +Store.get('lastPage') || 1;
    state.page = n;
    /* the printed lines arrive with the first page that wants them */
    if (Store.get('pageLayout') === 'madinah' && !MADINAH_LINES) {
      loadMadinahLines().then(function (lines) { if (lines && state.view === 'page') renderPage(); });
    }
    /* the book shows the spread the page belongs to; the phone, the page */
    var book = isBook();
    var leaves = book ? spreadOf(n) : { right: n, left: n };
    var verses = Mushaf.pageVerses(leaves.right);
    var tail = book ? Mushaf.pageVerses(leaves.left) : verses;
    if (!verses.length || !tail.length) { body.innerHTML = empty('تعذّر بناء هذه الصفحة'); return; }

    var first = verses[0], last = tail[tail.length - 1];
    var firstMeta = surahMeta(first.s), lastMeta = surahMeta(last.s);
    /* the page's own figure in the mushaf's arabic digits, to match the one
       footing the page below; ar() elsewhere stays latin, a taste not forced */
    if ($('page-title')) {
      $('page-title').textContent = book
        ? 'الصفحتان ' + mushafDigits(leaves.right) + ' و' + mushafDigits(leaves.left)
        : 'صفحة ' + mushafDigits(n);
    }
    if ($('page-meta')) {
      /* a mushaf names the quarter reached by the end of the page */
      /* arabic digits here too, so the whole of this quranic screen speaks one
         set of figures: the title, this line, and the figure footing the page */
      $('page-meta').textContent = 'الجزء ' + mushafDigits(Mushaf.juzOf(first.s, first.a)) + '، ' + hizbLabel(last.s, last.a, true) + '، ' +
        (first.s === last.s ? 'سورة ' + firstMeta.ar : 'من ' + firstMeta.ar + ' إلى ' + lastMeta.ar);
    }

    var marked = {};
    Store.bookmarks().forEach(function (b) { marked[b.s + ':' + b.a] = true; });

    /* in the book the two pages face each other across the fold, the odd one
       on the right as a printed mushaf has it, each with its own figure */
    body.innerHTML = book
      ? '<div class="spread"><div class="leaf"><div class="leaf-page">' + pageMarkup(leaves.right, marked) + '</div></div>' +
        '<div class="leaf"><div class="leaf-page">' + pageMarkup(leaves.left, marked) + '</div></div></div>'
      : pageMarkup(n, marked);
    body.classList.toggle('is-spread', book);
    fitPrintedLines(body);
    if (book) fitSpread(body);

    if ($('page-prev')) $('page-prev').disabled = leaves.right <= 1;
    if ($('page-next')) $('page-next').disabled = leaves.left >= PAGES_IN_MUSHAF;
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  /* the sunnahs of the prayers as the reader sees them today */
  function todaySunanLines() {
    var out = [];
    var host = $('tracker-list');
    if (!host) return out;
    /* the names as they stand on the screen, so the picture and the list
       cannot say different things */
    [].forEach.call(host.querySelectorAll('.check-label'), function (el) {
      var t = (el.firstChild && el.firstChild.nodeType === 3
        ? el.firstChild.nodeValue : el.textContent || '').trim();
      if (t && out.length < 12 && out.indexOf(t) === -1) out.push(t);
    });
    return out;
  }

  /* ---------------- المصحف كما طُبع ---------------- */

  var MADINAH_LINES = null;

  function loadMadinahLines() {
    if (MADINAH_LINES) return Promise.resolve(MADINAH_LINES);
    return fetch('data/madinah-lines.json').then(function (r) { return r.json(); })
      .then(function (d) { MADINAH_LINES = d.pages; return MADINAH_LINES; })
      .catch(function () { return null; });
  }

  /* The page as the Madinah mushaf prints it: fifteen lines, each ending
     where the printed line ends, and each stretched to both margins as it is
     on the page. The text is the one the app already holds; only its shape
     comes from the layout. */
  function renderPrintedPage(body, n, verses, marked) {
    body.innerHTML = printedPageMarkup(n, verses, marked);
    fitPrintedLines(body);
  }

  function printedPageMarkup(n, verses, marked) {
    var page = MADINAH_LINES[n];
    if (!page) return empty('تعذّر بناء هذه الصفحة');
    var starts = {};
    verses.forEach(function (v) { if (v.a === 1) starts[v.s] = true; });

    var html = '', opened = {};
    page.forEach(function (line) {
      /* a surah begins above the line its first word falls on */
      var first = line[0];
      if (first && starts[first[0]] && !opened[first[0]] && first[1] === 1 && first[2] === 1) {
        opened[first[0]] = true;
        var meta = surahMeta(first[0]);
        html += '<div class="surah-frame page-surah"><span class="surah-star"></span><h2>سورة ' + esc(meta.ar) + '</h2><span class="surah-star"></span></div>';
        if (first[0] !== 1 && first[0] !== 9) html += '<p class="basmala">' + esc(Mushaf.basmala()) + '</p>';
      }
      html += '<div class="mad-line">' + line.map(function (run) {
        var s = run[0], a = run[1], from = run[2], to = run[3];
        var words = (Mushaf.ayah(s, a) || '').split(' ');
        var piece = words.slice(from - 1, to).join(' ');
        var whole = to >= words.length;
        var cls = 'ayah' + (marked[s + ':' + a] ? ' is-marked' : '');
        var sajda = whole && Mushaf.isSajda(s, a) ? '<span class="sajda-mark" title="موضع سجدة">۩</span>' : '';
        return '<span class="' + cls + '" data-ayah="' + s + ':' + a + '" data-a="' + a + '">' +
          esc(piece) + sajda +
          (whole ? '\u2060<span class="ayah-num" data-n="' + mushafDigits(a) + '" aria-label="آية ' + a + '"></span>' : '') +
          '</span>';
      }).join(' ') + '</div>';
    });

    return '<div class="mad-page">' + html + '</div>' + pageFoot(n);
  }

  /* Each line carries the words of one printed line and no others, so it is
     squeezed to the width of the page rather than wrapped onto a second row,
     which is how the printed mushaf keeps its shape. */
  function fitPrintedLines(body) {
    var lines = body.querySelectorAll('.mad-line');
    [].forEach.call(lines, function (line) {
      line.style.transform = '';
      var room = line.clientWidth;
      var wide = line.scrollWidth;
      if (!room || !wide) return;
      var scale = Math.min(1, room / wide);
      if (scale < 0.999) {
        line.style.transform = 'scaleX(' + scale.toFixed(3) + ')';
      }
    });
  }

  /* In the book a spread is a mushaf laid open: both pages whole between the
     bars. The first spread was laid out as two phone pages side by side, each
     taller than the screen, so the right page was read down to its foot and
     the left one then had to be scrolled back up to, and the buttons to turn
     the page sat under the tabs.

     Both pages are now set at the one size that lets the fuller of them fit,
     found by halving, as a printed spread has one size of letter on both
     sides. The text is scaled whole, with its cartouche and its figure, and
     given the width back so it wraps across the page rather than shrinking
     into a narrow column; the printed lines keep their shape and stand in the
     middle of the leaf. Then the reader's own size for the mushaf is applied
     to the fitted page: at a hundred percent the spread fits, and larger is
     larger. Below a floor the letters would be too small to read with their
     marks, so a page that will not fit above it keeps the floor and scrolls
     inside its own leaf, the bars and the other page staying where they are. */
  var FIT_FLOOR_PX = 13;

  function fitSpread(body) {
    var folio = body && body.querySelector('.spread');
    if (!folio) return;
    var faces = [].slice.call(folio.querySelectorAll('.leaf-page'));
    var leaves = [].slice.call(folio.querySelectorAll('.leaf'));
    if (!faces.length) return;
    var printed = !!folio.querySelector('.mad-page');
    var width = 0, pageWidth = 0;
    var size = function (z) {
      faces.forEach(function (p) {
        p.style.zoom = String(z);
        /* flowing text is given its width back and wraps across the leaf; a
           printed page keeps the width of its own lines, and is narrowed only
           where it would stand wider than the leaf */
        p.style.width = Math.floor(printed ? Math.min(pageWidth, width / z) : width / z) + 'px';
      });
      if (printed) fitPrintedLines(folio);
    };
    var fits = function (z) {
      size(z);
      return leaves.every(function (leaf) { return leaf.scrollHeight <= leaf.clientHeight + 1; });
    };

    faces.forEach(function (p) { p.style.zoom = ''; p.style.width = ''; });
    folio.style.height = '';
    /* the reader's size is applied to the fitted page below, not inside it,
       or a larger size would only be shrunk back to the same fit */
    folio.style.setProperty('--quran-scale', '1');
    width = faces[0].getBoundingClientRect().width;
    var top = folio.getBoundingClientRect().top + (window.pageYOffset || 0);
    var bars = parseFloat(window.getComputedStyle(document.body).paddingBottom) || 0;
    var room = Math.floor(window.innerHeight - top - bars - 12);
    if (!width || room < 240) { folio.style.removeProperty('--quran-scale'); return; }
    folio.style.height = room + 'px';

    /* the floor as a scale: the size of the words at a hundred percent */
    var text = folio.querySelector('.ayah-block, .mad-line');
    var natural = text ? parseFloat(window.getComputedStyle(text).fontSize) || 18 : 18;
    var floor = Math.min(1, FIT_FLOOR_PX / natural);

    /* A printed line holds its own words and is never stretched, so in a
       leaf wider than the lines they stood short and ragged. The page is made
       as wide as its lines run, most of them, and may then grow until it
       fills the leaf, as a printed page is scaled to fit its sheet. */
    var most = 1;
    if (printed) {
      pageWidth = Math.min(width, printedLineWidth(folio) || width);
      most = Math.max(1, width / pageWidth);
    }

    var z = most;
    if (!fits(most)) {
      var lo = floor, hi = most;
      if (fits(lo)) {
        for (var i = 0; i < 8; i++) {
          var mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid; else hi = mid;
        }
      }
      z = lo;
    }
    var asked = (+Store.get('fontScale') || 100) / 100;
    size(z * asked);
  }

  /* how far the printed lines of a spread run, most of them: the odd short
     line that closes a surah is not the measure of the page */
  function printedLineWidth(folio) {
    var widths = [].map.call(folio.querySelectorAll('.mad-line'), function (line) {
      line.style.transform = '';
      var r = document.createRange();
      r.selectNodeContents(line);
      return r.getBoundingClientRect().width;
    }).filter(function (w) { return w > 0; }).sort(function (a, b) { return a - b; });
    return widths.length ? Math.ceil(widths[Math.floor((widths.length - 1) * 0.8)]) : 0;
  }

  /* a window resized, a phone opened further, or the face of the mushaf
     arriving after the page was first laid: each changes what fits */
  function refitSpread() {
    if (state.view === 'page' && isBook()) fitSpread($('page-body'));
  }

  /* The hizb and its quarter of a verse, from the two hundred and forty
     quarter starts. */
  function hizbLabel(s, a, arabicDigits) {
    if (typeof HIZB_QUARTERS === 'undefined') return '';
    var g = Mushaf.globalIndex(s, a);
    var q = 0;
    for (var i = 0; i < HIZB_QUARTERS.length; i++) { if (HIZB_QUARTERS[i] <= g) q = i; else break; }
    var hizb = Math.floor(q / 4) + 1, part = q % 4;
    var fig = arabicDigits ? mushafDigits(hizb) : ar(hizb);
    return 'الحزب ' + fig + (part ? ' ' + ['', 'وربعه', 'ونصفه', 'وثلاثة أرباعه'][part] : '');
  }

  function turnPage(by) {
    /* in the book a turn moves a whole spread, as a printed mushaf turns */
    var n = isBook() ? spreadOf(state.page || 1).right + by * 2 : (state.page || 1) + by;
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
      '<select class="select" id="goto-surah" data-tr="surah">' +
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
    return textCard('سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(a), text, 'quran', 'القرآن الكريم');
  }

  /* Any words on the same card: a dhikr from the book, a supplication, a
     hadith. The heading names where it is from. */
  /* the eye of the sadu with the crescent, as the icon draws it */
  function eyeMark(ctx, cx, cy, r) {
    var d = function (rr, fill) {
      ctx.beginPath(); ctx.moveTo(cx, cy - rr); ctx.lineTo(cx + rr, cy); ctx.lineTo(cx, cy + rr); ctx.lineTo(cx - rr, cy); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    };
    d(r, '#b08833'); d(r * .8, '#f3e9d2'); d(r * .6, '#1a1412');
    ctx.beginPath(); ctx.arc(cx + r * .03, cy, r * .28, 0, Math.PI * 2); ctx.fillStyle = '#f3e9d2'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * .14, cy - r * .04, r * .25, 0, Math.PI * 2); ctx.fillStyle = '#1a1412'; ctx.fill();
  }

  /* the two faces the app reads with, as the canvas needs them written */
  var FACES = {
    naskh: "'Amiri', 'Noto Naskh Arabic', serif",
    quran: "'Amiri Quran', 'Amiri', serif"
  };

  /* A shared card is drawn on light paper whatever theme the reader is in, so
     it takes the light shades of the colour they chose rather than the ones on
     their screen, which in the dark theme are far too bright for paper. */
  function cardColours() {
    var chosen = PALETTES[Store.get('accent')] || PALETTES.sadu;
    return { fill: chosen.lightInk, wash: hexToWash(chosen.light, 0.45) };
  }

  /* The foot every shared card ends with, as the verse video signs itself:
     the app's icon and name, and under them the two stores' badges as their
     owners publish them, both black shapes forty pixels tall; Apple's black
     badge reads on the light paper as it does on the night of the video. No
     address: the badges say where the app is. Small, and the name in the
     grey of a source line, so the words stay the card. It takes the card's
     last two hundred pixels above its frame. Drawn by verse-video.js, which
     draws the same under a video; without it the name stands alone. */
  function cardFoot(ctx, W, H) {
    var video = typeof VerseVideo !== 'undefined' ? VerseVideo : null;
    var face = document.fonts && document.fonts.load
      ? document.fonts.load("600 28px 'IBM Plex Sans Arabic'", 'سُنّتي').catch(function () {})
      : null;
    return Promise.all([video ? video.storeMarks() : {}, face]).then(function (got) {
      var marks = got[0] || {};
      var mid = H - 180, mark = 44, gap = 14;
      /* the icon leads the name, on the side the reader's line begins */
      var ltr = !!(window.I18n && window.I18n.dir === 'ltr');
      ctx.save();
      ctx.direction = ltr ? 'ltr' : 'rtl'; ctx.textBaseline = 'middle'; ctx.textAlign = ltr ? 'left' : 'right';
      ctx.font = "600 28px 'IBM Plex Sans Arabic', sans-serif";
      ctx.fillStyle = '#5e6c65';
      var brand = tongue('سُنّتي');
      var nameW = ctx.measureText(brand).width;
      var group = (marks.icon ? mark + gap : 0) + nameW;
      if (ltr) {
        var left = W / 2 - group / 2;
        if (marks.icon) video.drawIcon(ctx, marks.icon, left, mid - mark / 2, mark, false);
        ctx.fillText(brand, marks.icon ? left + mark + gap : left, mid);
      } else {
        var right = W / 2 + group / 2;
        if (marks.icon) video.drawIcon(ctx, marks.icon, right - mark, mid - mark / 2, mark, false);
        ctx.fillText(brand, marks.icon ? right - mark - gap : right, mid);
      }
      if (marks.apple || marks.google) video.drawBadges(ctx, W / 2, H - 136, 40, marks);
      ctx.restore();
    });
  }

  function textCard(heading, text, face, source) {
    if (!text) return Promise.resolve(null);
    /* the heading and the source are the app's words; the text is the
       verse, the dhikr or the supplication, and stays as it was written */
    heading = tongue(heading);
    source = tongue(source);

    var W = 1080, PAD = 96;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);

    var paint = cardColours();
    var fill = paint.fill, wash = paint.wash;

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
      /* the canvas knows a family, not a class name, so the app's own faces
         are named here and nothing may fall back to the browser's default */
      var quranFace = FACES[face] || FACES.naskh;
      var size = text.length > 400 ? 44 : (text.length > 220 ? 52 : 60);
      ctx.font = '400 ' + size + 'px ' + quranFace;
      ctx.direction = 'rtl';
      /* a break asked for in the text is kept: four sunnahs run together read
         as one long sentence rather than four */
      var lines = [];
      String(text).split('\n').forEach(function (part) {
        if (!part.trim()) { lines.push(''); return; }
        wrap(ctx, part.split(' '), W - PAD * 2 - 40).forEach(function (l) { lines.push(l); });
      });
      var lineHeight = Math.round(size * 2.2);
      /* eighty more at the foot than the line of text it once ended with, for
         the app's mark over the two badges */
      var H = PAD * 2 + 140 + lines.length * lineHeight + (source ? 220 : 160) + 80;
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

      /* the surah, up top, in the reader's language and its direction */
      var dir = (window.I18n && window.I18n.dir) || 'rtl';
      ctx.direction = dir; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = fill;
      ctx.font = "700 40px 'IBM Plex Sans Arabic', sans-serif";
      ctx.fillText(heading, W / 2, PAD + 40);

      /* the words, line by line, in Arabic */
      ctx.direction = 'rtl';
      ctx.fillStyle = '#16241c';
      ctx.font = '400 ' + size + 'px ' + quranFace;
      var top = PAD + 175;
      lines.forEach(function (line, i) { ctx.fillText(line, W / 2, top + i * lineHeight); });

      /* the eye of the mark closes it, then where the words come from, then
         the app */
      var footY = top + lines.length * lineHeight + 20;
      eyeMark(ctx, W / 2, footY, 22);
      ctx.fillStyle = '#5e6c65';
      ctx.direction = dir;
      if (source) {
        ctx.font = "400 30px 'IBM Plex Sans Arabic', sans-serif";
        ctx.fillText(source, W / 2, footY + 62);
      }

      /* the app as the video signs itself, the same foot every card ends with */
      return cardFoot(ctx, W, H).then(function () {
        return new Promise(function (resolve) {
          try { canvas.toBlob(function (blob) { resolve(blob); }, 'image/png'); } catch (e) { resolve(null); }
        });
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

  function sharePicture(drawing, name, title, words) {
    title = tongue(title);
    words = tongue(words);
    toast('جاري تجهيز الصورة');
    return drawing.then(function (blob) {
      if (!blob) { toast('تعذّر رسم الصورة'); return false; }
      var app = bridge();
      if (app && app.shareImage) {
        return new Promise(function (resolve) {
          var reader = new window.FileReader();
          reader.onload = function () {
            var ok = false;
            try {
              ok = app.shareImageWithText ? app.shareImageWithText(String(reader.result), name, words || '') : app.shareImage(String(reader.result), name);
            } catch (e) { ok = false; }
            if (!ok) toast('تعذّرت المشاركة من التطبيق');
            resolve(!!ok);
          };
          reader.onerror = function () { resolve(false); };
          reader.readAsDataURL(blob);
        });
      }
      var file = null;
      try { file = new window.File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
      if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: title, text: words || undefined })
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

  /* ---------------- a verse as a video ---------------- */

  /* The verse in the reciter's voice as a short upright video, made on the
     phone by js/verse-video.js, which keeps its own list of the recitations it
     can read. This part only offers it, shows it being made, and sends it.

     How a finished video leaves the app: through the wrapper's own share
     sheet, through the browser's, or as a download. The android web view has
     no navigator.share at all, so a package from before the video methods has
     no way and is offered no video. */
  function videoSharePath() {
    var app = bridge();
    if (app && app.videoBegin) return 'app';
    if (app && !inIosApp()) return '';
    try {
      var probe = new window.File([new window.Blob(['x'])], 'x.mp4', { type: 'video/mp4' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [probe] })) return 'sheet';
    } catch (e) { /* no File constructor */ }
    return app ? '' : 'download';
  }

  var videoSupported = null;

  function canMakeVideo(s, a) {
    if (typeof VerseVideo === 'undefined' || !VerseVideo.hasVoice(reciterId())) return false;
    if (videoSupported === null) {
      try { videoSupported = VerseVideo.supported(); } catch (e) { videoSupported = false; }
    }
    if (!videoSupported || !videoSharePath()) return false;
    return VerseVideo.wordCount(Mushaf.ayah(s, a) || '') <= VerseVideo.MAX_WORDS;
  }

  function videoClock(sec) {
    var n = Math.max(0, Math.round(sec));
    return ar(Math.floor(n / 60) + ':' + pad(n % 60));
  }

  function holdVideoAwake(on) {
    try {
      if (on && navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (lock) {
          if (state.video && !state.video.done) state.video.lock = lock; else lock.release();
        }).catch(function () { /* the phone keeps its own rule */ });
      } else if (!on && state.video && state.video.lock) {
        state.video.lock.release();
        state.video.lock = null;
      }
    } catch (e) { /* no wake lock here */ }
  }

  /* A recording in progress belongs to its sheet: closed, or replaced by
     another sheet, it stops, since nobody is watching what it records. */
  function stopVideo() {
    var v = state.video;
    if (!v) return;
    if (!v.done && v.job) v.job.cancel();
    holdVideoAwake(false);
    if (v.url) { try { window.URL.revokeObjectURL(v.url); } catch (e) { /* gone */ } }
    state.video = null;
  }

  /* The video is made while it plays, so a verse of twenty seconds takes
     twenty seconds and a little over three: the sheet shows the frame being
     recorded, with the recitation heard, a bar of the time, and a button to
     stop. */
  function shareVerseVideo(s, a) {
    var meta = surahMeta(s);
    var text = Mushaf.ayah(s, a);
    var surah = 'سورة ' + (meta ? meta.ar : '');
    var title = surah + ' آية ' + ar(a);
    var words = text + '\n\n' + surah + '، آية ' + ar(a) + '\nsunnati.3li.info';
    var picture = function (why) {
      if (why) toast(why);
      sharePicture(verseCard(s, a), 'ayah-' + s + '-' + a + '.png', title, words);
    };
    if (!text || !canMakeVideo(s, a)) { picture(''); return; }
    stopAudio();
    stopSpeaking();
    var id = reciterId();
    openSheet('مقطع الآية',
      '<div class="video-frame" id="video-host"></div>' +
      '<div id="video-controls">' +
      '<div class="meter" style="margin:12px 0"><span id="video-meter" style="width:0%"></span></div>' +
      '<p class="setting-note" id="video-status">تُجهَّز التلاوة والمشهد</p>' +
      '<button class="btn btn-ghost btn-block" data-act="video-stop">أوقف</button></div>');
    /* made inside the tap: the sound may only start from a touch on iOS */
    var job = VerseVideo.make({
      text: text,
      /* the verse is drawn as it was sent down, and the words around it in
         the reader's language, in the way a line of it runs */
      surah: tongue(surah),
      number: mushafDigits(a),
      by: tongue('بصوت'),
      voice: tongue(reciterName()),
      name: tongue('سُنّتي'),
      dir: window.I18n && window.I18n.dir === 'ltr' ? 'ltr' : 'rtl',
      audioUrl: VerseVideo.audioUrl(id, s, a),
      /* asked for while the recitation loads, and waited for no more than
         three seconds */
      segments: VerseVideo.timings(id, s, a),
      /* the night of the reader's own country, the country the opening
         painting is chosen by, or the plain shore where it has no scene */
      scene: VerseVideo.sceneFor(splashLand()),
      host: $('video-host'),
      /* the last frame stays in the sheet once it is made: a video element
         cannot tell the length of the recorder's file, and showed 0:00 */
      keepCanvas: true,
      onStage: function (name) {
        var line = $('video-status');
        if (!line) return;
        if (name === 'recording') line.textContent = 'يُسجَّل المقطع مع التلاوة، فأبقِ التطبيق مفتوحاً حتى يكتمل';
        else if (name === 'finishing') line.textContent = 'يُجهَّز المقطع';
      },
      onProgress: function (done, total) {
        var bar = $('video-meter'), line = $('video-status');
        if (bar) bar.style.width = Math.round(done / total * 100) + '%';
        if (line) line.textContent = 'يُسجَّل المقطع ' + videoClock(done) + ' من ' + videoClock(total) + '، فأبقِ التطبيق مفتوحاً';
      }
    });
    state.video = { s: s, a: a, words: tongue(words), title: tongue(title), job: job, done: false };
    holdVideoAwake(true);
    job.promise.then(function (out) {
      var v = state.video;
      if (!v || v.job !== job) return;
      v.done = true;
      v.out = out;
      holdVideoAwake(false);
      videoReady();
    }, function (e) {
      var code = e && e.code;
      /* stopped by the reader, the sheet has already gone with it; stopped
         by the phone, as the app went behind another or a call came, it goes now */
      var mine = state.video && state.video.job === job;
      if (mine) { holdVideoAwake(false); state.video = null; closeSheet(); }
      if (code === 'cancelled') {
        if (mine) toast('توقف التسجيل لأن التطبيق خرج من الشاشة');
        return;
      }
      if (code === 'stalled') { toast('لم يبدأ صوت التلاوة، فأعد المحاولة'); return; }
      if (code === 'audio') { picture('تعذّر تنزيل التلاوة، فأُرسلت الآية صورة'); return; }
      if (code === 'long') { picture('الآية أطول مما يتسع له المقطع، فأُرسلت صورة'); return; }
      picture('تعذّر صنع المقطع على هذا الجهاز، فأُرسلت الآية صورة');
    });
  }

  /* The finished video in the sheet, its last frame above, ready to send.
     Inside the app it goes to the share sheet at once; a browser asks for a
     tap of its own before it shares, so there the button does it. */
  function videoReady() {
    var v = state.video;
    var path = videoSharePath();
    if (path === 'download') { try { v.url = window.URL.createObjectURL(v.out.blob); } catch (e) { v.url = ''; } }
    if ($('video-controls')) {
      $('video-controls').innerHTML =
        '<p class="setting-note" id="video-status" style="margin-top:12px">' + (path === 'download' ? 'المقطع جاهز للتنزيل' : 'المقطع جاهز للإرسال') + '</p>' +
        '<button class="btn btn-primary btn-block" data-act="video-send">' + icon('share') + (path === 'download' ? 'نزّل المقطع' : 'أرسل المقطع') + '</button>' +
        '<button class="btn btn-ghost btn-block" data-act="share" data-ref="' + v.s + ':' + v.a + '" style="margin-top:8px">أرسل الآية صورة</button>';
    }
    if (path === 'app') sendVideo();
  }

  function sendVideo() {
    var v = state.video;
    if (!v || !v.out) return;
    var name = 'ayah-' + v.s + '-' + v.a + '.mp4';
    var path = videoSharePath();
    if (path === 'app') {
      VerseVideo.handOver(bridge(), v.out.blob, name, v.words).then(function (ok) {
        if (!ok) toast('تعذّرت المشاركة من التطبيق');
      });
      return;
    }
    if (path === 'sheet') {
      /* called straight from the tap, nothing awaited first: the browser
         shares only while the touch is still fresh */
      var file = new window.File([v.out.blob], name, { type: 'video/mp4' });
      navigator.share({ files: [file], title: v.title, text: v.words }).catch(function (e) {
        if (!e || e.name !== 'AbortError') toast('تعذّرت المشاركة');
      });
      return;
    }
    if (!v.url) { toast('تعذّر تنزيل المقطع'); return; }
    var link = document.createElement('a');
    link.href = v.url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('نُزّل المقطع');
  }

  /* the iPhone wrapper says so once its sheet is up, or that it could not */
  function videoHandedOver(ok) {
    if (!ok) toast('تعذّرت المشاركة من التطبيق');
  }

  /* ---------------- a surah kept for listening offline ---------------- */

  /* Every verse of the surah, in the current reciter's voice, fetched and put
     in a store the worker answers from, under the very address the player
     asks for. The store is separate from the app's cache so it survives
     updates. Each verse comes from everyayah, which lets the page read what it
     sends, so it is kept at its real size and the worker can hand the player
     the pieces it asks for. The source the app plays from sends no such word,
     so its copy can only be kept opaque, and an opaque file is charged against
     the phone's room at many times its size, which is why long surahs ran out
     of room. It is kept that way only when everyayah does not answer. */
  var AUDIO_STORE = 'sunnati-audio';
  var BYTES_PER_VERSE = 90000;

  /* The source keeps each reciter at the rate he was recorded at and refuses
     any other, so seven of the sixteen were silent while every one was asked
     at 128. The rate is the reciter's own, from the list, and 128 where the
     list names none. Every verse heard, repeated, fetched ahead or kept comes
     from this one address. */
  var CDN_AUDIO = 'https://cdn.islamic.network/quran/audio/';

  function rateOf(id) {
    var list = typeof RECITERS !== 'undefined' ? RECITERS : [];
    var pick = list.filter(function (r) { return r.id === id; })[0];
    return (pick && pick.kbps) || 128;
  }

  function verseAudioUrl(id, index) {
    return CDN_AUDIO + rateOf(id) + '/' + id + '/' + index + '.mp3';
  }

  function verseUrl(s, a) {
    return verseAudioUrl(reciterId(), Mushaf.globalIndex(s, a));
  }

  /* What a kept verse weighs, which halves with the rate. The rate is the
     one of the folder a verse is kept from, which for some reciters differs
     from the rate the app plays him at. */
  function bytesPerVerse(id) {
    var folder = /(\d+)kbps/.exec(everyAyahFolder(id));
    return Math.round(BYTES_PER_VERSE * (folder ? +folder[1] : rateOf(id)) / 128);
  }

  /* everyayah keeps every reciter in a folder of his own, named beside him in
     the list, and each verse as surah and ayah in three figures each */
  var EVERY_AYAH = 'https://everyayah.com/data/';

  function everyAyahFolder(id) {
    var list = typeof RECITERS !== 'undefined' ? RECITERS : [];
    var pick = list.filter(function (r) { return r.id === id; })[0];
    return (pick && pick.ea) || '';
  }

  function everyAyahUrl(id, s, a) {
    var folder = everyAyahFolder(id);
    if (!folder) return '';
    var three = function (x) { return x < 10 ? '00' + x : (x < 100 ? '0' + x : String(x)); };
    return EVERY_AYAH + folder + '/' + three(s) + three(a) + '.mp3';
  }

  /* A verse to keep: from everyayah, readable and at its real size, and from
     the app's own source kept opaque only when everyayah does not answer. */
  function fetchVerse(id, s, a, url) {
    var opaque = function () { return window.fetch(url, { mode: 'no-cors' }); };
    var from = everyAyahUrl(id, s, a);
    if (!from) return opaque();
    return window.fetch(from, { mode: 'cors' }).then(function (res) {
      return res && res.ok ? res : opaque();
    }, opaque);
  }

  function savedAudio() { return Store.get('audioSaved') || {}; }

  function isSurahSaved(n) {
    var by = savedAudio()[reciterId()] || {};
    return !!by[n];
  }

  /* the rate is kept with the surah, so one kept from the refused address
     can be told from one kept since */
  function rememberSaved(n, verses) {
    var all = savedAudio();
    if (!all[reciterId()]) all[reciterId()] = {};
    all[reciterId()][n] = { v: verses, at: Date.now(), k: rateOf(reciterId()) };
    Store.set('audioSaved', all);
  }

  function forgetSaved(reciter, n) {
    var all = savedAudio();
    if (all[reciter]) delete all[reciter][n];
    if (all[reciter] && !Object.keys(all[reciter]).length) delete all[reciter];
    Store.set('audioSaved', all);
  }

  function downloadSurah(n) {
    if (!window.caches) { toast('تعذّر حفظ الصوت على هذا الجهاز'); return Promise.resolve(false); }
    var verses = Mushaf.surah(n).length;
    var meta = surahMeta(n);
    if (!verses) return Promise.resolve(false);
    state.downloading = { s: n, done: 0, total: verses, stop: false };
    openSheet('حفظ سورة ' + (meta ? meta.ar : ''),
      '<p class="setting-note">بصوت ' + esc(reciterName()) + '، نحو ' + megabytes(verses * bytesPerVerse(reciterId())) + '، وتبقى في جهازك حتى تحذفها</p>' +
      '<div class="meter" style="margin:12px 0"><div class="meter-fill" id="dl-meter" style="width:0%"></div></div>' +
      '<p class="setting-note" id="dl-count">0 من ' + ar(verses) + '</p>' +
      '<button class="btn btn-ghost btn-block" data-act="download-stop">أوقف</button>');
    var urls = [];
    for (var a = 1; a <= verses; a++) urls.push(verseUrl(n, a));
    var id = reciterId();
    var job = state.downloading;
    /* what this run wrote, so a surah that does not fit leaves nothing of
       itself behind, and the first thing that went wrong, which stops the
       other two workers before the store is touched again */
    var wrote = [];
    var failure = null;
    return window.caches.open(AUDIO_STORE).then(function (store) {
      var next = 0;
      function worker() {
        if (job.stop || failure || next >= urls.length) return Promise.resolve();
        var i = next++;
        var url = urls[i];
        return store.match(url).then(function (hit) {
          if (hit) return null;
          return fetchVerse(id, n, i + 1, url).then(function (res) {
            return store.put(url, res).then(function () { wrote.push(url); });
          });
        }).then(function () {
          job.done++;
          if ($('dl-meter')) $('dl-meter').style.width = Math.round(job.done / verses * 100) + '%';
          if ($('dl-count')) $('dl-count').textContent = ar(job.done) + ' من ' + ar(verses);
          return worker();
        }, function (err) { failure = failure || err || new Error('fetch'); });
      }
      return Promise.all([worker(), worker(), worker()]);
    }).then(function () {
      if (failure) throw failure;
      var finished = !job.stop && job.done >= verses;
      state.downloading = null;
      closeSheet();
      if (finished) {
        rememberSaved(n, verses);
        toast('حُفظت سورة ' + (meta ? meta.ar : '') + ' للاستماع بلا إنترنت');
      } else {
        toast('توقف الحفظ، وما نُزّل يبقى');
      }
      renderReader();
      return finished;
    }).catch(function (err) {
      state.downloading = null;
      closeSheet();
      var full = err && (err.name === 'QuotaExceededError' || err.code === 22);
      if (!full) {
        toast('تعذّر الحفظ، فتأكد من الاتصال');
        return false;
      }
      /* The phone ran out of room, which no connection would mend, so it is
         said as it is, and what this run kept is taken back. */
      return window.caches.open(AUDIO_STORE).then(function (store) {
        return Promise.all(wrote.map(function (u) { return store.delete(u); }));
      }).catch(function () { return null; }).then(function () {
        toast('لا تتسع مساحة الحفظ في جهازك لهذه السورة، فاحذف سورة محفوظة أو أفرغ شيئاً من مساحة الهاتف ثم أعد المحاولة');
        renderReader();
        return false;
      });
    });
  }

  /* both addresses go: the reciter's own, and the 128 every surah was once
     kept from, which for seven of them holds only a refusal */
  function removeSurahAudio(reciter, n) {
    if (!window.caches) return Promise.resolve();
    var verses = Mushaf.surah(n).length;
    return window.caches.open(AUDIO_STORE).then(function (store) {
      var jobs = [];
      for (var a = 1; a <= verses; a++) {
        var index = Mushaf.globalIndex(n, a);
        jobs.push(store.delete(verseAudioUrl(reciter, index)));
        if (rateOf(reciter) !== 128) jobs.push(store.delete(CDN_AUDIO + '128/' + reciter + '/' + index + '.mp3'));
      }
      return Promise.all(jobs);
    }).then(function () { forgetSaved(reciter, n); });
  }

  /* A surah kept in one of the seven voices before each was asked at his own
     rate was kept from an address that refuses, so it holds no sound. It is
     let go, and reads as not kept, so the reader can keep it again and have
     it heard. Run once the mushaf is in, since the verses are counted from it. */
  function dropSilentSaves() {
    var all = savedAudio();
    var jobs = [];
    Object.keys(all).forEach(function (id) {
      if (rateOf(id) === 128) return;
      Object.keys(all[id] || {}).forEach(function (n) {
        if (!all[id][n] || !all[id][n].k) jobs.push(removeSurahAudio(id, +n));
      });
    });
    return Promise.all(jobs);
  }

  function megabytes(bytes) {
    var mb = bytes / 1048576;
    /* a figure the language's own table can find beside its unit */
    return ar(mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' م.ب';
  }

  /* Inside the android package the app rings by itself, so the row about the
     browser's permission goes and the app's own switch takes its place. */
  /* The adhan's own voice. The fajr has its own recordings, which carry
     الصلاة خير من النوم, so a fajr recording is used at fajr alone and an
     ordinary one at the rest. A voice may have both, and then it is heard in
     both. One with only a fajr has the first ordinary voice stand in for the
     other prayers, and one with no fajr has the first fajr in the list stand
     in at fajr. */
  function adhanVoice(id) {
    if (typeof ADHAN_VOICES === 'undefined') return null;
    return ADHAN_VOICES.filter(function (v) { return v.id === id; })[0] || null;
  }

  /* a voice has an ordinary adhan unless its only recording is a fajr */
  function hasPlainAdhan(v) {
    return !!v && (!!v.plain || !v.fajr);
  }

  function adhanFile(v, fajr) {
    return 'audio/adhan/' + v.id + (fajr ? '-fajr' : '') + '.mp3';
  }

  function adhanUrl(id, forFajr) {
    var v = adhanVoice(id);
    if (!v) return '';
    if (forFajr) {
      if (v.fajr) return adhanFile(v, true);
      var fajr = ADHAN_VOICES.filter(function (x) { return x.fajr; })[0];
      return fajr ? adhanFile(fajr, true) : adhanFile(v, false);
    }
    if (hasPlainAdhan(v)) return adhanFile(v, false);
    var plain = ADHAN_VOICES.filter(hasPlainAdhan)[0];
    return plain ? adhanFile(plain, false) : adhanFile(v, true);
  }

  /* the muadhin's own recording for hearing him in the settings: his adhan,
     or his fajr when that is all he has */
  function adhanOwnUrl(id) {
    var v = adhanVoice(id);
    return v ? adhanFile(v, !hasPlainAdhan(v)) : '';
  }

  /* The reader's choice of voice. The one listed as حاج سليمان مختار was a
     recording of al-Mujallad all along, so it went, and a reader who had
     chosen it is carried to al-Mujallad rather than left with nothing. */
  function adhanChoice() {
    var id = Store.get('adhanVoice') || 'none';
    if (id === 'mukhtar') {
      id = 'mujallad';
      Store.set('adhanVoice', id);
    }
    return id;
  }

  function fillAdhanVoices() {
    var sel = $('settings-adhan-voice');
    if (!sel || typeof ADHAN_VOICES === 'undefined') return;
    /* three kinds of sound, as every other reminder has: the phone's own
       notification tone, one of the muadhins, or nothing at all */
    fillSelect(sel, [{ value: 'none', label: 'نغمة الجهاز' }, { value: 'silent', label: 'صامت' }]
      .concat(ADHAN_VOICES.map(function (v) {
        return { value: v.id, label: v.n + (hasPlainAdhan(v) ? '' : '، أذان الفجر') };
      })), adhanChoice());
    var note = $('settings-adhan-note');
    if (note) {
      var pick = adhanChoice();
      note.textContent = pick === 'silent' ? 'يصل التنبيه بلا صوت'
        : pick === 'none' ? 'نغمة التنبيه المعتادة في هاتفك'
        : 'يُسمع عند دخول الوقت، وللفجر أذانه الذي فيه الصلاة خير من النوم';
    }
    handAdhanSoundToApp();
  }

  /* the app keeps the chosen adhan beside it, so it sounds with the app closed */
  /* A web page is only woken by periodic sync, which a web view never fires,
     so the reminder is handed to the app, which keeps its own alarm for it. */
  function handSalawatToApp() {
    var app = bridge();
    if (!app || !app.setSalawatEvery) return false;
    try {
      app.setSalawatEvery(+Store.get('salawat') || 0);
      /* «صامت» must reach the wrapper: the notification was always posted on
         the ringing channel, so a reader who chose silence still heard the
         phone's tone. An older package without the call keeps its old way. */
      /* The silence was read from «voice», which is the recitation the app
         plays while open, not the sound of the notification. The reader's own
         choice sits in the row's sound list, so silence there was written to a
         key nobody read and the phone went on ringing. */
      /* silence in the reminder's own sound row silences the notification too:
         a reader who asks for silence means the phone, not just the page */
      if (app.setSalawatSilent) app.setSalawatSilent((Store.get('voice') || 'recording') === 'none');
      return true;
    } catch (e) { return false; }
  }

  /* The last third of the night: from maghrib the night runs to the next
     fajr, and its last third begins two thirds of the way through. Worked out
     for the reader's own place, for the days ahead, and handed to the app. */
  var AFTER_ADHAN_MINUTES = 30;

  /* The night runs from maghrib to the next fajr. Its middle and the start of
     its last third are reckoned from that, not from the clock's midnight. */
  function nightMarks(day) {
    var t = computeTimes(day);
    var next = computeTimes(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1));
    if (typeof t.maghrib !== 'number' || typeof next.fajr !== 'number') return null;
    var night = (1440 - t.maghrib) + next.fajr;
    return {
      midnight: (t.maghrib + Math.round(night / 2)) % 1440,
      lastThird: (t.maghrib + Math.round(night * 2 / 3)) % 1440
    };
  }

  /* صلاة الضحى runs from the sun's rising by a spear's length, near twenty
     minutes after sunrise, until a little before the sun stands at noon. Its
     best hour is when a quarter of the day has passed, حين ترمض الفصال. */
  function duhaWindow(day) {
    var t = computeTimes(day);
    if (typeof t.sunrise !== 'number' || typeof t.dhuhr !== 'number' || typeof t.maghrib !== 'number') return null;
    return {
      from: t.sunrise + 20,
      best: t.sunrise + Math.round((t.maghrib - t.sunrise) / 4),
      to: t.dhuhr - 10
    };
  }

  function qiyamAt(day) {
    var marks = nightMarks(day);
    if (!marks) return null;
    var t = computeTimes(day);
    var minutes = t.maghrib + Math.round(((1440 - t.maghrib) + computeTimes(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)).fajr) * 2 / 3);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes, 0, 0);
  }

  /* the note says the hour it will call tonight, so the reader knows */
  function showDuhaTime() {
    var note = $('settings-duha-note');
    if (!note) return;
    var w = duhaWindow(new Date());
    note.textContent = w
      ? 'وقتها من ' + clockText(w.from) + ' إلى ' + clockText(w.to) + '، وأفضلها نحو ' + clockText(w.best)
      : 'ركعتان فأكثر بعد ارتفاع الشمس إلى قُبيل الزوال';
  }

  function showQiyamTime() {
    var note = $('settings-qiyam-note');
    if (!note) return;
    var at = qiyamAt(new Date());
    note.textContent = at
      ? 'تنبيه عند دخول الثلث الأخير من الليل، وهو الليلة عند ' + clockText(at.getHours() * 60 + at.getMinutes())
      : 'تنبيه عند دخول الثلث الأخير من الليل';
  }

  /* An occasion handed to whatever calendar the reader keeps: inside the app
     the phone's own calendar opens with it filled in, and in a browser it is
     an .ics file, which every calendar understands. Nothing is written
     anywhere without the reader confirming it. */
  function icsStamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function addToCalendar(name, date) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    name = tongue(name);
    var note = tongue('من تطبيق سُنّتي');
    var app = bridge();
    if (app && app.addToCalendar) {
      var ok = false;
      try { ok = app.addToCalendar(name, note, date.getTime(), next.getTime()); } catch (e) { ok = false; }
      if (ok) { toast('افتح تقويمك لتحفظه'); return true; }
    }
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sunnati//ar', 'BEGIN:VEVENT',
      'UID:' + icsStamp(date) + '-sunnati@3li.info',
      'DTSTAMP:' + icsStamp(new Date()) + 'T000000Z',
      'DTSTART;VALUE=DATE:' + icsStamp(date),
      'DTEND;VALUE=DATE:' + icsStamp(next),
      'SUMMARY:' + name, 'DESCRIPTION:' + note,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:' + name, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    /* an older package has no calendar door, but it can still write the file
       and hand it to whatever opens a calendar entry */
    if (app && app.saveAndOpen) {
      var saved = false;
      try { saved = app.saveAndOpen(name + '.ics', 'text/calendar', ics); } catch (e) { saved = false; }
      if (saved) { toast('حُفظ الموعد، فأضفه إلى تقويمك'); return true; }
    }
    /* a web view swallows a blob download, so it is only offered where a
       browser will really take it */
    if (app) {
      toast('حدّث التطبيق لتُضيف المواعيد إلى تقويمك');
      return false;
    }
    try {
      var url = URL.createObjectURL(new window.Blob([ics], { type: 'text/calendar' }));
      var link = document.createElement('a');
      link.href = url;
      link.download = name + '.ics';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('نُزّل الموعد، فافتحه ليُضاف إلى تقويمك');
      return true;
    } catch (e) {
      toast('تعذّرت الإضافة إلى التقويم');
      return false;
    }
  }

  /* ---------------- ورد اليوم، ونداء الجمعة ---------------- */

  /* Today's portion of the mushaf, and the friday call, worked out here for
     the days ahead and handed to the app, which delivers them whether the app
     is open or not. */
  function wirdFor(day) {
    if (!Mushaf.ready() || !Store.get('khatmaStart')) return null;
    var plan = Mushaf.khatmaPlan(Store.get('khatmaDays'));
    if (!plan || !plan.length) return null;
    var elapsed = Math.floor((day - new Date(Store.get('khatmaStart'))) / 86400000);
    var portion = plan[elapsed];
    return portion || null;
  }

  /* a reminder that comes once a week is armed for its next turn only: the
     eight day window can hold two of the same day, and the app arms the
     soonest anyway */
  function already(out, title) {
    for (var i = 0; i < out.length; i++) if (out[i].t === title) return true;
    return false;
  }

  /* ليلة الجمعة runs from the maghrib of thursday to the fajr of friday */
  /* the night is named by its thursday, so it stays one night past midnight */
  function nightKey() {
    var now = new Date();
    var day = now.getDay() === 5 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now;
    return day.toDateString();
  }

  function inJumuahNight() {
    var now = new Date();
    var minutes = now.getHours() * 60 + now.getMinutes();
    if (now.getDay() === 4) {
      var t = computeTimes(now);
      return typeof t.maghrib === 'number' && minutes >= t.maghrib;
    }
    if (now.getDay() === 5) {
      var f = computeTimes(now);
      return typeof f.fajr === 'number' && minutes < f.fajr;
    }
    return false;
  }

  /* The same two soft bells the wrapper plays, drawn here with the audio the
     browser already has, so «اسمع الصوت» sounds the very thing that will come
     out of the phone rather than a stand-in. */
  function playChime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      [880, 1320, 1760].forEach(function (hz, i) {
        var osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.value = hz;
        gain.gain.setValueAtTime([0.55, 0.30, 0.15][i] * 0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 1);
      });
      window.setTimeout(function () { try { ctx.close(); } catch (e) { /* closed already */ } }, 1400);
    } catch (e) { /* no audio here, and the phone will still sound it */ }
  }

  /* the sound the reader chose for one reminder, device unless changed */
  /* A reminder may be sounded by the app's own reciter instead of a tone. The
     file is the one the chapter already uses, so nothing is duplicated. */
  var RECITED_SOUND = {
    sleepKursi: { f: 'kursi-buhendi.mp3', n: 'آية الكرسي، بصوت خالد بوهندي' },
    jumuahBefore: { f: 'jumuah-buhendi.mp3', n: 'آية الجمعة، بصوت خالد بوهندي' }
  };

  function soundFor(key) {
    var all = Store.get('remindSound') || {};
    return all[key] || 'device';
  }

  /* The wrapper knows «chime» and «silent» and nothing else; anything else
     falls through to the ringing channel. A recitation cannot be a
     notification sound, so the notification rings the quiet chime and the
     recitation is heard when the reader opens it. It used to arrive silent,
     and since nothing played the recitation either, the reader who chose the
     reciter heard nothing at all. */
  function channelFor(key) {
    var pick = soundFor(key);
    return RECITED_SOUND[key] && pick === 'buhendi' ? 'chime' : pick;
  }

  /* The three that used to be switched off from inside their own list. Each
     has an «off» value it holds when silent; the switch writes that value or
     puts back what the reader last chose. */
  /* «wirdAt» is the key the store actually holds. «wird» is not among its
     defaults, and the store rebuilds itself from those at every start, so a
     value written under that name was wiped on the next launch: that is why
     the wird switch kept turning itself off after an update. */
  var WHEN_OFF = { jumuahBefore: 0, salawat: 0, wirdAt: '' };

  /* One place turns a stored key into the id its row carries in the page. The
     two were written out by hand in three places and drifted apart, so the
     jumuah switch was bound to an id that no longer existed and did nothing. */
  function slugFor(key) {
    return key === 'jumuahBefore' ? 'jumuah-before' : key === 'wirdAt' ? 'wird' : key;
  }

  function whenIsOn(key) {
    var v = Store.get(key);
    return String(v === null || v === undefined ? '' : v) !== String(WHEN_OFF[key]);
  }

  function setWhenOn(key, on) {
    var last = Store.get('lastWhen') || {};
    var fallback = key === 'wirdAt' ? '20:00' : 60;
    if (on) {
      /* «!== undefined» was not enough: the remembered value can itself be the
         off value, an empty string, which turned the reminder straight back
         off. Anything that is not a real choice falls back. */
      var kept = last[key];
      var real = kept !== undefined && kept !== null && String(kept) !== String(WHEN_OFF[key]);
      Store.set(key, real ? kept : fallback);
    } else {
      /* what it was is kept, so turning it on again is not a fresh guess */
      last[key] = Store.get(key);
      Store.set('lastWhen', last);
      Store.set(key, WHEN_OFF[key]);
    }
    handRemindersToApp();
    /* the salawat keeps its own alarm inside the wrapper: turning it off in
       the page means nothing until the wrapper is told, which is why a
       reminder went on arriving after the reader had switched it off */
    if (key === 'salawat') handSalawatToApp();
    renderSettings();
  }

  function reminderList() {
    var out = [];
    var now = new Date();
    var wird = Store.get('wirdAt');
    var before = +Store.get('jumuahBefore') || 0;
    /* eight days, not seven: a reminder that comes once a week would be missed
       altogether if its day had already passed when the list was made */
    for (var d = 0; d < 8; d++) {
      var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      if (wird) {
        var parts = String(wird).split(':');
        var atWird = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +parts[0], +parts[1], 0, 0);
        var portion = wirdFor(day);
        if (atWird.getTime() > Date.now() && portion) {
          out.push({ at: atWird.getTime(), t: 'وردك اليوم',
            b: 'من صفحة ' + ar(portion.from) + ' إلى صفحة ' + ar(portion.to), s: channelFor('wird'), k: 'wird' });
        }
      }
      if (Store.get('duha')) {
        var duha = duhaWindow(day);
        if (duha) {
          var atDuha = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, duha.best, 0, 0);
          if (atDuha.getTime() > Date.now()) {
            out.push({ at: atDuha.getTime(), t: 'صلاة الضحى',
              b: 'ركعتان فأكثر، ووقتها إلى قُبيل الزوال', s: channelFor('duha'), k: 'duha' });
          }
        }
      }

      /* The reader's own reminders. Morning adhkar half an hour after fajr,
         evening adhkar half an hour after asr, and the night ones at the
         bedtime the reader set. Each is off until turned on, and each carries
         the sound the reader chose for it. */
      var dayTimes = computeTimes(day);
      if (Store.get('morningAdhkar') && typeof dayTimes.fajr === 'number') {
        var atMorning = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, dayTimes.fajr + 30, 0, 0);
        if (atMorning.getTime() > Date.now()) {
          out.push({ at: atMorning.getTime(), t: 'أذكار الصباح',
            b: 'أصبحنا وأصبح الملك لله', s: channelFor('morningAdhkar'), k: 'morningAdhkar' });
        }
      }
      if (Store.get('eveningAdhkar') && typeof dayTimes.asr === 'number') {
        var atEvening = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, dayTimes.asr + 30, 0, 0);
        if (atEvening.getTime() > Date.now()) {
          out.push({ at: atEvening.getTime(), t: 'أذكار المساء',
            b: 'أمسينا وأمسى الملك لله', s: channelFor('eveningAdhkar'), k: 'eveningAdhkar' });
        }
      }
      var sleepParts = String(Store.get('sleepAt') || '22:30').split(':');
      var atSleep = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +sleepParts[0], +sleepParts[1], 0, 0);
      if (atSleep.getTime() > Date.now()) {
        if (Store.get('sleepIstighfar')) {
          out.push({ at: atSleep.getTime(), t: 'الاستغفار قبل النوم',
            b: 'أستغفر الله الذي لا إله إلا هو الحي القيوم وأتوب إليه', s: channelFor('sleepIstighfar'), k: 'sleepIstighfar' });
        }
        if (Store.get('sleepMulk')) {
          out.push({ at: atSleep.getTime() + 60000, t: 'سورة الملك قبل النوم',
            b: 'كان النبي ﷺ لا ينام حتى يقرأ ألم تنزيل السجدة وتبارك الذي بيده الملك', s: channelFor('sleepMulk'), k: 'sleepMulk' });
        }
        if (Store.get('sleepKursi')) {
          out.push({ at: atSleep.getTime() + 120000, t: 'آية الكرسي قبل النوم',
            b: 'إذا أويت إلى فراشك فاقرأ آية الكرسي، لن يزال عليك من الله حافظ', s: channelFor('sleepKursi'), k: 'sleepKursi' });
        }
      }
      /* ليلة الجمعة تدخل بغروب الخميس، فالتذكير بسننها يقع بعد المغرب لا
         بعد منتصف الليل، وهو مرة في الاسبوع لا اكثر */
      if (Store.get('jumuahNight') && d === 0 && !already(out, 'ليلة الجمعة') && inJumuahNight()) {
        /* A reminder owed tonight is armed once and once only. It used to be
           set two minutes out every single time the app was opened, so it
           arrived again and again the whole night through. */
        var putOff = +Store.get('jumuahNightAt') || 0;
        if (putOff > Date.now()) {
          out.push({ at: putOff, t: 'ليلة الجمعة',
            b: 'أكثِر من الصلاة على النبي ﷺ، فإن صلاتكم معروضة عليه', s: channelFor('jumuahNight'), k: 'jumuahNight' });
        }
      }
      if (Store.get('jumuahNight') && day.getDay() === 4 && !already(out, 'ليلة الجمعة')) {
        var eve = computeTimes(day);
        if (typeof eve.maghrib === 'number') {
          var atEve = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, eve.maghrib + 15, 0, 0);
          /* if the night has begun and its moment has passed, the reminder is
             still owed tonight: putting it off a whole week because the app
             was opened late is not a reminder of this night at all */
          var atJumuah = atEve.getTime();
          /* the night has begun and its moment has passed: it is owed tonight,
             but only if it has not already been given tonight */
          if (atJumuah <= Date.now() && d === 0 && inJumuahNight()) {
            if (Store.get('jumuahNightArmed') === nightKey()) atJumuah = 0;
            else { atJumuah = Date.now() + 120000; Store.set('jumuahNightArmed', nightKey()); Store.set('jumuahNightAt', atJumuah); }
          }
          if (atJumuah > Date.now()) {
            out.push({ at: atJumuah, t: 'ليلة الجمعة',
              b: 'أكثِر من الصلاة على النبي ﷺ، فإن صلاتكم معروضة عليه', s: channelFor('jumuahNight'), k: 'jumuahNight' });
          }
        }
      }
      /* The eve of a day the sunnah marks for fasting: the intention and the
         suhur are both of the night, so a reminder that comes with the dawn
         comes too late to be acted on. It is not deduped by name, since every
         eve in the eight days is its own night. */
      if (Store.get('fastNote')) {
        var morrow = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
        var reasons = fastToday(morrow);
        if (reasons.length) {
          var eveTimes = computeTimes(day);
          if (typeof eveTimes.maghrib === 'number') {
            var callFast = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, eveTimes.maghrib + 90, 0, 0);
            if (callFast.getTime() > Date.now()) {
              out.push({ at: callFast.getTime(), t: 'صيام الغد',
                b: reasons.map(function (r) { return r.name; }).join('، ') + '، فاعقد النية ولا تدع السحور', s: channelFor('fastNote'), k: 'fastNote' });
            }
          }
        }
      }
      if (before && day.getDay() === 5 && !already(out, 'الجمعة')) {
        var times = computeTimes(day);
        if (typeof times.dhuhr === 'number') {
          var call = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, times.dhuhr - before, 0, 0);
          if (call.getTime() > Date.now()) {
            out.push({ at: call.getTime(), t: 'الجمعة',
              b: 'اقرأ سورة الكهف، وأكثِر من الصلاة على النبي ﷺ قبل الصلاة', s: channelFor('jumuahBefore'), k: 'jumuahBefore' });
          }
        }
      }
    }
    return out;
  }

  function handRemindersToApp() {
    /* a browser rings from its own plan, which is drawn again with the change */
    webPlan.made = 0;
    var app = bridge();
    if (!app || !app.setReminders) return false;
    /* the list is drawn up in Arabic, which it checks itself against, and
       put into the reader's language as it is handed over */
    var list = reminderList().map(function (r) {
      var copy = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
      copy.t = tongue(r.t);
      copy.b = tongue(r.b);
      return copy;
    });
    try { app.setReminders(JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  /* ---------------- reminders in a browser ---------------- */

  /* Inside the app the wrapper rings each reminder at its minute, from the list
     handed to it. A browser has no wrapper and the list was never read there,
     so every reminder switched on promised a notice that never came. The page
     rings them itself while it is open or behind another app: the list holds
     only what is still to come, so a plan of it is drawn each minute and read
     for what fell due before it is drawn again. What was raised is kept on
     disk by its key and minute, so a reload never raises it twice. */
  var webPlan = { made: 0, list: [] };

  function remindsInPage() {
    var app = bridge();
    if (app && app.setReminders) return false;
    return !!(window.Notification && window.Notification.permission === 'granted');
  }

  /* the reminder list, with the qiyam the wrapper keeps on a list of its own */
  function planReminders() {
    var list = reminderList();
    if (Store.get('qiyam')) {
      var now = new Date();
      for (var d = 0; d < 2; d++) {
        var at = qiyamAt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d));
        if (at && at.getTime() > Date.now()) {
          list.push({ at: at.getTime(), t: 'قيام الليل', b: 'هذا الثلث الأخير، وفيه ينزل ربنا تبارك وتعالى',
            s: channelFor('qiyam'), k: 'qiyam' });
        }
      }
    }
    return list;
  }

  function remindInPage() {
    if (!remindsInPage()) { webPlan.list = []; webPlan.made = 0; return 0; }
    var now = Date.now();
    var raised = Store.get('reminded') || {};
    var rung = 0;
    webPlan.list.forEach(function (r) {
      /* a slow background clock is given twenty minutes, as the prayers are */
      if (r.at > now || now - r.at > 20 * 60000) return;
      var key = r.k + ':' + r.at;
      if (raised[key]) return;
      raised[key] = now;
      rung++;
      ringReminder(r);
    });
    if (rung) {
      Object.keys(raised).forEach(function (k) { if (now - raised[k] > 2 * 86400000) delete raised[k]; });
      Store.set('reminded', raised);
    }
    if (now - webPlan.made >= 60000) {
      webPlan.list = planReminders();
      webPlan.made = now;
    }
    return rung;
  }

  /* raised with the sound the reader chose for it: the phone's own, the soft
     bells, the reciter, or none */
  function ringReminder(r) {
    var recited = soundFor(r.k) === 'buhendi' && RECITED_SOUND[r.k];
    notify(r.t, r.b, r.k + ':' + r.at, r.s === 'silent' || r.s === 'chime');
    if (r.s === 'chime') playChime();
    else if (recited) playRecording('audio/dua/' + recited.f, document.querySelector('.try-sound[data-try="' + r.k + '"]'), recited.n);
  }

  /* A browser raises nothing until it is allowed to, and only the prayer switch
     ever asked: the salawat and every other reminder switched on in a browser
     promised what could never arrive. Turning one on asks the browser, and
     says so when the answer is no. Inside the app the wrapper holds that
     permission, so nothing is asked here. */
  function askToRemind() {
    if (bridge()) return;
    var N = window.Notification;
    if (!N || !N.requestPermission) { toast('تعذّرت الإشعارات على هذا الجهاز، فلن يصلك التذكير'); return; }
    if (N.permission === 'granted') return;
    if (N.permission === 'denied') { toast('الإشعارات مغلقة لسُنّتي، فاسمح بها من الإعدادات ليصلك التذكير'); return; }
    Promise.resolve(N.requestPermission()).then(function (answer) {
      if (answer !== 'granted') toast('لم يُسمح بالإشعارات، فلن يصلك التذكير');
    }).catch(function () { /* the browser would not ask */ });
  }

  function handQiyamToApp() {
    webPlan.made = 0;
    var app = bridge();
    if (!app || !app.setQiyamTimes) return false;
    if (!Store.get('qiyam')) { try { app.setQiyamTimes('[]'); } catch (e) { /* older package */ } return true; }
    var out = [];
    var now = new Date();
    for (var d = 0; d < 7; d++) {
      var at = qiyamAt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d));
      if (at && at.getTime() > Date.now()) out.push(at.getTime());
    }
    try {
      app.setQiyamTimes(JSON.stringify(out));
      /* qiyam is scheduled by its own bridge, which never read the sound the
         reader chose: it was always posted on the ringing channel, so silence
         was ignored. The wrapper is told, as the adhan and the salawat are. */
      if (app.setQiyamSound) app.setQiyamSound(channelFor('qiyam'));
      return true;
    } catch (e) { return false; }
  }

  /* On a friday the app opens with the two sunnahs of the day before it: the
     prayers upon the Prophet ﷺ, and the reading of al-Kahf. Shown once a day,
     and only if the reader has left it on. */
  /* Opened during the night of jumuah, the app says so and offers its sunnahs,
     once for that night. */
  /* Whatever sheet is due at this moment. It runs at boot, and again whenever
     the app is brought forward: a reader who tapped the notice while the app
     was already open used to be shown nothing at all, because nothing looked
     again after the first opening. */
  function showDueSheets() {
    if (document.getElementById('sheet') &&
        document.getElementById('sheet').classList.contains('is-open')) return true;
    /* The day of friday used to have a sheet of its own that opened on every
       launch from midnight to midnight. Its sunan have a section in السنن now,
       so it was saying a second time what the screen already holds, and saying
       it all day. The night's sheet remains, and stops at the fajr. */
    return maybeEidSheet() || maybeJumuahNightSheet();
  }

  function maybeJumuahNightSheet() {
    /* The notification setting is about notifications. The sheet is the app
       telling the reader, when he opens it himself, which night this is, and
       that stands whether or not he wants to be interrupted at night. */
    if (!Store.get('jumuahNightSheet') || !inJumuahNight()) return false;
    /* It greets the reader every time he opens the app through the night, not
       once and then no more: a reminder he meant to act on and did not is
       worth putting before him again. It is silenced only by his own hand,
       and stops of itself at the fajr of friday. */
    /* the reader's own postponement, not the moment the notification is armed
       for: the two used to share a key, so arming the notice at the first
       opening of the night silenced the sheet on that very opening */
    var quiet = +Store.get('jumuahNightQuiet') || 0;
    if (quiet > Date.now()) return false;
    openSheet('ليلة الجمعة',
      '<p class="setting-note">من مغرب الخميس إلى فجر الجمعة، وتُعرض كلما فتحت التطبيق حتى تؤجّلها أو تُخفيها</p>' +
      ['أكثِر من الصلاة على النبي ﷺ، فإن صلاتكم معروضة عليه',
       'اقرأ سورة الكهف، وتُجزئ ليلة الجمعة ويومها',
       'أكثِر من الدعاء، ففي الجمعة ساعة لا يُرد فيها سائل',
       'اغتسل غداً وتطيّب وبكّر إلى المسجد'].map(function (line) {
        return '<div class="dua-line"><span class="dua-text">' + esc(line) + '</span></div>';
      }).join('') +
      '<button class="btn btn-primary btn-block" data-act="open-kahf" style="margin-top:14px">افتح سورة الكهف</button>' +
      '<div class="sheet-tools">' +
        '<button class="btn btn-ghost" data-act="share-jumuah-night">' + icon('share') + 'صورة</button>' +
        '<button class="btn btn-ghost" data-act="snooze-jumuah-night">' + icon('clock') + 'ذكّرني بعد ساعة</button>' +
        '<button class="btn btn-ghost" data-act="hide-jumuah-night">' + icon('close') + 'لا تُذكّرني</button>' +
      '</div>');
    return true;
  }

  var JUMUAH_NIGHT_SUNAN = [
    'أكثِر من الصلاة على النبي ﷺ، فإن صلاتكم معروضة عليه',
    'اقرأ سورة الكهف، وتُجزئ ليلة الجمعة ويومها',
    'أكثِر من الدعاء، ففي الجمعة ساعة لا يُرد فيها سائل',
    'اغتسل غداً وتطيّب وبكّر إلى المسجد'
  ];

  function shareJumuahNight() {
    return sharePicture(
      listCard('ليلة الجمعة', JUMUAH_NIGHT_SUNAN, 'من مغرب الخميس إلى فجر الجمعة'),
      'jumuah-night.png', 'ليلة الجمعة',
      JUMUAH_NIGHT_SUNAN.join('\n') + '\n\nتطبيق سُنّتي · sunnati.3li.info');
  }

  /* A card of separate things, each in its own pill, in the app's own face:
     a list run together as a paragraph reads as one long sentence. */
  function listCard(heading, items, note) {
    heading = tongue(heading);
    note = tongue(note);
    items = items.map(tongue);
    var W = 1080, PAD = 96, GAP = 20;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    var paint = cardColours();
    var faces = ["700 46px 'IBM Plex Sans Arabic'", "500 36px 'IBM Plex Sans Arabic'", "400 27px 'IBM Plex Sans Arabic'"];
    var ready = document.fonts && document.fonts.load
      ? Promise.all(faces.map(function (f) { return document.fonts.load(f, heading); })).catch(function () {})
      : Promise.resolve();

    return ready.then(function () {
      ctx.font = "500 36px 'IBM Plex Sans Arabic', sans-serif";
      var inner = W - PAD * 2 - 72;
      var blocks = items.map(function (line) { return wrapWords(ctx, line, inner); });
      var height = 0;
      blocks.forEach(function (b) { height += b.length * 54 + 44 + GAP; });
      var H = PAD + 190 + height + 270;
      canvas.width = W; canvas.height = H;
      ctx = canvas.getContext('2d');

      ctx.fillStyle = '#f7f5ef';
      ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalAlpha = 0.07;
      for (var ly = 40; ly < H; ly += 112) for (var lx = 40; lx < W; lx += 112) cardStar(ctx, lx, ly, 22);
      ctx.restore();
      ctx.strokeStyle = paint.wash; ctx.lineWidth = 6;
      ctx.strokeRect(36, 36, W - 72, H - 72);
      ctx.strokeStyle = '#b08833'; ctx.lineWidth = 2;
      ctx.strokeRect(52, 52, W - 104, H - 104);
      cardStar(ctx, 52, 52, 14); cardStar(ctx, W - 52, 52, 14);
      cardStar(ctx, 52, H - 52, 14); cardStar(ctx, W - 52, H - 52, 14);

      ctx.direction = (window.I18n && window.I18n.dir) || 'rtl'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillStyle = paint.fill;
      ctx.font = "700 46px 'IBM Plex Sans Arabic', sans-serif";
      ctx.fillText(heading, W / 2, PAD + 34);
      if (note) {
        ctx.fillStyle = '#5e6c65';
        ctx.font = "400 27px 'IBM Plex Sans Arabic', sans-serif";
        ctx.fillText(note, W / 2, PAD + 90);
      }

      var y = PAD + 150;
      blocks.forEach(function (lines) {
        var tall = lines.length * 54 + 44;
        ctx.fillStyle = 'rgba(22, 36, 28, .05)';
        roundRect(ctx, PAD, y, W - PAD * 2, tall, 28);
        ctx.fill();
        ctx.fillStyle = '#16241c';
        ctx.font = "500 36px 'IBM Plex Sans Arabic', sans-serif";
        lines.forEach(function (line, i) {
          ctx.fillText(line, W / 2, y + 22 + 27 + i * 54);
        });
        y += tall + GAP;
      });

      /* the knot closes the list, then the app signs it as the verse card does */
      cardStar(ctx, W / 2, H - PAD - 186, 13);
      return cardFoot(ctx, W, H).then(function () {
        return new Promise(function (resolve) {
          if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
          else resolve(null);
        });
      });
    });
  }

  function wrapWords(context, text, maxWidth) {
    var lines = [], line = '';
    String(text).split(' ').forEach(function (word) {
      var probe = line ? line + ' ' + word : word;
      if (context.measureText(probe).width > maxWidth && line) { lines.push(line); line = word; }
      else line = probe;
    });
    if (line) lines.push(line);
    return lines;
  }

  /* put off to a stated hour, and only while the night still runs */
  function snoozeJumuahNight(minutes) {
    var at = Date.now() + minutes * 60000;
    Store.set('jumuahNightAt', at);
    Store.set('jumuahNightQuiet', at);
    Store.set('jumuahNightArmed', nightKey());
    handRemindersToApp();
    return at;
  }

  function handAdhanSoundToApp() {
    var app = bridge();
    if (!app) return;
    var id = adhanChoice();
    /* «صامت» is neither a recording nor the phone's tone: the notification
       must arrive with no sound at all, which only the wrapper can do, so it
       is told separately. It is told first: the iPhone package fetches no
       recording, and returning before this left its adhan ringing for a
       reader who had asked for silence. An older package without the call
       simply keeps the phone's tone. */
    try { if (app.setAdhanSilent) app.setAdhanSilent(id === 'silent'); } catch (e) { /* older package */ }
    if (!app.setAdhanSound) return;
    var recorded = id !== 'none' && id !== 'silent';
    var here = location.origin + location.pathname.replace(/[^/]*$/, '');
    try {
      app.setAdhanSound(recorded ? here + adhanUrl(id, false) : '', recorded ? here + adhanUrl(id, true) : '');
    } catch (e) { /* an older package without the call */ }
  }

  function renderAdhanRow() {
    var app = bridge();
    var row = $('settings-adhan-row');
    var webRow = $('settings-notify') ? $('settings-notify').closest('.setting') : null;
    var note = $('settings-notify-note');
    if (!row) return;
    if (!app || !app.isAdhanEnabled) { row.hidden = true; return; }
    row.hidden = false;
    if (webRow) webRow.hidden = true;
    /* the note speaks only when something is wrong; saying «التنبيه يصل من
       التطبيق نفسه في دقيقته» when all is well told the reader nothing they
       needed and took a line of the screen */
    if (note) {
      var blocked = app.canNotify && !app.canNotify();
      note.textContent = blocked ? 'الإشعارات مغلقة لسُنّتي في إعدادات الهاتف، فافتحها ليصلك الأذان' : '';
      note.hidden = !blocked;
    }
    var on = false;
    try { on = !!app.isAdhanEnabled(); } catch (e) { on = true; }
    setSwitch($('settings-adhan'), on);
  }

  function renderSavedAudio() {
    var host = $('saved-audio');
    if (!host) return;
    var all = savedAudio();
    var reciters = Object.keys(all);
    var rows = [];
    var totalBytes = 0;
    reciters.forEach(function (rid) {
      var who = (typeof RECITERS !== 'undefined' ? RECITERS : []).filter(function (r) { return r.id === rid; })[0];
      Object.keys(all[rid]).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
        var meta = surahMeta(n);
        var bytes = all[rid][n].v * bytesPerVerse(rid);
        totalBytes += bytes;
        rows.push('<div class="row"><span class="row-mark">' + ar(n) + '</span>' +
          '<span class="row-body"><span class="row-title" data-tr="surah">' + esc(meta ? meta.ar : '') + '</span>' +
          '<span class="row-note">' + esc(who ? who.name : rid) + '، ' + ayat(all[rid][n].v) + '، نحو ' + megabytes(bytes) + '</span></span>' +
          '<button class="btn btn-ghost" data-remove-audio="' + esc(rid) + ':' + n + '" aria-label="احذف">' + icon('close') + '</button></div>');
      });
    });
    host.innerHTML = rows.length
      ? rows.join('') + '<p class="setting-note" style="margin-top:8px">المجموع نحو ' + megabytes(totalBytes) + '</p>'
      : '<p class="setting-note">لم تحفظ سورة بعد، وفي المصحف عند كل سورة زر يحفظها</p>';
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
    /* Searching everything, one source must not fill the page and hide the
       rest, so each is given a share of the room. */
    var perSource = {};
    function take(text, where, key) {
      var source = key.split(':')[0];
      if (out.length >= 60) return;
      if (scope === 'all') {
        if ((perSource[source] || 0) >= 10) return;
      }
      if (Mushaf.normalize(text).indexOf(plain) !== -1 || Mushaf.expand(text).indexOf(plain) !== -1) {
        out.push({ text: text, where: where, key: key });
        perSource[source] = (perSource[source] || 0) + 1;
      }
    }
    var every = scope === 'all';
    if ((every || scope === 'hisn') && typeof HISN !== 'undefined') {
      HISN.forEach(function (c) {
        /* a chapter's name is c.t: c.title is nothing, and every hit read «حصن المسلم، undefined» */
        c.i.forEach(function (it) { take(it.t, 'حصن المسلم، ' + c.t, 'hisn:' + c.id); });
      });
    }
    if ((every || scope === 'dua') && typeof DUA_BOOK !== 'undefined') {
      DUA_BOOK.forEach(function (t) {
        t.i.forEach(function (line) { take(line, 'أدعية ' + t.n, 'dua-topic:' + t.id); });
      });
    }
    if ((every || scope === 'umrah') && typeof UMRAH_STAGES !== 'undefined') {
      UMRAH_STAGES.forEach(function (st) {
        st.i.forEach(function (line) { take(line, 'صفة العمرة، ' + st.t, 'umrah'); });
      });
      UMRAH_FORBIDDEN.forEach(function (line) { take(line, 'محظورات الإحرام', 'umrah'); });
    }
    if (every) {
      if (typeof SUNNAH_TRACKER !== 'undefined') {
        SUNNAH_TRACKER.forEach(function (g) { g.i.forEach(function (line) { take(line, g.s, 'tracker'); }); });
      }
      if (typeof AZKAR_DB !== 'undefined') {
        Object.keys(AZKAR_DB).forEach(function (k) {
          AZKAR_DB[k].items.forEach(function (item) { take(item.t, AZKAR_DB[k].title, 'azkar:' + k); });
        });
      }
      if (typeof HADITHS !== 'undefined') {
        HADITHS.forEach(function (h) { take(h.t, 'الحديث ' + ar(h.n), 'hadith'); });
      }
      if (typeof DUAS !== 'undefined') {
        DUAS.forEach(function (g) { g.items.forEach(function (d) { take(d.t, g.cat, 'dua'); }); });
      }
      return out;
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
    if (!hits.length) { host.innerHTML = empty('لا نتيجة في هذا المجال', null, null, 'search'); return; }
    host.innerHTML = hits.map(function (hit) {
      var target = hit.key.indexOf('azkar:') === 0 ? ' data-azkar="' + esc(hit.key.slice(6)) + '"'
        : hit.key.indexOf('hisn:') === 0 ? ' data-hisn="' + esc(hit.key.slice(5)) + '"'
        : hit.key.indexOf('dua-topic:') === 0 ? ' data-dua-theme="' + esc(hit.key.slice(10)) + '"'
        : ' data-go="' + esc(hit.key) + '"';
      return '<button class="search-hit"' + target + '>' +
        '<span class="search-hit-ref">' + esc(hit.where) + '</span>' +
        '<span class="hit-text">' + highlight(hit.text, needle) + '</span></button>';
    }).join('');
  }

  /* the surahs whose name or number matches what was typed */
  function surahsNamed(needle) {
    var out = [];
    if (!needle) return out;
    /* what was typed is folded as the name is: a folded name was compared with
       the words as typed, so الأنعام and إبراهيم and الإسراء were never offered */
    var plain = Mushaf.normalize(needle);
    var digits = String(needle).trim().replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
    var asNumber = parseInt(digits, 10);
    for (var i = 1; i <= 114; i++) {
      var meta = surahMeta(i);
      if (!meta) continue;
      var name = Mushaf.normalize(meta.ar);
      if ((plain && name.indexOf(plain) !== -1) || (asNumber === i && String(asNumber) === digits)) {
        out.push(meta);
      }
      if (out.length >= 4) break;
    }
    return out;
  }

  /* A blank screen under the field was all a search showed until two letters
     were typed, so it offers six words of the mushaf to start from, each of
     them found in it. */
  var SEARCH_WORDS = ['الصبر', 'الرحمة', 'التوبة', 'الجنة', 'الصلاة', 'التقوى'];

  function searchSuggestions() {
    return '<div class="chip-grid search-words" style="--cols:3">' + SEARCH_WORDS.map(function (w) {
      return '<button class="chip" data-suggest="' + esc(w) + '">' + icon('search') + esc(w) + '</button>';
    }).join('') + '</div>';
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
      if ($('search-count')) $('search-count').textContent = 'اكتب حرفين على الأقل، أو ابدأ بكلمة من هذه';
      host.innerHTML = searchSuggestions();
      return;
    }

    /* someone typing طه wants the surah, not only the verses the word falls
       in, so any surah whose name matches is offered first */
    var named = surahsNamed(needle);
    var hits = Mushaf.search(needle, { limit: 60 });
    var total = Mushaf.countMatches(needle);
    if ($('search-count')) {
      /* a surah found by its name or its number is a result, so the line does
         not say «لا نتيجة» above it */
      $('search-count').textContent = total
        ? 'وردت في ' + ayat(total, true) + '، وهذه أول ' + ar(hits.length)
        : (named.length ? 'وجدنا ' + count(named.length, 'سورة واحدة', 'سورتين', 'سور', 'سورة') : 'لا نتيجة');
    }
    var surahRows = named.map(function (m) {
      var note = Mushaf.ready() ? ayat(m.ay) + '، تبدأ في صفحة ' + ar(Mushaf.pageOf(m.n, 1)) : ayat(m.ay);
      return '<button class="row" data-open-surah="' + m.n + '">' +
        '<span class="row-mark">' + ar(m.n) + '</span>' +
        '<span class="row-body"><span class="row-title">سورة ' + esc(m.ar) + '</span>' +
        '<span class="row-note">' + note + '</span></span></button>';
    }).join('');

    if (!hits.length && !named.length) { host.innerHTML = empty('لم نجد هذه الكلمة في المصحف', null, null, 'search'); return; }
    if (!hits.length) { host.innerHTML = surahRows; return; }

    host.innerHTML = surahRows + hits.map(function (hit) {
      var meta = surahMeta(hit.s);
      return '<button class="search-hit" data-hit="' + hit.s + ':' + hit.a + '">' +
        '<span class="search-hit-ref">' + esc(meta ? meta.ar : '') + '، آية ' + ar(hit.a) + '</span>' +
        '<span class="hit-text">' + highlight(hit.text, needle) + '</span></button>';
    }).join('');
  }

  /* ---------------- bookmarks ---------------- */

  function renderBookmarks() {
    var host = $('bookmark-list');
    if (!host) return;
    var list = Store.bookmarks();
    /* the way to the mushaf belongs to an empty list, and under a full one it
       was a loud button for something the tabs already do */
    var way = document.querySelector('#v-bookmarks > .btn');
    if (way) way.hidden = list.length > 0;
    if (!list.length) {
      host.innerHTML = empty('لم تحفظ آية بعد، فافتح سورة واضغط على أي آية لحفظها', null, null, 'bookmark');
      return;
    }
    /* the four kinds, each its own group with its colour, in the order of the marks */
    var kinds = Store.BOOKMARK_KINDS.filter(function (k) { return list.some(function (b) { return (b.c || 'read') === k; }); });
    host.innerHTML = kinds.map(function (k) {
      var mine = list.filter(function (b) { return (b.c || 'read') === k; });
      return '<h2 class="section-title mark-title mark-' + k + '">' + icon('bookmark') + BOOKMARK_NAMES[k] + ' <span class="fold-tally">' + ar(mine.length) + '</span></h2>' +
        mine.map(function (b) {
          var meta = surahMeta(b.s);
          var text = Mushaf.ready() ? Mushaf.ayah(b.s, b.a) : '';
          return '<button class="search-hit mark-' + k + '" data-hit="' + b.s + ':' + b.a + '">' +
            '<span class="search-hit-ref">' + esc(meta ? meta.ar : '') + '، آية ' + ar(b.a) + '</span>' +
            '<span class="hit-text">' + esc(text) + '</span></button>';
        }).join('');
    }).join('') +
      '<button class="btn btn-ghost btn-block" data-act="clear-bookmarks" style="margin-top:14px">' +
      'امسح كل العلامات</button>';
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
      $('khatma-rate').textContent = 'نحو ' + pages(perDay, true) + ' كل يوم، أي قرابة ' +
        minutesOf(Math.max(1, Math.round(perDay * 1.6)), true) + ' من التلاوة';
    }

    var status = Mushaf.khatmaStatus(plan, khatmaElapsedDays(), Store.progress().pagesRead);
    var host = $('khatma-state');
    if (!host) return;

    var aheadLine;
    if (status.finished) aheadLine = 'أتممت الختمة، فتقبل الله منك';
    else if (status.ahead > 0) aheadLine = 'أنت متقدم ' + pages(status.ahead, true);
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
        : '') +
      /* The rest of what can be done to the plan, in the card with it and in
         the order of what each costs: the two that move a page by one, then
         the one that wipes the plan, set apart and spoken more quietly. */
      '<div class="btn-row" style="margin-top:10px">' +
        '<button class="btn btn-ghost" data-act="khatma-plus">قرأت صفحة</button>' +
        '<button class="btn btn-ghost" data-act="khatma-minus"' +
        (status.read ? '' : ' disabled') + '>تراجع</button>' +
      '</div>' +
      (status.read
        ? '<div class="khatma-reset"><button class="btn btn-ghost btn-block" data-act="khatma-restart">' +
          'ابدأ ختمة جديدة</button></div>'
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
    if (key === 'dhuhr') return 'afterprayer';
    if (key === 'asr' || key === 'maghrib') return 'evening';
    return 'sleep';
  }

  var NOW_NOTES = {
    morning: 'من بعد الفجر إلى الضحى',
    afterprayer: 'بعد كل صلاة مكتوبة',
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
      /* a search opens what it matched, since the reader asked for it */
      return '<section class="fold' + (needle ? ' is-open' : '') + '"><div class="fold-head fold-static">' +
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
      return dhikrCard({ t: item.t, n: item.n, a: item.a }, i, target, left, isDone, 'hisn');
    }).join('');
    if ($('hisn-meta')) {
      $('hisn-meta').textContent = 'الباب ' + ar(chapter.id) + '، ' + ar(done) + ' من ' + ar(chapter.i.length);
    }
    /* A chapter the reciter has recorded carries a strip to hear it, above the
       words. Only the qunut has one for now; the map is here so another can be
       added by a line rather than by a branch. */
    var heard = HISN_AUDIO[chapter.id];
    if (heard) {
      html = '<div class="hisn-listen"><span class="row-body">' +
        '<span class="row-title">استمع للدعاء</span>' +
        '<span class="row-note">بصوت ' + esc(heard.n) + '</span></span>' +
        '<button class="btn btn-ghost btn-icon" data-act="hear-hisn" data-ref="' + chapter.id +
        '" aria-label="استمع للدعاء بصوت ' + esc(heard.n) + '">' + icon('play') + '</button></div>' + html;
    }
    host.innerHTML = html + bookSource('hisn');
    withBook('hisn', function () { if (state.view === 'hisn') renderHisnChapter(); });
  }

  /* What the app's own reciter has recorded. A chapter whose whole subject is
     the recording is keyed by its number; a single dhikr that appears in
     several chapters, like Ayat al-Kursi, is matched by its opening words so
     one file serves every chapter it sits in. */
  var HISN_AUDIO = {
    32: { f: 'qunut-buhendi.mp3', n: 'خالد بوهندي' }
  };

  var DHIKR_AUDIO = [
    { starts: 'اللَّهُ لاَ إِلَهَ إِلاَّ هُوَ الْحَيُّ الْقَيُّومُ', f: 'kursi-buhendi.mp3', n: 'خالد بوهندي', t: 'آية الكرسي' }
  ];

  function bareWords(t) {
    return String(t || '').replace(/[\u064B-\u0652\u0670\u0621]/g, '').replace(/[ٱآأإ]/g, 'ا').replace(/\s+/g, '');
  }

  /* the recording for one dhikr, matched on its words with the marks stripped
     so a difference in vowelling between chapters does not miss it */
  function dhikrAudio(text) {
    var bare = bareWords(text);
    for (var i = 0; i < DHIKR_AUDIO.length; i++) {
      if (bare.indexOf(bareWords(DHIKR_AUDIO[i].starts)) !== -1) return DHIKR_AUDIO[i];
    }
    return null;
  }

  /* One dhikr on a card: the words, how often it is said, and a ring that
     fills as it is counted. Tapping anywhere on the card counts it. */
  function dhikrCard(item, i, target, left, isDone, kind) {
    var said = target - left;
    var foot = item.r ? esc(item.r) : '';
    if (target > 1) foot += (foot ? '، ' : '') + count(target, 'مرة واحدة', 'مرتان', 'مرات', 'مرة');
    return '<div class="dhikr' + (isDone ? ' is-done' : '') + '" data-dhikr="' + i + '"' +
      /* the kind travels with the card whatever it is: it used to be written
         for hisn alone, so a card of any other kind was counted as if it
         belonged to the azkar screen */
      (kind ? ' data-kind="' + kind + '"' : '') + ' role="button" tabindex="0">' +
      '<p class="dhikr-text">' + esc(item.t) + '</p>' +
      (item.n ? '<p class="dhikr-note">' + esc(item.n) + '</p>' : '') +
      dhikrMeaning(item, i, kind) +
      '<div class="dhikr-foot"><span class="source">' + foot + '</span>' +
      /* a dhikr the reciter has recorded can be heard from its own card */
      (function () {
        var heard = dhikrAudio(item.t);
        return heard ? '<button class="dhikr-share" data-hear="' + esc(heard.f) +
          '" aria-label="استمع لـ' + esc(heard.t) + ' بصوت ' + esc(heard.n) + '">' + icon('play') + '</button>' : '';
      }()) +
      '<button class="dhikr-share" data-picture="' + kind + ':' + i + '" aria-label="صورة للمشاركة">' + icon('share') + '</button>' +
      '<span class="dhikr-count' + (isDone ? ' is-done' : '') + '">' +
      ring(said, target) + '<span class="dhikr-left">' + (isDone ? icon('check') : ar(left)) + '</span></span></div></div>';
  }

  function renderAzkar() {
    renderAzkarNow();
    renderHisn();
    var host = $('azkar-groups');
    if (!host) return;
    host.innerHTML = azkarSections().filter(function (row) {
      return !isPlaceDua(row.def.title);
    }).map(function (row) {
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
    }).join('') + bookSource('hisn');
    withBook('hisn', function () { if (state.view === 'azkar-list') renderAzkarList(); });

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

  function renderTrackerPrayersNote() {
    var note = $('tracker-prayers-note');
    if (!note) return;
    /* the prayers keep the calendar's day, as صلاتي does, since this line
       leads there and the two must read the same */
    var marks = Store.prayersOf(new Date());
    var done = Store.PRAYER_KEYS.filter(function (k) { return marks[k] && marks[k] !== 'missed'; }).length;
    var st = Store.prayerStats(30);
    note.textContent = (done ? 'اليوم ' + ar(done) + ' من 5' : 'لم تُعلَّم صلاة اليوم') + (st.streak ? '، و' + inARow(st.streak) + ' بالخمس' : '');
  }

  function renderTracker() {
    renderTrackerPrayersNote();
    var host = $('tracker-list');
    if (!host) return;
    var day = sunnahDay();
    var record = Store.day(day);
    var c = Store.completion(day, sunnahTicks(day));
    host.setAttribute('data-sunnah-day', Store.dayKey(day));

    if ($('tracker-done')) $('tracker-done').textContent = ar(c.done);
    if ($('tracker-total')) $('tracker-total').textContent = ar(c.total);
    if ($('tracker-meter')) $('tracker-meter').style.width = c.percent + '%';
    if ($('tracker-streak')) {
      var s = Store.streak(day);
      $('tracker-streak').textContent = s.longest > 0
        ? 'أطول تتابع ' + daysOf(s.longest)
        : 'لا تتابع بعد';
    }
    renderHeat($('tracker-heat'), 30);

    /* Forty odd deeds in one column is a wall to scroll past. Each group folds
       shut with its own tally on the head, so a person opens the one they are
       working on and the rest stay out of the way. The sunan of friday come
       first on a friday, ticked under the names the home card gives them, so
       a deed marked in one place stands marked in the other. */
    host.innerHTML = sunnahSections(day).map(function (section) {
      var done = section.rows.filter(function (row) { return rowDone(row, record); }).length;
      var all = section.rows.length;
      var open = openGroups[section.key] === true;
      var head = '';
      if (section.note) head = '<p class="setting-note" style="margin-bottom:12px">' + esc(section.note) + '</p>';
      else if (section.page) head = '<p class="fold-source">' + esc(SUNNAH_SOURCE.t) + '، ص ' + ar(section.page) + '</p>';
      return '<section class="fold' + (open ? ' is-open' : '') + '" data-fold="' + esc(section.key) + '">' +
        '<button class="fold-head" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        (section.icon ? icon(section.icon) : '') +
        '<span class="fold-title">' + esc(section.title) + '</span>' +
        '<span class="fold-tally' + (done === all ? ' is-full' : '') + '">' +
        ar(done) + ' من ' + ar(all) + '</span>' +
        icon('chevron', 'fold-arrow') + '</button>' +
        '<div class="fold-body">' + head +
        section.rows.map(function (row) { return checkRow(row, record); }).join('') +
        '</div></section>';
    }).join('');
  }

  /* A touch marks the row, or clears it when it is already done, on the day
     the list on screen shows. A row that stands for several ticks marks the
     ones still missing, and a second touch clears only those: a slip of the
     finger on «ركعتان بعد العشاء، ثم الوتر» must not take back the witr
     already ticked in the wird. What it marked is kept with the day, so the
     second touch can come after the app was closed and opened again. */
  function dayOfKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
  }

  function toggleCheck(value, dayKey) {
    var ids = String(value || '').split(/\s+/).filter(Boolean);
    if (!ids.length) return;
    var day = dayOfKey(dayKey) || sunnahDay();
    var row = ids.join(' ');
    Store.updateDay(function (rec) {
      var missing = ids.filter(function (id) { return !rec.sunnah[id]; });
      if (missing.length) {
        missing.forEach(function (id) { rec.sunnah[id] = true; });
        if (ids.length > 1) rec.marked[row] = missing;
      } else {
        var mine = ids.length > 1 && Array.isArray(rec.marked[row]) ? rec.marked[row] : ids;
        mine.forEach(function (id) { delete rec.sunnah[id]; });
        delete rec.marked[row];
      }
    }, day);
    buzz(10);
    if (state.view === 'tracker') renderTracker();
    if (state.view === 'home') { renderNowSunnah(); renderTodayMeter(); }
    else renderTodayMeter();
  }

  /* ---------------- more ---------------- */

  var MORE_LINKS = [
    { nav: 'umrah', icon: 'ihram', name: 'صفة العمرة', note: 'من الميقات إلى التحلل، على دليل المعتمر' },
    { nav: 'qibla', icon: 'compass', name: 'القبلة', note: 'اتجاه الكعبة من موقعك' },
    { act: 'mosques', icon: 'mosque', name: 'المساجد القريبة', note: 'أقرب المساجد إليك على الخريطة' },
    { nav: 'prayers', icon: 'check', name: 'صلاتي', note: 'تتبّع صلواتك الخمس وشهرك' },
    { nav: 'azkar', icon: 'hands', name: 'الأذكار', note: 'الأذكار اليومية وحصن المسلم كاملاً' },
    { nav: 'khatma', icon: 'target', name: 'خطة الختمة', note: 'وزّع المصحف على أيامك' },
    { nav: 'radio', icon: 'radio', name: 'الإذاعة', note: 'بث مباشر ومؤقت إيقاف' },
    { nav: 'hadith', icon: 'text', name: 'من الأربعين النووية', note: 'عشرون حديثاً جامعاً' },
    { nav: 'dua', icon: 'dua', name: 'الأدعية', note: 'من الكتاب والسنة' },
    { nav: 'ruqyah', icon: 'shield', name: 'الرقية الشرعية', note: 'آيات وأدعية ثابتة' },
    { nav: 'timetable', icon: 'clock', name: 'جدول الشهر', note: 'مواقيت كل يوم في صفحة' },
    { nav: 'calendar', icon: 'calendar', name: 'التقويم الهجري', note: 'المناسبات والمواسم' },
    { nav: 'bookmarks', icon: 'bookmark', name: 'المحفوظات', note: 'تتبّع حفظك' },
    { nav: 'reminders', icon: 'bell', name: 'التذكيرات', note: 'ما ينبّهك، ومتى، وبأي صوت' },
    { nav: 'settings', icon: 'settings', name: 'الإعدادات', note: 'الحساب والمظهر والنسخ' },
    { nav: 'about', icon: 'info', name: 'عن التطبيق', note: 'المصادر وما يحتاج إنترنت' }
  ];

  /* Sixteen entries in one stack, with the settings the fourteenth, are four
     shelves under their names instead, worship, the Quran and the hadith, the
     hours and the places, and the app itself last where a phone keeps it, and
     each keeps the order the list gives it while an entry no shelf names goes
     on the first rather than going missing. */
  var MORE_SHELVES = [
    { title: 'العبادة', keys: ['umrah', 'prayers', 'azkar', 'dua', 'ruqyah'] },
    { title: 'القرآن والحديث', keys: ['khatma', 'bookmarks', 'radio', 'hadith'] },
    { title: 'المواقيت والأماكن', keys: ['qibla', 'mosques', 'timetable', 'calendar'] },
    { title: 'التطبيق', keys: ['reminders', 'settings', 'about'] }
  ];

  function renderMore() {
    var host = $('more-list');
    if (!host) return;
    var row = function (l) {
      return '<button class="row" ' + (l.act ? 'data-act="' + esc(l.act) + '"' : 'data-go="' + esc(l.nav) + '"') + '>' +
        '<span class="row-mark">' + icon(l.icon) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(l.name) + '</span>' +
        '<span class="row-note">' + esc(l.note) + '</span></span></button>';
    };
    var shelved = {};
    MORE_SHELVES.forEach(function (shelf) { shelf.keys.forEach(function (k) { shelved[k] = true; }); });
    host.innerHTML = MORE_SHELVES.map(function (shelf, i) {
      var links = MORE_LINKS.filter(function (l) {
        var key = l.nav || l.act;
        return shelf.keys.indexOf(key) !== -1 || (i === 0 && !shelved[key]);
      });
      if (!links.length) return '';
      return '<h2 class="section-title">' + esc(shelf.title) + '</h2>' +
        '<div class="row-group">' + links.map(row).join('') + '</div>';
    }).join('');
    if ($('version-line')) $('version-line').textContent = 'النسخة ' + ar(VERSION) + packageLine();
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

  /* ---------------- صفة العمرة ---------------- */

  /* Where the traveller stands: the first stage that is not finished. Not the
     last one ticked, because a person may tick out of order and would then be
     told they are behind where they are. */
  function umrahHere(done) {
    for (var i = 0; i < UMRAH_STAGES.length; i++) {
      var stage = UMRAH_STAGES[i];
      var all = stage.i.every(function (_, ii) { return done[stage.id + ':' + ii]; });
      if (!all) return i;
    }
    return UMRAH_STAGES.length;   /* the rite is done */
  }

  /* The path across the head of the screen, and a word about where you are.
     A checklist tells you what is left; a journey tells you where you stand,
     and these are not the same thing to someone standing in a crowd. */
  /* The names of the stops stand whole under their marks, a long word a
     little past its stop where the card has the room. When the phone's text
     is so large that two names would touch, or one would pass the card, the
     names are set a step smaller, and if even then they touch a word may
     break anywhere, as it always may in the Arabic. */
  function fitJourney(path) {
    path.classList.remove('is-small', 'is-tight');
    if (window.I18n && window.I18n.apply) window.I18n.apply(path);
    if (!journeyTouches(path)) return;
    path.classList.add('is-small');
    if (journeyTouches(path)) path.classList.add('is-tight');
  }

  function journeyTouches(path) {
    var card = path.parentNode && path.parentNode.getBoundingClientRect ? path.parentNode.getBoundingClientRect() : path.getBoundingClientRect();
    if (!card.width) return false;
    var spans = Array.prototype.map.call(path.querySelectorAll('.journey-name'), function (el) {
      var r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect();
    }).sort(function (a, b) { return a.left - b.left; });
    for (var i = 0; i < spans.length; i++) {
      if (i && spans[i].left < spans[i - 1].right + 4) return true;
      if (spans[i].left < card.left + 4 || spans[i].right > card.right - 4) return true;
    }
    return false;
  }

  function renderUmrahJourney(done) {
    var path = $('umrah-path');
    var now = $('umrah-now');
    var at = umrahHere(done);

    if (path) {
      path.innerHTML = UMRAH_STAGES.map(function (stage, i) {
        var cls = 'journey-stop';
        if (i < at) cls += ' is-past';
        else if (i === at) cls += ' is-here';
        return '<li class="' + cls + '"><span class="journey-mark">' +
          icon(i < at ? 'check' : stage.ic) + '</span>' +
          '<span class="journey-name">' + esc(stage.t) + '</span></li>';
      }).join('');
      fitJourney(path);
    }

    if (!now) return;
    if (at >= UMRAH_STAGES.length) {
      now.innerHTML = '<p class="journey-kicker">تمّت</p>' +
        '<p class="journey-title">تقبّل الله منك</p>' +
        '<p class="journey-calm">حلّ لك كل ما حُرّم عليك بالإحرام. ' +
        'واحمد الله أن بلّغك بيته وأعانك على إتمام نسكك.</p>';
      return;
    }
    var stage = UMRAH_STAGES[at];
    var left = stage.i.filter(function (_, ii) { return !done[stage.id + ':' + ii]; });
    now.innerHTML = '<p class="journey-kicker">أنت الآن في</p>' +
      '<p class="journey-title">' + esc(stage.t) + '</p>' +
      (left.length ? '<p class="journey-next"><span class="journey-next-kicker">التالي</span>' +
        esc(left[0]) + '</p>' : '') +
      (stage.calm ? '<p class="journey-calm">' + esc(stage.calm) + '</p>' : '');
  }

  function renderUmrah() {
    var host = $('umrah-stages');
    if (!host || typeof UMRAH_STAGES === 'undefined') return;
    var done = Store.get('umrah') || {};
    var total = 0, marked = 0;
    renderUmrahJourney(done);
    host.innerHTML = UMRAH_STAGES.map(function (stage, si) {
      var mine = stage.i.map(function (text, ii) {
        var key = stage.id + ':' + ii;
        var on = !!done[key];
        total++; if (on) marked++;
        return '<button class="check' + (on ? ' is-done' : '') + '" data-umrah-step="' + key + '" role="checkbox" aria-checked="' + (on ? 'true' : 'false') + '">' +
          '<span class="check-box">' + icon('check') + '</span>' +
          '<span class="check-label">' + esc(text) + '</span></button>';
      }).join('');
      var here = stage.i.filter(function (_, ii) { return done[stage.id + ':' + ii]; }).length;
      /* Every fold starts closed, here as everywhere: a screen should show its
         headings and not its contents. Opening the current stage by itself was
         tried and it broke that rule for no gain, since the card above already
         names the stage being walked and the very next thing to do in it. */
      var open = !!(state.umrahOpen && state.umrahOpen[stage.id]);
      return '<section class="fold' + (open ? ' is-open' : '') + '" data-umrah-fold="' + stage.id + '">' +
        '<button class="fold-head" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="stage-num">' + (stage.ic ? icon(stage.ic) : ar(si + 1)) + '</span>' +
        '<span class="fold-title">' + esc(stage.t) + '<span class="fold-note">' + esc(stage.note) + '</span></span>' +
        '<span class="fold-tally' + (here === stage.i.length ? ' is-full' : '') + '">' + ar(here) + ' من ' + ar(stage.i.length) + '</span>' +
        icon('chevron', 'fold-arrow') + '</button>' +
        '<div class="fold-body">' + mine +
        /* the «فلا حرج» of this stage, where someone worried will meet it */
        (stage.calm ? '<p class="stage-calm">' + icon('heart') + '<span>' + esc(stage.calm) + '</span></p>' : '') +
        '<p class="fold-source">' + esc(UMRAH_SOURCE.b) + '، صفحة ' + ar(stage.p) + '</p></div></section>';
    }).join('');
    if ($('umrah-tally')) $('umrah-tally').textContent = ar(marked) + ' من ' + ar(total);
    if ($('umrah-source')) {
      $('umrah-source').textContent = UMRAH_SOURCE.b + '، ' + UMRAH_SOURCE.a +
        (typeof UMRAH_SOURCE_2 !== 'undefined' ? '، و' + UMRAH_SOURCE_2.b + '، ' + UMRAH_SOURCE_2.a : '');
    }
    renderUmrahRef();
  }


  function renderUmrahRef() {
    var host = $('umrah-ref');
    if (!host) return;
    var which = state.umrahTab || 'mawaqit';
    [].forEach.call(document.querySelectorAll('[data-umrah]'), function (chip) {
      var on = chip.getAttribute('data-umrah') === which;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var refIcon = { mawaqit: 'mount', forbidden: 'close', allowed: 'check', mistakes: 'close' };
    void refIcon;
    if (which === 'mawaqit') {
      host.innerHTML = '<p class="setting-note">من مرّ على ميقات وهو يريد العمرة لزمه الإحرام منه، ومن كان مسكنه دونها أحرم من مكانه، وأهل مكة يُحرمون للعمرة من الحلّ خارج حدود الحرم كالتنعيم.</p>' +
        UMRAH_MAWAQIT.map(function (m) {
          return '<div class="row"><span class="row-mark">' + ar(m.km) + '</span>' +
            '<span class="row-body"><span class="row-title">' + esc(m.n) + (m.now ? '، ويُسمّى اليوم ' + esc(m.now) : '') + '</span>' +
            '<span class="row-note">' + esc(m.w) + '، ويبعد ' + ar(m.km) + ' كم عن مكة</span></span></div>';
        }).join('');
      return;
    }
    var list = which === 'forbidden' ? UMRAH_FORBIDDEN : which === 'allowed' ? UMRAH_ALLOWED : UMRAH_MISTAKES;
    var head = which === 'forbidden' ? 'يحرم على المعتمر بعد إحرامه من الميقات'
      : which === 'allowed' ? 'ويجوز للمحرم' : 'مما يقع فيه بعض الناس';
    host.innerHTML = '<p class="setting-note">' + head + '</p>' +
      list.map(function (t) {
        return '<div class="row umrah-' + which + '"><span class="row-mark">' + icon(which === 'allowed' ? 'check' : 'close') + '</span>' +
          '<span class="row-body"><span class="row-note umrah-line">' + esc(t) + '</span></span></div>';
      }).join('');
  }

  /* ---------------- القضاء ---------------- */

  var PRAYER_NAMES = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };

  /* The four said the moment one gives salam, in the order a person says
     them. The istighfar is three, not one with «(ثلاثاً)» written beside it,
     so it is given its own entry and its own count; the rest come from باب ٢٥
     as the book has them. */
  function afterPrayerItems() {
    var chapter = (typeof HISN !== 'undefined' ? HISN : []).filter(function (c) { return c.id === 25; })[0];
    if (!chapter) return [];
    var book = function (a) { return chapter.i.filter(function (x) { return x.a === a; })[0]; };
    var salam = book(66);
    var out = [{ t: 'أَسْتَغْفِرُ اللَّهَ', n: 'يقولها فور التسليم', r: 3 }];
    if (salam) {
      /* the book joins the istighfar and «اللهم أنت السلام» in one line; the
         second half stands on its own here, since the first is now counted */
      var rest = salam.t.replace(/^[\s\S]*?\)\s*/, '');
      out.push({ t: rest || salam.t, n: '', r: 1 });
    }
    [67, 68, 69].forEach(function (a) {
      var it = book(a);
      if (it) out.push({ t: it.t, n: '', r: it.r || 1 });
    });
    return out;
  }

  /* how many of each are still owed, for this sheet only: the adhkar of a
     prayer are said at its salam, not carried across the day */
  function afterPrayerHtml() {
    var items = afterPrayerItems();
    if (!state.afterPrayerLeft) {
      state.afterPrayerLeft = items.map(function (it) { return it.r || 1; });
    }
    return items.map(function (it, i) {
      var target = it.r || 1;
      var left = state.afterPrayerLeft[i];
      return dhikrCard({ t: it.t, n: it.n, a: it.a }, i, target, left, left <= 0, 'after');
    }).join('');
  }

  /* one tap, one said; the ring fills and the sheet redraws in place */
  function countAfterPrayer(index) {
    if (!state.afterPrayerLeft || state.afterPrayerLeft[index] === undefined) return;
    if (state.afterPrayerLeft[index] <= 0) return;
    state.afterPrayerLeft[index] -= 1;
    buzz(state.afterPrayerLeft[index] === 0 ? 24 : 8);
    var body = $('sheet-body');
    if (!body) return;
    var tail = body.innerHTML.slice(body.innerHTML.indexOf('<button class="btn btn-primary'));
    body.innerHTML = afterPrayerHtml() + tail;
    if (state.afterPrayerLeft.every(function (n) { return n <= 0; })) toast('تقبّل الله');
  }

  /* The adhkar said after a prescribed prayer, offered the moment one is
     marked prayed. Shown at most once for each prayer each day. */
  function offerAfterPrayer(key) {
    if (Store.get('afterPrayerOff')) return false;
    var mark = Store.dayKey() + ':' + key;
    if (Store.get('afterPrayerShown') === mark) return false;
    Store.set('afterPrayerShown', mark);
    /* Chapter 25 is the adhkar after the salam; 27 is morning and evening,
       and this sheet drew its first four from 27 for a long while, so a
       prayer ended with Ayat al-Kursi and the muawwidhat instead of the
       istighfar and tasbih. The count in the book is r, not c, and it never
       showed. Now the five short ones that open the chapter, each with its
       count, in the order a person says them. */
    state.afterPrayerLeft = null;
    openSheet('أذكار ما بعد ' + PRAYER_NAMES[key],
      afterPrayerHtml() +
      '<button class="btn btn-primary btn-block" data-act="open-after-prayer" style="margin-top:10px">افتح الباب كاملاً</button>' +
      '<button class="btn btn-ghost btn-block" data-act="after-prayer-off" style="margin-top:8px">لا تعرضها بعد كل صلاة</button>');
    return true;
  }

  /* ---------------- المساجد، وصورة المواقيت، وسنن العيد ---------------- */

  /* The mosques around the reader, opened in whatever map their phone keeps.
     The app holds no map of its own and asks for nothing it does not have. */
  /* ---------------- المساجد القريبة ---------------- */

  /* A map of the reader's own making: tiles from OpenStreetMap laid in a grid,
     and the mosques around them asked of Overpass, which is open and needs no
     key. Nothing is fetched until this screen is opened, and the reader's
     place never leaves the phone except as the query itself. */
  var MAP = { zoom: 15, tile: 256 };

  function toTile(lat, lng, z) {
    var n = Math.pow(2, z);
    var x = (lng + 180) / 360 * n;
    var rad = lat * Math.PI / 180;
    var y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
    return { x: x, y: y };
  }

  /* how far apart two places are, over the ground, in metres */
  function metresBetween(a, b) {
    var R = 6371000;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  function farLabel(m) {
    return m < 1000 ? ar(m) + ' م' : ar((m / 1000).toFixed(1)) + ' كم';
  }

  function drawMap() {
    var host = $('map-tiles');
    var pins = $('map-pins');
    var where = place();
    if (!host || !pins || !where) return;
    var box = $('mosque-map').getBoundingClientRect();
    /* a screen not yet laid out measures nothing, and the map would be built
       to a size it never has; it is drawn again once the width is real */
    if (!box.width) {
      window.requestAnimationFrame(function () { if (state.view === 'mosques') drawMap(); });
      return;
    }
    var W = box.width, H = box.height;
    var eye = state.mapAt || where;
    /* One tile for each square of the map and no more: the open map asks that
       it not be drawn on in bulk, and a finer grid would quadruple every draw
       for a sharpness the reader does not miss. */
    var z = MAP.zoom;
    var size = MAP.tile;
    var eyeAt = toTile(eye.lat, eye.lng, z);
    var left = W / 2 - (eyeAt.x % 1) * size;
    var top = H / 2 - (eyeAt.y % 1) * size;
    var acrossX = Math.ceil(W / size) + 1;
    var acrossY = Math.ceil(H / size) + 1;
    var out = '';
    var n = Math.pow(2, z);
    for (var i = -Math.ceil(acrossX / 2); i <= Math.ceil(acrossX / 2); i++) {
      for (var j = -Math.ceil(acrossY / 2); j <= Math.ceil(acrossY / 2); j++) {
        var tx = Math.floor(eyeAt.x) + i, ty = Math.floor(eyeAt.y) + j;
        if (ty < 0 || ty >= n) continue;
        var wrapped = ((tx % n) + n) % n;
        out += '<img alt="" src="https://tile.openstreetmap.org/' + z + '/' + wrapped + '/' + ty + '.png"' +
          ' style="width:' + size + 'px;height:' + size + 'px;left:' + Math.round(left + i * size) +
          'px;top:' + Math.round(top + j * size) + 'px">';
      }
    }
    host.innerHTML = out;

    var me = toTile(where.lat, where.lng, z);
    var marks = '<div class="map-me" style="left:' + Math.round(W / 2 + (me.x - eyeAt.x) * size) +
      'px;top:' + Math.round(H / 2 + (me.y - eyeAt.y) * size) + 'px"></div>';
    (state.mosques || []).forEach(function (m, at) {
      var t = toTile(m.lat, m.lng, z);
      var x = W / 2 + (t.x - eyeAt.x) * size;
      var y = H / 2 + (t.y - eyeAt.y) * size;
      if (x < -40 || x > W + 40 || y < -50 || y > H + 40) return;
      marks += '<button class="map-pin' + (state.mosqueAt === at ? ' is-on' : '') + '" data-act="mosque-look" data-ref="' + at +
        ':map" style="left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px" aria-label="' + esc(m.n) + '">' +
        icon('mosque') + '</button>';
    });
    pins.innerHTML = marks;
    showChosenMosque();
  }

  /* the name of the mosque the reader pressed, beneath the map */
  function showChosenMosque() {
    var line = $('map-chosen');
    if (!line) return;
    var m = (state.mosques || [])[state.mosqueAt];
    if (!m) { line.hidden = true; return; }
    line.hidden = false;
    line.innerHTML = '<span class="row-title" translate="no">' + esc(m.n) + '</span>' +
      '<span class="row-note mosque-far">' + farLabel(m.far) + '</span>' +
      '<button class="btn btn-ghost" data-act="mosque-go" data-ref="' + m.lat + ',' + m.lng + '|' + esc(m.n) + '">الطريق</button>';
  }

  /* pressing a mosque brings the map onto it and names it */
  function lookAtMosque(at, from) {
    var m = (state.mosques || [])[at];
    if (!m) return;
    state.mosqueAt = at;
    state.mapAt = { lat: m.lat, lng: m.lng };
    MAP.zoom = Math.max(MAP.zoom, 17);
    /* the name is shown whether or not the map itself can be drawn */
    showChosenMosque();
    drawMap();
    renderMosqueList();
    /* from the map, go down to the mosque in the list; from the list, go up to
       it on the map, so the press always shows the reader the other half */
    var target = from === 'map'
      ? document.querySelector('#mosque-list .row.is-now')
      : $('mosque-map');
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: glide() });
  }

  /* the tile the map sits on, turned back into a place */
  function fromTile(x, y, z) {
    var n = Math.pow(2, z);
    var lng = x / n * 360 - 180;
    var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    return { lat: lat, lng: lng };
  }

  /* The map is dragged with a finger, and when it settles somewhere new the
     mosques around that place are asked for, so a reader can look down the
     road rather than only where they stand. */
  function letMapBeDragged() {
    var map = $('mosque-map');
    if (!map || map.dataset.dragging) return;
    map.dataset.dragging = '1';
    var from = null, moved = false;
    var fingers = {}, pinch = 0;
    map.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.map-zoom') || e.target.closest('.map-pin')) return;
      fingers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(fingers);
      if (ids.length === 2) {
        pinch = spread(fingers, ids);
        from = null;
        return;
      }
      from = { x: e.clientX, y: e.clientY, at: state.mapAt || place() };
      moved = false;
      map.setPointerCapture(e.pointerId);
    });
    map.addEventListener('pointermove', function (e) {
      if (fingers[e.pointerId]) { fingers[e.pointerId] = { x: e.clientX, y: e.clientY }; }
      var ids = Object.keys(fingers);
      if (ids.length === 2) {
        /* two fingers spread or close: a step of zoom for each doubling */
        var now = spread(fingers, ids);
        if (pinch && now) {
          var steps = Math.round(Math.log(now / pinch) / Math.LN2);
          if (steps) {
            MAP.zoom = Math.max(11, Math.min(18, MAP.zoom + steps));
            pinch = now;
            drawMap();
          }
        }
        return;
      }
      if (!from || !from.at) return;
      var dx = e.clientX - from.x, dy = e.clientY - from.y;
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      var t = toTile(from.at.lat, from.at.lng, MAP.zoom);
      var here = fromTile(t.x - dx / MAP.tile, t.y - dy / MAP.tile, MAP.zoom);
      state.mapAt = here;
      drawMap();
    });
    var settle = function (e) {
      delete fingers[e.pointerId];
      if (Object.keys(fingers).length < 2) pinch = 0;
      if (from) { try { map.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ } }
      from = null;
      if (moved) { moved = false; lookAround(); }
    };
    map.addEventListener('pointerup', settle);
    map.addEventListener('pointercancel', settle);
  }

  /* how far apart two fingers are */
  function spread(fingers, ids) {
    var a = fingers[ids[0]], b = fingers[ids[1]];
    if (!a || !b) return 0;
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  /* the mosques about wherever the map now looks, asked for once it settles */
  function lookAround() {
    var eye = state.mapAt || place();
    if (!eye) return;
    if (state.lookedAt && metresBetween(state.lookedAt, eye) < 400) return;
    state.lookedAt = { lat: eye.lat, lng: eye.lng };
    window.clearTimeout(state.lookTimer);
    state.lookTimer = window.setTimeout(function () { findMosques(eye); }, 350);
  }

  function renderMosques() {
    var where = place();
    var list = $('mosque-list');
    if (!list) return;
    if (!where) {
      list.innerHTML = '<p class="setting-note">حدّد موقعك من الإعدادات لتظهر المساجد حولك</p>';
      return;
    }
    drawMap();
    letMapBeDragged();
    if (!state.mosques) {
      list.innerHTML = '<p class="setting-note">جاري البحث عن المساجد حولك…</p>';
      findMosques(state.mapAt || null);
      return;
    }
    if (!state.mosques.length) {
      list.innerHTML = '<p class="setting-note">لم يُعثر على مساجد مسجّلة حولك.</p>' +
        '<button class="btn btn-primary btn-block mosque-again" data-act="mosques-again">تحديث</button>';
      if ($('mosque-count')) $('mosque-count').textContent = '';
      return;
    }
    renderMosqueList();
  }

  function renderMosqueList() {
    var list = $('mosque-list');
    if (!list || !state.mosques || !state.mosques.length) return;
    if ($('mosque-count')) $('mosque-count').textContent = ar(state.mosques.length) + ' حولك';
    list.innerHTML = state.mosques.map(function (m) {
      var at = state.mosques.indexOf(m);
      return '<div class="row' + (state.mosqueAt === at ? ' is-now' : '') + '">' +
        '<button class="row-mark" data-act="mosque-look" data-ref="' + at + '" aria-label="أرِني ' + esc(m.n) + ' على الخريطة">' + icon('mosque') + '</button>' +
        '<button class="row-body" data-act="mosque-look" data-ref="' + at + '"><span class="row-title" translate="no">' + esc(m.n) + '</span>' +
        '<span class="row-note mosque-far">' + farLabel(m.far) + '</span></button>' +
        '<button class="btn btn-ghost" data-act="mosque-go" data-ref="' + m.lat + ',' + m.lng + '|' + esc(m.n) + '">الطريق</button></div>';
    }).join('');
  }

  /* Overpass is answered by several servers and any one of them may be down,
     so they are tried in turn rather than the screen failing on the first. */
  var OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];

  /* All the servers are asked at once and the first sound answer is taken. A
     busy Overpass server does not fail cleanly: it answers 200, or 406, or a
     504 gateway page, with an HTML or XML body, so «r.ok then r.json()» threw
     on the body and the whole screen read as «no mosques near you» when the
     servers were merely overloaded. Now only a real JSON body with elements is
     accepted, and a server that gives anything else is counted as silent. The
     wait per server is shorter too, so four are raced rather than two endured. */
  function askOverpass(query) {
    var body = 'data=' + encodeURIComponent(query);
    var left = OVERPASS.length;
    return new Promise(function (resolve, reject) {
      var settled = false;
      OVERPASS.forEach(function (host) {
        var give = window.setTimeout(function () { fail(); }, 8000);
        fetch(host, {
          method: 'POST', body: body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }).then(function (r) {
          return r.text();
        }).then(function (text) {
          window.clearTimeout(give);
          if (settled) return;
          var data = null;
          try { data = JSON.parse(text); } catch (e) { data = null; }
          if (!data || !Array.isArray(data.elements)) { fail(); return; }
          settled = true;
          resolve(data);
        }).catch(function () { window.clearTimeout(give); fail(); });
      });
      function fail() {
        left -= 1;
        if (!settled && left <= 0) reject(new Error('no server answered'));
      }
    });
  }

  function findMosques(around) {
    var where = place();
    var eye = around || where;
    if (!eye || !where) return;
    var query = '[out:json][timeout:20];(node(around:3000,' + eye.lat + ',' + eye.lng +
      ')["amenity"="place_of_worship"]["religion"="muslim"];way(around:3000,' + eye.lat + ',' + eye.lng +
      ')["amenity"="place_of_worship"]["religion"="muslim"];);out center 40;';
    askOverpass(query).then(function (data) {
      var found = (data.elements || []).map(function (el) {
        var lat = typeof el.lat === 'number' ? el.lat : (el.center || {}).lat;
        var lng = typeof el.lon === 'number' ? el.lon : (el.center || {}).lon;
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;
        /* a mosque's own name, in the reader's language where the map has
           it, else as the map writes it; a name is a name and is not put
           through the table */
        var tags = el.tags || {};
        var own = window.I18n && window.I18n.lang !== 'ar' ? tags['name:' + window.I18n.lang] || tags.name : null;
        var name = own || tags['name:ar'] || tags.name || tongue('مسجد');
        return { n: name, lat: lat, lng: lng, far: metresBetween(where, { lat: lat, lng: lng }) };
      }).filter(Boolean);
      found.sort(function (a, b) { return a.far - b.far; });
      /* the same mosque is sometimes both a point and an outline */
      var seen = {};
      state.mosques = found.filter(function (m) {
        var key = m.n + '|' + Math.round(m.far / 25);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      }).slice(0, 20);
      state.mosqueRetried = false;
      if (state.view === 'mosques') renderMosques();
    }).catch(function () {
      /* the servers were busy, not empty. One quiet retry after a moment
         catches the common case where a mirror freed up; only then is the
         reader shown the button to try again himself. */
      if (!state.mosqueRetried) {
        state.mosqueRetried = true;
        if ($('mosque-list')) $('mosque-list').innerHTML = '<p class="setting-note">جاري البحث عن المساجد حولك…</p>';
        window.setTimeout(function () { findMosques(around); }, 2500);
        return;
      }
      state.mosqueRetried = false;
      state.mosques = [];
      if ($('mosque-list')) {
        $('mosque-list').innerHTML = '<p class="setting-note">خوادم الخرائط مشغولة الآن، وليس معناه أن لا مساجد حولك، فجرّب بعد قليل</p>' +
          '<button class="btn btn-primary btn-block mosque-again" data-act="mosques-again">تحديث</button>';
      }
    });
  }

  function mosqueRoute(ref) {
    var at = ref.lastIndexOf('|');
    var coords = ref.slice(0, at), name = ref.slice(at + 1);
    var url = 'geo:' + coords + '?q=' + coords + '(' + encodeURIComponent(name) + ')';
    var app = bridge();
    if (app && app.openMap) {
      try { if (app.openMap(url, coords)) return true; } catch (e) { /* fall through */ }
    }
    try {
      window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(coords), '_blank', 'noopener');
      return true;
    } catch (e) { toast('تعذّر فتح الطريق'); return false; }
  }

  function openMosques() {
    var where = place();
    var here = where && typeof where.lat === 'number'
      ? where.lat.toFixed(5) + ',' + where.lng.toFixed(5) : '';
    var url = here
      ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('مسجد') + '&query_place_id=&center=' + here
      : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('مسجد قريب');
    if (here) url = 'geo:' + here + '?q=' + encodeURIComponent('مسجد');
    var app = bridge();
    if (app && app.openMap) {
      var ok = false;
      try { ok = app.openMap(url, here); } catch (e) { ok = false; }
      if (ok) return true;
    }
    var web = here
      ? 'https://www.google.com/maps/search/mosque/@' + here + ',15z'
      : 'https://www.google.com/maps/search/mosque';
    try { window.open(web, '_blank', 'noopener'); return true; } catch (e) { toast('تعذّر فتح الخريطة'); return false; }
  }

  /* Today's times as a picture: a row for each, the name at the start and the
     hour at the end, so it reads like the card in the app rather than a
     paragraph. The night's two marks take the same row as the prayers. */
  function timesCard() {
    var t = state.times || refreshTimes();
    var where = place();
    var marks = nightMarks(new Date());
    var rows = [
      { n: 'الفجر', v: clockText(t.fajr) },
      { n: 'الشروق', v: clockText(t.sunrise) },
      /* the screen calls friday's noon by the name people are waiting for, and
         a picture of the same day should not call it something else */
      { n: prayerName('dhuhr'), v: clockText(t.dhuhr) },
      { n: 'العصر', v: clockText(t.asr) },
      { n: 'المغرب', v: clockText(t.maghrib) },
      { n: 'العشاء', v: clockText(t.isha) }
    ];
    if (marks) {
      rows.push({ n: 'منتصف الليل', v: clockText(marks.midnight), night: true });
      rows.push({ n: 'الثلث الأخير', v: clockText(marks.lastThird), night: true });
    }
    rows.forEach(function (row) { row.n = tongue(row.n); row.v = tongue(row.v); });
    /* the name stands where a line of the reader's language begins, and the
       time at the other end */
    var ltr = !!(window.I18n && window.I18n.dir === 'ltr');

    var W = 1080, PAD = 96, ROW = 108, GAP = 16;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    var paint = cardColours();
    var fill = paint.fill, wash = paint.wash;

    var faces = ["700 44px 'IBM Plex Sans Arabic'", "600 40px 'IBM Plex Sans Arabic'", "400 30px 'IBM Plex Sans Arabic'"];
    var ready = document.fonts && document.fonts.load
      ? Promise.all(faces.map(function (f) { return document.fonts.load(f, 'الفجر'); })).catch(function () {})
      : Promise.resolve();
    var now = new Date();
    var sky = skyOn() ? skyAt(t, nowMinutes(now)) : null;
    var plates = sky ? Promise.all([loadPlate(sky.a), loadPlate(sky.b)]) : Promise.resolve(null);

    return Promise.all([ready, plates]).then(function (got) {
      var painted = got[1] && got[1][0] ? got[1] : null;
      var SKY_H = painted ? 330 : 0;
      /* a hundred and thirty more at the foot than the line of text it once
         ended with, for the app's mark over the two badges */
      var H = PAD + 190 + rows.length * (ROW + GAP) + 150 + SKY_H + 130;
      canvas.width = W; canvas.height = H;
      ctx = canvas.getContext('2d');

      /* the same paper, lattice and gold frame the verse card wears, so the
         two are plainly from one app */
      ctx.fillStyle = '#f7f5ef';
      ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalAlpha = 0.07;
      for (var ly = 40; ly < H; ly += 112) for (var lx = 40; lx < W; lx += 112) cardStar(ctx, lx, ly, 22);
      ctx.restore();
      ctx.strokeStyle = wash; ctx.lineWidth = 6;
      ctx.strokeRect(36, 36, W - 72, H - 72);
      ctx.strokeStyle = '#b08833'; ctx.lineWidth = 2;
      ctx.strokeRect(52, 52, W - 104, H - 104);
      cardStar(ctx, 52, 52, 14); cardStar(ctx, W - 52, 52, 14);
      cardStar(ctx, 52, H - 52, 14); cardStar(ctx, W - 52, H - 52, 14);
      if (painted) paintSky(ctx, painted, sky, moonAt(now, t), PAD + 24, PAD - 8, W - 2 * (PAD + 24), SKY_H - 24, 'rgba(247,245,239,1)');

      ctx.direction = ltr ? 'ltr' : 'rtl'; ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = fill;
      ctx.font = "700 44px 'IBM Plex Sans Arabic', sans-serif";
      ctx.fillText(tongue(Hijri.format(Hijri.toHijri(new Date(), Store.get('hijriAdjust')))), W / 2, PAD + 30 + SKY_H);
      ctx.fillStyle = '#5e6c65';
      ctx.font = "400 30px 'IBM Plex Sans Arabic', sans-serif";
      ctx.fillText(tongue((where ? where.n + '، ' : '') + gregorianLine(new Date())), W / 2, PAD + 86 + SKY_H);

      var top = PAD + 150 + SKY_H;
      rows.forEach(function (row, i) {
        var y = top + i * (ROW + GAP);
        ctx.fillStyle = row.night ? 'rgba(176, 136, 51, .10)' : 'rgba(22, 36, 28, .05)';
        roundRect(ctx, PAD, y, W - PAD * 2, ROW, 26);
        ctx.fill();
        ctx.fillStyle = row.night ? '#7a5c1e' : '#16241c';
        ctx.font = "600 40px 'IBM Plex Sans Arabic', sans-serif";
        ctx.textAlign = ltr ? 'left' : 'right';
        ctx.fillText(row.n, ltr ? PAD + 34 : W - PAD - 34, y + ROW / 2);
        ctx.fillStyle = row.night ? '#7a5c1e' : fill;
        ctx.textAlign = ltr ? 'right' : 'left';
        ctx.fillText(row.v, ltr ? W - PAD - 34 : PAD + 34, y + ROW / 2);
      });

      /* the knot closes the times, then the app signs them as the verse card does */
      ctx.textAlign = 'center';
      cardStar(ctx, W / 2, H - PAD - 186, 13);
      return cardFoot(ctx, W, H).then(function () {
        return new Promise(function (resolve) {
          if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
          else resolve(null);
        });
      });
    });
  }

  /* the gold knot at the corners of a card, and the lattice behind it */
  function cardStar(context, cx, cy, r) {
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

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function gregorianLine(d) {
    return Hijri.WEEKDAYS[d.getDay()] + ' ' + ar(d.getDate()) + ' ' + GREG_MONTHS[d.getMonth()] + ' ' + ar(d.getFullYear());
  }

  function shareTimes() {
    var where = place();
    var t = state.times || refreshTimes();
    var words = 'مواقيت الصلاة اليوم' + (where ? ' في ' + where.n : '') + ':\n' +
      'الفجر ' + clockText(t.fajr) + '، الظهر ' + clockText(t.dhuhr) + '، العصر ' + clockText(t.asr) +
      '، المغرب ' + clockText(t.maghrib) + '، العشاء ' + clockText(t.isha) +
      '\n\nsunnati.3li.info';
    return sharePicture(timesCard(), 'times.png', 'مواقيت اليوم', words);
  }

  /* On the day of either eid the app opens with its sunnahs, once. */
  function eidToday() {
    var h = Hijri.toHijri(new Date(), Store.get('hijriAdjust'));
    if (h.m === 10 && h.d === 1) return 'الفطر';
    if (h.m === 12 && h.d === 10) return 'الأضحى';
    return null;
  }

  function maybeEidSheet() {
    var which = eidToday();
    if (!which) return false;
    var key = new Date().toDateString();
    if (Store.get('eidShown') === key) return false;
    Store.set('eidShown', key);
    var t = state.times || refreshTimes();
    var at = typeof t.sunrise === 'number' ? clockText(t.sunrise + 20) : '';
    var sunan = which === 'الفطر'
      ? ['الغسل والتطيّب ولبس أحسن الثياب',
         'الأكل قبل الخروج، تمرات وتراً',
         'التكبير من ليلة العيد إلى الصلاة: الله أكبر الله أكبر، لا إله إلا الله، والله أكبر الله أكبر ولله الحمد',
         'الخروج ماشياً، والرجوع من طريق آخر',
         'التهنئة: تقبّل الله منا ومنكم']
      : ['الغسل والتطيّب ولبس أحسن الثياب',
         'ألا يأكل حتى يرجع فيأكل من أضحيته',
         'التكبير المطلق في أيام العشر، والمقيّد بعد الصلوات إلى آخر أيام التشريق',
         'الخروج ماشياً، والرجوع من طريق آخر',
         'الأضحية بعد الصلاة، لا قبلها']
      ;
    openSheet('عيد ' + which,
      '<p class="setting-note">صلاة العيد' + (at ? ' نحو ' + at : '') + '، بعد ارتفاع الشمس قدر رمح</p>' +
      sunan.map(function (line) {
        return '<div class="dua-line"><span class="dua-text">' + esc(line) + '</span></div>';
      }).join('') +
      '<p class="naskh salawat-text">تقبّل الله منا ومنكم صالح الأعمال</p>');
    return true;
  }

  function renderQada() {
    var host = $('qada-prayers');
    if (!host) return;
    var owed = Store.qadaOwed();
    var total = 0;
    host.innerHTML = Store.PRAYER_KEYS.map(function (k) {
      total += owed[k];
      return '<div class="row"><span class="row-mark">' + ar(owed[k]) + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(PRAYER_NAMES[k]) + '</span>' +
        '<span class="row-note">' + (owed[k] ? 'عليك ' + count(owed[k], 'واحدة', 'اثنتان', 'صلوات', 'صلاة') : 'ليس عليك شيء') + '</span></span>' +
        (owed[k] ? '<button class="btn btn-ghost" data-act="qada-done" data-ref="' + k + '">قضيتها</button>' : '') +
        '</div>';
    }).join('');
    if ($('qada-prayers-tally')) {
      $('qada-prayers-tally').textContent = total ? ar(total) + ' عليك' : 'لا شيء عليك';
    }
    /* the count between − and + is what is still owed, as the badge says, so
       a day struck off by mistake is put back with + */
    var owedDays = Store.fastOwed();
    if ($('qada-fast-owed')) $('qada-fast-owed').textContent = owedDays ? daysOf(owedDays) + ' عليك' : 'لا شيء عليك';
    if ($('qada-fast-tally')) {
      $('qada-fast-tally').textContent = owedDays ? 'بقي ' + daysOf(owedDays) : 'لا شيء عليك';
    }
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
        return '<button class="chip pick' + (i === state.tasbih.index ? ' is-on' : '') +
          '" data-phrase="' + i + '">' + esc(p.t) + '</button>';
      }).join('');
    }
    if ($('tasbih-total')) {
      $('tasbih-total').textContent = 'مجموع اليوم ' + tasbihat(Store.day().tasbih || 0);
    }
  }

  /* The count and its phrase are kept with the day they were counted on, so a
     reload, or the phone closing the app behind the reader's back, does not
     lose a count halfway to its hundred. A new day starts the count afresh on
     the phrase last used. */
  function keepTasbih() {
    Store.set('tasbihNow', { i: state.tasbih.index, c: state.tasbih.count, d: Store.dayKey() });
  }

  function restoreTasbih() {
    var kept = Store.get('tasbihNow');
    var list = phraseList();
    if (!kept || typeof kept !== 'object' || !list[+kept.i]) { state.tasbih = { index: 0, count: 0 }; return; }
    state.tasbih = { index: +kept.i, count: kept.d === Store.dayKey() ? Math.max(0, +kept.c || 0) : 0 };
  }

  function countTasbih() {
    var list = phraseList();
    var current = list[state.tasbih.index] || list[0];
    state.tasbih.count++;
    keepTasbih();
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
        '<span class="row-play" aria-hidden="true">' + icon('play') + '</span></button>';
    }).join('');

    var chips = $('sleep-timer');
    if (chips) {
      chips.innerHTML = SLEEP_CHOICES.map(function (m) {
        return '<button class="chip" data-sleep="' + m + '">' + minutesOf(m) + '</button>';
      /* the cancel is not one of the durations, so it takes the row under them
         rather than standing as a fifth orphan at the end of a row of four */
      }).join('') + '<button class="chip chip-wide" data-sleep="0">إلغاء</button>';
    }
    renderSleepNote();
  }

  function renderSleepNote() {
    /* the duration running is lit, as a choice is lit everywhere else in the app */
    $$('#sleep-timer [data-sleep]').forEach(function (chip) {
      var on = !!state.sleepTimer && +chip.getAttribute('data-sleep') === state.sleepFor;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var note = $('sleep-note');
    if (!note) return;
    if (!state.sleepTimer) { note.textContent = 'المؤقت متوقف'; return; }
    var left = Math.max(0, Math.round((state.sleepEndsAt - Date.now()) / 60000));
    note.textContent = 'سيتوقف البث بعد ' + minutesOf(left, true);
  }

  function setSleep(minutes) {
    /* with nothing playing there is nothing to stop: the timer used to start
       anyway and promise to stop a stream that was not there */
    if (minutes && !state.playing) { toast('شغّل إذاعة أولاً ثم اختر متى يتوقف البث'); return; }
    if (state.sleepTimer) { window.clearTimeout(state.sleepTimer); state.sleepTimer = null; }
    if (!minutes) { renderSleepNote(); toast('أُلغي المؤقت'); return; }
    state.sleepFor = minutes;
    state.sleepEndsAt = Date.now() + minutes * 60000;
    state.sleepTimer = window.setTimeout(function () {
      stopAudio();
      state.sleepTimer = null;
      renderSleepNote();
      toast('توقف البث');
    }, minutes * 60000);
    renderSleepNote();
    toast('سيتوقف البث بعد ' + minutesOf(minutes, true));
  }

  /* ---------------- reference lists ---------------- */

  function renderHadith() {
    var host = $('hadith-list');
    if (!host || typeof HADITHS === 'undefined') return;
    var said = bookOf('hadith');
    host.innerHTML = HADITHS.map(function (h) {
      return '<div class="card"><div class="card-head"><h2>الحديث ' + ar(h.n) + '</h2></div>' +
        '<p class="naskh"' + SAID + '>' + esc(h.t) + '</p>' +
        (said && said.h[h.n] ? saidIn(said.h[h.n].t) : '') +
        '<p class="source">' + esc(h.s) + '، ' + esc(h.r) + '</p></div>';
    }).join('') + bookSource('hadith');
    withBook('hadith', function () { if (state.view === 'hadith') renderHadith(); });
  }

  /* a chapter whose very name is a du'a belongs on the du'a screen */
  function isPlaceDua(title) {
    return String(title || '').indexOf('دعاء') === 0;
  }

  function renderDuaPlaces() {
    var host = $('dua-places');
    if (!host) return;
    var rows = azkarSections().filter(function (row) { return isPlaceDua(row.def.title); });
    host.innerHTML = rows.map(function (row) {
      var p = Store.azkarProgress(row.key, row.def.items.length);
      return '<button class="tile" data-azkar="' + esc(row.key) + '">' +
        '<span class="tile-glyph">' + icon(row.def.icon) + '</span>' +
        '<span class="tile-name">' + esc(row.def.title) + '</span>' +
        '<span class="tile-note">' + ar(p.done) + ' من ' + ar(row.def.items.length) + '</span></button>';
    }).join('');
  }

  function renderDua() {
    renderDuaPlaces();
    var host = $('dua-list');
    if (!host || typeof DUAS === 'undefined') return;
    host.innerHTML = DUAS.map(function (group, gi) {
      return '<h2 class="section-title">' + esc(group.cat) + '</h2>' +
        group.items.map(function (d, di) {
          return '<div class="card"><p class="naskh"' + SAID + '>' +
            esc(d.t) + '</p><div class="dhikr-foot"><p class="source">' + esc(d.r) + '</p>' +
            '<button class="dhikr-share" data-picture="dua:' + gi + ':' + di + '" aria-label="صورة للمشاركة">' + icon('share') + '</button></div></div>';
        }).join('');
    }).join('');
  }

  function renderRuqyah() {
    var host = $('ruqyah-list');
    if (!host || typeof RUQYAH === 'undefined') return;
    host.innerHTML = RUQYAH.map(function (r) {
      return '<div class="card"><p class="naskh"' + SAID + '>' +
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
      /* another language's wall calendar has its own letters, which the phone
         knows: S M T W T F S, В П В С Ч П С */
      var other = window.I18n && window.I18n.lang !== 'ar' ? window.I18n.speech : null;
      if (other) {
        try {
          var narrow = new Intl.DateTimeFormat(other, { weekday: 'narrow' });
          initials = initials.map(function (letter, i) { return narrow.format(new Date(2026, 0, 4 + i)); });
        } catch (e) { /* the Arabic letters, then */ }
      }
      week.innerHTML = initials.map(function (letter, i) {
        return '<span title="' + esc(Hijri.WEEKDAYS[i]) + '"' + (other ? ' translate="no"' : '') + '>' + esc(letter) + '</span>';
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

  /* Everything the shown month carries, in the order it falls, with a run of
     days under one name folded into a single line: the white days are three
     days and one season, and saying them three times reads as three seasons.
     The grid already dots such a day; this is so a month can be read at all
     without tapping thirty cells to find out what is in it. */
  function renderCalendarSeasons() {
    var host = $('calendar-seasons');
    if (!host) return;
    var adjust = Store.get('hijriAdjust');
    var month = shownMonth();
    var days = Hijri.monthDays(month.y, month.m, adjust);

    if ($('calendar-season-head')) {
      $('calendar-season-head').textContent = 'مواسم ' + Hijri.MONTHS[month.m - 1];
    }

    /* Gathered by name across the whole month, then the days compressed: a
       season is one line whether it runs nine days together or falls on five
       odd nights apart. Keying by name and not by «the run I opened last» is
       the point: ramadan carries the white days and the odd nights inside it,
       and a lesser season appearing mid-month used to cut the month itself
       into fragments. */
    var order = [];
    var byKey = {};
    days.forEach(function (day) {
      Hijri.occasions(day.date, adjust).forEach(function (o) {
        /* the weekly ones fall every week and are not a season of the month */
        if (o.kind === 'weekly' || o.key === 'mondayThursday') return;
        if (!byKey[o.key]) {
          byKey[o.key] = { name: o.name, note: o.note, kind: o.kind, days: [], dates: [] };
          order.push(o.key);
        }
        byKey[o.key].days.push(day.d);
        byKey[o.key].dates.push(day.date);
      });
    });

    if (!order.length) {
      host.innerHTML = '<p class="setting-note">لا موسم مخصوص في هذا الشهر، ' +
        'وصيام الإثنين والخميس قائم فيه كما في غيره.</p>';
      return;
    }

    /* 1..9 reads «1 إلى 9»، و21 و23 و25 تبقى معدودة */
    function spanOf(list) {
      var parts = [];
      var from = list[0], prev = list[0];
      for (var i = 1; i <= list.length; i++) {
        if (i < list.length && list[i] === prev + 1) { prev = list[i]; continue; }
        parts.push(from === prev ? ar(from) : ar(from) + ' إلى ' + ar(prev));
        if (i < list.length) { from = list[i]; prev = list[i]; }
      }
      return parts.join(' و');
    }

    host.innerHTML = order.map(function (key) {
      var r = byKey[key];
      var when = spanOf(r.days) + ' ' + Hijri.MONTHS[month.m - 1];
      var first = r.dates[0], last = r.dates[r.dates.length - 1];
      var greg = first.getTime() === last.getTime()
        ? Hijri.WEEKDAYS[first.getDay()] + ' ' + ar(first.getDate()) + ' ' + GREG_MONTHS[first.getMonth()]
        : ar(first.getDate()) + ' ' + GREG_MONTHS[first.getMonth()] +
          ' إلى ' + ar(last.getDate()) + ' ' + GREG_MONTHS[last.getMonth()];
      return '<button class="row" data-day="' + r.days[0] + '">' +
        '<span class="row-mark kind-' + esc(r.kind) + '">' + icon(OCCASION_MARK[r.kind] || 'calendar') + '</span>' +
        '<span class="row-body"><span class="row-title">' + esc(r.name) + '</span>' +
        /* the arabic zero is a dot, so a middle dot beside a numeral reads as
           a stray digit: the separator is a comma */
        '<span class="row-note">' + esc(when) + '، ' + esc(greg) + '<br>' + esc(r.note) + '</span></span></button>';
    }).join('');
  }

  var OCCASION_MARK = { eid: 'gift', month: 'crescent', season: 'mountain',
    night: 'moon', fast: 'fast', weekly: 'clock' };

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
        '<span class="row-note">' + (o.days === 0 ? 'اليوم' : 'بعد ' + daysOf(o.days, true)) +
        '<br>' + whenItFalls(o.date) + '</span></span>' +
        '<button class="btn btn-ghost btn-icon" data-act="to-calendar" data-ref="' + esc(o.name) + '|' + o.date.getTime() +
        '" aria-label="أضف ' + esc(o.name) + ' إلى تقويمك">' + icon('calendar') + '</button></div>';
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
    /* the month was set after its button was drawn, so the button stood empty
       while the list beneath it had the month ticked */
    syncPicker(hm);
    syncDate($('conv-greg'));
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
    renderCalendarSeasons();
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
    /* a column heads every day of the month, so the noon one is الظهر: named
       after the first day, a month that began on a friday headed it الجمعة */
    var head = '<thead><tr><th data-tr="date">اليوم</th>' +
      (ramadan ? '<th>الإمساك</th>' : '') +
      TABLE_KEYS.map(function (k) { return '<th>' + esc(k === 'dhuhr' ? PRAYER_NAMES.dhuhr : prayerName(k)) + '</th>'; }).join('') +
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
    fitTimetable(table);

    var current = table.querySelector('tr.is-today');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'center' });
  }

  /* Seven columns of times fit a phone, until the phone's own text size or a
     language's longer marks for the half of the day push the last column off
     the card; then each column says which half of the day it is in, as it
     does on the narrowest phones, and the marks are left out. */
  function fitTimetable(table) {
    var box = table.parentNode;
    if (!box) return;
    table.classList.remove('is-tight');
    if (window.I18n && window.I18n.apply) window.I18n.apply(table);
    if (box.scrollWidth > box.clientWidth + 1) table.classList.add('is-tight');
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
    /* the lam joins a name written in letters, للكويت, and stands apart only
       before the figures of a place known by its coordinates */
    var where = /^[\u0621-\u064A]/.test(place().n) ? withLam(place().n) : 'لـ' + place().n;
    var lines = ['مواقيت ' + GREG_MONTHS[at.m] + ' ' + ar(at.y) + ' ' + where,
      'حساب ' + methodName(Store.get('method')), ''];
    timetableRows().forEach(function (row) {
      lines.push(ar(row.date.getDate()) + '/' + ar(at.m + 1) + '  ' +
        TABLE_KEYS.map(function (k) { return clockText(row.times[k]); }).join('  '));
    });
    return lines.join('\n');
  }

  /* ---------------- settings ---------------- */

  /* Our own menu, drawn over the native select.

     The select is kept and keeps the value: everything that reads .value or
     listens for change goes on working untouched. What the reader sees and
     taps is ours, so one shape and one face on every phone rather than
     whatever the system draws. Choosing sets the select and fires change, the
     same event a tap on the native control would have fired. */
  function enhanceSelect(sel) {
    if (!sel || sel.dataset.picked === '1' || sel.multiple) return;
    sel.dataset.picked = '1';
    var wrap = document.createElement('span');
    wrap.className = 'picker';
    var btn = document.createElement('button');
    btn.type = 'button';
    /* the select's own classes are not copied onto the button: .select caps
       itself at a share of the row, which cut our label to «نـ…». Only the
       marker classes travel, so a rule meant for one kind of menu still finds
       its button. */
    btn.className = 'picker-btn' +
      (sel.classList.contains('select-sound') ? ' for-sound' : '') +
      (sel.id ? ' for-' + sel.id : '');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    wrap.appendChild(btn);
    syncPicker(sel);
  }

  /* the button says what the select holds; called after anything refills it */
  /* An option written in its own language, a language's name in the list of
     languages, says so, and the picker's copy of it says the same, so it is
     read in that language and never put into the reader's. */
  function ownTongue(option) {
    if (!option || option.getAttribute('translate') !== 'no') return '';
    var lang = option.getAttribute('lang');
    var dir = option.getAttribute('dir');
    return ' translate="no"' + (lang ? ' lang="' + esc(lang) + '"' : '') + (dir ? ' dir="' + esc(dir) + '"' : '');
  }

  function syncPicker(sel) {
    var wrap = sel.parentNode;
    if (!wrap || !wrap.classList.contains('picker')) return;
    var btn = wrap.querySelector('.picker-btn');
    if (!btn) return;
    var chosen = sel.options[sel.selectedIndex];
    btn.innerHTML = '<span class="picker-label"' + ownTongue(chosen) + '>' + esc(chosen ? chosen.text : '') + '</span>' +
      '<svg class="icon picker-caret" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chevron"/></svg>';
    btn.disabled = sel.disabled;
  }

  function syncPickers() {
    document.querySelectorAll('select[data-picked="1"]').forEach(syncPicker);
    /* the bedtime button is written in the reader's own clock, so it is
       redrawn whenever the settings are, not only when it is first built */
    document.querySelectorAll('input[type="time"][data-picked="1"]').forEach(syncTime);
  }

  /* An <input type="time"> is drawn by the phone: android gives it a width of
     its own and a clock dialog of its own, neither of which is ours. It is
     replaced by a picker of two columns, hours and minutes, on the twenty four
     hour clock: no morning and evening to read past, just the hour you want.
     The element keeps its id and its «HH:MM» value, so the handler bound to it
     goes on working. */
  /* the bedtime is written the way the reader set their clock, twelve hours or
     twenty four, like every other time the app shows */
  function timeLabel(hhmm) {
    var parts = String(hhmm || '00:00').split(':');
    return clockText(+parts[0] * 60 + +parts[1]);
  }

  function enhanceTime(input) {
    if (!input || input.dataset.picked === '1') return;
    input.dataset.picked = '1';
    var wrap = document.createElement('span');
    wrap.className = 'picker timepick';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-btn for-time';
    btn.setAttribute('aria-haspopup', 'dialog');
    if (input.getAttribute('aria-label')) btn.setAttribute('aria-label', input.getAttribute('aria-label'));
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(btn);
    input.hidden = true;
    input.style.display = 'none';
    syncTime(input);
  }

  function syncTime(input) {
    var wrap = input.parentNode;
    if (!wrap || !wrap.classList.contains('timepick')) return;
    var btn = wrap.querySelector('.picker-btn');
    if (!btn) return;
    btn.innerHTML = '<span class="picker-label">' + esc(timeLabel(input.value)) + '</span>' +
      '<svg class="icon picker-caret" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chevron"/></svg>';
  }

  /* two columns of numbers, the chosen one marked, as the app marks anything */
  function openTimePicker(btn) {
    closePicker();
    var input = btn.parentNode.querySelector('input[type="time"]');
    if (!input) return;
    var now = String(input.value || '22:30').split(':');
    var panel = document.createElement('div');
    panel.className = 'picker-panel timepick-panel';
    panel.setAttribute('role', 'dialog');
    /* its hours, «5 م», are times, which another language writes its own way */
    panel.setAttribute('data-tr', 'time');
    /* «upTo», not «count»: a local by that name hides the count helper, and
       any call to it inside this scope would fail */
    var twelve = Store.get('clock') !== '24';
    var col = function (kind, upTo, step, chosen) {
      var out = '<div class="timecol" data-timecol="' + kind + '">';
      for (var v = 0; v < upTo; v += step) {
        var t = String(v).padStart(2, '0');
        /* on a twelve hour clock the hours read 12, 1, 2 … with the half of
           the day beside them, while the value stored stays the full hour */
        var shown = t;
        if (kind === 'h' && twelve) {
          shown = ar(v % 12 === 0 ? 12 : v % 12) + ' ' + (v < 12 ? 'ص' : 'م');
        } else {
          shown = ar(t);
        }
        out += '<button type="button" class="timecell' + (t === chosen ? ' is-on' : '') +
          '" data-time="' + kind + ':' + t + '">' + esc(shown) + '</button>';
      }
      return out + '</div>';
    };
    panel.innerHTML = '<div class="timecols">' +
      col('h', 24, 1, now[0]) + '<span class="timesep">:</span>' + col('m', 60, 5, now[1]) +
      '</div>';
    var veil = document.createElement('div');
    veil.className = 'picker-veil';
    document.body.appendChild(veil);
    document.body.appendChild(panel);
    var r = btn.getBoundingClientRect();
    panel.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 232))) + 'px';
    panel.style.width = '224px';
    var room = window.innerHeight - r.bottom;
    if (room < 260 && r.top > room) panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    else panel.style.top = (r.bottom + 6) + 'px';
    state.pickerFor = btn;
    panel.querySelectorAll('.is-on').forEach(function (on) { on.scrollIntoView({ block: 'center' }); });
  }

  function chooseTime(ref) {
    var btn = state.pickerFor;
    if (!btn) return;
    var input = btn.parentNode.querySelector('input[type="time"]');
    if (!input) return;
    var parts = String(input.value || '22:30').split(':');
    var bits = ref.split(':');
    if (bits[0] === 'h') parts[0] = bits[1]; else parts[1] = bits[1];
    input.value = parts[0] + ':' + parts[1];
    syncTime(input);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    /* the panel stays open: an hour and a minute are two choices, and closing
       after the first would make the reader open it twice */
    var panel = document.querySelector('.timepick-panel');
    if (panel) {
      panel.querySelectorAll('[data-time^="' + bits[0] + ':"]').forEach(function (c) {
        c.classList.toggle('is-on', c.getAttribute('data-time') === ref);
      });
    }
  }

  /* A date field is drawn by the phone in the phone's own language and theme,
     so it read mm/dd/yyyy on an english phone and its mark was black on the
     dark theme, and it stays where it is and a tap still opens the phone's own
     calendar, but over it lies the date in words as the home screen writes
     the day. */
  function enhanceDate(input) {
    if (!input || input.dataset.picked === '1') return;
    input.dataset.picked = '1';
    var wrap = document.createElement('span');
    wrap.className = 'datepick';
    var face = document.createElement('span');
    face.className = 'datepick-face';
    face.setAttribute('aria-hidden', 'true');
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(face);
    input.addEventListener('input', function () { syncDate(input); });
    input.addEventListener('change', function () { syncDate(input); });
    syncDate(input);
  }

  function syncDate(input) {
    var wrap = input ? input.parentNode : null;
    if (!wrap || !wrap.classList.contains('datepick')) return;
    var face = wrap.querySelector('.datepick-face');
    var parts = String(input.value || '').split('-');
    var date = parts.length === 3 ? new Date(+parts[0], +parts[1] - 1, +parts[2]) : null;
    var known = date && !isNaN(date.getTime());
    face.classList.toggle('is-empty', !known);
    face.innerHTML = '<span>' + esc(known
      ? Hijri.WEEKDAYS[date.getDay()] + '، ' + ar(date.getDate()) + ' ' + GREG_MONTHS[date.getMonth()] + ' ' + ar(date.getFullYear())
      : 'اختر يوماً') + '</span>' + icon('calendar');
  }

  function enhanceSelects() {
    document.querySelectorAll('input[type="time"]').forEach(enhanceTime);
    document.querySelectorAll('input[type="date"]').forEach(enhanceDate);
    document.querySelectorAll('select').forEach(enhanceSelect);
  }

  /* The panel is fixed and measured off the button, so a card that clips its
     own overflow cannot cut the list in half. */
  function openPicker(btn) {
    closePicker();
    var sel = btn.parentNode.querySelector('select');
    if (!sel || !sel.options.length) return;
    var panel = document.createElement('div');
    panel.className = 'picker-panel';
    panel.setAttribute('role', 'listbox');
    panel.innerHTML = Array.prototype.map.call(sel.options, function (o, i) {
      return '<button type="button" class="picker-item' + (i === sel.selectedIndex ? ' is-on' : '') +
        '" role="option" aria-selected="' + (i === sel.selectedIndex) + '" data-pick="' + i + '">' +
        '<span' + ownTongue(o) + '>' + esc(o.text) + '</span>' +
        (i === sel.selectedIndex ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg>' : '') +
        '</button>';
    }).join('');
    var veil = document.createElement('div');
    veil.className = 'picker-veil';
    document.body.appendChild(veil);
    document.body.appendChild(panel);
    var r = btn.getBoundingClientRect();
    var room = window.innerHeight - r.bottom;
    /* Under the button and the width of it, placed by left and width rather
       than by inset-inline-end: in a right to left page that end is measured
       from the other side, and the panel slid away from the control it
       belongs to. */
    /* The languages are named each in its own script and the first is the
       device's, «Device language, English», which a panel the width of a
       small button broke over three lines: theirs is wider, grown from the
       end of the button the row ends at. */
    var left = r.left, w = r.width;
    if (sel.id === 'settings-lang') {
      w = Math.max(r.width, Math.min(240, window.innerWidth - 32));
      left = getComputedStyle(btn).direction === 'ltr' ? r.right - w : r.left;
      left = Math.max(16, Math.min(left, window.innerWidth - 16 - w));
    }
    panel.style.left = Math.round(left) + 'px';
    panel.style.width = Math.round(w) + 'px';
    /* below the button when there is room, above it when there is not */
    if (room < 220 && r.top > room) {
      panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      panel.style.maxHeight = Math.min(300, r.top - 16) + 'px';
    } else {
      panel.style.top = (r.bottom + 6) + 'px';
      panel.style.maxHeight = Math.min(300, room - 16) + 'px';
    }
    btn.setAttribute('aria-expanded', 'true');
    state.pickerFor = btn;
    var on = panel.querySelector('.is-on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function closePicker() {
    var open = document.querySelector('.picker-panel');
    if (open) open.remove();
    var veil = document.querySelector('.picker-veil');
    if (veil) veil.remove();
    if (state.pickerFor) state.pickerFor.setAttribute('aria-expanded', 'false');
    state.pickerFor = null;
  }

  function choosePicker(index) {
    var btn = state.pickerFor;
    if (!btn) return;
    var sel = btn.parentNode.querySelector('select');
    closePicker();
    if (!sel || !sel.options[index]) return;
    if (sel.selectedIndex === index) return;
    sel.selectedIndex = index;
    syncPicker(sel);
    /* the very event a tap on the native control would have fired */
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillSelect(el, options, value) {
    if (!el) return;
    el.innerHTML = options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value) ? ' selected' : '') +
        '>' + esc(o.label) + '</option>';
    }).join('');
    el.value = String(value);
    syncPicker(el);
  }

  function setSwitch(el, on) {
    if (!el) return;
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    if (on) el.classList.add('is-on'); else el.classList.remove('is-on');
    /* a reminder's row knows when it is off, and its sound and its hour are
       put out of sight until the switch brings them back */
    var row = el.parentNode;
    if (!row || !row.children) return;
    for (var i = 0; i < row.children.length; i++) {
      if (row.children[i].classList.contains('remind-controls')) { row.classList.toggle('is-off', !on); return; }
    }
  }

  /* The reminder says the fast is tomorrow, but not which fast. Monday and
     thursday anyone can count; the white days are the thirteenth, fourteenth
     and fifteenth of the hijri month, and nobody carries that in their head,
     so the next one is named here. */
  function renderNextFast() {
    var host = $('fast-next');
    if (!host) return;
    function strip(cls, top, note) {
      host.className = 'next-fast' + (cls ? ' ' + cls : '');
      host.innerHTML = icon('fast') +
        '<span class="next-fast-body"><span class="next-fast-when">' + esc(top) + '</span>' +
        '<span class="next-fast-note">' + esc(note) + '</span></span>';
    }
    if (!Store.get('fastNote')) {
      strip('is-off', 'تذكير الصيام موقوف', 'شغّله ليصلك التنبيه ليلة اليوم الذي يُستحب صيامه');
      return;
    }
    /* one place knows which day is next and how to say when: nextFast(), which
       the home calendar reads too */
    var next = nextFast();
    if (next) {
      /* «صيام الإثنين» already says which day it is, so the date does not say
         it again: أقرب صيام الإثنين الإثنين ١٤ سبتمبر reads like a stutter */
      var weekday = Hijri.WEEKDAYS[next.date.getDay()];
      var dated = (next.names.indexOf(weekday) === -1 ? weekday + ' ' : '') +
        ar(next.date.getDate()) + ' ' + GREG_MONTHS[next.date.getMonth()];
      var tail = next.days === 1 ? '، والتنبيه الليلة بعد المغرب بساعة ونصف'
        : '، والتنبيه ليلته بعد المغرب بساعة ونصف';
      var note = next.days === 0 ? 'اليوم، والتنبيه وصلك ليلته'
        : next.when + ' ' + dated + tail;
      strip('', 'أقرب صيام: ' + next.names, note);
      return;
    }
    host.className = 'next-fast';
    host.innerHTML = '';
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

    var showMeanings = $('settings-meanings');
    if (showMeanings) {
      var row = showMeanings.closest('.setting');
      if (row) row.hidden = !meaningLang();
      setSwitch(showMeanings, Store.get('meanings') !== false);
    }
    /* the hadith the share row quotes stays as it was said, and in another
       language its meaning stands under it, from HadeethEnc like the forty */
    var said = $('share-said');
    if (said) {
      var quotes = bookOf('hadith');
      var quote = quotes && quotes.q ? quotes.q[said.getAttribute('data-said')] : null;
      said.hidden = !quote;
      if (quote) {
        said.textContent = quote.t;
        said.setAttribute('lang', meaningLang());
        said.setAttribute('dir', window.I18n.dir);
        said.setAttribute('translate', 'no');
      } else {
        withBook('hadith', function () { if (state.view === 'settings') renderSettings(); });
      }
    }
    var credit = $('about-meanings');
    if (credit) {
      credit.hidden = !meaningLang();
      if (meaningLang()) loadMeanings().then(function () { credit.textContent = meaningSource(); }, function () { credit.hidden = true; });
    }
    var langs = $('settings-lang');
    if (langs && window.I18n) {
      /* the page names every language the app is being put into; the list
         offers those whose words have come */
      Array.prototype.slice.call(langs.options).forEach(function (o) {
        if (o.value !== 'auto' && !window.I18n.langs.some(function (l) { return l.code === o.value; })) o.remove();
      });
      var device = window.I18n.langs.filter(function (l) { return l.code === window.I18n.device(); })[0];
      if (langs.options[0]) langs.options[0].textContent = 'لغة الجهاز' + (device ? '، ' + device.name : '');
      langs.value = window.I18n.stored();
      syncPicker(langs);
    }
    if ($('settings-asr')) $('settings-asr').value = s.asr;
    if ($('settings-highlat')) $('settings-highlat').value = s.highLat;
    if ($('settings-theme')) $('settings-theme').value = s.theme;

    /* the list says when, never whether: the switch beside it says that */
    fillSelect($('settings-salawat'), [
      { value: '60', label: 'كل ساعة' },
      { value: '120', label: 'كل ساعتين' },
      { value: '180', label: 'كل ثلاث ساعات' },
      { value: '360', label: 'كل ست ساعات' }
    ], String(s.salawat || 0));
    fillVoiceListSoon();
    setSwitch($('settings-after-prayer'), !Store.get('afterPrayerOff'));
    setSwitch($('settings-jumuah-night'), !!Store.get('jumuahNight'));
    setSwitch($('settings-jumuah-sheet'), !!Store.get('jumuahNightSheet'));
    setSwitch($('settings-sky'), skyOn());
    setSwitch($('settings-fast-note'), !!Store.get('fastNote'));
    if ($('settings-page-layout')) $('settings-page-layout').value = Store.get('pageLayout') || 'flow';
    if ($('settings-listen')) $('settings-listen').value = Store.get('listenAs') || '';
    if ($('settings-clock')) $('settings-clock').value = Store.get('clock') === '24' ? '24' : '12';
    if ($('settings-wird')) $('settings-wird').value = Store.get('wirdAt') || '';
    if ($('settings-jumuah-before')) $('settings-jumuah-before').value = String(+Store.get('jumuahBefore') || 0);
    setSwitch($('settings-qiyam'), !!Store.get('qiyam'));
    /* a switch with no answer yet shows what the phone is set to */
    setSwitch($('settings-contrast'), document.documentElement.classList.contains('want-contrast'));
    setSwitch($('settings-motion'), document.documentElement.classList.contains('less-motion'));
    setSwitch($('settings-duha'), !!Store.get('duha'));
    /* the three whose list says when: the switch says whether, and the list
       is dimmed while it is off so it is plain which one is in charge */
    /* Two faults lived here at once. The list said «wird», which the store does
       not hold, so whenIsOn read undefined for it and the switch never showed
       as on. And slug was used a line before it was declared, so setSwitch was
       handed undefined and set nothing for any of the three. */
    ['jumuahBefore', 'salawat', 'wirdAt'].forEach(function (key) {
      var on = whenIsOn(key);
      var slug = slugFor(key);
      setSwitch($('settings-' + slug + '-on'), on);
      var list = $('settings-' + slug);
      if (list) {
        /* while it is off the stored value is the off one, which is no longer
           an option, so the list would show blank. It shows the last real
           choice instead, dimmed: the reader sees what turning it on returns. */
        var last = (Store.get('lastWhen') || {})[key];
        var fallback = key === 'wirdAt' ? '20:00' : 60;
        var real = last !== undefined && last !== null && String(last) !== String(WHEN_OFF[key]);
        list.value = String(on ? Store.get(key) : (real ? last : fallback));
        list.disabled = !on;
        syncPicker(list);
      }
    });
    /* the reader's own reminders and the sound each makes */
    ['morningAdhkar', 'eveningAdhkar', 'sleepIstighfar', 'sleepMulk', 'sleepKursi'].forEach(function (key) {
      setSwitch($('settings-' + key), !!Store.get(key));
    });
    if ($('settings-sleep-at')) $('settings-sleep-at').value = Store.get('sleepAt') || '22:30';
    document.querySelectorAll('.select-sound').forEach(function (sel) {
      sel.value = soundFor(sel.getAttribute('data-sound'));
    });
    showQiyamTime();
    showDuhaTime();
    fillAdhanVoices();
    handSalawatToApp();
    handQiyamToApp();
    renderSavedAudio();
    renderAdhanRow();
    fillSelect($('settings-salawat-voice'), (typeof SALAWAT_VOICES !== 'undefined' ? SALAWAT_VOICES : []).map(function (v) {
      return { value: v.id, label: v.n };
    }), (salawatVoice() || {}).id || '');
    var salawatRow = $('settings-salawat-voice') ? $('settings-salawat-voice').closest('.setting') : null;
    if (salawatRow) salawatRow.hidden = (s.voice || 'recording') !== 'recording';
    var shown = $('salawat-text');
    if (shown) {
      shown.hidden = (s.voice || 'recording') !== 'recording';
      shown.textContent = salawatText();
      /* an ayah is set in the mushaf's own face, a dua in the naskh */
      shown.className = ((salawatVoice() || {}).q ? 'quran' : 'naskh') + ' salawat-text';
    }
    var from = $('salawat-from');
    if (from) {
      from.hidden = (s.voice || 'recording') !== 'recording';
      from.textContent = salawatFrom();
    }
    fillSelect($('settings-voice'), [
      { value: 'recording', label: 'صوت قارئ' },
      { value: 'tone', label: 'نغمة' },
      { value: 'speech', label: 'صوت الهاتف ينطقها' },
      { value: 'none', label: 'صامت' }
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

    fillSelect($('settings-reciter'), (typeof RECITERS !== 'undefined' ? RECITERS : []).map(function (r) {
      return { value: r.id, label: r.name + '، ' + r.country };
    }), reciterId());

    setSwitch($('settings-notify'), !!s.notify);
    setSwitch($('settings-vibrate'), !!s.vibrate);
    applyFont();
    /* the buttons are told what the lists hold once every list is set: told
       halfway, the tafsir and the bedtime and the sounds kept showing what
       they held before a delete or a restore */
    syncPickers();

    /* the stores' card is for readers in a browser; inside the app it would point at itself */
    if ($('about-store')) $('about-store').hidden = !!bridge();
    var installRow = $('settings-install');
    if (installRow) {
      /* on an android phone in a browser the app to install is the store's */
      var play = onAndroidWeb();
      installRow.hidden = play ? false : (!state.installOffer || standalone());
      installRow.textContent = play ? 'ثبّت التطبيق من Google Play' : 'ثبّت التطبيق على جهازك';
    }
    if ($('offline-state')) {
      $('offline-state').textContent = Mushaf.ready()
        ? 'نص المصحف محمّل في جهازك، فالقراءة تعمل بلا إنترنت'
        : 'نص المصحف لم يكتمل تحميله بعد';
    }
    if ($('about-version')) $('about-version').textContent = 'النسخة ' + ar(VERSION) + packageLine();
  }

  function chooseCity(index) {
    if (typeof CITIES === 'undefined') return;
    var c = CITIES[index];
    if (!c) return;
    setPlace({ n: c.n, lat: c.lat, lng: c.lng, tz: c.tz, z: c.z, method: c.method }, true);
    /* chosen by hand, so the fix at boot leaves it alone from now on */
    Store.set('placeFrom', 'pick');
    Store.set('methodFrom', 'pick');
    toast('ضُبطت المواقيت على ' + c.n);
  }

  function askNotify() {
    var on = !Store.get('notify');
    if (!on) { Store.set('notify', false); setSwitch($('settings-notify'), false); return; }
    if (!window.Notification) { toast('تعذّرت الإشعارات على هذا الجهاز'); return; }
    window.Notification.requestPermission().then(function (result) {
      var granted = result === 'granted';
      Store.set('notify', granted);
      setSwitch($('settings-notify'), granted);
      toast(granted ? 'ستصلك تنبيهات الصلاة' : (inAndroidApp() ? 'اسمح بالإشعارات لسُنّتي من إعدادات الهاتف، ثم أعد المحاولة' : 'لم يُسمح بالإشعارات'));
      Store.set('notifyAsked', true);
      if (granted) {
        notify('سُنّتي', 'هكذا يصلك التنبيه عند دخول الوقت', 'welcome');
        scheduleForWorker();
      }
    });
  }

  function exportBackup() {
    var payload = Store.exportAll();
    var text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    var name = 'sunnati-backup-' + Store.dayKey() + '.json';
    /* inside the app the file goes through the phone's own share sheet, so it
       can be kept in Drive or sent to oneself rather than lost with the phone */
    var app = bridge();
    if (app && app.saveFile) {
      var ok = false;
      try { ok = app.saveFile(name, text); } catch (e) { ok = false; }
      if (ok) { toast(inIosApp() ? 'اختر أين تحفظ نسختك' : 'حُفظت نسختك في التنزيلات باسم ' + name); return; }
      toast('تعذّر حفظ النسخة');
      return;
    }
    var blob = new window.Blob([text], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
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
      /* a backup made before one sunnah had one tick brings its old names back */
      settleTicks();
      /* and one made before آية الكرسي and the quls headed the morning and
         evening lists brings its days counted in the older order */
      settleAzkar();
      restoreTasbih();
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

  /* One press used to wipe everything, with nothing asked and nothing to
     take back, from a button that sits under the backup buttons. */
  function askClearEverything() {
    confirmSheet('حذف كل البيانات',
      'يُحذف من هذا الجهاز كل ما سجّلته فيه: إعداداتك وموقعك، والآيات التي علّمتها وملاحظاتك عليها، ' +
      'وسجل صلواتك وسننك وأذكارك، وخطة الختمة وخطوات العمرة، والتلاوات المحفوظة للاستماع بلا إنترنت، ' +
      'ولا يعود شيء منه إلا من نسخة احتياطية، فخذ نسختك قبل الحذف إن أردت الاحتفاظ به',
      'احذف كل شيء', 'clear-everything');
  }

  function clearEverything() {
    closeSheet();
    var removed = Store.clearAll();
    state.place = null;
    state.tasbih = { index: 0, count: 0 };
    /* The recitations kept for listening offline go with the rest. Their
       flags went with the settings, and audio the app no longer knows it
       holds could never be found again to be removed. */
    try {
      if (window.caches && window.caches.delete) window.caches.delete(AUDIO_STORE).catch(function () { /* nothing kept */ });
    } catch (e) { /* no store on this device */ }
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
    toast('جاري جلب النسخة الأحدث');
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
    if (!window.caches) { toast('تعذّر التخزين للعمل بلا إنترنت'); return; }
    toast('جاري التحميل');
    window.caches.open('sunnati-v' + VERSION).then(function (cache) {
      /* the tafsir and the recording go in too, so nothing needs the network later */
      return cache.addAll(['./', './index.html', './data/mushaf.json', './css/style.css',
        './data/tafsir-muyassar.json', './audio/salawat/ibrahimiyya.mp3']);
    }).then(function () {
      toast('صار كل شيء متاحاً بلا إنترنت، ومعه التفسير');
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
    umrah: renderUmrah,
    qada: renderQada,
    mosques: renderMosques,
    qibla: renderQibla,
    tasbih: renderTasbih,
    radio: renderRadio,
    hadith: renderHadith,
    dua: function () { renderDua(); renderDuaThemes(); },
    ruqyah: renderRuqyah,
    calendar: renderCalendar,
    reminders: function () { renderSettings(); renderNextFast(); },
    timetable: renderTimetable,
    page: renderPage,
    hisn: renderHisnChapter,
    prayers: renderPrayers,
    settings: renderSettings,
    about: renderSettings
  };

  var ACTIONS = {
    'share-app': function () { shareApp(); },
    'rate-app': function () { rateApp(); },
    'send-feedback': function () { sendFeedback(); },
    'start-tour': function () {
      go('home');
      window.setTimeout(function () { startTour(true); }, 320);
    },
    bookmark: function (ref, el) {
      var parts = ref.split(':');
      var s = +parts[0], a = +parts[1];
      var kind = el && el.getAttribute ? (el.getAttribute('data-kind') || 'read') : 'read';
      var added = Store.toggleBookmark(s, a, kind);
      toast(added ? 'عُلّمت الآية: ' + BOOKMARK_NAMES[kind] : 'أُزيلت العلامة');
      verseSheet(s, a);
      if (state.view === 'reader') renderReader();
      if (state.view === 'bookmarks') renderBookmarks();
      /* the page shows its marks as well, and is marked in place: drawing it
         again would throw the reader back to the top of the page */
      $$('#page-body .ayah[data-ayah="' + s + ':' + a + '"]').forEach(function (el) {
        el.classList.toggle('is-marked', !!Store.bookmarkKind(s, a));
      });
    },
    share: function (ref) {
      var parts = ref.split(':');
      var s = +parts[0], a = +parts[1];
      var meta = surahMeta(s);
      var words = Mushaf.ayah(s, a) + '\n\nسورة ' + (meta ? meta.ar : '') + '، آية ' + ar(a) + '\nsunnati.3li.info';
      sharePicture(verseCard(s, a), 'ayah-' + s + '-' + a + '.png', 'سورة ' + (meta ? meta.ar : '') + ' آية ' + ar(a), words);
    },
    'share-video': function (ref) {
      var parts = ref.split(':');
      shareVerseVideo(+parts[0], +parts[1]);
    },
    'video-stop': function () { closeSheet(); },
    'video-send': function () { sendVideo(); },
    note: function (ref) {
      var parts = ref.split(':');
      openNote(+parts[0], +parts[1]);
    },
    'note-save': function (ref) {
      var parts = ref.split(':');
      var field = $('note-field');
      Store.setNote(+parts[0], +parts[1], field ? field.value : '');
      toast(field && field.value.trim() ? 'حُفظت الملاحظة' : 'أُزيلت الملاحظة');
      verseSheet(+parts[0], +parts[1]);
    },
    'share-dua': function (ref) {
      var parts = ref.split(':');
      var topic = duaTopics().filter(function (t) { return t.id === parts[0]; })[0];
      if (!topic) return;
      var text = topic.i[+parts[1]];
      if (text) sharePicture(textCard('من أدعية ' + topic.n, text, 'naskh', ''), 'dua.png', topic.n, text + '\n\nsunnati.3li.info');
    },
    /* the preview is heard, not announced: a notice here rang the phone's own
       tone over the voice being tried */
    'hear-salawat': function () {
      playRecording(salawatUrl(), 'settings-voice-try', salawatName());
    },
    'open-kahf': function () { closeSheet(); state.surah = 18; go('reader'); },
    /* the khatma card redraws itself on every change, so a listener put on the
       button at wire time would be thrown away with the first redraw */
    /* the home line redraws itself whenever the times are worked out, so a
       listener put on the button at wire time would not survive the first one */
    locate: function () { locate(function () { renderHome(); }); },
    /* the tap on the line is the reader asking on purpose, so it is the loud one */
    'khatma-plus': function () { stepKhatma(1); },
    'khatma-minus': function () { stepKhatma(-1); },
    /* starting over wipes the count of pages read, so it is asked first */
    'khatma-restart': function () {
      confirmSheet('ختمة جديدة',
        'يرجع عدّاد الختمة إلى أول المصحف وتبدأ أيام الخطة من اليوم، وكنت قرأت ' +
        ar(Store.progress().pagesRead || 0) + ' من ' + pages(TOTAL_PAGES),
        'ابدأ ختمة جديدة', 'khatma-restart-now');
    },
    'khatma-restart-now': function () {
      closeSheet();
      Store.setReadPages(0);
      Store.set('khatmaStart', Date.now());
      renderKhatma();
      toast('بدأت ختمة جديدة');
    },
    'sheet-cancel': function () { closeSheet(); },
    'clear-everything': function () { clearEverything(); },
    'share-jumuah-night': function () { shareJumuahNight(); },
    'share-sunan': function () {
      var rows = todaySunanLines();
      /* the card is the list of the day, so it carries the day it is for:
         «من السنن الرواتب» stood over fasts, adhkar and charity */
      var day = sunnahDay();
      var h = Hijri.toHijri(day, Store.get('hijriAdjust'));
      sharePicture(listCard('سنن اليوم', rows, h.weekday + '، ' + Hijri.format(h)),
        'sunan.png', 'سنن اليوم', rows.join('\n') + '\n\nتطبيق سُنّتي · sunnati.3li.info');
    },
    'snooze-jumuah-night': function () {
      var at = snoozeJumuahNight(60);
      closeSheet();
      toast('سنذكّرك عند ' + clockText(new Date(at).getHours() * 60 + new Date(at).getMinutes()));
    },
    'hide-jumuah-night': function () {
      /* this button is on the sheet, so it puts the sheet away, and leaves the
         notification to its own switch in the settings */
      Store.set('jumuahNightSheet', false);
      Store.set('jumuahNightQuiet', 0);
      setSwitch($('settings-jumuah-sheet'), false);
      closeSheet();
      toast('لن تُعرض ليلة الجمعة عند الفتح، وتعيدها من الإعدادات ← السنن والمواسم');
      renderSettings();
    },
    /* chapter 25 is الأذكار بعد السلام من الصلاة; 27 is morning and evening.
       The sheet was fixed to read 25 and this button was left on 27, so «افتح
       الباب كاملاً» opened the wrong chapter. */
    'open-after-prayer': function () { closeSheet(); state.hisn = 25; go('hisn'); },
    /* hear the chapter in the reciter's own voice, or stop it if it is playing */
    'hear-hisn': function (ref, el) {
      var heard = HISN_AUDIO[+ref];
      if (!heard) return;
      if (state.voiceClip) { stopSpeaking(); return; }
      /* the button itself, so it can show a pause while it plays */
      var hisn = HISN.filter(function (c) { return c.id === +ref; })[0];
      /* the player in the shade names it, so no notification rings beside it */
      playRecording('audio/dua/' + heard.f, el, hisn.t);
      toast('بصوت ' + heard.n);
    },
    'after-prayer-off': function () {
      Store.set('afterPrayerOff', true);
      closeSheet();
      toast('لن تُعرض بعد الصلاة، وتعيدها من الإعدادات');
      renderSettings();
    },
    mosques: function () { go('mosques'); },
    'mosque-go': function (ref) { mosqueRoute(ref); },
    'listen-as': function (ref) {
      var parts = ref.split(':');
      var how = parts[0], n = +parts[1];
      var remember = $('listen-remember') && $('listen-remember').getAttribute('aria-checked') === 'true';
      if (remember) Store.set('listenAs', how);
      closeSheet();
      if (how === 'follow') reciteFrom(n, state.ayah || 1);
      else playWholeSurah(n);
    },
    'mosques-again': function () {
      /* asked for afresh, wherever the map is now looking */
      state.mosques = null;
      state.lookedAt = null;
      renderMosques();
    },
    'mosque-look': function (ref, el) {
      var parts = String(ref).split(':');
      lookAtMosque(+parts[0], parts[1] || (el && el.closest('.map-pin') ? 'map' : 'list'));
    },
    'player-open': function () {
      /* pressing what is sounding takes the reader to it */
      if (state.recite) { state.surah = state.recite.s; go('reader'); return; }
      if (state.playing && state.playing.surah) { state.surah = state.playing.surah; go('reader'); }
    },
    'qada-done': function (ref) {
      Store.markQada(ref, 1);
      buzz(8);
      renderQada();
      toast('تقبّل الله، ' + PRAYER_NAMES[ref] + ' قضيتها');
    },
    'fast-owed': function (ref) {
      Store.setFastOwed((+Store.get('fastOwed') || 0) + (+ref));
      renderQada();
    },
    'fast-done': function () {
      if (!Store.fastOwed()) { toast('ليس عليك صيام'); return; }
      Store.markFast(1);
      buzz(8);
      renderQada();
      var left = Store.fastOwed();
      toast(left ? 'تقبّل الله، بقي ' + daysOf(left) : 'تقبّل الله، وقضيت كل ما عليك');
    },
    'to-calendar': function (ref) {
      var at = ref.lastIndexOf('|');
      addToCalendar(ref.slice(0, at), new Date(+ref.slice(at + 1)));
    },
    'read-pace': function (ref) {
      Store.set('readPace', ref);
      closeSheet();
      startAutoScroll();
    },
    /* the steps marked on the way are the pilgrim's place in the rite, so
       wiping them is asked first */
    'umrah-reset': function () {
      var marked = Object.keys(Store.get('umrah') || {}).length;
      if (!marked) { toast('لم تعلّم خطوة بعد'); return; }
      var total = 0;
      UMRAH_STAGES.forEach(function (stage) { total += stage.i.length; });
      confirmSheet('البدء من جديد',
        'تُمسح علامات الخطوات التي أدّيتها وهي ' + count(marked, 'خطوة واحدة', 'خطوتان', 'خطوات', 'خطوة') +
        ' من ' + ar(total) + '، فتبدأ العمرة من أولها',
        'امسح الخطوات', 'umrah-reset-now');
    },
    'umrah-reset-now': function () {
      closeSheet();
      Store.set('umrah', {});
      renderUmrah();
      toast('بدأت الخطوات من أولها');
    },
    'download-stop': function () { if (state.downloading) state.downloading.stop = true; },
    'audio-remove-confirm': function (ref) {
      var parts = ref.split(':');
      removeSurahAudio(parts[0], +parts[1]).then(function () {
        closeSheet(); toast('حُذف الصوت'); renderReader(); renderSavedAudio();
      });
    },
    'prayer-mark': function (ref) {
      var parts = ref.split(':');
      var when = dateOfStamp(parts[2]);
      Store.setPrayer(parts[0], parts[1] || null, when);
      closeSheet();
      buzz(8);
      if (parts[1] === 'jamaah' || parts[1] === 'ontime') {
        var st = Store.prayerStats(30);
        if (st.streak && st.streak % 7 === 0 && parts[0] === 'isha') toast(daysOf(st.streak) + ' بالخمس في وقتها، ثبّتك الله');
      }
      renderHome();
      if (state.view === 'prayers') renderPrayers();
      if (state.view === 'qada') renderQada();
      /* a prayer just prayed is the moment for its own adhkar, so they are
         offered where the reader stands rather than left to be hunted for */
      if ((parts[1] === 'jamaah' || parts[1] === 'ontime') && sameDay(when, new Date())) {
        window.setTimeout(function () { offerAfterPrayer(parts[0]); }, 420);
      }
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
      copyText(Mushaf.ayah(sNum, aNum) + '\n\n' + tongue('سورة ' + (meta ? meta.ar : '') + '، آية ' + ar(aNum)))
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
    /* every mark at once, so it is asked first */
    'clear-bookmarks': function () {
      var marked = Store.bookmarks().length;
      confirmSheet('مسح كل العلامات',
        'تُمسح العلامات التي وضعتها على الآيات كلها، وعددها ' + ar(marked) + '، وتبقى ملاحظاتك عليها كما هي',
        'امسح العلامات', 'clear-bookmarks-now');
    },
    'clear-bookmarks-now': function () {
      closeSheet();
      Store.clearBookmarks();
      renderBookmarks();
      toast('مُسحت المحفوظات');
    }
  };

  /* ---------------- wiring ---------------- */

  function onClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    /* the iPhone's web view lets a followed mail link die inside it, so the
       address on the about screen reached no one from the app */
    var mail = target.closest('a[href^="mailto:"]');
    if (mail && inIosApp()) {
      if (event.preventDefault) event.preventDefault();
      openOutside(mail.getAttribute('href'));
      return;
    }

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
      if (fn) fn(act.getAttribute('data-ref') || '', act);
      return;
    }

    var foldHead = target.closest('.fold-head');
    /* the umrah keeps its own folds under their own name, so a head with no
       [data-fold] above it is not this handler's business */
    if (foldHead && foldHead.closest('[data-fold]')) {
      var section = foldHead.closest('[data-fold]');
      var key = section.getAttribute('data-fold');
      openGroups[key] = !section.classList.contains('is-open');
      section.classList.toggle('is-open');
      foldHead.setAttribute('aria-expanded', section.classList.contains('is-open') ? 'true' : 'false');
      return;
    }

    var check = target.closest('[data-check]');
    if (check) {
      var shownDay = check.closest('[data-sunnah-day]');
      toggleCheck(check.getAttribute('data-check'), shownDay ? shownDay.getAttribute('data-sunnah-day') : null);
      return;
    }

    var azkar = target.closest('[data-azkar]');
    if (azkar) { openAzkar(azkar.getAttribute('data-azkar')); return; }

    var picture = target.closest('[data-picture]');
    if (picture) {
      var picRef = picture.getAttribute('data-picture').split(':');
      var index = +picRef[1];
      if (picRef[0] === 'dua') {
        var g = DUAS[+picRef[1]], d = g && g.items[+picRef[2]];
        if (d) shareTextCard(g.cat, d.t, 'dua-' + picRef[1] + '-' + picRef[2] + '.png', d.r || g.cat);
      } else if (picRef[0] === 'hisn') {
        var chapter = null;
        HISN.forEach(function (c) { if (c.id === state.hisn) chapter = c; });
        if (chapter && chapter.i[index]) {
          shareTextCard(chapter.t, chapter.i[index].t, 'dhikr-' + chapter.id + '-' + index + '.png',
            'حصن المسلم، الباب ' + ar(chapter.id) + (chapter.i[index].r > 1 ? '، ' + count(chapter.i[index].r, 'مرة واحدة', 'مرتان', 'مرات', 'مرة') : ''));
        }
      } else if (picRef[0] === 'after') {
        /* the sheet after a prayer keeps its own four; without this branch the
           share button would have pictured a dhikr from whichever list the
           azkar screen happened to be on */
        var after = afterPrayerItems()[index];
        if (after) {
          shareTextCard('أذكار ما بعد الصلاة', after.t, 'after-prayer-' + index + '.png',
            'حصن المسلم، الأذكار بعد السلام من الصلاة' +
            (after.r > 1 ? '، ' + count(after.r, 'مرة واحدة', 'مرتان', 'مرات', 'مرة') : ''));
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

    var hear = target.closest('[data-hear]');
    if (hear) {
      if (state.voiceClip) { stopSpeaking(); return; }
      /* the name shown in the phone's own player comes from the button's label */
      var label = (hear.getAttribute('aria-label') || '').replace(/^استمع\s*(لـ|ل)?/, '').replace(/\s*بصوت.*$/, '') || 'سُنّتي';
      /* the player in the shade names it, so no notification rings beside it */
      playRecording('audio/dua/' + hear.getAttribute('data-hear'), hear, label);
      return;
    }
    var pick = target.closest('[data-pick]');
    if (pick) { choosePicker(+pick.getAttribute('data-pick')); return; }
    var cell = target.closest('[data-time]');
    if (cell) { chooseTime(cell.getAttribute('data-time')); return; }
    var timeBtn = target.closest('.timepick .picker-btn');
    if (timeBtn) {
      if (state.pickerFor === timeBtn) closePicker(); else openTimePicker(timeBtn);
      return;
    }
    var pickBtn = target.closest('.picker-btn');
    if (pickBtn && pickBtn.disabled) {
      /* a dimmed list is waiting on its switch; saying so beats leaving the
         reader tapping something that looks broken */
      toast('شغّل التذكير أولاً من المفتاح');
      return;
    }
    if (pickBtn) {
      if (state.pickerFor === pickBtn) closePicker(); else openPicker(pickBtn);
      return;
    }
    if (state.pickerFor && !target.closest('.picker-panel')) closePicker();

    var dhikr = target.closest('[data-dhikr]');
    if (dhikr) {
      var kind = dhikr.getAttribute('data-kind');
      if (kind === 'after') { countAfterPrayer(+dhikr.getAttribute('data-dhikr')); return; }
      countDhikr(+dhikr.getAttribute('data-dhikr'), kind === 'hisn');
      return;
    }

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
      keepTasbih();
      renderTasbih();
      return;
    }

    var word = target.closest('[data-suggest]');
    if (word) {
      state.query = word.getAttribute('data-suggest');
      renderSearch();
      return;
    }

    var station = target.closest('[data-station]');
    if (station && typeof RADIO_STATIONS !== 'undefined') {
      var s = RADIO_STATIONS[+station.getAttribute('data-station')];
      if (s) playAudio(s.url, s.name, s.note);
      return;
    }

    var keepBtn = target.closest('[data-surah-audio]');
    if (keepBtn) {
      var sn = +keepBtn.getAttribute('data-surah-audio');
      if (isSurahSaved(sn)) {
        var sm = surahMeta(sn);
        openSheet('سورة ' + (sm ? sm.ar : '') + ' محفوظة',
          '<p class="setting-note">تلاوتها بصوت ' + esc(reciterName()) + ' في جهازك، وتعمل بلا إنترنت</p>' +
          '<button class="btn btn-ghost btn-block" data-act="audio-remove-confirm" data-ref="' + esc(reciterId()) + ':' + sn + '" style="margin-top:12px">احذفها من الجهاز</button>');
      } else if (!state.downloading) {
        downloadSurah(sn);
      }
      return;
    }
    var removeAudio = target.closest('[data-remove-audio]');
    if (removeAudio) {
      var ra = removeAudio.getAttribute('data-remove-audio').split(':');
      removeSurahAudio(ra[0], +ra[1]).then(function () { toast('حُذف الصوت'); renderSavedAudio(); });
      return;
    }

    var umrahStep = target.closest('[data-umrah-step]');
    if (umrahStep) {
      var umrahKey = umrahStep.getAttribute('data-umrah-step');
      var all = Store.get('umrah') || {};
      if (all[umrahKey]) delete all[umrahKey]; else all[umrahKey] = 1;
      Store.set('umrah', all);
      buzz(6);
      renderUmrah();
      return;
    }
    var openSurah = target.closest('[data-open-surah]');
    if (openSurah) { state.surah = +openSurah.getAttribute('data-open-surah'); go('reader'); return; }

    var duaTheme = target.closest('[data-dua-theme]');
    if (duaTheme) { openDuaTheme(duaTheme.getAttribute('data-dua-theme')); return; }

    var umrahFold = target.closest('[data-umrah-fold]');
    if (umrahFold && target.closest('.fold-head')) {
      var fid = umrahFold.getAttribute('data-umrah-fold');
      if (!state.umrahOpen) state.umrahOpen = {};
      state.umrahOpen[fid] = !state.umrahOpen[fid];
      renderUmrah();
      return;
    }
    var umrahTab = target.closest('[data-umrah]');
    if (umrahTab) { state.umrahTab = umrahTab.getAttribute('data-umrah'); renderUmrahRef(); return; }

    var markable = target.closest('[data-mark-prayer]');
    if (markable) {
      var at = markable.getAttribute('data-date');
      markPrayerSheet(markable.getAttribute('data-mark-prayer'), at ? dateOfStamp(at) : new Date());
      return;
    }

    var hisnChapter = target.closest('[data-hisn]');
    if (hisnChapter) { state.hisn = +hisnChapter.getAttribute('data-hisn'); go('hisn'); return; }

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
    /* A dimmed list is a disabled button, and a browser hands a disabled button
       no click, so what onClick says about it was never heard. The lift of the
       finger still arrives, and says it instead. */
    ['pointerup', 'touchend'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var dimmed = e.target && e.target.closest ? e.target.closest('.picker-btn') : null;
        if (dimmed && dimmed.disabled) toast('شغّل التذكير أولاً من المفتاح');
      }, { passive: true });
    });

    window.addEventListener('scroll', updateReadProgress, { passive: true });

    window.addEventListener('popstate', function () {
      /* the step the sky took is undone by its own closing, and a back
         while it is open closes it and goes nowhere else */
      if (skyview.skipPop) { skyview.skipPop = false; return; }
      /* and the walkthrough the same: its own step undone by its end, and a
         back while it is open ends it */
      if (tour.skipPop) { tour.skipPop = false; return; }
      /* and a sheet the same */
      if (sheetStep.skipPop) { sheetStep.skipPop = false; return; }
      if (tour.open) { endTour(true); return; }
      if (skyview.open) { closeSkyview(true); return; }
      if ($('sheet') && $('sheet').classList.contains('is-open')) {
        /* a sheet with a step of its own loses that step and nothing more; one
           that could not take a step took the screen's, which is put back */
        var own = sheetStep.pushed;
        closeSheet(true);
        if (!own) pushAddress(state.view);
        return;
      }
      followAddress();
    });

    /* set rather than added: the page wired a second time must not step the
       walkthrough twice for one press */
    if ($('tour-next')) $('tour-next').onclick = function () { stepTour(1); };
    if ($('tour-skip')) $('tour-skip').onclick = function () { endTour(); };
    if ($('tour')) $('tour').onkeydown = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); endTour(); return; }
      /* the screen reads from right to left, so the next step is to the left */
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepTour(1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepTour(-1); return; }
      /* the keyboard stays with the two buttons while the tour is up */
      if (e.key === 'Tab') {
        var keys = [$('tour-skip'), $('tour-next')].filter(function (b) { return b && !b.hidden; });
        var i = keys.indexOf(document.activeElement);
        e.preventDefault();
        keys[(i + (e.shiftKey ? keys.length - 1 : 1)) % keys.length].focus();
      }
    };

    bind('hijri-up', 'click', function () { nudgeHijri(1); });
    /* Both of these sat in the page with an id and a label and nothing
       listening, so they had never once done anything. */
    bind('home-azkar', 'click', function () { openAzkar('afterprayer'); });
    bind('home-share-times', 'click', function () { shareTimes(); });
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

    bind('azkar-reset', 'click', resetAzkar);

    bind('tasbih-tap', 'click', countTasbih);
    bind('tasbih-reset', 'click', function () {
      state.tasbih.count = 0;
      keepTasbih();
      renderTasbih();
      toast('صُفّر العدّاد');
    });

    bind('settings-salawat-voice', 'change', function (e) {
      Store.set('salawatVoice', e.target.value);
      stopSpeaking();
      renderSettings();
      playRecording(salawatUrl(), 'settings-voice-try', salawatName());
    });
    bind('settings-adhan-voice', 'change', function (e) {
      Store.set('adhanVoice', e.target.value);
      stopSpeaking();
      fillAdhanVoices();
      if (e.target.value !== 'none' && e.target.value !== 'silent') playAdhanSample();
    });
    bind('settings-adhan-try', 'click', function () {
      if (isSpeaking()) { stopSpeaking(); return; }
      /* silence is a choice; hearing it plays nothing and says so, rather than
         sounding a muadhin the reader has turned off */
      var pick = adhanChoice();
      if (pick === 'silent') { toast('يصل التنبيه بلا صوت'); return; }
      if (pick === 'none') { toast('يصل بنغمة التنبيه في هاتفك'); return; }
      /* No notification beside it: inside the package one rang the phone's
         tone over the adhan, and the player in the shade already names it. */
      playAdhanSample();
    });

    bind('settings-adhan', 'click', function () {
      var app = bridge();
      if (!app || !app.setAdhanEnabled) return;
      var on = $('settings-adhan').getAttribute('aria-checked') !== 'true';
      try { app.setAdhanEnabled(on); } catch (e) { /* the app will say */ }
      setSwitch($('settings-adhan'), on);
      if (on) handTimesToApp();
      toast(on ? 'يرنّ الأذان في وقته' : 'أوقفت تنبيه الأذان');
    });
    window.addEventListener('sunnati:permission', function () { if (state.view === 'settings') renderAdhanRow(); });

    bind('hisn-filter', 'input', renderHisn);
    bind('hisn-reset', 'click', function () {
      Store.resetHisn(state.hisn);
      renderHisnChapter();
      toast('أُعيدت عدّادات هذا الباب');
    });

    bind('prayers-day', 'change', function (e) {
      if (!e.target.value) return;
      var when = dateOfStamp(e.target.value);
      if (when.getTime() > Date.now()) { toast('لا تُعلَّم صلاة لم يأت يومها'); e.target.value = ''; return; }
      markDaySheet(when);
    });
    document.addEventListener('change', function (e) {
      var sel = e.target && e.target.closest ? e.target.closest('[data-day-prayer]') : null;
      if (!sel) return;
      Store.setPrayer(sel.getAttribute('data-day-prayer'), sel.value || null, dateOfStamp(sel.getAttribute('data-date')));
      renderHome();
      if (state.view === 'prayers') renderPrayers();
    });

    bind('reader-autoscroll', 'click', function () {
      if (autoScrolling()) { stopAutoScroll(); return; }
      paceSheet();
    });
    bind('page-autoscroll', 'click', function () {
      if (autoScrolling()) { stopAutoScroll(); return; }
      paceSheet();
    });
    bind('to-top', 'click', function () { stopAutoScroll(true); scrollToTop(); });
    /* a touch anywhere stops the page walking, so the reader is never fought.
       A touch on the reading button itself is left to the button: stopped
       here first, its click found nothing walking and opened the paces again. */
    ['pointerdown', 'wheel', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        if (!state.autoScroll) return;
        var on = e.target && e.target.closest ? e.target.closest('#reader-autoscroll, #page-autoscroll') : null;
        if (!on) stopAutoScroll();
      }, { passive: true });
    });
    watchScrollPosition();

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
      copyText(tongue(timetableText())).then(
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

    bind('settings-meanings', 'click', function () {
      var on = Store.get('meanings') === false;
      Store.set('meanings', on);
      setSwitch($('settings-meanings'), on);
      if (state.view === 'reader') renderReader();
      renderDailyAyah();
    });
    /* a language is chosen once and the app opens again in it */
    bind('settings-lang', 'change', function (e) {
      if (window.I18n) window.I18n.choose(e.target.value);
    });
    bind('settings-city', 'change', function (e) {
      if (e.target.value === '') return;
      chooseCity(+e.target.value);
    });
    bind('settings-method', 'change', function (e) {
      Store.set('method', e.target.value);
      /* chosen by hand: a fix at boot will not put it back while the reader
         stays where they are */
      Store.set('methodFrom', 'hand');
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
    /* The shape of the page was offered and never kept: nothing heard the
       choice, so «كما طُبعت» went back to the flowing text at once. */
    bind('settings-page-layout', 'change', function (e) {
      var shape = e.target.value === 'madinah' ? 'madinah' : 'flow';
      Store.set('pageLayout', shape);
      if (shape === 'flow') {
        if (state.view === 'page') renderPage();
        toast('تُعرض الصفحة نصّاً متّصلاً');
        return;
      }
      toast('تُعرض الصفحة كما طُبعت في مصحف المدينة');
      loadMadinahLines().then(function (lines) {
        if (!lines) { toast('تعذّر تحميل الصفحات كما طُبعت، فتأكد من الاتصال'); return; }
        if (state.view === 'page') renderPage();
      });
    });
    /* The clock runs slow in the background, so the moment the app is back in
       front the check runs and anything that fell due is raised. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });

    bind('settings-after-prayer', 'click', function () {
      var on = !!Store.get('afterPrayerOff');
      Store.set('afterPrayerOff', !on ? true : false);
      setSwitch($('settings-after-prayer'), on);
      toast(on ? 'ستُعرض الأذكار بعد الصلاة' : 'لن تُعرض بعد الصلاة');
    });
    bind('map-in', 'click', function () { MAP.zoom = Math.min(18, MAP.zoom + 1); drawMap(); });
    bind('map-out', 'click', function () { MAP.zoom = Math.max(11, MAP.zoom - 1); drawMap(); });
    bind('map-mine', 'click', function () {
      /* back to the reader's own place, and ask again about it: pressing this
         and seeing nothing change told him nothing */
      /* it takes the reading afresh rather than trusting the place last
         saved: a reader who had moved had to go to the settings to update it
         before this button was any use to him */
      state.lookedAt = null;
      state.mosques = null;
      locate(function () {
        var here = place();
        if (!here) return;
        state.mapAt = { lat: here.lat, lng: here.lng };
        drawMap();
        renderMosques();
      });
    });
    bind('settings-listen', 'change', function (e) {
      Store.set('listenAs', e.target.value);
      toast(e.target.value ? 'سيُعمل بها في كل سورة' : 'ستُسأل كل مرة');
    });
    bind('settings-clock', 'change', function (e) {
      Store.set('clock', e.target.value);
      renderHome();
      if (state.view === 'prayers') renderPrayers();
      if (state.view === 'timetable') renderTimetable();
      showQiyamTime();
      showDuhaTime();
      toast(e.target.value === '24' ? 'الساعة على أربع وعشرين' : 'الساعة على اثنتي عشرة');
    });
    bind('settings-wird', 'change', function (e) {
      Store.set('wirdAt', e.target.value);
      handRemindersToApp();
      toast(e.target.value ? 'سيصلك ورد اليوم في وقته' : 'أُوقف تذكير الورد');
    });
    /* The sheet has a switch of its own, visible and separate from the
       notification's. Its button used to hide it for good with no sign left
       anywhere that it was hidden, and the toast that said how to bring it
       back was gone in seconds. */
    bind('arc-wrap', 'click', function () { if (skyOn()) openSkyview(); });
    bind('arc-wrap', 'keydown', function (e) {
      if (skyOn() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSkyview(); }
    });
    bind('skyview', 'click', function () { closeSkyview(); });
    bind('skyview', 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeSkyview(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSkyview(); });
    window.addEventListener('resize', function () { if (skyview.open) { panSkyview(); renderSky(true); } });
    /* a phone lets go of the screen when the app goes behind another, so
       the sky asks for it again when it comes back in front */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && skyview.open && !skyview.lock) holdSkyAwake(true);
    });
    bind('settings-sky', 'click', function () {
      var on = !skyOn();
      Store.set('sky', on);
      setSwitch($('settings-sky'), on);
      renderSky(true);
    });
    bind('settings-jumuah-sheet', 'click', function () {
      var on = !Store.get('jumuahNightSheet');
      Store.set('jumuahNightSheet', on);
      if (on) Store.set('jumuahNightQuiet', 0);
      setSwitch($('settings-jumuah-sheet'), on);
      /* and if tonight is the night, it opens at once rather than leaving the
         reader to guess whether the switch did anything */
      if (on && inJumuahNight()) maybeJumuahNightSheet();
    });

    bind('settings-jumuah-night', 'click', function () {
      var on = !Store.get('jumuahNight');
      Store.set('jumuahNight', on);
      if (!on) { Store.set('jumuahNightAt', 0); Store.set('jumuahNightQuiet', 0); Store.set('jumuahNightArmed', ''); }
      setSwitch($('settings-jumuah-night'), on);
      handRemindersToApp();
      toast(on ? 'سيصلك تذكير ليلة الجمعة' : 'أُوقف تذكير ليلة الجمعة');
      if (on) askToRemind();
    });
    bind('settings-jumuah-before', 'change', function (e) {
      Store.set('jumuahBefore', +e.target.value);
      handRemindersToApp();
      toast(+e.target.value ? 'سيصلك نداء الجمعة قبلها' : 'أُوقف نداء الجمعة');
    });

    bind('settings-fast-note', 'click', function () {
      var on = !Store.get('fastNote');
      Store.set('fastNote', on);
      setSwitch($('settings-fast-note'), on);
      renderNextFast();
      handRemindersToApp();
      toast(on ? 'سيصلك تذكير في ليلة اليوم الذي يُستحب صيامه' : 'أُوقف تذكير الصيام');
      if (on) askToRemind();
    });
    /* five switches of one shape: flip, keep, hand to the wrapper, say so */
    [['morningAdhkar', 'أذكار الصباح'], ['eveningAdhkar', 'أذكار المساء'],
     ['sleepIstighfar', 'الاستغفار قبل النوم'], ['sleepMulk', 'سورة الملك قبل النوم'],
     ['sleepKursi', 'آية الكرسي قبل النوم']].forEach(function (pair) {
      bind('settings-' + pair[0], 'click', function () {
        var on = !Store.get(pair[0]);
        Store.set(pair[0], on);
        setSwitch($('settings-' + pair[0]), on);
        handRemindersToApp();
        toast(on ? 'سيصلك تذكير: ' + pair[1] : 'أُوقف تذكير ' + pair[1]);
        if (on) askToRemind();
      });
    });
    /* Bound on the document, not on the element: the bedtime input is replaced
       by our own list at boot, and a handler attached to the old element goes
       with it. The choice was being made and quietly dropped. */
    document.addEventListener('change', function (e) {
      if (!e.target || e.target.id !== 'settings-sleep-at') return;
      Store.set('sleepAt', e.target.value || '22:30');
      handRemindersToApp();
      toast('وقت النوم ' + timeLabel(e.target.value));
    });
    /* «اسمع الصوت»: the chime plays here in the page; the device sound and
       silence cannot be sounded by a page, so it says so rather than doing
       nothing and leaving the reader wondering whether the button works. */
    document.querySelectorAll('.try-sound').forEach(function (btn) {
      btn.addEventListener('click', function () {
        /* the one button starts the sound and, while it plays, stops it: the
           neighbouring hear buttons do this, and this one used to start the
           recitation over from the top on every press with no way to stop */
        if (isSpeaking()) { stopSpeaking(); return; }
        var key = btn.getAttribute('data-try');
        var pick = soundFor(key);
        if (pick === 'silent') { toast('هذا التذكير يصل بلا صوت'); return; }
        if (pick === 'device') { toast('يصل بصوت الإشعارات في هاتفك'); return; }
        /* a reminder whose sound is a recitation plays it, rather than a tone:
           the reader chose the reciter, not a chime */
        if (pick === 'buhendi') {
          var f = RECITED_SOUND[key];
          if (f) { playRecording('audio/dua/' + f.f, btn, f.n); return; }
        }
        playChime();
      });
    });
    /* the sound of each reminder, kept under its key */
    document.querySelectorAll('.select-sound').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var all = Store.get('remindSound') || {};
        all[sel.getAttribute('data-sound')] = sel.value;
        Store.set('remindSound', all);
        /* Three reminders are scheduled by bridges of their own, not from the
           reminder list: qiyam, the salawat and the adhan. Telling only the
           list left their sound at whatever it was, which is why «صامت» on
           qiyam still rang. Every bridge hears the change. */
        handRemindersToApp();
        handQiyamToApp();
        handSalawatToApp();
        handAdhanSoundToApp();
      });
    });
    [['jumuahBefore', 'نداء الجمعة'], ['salawat', 'الصلاة على النبي ﷺ'], ['wirdAt', 'ورد اليوم']].forEach(function (pair) {
      bind('settings-' + slugFor(pair[0]) + '-on', 'click', function () {
        var on = !whenIsOn(pair[0]);
        setWhenOn(pair[0], on);
        toast(on ? 'سيصلك تذكير: ' + pair[1] : 'أُوقف تذكير ' + pair[1]);
        if (on) askToRemind();
      });
    });
    [['contrast', 'settings-contrast', 'التباين الأعلى'], ['lessMotion', 'settings-motion', 'تقليل الحركة']].forEach(function (p) {
      bind(p[1], 'click', function () {
        var on = !document.documentElement.classList.contains(p[0] === 'contrast' ? 'want-contrast' : 'less-motion');
        Store.set(p[0], on);
        applyAccess();
        setSwitch($(p[1]), on);
        toast(on ? 'شُغّل ' + p[2] : 'أُوقف ' + p[2]);
      });
    });
    bind('settings-duha', 'click', function () {
      var on = !Store.get('duha');
      Store.set('duha', on);
      setSwitch($('settings-duha'), on);
      handRemindersToApp();
      showDuhaTime();
      toast(on ? 'سيصلك تذكير بصلاة الضحى' : 'أُوقف تذكير الضحى');
      if (on) askToRemind();
    });
    bind('settings-qiyam', 'click', function () {
      var on = !Store.get('qiyam');
      Store.set('qiyam', on);
      setSwitch($('settings-qiyam'), on);
      handQiyamToApp();
      showQiyamTime();
      toast(on ? 'سيصلك تنبيه عند الثلث الأخير' : 'أُوقف تذكير القيام');
      if (on) askToRemind();
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
      handSalawatToApp();
      scheduleForWorker();
    });
    bind('settings-voice', 'change', function (e) {
      Store.set('voice', e.target.value);
      stopSpeaking();
      showDeviceVoiceRow();
      renderSettings();
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
      /* «اسمع» used to switch the reader's own choice from «صامت» to a
         recording and then play it: pressing hear changed the setting behind
         their back. Silence is a choice; the button says so and plays nothing. */
      if ((Store.get('voice') || 'recording') === 'none') {
        toast('هذا التذكير يصل بلا صوت');
        return;
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
    bind('settings-reciter', 'change', function (e) { Store.set('reciter', e.target.value); });
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
    bind('data-clear', 'click', askClearEverything);
    bind('offline-cache', 'click', cacheEverything);
    bind('offline-refresh', 'click', refetchEverything);
    bind('settings-install', 'click', install);

    bind('banner-close', 'click', hideBanner);
    bind('sheet-close', 'click', closeSheet);
    bind('sheet', 'click', function (e) { if (e.target && e.target.id === 'sheet') closeSheet(); });
    bindSheetDrag();

    bind('player-stop', 'click', stopRecite);
    bind('player-prev', 'click', function () { stepRecite(-1); });
    bind('player-next', 'click', function () { stepRecite(1); });
    bind('player-toggle', 'click', function () {
      if (!state.audio) return;
      if (state.audio.paused) { state.audio.play(); } else { state.audio.pause(); }
      markPlayerToggle();
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
    if (!window.fetch) { toast('تعذّر تحميل نص المصحف'); return; }
    Mushaf.load(fetchJson)
      .then(afterMushaf)
      .catch(function () { toast('تعذّر تحميل نص المصحف'); });
  }

  function afterMushaf() {
    if (RENDERERS[state.view]) RENDERERS[state.view]();
    renderDailyAyah();
    dropSilentSaves().then(function (gone) { if (gone.length) renderSettings(); }, function () {});
    if ($('offline-state')) {
      $('offline-state').textContent = 'نص المصحف محمّل في جهازك، فالقراءة تعمل بلا إنترنت';
    }
  }

  /* ---------------- the app as an app ---------------- */

  /* own: the words are in a language of their own, Arabic offered to a
     reader the app met in another, and are left as they are written */
  function showBanner(text, actionLabel, action, own) {
    var banner = $('banner');
    if (!banner) return;
    ['banner-text', 'banner-act'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (own) { el.setAttribute('translate', 'no'); el.setAttribute('lang', 'ar'); el.setAttribute('dir', 'rtl'); }
      else { el.removeAttribute('translate'); el.removeAttribute('lang'); el.removeAttribute('dir'); }
    });
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

  /* ---------------- the app among others ---------------- */

  var LINKS = {
    play: 'https://play.google.com/store/apps/details?id=com.eworldq8.sunnati',
    apple: 'https://apps.apple.com/app/id6814355836',
    web: 'https://sunnati.3li.info/'
  };

  /* An address that leaves the app, handed to the phone the way each wrapper
     takes one. The iPhone's web view gives the phone whatever window.open
     asks for, of any scheme, but a mail link that is merely followed dies
     inside it; the android one hands the phone any address the page moves to
     that is not its own; and a browser opens a tab, or its mail program. */
  function openOutside(url) {
    if (inIosApp()) { window.open(url, '_blank'); return 'ios'; }
    if (bridge() || /^mailto:/.test(url)) { window.location.href = url; return 'page'; }
    window.open(url, '_blank', 'noopener');
    return 'tab';
  }

  /* where this reader rates the app: the store of the phone in hand, and on
     a computer the one its maker sells through */
  function storeLink() {
    var apple = LINKS.apple + '?action=write-review';
    if (inIosApp()) return apple;
    if (bridge()) return LINKS.play;
    return /iPhone|iPad|iPod|Macintosh/.test(window.navigator.userAgent || '') ? apple : LINKS.play;
  }

  function rateApp() {
    Store.set('rateAsked', true);
    openOutside(storeLink());
  }

  /* The invitation is written out with every link in it, since it is read by
     whoever it is sent to on whatever phone they have. */
  function shareWords() {
    return 'سُنّتي: المصحف ومواقيت الصلاة والأذكار والسنن في جهازك، مجاني بلا إعلانات ويعمل بلا إنترنت\n\n' +
      'للآيفون: ' + LINKS.apple + '\n' +
      'لأندرويد: ' + LINKS.play + '\n' +
      'وموقعه: ' + LINKS.web;
  }

  function shareApp() {
    var words = tongue(shareWords());
    var app = bridge();
    if (app && app.shareText) {
      try { app.shareText(words); return 'app'; } catch (e) { /* the page's own way, then */ }
    }
    if (window.navigator.share) {
      window.navigator.share({ title: tongue('سُنّتي'), text: words }).catch(function () { /* closed */ });
      return 'sheet';
    }
    copyText(words).then(function () { toast('نُسخت الدعوة بروابطها، فألصقها حيث شئت'); })
      .catch(function () { toast('تعذّر النسخ، ورابط التطبيق ' + LINKS.web); });
    return 'copy';
  }

  /* A letter already addressed, with the version in it, so a report says
     which app it is about without anyone having to ask. */
  function feedbackUrl() {
    return 'mailto:Site@hotmail.com?subject=' + encodeURIComponent('ملاحظات على سُنّتي') +
      '&body=' + encodeURIComponent('\n\n\nالنسخة ' + ar(VERSION) + packageLine());
  }

  function sendFeedback() {
    return openOutside(feedbackUrl());
  }

  /* Each day the app is opened is counted once, and on the seventh it asks,
     once and never again, whether the reader would rate it. Only inside the
     store apps, where there is a store to rate it in, and never over anything
     the reader is in the middle of. */
  function countDay() {
    var today = Store.dayKey(new Date());
    if (Store.get('usedOn') === today) return;
    Store.setMany({ usedOn: today, usedDays: (+Store.get('usedDays') || 0) + 1 });
  }

  function maybeAskRating() {
    if (Store.get('rateAsked') || !bridge()) return false;
    if ((+Store.get('usedDays') || 0) < 7) return false;
    if (tour.open || skyview.open) return false;
    if (!$('banner') || !$('banner').hidden) return false;
    if ($('sheet') && $('sheet').classList.contains('is-open')) return false;
    Store.set('rateAsked', true);
    showBanner('إن نفعك سُنّتي فقيّمه في المتجر، فتقييمك يدلّ غيرك عليه', 'قيّمه', rateApp);
    return true;
  }

  /* ---------------- the walkthrough ---------------- */

  /* Six short steps over the real home screen, each lighting the one thing it
     speaks of and dimming the rest: a welcome, the coming prayer, the day's
     times, the mushaf, the sunnahs, and everything else. Shown once, to
     whoever opens the app new, skipped at any step, and found again in the
     settings by anyone who wants it. Nothing is drawn for it: the screen it
     points at is the screen the reader will use. */
  var TOUR = [
    { title: 'أهلاً بك في سُنّتي',
      body: 'مصحفك ومواقيت صلاتك وأذكارك وسننك في مكان واحد يعمل كله بلا إنترنت، وهذه جولة قصيرة فيه لا تأخذ منك دقيقة.',
      next: 'ابدأ الجولة' },
    { at: '#arc-wrap', round: 26, title: 'الصلاة القادمة',
      body: 'العدّ إلى الصلاة القادمة في محراب يتبدّل ضوؤه مع الوقت، فالمس المحراب لترى سماء الوقت على الشاشة كلها.' },
    { at: '#windows', round: 16, title: 'مواقيت اليوم',
      body: 'مواقيت الصلوات لمدينتك، واضغط الصلاة بعد أدائها لتسجّل كيف صلّيتها وتتابع شهرك كله.' },
    { at: '.tabs [data-go="quran"]', round: 14, title: 'المصحف',
      body: 'المصحف كاملاً في جهازك برواية حفص بالرسم العثماني، ومعه التفسير والتلاوة بأصوات القرّاء.' },
    { at: '.tabs [data-go="tracker"]', round: 14, title: 'السنن',
      body: 'سنن يومك من الاستيقاظ إلى النوم، فسجّل ما أدّيته منها ليُحسب في وردك.' },
    { at: '.tabs [data-go="more"]', round: 14, title: 'المزيد',
      body: 'القبلة والمساجد القريبة والأذكار وصفة العمرة والتذكيرات والإعدادات، وفي الإعدادات تجد هذه الجولة متى أردتها.',
      next: 'ابدأ' }
  ];

  /* Whether this phone had the app open before, read before anything of
     today's start is written: someone who has used it for months is not
     walked through it after an update. The iPhone's wrapper writes placeAsked
     itself before the page wakes, so that alone says nothing; the keys with an
     underscore are the first version's. With no store to ask, the tour could
     never be remembered as seen, and it is not shown. */
  function cameBefore() {
    try {
      var ls = window.localStorage;
      for (var i = 0; i < ls.length; i++) {
        var k = String(ls.key(i) || '');
        if (k.indexOf('sunnati_') === 0) return true;
        /* the language the page settled on for a phone it met for the
           first time is not a sign that it met it before */
        if (k.indexOf('sunnati.') !== 0 || k === 'sunnati.probe' || k === 'sunnati.lang') continue;
        if (k !== 'sunnati.settings') return true;
        var saved = JSON.parse(ls.getItem(k) || '{}') || {};
        if (Object.keys(saved).some(function (n) { return n !== 'placeAsked'; })) return true;
      }
      return false;
    } catch (e) { return true; }
  }

  function lessMotion() {
    return document.documentElement.classList.contains('less-motion');
  }

  /* After the opening has gone, on the home screen, with nothing else open
     over it; while the splash is still up or a sheet is showing it waits a
     little and looks again, and gives up for this opening after a few tries. */
  function maybeStartTour(tries) {
    if (Store.get('tour') || tour.open) return false;
    var n = tries || 0;
    var busy = document.getElementById('boot-splash') || state.view !== 'home' || skyview.open ||
      ($('sheet') && $('sheet').classList.contains('is-open'));
    if (busy) {
      if (n < 12) window.setTimeout(function () { maybeStartTour(n + 1); }, 700);
      return false;
    }
    return startTour(false);
  }

  function startTour(asked) {
    var view = $('tour');
    if (!view || tour.open) return false;
    if (skyview.open) closeSkyview();
    closeSheet();
    Store.set('tour', true);
    tour.open = true;
    tour.at = 0;
    tour.back = document.activeElement;
    window.scrollTo(0, 0);
    document.documentElement.classList.add('touring');
    view.hidden = false;
    paintTourStep();
    window.requestAnimationFrame(function () { if (tour.open) view.classList.add('is-open'); });
    window.addEventListener('resize', placeTour);
    /* a step of its own in the history, so the back button of a phone ends
       it and goes nowhere else */
    try {
      if (window.history && window.history.pushState) {
        /* a sheet shut just now left its step, and the walkthrough takes it
           over rather than standing on it */
        if (sheetStep.spent && window.history.state && window.history.state.sheet) {
          sheetStep.spent = false;
          window.history.replaceState({ view: state.view, tour: true }, '');
        } else {
          window.history.pushState({ view: state.view, tour: true }, '');
        }
        tour.pushed = true;
      }
    } catch (e) { /* file:// refuses */ }
    try { $('tour-next').focus({ preventScroll: true }); } catch (e) { /* not focusable here */ }
    return asked ? 'asked' : 'first';
  }

  function stepTour(by) {
    if (!tour.open) return;
    var to = tour.at + by;
    if (to < 0) return;
    if (to >= TOUR.length) { endTour(); return; }
    tour.at = to;
    var card = $('tour-card');
    /* the light moves at once, and the words fade out, change and come back
       where the light has gone */
    placeHole();
    card.classList.add('is-swapping');
    window.clearTimeout(tour.swap);
    tour.swap = window.setTimeout(function () {
      paintTourStep();
      card.classList.remove('is-swapping');
    }, lessMotion() ? 0 : 150);
  }

  function paintTourStep() {
    var step = TOUR[tour.at];
    $('tour-title').textContent = step.title;
    $('tour-body').textContent = step.body;
    $('tour-next').textContent = step.next || 'التالي';
    $('tour-skip').hidden = tour.at === TOUR.length - 1;
    var dots = $('tour-dots');
    dots.innerHTML = TOUR.map(function (_, i) {
      return '<span class="tour-dot' + (i === tour.at ? ' is-on' : '') + '"></span>';
    }).join('');
    dots.setAttribute('aria-label', 'الخطوة ' + ar(tour.at + 1) + ' من ' + ar(TOUR.length));
    placeTour();
  }

  /* the box of what the step speaks of, on the screen, or null for the
     welcome, which speaks of everything */
  function tourBox() {
    var step = TOUR[tour.at];
    var el = step && step.at ? document.querySelector(step.at) : null;
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var vw = window.innerWidth, vh = window.innerHeight, pad = 8;
    var x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    return { x: x, y: y, w: Math.min(vw - 4, r.right + pad) - x, h: Math.min(vh - 4, r.bottom + pad) - y };
  }

  function placeHole() {
    var hole = $('tour-hole');
    var box = tourBox();
    if (box) {
      hole.classList.remove('is-blank');
      hole.style.width = box.w + 'px';
      hole.style.height = box.h + 'px';
      hole.style.transform = 'translate(' + box.x + 'px, ' + box.y + 'px)';
      hole.style.borderRadius = (TOUR[tour.at].round || 16) + 'px';
    } else {
      hole.classList.add('is-blank');
      hole.style.width = '0px';
      hole.style.height = '0px';
      hole.style.transform = 'translate(' + window.innerWidth / 2 + 'px, ' + window.innerHeight / 2 + 'px)';
    }
    return box;
  }

  /* The words sit beside the light: under it when it is in the upper half,
     over it when it is low, as the tabs are, and in the middle for the
     welcome. Across, they stand under what they speak of, within the screen. */
  function placeTour() {
    if (!tour.open) return;
    var card = $('tour-card');
    var vw = window.innerWidth, vh = window.innerHeight, edge = 16, gap = 14;
    var box = placeHole();
    var cw = Math.min(400, vw - edge * 2);
    card.style.width = cw + 'px';
    var ch = card.offsetHeight;
    var left = (vw - cw) / 2, top;
    if (box) {
      left = Math.max(edge, Math.min(vw - edge - cw, box.x + box.w / 2 - cw / 2));
      var below = box.y + box.h / 2 < vh / 2;
      if (below && box.y + box.h + gap + ch > vh - edge) below = false;
      if (!below && box.y - gap - ch < edge) below = true;
      top = below ? box.y + box.h + gap : box.y - gap - ch;
    } else {
      top = (vh - ch) / 2;
    }
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(Math.max(edge, Math.min(vh - edge - ch, top))) + 'px';
  }

  /* popped: the history has already stepped back, so it is not stepped
     back again */
  function endTour(popped) {
    var view = $('tour');
    if (!view || !tour.open) return;
    tour.open = false;
    window.clearTimeout(tour.swap);
    view.classList.remove('is-open');
    document.documentElement.classList.remove('touring');
    window.removeEventListener('resize', placeTour);
    if (tour.pushed) {
      tour.pushed = false;
      if (popped !== true) {
        tour.skipPop = true;
        try { window.history.back(); } catch (e) { tour.skipPop = false; }
      }
    }
    var back = tour.back;
    tour.back = null;
    if (back && back.focus && document.contains(back)) {
      try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ }
    }
    window.setTimeout(function () { if (!tour.open) view.hidden = true; }, lessMotion() ? 0 : 280);
    /* the offer to read in Arabic waits for the tour, which a phone in another
       language opens on first, rather than for the next opening */
    window.setTimeout(offerArabic, 900);
  }

  /* An android phone in a browser is offered the app on Google Play rather
     than the browser's own install: the store's app sounds the adhan and its
     reminders with the app closed, which a page added to the home screen
     cannot. Once for each reader, in a page already added to the home screen
     too, and never inside the app itself. */
  function onAndroidWeb() {
    return !bridge() && /Android/i.test(window.navigator.userAgent || '');
  }

  function openPlay() { return openOutside(LINKS.play); }

  /* asked over nothing the reader is in the middle of, or left for the next
     opening */
  function offerPlay() {
    if (!onAndroidWeb() || Store.get('playAsked')) return false;
    if (tour.open || skyview.open) return false;
    if (!$('banner') || !$('banner').hidden) return false;
    if ($('sheet') && $('sheet').classList.contains('is-open')) return false;
    Store.set('playAsked', true);
    /* the name kept whole on its line, and the button short, or a small
       phone broke the name in two across the lines of the banner */
    showBanner('سُنّتي على Google\u00a0Play، وفيه يصلك الأذان والتطبيق مغلق', 'ثبّته', openPlay);
    return true;
  }

  /* A phone set to another language opens the app in it. Of the readers it
     meets that way, many read Arabic, the Gulf full of phones set to English
     among them, so a phone that lists Arabic among its languages, or stands
     in a zone of the Arab world, is told once, in Arabic, that the app is
     Arabic too. */
  var ARAB_ZONES = /^(Asia\/(Kuwait|Riyadh|Dubai|Qatar|Bahrain|Muscat|Aden|Baghdad|Amman|Damascus|Beirut|Gaza|Hebron)|Africa\/(Cairo|Khartoum|Tripoli|Tunis|Algiers|Casablanca|Nouakchott))$/;
  function readsArabic() {
    var langs = [];
    try { langs = Array.prototype.slice.call(window.navigator.languages || [window.navigator.language || '']); } catch (e) { langs = []; }
    if (langs.some(function (l) { return /^ar\b/i.test(String(l || '')); })) return true;
    var zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { zone = ''; }
    return ARAB_ZONES.test(zone);
  }

  function offerArabic() {
    var i18n = window.I18n;
    if (!i18n || i18n.lang === 'ar' || i18n.stored() !== 'auto' || Store.get('arabicAsked')) return false;
    if (tour.open || skyview.open) return false;
    if (!$('banner') || !$('banner').hidden) return false;
    if ($('sheet') && $('sheet').classList.contains('is-open')) return false;
    if (!readsArabic()) return false;
    Store.set('arabicAsked', true);
    showBanner('سُنّتي تطبيق عربي، فاقرأه بالعربية إن شئت', 'العربية', function () { i18n.choose('ar'); }, true);
    return true;
  }

  /* The browser offers to install once, and only once, so the offer is kept
     until the reader is ready for it rather than thrown away. On android the
     store's app is offered instead, so the browser's is only kept. */
  function watchInstall() {
    window.addEventListener('beforeinstallprompt', function (event) {
      if (event.preventDefault) event.preventDefault();
      state.installOffer = event;
      renderSettings();
      if (!Store.get('installAsked') && !onAndroidWeb()) {
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
    if (onAndroidWeb()) return openPlay();
    var offer = state.installOffer;
    if (!offer) { toast('من قائمة الخيارات اختر: إضافة إلى الشاشة الرئيسية'); return; }
    offer.prompt();
    Promise.resolve(offer.userChoice).then(function (choice) {
      state.installOffer = null;
      renderSettings();
      if (choice && choice.outcome === 'accepted') toast('جاري التثبيت');
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
       browser to get around to it. Check every minute so updates are detected quickly. */
    window.setInterval(function () { registration.update(); }, 60 * 1000);
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
      /* Never taken by itself, wherever the reader is. A reload in the middle
         of a page of the mushaf loses their place for a version they did not
         ask for, so it waits for their word however idle the app looks. */
      /* عند اكتشاف تحديث، حدّث رقم الإصدار في الواجهة */
      try {
        fetch('sw.js').then(function (res) { return res.text(); }).then(function (txt) {
          var match = txt.match(/var VERSION = 'sunnati-v([^']+)'/);
          if (match && match[1] && $('version-line')) {
            $('version-line').textContent = 'النسخة ' + ar(match[1]) + packageLine();
          }
        }).catch(function () {});
      } catch (e) { }
      showBanner('وصل تحديث جديد للتطبيق', 'حدّث الآن', function () { window.location.reload(); });
    });

    /* Without this the browser may keep serving sw.js from its own cache for a
       day, and a fix waits a day before it is even noticed. */
    window.navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(watchUpdate)
      .catch(function () { /* offline install is optional */ });
  }

  /* Only the android package draws a splash of its own and holds it until the
     page calls pageReady. The iOS wrapper has a bridge but no splash and no
     pageReady, and taking the page's splash away there at once meant an
     iPhone never saw any opening at all. */
  function appDrawsSplash() {
    var app = bridge();
    return !!(app && app.pageReady);
  }

  /* The full greeting is for the first opening of the reader's day, by the
     phone's own calendar, and an opening later that same day leaves as soon as
     the home is drawn, since the app is opened many times a day to glance at
     the next prayer and three seconds of a greeting already read is a wait. */
  var opening = { full: null };

  /* Read once at the start, before this opening writes anything of its own,
     and written as it is read, so the first opening counts even if the app is
     closed before its greeting ends, while a store that cannot be read greets
     in full and «حذف كل البيانات» clears the day with the rest of the app's
     keys, so the next opening greets in full again. */
  function firstOpenToday() {
    var today = Store.dayKey(new Date());
    try {
      var last = window.localStorage.getItem('sunnati.greeted');
      window.localStorage.setItem('sunnati.greeted', today);
      return last !== today;
    } catch (e) { return true; }
  }

  /* The splash written into the page itself: it fades once the first screen
     is drawn, so the reader never sees a bare page waiting to be filled. */
  function dismissBootSplash(atOnce) {
    var splash = document.getElementById('boot-splash');
    if (!splash) return;
    /* inside the app its own splash is drawn over the page, so the page's one
       is taken out without a word rather than fading beneath it as a second */
    if (atOnce) {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
      return;
    }
    /* With the worker holding the shell the page paints in a few hundred
       milliseconds, so the opening used to appear and start fading in the same
       breath, which reads as a flicker rather than an opening. This is a floor
       and not a length: it goes the moment the page is ready once the floor
       has passed, and a slow first visit never waits for it at all. */
    /* the same floor as the wrapper, 3200ms measured from when the page began
       loading: 2000 still went too fast to read the greeting */
    /* That is the day's first opening, and a later one that day is held 450ms
       so it never flashes and fades in 250ms rather than 420. */
    var full = opening.full !== false;
    var floor = full ? 3200 : 450;
    var since = (window.performance && window.performance.now) ? window.performance.now() : floor;
    if (since < floor) {
      window.setTimeout(function () { dismissBootSplash(false); }, floor - since);
      return;
    }
    if (!full) splash.style.transition = 'opacity .22s ease';
    splash.style.opacity = '0';
    window.setTimeout(function () {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, full ? 420 : 250);
  }

  function boot() {
    /* read before this start writes anything of its own, and only once */
    if (tour.returning === null) tour.returning = cameBefore();
    /* and whether this is the day's first opening, before countDay or anything
       else of today is written */
    if (opening.full === null) opening.full = firstOpenToday();
    if (appDrawsSplash()) dismissBootSplash(true);
    Store.attach();
    Store.migrate();
    if (tour.returning && !Store.get('tour')) Store.set('tour', true);
    countDay();
    settleTicks();
    settleAzkar();
    Store.prune();
    restoreTasbih();
    applyTheme();
    applyFont();
    applyAccess();
    applyBook();
    if (BOOK) {
      if (BOOK.addEventListener) BOOK.addEventListener('change', applyBook);
      else if (BOOK.addListener) BOOK.addListener(applyBook);
      var refit = 0;
      window.addEventListener('resize', function () {
        window.clearTimeout(refit);
        refit = window.setTimeout(refitSpread, 120);
      });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitSpread);
    }
    var homeFit = 0;
    window.addEventListener('resize', function () {
      window.clearTimeout(homeFit);
      homeFit = window.setTimeout(refitHome, 120);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitHome);
    /* a face is fetched only when a page first writes in its script, after
       the first faces are ready, and it changes how wide the words are too */
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', function () {
        window.clearTimeout(homeFit);
        homeFit = window.setTimeout(refitHome, 60);
      });
    }
    computeQibla();
    refreshTimes();
    wire();
    followAddress();
    renderSettings();
    /* the eid greets the reader once, on the days around it */
    window.setTimeout(offerEid, 1200);
    /* The walkthrough waits for the opening to be gone: the page's own goes
       3.6 seconds after the page began loading, and the android package's
       after as long from when the app started, which is a little earlier, and
       a later opening of the day goes sooner still, so this is after it in
       either case. */
    var since = (window.performance && window.performance.now) ? window.performance.now() : 0;
    window.setTimeout(maybeStartTour, Math.max(400, 4000 - since));
    window.setTimeout(maybeAskRating, 9000);
    window.setTimeout(offerPlay, 9500);
    window.setTimeout(offerArabic, 6000);
    /* every select becomes our own menu, once the page is built */
    enhanceSelects();
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
    setPlace: setPlace, locateQuietly: locateQuietly,
    render: RENDERERS,
    actions: ACTIONS,
    helpers: {
      openMosques: openMosques, shareTimes: shareTimes, timesCard: timesCard,
      loadMeanings: loadMeanings, meaningOf: meaningOf, meaningsOn: meaningsOn, meaningSource: meaningSource,
      eidToday: eidToday, maybeEidSheet: maybeEidSheet, nightMarks: nightMarks, renderNightLine: renderNightLine,
      renderQada: renderQada, searchTexts: searchTexts, todaySunanLines: todaySunanLines, fastToday: fastToday, isPlaceDua: isPlaceDua, renderDuaPlaces: renderDuaPlaces, loadMadinahLines: loadMadinahLines, renderPrintedPage: renderPrintedPage, fitPrintedLines: fitPrintedLines, surahsNamed: surahsNamed, surahAudioUrl: surahAudioUrl, playSurah: playSurah, playWholeSurah: playWholeSurah, askHowToListen: askHowToListen, reciteFrom: reciteFrom, reciteVerse: reciteVerse, playVerse: playVerse, verseUrl: verseUrl, verseAudioUrl: verseAudioUrl, rateOf: rateOf, bytesPerVerse: bytesPerVerse, dropSilentSaves: dropSilentSaves, cardColours: cardColours, dismissBootSplash: dismissBootSplash, appDrawsSplash: appDrawsSplash, tellSun: tellSun, splashLand: splashLand, warmSplash: warmSplash, warmNextVerse: warmNextVerse, tellAppSounding: tellAppSounding, showInShade: showInShade, togglePlay: togglePlay, stopAudio: function () { stopAudio(); },
      renderMosques: renderMosques, renderMosqueList: renderMosqueList, findMosques: findMosques, lookAtMosque: lookAtMosque, drawMap: drawMap, fromTile: fromTile, lookAround: lookAround, askOverpass: askOverpass, metresBetween: metresBetween, farLabel: farLabel, toTile: toTile, mosqueRoute: mosqueRoute, offerAfterPrayer: offerAfterPrayer,
      reminderList: reminderList, handRemindersToApp: handRemindersToApp, inJumuahNight: inJumuahNight, nightKey: nightKey, maybeJumuahNightSheet: maybeJumuahNightSheet, showDueSheets: showDueSheets, shareJumuahNight: shareJumuahNight, listCard: listCard, snoozeJumuahNight: snoozeJumuahNight, wirdFor: wirdFor,
      ar: ar, esc: esc, icon: icon, highlight: highlight, hexToWash: hexToWash,
      tabOwner: tabOwner, prayerName: prayerName, nameForPlace: nameForPlace, coordsLabel: coordsLabel, count: count,
      applyAccent: applyAccent, palettes: PALETTES,
      notify: notify, maybeSalawat: maybeSalawat, maybeNotify: maybeNotify, scheduleForWorker: scheduleForWorker, speak: speak, chime: chime, stopSpeaking: stopSpeaking, isSpeaking: isSpeaking,
      verseCard: verseCard, textCard: textCard, canMakeVideo: canMakeVideo, videoSharePath: videoSharePath, shareVerseVideo: shareVerseVideo, videoHandedOver: videoHandedOver, openPage: openPage, spreadOf: spreadOf, isBook: isBook, renderSettings: renderSettings, nextFast: nextFast, offerEid: offerEid, cameFrom: cameFrom, isFriday: isFriday, setWhenOn: setWhenOn, whenIsOn: whenIsOn, hizbLabel: hizbLabel, mushafDigits: mushafDigits, openNote: openNote, methodName: methodName, computeTimes: computeTimes,
      maybeAskPlace: maybeAskPlace, locateQuietly: locateQuietly, place: place, inAndroidApp: inAndroidApp, renderUmrah: renderUmrah, whenItFalls: whenItFalls, handSalawatToApp: handSalawatToApp, qiyamAt: qiyamAt, duhaWindow: duhaWindow, handQiyamToApp: handQiyamToApp, addToCalendar: addToCalendar, showQiyamTime: showQiyamTime, showDuhaTime: showDuhaTime, startAutoScroll: startAutoScroll, stopAutoScroll: stopAutoScroll, autoScrolling: autoScrolling, paceSheet: paceSheet, renderDuaThemes: renderDuaThemes, openDuaTheme: openDuaTheme, duaTopics: duaTopics, prayerSummary: prayerSummary, adhanUrl: adhanUrl, salawatText: salawatText, salawatUrl: salawatUrl, soundAdhan: soundAdhan, fillAdhanVoices: fillAdhanVoices, bridge: bridge, handTimesToApp: handTimesToApp, renderAdhanRow: renderAdhanRow, sharePicture: sharePicture, setPlace: setPlace, adoptGrantedNotifications: adoptGrantedNotifications, maybeExplainChrome: maybeExplainChrome, loadTafsirBook: loadTafsirBook, tafsirReady: tafsirReady, markPrayerSheet: markPrayerSheet, markDaySheet: markDaySheet,
      downloadSurah: downloadSurah, isSurahSaved: isSurahSaved, removeSurahAudio: removeSurahAudio, renderSavedAudio: renderSavedAudio, reciterId: reciterId, pickVoice: pickVoice, arabicVoices: arabicVoices, azkarForNow: azkarForNow, windowSunnah: windowSunnah, withLam: withLam,
 totalSunnahCount: totalSunnahCount, sunnahDay: sunnahDay, sunnahTicks: sunnahTicks, sunnahSections: sunnahSections, rowTicks: rowTicks, tickOf: tickOf, settleTicks: settleTicks, skyAt: skyAt, skyStops: skyStops, moonAt: moonAt, moonPath: moonPath, renderSky: renderSky, skyLook: skyLook, openSkyview: openSkyview, closeSkyview: closeSkyview,
      addressOf: addressOf, readAddress: readAddress, standalone: standalone,
      remindInPage: remindInPage, askToRemind: askToRemind, clockText: clockText, daysOf: daysOf, inARow: inARow,
      timetableText: timetableText, settleAzkar: settleAzkar, restoreTasbih: restoreTasbih, setSleep: setSleep,
      shareApp: shareApp, shareWords: shareWords, rateApp: rateApp, storeLink: storeLink, sendFeedback: sendFeedback,
      feedbackUrl: feedbackUrl, openOutside: openOutside, links: LINKS, countDay: countDay, maybeAskRating: maybeAskRating,
      offerPlay: offerPlay, onAndroidWeb: onAndroidWeb, offerArabic: offerArabic,
      cameBefore: cameBefore, firstOpenToday: firstOpenToday, openingState: opening, maybeStartTour: maybeStartTour, startTour: startTour, stepTour: stepTour, endTour: endTour,
      tourSteps: TOUR, tourState: tour
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
