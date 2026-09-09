package com.eworldq8.sunnati;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;

/**
 * The call to rise for the night prayer. The page works out when the last
 * third of the night falls for the reader's own place and hands over the days
 * ahead; the app arms the next one and re-arms after it rings, so it comes
 * even with the app closed.
 */
public final class QiyamScheduler {

    static final String KEY_TIMES = "qiyam_times";
    private static final int REQUEST = 4150;

    private QiyamScheduler() { }

    public static void setTimes(Context context, String json) {
        try {
            new JSONArray(json);
            context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_TIMES, json).apply();
            scheduleNext(context);
        } catch (Exception ignored) {
            /* a malformed list changes nothing */
        }
    }

    public static void clear(Context context) {
        context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_TIMES).apply();
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pending(context));
    }

    public static void scheduleNext(Context context) {
        String stored = context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TIMES, null);
        if (stored == null) return;
        long now = System.currentTimeMillis();
        long best = Long.MAX_VALUE;
        try {
            JSONArray list = new JSONArray(stored);
            for (int i = 0; i < list.length(); i++) {
                long at = list.getLong(i);
                if (at > now && at < best) best = at;
            }
        } catch (Exception e) {
            return;
        }
        if (best == Long.MAX_VALUE) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, best, pending(context));
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, best, pending(context));
    }

    private static PendingIntent pending(Context context) {
        Intent intent = new Intent(context, AdhanReceiver.class);
        intent.setAction("com.eworldq8.sunnati.QIYAM");
        return PendingIntent.getBroadcast(context, REQUEST, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
