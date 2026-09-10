/* سُنّتي service worker
   يخزّن هيكل التطبيق ونص المصحف عند أول زيارة، فيعمل بعدها بلا إنترنت.

   The shell is fetched from the network first and only falls back to the cache
   when the network is not there. An earlier version served the shell from the
   cache first, so a device that had visited once kept running old code for as
   long as the worker file itself stayed unchanged, and no fix ever reached it.
   The mushaf and the icons never change under the same name, so those stay
   cache first and cost nothing after the first visit. */

var VERSION = 'sunnati-v8.43.1';

var SHELL = [
  './',
  './index.html',
  './privacy.html',
  './css/style.css',
  './js/prayer-engine.js',
  './js/hijri.js',
  './js/store.js',
  './js/mushaf.js',
  './js/app.js',
  './data/surahs.js',
  './data/azkar.js',
  './data/hisn.js',
  './data/ojeiri.js',
  './data/marks.js',
  './data/adhan.js',
  './data/umrah.js',
  './data/dua-themes.js',
  './data/duas.js',
  './data/umrah.js',
  './audio/salawat/ibrahimiyya.mp3',
  './data/content.js',
  './data/extras.js',
  './icons/badge-googleplay.png',
  './icons/badge-appstore.png',
  './data/mushaf.json',
  './data/madinah-lines.json',
  './manifest.webmanifest',
  './icons/icon.svg?v=eye',
  './icons/icon-192.png?v=eye',
  './icons/icon-512.png?v=eye',
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

/* The page hands over the day's prayer times and the reminder interval, and
   the worker keeps them in the cache since it has no store of its own. */
var SCHEDULE_KEY = './__schedule';
var AUDIO_STORE = 'sunnati-audio';

function keepSchedule(data) {
  return caches.open(VERSION).then(function (cache) {
    return cache.put(SCHEDULE_KEY, new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' }
    }));
  });
}

function readSchedule() {
  return caches.open(VERSION).then(function (cache) {
    return cache.match(SCHEDULE_KEY);
  }).then(function (hit) { return hit ? hit.json() : null; }).catch(function () { return null; });
}

self.addEventListener('message', function (event) {
  if (!event.data) return;
  if (event.data.type === 'take-over') self.skipWaiting();
  if (event.data.type === 'schedule') event.waitUntil(keepSchedule(event.data));
});

/* Tapping a notification brings the app forward rather than opening a second
   copy of it. */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) return list[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  }));
});

/* Where the browser allows a periodic wake, the worker checks the schedule it
   was handed and raises whatever fell due while the page was closed. */
function dueNotifications() {
  return readSchedule().then(function (plan) {
    if (!plan) return;
    var now = Date.now();
    var jobs = [];
    var seen = plan.shown || {};
    if (plan.notify && plan.prayers) {
      plan.prayers.forEach(function (p) {
        var key = new Date(p.at).toDateString() + ':' + p.key;
        if (p.at <= now && now - p.at < 6 * 3600000 && !seen[key]) {
          seen[key] = true;
          jobs.push(self.registration.showNotification('حان وقت ' + p.name, {
            body: 'الله أكبر، حيّ على الصلاة', tag: key, lang: 'ar', dir: 'rtl',
            icon: 'icons/icon-192.png?v=eye', badge: 'icons/icon-96.png?v=eye', data: { url: './' }
          }));
        }
      });
    }
    if (plan.salawatEvery && now - (plan.salawatAt || 0) >= plan.salawatEvery * 60000) {
      plan.salawatAt = now;
      jobs.push(self.registration.showNotification('صلِّ على النبي ﷺ', {
        body: 'اللهم صلِّ وسلِّم على نبينا محمد', tag: 'salawat', lang: 'ar', dir: 'rtl',
        icon: 'icons/icon-192.png?v=eye', badge: 'icons/icon-96.png?v=eye', data: { url: './' }
      }));
    }
    plan.shown = seen;
    jobs.push(keepSchedule(plan));
    return Promise.all(jobs);
  });
}

self.addEventListener('periodicsync', function (event) {
  if (event.tag === 'sunnati-reminders') event.waitUntil(dueNotifications());
});

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      /* each file is asked for past the browser's own cache, which the host
         lets hold a file for ten minutes; without this a new version could be
         put together from files of two deployments */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
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
        return (name === VERSION || name === AUDIO_STORE) ? null : caches.delete(name);
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

  /* A verse the reader chose to keep is answered from the audio store, which
     lives outside the versioned cache so an update of the app does not throw
     the recitations away. Anything not kept stays on the network. */
  if (url.hostname === 'cdn.islamic.network' && url.pathname.indexOf('/quran/audio/') === 0) {
    event.respondWith(
      caches.open(AUDIO_STORE).then(function (store) { return store.match(request.url); }).then(function (hit) {
        return hit || fetch(request);
      })
    );
    return;
  }
  if (url.pathname.indexOf('.mp3') !== -1 || url.hostname.indexOf('Qurango') !== -1) return;

  /* The adhan and the recorded salawat: kept once heard, they never change. */
  if (url.origin === location.origin && url.pathname.indexOf('/audio/') !== -1) {
    event.respondWith(
      caches.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) { return keep(request, response); });
      })
    );
    return;
  }

  /* The tafsir: half a megabyte fetched once, on first use, and kept. */
  if (url.origin === location.origin && /\/data\/tafsir-[a-z]+\.json$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) { return keep(request, response); });
      })
    );
    return;
  }

  /* The recorded salawat: kept once it has been heard, since it never changes. */
  if (url.hostname === 'www.hisnmuslim.com' && /\.mp3$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) { return keep(request, response); });
      })
    );
    return;
  }

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

  /* Code and markup are served from this version's own cache, all of one
     piece. A new version comes as a new worker that has already fetched every
     file, so the page never mixes a fresh page with an old stylesheet, which
     the file by file network first way did. Anything not in the cache is
     fetched past the browser's cache and kept. */
  event.respondWith(
    caches.match(request, { cacheName: VERSION }).then(function (hit) {
      if (hit) return hit;
      if (request.mode === 'navigate') {
        /* The app is one page, so a navigation to anything under it is the app
           itself, offline or not. But the site also serves real pages of its
           own beside the app, and answering those with the app would hide
           them: the privacy policy is one, and the store reads it. So the
           network is asked first for them, and only the app's own address
           falls back to the cached page. */
        return fetch(new Request(request.url, { cache: 'reload' })).then(function (fresh) {
          return keep(request, fresh);
        }).catch(function () {
          return caches.match(request).then(function (any) {
            return any || caches.match('./index.html', { cacheName: VERSION });
          });
        });
      }
      return fetch(new Request(request.url, { cache: 'reload' })).then(function (response) {
        return keep(request, response);
      }).catch(function () {
        return caches.match(request).then(function (any) {
          return any || new Response('', { status: 504, statusText: 'offline' });
        });
      });
    })
  );
});
