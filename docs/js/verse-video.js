/* سُنّتي: a verse as a short video, made on the phone.

   The picture is a 1080x1920 canvas: the night over the sea, a still with a
   seven second loop of the moving water laid into its foot, the surah in gold
   between two hairlines, the verse in the mushaf face lit phrase by phrase as
   the reciter reaches it, his name under it, and the app with its two store
   badges over the water. The canvas is captured with captureStream, the
   recitation is played through WebAudio into a MediaStreamAudioDestinationNode,
   and both go to one MediaRecorder. The recording runs in real time, so a verse
   of twenty seconds takes twenty seconds to make.

   Nothing here reads app.js: the verse, the names and the reciter's file are
   passed in, so the page can be tried on its own. */
(function (root) {
  'use strict';

  var W = 1080, H = 1920, FPS = 24;
  /* the voice comes a second in and the scene holds two seconds after it, as
     in the sample the owner approved; the first frame is already the whole
     picture, since it is what a chat shows before anyone presses play */
  var LEAD = 1.0, TAIL = 2.0;
  /* the phrase not being recited */
  var DIM = 0.42;
  /* 99.4% of verses have at most fifty words; ninety seconds holds 99.5% of
     verses in the murattal voice and 94% in the slowest mujawwad one */
  var MAX_WORDS = 50, MAX_SECONDS = 90;
  var VIDEO_BPS = 2500000, AUDIO_BPS = 128000;
  /* H.264 baseline and AAC in mp4 is what WhatsApp plays on every phone. The
     bare 'video/mp4' is never asked for: a Chromium without the licensed
     codecs answers it with VP9 and Opus, and Android 8 and 9, which have no
     AAC encoder in the web view, with Opus. */
  var TYPES = ['video/mp4;codecs=avc1.42E028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2'];
  var WAQF = /^[ۖ-ۜ]$/;
  var LETTER = /[ء-يٱ-ۓ]/g;

  var CREAM = '#f6eedd', GOLD = '#d6b26a';
  var SHADE = [['rgba(4, 9, 28, 0.6)', 22, 2], ['rgba(4, 9, 28, 0.45)', 3, 1]];
  /* The scene a verse is set in: the night of the reader's own country,
     keyed as the opening painting is chosen, and the plain shore by night for
     any other. Each is a still of the whole frame and a seamless loop of its
     moving water, laid in from the line where the strip starts (sea), as tall
     in the frame as the strip is (strip), its top pixels faded into the still
     (feather). A scene whose landmark rises higher may hold the verse above a
     line of its own (limit), and set the app over its water at another height
     (foot). Fetched only when a video is made, and kept by the worker after. */
  var SCENES = {
    'default': { still: 'img/verse/night-sea.webp', loop: 'img/verse/night-sea-loop.mp4', sea: 1440, strip: 480, feather: 60 }
  };
  var SCENE = SCENES['default'];

  /* the scene of a country, or the plain shore where it has none */
  function sceneFor(land) {
    return land && Object.prototype.hasOwnProperty.call(SCENES, land) ? SCENES[land] : SCENE;
  }

  /* how tall the strip stands in the frame, and how far its edges fade */
  function stripOf(scene) {
    var tall = scene.strip || H - scene.sea;
    var fade = Math.max(0, Math.min(scene.feather || 0, tall / 2));
    return { tall: tall, fade: fade, low: scene.sea + tall < H ? fade : 0 };
  }
  var ICON = 'icons/icon-192.png';
  /* The two store badges as their owners publish them, never altered, and
     drawn so their black shapes stand the same height. Apple's shape fills its
     artwork; Google's PNG carries a margin of its own, 41 pixels of 250, which
     is kept and scaled with it. */
  var BADGES = {
    apple: { src: 'img/badges/app-store-ar.svg', w: 119.66408, h: 40.00013, box: [0, 0, 119.66408, 40.00013] },
    google: { src: 'img/badges/google-play-ar.png', w: 646, h: 250, box: [41, 41, 605, 209] }
  };

  /* The verse files the video is made from. WebAudio can only read a file
     that comes with Access-Control-Allow-Origin, and cdn.islamic.network,
     where the app plays from, sends none; everyayah.com sends it for every
     file. Each folder was checked against the app's own files for that
     reciter: the very same recording for fifteen of them, and for Shuraym the
     same recitation at 128, whose first verse lacks the isti'adha the app's
     copy opens with. A few verses in a folder are another take by the same
     reciter: of those checked, 2:254, 2:255, 11:36 and 11:88 of Husary
     mujawwad and 33:4 of Maher. */
  var AUDIO = (function () {
    /* the folder is named beside each reciter in the list (ea), which the
       app also keeps its offline copies from, so the two never part */
    var map = {};
    (root.RECITERS || []).forEach(function (r) {
      if (r && r.ea) map[r.id] = 'https://everyayah.com/data/' + r.ea + '/';
    });
    return map;
  })();

  /* quran.com publishes when every word is said for these three, for files
     byte for byte the same as the folders above, so their phrases are lit
     exactly; every other voice is read from the sound itself */
  var TIMED = { 'ar.minshawi': 9, 'ar.shaatree': 4, 'ar.saoodshuraym': 10 };

  /* where things stand in the frame, as the approved overlay placed them */
  var BOX = { left: 96, width: 888, top: 548, title: 428, gap: 34, rec: 44, limit: 1330, lift: 300 };
  var FOOT = { centre: 1700, icon: 74, gap: 22, badge: 56 };
  var SIZES = [80, 76, 72, 68, 64, 60, 56, 52, 48, 44];
  /* Amiri Quran's own ascent and descent, as the browser lays a line of it */
  var LINE = 2.08, ASC = 1.815, DESC = 0.634;
  /* IBM Plex Sans Arabic's */
  var UI_ASC = 1.085, UI_DESC = 0.415;

  function failure(code) { var e = new Error(code); e.code = code; return e; }

  function three(n) { return ('00' + n).slice(-3); }

  function hasVoice(id) { return Object.prototype.hasOwnProperty.call(AUDIO, id); }

  function audioUrl(id, s, a) {
    return hasVoice(id) ? AUDIO[id] + three(s) + three(a) + '.mp3' : '';
  }

  /* the word timings, if quran.com answers within three seconds */
  function timings(id, s, a) {
    var rec = TIMED[id];
    if (!rec || !root.fetch) return Promise.resolve(null);
    var url = 'https://api.quran.com/api/v4/recitations/' + rec + '/by_ayah/' + s + ':' + a + '?fields=segments';
    var late = new Promise(function (resolve) { root.setTimeout(function () { resolve(null); }, 3000); });
    var asked = root.fetch(url, { mode: 'cors', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.audio_files && j.audio_files[0] && j.audio_files[0].segments) || null; })
      .catch(function () { return null; });
    return Promise.race([asked, late]);
  }

  function pickType(list) {
    var R = root.MediaRecorder;
    if (!R || typeof R.isTypeSupported !== 'function') return '';
    var types = list || TYPES;
    for (var i = 0; i < types.length; i++) {
      try { if (R.isTypeSupported(types[i])) return types[i]; } catch (e) { /* an odd string throws in old engines */ }
    }
    return '';
  }

  /* everything the recording needs, without making anything */
  function supported(list) {
    var A = root.AudioContext || root.webkitAudioContext;
    var c = root.document.createElement('canvas');
    return !!(A && A.prototype && typeof A.prototype.createMediaStreamDestination === 'function' &&
      typeof c.captureStream === 'function' && root.MediaStream && pickType(list));
  }

  /* ---------------- the words ---------------- */

  /* A waqf mark is its own word in the text. It is set on the word before it
     over a space that does not break, as the approved overlay set it, and it
     closes a phrase there. */
  function tokens(text) {
    var out = [];
    String(text || '').split(/\s+/).forEach(function (t) {
      if (!t) return;
      if (WAQF.test(t) && out.length) {
        out[out.length - 1].t += '\u00a0' + t;
        out[out.length - 1].stop = true;
        return;
      }
      out.push({ t: t, stop: false });
    });
    return out;
  }

  function letters(s) { return (String(s).match(LETTER) || []).length; }

  /* words as a reader counts them, the waqf marks left out */
  function wordCount(text) {
    return String(text || '').split(/\s+/).filter(function (t) { return t && !WAQF.test(t); }).length;
  }

  /* Phrases between the marks. A phrase of one short word, which the paired
     marks of لَا رَيْبَ ۛ فِيهِ ۛ leave, rides with the one after it. */
  function phrasesByMarks(words) {
    var groups = [], cur = [];
    words.forEach(function (w, i) {
      cur.push(i);
      if (w.stop) { groups.push(cur); cur = []; }
    });
    if (cur.length) groups.push(cur);
    var merged = [];
    groups.forEach(function (g) {
      var last = merged[merged.length - 1];
      if (last && last.length === 1 && letters(words[last[0]].t) <= 4) merged[merged.length - 1] = last.concat(g);
      else merged.push(g);
    });
    return merged;
  }

  /* ---------------- laying the verse out ---------------- */

  function wrapAt(widths, space, max) {
    var lines = [], line = [], w = 0;
    for (var i = 0; i < widths.length; i++) {
      var add = line.length ? space + widths[i] : widths[i];
      if (line.length && w + add > max) { lines.push(line); line = [i]; w = widths[i]; }
      else { line.push(i); w += add; }
    }
    if (line.length) lines.push(line);
    return lines;
  }

  /* Lines of about equal length, as text-wrap: balance gave the overlay: the
     narrowest measure that still needs no more lines than the full one. A
     block of more than six lines is wrapped plainly, as the browser does. */
  function balanced(widths, space, max) {
    var lines = wrapAt(widths, space, max);
    if (lines.length < 2 || lines.length > 6) return lines;
    var lo = Math.max.apply(null, widths), hi = max;
    for (var n = 0; n < 14; n++) {
      var mid = (lo + hi) / 2;
      if (wrapAt(widths, space, mid).length <= lines.length) hi = mid; else lo = mid;
    }
    return wrapAt(widths, space, hi);
  }

  /* One size of the verse: a block per phrase, each starting its own line as
     the overlay's blocks did, or one block for the whole when blocks is a
     single list. The last word carries the verse's rosette. */
  function layAt(ctx, words, blocks, face, size) {
    ctx.font = '400 ' + size + 'px ' + face;
    ctx.direction = 'rtl';
    var space = ctx.measureText(' ').width || size * 0.292;
    var widths = words.map(function (w) { return ctx.measureText(w.t).width; });
    var rosette = size * (0.14 + 1.25);
    var eff = widths.slice();
    eff[eff.length - 1] += rosette;
    var lh = size * LINE, lines = [], y = 0;
    blocks.forEach(function (ids, b) {
      /* the overlay set each block six pixels into the one above */
      if (b > 0) y -= 6;
      balanced(ids.map(function (id) { return eff[id]; }), space, BOX.width).forEach(function (row) {
        lines.push({ ids: row.map(function (i) { return ids[i]; }), top: y });
        y += lh;
      });
    });
    lines.forEach(function (ln) {
      var w = 0;
      ln.ids.forEach(function (id, j) { w += eff[id] + (j ? space : 0); });
      ln.w = w;
      var xr = BOX.left + (BOX.width + w) / 2;
      ln.xr = [];
      ln.ids.forEach(function (id) { ln.xr.push(xr); xr -= eff[id] + space; });
      ln.base = ln.top + (lh - (ASC + DESC) * size) / 2 + ASC * size;
    });
    return { size: size, lh: lh, space: space, widths: widths, eff: eff, rosette: rosette, lines: lines, h: y, blocks: blocks };
  }

  /* The largest size at which the verse, its reciter under it, stands in the
     sky above the mosque, lifting the whole a little for a long one. Phrase
     blocks first; a verse with more phrases than will stand that way runs as
     one block. */
  function arrange(ctx, words, groups, face, limit) {
    var floor = limit || BOX.limit;
    var all = words.map(function (w, i) { return i; });
    var tries = groups.length > 1 ? [groups, [all]] : [[all]];
    var lay = null;
    for (var t = 0; t < tries.length; t++) {
      for (var k = 0; k < SIZES.length; k++) {
        lay = layAt(ctx, words, tries[t], face, SIZES[k]);
        var bottom = BOX.top + lay.h + BOX.gap + BOX.rec;
        lay.lift = Math.max(0, bottom - floor);
        if (lay.lift <= BOX.lift) return lay;
      }
    }
    lay.lift = BOX.lift;
    return lay;
  }

  /* What is lit in turn: the phrases between the marks, or, in a verse with
     none, its lines as they are laid. Each with its weight in letters, the
     estimate of how long it takes to recite. */
  function litUnits(words, groups, lay) {
    var list = groups.length > 1 ? groups : lay.lines.map(function (ln) { return ln.ids.slice(); });
    return list.map(function (ids) {
      var weight = 0;
      ids.forEach(function (id) { weight += letters(words[id].t); });
      return { ids: ids, weight: Math.max(1, weight) };
    });
  }

  /* The band of the verse each unit's words take, from the top of its first
     line to the foot of its last, with room above and below for what the
     mushaf face draws past its line, the tails of some letters and the marks
     over and under them, and for the shadow. Each unit is drawn on a canvas
     of that band and laid over the others at its own strength, as the
     overlay's phrase layers were, so a tail that reaches into the next line
     keeps the light of its own phrase. */
  function unitSpans(lay, units) {
    var lineOf = [];
    lay.lines.forEach(function (ln, i) { ln.ids.forEach(function (id) { lineOf[id] = i; }); });
    var pad = Math.ceil(lay.size * 0.6 + 30);
    units.forEach(function (u) {
      var first = Infinity, last = -1;
      u.ids.forEach(function (id) { first = Math.min(first, lineOf[id]); last = Math.max(last, lineOf[id]); });
      u.top = Math.floor(lay.lines[first].top - pad);
      u.bottom = Math.ceil(lay.lines[last].top + lay.lh + pad);
    });
    return units;
  }

  /* ---------------- when each phrase is heard ---------------- */

  function mono(buffer) {
    var n = buffer.length, out = new Float32Array(n);
    for (var c = 0; c < buffer.numberOfChannels; c++) {
      var d = buffer.getChannelData(c);
      for (var i = 0; i < n; i++) out[i] += d[i] / buffer.numberOfChannels;
    }
    return out;
  }

  /* Read from the recording itself. The loudness in steps of 20ms marks
     where the reciter breathes; each phrase boundary is put at the end of
     the pause nearest to where its letters say it falls, so the light moves
     as the next phrase begins. Checked against the word timings quran.com
     publishes for the same files: in murattal 88% of boundaries land within
     half a second; a mujawwad reciter who repeats a phrase is followed less
     well. */
  function pauseTiming(buffer, units) {
    var data = mono(buffer), rate = buffer.sampleRate;
    var hop = Math.round(rate * 0.02), n = Math.floor(data.length / hop), step = hop / rate;
    if (n < 10) return null;
    var db = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var j = i * hop, e = j + hop; j < e; j++) s += data[j] * data[j];
      db[i] = 10 * Math.log(s / hop + 1e-10) / Math.LN10;
    }
    var sorted = Array.prototype.slice.call(db).sort(function (a, b) { return a - b; });
    var floor = sorted[Math.floor(n * 0.1)], loud = sorted[Math.floor(n * 0.9)];
    var thr = floor + 0.3 * (loud - floor);
    var first = -1, last = -1;
    for (i = 0; i < n; i++) if (db[i] >= thr) { if (first < 0) first = i; last = i; }
    if (first < 0) return null;
    var pauses = [], run = -1;
    for (i = first; i <= last; i++) {
      if (db[i] < thr) { if (run < 0) run = i; }
      else if (run >= 0) {
        if ((i - run) * step >= 0.35) pauses.push([run * step, i * step]);
        run = -1;
      }
    }
    var start = first * step, end = (last + 1) * step, paused = 0, total = 0;
    pauses.forEach(function (p) { paused += p[1] - p[0]; });
    units.forEach(function (u) { total += u.weight; });
    var spoken = (end - start) - paused;
    var win = Math.max(1.5, 0.25 * (end - start));
    var starts = [start], used = {}, cum = 0, prev = start;
    for (var k = 0; k < units.length - 1; k++) {
      cum += units[k].weight;
      /* the estimate on the clock of speech, then the pauses before it put back */
      var t = start + spoken * cum / total;
      for (var q = 0; q < pauses.length; q++) if (pauses[q][0] < t) t += pauses[q][1] - pauses[q][0];
      var best = -1, score = 0;
      for (q = 0; q < pauses.length; q++) {
        var p = pauses[q];
        if (used[q] || p[1] <= prev) continue;
        var dist = Math.abs((p[0] + p[1]) / 2 - t);
        if (dist > win) continue;
        var sc = dist - 1.5 * Math.min(p[1] - p[0], 1);
        if (best < 0 || sc < score) { best = q; score = sc; }
      }
      if (best >= 0) { used[best] = true; t = pauses[best][1]; }
      t = Math.max(t, prev + 0.2);
      starts.push(t);
      prev = t;
    }
    return { starts: starts, end: end };
  }

  /* Exact, where quran.com publishes the timing of every word for the very
     file that plays: [first word, word after the last, start ms, end ms],
     words counted from 0 with the marks set on their words. A reciter who
     goes back over a phrase is followed back. Its count of words differs
     from the mushaf's in a few verses (3:93, 9:111), and there the timing is
     not trusted: only a list that reaches the last word exactly is used. */
  function segmentTiming(segments, words, units) {
    if (!segments || !segments.length) return null;
    var unitOf = [];
    units.forEach(function (u, k) { u.ids.forEach(function (id) { unitOf[id] = k; }); });
    var list = [], most = -1;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      if (!s || s.length < 4) continue;
      var w = +s[0], a = +s[2] / 1000, b = +s[3] / 1000;
      if (!(w >= 0 && w < words.length) || !(b > a)) return null;
      most = Math.max(most, w);
      list.push({ unit: unitOf[w], a: a, b: b });
    }
    if (!list.length || most !== words.length - 1) return null;
    list.sort(function (x, y) { return x.a - y.a; });
    return { segments: list, end: list[list.length - 1].b };
  }

  /* the moments the light moves to a unit, in seconds into the recitation */
  function lightEvents(timing, units, duration) {
    var out = [];
    if (timing && timing.segments) {
      timing.segments.forEach(function (s) {
        if (!out.length || out[out.length - 1].unit !== s.unit) out.push({ t: s.a, unit: s.unit });
      });
      return out;
    }
    if (timing && timing.starts) {
      timing.starts.forEach(function (t, k) { out.push({ t: t, unit: k }); });
      return out;
    }
    /* no timing at all: the units share the recitation by their letters */
    var total = 0, cum = 0;
    units.forEach(function (u) { total += u.weight; });
    units.forEach(function (u, k) { out.push({ t: duration * cum / total, unit: k }); cum += u.weight; });
    return out;
  }

  /* How lit each unit is at a moment of the recitation, 0 for dim and 1 for
     full. The light moves in the pause, half a second before the phrase
     begins, over a little over half a second, and the whole verse comes up
     together as the last word ends. */
  function lights(events, count, tau, end) {
    var on = [], i;
    for (i = 0; i < count; i++) on.push(0);
    var x = tau + 0.5, cur = -1;
    for (i = 0; i < events.length; i++) { if (events[i].t <= x) cur = i; else break; }
    if (cur >= 0) {
      var r = Math.min(1, (x - events[cur].t) / 0.55);
      on[events[cur].unit] = r;
      var before = cur > 0 ? events[cur - 1].unit : -1;
      if (before >= 0 && before !== events[cur].unit) on[before] = Math.max(on[before], 1 - r);
    }
    var all = Math.max(0, Math.min(1, (tau - (end - 0.25)) / 0.7));
    if (all > 0) for (i = 0; i < count; i++) on[i] = Math.max(on[i], all);
    return on;
  }

  /* ---------------- the pieces ---------------- */

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new root.Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function decode(ctx, buf) {
    return new Promise(function (resolve, reject) {
      var p = ctx.decodeAudioData(buf, resolve, function () { reject(failure('decode')); });
      if (p && typeof p.then === 'function') p.then(resolve, function () { reject(failure('decode')); });
    });
  }

  /* The file must come with Access-Control-Allow-Origin, or WebAudio gets an
     opaque response it cannot read: that is why the app's own address,
     cdn.islamic.network, cannot be used here. */
  function fetchAudio(ctx, url) {
    return root.fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw failure('audio');
      return res.arrayBuffer();
    }, function () { throw failure('audio'); }).then(function (buf) { return decode(ctx, buf); });
  }

  /* The moving sea. It is fetched as a whole file and played from a blob, so
     the worker keeps it like any other file of the app and no range request
     ever reaches the worker, which Safari would refuse to play from. It stands
     in the preview behind the canvas, where it counts as seen, since a phone
     may pause a muted video it thinks nobody can see. If it cannot play, the
     still is the whole scene. */
  function loadLoop(scene, host) {
    if (!root.fetch || !root.URL || !root.URL.createObjectURL) return Promise.resolve(null);
    return root.fetch(scene.loop).then(function (res) {
      if (!res.ok) throw failure('loop');
      return res.blob();
    }).then(function (blob) {
      return new Promise(function (resolve) {
        var v = root.document.createElement('video');
        var src = root.URL.createObjectURL(blob);
        var done = false;
        function finish(ok) {
          if (done) return;
          done = true;
          if (ok) { resolve({ video: v, src: src }); return; }
          try { v.pause(); } catch (e) { /* never played */ }
          if (v.parentNode) v.parentNode.removeChild(v);
          root.URL.revokeObjectURL(src);
          resolve(null);
        }
        v.muted = true;
        v.defaultMuted = true;
        v.loop = true;
        v.playsInline = true;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.setAttribute('aria-hidden', 'true');
        v.className = 'video-sea';
        /* where the strip lies in the frame and how its edges fade, as the
           video itself draws them */
        var strip = stripOf(scene);
        var pct = function (n) { return (Math.round(n * 10000) / 100) + '%'; };
        v.style.top = pct(scene.sea / H);
        v.style.bottom = 'auto';
        v.style.height = pct(strip.tall / H);
        var mask = 'linear-gradient(to bottom, transparent, #000 ' + pct(strip.fade / strip.tall) +
          (strip.low ? ', #000 ' + pct(1 - strip.low / strip.tall) + ', transparent' : '') + ')';
        v.style.webkitMaskImage = mask;
        v.style.maskImage = mask;
        v.addEventListener('playing', function () { finish(true); });
        v.addEventListener('error', function () { finish(false); });
        if (host) host.appendChild(v);
        v.src = src;
        var p = v.play();
        if (p && p.catch) p.catch(function () { finish(false); });
        root.setTimeout(function () { finish(v.readyState >= 2 && !v.paused); }, 4000);
      });
    }).catch(function () { return null; });
  }

  function fontsReady(faces, text) {
    var f = root.document.fonts;
    if (!f || !f.load) return Promise.resolve();
    /* the text is passed so the Arabic subset is fetched: without it the
       browser loads only the face that covers a space, which is the Latin one */
    var jobs = faces.map(function (face) { return f.load(face, text).catch(function () {}); });
    return Promise.race([Promise.all(jobs), new Promise(function (r) { root.setTimeout(r, 4000); })]);
  }

  function canvas(w, h) {
    var c = root.document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
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

  /* text with the overlay's two shadows, a soft one and a close one */
  function shaded(ctx, draw) {
    SHADE.forEach(function (s) {
      ctx.save();
      ctx.shadowColor = s[0]; ctx.shadowBlur = s[1]; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = s[2];
      draw();
      ctx.restore();
    });
  }

  /* the app's rosette for the verse number, as the mushaf draws it, in gold */
  function rosette(ctx, cx, cy, size, n, ui) {
    var k = size / 40;
    ctx.save();
    ctx.translate(cx - 20 * k, cy - 20 * k);
    ctx.scale(k, k);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(20, 20, 11, 0, Math.PI * 2); ctx.stroke();
    roundRect(ctx, 10, 10, 20, 20, 2); ctx.stroke();
    ctx.translate(20, 20); ctx.rotate(Math.PI / 4); ctx.translate(-20, -20);
    roundRect(ctx, 10, 10, 20, 20, 2); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = CREAM;
    ctx.font = '700 ' + Math.round(size * 0.272) + 'px ' + ui;
    ctx.direction = 'ltr'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n, cx, cy + size * 0.02);
    ctx.restore();
  }

  /* The two badges side by side, Apple's on the right as the app's other
     cards place it, their black shapes one height h, a gap of a little more
     than the quarter height each asks to keep clear. Returns the width. */
  function drawBadges(ctx, cx, top, h, imgs) {
    var a = BADGES.apple, g = BADGES.google;
    var aw = h * (a.box[2] - a.box[0]) / (a.box[3] - a.box[1]);
    var gs = h / (g.box[3] - g.box[1]);
    var gw = (g.box[2] - g.box[0]) * gs;
    var gap = Math.round(h * 0.36);
    var have = [imgs && imgs.google ? gw : 0, imgs && imgs.apple ? aw : 0].filter(Boolean);
    var whole = have.reduce(function (s, w) { return s + w; }, 0) + (have.length > 1 ? gap : 0);
    var x = cx - whole / 2;
    if (imgs && imgs.google) {
      ctx.drawImage(imgs.google, x - g.box[0] * gs, top - g.box[1] * gs, g.w * gs, g.h * gs);
      x += gw + gap;
    }
    if (imgs && imgs.apple) ctx.drawImage(imgs.apple, x, top, aw, h);
    return whole;
  }

  /* the app's icon and the two badges, for any card that wants them; one
     that has not come in three seconds is left out rather than waited for */
  function storeMarks() {
    function one(src) {
      return Promise.race([loadImage(src), new Promise(function (r) { root.setTimeout(function () { r(null); }, 3000); })]);
    }
    return Promise.all([one(ICON), one(BADGES.apple.src), one(BADGES.google.src)])
      .then(function (got) { return { icon: got[0], apple: got[1], google: got[2] }; });
  }

  /* the app's icon with its rounded corners, as the overlay showed it */
  function drawIcon(ctx, img, x, y, size, shadow) {
    var r = size * 18 / 74;
    if (shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#000';
      roundRect(ctx, x, y, size, size, r); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    roundRect(ctx, x, y, size, size, r); ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
  }

  /* ---------------- making it ---------------- */

  /* o: { text, surah, number, by, voice, name, audioUrl, segments, types,
          host, monitor, keepCanvas, onStage(name), onProgress(seconds, total) }
     Returns { promise, cancel }. Call it inside the tap: the audio context is
     made and resumed before anything is awaited, which iOS requires. */
  function make(o) {
    var A = root.AudioContext || root.webkitAudioContext;
    var audio = A ? new A() : null;
    if (audio && audio.resume) { try { audio.resume(); } catch (e) { /* resumed later */ } }
    var state = { cancelled: false, finish: null, loop: null };
    var api = {
      cancel: function () {
        state.cancelled = true;
        if (state.finish) state.finish(true);
        /* stopped while the recitation still loads: the sea stops now */
        else if (state.loop) dropLoop(state.loop);
      }
    };
    api.promise = run(o, audio, state);
    return api;
  }

  function run(o, audio, state) {
    var stage = o.onStage || function () {};
    var type = pickType(o.types);
    if (!audio || !type) return Promise.reject(failure('unsupported'));
    var words = tokens(o.text);
    if (!words.length || wordCount(o.text) > MAX_WORDS) { audio.close(); return Promise.reject(failure('long')); }
    stage('loading');
    var face = "'Amiri Quran', 'Amiri', serif";
    var ui = "'IBM Plex Sans Arabic', sans-serif";
    var scene = o.scene || SCENE;
    /* the scene stands in the frame while the recitation loads */
    if (o.host && o.host.style) o.host.style.backgroundImage = 'url("' + scene.still + '")';
    var said = [o.text, o.surah, o.by, o.voice, o.name, o.number].join(' ');
    var loop = null;
    return Promise.all([
      fetchAudio(audio, o.audioUrl),
      loadImage(scene.still),
      loadLoop(scene, o.host).then(function (l) {
        if (l && state.cancelled) { dropLoop(l); return null; }
        loop = state.loop = l;
        return l;
      }),
      storeMarks(),
      fontsReady(['400 80px ' + face, '500 36px ' + ui, '400 31px ' + ui, '600 31px ' + ui, '600 34px ' + ui, '700 27px ' + ui], said),
      /* the word timings may be a promise, asked for while the file loads */
      Promise.resolve(o.segments).then(null, function () { return null; })
    ]).then(function (got) {
      if (state.cancelled) throw failure('cancelled');
      var buffer = got[0];
      if (!got[1]) throw failure('painting');
      if (buffer.duration > MAX_SECONDS) throw failure('long');
      return record(o, audio, state, type, buffer, got[1], loop, got[3], words, face, ui, got[5]);
    }).then(function (out) {
      try { audio.close(); } catch (e) { /* closed */ }
      return out;
    }, function (e) {
      try { audio.close(); } catch (x) { /* closed */ }
      if (loop) dropLoop(loop);
      throw e;
    });
  }

  function dropLoop(loop) {
    if (loop.dropped) return;
    loop.dropped = true;
    try { loop.video.pause(); } catch (e) { /* stopped */ }
    if (loop.video.parentNode) loop.video.parentNode.removeChild(loop.video);
    loop.video.removeAttribute('src');
    try { loop.video.load(); } catch (e) { /* gone */ }
    root.URL.revokeObjectURL(loop.src);
  }

  function record(o, audio, state, type, buffer, still, loop, marks, words, face, ui, segments) {
    var stage = o.onStage || function () {};
    var progress = o.onProgress || function () {};
    var probe = canvas(8, 8).getContext('2d');
    var groups = phrasesByMarks(words);
    var scene = o.scene || SCENE;
    var lay = arrange(probe, words, groups, face, scene.limit);
    var units = unitSpans(lay, litUnits(words, groups, lay));
    var verseTop = BOX.top - lay.lift;

    /* where each word stands on its line */
    var at = [];
    lay.lines.forEach(function (ln) {
      ln.ids.forEach(function (id, j) { at[id] = { x: ln.xr[j], base: ln.base }; });
    });
    var lastLine = lay.lines[lay.lines.length - 1];
    var lastAt = lastLine.ids.length - 1;
    var rosetteSize = lay.size * 1.25;
    var rx = lastLine.xr[lastAt] - lay.widths[lastLine.ids[lastAt]] - lay.size * 0.14 - rosetteSize / 2;
    var ry = lastLine.base - lay.size * 0.245;

    /* each unit on its own canvas, every word in cream with its shadows, and
       the rosette in gold after the last word, with the unit that holds it */
    var layers = units.map(function (u) {
      var c = canvas(W, u.bottom - u.top), uc = c.getContext('2d');
      uc.font = '400 ' + lay.size + 'px ' + face;
      uc.direction = 'rtl'; uc.textAlign = 'right'; uc.textBaseline = 'alphabetic';
      uc.fillStyle = CREAM;
      u.ids.forEach(function (id) {
        shaded(uc, function () { uc.fillText(words[id].t, at[id].x, at[id].base - u.top); });
      });
      if (o.number && u.ids.indexOf(words.length - 1) !== -1) rosette(uc, rx, ry - u.top, rosetteSize, String(o.number), ui);
      return c;
    });

    /* the surah in gold between two hairlines */
    var titleY = BOX.title - lay.lift;
    var title = canvas(W, 100), hc = title.getContext('2d');
    hc.font = '500 36px ' + ui;
    hc.direction = 'rtl'; hc.textAlign = 'center'; hc.textBaseline = 'alphabetic';
    var tw = hc.measureText(o.surah || '').width;
    hc.fillStyle = GOLD;
    shaded(hc, function () { hc.fillText(o.surah || '', W / 2, 50 + (UI_ASC - UI_DESC) * 18); });
    [-1, 1].forEach(function (side) {
      var inner = W / 2 + side * (tw / 2 + 26), outer = inner + side * 120;
      var grad = hc.createLinearGradient(outer, 0, inner, 0);
      grad.addColorStop(0, 'rgba(214, 178, 106, 0)');
      grad.addColorStop(1, 'rgba(214, 178, 106, 0.85)');
      hc.fillStyle = grad;
      roundRect(hc, Math.min(inner, outer), 49, 120, 2, 1);
      hc.fill();
    });

    /* بصوت and the reciter, under the verse */
    var recTop = verseTop + lay.h + BOX.gap;
    var rec = canvas(W, 80), rc = rec.getContext('2d');
    rc.direction = 'rtl'; rc.textAlign = 'right'; rc.textBaseline = 'alphabetic';
    rc.font = '400 31px ' + ui;
    var byW = rc.measureText((o.by || '') + ' ').width;
    rc.font = '600 31px ' + ui;
    var nameW = rc.measureText(o.voice || '').width;
    var recRight = W / 2 + (byW + nameW) / 2, recBase = 18 + 32;
    rc.font = '400 31px ' + ui; rc.fillStyle = 'rgba(246, 238, 221, 0.78)';
    shaded(rc, function () { rc.fillText(o.by || '', recRight, recBase); });
    rc.font = '600 31px ' + ui; rc.fillStyle = CREAM;
    shaded(rc, function () { rc.fillText(o.voice || '', recRight - byW, recBase); });

    /* the app over the water: its icon and name, and under them the two
       badges, all on a quiet darkening so the mosque's light on the sea does
       not run through them */
    var centre = scene.foot || FOOT.centre;
    var footTop = centre - (FOOT.icon + FOOT.gap + FOOT.badge) / 2;
    var shade = canvas(W, 360), sc = shade.getContext('2d');
    sc.save();
    sc.translate(W / 2, 180); sc.scale(1, 160 / 330);
    var glow = sc.createRadialGradient(0, 0, 0, 0, 0, 330);
    glow.addColorStop(0, 'rgba(5, 10, 30, 0.66)');
    glow.addColorStop(0.55, 'rgba(5, 10, 30, 0.4)');
    glow.addColorStop(1, 'rgba(5, 10, 30, 0)');
    sc.fillStyle = glow;
    sc.beginPath(); sc.arc(0, 0, 330, 0, Math.PI * 2); sc.fill();
    sc.restore();

    var brand = canvas(W, 140), bc = brand.getContext('2d');
    bc.direction = 'rtl'; bc.textAlign = 'right'; bc.textBaseline = 'alphabetic';
    bc.font = '600 34px ' + ui;
    var appW = bc.measureText(o.name || '').width;
    var groupW = (marks.icon ? FOOT.icon + 18 : 0) + appW;
    var iconX = W / 2 + groupW / 2 - FOOT.icon;
    if (marks.icon) drawIcon(bc, marks.icon, iconX, 30, FOOT.icon, true);
    bc.fillStyle = CREAM;
    shaded(bc, function () {
      bc.fillText(o.name || '', marks.icon ? iconX - 18 : W / 2 + appW / 2, 30 + FOOT.icon / 2 + (UI_ASC - UI_DESC) * 17);
    });

    var badgeTop = footTop + FOOT.icon + FOOT.gap;
    var badges = canvas(W, 140), gc = badges.getContext('2d');
    drawBadges(gc, W / 2, 30, FOOT.badge, marks);

    /* The sea laid into the still: the strip drawn straight from the loop
       between its faded edges, and each edge faded into the still on a
       canvas of its own, the top always and the foot where the strip ends
       above the frame's. destination-in keeps only what its fill covers, so
       the fill is the band itself, clear at the still's side. */
    var strip = stripOf(scene);
    var band = canvas(W, Math.max(1, strip.fade)), bandCtx = band.getContext('2d');
    function fadeOf(from, to) {
      var g = bandCtx.createLinearGradient(0, 0, 0, Math.max(1, strip.fade));
      g.addColorStop(0, 'rgba(0, 0, 0, ' + from + ')');
      g.addColorStop(1, 'rgba(0, 0, 0, ' + to + ')');
      return g;
    }
    var fadeIn = fadeOf(0, 1), fadeOut = fadeOf(1, 0);
    function blend(v, vw, k, from, rows, at, fade) {
      bandCtx.globalCompositeOperation = 'source-over';
      bandCtx.clearRect(0, 0, W, rows);
      bandCtx.drawImage(v, 0, from * k, vw, rows * k, 0, 0, W, rows);
      bandCtx.globalCompositeOperation = 'destination-in';
      bandCtx.fillStyle = fade;
      bandCtx.fillRect(0, 0, W, rows);
      ctx.drawImage(band, 0, 0, W, rows, 0, at, W, rows);
    }

    var timing = segmentTiming(segments, words, units) || pauseTiming(buffer, units);
    var dur = buffer.duration, total = LEAD + dur + TAIL;
    var end = timing ? timing.end : dur;
    var events = lightEvents(timing, units, dur);

    var out = canvas(W, H), ctx = out.getContext('2d');
    if (o.host) { out.className = 'video-canvas'; o.host.appendChild(out); }

    /* the first event lights the first phrase as the reciter begins */
    var first = events.length ? events[0] : null;

    function draw(t) {
      ctx.globalAlpha = 1;
      ctx.drawImage(still, 0, 0, W, H);
      if (loop && loop.video.readyState >= 2) {
        var v = loop.video, vw = v.videoWidth || W, k = (v.videoHeight || strip.tall) / strip.tall;
        var mid = strip.tall - strip.fade - strip.low;
        if (mid > 0) ctx.drawImage(v, 0, strip.fade * k, vw, mid * k, 0, scene.sea + strip.fade, W, mid);
        if (strip.fade) blend(v, vw, k, 0, strip.fade, scene.sea, fadeIn);
        if (strip.low) blend(v, vw, k, strip.tall - strip.low, strip.low, scene.sea + strip.tall - strip.low, fadeOut);
      }
      ctx.drawImage(shade, 0, centre - 180);
      ctx.drawImage(title, 0, titleY - 50);
      var on = lights(events, units.length, t - LEAD, end);
      /* Before the voice the whole verse stands lit, so the first frame reads
         in full, and as the reciter begins the light gathers onto the first
         phrase, which stays lit throughout and never dips. */
      if (first) {
        var x = t - LEAD + 0.5;
        var whole = Math.max(0, Math.min(1, (first.t - x) / 0.55));
        if (whole > 0) for (var i = 0; i < on.length; i++) on[i] = Math.max(on[i], whole);
        if (x < first.t + 0.55) on[first.unit] = 1;
      }
      units.forEach(function (u, k) {
        ctx.globalAlpha = DIM + (1 - DIM) * on[k];
        ctx.drawImage(layers[k], 0, verseTop + u.top);
      });
      ctx.globalAlpha = 1;
      ctx.drawImage(rec, 0, recTop - 18);
      ctx.drawImage(brand, 0, footTop - 30);
      /* the badges are never faded or moved: they stand as published */
      ctx.drawImage(badges, 0, badgeTop - 30);
    }

    draw(0);
    var track = out.captureStream(FPS).getVideoTracks()[0];
    var dest = audio.createMediaStreamDestination();
    var stream = new root.MediaStream([track].concat(dest.stream.getAudioTracks()));
    var recorder;
    try {
      recorder = new root.MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
    } catch (e) {
      track.stop();
      if (out.parentNode) out.parentNode.removeChild(out);
      if (loop) dropLoop(loop);
      throw failure('unsupported');
    }
    var source = audio.createBufferSource();
    source.buffer = buffer;
    var gain = audio.createGain();
    /* a decibel under, as the approved sample was mixed */
    gain.gain.value = 0.89;
    source.connect(gain);
    gain.connect(dest);
    if (o.monitor !== false) gain.connect(audio.destination);

    return new Promise(function (resolve, reject) {
      var chunks = [], ended = false, discard = false, raf = 0, lastDraw = -1, lastTold = -1, t0 = 0;
      var wall = Date.now(), stalled = false;
      var tick = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : function (f) { return root.setTimeout(f, 1000 / FPS); };
      var untick = root.cancelAnimationFrame ? root.cancelAnimationFrame.bind(root) : root.clearTimeout.bind(root);

      function cleanup() {
        if (raf) untick(raf);
        try { source.stop(); } catch (e) { /* never started */ }
        try { source.disconnect(); gain.disconnect(); } catch (e) { /* gone */ }
        stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) { /* stopped */ } });
        if (loop) dropLoop(loop);
        if (out.parentNode && o.keepCanvas !== true) out.parentNode.removeChild(out);
        [title, rec, shade, brand, badges, band].concat(layers).forEach(function (c) { c.width = 0; c.height = 0; });
      }

      state.finish = function (cancel) {
        if (ended) return;
        ended = true;
        discard = !!cancel;
        stage(discard ? 'cancelled' : 'finishing');
        try { if (recorder.state !== 'inactive') recorder.stop(); else recorder.onstop(); } catch (e) { recorder.onstop(); }
      };

      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = function () { if (!ended) { ended = true; cleanup(); reject(failure('recorder')); } };
      recorder.onstop = function () {
        cleanup();
        if (discard) { reject(failure(stalled ? 'stalled' : 'cancelled')); return; }
        var blob = new root.Blob(chunks, { type: (recorder.mimeType || type).split(';')[0] });
        if (!blob.size) { reject(failure('empty')); return; }
        resolve({ blob: blob, type: recorder.mimeType || type, seconds: total });
      };

      function frame() {
        raf = 0;
        if (ended) return;
        /* a hidden page draws nothing, and a call takes the audio away: either
           would leave a video whose picture and voice have parted */
        if (state.cancelled || root.document.hidden || audio.state === 'interrupted' || audio.state === 'closed') { state.finish(true); return; }
        if (audio.state === 'suspended') { try { audio.resume(); } catch (e) { /* asked again next frame */ } }
        var t = audio.currentTime - t0;
        /* an audio clock that never starts means the context was not let
           start, which is what iOS does to one made outside a tap */
        if (t < 0.05 && Date.now() - wall > 4000) { stalled = true; state.finish(true); return; }
        if (t - lastDraw >= 1 / FPS - 0.004) { draw(Math.max(0, t)); lastDraw = t; }
        if (t - lastTold >= 0.25) { lastTold = t; progress(Math.max(0, Math.min(t, total)), total); }
        if (t >= total) { state.finish(false); return; }
        raf = tick(frame);
      }

      recorder.start(1000);
      /* a moment for the recorder to take its first frame, then the voice
         after the lead; the drawing follows the audio clock throughout */
      t0 = audio.currentTime + 0.1;
      source.start(t0 + LEAD);
      stage('recording');
      raf = tick(frame);
    });
  }

  /* ---------------- handing it over ---------------- */

  /* A bridge call carries one string, and one string of a whole video is
     tens of megabytes, so the file goes over in pieces of 384 KiB: a
     multiple of three bytes, so each piece is whole base64 on its own. */
  var PIECE = 393216;

  function base64Of(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new root.FileReader();
      reader.onload = function () {
        var url = String(reader.result);
        resolve(url.slice(url.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || failure('read')); };
      reader.readAsDataURL(blob);
    });
  }

  /* app: the wrapper's bridge, with videoBegin, videoChunk, videoShare and
     videoAbort. Android answers each call with a boolean; the iPhone's
     bridge posts a message and answers true, so only false means refused. */
  function handOver(app, blob, name, words) {
    var at = 0;
    try { if (app.videoBegin(name) === false) return Promise.resolve(false); } catch (e) { return Promise.resolve(false); }
    function next() {
      if (at >= blob.size) return app.videoShare(words || '') !== false;
      var piece = blob.slice(at, at + PIECE);
      at += PIECE;
      return base64Of(piece).then(function (b64) {
        if (app.videoChunk(b64) === false) throw failure('chunk');
        return next();
      });
    }
    return Promise.resolve().then(next).catch(function () {
      try { app.videoAbort(); } catch (e) { /* older package */ }
      return false;
    });
  }

  root.VerseVideo = {
    W: W, H: H, FPS: FPS, LEAD: LEAD, TAIL: TAIL, DIM: DIM, MAX_WORDS: MAX_WORDS, MAX_SECONDS: MAX_SECONDS,
    TYPES: TYPES, PIECE: PIECE, SCENE: SCENE, SCENES: SCENES, BADGES: BADGES, AUDIO: AUDIO, TIMED: TIMED,
    sceneFor: sceneFor, stripOf: stripOf,
    hasVoice: hasVoice, audioUrl: audioUrl, timings: timings,
    pickType: pickType, supported: supported, tokens: tokens, wordCount: wordCount, phrasesByMarks: phrasesByMarks,
    balanced: balanced, arrange: arrange, litUnits: litUnits, unitSpans: unitSpans,
    pauseTiming: pauseTiming, segmentTiming: segmentTiming, lightEvents: lightEvents, lights: lights,
    storeMarks: storeMarks, drawBadges: drawBadges, drawIcon: drawIcon,
    make: make, handOver: handOver
  };
})(window);
