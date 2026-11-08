package com.eworldq8.sunnati;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/** The next prayer on the lock screen, for a reader who switched it on in
 *  the app's settings: a notification that makes no sound and cannot be
 *  swiped away, with the prayer's name and time and the phone's own
 *  countdown to it. It goes at the prayer's minute and the one after takes
 *  its place. Android phones have no widgets on the lock screen; this is
 *  how a prayer app shows there. Off until the reader asks for it. */
public final class NextNotice {
    static final String ACTION = "com.eworldq8.sunnati.NEXT_NOTICE";
    static final String CHANNEL = "sunnati_next";
    private static final String PREFS = "sunnati_next";
    private static final String KEY_ON = "on";
    private static final String TAG = "next";
    private static final int ID = 300;
    private static final int REQUEST = 4150;

    private NextNotice() { }

    public static boolean on(Context context) {
        return prefs(context).getBoolean(KEY_ON, false);
    }

    public static void setOn(Context context, boolean on) {
        prefs(context).edit().putBoolean(KEY_ON, on).apply();
        if (on) show(context); else clear(context);
    }

    /** Shows the prayer that comes next and arms its replacement; called
     *  whenever the times change, at each prayer, and when the phone starts. */
    public static void show(Context context) {
        if (!on(context)) return;
        Object[] next = AdhanScheduler.next(context, System.currentTimeMillis());
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (next == null) { clear(context); return; }
        ensureChannel(context, manager);
        long at = (Long) next[0];
        String name = (String) next[1];
        String clock = WidgetStore.clock(context, at);
        String heading = WidgetStore.word(WidgetStore.all(context), "next", context.getString(R.string.widgetPrayerName));
        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("kind", "widgetPrayer");
        PendingIntent tap = PendingIntent.getActivity(context, REQUEST, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(name + "  " + clock)
            .setContentText(heading)
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(at)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_STATUS)
            /* gone at the prayer's minute, so it never counts past zero */
            .setTimeoutAfter(Math.max(1000L, at - System.currentTimeMillis()));
        manager.notify(TAG, ID, b.build());
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) {
            PendingIntent then = pending(context);
            boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at + 1000L, then);
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at + 1000L, then);
        }
    }

    static void clear(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(TAG, ID);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(pending(context));
    }

    private static PendingIntent pending(Context context) {
        Intent intent = new Intent(context, AdhanReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(context, REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /* seen on the lock screen and silent: default importance so the phone
       does not hide it among the silent ones, with no sound or buzz */
    private static void ensureChannel(Context context, NotificationManager manager) {
        String name = context.getString(R.string.channelNext);
        String about = context.getString(R.string.channelNextAbout);
        NotificationChannel had = manager.getNotificationChannel(CHANNEL);
        NotificationChannel channel = new NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(about);
        if (had == null) {
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        }
        manager.createNotificationChannel(channel);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
