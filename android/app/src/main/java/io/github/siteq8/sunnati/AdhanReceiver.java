package io.github.siteq8.sunnati;

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
    private static final String[] NAMES = { "الفجر", "الشروق", "الظهر", "العصر", "المغرب", "العشاء" };

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            int index = intent.getIntExtra(AdhanScheduler.EXTRA_PRAYER, -1);
            if (index >= 0 && index < NAMES.length && AdhanScheduler.enabled(context)) {
                show(context, index);
            }
        } catch (Exception e) {
            Log.w("sunnati", "adhan not shown", e);
        }
        try { AdhanScheduler.scheduleNext(context); } catch (Exception e) { Log.w("sunnati", "next adhan not armed", e); }
    }

    static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "أوقات الصلاة", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("تنبيه عند دخول وقت كل صلاة، بحسب تقويم العجيري للكويت");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        channel.setSound(sound, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    private void show(Context context, int index) {
        ensureChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, flags);
        String title = "حان وقت " + NAMES[index];
        String body = "الله أكبر، حيّ على الصلاة";
        Notification.Builder builder = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER);
        manager.notify(100 + index, builder.build());
    }
}
