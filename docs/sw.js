/* سُنّتي service worker
   يخزّن هيكل التطبيق ونص المصحف عند أول زيارة، فيعمل بعدها بلا إنترنت.

   Updated: إصلاح الإشعارات وإضافة notifications للأذكار والأدعية والأذان   The shell is fetched from the network first and only falls back to the cache
   when the network is not there. An earlier version served the shell from the
   cache first, so a device that had visited once kept running old code for as
   long as the worker file itself stayed unchanged, and no fix ever reached it.
   The mushaf and the icons never change under the same name, so those stay
   cache first and cost nothing after the first visit. */

var VERSION = 'sunnati-v8.87.103';

var SHELL = [
  './',
  './index.html',
  './privacy.html',
  './css/style.css',
  './css/verse-video.css',
  './js/prayer-engine.js',
  './js/hijri.js',
  './js/store.js',
  './js/mushaf.js',
  './js/verse-video.js',
  './js/boot.js',
  './js/i18n.js',
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
  './audio/salawat/buhendi.mp3',
  './audio/salawat/ibrahimiyya.mp3',
  './data/content.js',
  './data/extras.js',
  './img/sky/night.webp',
  './img/sky/fajr.webp',
  './img/sky/sunrise.webp',
  './img/sky/morning.webp',
  './img/sky/noon.webp',
  './img/sky/afternoon.webp',
  './img/sky/sunset.webp',
  './img/sky/dusk.webp',
  './img/sections/azkar.webp',
  './img/sections/mosques.webp',
  './img/sections/qada.webp',
  './img/sections/umrah.webp',
  './img/sections/qibla.webp',
  './img/sections/khatma.webp',
  './img/sections/hadith.webp',
  './img/sections/ruqyah.webp',
  './img/sections/dua.webp',
  /* the opening painting of a place with no painting of its own, by day and
     by night; each country's pair is kept by the worker the first time the
     app fetches it, so the shell does not carry all fourteen */
  './img/splash/default-day.webp',
  './img/splash/default-night.webp',
  './icons/badge-googleplay.png',
  './icons/badge-appstore.png',
  './img/badges/google-play-ar.png',
  './img/badges/app-store-ar.svg',
  './data/mushaf.json',
  './data/madinah-lines.json',
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
  './fonts/plex-arabic-700-latin.woff2',
  './fonts/plex-sans-300-latin-ext.woff2',
  './fonts/plex-sans-400-latin-ext.woff2',
  './fonts/plex-sans-500-latin-ext.woff2',
  './fonts/plex-sans-600-latin-ext.woff2',
  './fonts/plex-sans-700-latin-ext.woff2'
];

/* Big and unchanging, so reading them from the cache is always right. */
function isSettled(pathname) {
  return /\/data\/mushaf\.json$/.test(pathname) ||
    /\/icons\//.test(pathname) ||
    /\.(png|svg|webp|woff2?)$/.test(pathname);
}

/* The page hands over the day's prayer times and the reminder interval, and
   the worker keeps them in the cache since it has no store of its own. */
var SCHEDULE_KEY = './__schedule';
var AUDIO_STORE = 'sunnati-audio';
var TILE_STORE = 'sunnati-tiles';

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
  /* The tag says which reminder this was, and the reader is put on its
     subject: focusing a window and leaving it wherever it last was wastes the
     tap, which is what a morning adhkar reminder used to do. */
  var kind = (event.notification.tag || '').replace(/[^a-zA-Z]/g, '');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) {
        if (kind) { try { list[i].postMessage({ type: 'came-from', kind: kind }); } catch (e) { } }
        return list[i].focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(kind ? './?from=' + kind : './');
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
          /* in the reader's language, as the page hands it over */
          jobs.push(self.registration.showNotification(p.title || 'حان وقت ' + p.name, {
            body: p.body || 'الله أكبر، حيّ على الصلاة', tag: key, lang: plan.lang || 'ar', dir: plan.dir || 'rtl',
            icon: 'icons/icon-192.png', badge: 'icons/icon-96.png', data: { url: './' }
          }));
        }
      });
    }
    if (plan.salawatEvery && now - (plan.salawatAt || 0) >= plan.salawatEvery * 60000) {
      plan.salawatAt = now;
      jobs.push(self.registration.showNotification(plan.salawatTitle || 'صلِّ على النبي ﷺ', {
        body: plan.salawatBody || 'اللهم صلِّ وسلِّم على نبينا محمد', tag: 'salawat', lang: plan.lang || 'ar', dir: plan.dir || 'rtl',
        icon: 'icons/icon-192.png', badge: 'icons/icon-96.png', data: { url: './' }
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
      })).then(function () { return carryOver(cache); });
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
        return (name === VERSION || name === AUDIO_STORE || name === TILE_STORE) ? null : caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* The faces of a script only some readers write, Russian, Bengali and the
   marked vowels of Hausa, are not in the shell: every reader would fetch them and few would read them.
   A page in that script asks for them, the worker keeps them as it keeps
   anything it fetches, and an update moves them across as they are. */
var SCRIPT_FACES = /\/fonts\/(plex-sans-\d+-(cyrillic|vietnamese)|noto-bengali-\d+-bengali)\.woff2$/;

/* What a reader fetched for themselves is not thrown away by an update. The
   table of the language they read the app in is fetched again, since it
   changes with the app, so a reader offline the day after an update still
   reads it in their language. The tafsir, the meanings, the names of the
   places and the faces of a script never change under the same name, so the
   copy already kept is moved across as it is. */
function carryOver(cache) {
  return caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n !== VERSION && n.indexOf('sunnati-v') === 0; }).map(function (n) {
      return caches.open(n).then(function (old) {
        return old.keys().then(function (requests) {
          return Promise.all(requests.map(function (r) {
            var at = new URL(r.url).pathname;
            if (/\/i18n\/[a-z]+\.js$/.test(at)) {
              return cache.add(new Request(r.url, { cache: 'reload' })).catch(function () { return null; });
            }
            if (/\/data\/(tafsir-[a-z]+|meanings\/[a-z0-9_-]+|places)\.json$/.test(at) || SCRIPT_FACES.test(at)) {
              return old.match(r).then(function (hit) { return hit ? cache.put(r, hit) : null; });
            }
            return null;
          }));
        });
      });
    }));
  }).catch(function () { return null; });
}

