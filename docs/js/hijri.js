/* Sunnati hijri module
   Umm al Qura dates straight from the platform calendar, with an arithmetic
   fallback, plus detection of the days the sunnah singles out. */
(function (root) {
  'use strict';

  var MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
    'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
  var WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

  function toArabicDigits(value) {
    return String(value).replace(/[0-9]/g, function (d) { return DIGITS[+d]; });
  }

  var formatter = null;
  var formatterReady = false;

  function getFormatter() {
    if (formatterReady) return formatter;
    formatterReady = true;
    try {
      var f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
        day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC'
      });
      var parts = f.formatToParts(new Date(Date.UTC(2026, 8, 4)));
      var seen = {};
      for (var i = 0; i < parts.length; i++) seen[parts[i].type] = parts[i].value;
      if (seen.year && seen.month && seen.day) formatter = f;
    } catch (e) { formatter = null; }
    return formatter;
  }

  /* Arithmetic Islamic calendar, used only when the platform has no Umm al Qura data. */
  function fallbackConvert(date) {
    var jd = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000) + 2440588;
    var l = jd - 1948440 + 10632;
    var n = Math.floor((l - 1) / 10631);
    l = l - 10631 * n + 354;
    var j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) +
      Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
    l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
      Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    var m = Math.floor((24 * l) / 709);
    var d = l - Math.floor((709 * m) / 24);
    var y = 30 * n + j - 30;
    return { y: y, m: m, d: d };
  }

  /* Converts a civil date to Umm al Qura. adjust shifts the result by whole days,
     which lets a user match a local moon sighting announcement. */
  function toHijri(date, adjust) {
    var shifted = new Date(date.getTime());
    if (adjust) shifted.setDate(shifted.getDate() + adjust);
    var utc = new Date(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()));
    var f = getFormatter();
    var out;
    if (f) {
      var parts = f.formatToParts(utc);
      var got = {};
      for (var i = 0; i < parts.length; i++) got[parts[i].type] = parts[i].value;
      out = { y: parseInt(got.year, 10), m: parseInt(got.month, 10), d: parseInt(got.day, 10) };
    } else {
      out = fallbackConvert(shifted);
    }
    out.monthName = MONTHS[out.m - 1] || '';
    out.weekday = WEEKDAYS[shifted.getDay()];
    out.weekdayIndex = shifted.getDay();
    return out;
  }

  function format(h) {
    return toArabicDigits(h.d) + ' ' + h.monthName + ' ' + toArabicDigits(h.y) + ' هـ';
  }

  /* Walks forward from an estimate to find the civil date of a hijri day. */
  function toGregorian(hy, hm, hd, adjust) {
    var estimate = new Date(Date.UTC(622, 6, 16));
    var days = Math.floor((hy - 1) * 354.367 + (hm - 1) * 29.53 + hd);
    estimate.setUTCDate(estimate.getUTCDate() + days);
    var guess = new Date(estimate.getUTCFullYear(), estimate.getUTCMonth(), estimate.getUTCDate());
    for (var step = 0; step < 90; step++) {
      var h = toHijri(guess, adjust);
      var diff = (h.y - hy) * 354 + (h.m - hm) * 29.5 + (h.d - hd);
      if (h.y === hy && h.m === hm && h.d === hd) return guess;
      guess.setDate(guess.getDate() - Math.max(1, Math.min(60, Math.round(Math.abs(diff)))) * (diff > 0 ? 1 : -1));
    }
    return null;
  }

  function daysBetween(from, to) {
    var a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    var b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
  }

  /* Everything the sunnah marks out about a given day. */
  function occasions(date, adjust) {
    var h = toHijri(date, adjust);
    var list = [];
    var day = date.getDay();

    if (day === 5) list.push({ key: 'jumuah', name: 'يوم الجمعة', note: 'أكثر من الصلاة على النبي ﷺ وقراءة سورة الكهف', kind: 'weekly' });
    if (day === 1 || day === 4) list.push({ key: 'mondayThursday', name: day === 1 ? 'صيام الإثنين' : 'صيام الخميس', note: 'كان النبي ﷺ يتحرى صيام الإثنين والخميس', kind: 'fast' });
    if (h.d === 13 || h.d === 14 || h.d === 15) list.push({ key: 'white', name: 'الأيام البيض', note: 'صيام ثلاثة أيام من كل شهر يعدل صيام الدهر', kind: 'fast' });

    if (h.m === 1 && h.d === 9) list.push({ key: 'tasua', name: 'يوم تاسوعاء', note: 'يستحب صيامه مع عاشوراء مخالفة لأهل الكتاب', kind: 'fast' });
    if (h.m === 1 && h.d === 10) list.push({ key: 'ashura', name: 'يوم عاشوراء', note: 'صيامه يكفر السنة الماضية', kind: 'fast' });
    if (h.m === 8 && h.d === 15) list.push({ key: 'shaban', name: 'منتصف شعبان', note: 'كان النبي ﷺ يكثر الصيام في شعبان', kind: 'fast' });
    if (h.m === 9) list.push({ key: 'ramadan', name: 'رمضان', note: 'شهر الصيام والقيام ونزول القرآن', kind: 'month' });
    if (h.m === 9 && h.d >= 21 && h.d % 2 === 1) list.push({ key: 'laylatQadr', name: 'ليلة وترية في العشر الأواخر', note: 'تحرّوا ليلة القدر في الوتر من العشر الأواخر', kind: 'night' });
    if (h.m === 10 && h.d === 1) list.push({ key: 'eidFitr', name: 'عيد الفطر', note: 'يحرم صيامه وتسن صلاة العيد', kind: 'eid' });
    if (h.m === 10 && h.d >= 2 && h.d <= 8) list.push({ key: 'sixShawwal', name: 'ست من شوال', note: 'من صامها بعد رمضان فكأنما صام الدهر', kind: 'fast' });
    if (h.m === 12 && h.d <= 9) list.push({ key: 'tenDhulHijjah', name: 'العشر من ذي الحجة', note: 'ما من أيام العمل الصالح فيهن أحب إلى الله من هذه الأيام', kind: 'season' });
    if (h.m === 12 && h.d === 9) list.push({ key: 'arafah', name: 'يوم عرفة', note: 'صيامه يكفر سنتين ماضية وباقية لغير الحاج', kind: 'fast' });
    if (h.m === 12 && h.d === 10) list.push({ key: 'eidAdha', name: 'عيد الأضحى', note: 'يوم النحر وأعظم أيام الحج', kind: 'eid' });
    if (h.m === 12 && h.d >= 11 && h.d <= 13) list.push({ key: 'tashreeq', name: 'أيام التشريق', note: 'أيام أكل وشرب وذكر لله عز وجل', kind: 'eid' });

    return list;
  }

  /* Countdown to the next occurrence of the fixed points of the hijri year. */
  function upcoming(date, adjust) {
    var h = toHijri(date, adjust);
    var targets = [
      { name: 'رمضان', m: 9, d: 1, icon: '🌙' },
      { name: 'عيد الفطر', m: 10, d: 1, icon: '🎉' },
      { name: 'يوم عرفة', m: 12, d: 9, icon: '🕋' },
      { name: 'عيد الأضحى', m: 12, d: 10, icon: '🐑' },
      { name: 'عاشوراء', m: 1, d: 10, icon: '🤲' }
    ];
    var out = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var year = h.y;
      if (t.m < h.m || (t.m === h.m && t.d < h.d)) year = h.y + 1;
      var g = toGregorian(year, t.m, t.d, adjust);
      if (!g) continue;
      var days = daysBetween(date, g);
      if (days < 0) continue;
      out.push({ name: t.name, icon: t.icon, days: days, date: g, hijriYear: year });
    }
    out.sort(function (a, b) { return a.days - b.days; });
    return out;
  }

  var api = {
    MONTHS: MONTHS,
    WEEKDAYS: WEEKDAYS,
    toArabicDigits: toArabicDigits,
    toHijri: toHijri,
    toGregorian: toGregorian,
    format: format,
    occasions: occasions,
    upcoming: upcoming,
    daysBetween: daysBetween,
    hasPlatformCalendar: function () { return !!getFormatter(); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Hijri = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
