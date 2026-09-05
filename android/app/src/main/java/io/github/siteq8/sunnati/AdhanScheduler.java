package io.github.siteq8.sunnati;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Arms one exact alarm for the next prayer of الكويت. When it rings, the
 * receiver shows the notification and arms the one after, so there is never
 * more than one alarm pending, and a reboot or a change of the clock arms it
 * again from scratch.
 */
public final class AdhanScheduler {

    public static final String PREFS = "sunnati";
    public static final String KEY_ENABLED = "adhan_enabled";
    public static final String EXTRA_PRAYER = "prayer";
    public static final String EXTRA_MINUTE = "minute";
    static final String[] KEYS = { "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha" };
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

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The next prayer after now, today or tomorrow, as a wall clock time. */
    public static long[] next(Context context, long nowMillis) {
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
                if (at.getTimeInMillis() > nowMillis) return new long[] { at.getTimeInMillis(), i };
            }
            day.add(Calendar.DATE, 1);
        }
        return null;
    }

    public static void scheduleNext(Context context) {
        if (!enabled(context)) return;
        long[] next = next(context, System.currentTimeMillis());
        if (next == null) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = pending(context, (int) next[1]);
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next[0], pending);
        } else {
            /* the system will not grant an exact alarm; a near one is still an alarm */
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next[0], pending);
        }
    }

    public static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pending(context, 0));
    }

    private static PendingIntent pending(Context context, int prayerIndex) {
        Intent intent = new Intent(context, AdhanReceiver.class);
        intent.setAction("io.github.siteq8.sunnati.ADHAN");
        intent.putExtra(EXTRA_PRAYER, prayerIndex);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        /* one request code, so a new alarm replaces the old rather than joining it */
        return PendingIntent.getBroadcast(context, REQUEST, intent, flags);
    }
}
