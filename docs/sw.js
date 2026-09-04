/* سُنّتي service worker
   يخزّن هيكل التطبيق ونص المصحف عند أول زيارة، فيعمل بعدها بلا إنترنت.

   The shell is fetched from the network first and only falls back to the cache
   when the network is not there. An earlier version served the shell from the
   cache first, so a device that had visited once kept running old code for as
   long as the worker file itself stayed unchanged, and no fix ever reached it.
   The mushaf and the icons never change under the same name, so those stay
   cache first and cost nothing after the first visit. */

var VERSION = 'sunnati-v6.4.1';

var SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/prayer-engine.js',
  './js/hijri.js',
  './js/store.js',
  './js/mushaf.js',
  './js/app.js',
  './data/surahs.js',
  './data/azkar.js',
  './data/content.js',
  './data/extras.js',
  './data/mushaf.json',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/icon-180.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/maskable-192.png',
  './css/fonts.css',
  './fonts/amiri-400-arabic.woff2',
  './fonts/amiri-400-latin.woff2',
  './fonts/amiri-700-arabic.woff2',
  './fonts/amiri-700-latin.woff2',
  './fonts/amiri-quran-400-arabic.woff2',
  './fonts/amiri-quran-400-latin.woff2',
  './fonts/plex-arabic-300-arabic.woff2',
  './fonts/plex-arabic-300-latin.woff2',
  './fonts/plex-arabic-400-arabic.woff2',
  './fonts/plex-arabic-400-latin.woff2',
  './fonts/plex-arabic-500-arabic.woff2',
  './fonts/plex-arabic-500-latin.woff2',
  './fonts/plex-arabic-600-arabic.woff2',
  './fonts/plex-arabic-600-latin.woff2',
  './fonts/plex-arabic-700-arabic.woff2',
  './fonts/plex-arabic-700-latin.woff2'
];

/* Big and unchanging, so reading them from the cache is always right. */
function isSettled(pathname) {
  return /\/data\/mushaf\.json$/.test(pathname) ||
    /\/icons\//.test(pathname) ||
    /\.(png|svg|woff2?)$/.test(pathname);
}

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'take-over') self.skipWaiting();
});

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    })
  );
  /* A new worker used to sit and wait for every tab of the site to close before
     it took over. On a phone with dozens of tabs open that day never comes, so
     a device that had visited once kept running months old code and no fix
     reached it. The worker now steps forward as soon as it is ready. It does
     not pull the page out from under a reader, because the page is already
     loaded, and the reader is offered the new version rather than reloaded. */
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        return name === VERSION ? null : caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function keep(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return response;
  var copy = response.clone();
  caches.open(VERSION).then(function (cache) { cache.put(request, copy); });
  return response;
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  /* Streams and verse audio stay on the network, since caching them would fill the device. */
  if (url.pathname.indexOf('.mp3') !== -1 || url.hostname.indexOf('Qurango') !== -1) return;

  /* Tafsir and any other API call: try the network, fall back to whatever we kept. */
  if (url.hostname.indexOf('alquran.cloud') !== -1) {
    event.respondWith(
      fetch(request).then(function (response) {
        return keep(request, response);
      }).catch(function () { return caches.match(request); })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (isSettled(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) { return keep(request, response); });
      })
    );
    return;
  }

  /* Everything else is code or markup, so the network has the last word and the
     cache is only there for when the network is not. */
  event.respondWith(
    fetch(request).then(function (response) {
      return keep(request, response);
    }).catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
