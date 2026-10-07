/* Runs before anything paints and before app.js: the colour the reader chose,
   and the greeting on the opening screen. It lived inline in the page until the
   content policy was written, which refuses inline script outright, and a
   policy that allows it defends nothing. */

/* Before anything paints: the colour the reader chose and the theme they set,
   read straight from the store, so the app opens in its own colours rather
   than flashing the default green until the controller wakes. */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('sunnati.settings') || '{}');
    var root = document.documentElement;
    var dark = s.theme === 'dark' || (s.theme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) root.setAttribute('data-theme', 'dark');
    /* painted at once, so nothing white shows before the stylesheet lands */
    root.style.backgroundColor = dark ? '#10161a' : '#f6f4ee';
    var P = { green: ['#1e6f47', '#1e6f47', '#30b171'], gold: ['#b08833', '#7d6124', '#bb9036'], maroon: ['#a84a6b', '#9c4564', '#f66c9d'],
      blue: ['#2f7fc0', '#26689c', '#399ae8'], violet: ['#5b4a99', '#5b4a99', '#a889ff'], teal: ['#1a8a8a', '#156e6e', '#1fa6a6'],
      copper: ['#b5643a', '#945230', '#dd7a47'], sadu: ['#9c2b2b', '#9c2b2b', '#ff6969'] };
    var c = P[s.accent];
    if (c) {
      root.style.setProperty('--accent', dark ? c[2] : c[0]);
      root.style.setProperty('--accent-ink', dark ? c[2] : c[1]);
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', dark ? '#10161a' : c[1]);
    } else {
      /* nothing chosen yet, so the sadu red, which is the default */
      var m3 = document.querySelector('meta[name="theme-color"]');
      if (m3) m3.setAttribute('content', dark ? '#10161a' : '#9c2b2b');
      root.style.setProperty('--accent', dark ? '#ff6969' : '#9c2b2b');
      root.style.setProperty('--accent-ink', dark ? '#ff6969' : '#9c2b2b');
    }
  } catch (e) { /* a fresh device, nothing chosen yet */ }
})();

/* The painting behind the opening screen: the reader's own country, by day or
   by night as it is there now. Chosen here, before the first frame, and only
   named on the root, so the rules in the head pick the picture and nothing
   has to be swapped once it has been seen.

   The country is the zone the reader set, and failing that the phone's own,
   which already knows a phone set in Kuwait from one set in Riyadh. The hour
   is the place's own fajr and maghrib as the app last worked them out for
   today; a note from another day is not trusted, and with none the clock
   says day from five in the morning until six in the evening. */
(function () {
  var name = 'default-day';
  try {
    var zone = '';
    try {
      var s = JSON.parse(localStorage.getItem('sunnati.settings') || '{}');
      if (s && typeof s.zone === 'string') zone = s.zone;
    } catch (e) { /* a store that cannot be read leaves it to the phone */ }
    if (!zone) {
      try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { zone = ''; }
    }
    var LANDS = { 'Asia/Kuwait': 'kw', 'Asia/Riyadh': 'sa', 'Asia/Dubai': 'ae', 'Asia/Qatar': 'qa',
      'Asia/Bahrain': 'bh', 'Asia/Muscat': 'om' };
    var land = Object.prototype.hasOwnProperty.call(LANDS, zone) ? LANDS[zone] : 'default';

    var now = new Date();
    var minute = now.getHours() * 60 + now.getMinutes();
    var day = now.getHours() >= 5 && now.getHours() < 18;
    var sun = null;
    try { sun = JSON.parse(localStorage.getItem('sunnati.sun') || 'null'); } catch (e) { sun = null; }
    var mo = now.getMonth() + 1, dd = now.getDate();
    var today = now.getFullYear() + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dd < 10 ? '0' : '') + dd;
    if (sun && sun.d === today && typeof sun.f === 'number' && typeof sun.m === 'number' &&
        isFinite(sun.f) && isFinite(sun.m) && sun.f < sun.m) {
      /* the night runs from maghrib to the next fajr */
      day = minute >= sun.f && minute < sun.m;
    }
    name = land + (day ? '-day' : '-night');
  } catch (e) { /* whatever went wrong, the plain shore by day */ }
  document.documentElement.setAttribute('data-splash', name);
})();

/* The same greeting the app's own opening screen gives, from the city the page
   already holds: the wrapper has to be told it, the page simply knows it. Read
   with textContent, never as markup, since it is whatever was stored. */
(function () {
  var name = '';
  try {
    /* the name the app itself showed last time, whatever it was drawn from */
    var stored = localStorage.getItem('sunnati.greet') || '';
    if (typeof stored === 'string' && stored.trim() && stored.length <= 40) name = stored.trim();
  } catch (e) { /* a store that cannot be read greets without a name */ }
  /* «حيّ الله أهل» then the city on its own bolder line, matching the wrapper's
     opening; and a single «حيّاكم الله» when no city is known yet */
  var put = function () {
    var hail = document.getElementById('boot-hail');
    var city = document.getElementById('boot-city');
    if (!hail || !city) return;
    hail.textContent = name ? 'حيّ الله أهل' : 'حيّاكم الله';
    city.textContent = name;
  };
  if (document.getElementById('boot-hail')) put(); else document.addEventListener('DOMContentLoaded', put);
})();
