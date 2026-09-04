/* Sunnati prayer engine
   Solar geometry based prayer time calculation that runs entirely on the device.
   No network call, no API key, works offline and in the past or the future. */
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;
  function sin(d) { return Math.sin(d * DEG); }
  function cos(d) { return Math.cos(d * DEG); }
  function tan(d) { return Math.tan(d * DEG); }
  function arcsin(x) { return Math.asin(x) / DEG; }
  function arccos(x) { return Math.acos(x) / DEG; }
  function arctan2(y, x) { return Math.atan2(y, x) / DEG; }
  function arccot(x) { return Math.atan2(1, x) / DEG; }
  function fixAngle(a) { return fix(a, 360); }
  function fixHour(a) { return fix(a, 24); }
  function fix(a, b) { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; }

  /* Calculation methods. fajr and isha are solar depression angles in degrees.
     ishaMin means isha is a fixed number of minutes after maghrib instead of an angle. */
  var METHODS = {
    MWL: { id: 3, name: 'رابطة العالم الإسلامي', fajr: 18, isha: 17 },
    ISNA: { id: 2, name: 'الجمعية الإسلامية لأمريكا الشمالية', fajr: 15, isha: 15 },
    Egypt: { id: 5, name: 'الهيئة المصرية العامة للمساحة', fajr: 19.5, isha: 17.5 },
    Makkah: { id: 4, name: 'أم القرى مكة المكرمة', fajr: 18.5, ishaMin: 90 },
    Karachi: { id: 1, name: 'جامعة العلوم الإسلامية كراتشي', fajr: 18, isha: 18 },
    Tehran: { id: 7, name: 'معهد الجيوفيزياء بجامعة طهران', fajr: 17.7, isha: 14, maghrib: 4.5 },
    Jafari: { id: 0, name: 'الشيعة الاثنا عشرية', fajr: 16, isha: 14, maghrib: 4 },
    Kuwait: { id: 9, name: 'وزارة الأوقاف الكويتية', fajr: 18, isha: 17.5 },
    Qatar: { id: 10, name: 'وزارة الأوقاف القطرية', fajr: 18, ishaMin: 90 },
    Singapore: { id: 11, name: 'المجلس الإسلامي بسنغافورة', fajr: 20, isha: 18 },
    Turkey: { id: 13, name: 'رئاسة الشؤون الدينية التركية', fajr: 18, isha: 17,
      offsets: { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7 } },
    Dubai: { id: 16, name: 'هيئة الشؤون الإسلامية بدبي', fajr: 18.2, isha: 18.2,
      offsets: { dhuhr: 3, maghrib: 3 } },
    Morocco: { id: 21, name: 'وزارة الأوقاف المغربية', fajr: 19, isha: 17,
      offsets: { dhuhr: 5, maghrib: 5 } },
    France: { id: 12, name: 'الاتحاد الإسلامي الفرنسي', fajr: 12, isha: 12 },
    Russia: { id: 14, name: 'الإدارة الروحية لمسلمي روسيا', fajr: 16, isha: 15 }
  };

  /* Julian day at 00:00 UT of the given civil date. */
  function julian(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
  }

  /* Apparent solar declination and equation of time for a Julian day. */
  function sunPosition(jd) {
    var d = jd - 2451545.0;
    var g = fixAngle(357.529 + 0.98560028 * d);
    var q = fixAngle(280.459 + 0.98564736 * d);
    var l = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
    var e = 23.439 - 0.00000036 * d;
    var ra = fixHour(arctan2(cos(e) * sin(l), cos(l)) / 15);
    return { declination: arcsin(sin(e) * sin(l)), equation: q / 15 - ra };
  }

  function Calculator(opts) {
    this.lat = opts.lat;
    this.lng = opts.lng;
    this.method = METHODS[opts.method] ? opts.method : 'MWL';
    this.asrFactor = opts.asr === 'hanafi' ? 2 : 1;
    this.highLat = opts.highLat || 'angleBased';
    /* A method may publish its own minute adjustments, and a caller may add
       more on top, so the two are merged rather than one replacing the other. */
    var base = (METHODS[this.method] && METHODS[this.method].offsets) || {};
    this.offsets = {};
    for (var b in base) this.offsets[b] = base[b];
    var extra = opts.offsets || {};
    for (var e in extra) this.offsets[e] = (this.offsets[e] || 0) + extra[e];
    this.elevation = opts.elevation || 0;
  }

  Calculator.prototype.params = function () {
    var p = METHODS[this.method];
    return { fajr: p.fajr, isha: p.isha, ishaMin: p.ishaMin, maghrib: p.maghrib };
  };

  Calculator.prototype.midDay = function (jd, t) {
    var eqt = sunPosition(jd + t).equation;
    return fixHour(12 - eqt);
  };

  Calculator.prototype.sunAngleTime = function (jd, angle, t, ccw) {
    var decl = sunPosition(jd + t).declination;
    var noon = this.midDay(jd, t);
    var x = (-sin(angle) - sin(decl) * sin(this.lat)) / (cos(decl) * cos(this.lat));
    if (x > 1 || x < -1) return NaN;
    var v = arccos(x) / 15;
    return noon + (ccw ? -v : v);
  };

  Calculator.prototype.asrAngleTime = function (jd, t) {
    var decl = sunPosition(jd + t).declination;
    var angle = -arccot(this.asrFactor + tan(Math.abs(this.lat - decl)));
    return this.sunAngleTime(jd, angle, t, false);
  };

  /* Horizon dip for observer elevation, in degrees. */
  Calculator.prototype.riseSetAngle = function () {
    return 0.833 + 0.0347 * Math.sqrt(Math.max(0, this.elevation));
  };

  Calculator.prototype.computePortions = function (jd) {
    var p = this.params();
    var t = { fajr: 5 / 24, sunrise: 6 / 24, dhuhr: 12 / 24, asr: 13 / 24, sunset: 18 / 24, isha: 18 / 24 };
    var out = {};
    for (var pass = 0; pass < 3; pass++) {
      out.fajr = this.sunAngleTime(jd, p.fajr, t.fajr, true);
      out.sunrise = this.sunAngleTime(jd, this.riseSetAngle(), t.sunrise, true);
      out.dhuhr = this.midDay(jd, t.dhuhr);
      out.asr = this.asrAngleTime(jd, t.asr);
      out.sunset = this.sunAngleTime(jd, this.riseSetAngle(), t.sunset, false);
      out.maghrib = p.maghrib ? this.sunAngleTime(jd, p.maghrib, t.sunset, false) : out.sunset;
      out.isha = p.ishaMin ? out.maghrib + p.ishaMin / 60 : this.sunAngleTime(jd, p.isha, t.isha, false);
      for (var k in out) { if (!isNaN(out[k])) t[k] = out[k] / 24; }
    }
    return out;
  };

  /* Share of the night granted to fajr or isha when the sun stays too high. */
  Calculator.prototype.nightPortion = function (angle, night) {
    var frac = 1 / 2;
    if (this.highLat === 'angleBased') frac = angle / 60;
    else if (this.highLat === 'oneSeventh') frac = 1 / 7;
    return frac * night;
  };

  /* Pulls a time back toward its base when the sun never reaches the required
     depression, or when the gap grows past the allotted portion of the night. */
  Calculator.prototype.clampToNight = function (time, base, angle, night, ccw) {
    var portion = this.nightPortion(angle, night);
    var gap = ccw ? fixHour(base - time) : fixHour(time - base);
    if (isNaN(time) || gap > portion) return base + (ccw ? -portion : portion);
    return time;
  };

  Calculator.prototype.adjustHighLat = function (times) {
    if (this.highLat === 'none') return times;
    var p = this.params();
    var night = fixHour(times.sunrise - times.sunset);
    times.fajr = this.clampToNight(times.fajr, times.sunrise, p.fajr, night, true);
    var ishaAngle = typeof p.ishaMin === 'number' ? p.ishaMin : p.isha;
    times.isha = this.clampToNight(times.isha, times.sunset, ishaAngle, night, false);
    if (typeof p.maghrib === 'number') {
      times.maghrib = this.clampToNight(times.maghrib, times.sunset, p.maghrib, night, false);
    }
    return times;
  };

  /* Returns prayer times as minutes after local midnight for the given Date. */
  Calculator.prototype.timesFor = function (date, tzOffsetHours) {
    var jd = julian(date.getFullYear(), date.getMonth() + 1, date.getDate()) - this.lng / (15 * 24);
    var tz = typeof tzOffsetHours === 'number' ? tzOffsetHours : -date.getTimezoneOffset() / 60;
    var raw = this.adjustHighLat(this.computePortions(jd));
    var shift = tz - this.lng / 15;
    var out = {};
    var keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'sunset', 'maghrib', 'isha'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = raw[k];
      if (isNaN(v)) { out[k] = NaN; continue; }
      out[k] = v + shift + (this.offsets[k] || 0) / 60;
    }
    out.imsak = out.fajr - 10 / 60;
    out.midnight = out.sunset + (24 - (out.sunset - out.fajr)) / 2;
    var mins = {};
    for (var key in out) mins[key] = isNaN(out[key]) ? NaN : Math.round(fixHour(out[key]) * 60);
    return mins;
  };

  /* A clock face in the gulf is read on twelve hours with صباحاً or مساءً, so
     that is how a prayer time is written. The twenty four hour form stays
     available for anything that needs to sort or compare. */
  function format(minutes, style) {
    if (isNaN(minutes)) return style === 'plain' ? '--:--' : '--:-- ص';
    var m = Math.round(minutes) % 1440;
    if (m < 0) m += 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    if (style === 'plain') return two(h) + ':' + two(mm);
    var suffix = h < 12 ? 'ص' : 'م';
    var twelve = h % 12;
    if (twelve === 0) twelve = 12;
    return twelve + ':' + two(mm) + ' ' + suffix;
  }

  /* Great circle bearing from a point to the Kaaba, in degrees clockwise from true north. */
  function qibla(lat, lng) {
    var kLat = 21.4224779, kLng = 39.8251832;
    var dl = (kLng - lng) * DEG;
    var y = Math.sin(dl);
    var x = Math.cos(lat * DEG) * Math.tan(kLat * DEG) - Math.sin(lat * DEG) * Math.cos(dl);
    return fixAngle(Math.atan2(y, x) / DEG);
  }

  /* Great circle distance to the Kaaba in kilometres. */
  /* Great circle distance between any two points, in kilometres. */
  function between(lat1, lng1, lat2, lng2) {
    var r = 6371;
    var dLat = (lat2 - lat1) * DEG, dLng = (lng2 - lng1) * DEG;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function distanceToKaaba(lat, lng) {
    var kLat = 21.4224779, kLng = 39.8251832, r = 6371;
    var dLat = (kLat - lat) * DEG, dLng = (kLng - lng) * DEG;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat * DEG) * Math.cos(kLat * DEG) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /* The offset a zone is actually on for a given date. A stored number cannot
     be right all year in any country that moves its clocks, so the zone name
     is asked afresh every time the times are worked out. */
  function zoneOffset(zone, date) {
    if (!zone || typeof Intl === 'undefined' || !Intl.DateTimeFormat) return null;
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, timeZoneName: 'longOffset'
      }).formatToParts(date || new Date());
      var name = '';
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') name = parts[i].value;
      if (name === 'GMT') return 0;
      var m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
      if (!m) return null;
      return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60);
    } catch (e) {
      return null;
    }
  }

  var api = {
    METHODS: METHODS,
    Calculator: Calculator,
    zoneOffset: zoneOffset,
    format: format,
    qibla: qibla,
    distanceToKaaba: distanceToKaaba,
    between: between,
    julian: julian,
    sunPosition: sunPosition
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PrayerEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
