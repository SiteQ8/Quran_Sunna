package com.eworldq8.sunnati;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Arms one exact alarm for the next prayer. The times come from the page,
 * which computes them for whatever place and method the reader chose, and
 * hands the days ahead over the bridge; when the page has not spoken yet, or
 * the handed days have run out, the times of الكويت are computed here from
 * the Ojeiri table and the formula. When the alarm rings, the receiver shows
 * the notification and arms the one after, so there is never more than one
 * pending, and a reboot or a change of the clock arms it again.
 */
public final class AdhanScheduler {

    public static final String PREFS = "sunnati";
    public static final String KEY_ENABLED = "adhan_enabled";
    public static final String KEY_TIMES = "adhan_times";
    public static final String EXTRA_NAME = "name";
    /* the notification's words in the reader's language, as the page wrote
       them; a list from an older page has none and the Arabic is used */
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    static final String[] KEYS = { "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha" };
    static final String[] NAMES = { "الفجر", "الشروق", "الظهر", "العصر", "المغرب", "العشاء" };
    static final String FRIDAY = "الجمعة";
    /* the sunrise is a time, not a prayer, so it does not ring */
    static final boolean[] RINGS = { true, false, true, true, true, true };
    private static final int REQUEST = 4148;

    private AdhanScheduler() { }

    public static boolean enabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, true);
    }

    public static void setEnabled(Context context, boolean on) {
        prefs(context).edit().putBoolean(KEY_ENABLED, on).apply();
        if (on) scheduleNext(context); else cancel(context);
    }

    /** The page's times: a json array of objects with at (epoch millis) and name. */
    public static void setTimes(Context context, String json) {
        try {
            JSONArray list = new JSONArray(json);
            prefs(context).edit().putString(KEY_TIMES, list.toString()).apply();
            scheduleNext(context);
            /* and the next prayer on the lock screen, for whoever asked for it */
            try { NextNotice.show(context); } catch (Exception ignored) { }
            /* the home screen widget reads the same list */
            PrayerWidget.refresh(context);
        } catch (Exception ignored) {
            /* a malformed list changes nothing; the built in times still ring */
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The next prayer after now: epoch millis, its name, and the page's
     *  title and body for its notification (null when it gave none). */
    public static Object[] next(Context context, long nowMillis) {
        /* first the page's list, if it reaches past now */
        try {
            String stored = prefs(context).getString(KEY_TIMES, null);
            if (stored != null) {
                JSONArray list = new JSONArray(stored);
                long best = Long.MAX_VALUE; String name = null; String title = null; String body = null;
                for (int i = 0; i < list.length(); i++) {
                    JSONObject o = list.getJSONObject(i);
                    long at = o.getLong("at");
                    if (at > nowMillis && at < best) {
                        best = at;
                        name = o.optString("name", "الصلاة");
                        title = o.optString("title", "");
                        body = o.optString("body", "");
                    }
                }
                if (name != null) return new Object[] { best, name, title.isEmpty() ? null : title, body.isEmpty() ? null : body };
                /* The handed days have run out, a week after the app was last
                   opened. The times of الكويت go on only for a reader whose
                   handed times were الكويت's: anyone else would be called to
                   prayer at another country's hours, so nothing rings until
                   the app is opened and hands the days ahead. */
                if (list.length() > 0 && !kuwaiti(context, list.getJSONObject(list.length() - 1))) return null;
            }
        } catch (Exception ignored) { /* fall through to the built in times */ }
        return builtIn(context, nowMillis);
    }

    /** Whether a handed prayer falls within a few minutes of الكويت's own
     *  time for it, by the table and the formula. */
    static boolean kuwaiti(Context context, JSONObject o) {
        int index = -1;
        String key = o.optString("key", "");
        for (int i = 0; i < KEYS.length; i++) if (KEYS[i].equals(key)) index = i;
        long at = o.optLong("at", 0);
        if (index < 0 || at <= 0) return false;
        TimeZone zone = TimeZone.getTimeZone("Asia/Kuwait");
        Calendar day = Calendar.getInstance(zone);
        day.setTimeInMillis(at);
        int[] times = PrayerTimes.forDate(day.get(Calendar.YEAR), day.get(Calendar.MONTH) + 1,
            day.get(Calendar.DAY_OF_MONTH), new OjeiriTable(context));
        if (times == null || index >= times.length) return false;
        int minute = day.get(Calendar.HOUR_OF_DAY) * 60 + day.get(Calendar.MINUTE);
        return Math.abs(minute - times[index]) <= 5;
    }

    /** الكويت from the table and the formula, when nothing else is known. */
    static Object[] builtIn(Context context, long nowMillis) {
        TimeZone zone = TimeZone.getTimeZone("Asia/Kuwait");
        OjeiriTable table = new OjeiriTable(context);
        Calendar day = Calendar.getInstance(zone);
        day.setTimeInMillis(nowMillis);
        for (int ahead = 0; ahead < 2; ahead++) {
            int y = day.get(Calendar.YEAR), m = day.get(Calendar.MONTH) + 1, d = day.get(Calendar.DAY_OF_MONTH);
            int[] times = PrayerTimes.forDate(y, m, d, table);
            for (int i = 0; i < times.length; i++) {
                if (!RINGS[i]) continue;
                Calendar at = Calendar.getInstance(zone);
                at.set(y, m - 1, d, 0, 0, 0);
                at.set(Calendar.MILLISECOND, 0);
                at.add(Calendar.MINUTE, times[i]);
                /* the noon prayer of a Friday is الجمعة, as the page names it,
                   in the notice and on the widget alike */
                String name = i == 2 && at.get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY ? FRIDAY : NAMES[i];
                if (at.getTimeInMillis() > nowMillis) return new Object[] { at.getTimeInMillis(), name, null, null };
            }
            day.add(Calendar.DATE, 1);
        }
        return null;
    }

    public static void scheduleNext(Context context) {
        if (!enabled(context)) return;
        Object[] next = next(context, System.currentTimeMillis());
        if (next == null) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = pending(context, (String) next[1], (String) next[2], (String) next[3]);
        long at = (Long) next[0];
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }

    public static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pending(context, "", null, null));
    }

    private static PendingIntent pending(Context context, String name, String title, String body) {
        Intent intent = new Intent(context, AdhanReceiver.class);
        intent.setAction("com.eworldq8.sunnati.ADHAN");
        intent.putExtra(EXTRA_NAME, name);
        if (title != null) intent.putExtra(EXTRA_TITLE, title);
        if (body != null) intent.putExtra(EXTRA_BODY, body);
        /* one request code, so a new alarm replaces the old rather than joining it */
        return PendingIntent.getBroadcast(context, REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
