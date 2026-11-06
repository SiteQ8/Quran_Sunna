package com.eworldq8.sunnati;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** The next prayer on the home screen: its name, its time and the time left,
 *  counting down by itself. It reads the times the page handed the adhan, so
 *  it shows what the reader sees for their own place and method, in the
 *  language they chose, and wakes again when that prayer comes. */
public final class PrayerWidget extends AppWidgetProvider {
    static final String ACTION_TICK = "com.eworldq8.sunnati.WIDGET_TICK";
    private static final int REQUEST = 7301;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refresh(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && ACTION_TICK.equals(intent.getAction())) refresh(context);
    }

    @Override
    public void onDisabled(Context context) {
        if (!placed(context, AppWidgetManager.getInstance(context))) cancel(context);
    }

    static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(tick(context));
    }

    /** Draws every placed widget again, after the page hands new times or the clock moves. */
    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PrayerWidget.class));
        if (ids != null && ids.length > 0) draw(context, manager, ids);
        /* the wide and the hijri widgets read the same list and wake with it */
        PrayerDayWidget.refresh(context);
        HijriWidget.refresh(context);
        if (placed(context, manager)) {
            Object[] next = AdhanScheduler.next(context, System.currentTimeMillis());
            java.util.Calendar midnight = java.util.Calendar.getInstance();
            midnight.add(java.util.Calendar.DAY_OF_YEAR, 1);
            midnight.set(java.util.Calendar.HOUR_OF_DAY, 0);
            midnight.set(java.util.Calendar.MINUTE, 0);
            midnight.set(java.util.Calendar.SECOND, 5);
            long at = midnight.getTimeInMillis();
            /* the next prayer moves every widget on, and midnight the date */
            if (next != null) at = Math.min(at, (Long) next[0] + 1000);
            wakeAt(context, at);
        }
    }

    private static boolean placed(Context context, AppWidgetManager manager) {
        for (Class<?> c : new Class<?>[] { PrayerWidget.class, PrayerDayWidget.class, HijriWidget.class }) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, c));
            if (ids != null && ids.length > 0) return true;
        }
        return false;
    }

    private static void draw(Context context, AppWidgetManager manager, int[] ids) {
        long now = System.currentTimeMillis();
        Object[] next = AdhanScheduler.next(context, now);
        String head = "الصلاة القادمة", label = null, clock = null;
        /* the page's own words for the prayer, its time and the heading */
        try {
            String stored = context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
                .getString(AdhanScheduler.KEY_TIMES, null);
            if (stored != null && next != null) {
                JSONArray list = new JSONArray(stored);
                for (int i = 0; i < list.length(); i++) {
                    JSONObject o = list.getJSONObject(i);
                    if (o.getLong("at") == (Long) next[0]) {
                        label = o.optString("label", null);
                        clock = o.optString("clock", null);
                        head = o.optString("head", head);
                        break;
                    }
                }
            }
        } catch (Exception ignored) { /* the Arabic name and the phone's clock, then */ }

        String place = context.getSharedPreferences(SplashView.PREFS, Context.MODE_PRIVATE)
            .getString(SplashView.KEY_PLACE, "");

        for (int id : ids) {
            RemoteViews tall = fill(context, R.layout.widget_prayer, next, now, head, label, clock, place);
            RemoteViews views = tall;
            if (Build.VERSION.SDK_INT >= 31) {
                /* one cell high draws one row; anything taller, the full card */
                java.util.Map<android.util.SizeF, RemoteViews> sizes = new java.util.HashMap<>();
                sizes.put(new android.util.SizeF(110f, 40f), fill(context, R.layout.widget_prayer_small, next, now, head, label, clock, place));
                sizes.put(new android.util.SizeF(110f, 100f), tall);
                views = new RemoteViews(sizes);
            }
            manager.updateAppWidget(id, views);
        }
    }

    private static RemoteViews fill(Context context, int layout, Object[] next, long now,
                                    String head, String label, String clock, String place) {
        {
            RemoteViews views = new RemoteViews(context.getPackageName(), layout);
            Intent open = new Intent(context, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            views.setOnClickPendingIntent(R.id.widget_root,
                PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            if (next == null) {
                views.setTextViewText(R.id.widget_head, "سُنّتي");
                views.setTextViewText(R.id.widget_name, "افتح التطبيق لحساب الأوقات");
                views.setViewVisibility(R.id.widget_left, View.GONE);
                views.setViewVisibility(R.id.widget_time, View.GONE);
            } else {
                long at = (Long) next[0];
                views.setTextViewText(R.id.widget_head, head);
                views.setTextViewText(R.id.widget_name, label != null && label.length() > 0 ? label : (String) next[1]);
                if (clock == null || clock.length() == 0) {
                    clock = android.text.format.DateFormat.getTimeFormat(context).format(new java.util.Date(at));
                }
                views.setTextViewText(R.id.widget_time, clock);
                views.setViewVisibility(R.id.widget_time, View.VISIBLE);
                views.setViewVisibility(R.id.widget_left, View.VISIBLE);
                views.setChronometer(R.id.widget_left, SystemClock.elapsedRealtime() + (at - now), null, true);
                views.setChronometerCountDown(R.id.widget_left, true);
            }
            if (layout == R.layout.widget_prayer) {
                views.setTextViewText(R.id.widget_place, place);
                views.setViewVisibility(R.id.widget_place, place.length() > 0 ? View.VISIBLE : View.GONE);
            }
            return views;
        }
    }

    /* the widget wakes when the prayer it counts to comes, to count to the next */
    private static void wakeAt(Context context, long at) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = tick(context);
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC, at, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC, at, pending);
    }

    private static PendingIntent tick(Context context) {
        Intent intent = new Intent(context, PrayerWidget.class);
        intent.setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(context, REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
