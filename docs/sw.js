/* سُنّتي service worker
   يخزّن هيكل التطبيق ونص المصحف عند أول زيارة، فيعمل بعدها بلا إنترنت.

   The shell is fetched from the network first and only falls back to the cache
   when the network is not there. An earlier version served the shell from the
   cache first, so a device that had visited once kept running old code for as
   long as the worker file itself stayed unchanged, and no fix ever reached it.
   The mushaf and the icons never change under the same name, so those stay
   cache first and cost nothing after the first visit. */

var VERSION = 'sunnati-v5.6.0';

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
  './icons/icon-180.png'
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
  /* No skipWaiting here on purpose. Seizing control mid install would swap the
     files under someone who is reading, so the page asks for the handover when
     it is ready and the worker obliges through the message above. */
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
