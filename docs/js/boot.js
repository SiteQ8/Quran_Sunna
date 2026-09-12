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

/* The same greeting the app's own opening screen gives, from the city the page
   already holds: the wrapper has to be told it, the page simply knows it. Read
   with textContent, never as markup, since it is whatever was stored. */
(function () {
  var line = 'حيّاك الله';
  try {
    /* the name the app itself showed last time, whatever it was drawn from */
    var name = localStorage.getItem('sunnati.greet') || '';
    if (typeof name === 'string' && name.trim() && name.length <= 40) line += ' في ' + name.trim();
  } catch (e) { /* a store that cannot be read greets without a name */ }
  var put = function () { var el = document.getElementById('boot-greet'); if (el) el.textContent = line; };
  if (document.getElementById('boot-greet')) put(); else document.addEventListener('DOMContentLoaded', put);
})();
