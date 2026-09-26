package com.eworldq8.sunnati;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Reminders the page works out and the app delivers: the daily portion of the
 * mushaf, the call before the friday prayer, and whatever comes after. Each
 * carries its own hour, title and words, so a new kind of reminder needs no
 * new code here. The next one is armed, and the one after it when it rings.
 */
public final class NoteScheduler {

    static final String KEY = "notes";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_SOUND = "sound";
    /* Which reminder this is, so a tapped notification opens the app on its
       own subject: every scheduled reminder used to be posted under the one
       tag "note", and the page could make nothing of it. */
    static final String EXTRA_KIND = "kind";
    private static final int REQUEST = 4151;

    private NoteScheduler() { }

    /** A list of { at, t, b, s, k }: when, the title, the words, the sound,
        and which reminder it is. */
    public static void setAll(Context context, String json) {
        try {
            new JSONArray(json == null || json.isEmpty() ? "[]" : json);
            context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY, json).apply();
            scheduleNext(context);
        } catch (Exception ignored) {
            /* a malformed list changes nothing */
        }
    }

    public static void scheduleNext(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        JSONObject soonest = soonest(context, System.currentTimeMillis());
        if (soonest == null) { alarms.cancel(pending(context, null, null, null, null)); return; }
        long at = soonest.optLong("at");
        PendingIntent pending = pending(context, soonest.optString("t"), soonest.optString("b"),
            soonest.optString("s", "device"), soonest.optString("k", ""));
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }

    private static JSONObject soonest(Context context, long now) {
        String stored = context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
            .getString(KEY, null);
        if (stored == null) return null;
        JSONObject best = null;
        try {
            JSONArray list = new JSONArray(stored);
            for (int i = 0; i < list.length(); i++) {
                JSONObject one = list.getJSONObject(i);
                long at = one.optLong("at");
                if (at > now && (best == null || at < best.optLong("at"))) best = one;
            }
        } catch (Exception ignored) {
            return null;
        }
        return best;
    }

    private static PendingIntent pending(Context context, String title, String body, String sound, String kind) {
        Intent intent = new Intent(context, AdhanReceiver.class);
        intent.setAction("com.eworldq8.sunnati.NOTE");
        intent.putExtra(EXTRA_TITLE, title == null ? "" : title);
        intent.putExtra(EXTRA_BODY, body == null ? "" : body);
        intent.putExtra(EXTRA_SOUND, sound == null ? "device" : sound);
        intent.putExtra(EXTRA_KIND, kind == null ? "" : kind);
        return PendingIntent.getBroadcast(context, REQUEST, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
