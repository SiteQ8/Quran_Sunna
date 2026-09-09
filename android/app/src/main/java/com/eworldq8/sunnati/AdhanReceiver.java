package com.eworldq8.sunnati;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.util.Log;

/** Rings at the prayer, then arms the alarm for the one after. */
public final class AdhanReceiver extends BroadcastReceiver {

    public static final String CHANNEL = "adhan";
    public static final String CHANNEL_REMINDERS = "reminders";
    /* when the app sounds the adhan itself, the notification keeps quiet */
    public static final String CHANNEL_SILENT = "adhan_quiet";

    @Override
    public void onReceive(Context context, Intent intent) {
        if ("com.eworldq8.sunnati.QIYAM".equals(intent.getAction())) {
            try {
                post(context, "قيام الليل", "هذا الثلث الأخير، وفيه ينزل ربنا تبارك وتعالى", "qiyam", CHANNEL_REMINDERS);
            } catch (Exception e) {
                Log.w("sunnati", "qiyam not shown", e);
            }
            try { QiyamScheduler.scheduleNext(context); } catch (Exception e) { Log.w("sunnati", "next qiyam not armed", e); }
            return;
        }
        if ("com.eworldq8.sunnati.SALAWAT".equals(intent.getAction())) {
            try {
                post(context, "صلِّ على النبي ﷺ", "اللهم صلِّ وسلِّم على نبينا محمد", "salawat", CHANNEL_REMINDERS);
            } catch (Exception e) {
                Log.w("sunnati", "salawat not shown", e);
            }
            try { SalawatScheduler.scheduleNext(context); } catch (Exception e) { Log.w("sunnati", "next salawat not armed", e); }
            return;
        }
        try {
            String name = intent.getStringExtra(AdhanScheduler.EXTRA_NAME);
            if (name != null && !name.isEmpty() && AdhanScheduler.enabled(context)) {
                boolean fajr = name.indexOf("الفجر") >= 0;
                /* the chosen adhan is sounded through the alarm stream, and the
                   channel is told to keep quiet so the two do not overlap */
                boolean own = AdhanSound.have(context, fajr);
                post(context, "حان وقت " + name, "الله أكبر، حيّ على الصلاة", "adhan", own ? CHANNEL_SILENT : CHANNEL);
                if (own) AdhanSound.play(context, fajr);
            }
        } catch (Exception e) {
            Log.w("sunnati", "adhan not shown", e);
        }
        try { AdhanScheduler.scheduleNext(context); } catch (Exception e) { Log.w("sunnati", "next adhan not armed", e); }
    }

    static void ensureChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "أوقات الصلاة", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("تنبيه عند دخول وقت كل صلاة");
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            channel.setSound(sound, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(CHANNEL_SILENT) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_SILENT, "أوقات الصلاة، بصوت الأذان", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("التنبيه صامت لأن التطبيق يرفع الأذان بنفسه");
            channel.setSound(null, null);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(CHANNEL_REMINDERS) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_REMINDERS, "تذكيرات", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("الصلاة على النبي وما تطلبه من التطبيق");
            manager.createNotificationChannel(channel);
        }
    }

    /** A notification under the app's own name, on the given channel. */
    static void post(Context context, String title, String body, String tag, String channel) {
        ensureChannels(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .build();
        manager.notify(tag, 100, n);
    }
}
