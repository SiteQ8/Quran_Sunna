package com.eworldq8.sunnati;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * The reminder to send prayers upon the Prophet ﷺ. The page cannot do this on
 * its own: a web page is only woken by periodic sync, which a web view never
 * fires, so the reminder never arrived. The app keeps its own alarm instead,
 * repeating at the interval the reader chose, and re-arms itself after each
 * one so it survives being closed and rebooted.
 */
public final class SalawatScheduler {

    static final String KEY_EVERY = "salawat_every";
    private static final int REQUEST = 4149;

    private SalawatScheduler() { }

    /** Minutes between reminders, or zero for none. */
    public static void setEvery(Context context, int minutes) {
        context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
            .edit().putInt(KEY_EVERY, minutes).apply();
        if (minutes > 0) scheduleNext(context); else cancel(context);
    }

    public static int every(Context context) {
        return context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE).getInt(KEY_EVERY, 0);
    }

    public static void scheduleNext(Context context) {
        int minutes = every(context);
        if (minutes <= 0) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        long at = System.currentTimeMillis() + minutes * 60000L;
        PendingIntent pending = pending(context);
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }

    public static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pending(context));
    }

    private static PendingIntent pending(Context context) {
        Intent intent = new Intent(context, AdhanReceiver.class);
        intent.setAction("com.eworldq8.sunnati.SALAWAT");
        return PendingIntent.getBroadcast(context, REQUEST, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
