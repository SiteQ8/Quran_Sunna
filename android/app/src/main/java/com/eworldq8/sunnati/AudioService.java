package com.eworldq8.sunnati;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
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
    static final int ID = 4152;
    /* Whether the notice is already up. A service that is already in the
       foreground owes the system nothing more, so its notice may be reworded
       from anywhere, even with the app away. */
    static volatile boolean running;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_STOP : intent.getAction();
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        String sub = intent == null ? null : intent.getStringExtra(EXTRA_SUB);
        boolean playing = intent != null && intent.getBooleanExtra(EXTRA_PLAYING, true);

        /* A stop arrives by stopService now, which does not reach here at all.
         * What still reaches here is a start, and a start made with
         * startForegroundService owes the system a startForeground within a
         * few seconds or it kills the app. The obligation is discharged by a
         * successful call and by nothing else: catching the failure does not
         * cancel it, so the only real defence is upstream, where the promise
         * is made from the foreground alone. Here we keep the raise first and
         * take it down after, for the stale intents already in flight. */
        if (ACTION_STOP.equals(action) || action == null) {
            try { startForeground(ID, shade(this, title, sub, playing)); } catch (Exception ignored) { }
            try { stopForeground(STOP_FOREGROUND_REMOVE); } catch (Exception ignored) { }
            running = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startForeground(ID, shade(this, title, sub, playing));
            running = true;
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    static Notification shade(Context host, String title, String sub, boolean playing) {
        Intent open = new Intent(host, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(host, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        /* The notice of what is playing rang the reminders' tone each time it
           was raised or reworded, on every play, pause and surah, over the very
           recitation it described. It has a quiet channel of its own now, and
           it alerts once at most. */
        AdhanReceiver.ensureChannels(host);
        Notification.Builder b = new Notification.Builder(host, AdhanReceiver.CHANNEL_PLAYING)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? "سُنّتي" : title)
            .setContentText(sub == null ? "" : sub)
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC);
        b.addAction(new Notification.Action.Builder(
            Icon(host, playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
            playing ? "إيقاف مؤقت" : "تشغيل",
            command(host, ACTION_TOGGLE)).build());
        b.addAction(new Notification.Action.Builder(
            Icon(host, android.R.drawable.ic_menu_close_clear_cancel), "إيقاف", command(host, ACTION_CLOSE)).build());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    /* These are framework drawables and have names in android.R, so they are
       named. Looked up by string they returned 0 when a name was wrong, and an
       Icon built on 0 fails silently in the shade rather than at the compiler. */
    private static android.graphics.drawable.Icon Icon(Context host, int id) {
        return android.graphics.drawable.Icon.createWithResource(host, id);
    }

    private static PendingIntent command(Context host, String action) {
        Intent intent = new Intent(host, MainActivity.class)
            .setAction(action)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(host, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
