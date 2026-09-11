package com.eworldq8.sunnati;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * Holds the app alive while a recitation is sounding, and puts it in the
 * shade with something to press. The sound itself is played by the page; this
 * only keeps the process from being taken and hands the reader a way to stop
 * or pause without opening the app again.
 */
public final class AudioService extends Service {

    static final String ACTION_START = "com.eworldq8.sunnati.AUDIO_START";
    static final String ACTION_STOP = "com.eworldq8.sunnati.AUDIO_STOP";
    static final String ACTION_TOGGLE = "com.eworldq8.sunnati.AUDIO_TOGGLE";
    static final String ACTION_CLOSE = "com.eworldq8.sunnati.AUDIO_CLOSE";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_SUB = "sub";
    static final String EXTRA_PLAYING = "playing";
    private static final int ID = 4152;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_STOP : intent.getAction();
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        String sub = intent == null ? null : intent.getStringExtra(EXTRA_SUB);
        boolean playing = intent != null && intent.getBooleanExtra(EXTRA_PLAYING, true);

        /* The system kills the app if a service started with
         * startForegroundService does not call startForeground within a few
         * seconds, even when the very next thing it does is stop. A stop that
         * overtakes its own start used to crash the app, so the notice is
         * always raised first and only then taken down. */
        try {
            startForeground(ID, shade(title, sub, playing));
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action) || action == null) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Notification shade(String title, String sub, boolean playing) {
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = new Notification.Builder(this, AdhanReceiver.CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? "سُنّتي" : title)
            .setContentText(sub == null ? "" : sub)
            .setContentIntent(tap)
            .setOngoing(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC);
        b.addAction(new Notification.Action.Builder(
            Icon(playing ? "ic_media_pause" : "ic_media_play"),
            playing ? "إيقاف مؤقت" : "تشغيل",
            command(ACTION_TOGGLE)).build());
        b.addAction(new Notification.Action.Builder(
            Icon("ic_menu_close_clear_cancel"), "إيقاف", command(ACTION_CLOSE)).build());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private android.graphics.drawable.Icon Icon(String name) {
        int id = getResources().getIdentifier(name, "drawable", "android");
        return android.graphics.drawable.Icon.createWithResource(this, id);
    }

    private PendingIntent command(String action) {
        Intent intent = new Intent(this, MainActivity.class)
            .setAction(action)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
