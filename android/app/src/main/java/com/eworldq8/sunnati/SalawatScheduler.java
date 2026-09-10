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
    /**
     * The page hands the interval over on every launch, so this is called far
     * more often than the reader changes it. Only a real change starts the
     * count afresh; an unchanged one leaves any waiting alarm alone, or the
     * reminder is pushed an interval further away every time the app opens
     * and never arrives at all.
     */
    public static void setEvery(Context context, int minutes) {
        int before = every(context);
        context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
            .edit().putInt(KEY_EVERY, minutes).apply();
        if (minutes <= 0) { cancel(context); return; }
        scheduleNext(context, before != minutes);
    }

    public static int every(Context context) {
        return context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE).getInt(KEY_EVERY, 0);
    }

    /** Arms the next reminder, unless one is already waiting. Opening the app
     *  used to push it a whole interval away again, so a reader who opened it
     *  every few minutes never received one at all. */
    public static void scheduleNext(Context context) {
        scheduleNext(context, false);
    }

    public static void scheduleNext(Context context, boolean force) {
        int minutes = every(context);
        if (minutes <= 0) return;
        if (!force && waiting(context)) return;
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        long at = nextOnTheClock(minutes);
        PendingIntent pending = pending(context);
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }

    /**
     * The next round hour, or the next round half or quarter, rather than an
     * interval counted from whenever the reader happened to choose it. Every
     * hour means 12:00, 1:00, 2:00, not 12:54 and 1:54.
     */
    static long nextOnTheClock(int minutes) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        int sinceMidnight = c.get(java.util.Calendar.HOUR_OF_DAY) * 60 + c.get(java.util.Calendar.MINUTE);
        int steps = sinceMidnight / minutes + 1;
        c.set(java.util.Calendar.HOUR_OF_DAY, 0);
        c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0);
        c.set(java.util.Calendar.MILLISECOND, 0);
        long at = c.getTimeInMillis() + steps * minutes * 60000L;
        long now = System.currentTimeMillis();
        while (at <= now) at += minutes * 60000L;
        return at;
    }

    /** Whether an alarm is already pending, asked without creating one. */
    private static boolean waiting(Context context) {
        Intent intent = new Intent(context, AdhanReceiver.class);
        intent.setAction("com.eworldq8.sunnati.SALAWAT");
        return PendingIntent.getBroadcast(context, REQUEST, intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE) != null;
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