function keep(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return response;
  var copy = response.clone();
  caches.open(VERSION).then(function (cache) { cache.put(request, copy); });
  return response;
}

/* A cache holds whole files while the audio element asks for pieces of one,
   so the piece it asks for is cut from the kept copy and answered as a part,
   the way the network answers it. An opaque copy cannot be read, so that one
   goes back as it is, and so does any request that asks for the whole. */
function answerRange(request, response) {
  var range = request.headers.get('range');
  if (!range || !response || response.status !== 200 || response.type === 'opaque') return response;
  var m = /^bytes=(\d*)-(\d*)$/.exec(range.replace(/\s+/g, ''));
  if (!m || (m[1] === '' && m[2] === '')) return response;
  return response.arrayBuffer().then(function (body) {
    var size = body.byteLength;
    var start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    var end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size || start > end) {
      return new Response('', { status: 416, statusText: 'Range Not Satisfiable', headers: { 'Content-Range': 'bytes */' + size } });
    }
    return new Response(body.slice(start, end + 1), {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes'
      }
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  /* A verse the reader chose to keep is answered from the audio store, which
     lives outside the versioned cache so an update of the app does not throw
     the recitations away, and it is answered in the pieces the player asks
     for. Anything not kept stays on the network. */
  if (url.hostname === 'cdn.islamic.network' && url.pathname.indexOf('/quran/audio/') === 0) {
    event.respondWith(
      caches.open(AUDIO_STORE).then(function (store) { return store.match(request.url); }).then(function (hit) {
        return hit ? answerRange(request, hit) : fetch(request);
      })
    );
    return;
  }
  /* A whole surah and a live station from another site are played as they
     come and never kept, so the worker stays out of their way. This used to
     catch every file ending in .mp3, the app's own recordings among them, so
     the adhan and the salawat it had put by were never answered offline. */
  if (url.origin !== location.origin && (/\.mp3$/i.test(url.pathname) || /(^|\.)qurango\.net$/.test(url.hostname))) return;

  /* The mosques map draws OpenStreetMap tiles. A tile once seen is kept in its
     own store and served from it, so the map a reader has opened before comes
     up without the network and does not throw its tiles away on every app
     update. The store is bounded: old tiles fall out once it is full. */
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(
      caches.open(TILE_STORE).then(function (store) {
        return store.match(request).then(function (hit) {
          if (hit) return hit;
          return fetch(request).then(function (res) {
            if (res && res.ok) {
              store.put(request, res.clone());
              store.keys().then(function (keys) {
                if (keys.length > 300) store.delete(keys[0]);
              });
            }
            return res;
          }).catch(function () { return hit; });
        });
      })
    );
    return;
  }

  /* The adhan, the salawat and the duas that come with the app. The whole file
     is fetched once and kept, never the piece the player happened to ask for,
     since a cache cannot keep a piece, and the player is answered from the
     kept copy, whole or in pieces, with the network or without it. */
  if (url.origin === location.origin && url.pathname.indexOf('/audio/') !== -1) {
    event.respondWith(
      caches.match(request.url).then(function (hit) {
        if (hit) return answerRange(request, hit);
        return fetch(request.url).then(function (whole) { return answerRange(request, keep(request.url, whole)); });
      })
    );
    return;
  }

  /* The tafsir, two and a half megabytes, the meanings of the Quran in a
     reader's language, about one, and the names of the places of the world,
     about one, which the page reads only to name where a reader is: fetched
     once, on first use, and kept, and never part of the shell every reader
     loads. */
  if (url.origin === location.origin && (/\/data\/tafsir-[a-z]+\.json$/.test(url.pathname) || /\/data\/meanings\/[a-z0-9_-]+\.json$/.test(url.pathname) ||
      /\/data\/places\.json$/.test(url.pathname))) {
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
