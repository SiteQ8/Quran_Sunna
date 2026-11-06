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
    /* A channel per sound the reader can choose, since a channel's sound is
       fixed once made and cannot follow a per-reminder choice. */
    public static final String CHANNEL_CHIME = "reminders_chime";
    /* A channel keeps whatever it was given when it was first made: sound,
       vibration, importance. Changing the code changes nothing on a phone that
       already has it, which is why a reader who chose silence still heard the
       tone. This name is new, so every phone makes it afresh, truly silent and
       still. The old one is left alone rather than deleted, since a reader may
       have tuned it themselves. */
    public static final String CHANNEL_QUIET = "reminders_hush_v2";
    /* when the app sounds the adhan itself, the notification keeps quiet */
    public static final String CHANNEL_SILENT = "adhan_quiet";
    /* A channel's sound is fixed when it is made and never changes after, so a
       phone that has had an earlier version keeps whatever that version set.
       This one is new, and it neither sounds nor vibrates: it is for the
       reader who asked for silence, not for the app sounding the adhan itself. */
    public static final String CHANNEL_HUSH = "adhan_hush_v2";
    /* The notice of what is playing, a recitation, a station or a dhikr. It
       sat on the reminders channel, which rings, so it rang over the sound it
       named; this one never sounds or buzzes. */
    public static final String CHANNEL_PLAYING = "playing";
    /* the page's words for the notices rung here, in the reader's language */
    static final String KEY_WORDS = "notice_words";

    /* A reminder the page planned, on the channel of the sound the reader
       chose for it, under its own kind so a tap lands on its subject: every
       scheduled reminder used to be posted as "note", and the page fell back
       to opening wherever it last was. */
    private static void note(Context context, String title, String body, String sound, String kind) {
        if (title == null || title.isEmpty()) return;
        String channel = "chime".equals(sound) ? CHANNEL_CHIME
            : "silent".equals(sound) ? CHANNEL_QUIET : CHANNEL_REMINDERS;
        post(context, title, body, kind == null || kind.isEmpty() ? "note" : kind, channel);
    }

    /** The page's word for a notice, or the Arabic when it gave none. */
    static String word(Context context, String notice, String part, String arabic) {
        try {
            String stored = context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
                .getString(KEY_WORDS, null);
            if (stored == null) return arabic;
            org.json.JSONObject one = new org.json.JSONObject(stored).optJSONObject(notice);
            String got = one == null ? "" : one.optString(part, "");
            return got.isEmpty() ? arabic : got;
        } catch (Exception e) {
            return arabic;
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if ("com.eworldq8.sunnati.NOTE".equals(intent.getAction())) {
            try {
                /* every reminder of this minute, or the one the alarm carries
                   when the list cannot say */
                java.util.List<org.json.JSONObject> due =
                    NoteScheduler.dueAt(context, intent.getLongExtra(NoteScheduler.EXTRA_AT, 0));
                if (due.isEmpty()) {
                    note(context, intent.getStringExtra(NoteScheduler.EXTRA_TITLE), intent.getStringExtra(NoteScheduler.EXTRA_BODY),
                        intent.getStringExtra(NoteScheduler.EXTRA_SOUND), intent.getStringExtra(NoteScheduler.EXTRA_KIND));
                } else {
                    for (org.json.JSONObject one : due)
                        note(context, one.optString("t"), one.optString("b"), one.optString("s", "device"), one.optString("k", ""));
                }
            } catch (Exception e) {
                Log.w("sunnati", "note not shown", e);
            }
            try { NoteScheduler.scheduleNext(context); } catch (Exception e) { Log.w("sunnati", "next note not armed", e); }
            return;
        }
        if ("com.eworldq8.sunnati.QIYAM".equals(intent.getAction())) {
            try {
                String qs = context.getSharedPreferences("sunnati_qiyam", Context.MODE_PRIVATE)
                    .getString("sound", "device");
                post(context, word(context, "qiyam", "t", "قيام الليل"),
                    word(context, "qiyam", "b", "هذا الثلث الأخير، وفيه ينزل ربنا تبارك وتعالى"), "qiyam",
                    "silent".equals(qs) ? CHANNEL_QUIET : "chime".equals(qs) ? CHANNEL_CHIME : CHANNEL_REMINDERS);
            } catch (Exception e) {
                Log.w("sunnati", "qiyam not shown", e);
            }
            try { QiyamScheduler.scheduleNext(context); } catch (Exception e) { Log.w("sunnati", "next qiyam not armed", e); }
            return;
        }
        if ("com.eworldq8.sunnati.SALAWAT".equals(intent.getAction())) {
            try {
                boolean hush = context.getSharedPreferences("sunnati_salawat", Context.MODE_PRIVATE)
                    .getBoolean("silent", false);
                post(context, word(context, "salawat", "t", "صلِّ على النبي ﷺ"),
                    word(context, "salawat", "b", "اللهم صلِّ وسلِّم على نبينا محمد"), "salawat",
                    hush ? CHANNEL_QUIET : CHANNEL_REMINDERS);
            } catch (Exception e) {
                Log.w("sunnati", "salawat not shown", e);
            }
            try { SalawatScheduler.scheduleNext(context, true); } catch (Exception e) { Log.w("sunnati", "next salawat not armed", e); }
            return;
        }
        try {
            String name = intent.getStringExtra(AdhanScheduler.EXTRA_NAME);
            if (name != null && !name.isEmpty() && AdhanScheduler.enabled(context)) {
                boolean fajr = name.indexOf("الفجر") >= 0;
                /* the chosen adhan is sounded through the alarm stream, and the
                   channel is told to keep quiet so the two do not overlap */
                boolean own = AdhanSound.have(context, fajr);
                /* the reader may have asked for no sound at all, in which case
                   neither the recording nor the channel's tone is used */
                boolean quiet = context.getSharedPreferences("sunnati_adhan", Context.MODE_PRIVATE)
                    .getBoolean("silent", false);
                /* the words in the reader's language when the page gave them */
                String title = intent.getStringExtra(AdhanScheduler.EXTRA_TITLE);
                String body = intent.getStringExtra(AdhanScheduler.EXTRA_BODY);
                post(context, title != null && !title.isEmpty() ? title : "حان وقت " + name,
                    body != null && !body.isEmpty() ? body : "الله أكبر، حيّ على الصلاة", "adhan",
                    quiet ? CHANNEL_HUSH : own ? CHANNEL_SILENT : CHANNEL);
                if (own && !quiet) AdhanSound.play(context, fajr);
            }
        } catch (Exception e) {
            Log.w("sunnati", "adhan not shown", e);
        }
        try { AdhanScheduler.scheduleNext(context); } catch (Exception e) { Log.w("sunnati", "next adhan not armed", e); }
    }

    /* A channel is listed in the phone's settings under the name it was made
       with, so it is named in the phone's language, and one made before is
       renamed in place: creating it again under its id changes its name and
       description and nothing else, neither its sound nor what the reader
       set for it. True when there was none and it is to be made now. */
    private static boolean missing(NotificationManager manager, String id, String name, String about) {
        NotificationChannel had = manager.getNotificationChannel(id);
        if (had == null) return true;
        CharSequence was = had.getName();
        if (!name.contentEquals(was == null ? "" : was) || !about.equals(had.getDescription())) {
            NotificationChannel again = new NotificationChannel(id, name, had.getImportance());
            again.setDescription(about);
            manager.createNotificationChannel(again);
        }
        return false;
    }

    static void ensureChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        String name = context.getString(R.string.channelAdhan);
        String about = context.getString(R.string.channelAdhanAbout);
        if (missing(manager, CHANNEL, name, about)) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(about);
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            channel.setSound(sound, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        name = context.getString(R.string.channelAdhanVoice);
        about = context.getString(R.string.channelAdhanVoiceAbout);
        if (missing(manager, CHANNEL_SILENT, name, about)) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_SILENT, name, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(about);
            channel.setSound(null, null);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        name = context.getString(R.string.channelAdhanHush);
        about = context.getString(R.string.channelAdhanHushAbout);
        if (missing(manager, CHANNEL_HUSH, name, about)) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_HUSH, name, NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(about);
            channel.setSound(null, null);
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);
        }
        name = context.getString(R.string.channelReminders);
        about = context.getString(R.string.channelRemindersAbout);
        if (missing(manager, CHANNEL_REMINDERS, name, about)) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_REMINDERS, name, NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription(about);
            manager.createNotificationChannel(channel);
        }
        name = context.getString(R.string.channelChime);
        about = context.getString(R.string.channelChimeAbout);
        if (missing(manager, CHANNEL_CHIME, name, about)) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_CHIME, name, NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription(about);
            android.net.Uri chime = android.net.Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.chime);
            channel.setSound(chime, new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            manager.createNotificationChannel(channel);
        }
        name = context.getString(R.string.channelQuiet);
        about = context.getString(R.string.channelQuietAbout);
        if (missing(manager, CHANNEL_QUIET, name, about)) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_QUIET, name, NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(about);
            channel.setSound(null, null);
            /* silence means silence: a buzz is a sound to anyone holding the phone */
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);
        }
        name = context.getString(R.string.channelPlaying);
        about = context.getString(R.string.channelPlayingAbout);
        if (missing(manager, CHANNEL_PLAYING, name, about)) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_PLAYING, name, NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(about);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
    }

    /** A notification under the app's own name, on the given channel. */
    static void post(Context context, String title, String body, String tag, String channel) {
        ensureChannels(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        /* The notification carries which reminder it was, so tapping it opens
           the app on that subject rather than wherever the reader last left
           it: a friday night reminder used to open the app and then say
           nothing more about friday night. */
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("kind", tag);
        /* a request code of its own per kind, or android hands back the first
           pending intent it made and every notification opens the same thing */
        PendingIntent tap = PendingIntent.getActivity(context, tag.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
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
