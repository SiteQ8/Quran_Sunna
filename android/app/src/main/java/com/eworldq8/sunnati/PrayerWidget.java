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

import org.json.JSONObject;

import java.util.Calendar;

/** The next prayer on the home screen, over the app's own painted sky for
 *  the hour: its name, its time, the time left counting down by itself and
 *  a bar of the time gone since the prayer before. Between an adhan and its
 *  iqama it counts to the iqama, as the app's clock does, and in ramadan it
 *  names the maghrib the iftar. One cell high it draws a single row.
 *
 *  It is also the one clock of all the widgets: refresh draws every kind
 *  that is placed, and one alarm wakes them all at the next prayer, the next
 *  turn of the sky, the next part of the day's adhkar or midnight, whichever
 *  comes first; a quiet alarm every quarter hour, which never wakes a
 *  sleeping phone, moves the bars between. */
public final class PrayerWidget extends AppWidgetProvider {
    static final String ACTION_TICK = "com.eworldq8.sunnati.WIDGET_TICK";
    private static final int REQUEST = 7301;
    private static final int REQUEST_QUARTER = 7302;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refresh(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
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
        if (alarms == null) return;
        alarms.cancel(tick(context, REQUEST));
        alarms.cancel(tick(context, REQUEST_QUARTER));
    }

    /** Draws every placed widget again, after the page hands new times or the clock moves. */
    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PrayerWidget.class));
        if (ids != null && ids.length > 0) draw(context, manager, ids);
        PrayerDayWidget.refresh(context);
        HijriWidget.refresh(context);
        AyahWidget.refresh(context);
        KhatmaWidget.refresh(context);
        AdhkarWidget.refresh(context);
        if (placed(context, manager)) wake(context);
        else cancel(context);
    }

    static boolean placed(Context context, AppWidgetManager manager) {
        for (Class<?> c : new Class<?>[] { PrayerWidget.class, PrayerDayWidget.class, HijriWidget.class,
                AyahWidget.class, KhatmaWidget.class, AdhkarWidget.class }) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, c));
            if (ids != null && ids.length > 0) return true;
        }
        return false;
    }

    /* the soonest of everything that changes what a widget shows */
    private static void wake(Context context) {
        long now = System.currentTimeMillis();
        JSONObject all = WidgetStore.all(context);
        Calendar midnight = Calendar.getInstance();
        midnight.add(Calendar.DAY_OF_YEAR, 1);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 5);
        long at = midnight.getTimeInMillis();
        JSONObject[] around = WidgetStore.around(all, now);
        if (around[1] != null) at = Math.min(at, around[1].optLong("at") + 1000);
        else {
            Object[] next = AdhanScheduler.next(context, now);
            if (next != null) at = Math.min(at, (Long) next[0] + 1000);
        }
        if (around[0] != null && around[0].optLong("iqama") > now) at = Math.min(at, around[0].optLong("iqama") + 1000);
        long sky = WidgetStore.nextSkyTurn(WidgetStore.day(all, now), now);
        if (sky > now) at = Math.min(at, sky + 1000);
        JSONObject adhkar = WidgetStore.adhkarAt(all, now);
        if (adhkar != null && adhkar.optLong("to") > now) at = Math.min(at, adhkar.optLong("to") + 1000);

        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent pending = tick(context, REQUEST);
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC, at, pending);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC, at, pending);
        alarms.setInexactRepeating(AlarmManager.RTC, now + AlarmManager.INTERVAL_FIFTEEN_MINUTES,
            AlarmManager.INTERVAL_FIFTEEN_MINUTES, tick(context, REQUEST_QUARTER));
    }

    private static PendingIntent tick(Context context, int request) {
        Intent intent = new Intent(context, PrayerWidget.class);
        intent.setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** What the next prayer widget says now: the name, a line under it, the
     *  time, the moment counted to, the moment counted from and the heading. */
    static final class Now {
        String head, name, sub, clock;
        long to, from;
    }

    static Now now(Context context, JSONObject all, long now) {
        Now n = new Now();
        n.head = WidgetStore.word(all, "next", context.getString(R.string.widgetPrayerName));
        JSONObject[] around = WidgetStore.around(all, now);
        JSONObject prev = around[0], next = around[1];
        if (prev != null && prev.optLong("iqama") > now) {
            /* between the adhan and the iqama the reader counts to the iqama */
            n.head = WidgetStore.word(all, "iqama", context.getString(R.string.widgetIqama));
            n.name = prev.optString("label");
            n.sub = "";
            n.to = prev.optLong("iqama");
            n.from = prev.optLong("at");
            n.clock = WidgetStore.clock(context, n.to);
            return n;
        }
        if (next != null) {
            n.name = next.optString("label");
            n.sub = next.optString("sub", "");
            n.clock = next.optString("clock", WidgetStore.clock(context, next.optLong("at")));
            n.to = next.optLong("at");
            n.from = prev != null ? prev.optLong("at") : n.to - 6 * 3600000L;
            return n;
        }
        /* nothing handed for the widgets yet: the times the adhan keeps */
        Object[] adhan = AdhanScheduler.next(context, now);
        if (adhan == null) return null;
        n.name = (String) adhan[1];
        n.sub = "";
        n.to = (Long) adhan[0];
        n.from = n.to - 6 * 3600000L;
        n.clock = WidgetStore.clock(context, n.to);
        return n;
    }

    private static void draw(Context context, AppWidgetManager manager, int[] ids) {
        long now = System.currentTimeMillis();
        JSONObject all = WidgetStore.all(context);
        Now n = now(context, all, now);
        String found = WidgetData.place(context);
        if (all != null && all.optString("place", "").length() > 0) found = all.optString("place");
        final String place = found;
        int sky = WidgetStore.skyDrawable(WidgetStore.skyName(WidgetStore.day(all, now), now));
        for (int id : ids) {
            /* one cell high draws one row; anything taller, the full card */
            manager.updateAppWidget(id, WidgetStore.sized(manager, id, 170f, 170f, size -> fill(context,
                WidgetStore.oneRow(size) ? R.layout.widget_prayer_small : R.layout.widget_prayer, size, n, now, place, sky, all)));
        }
    }

    private static RemoteViews fill(Context context, int layout, android.util.SizeF size, Now n, long now, String place, int sky, JSONObject all) {
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        boolean tall = layout == R.layout.widget_prayer;
        int wrap = WidgetText.px(context, size.getWidth() - 28);
        views.setOnClickPendingIntent(R.id.widget_root, WidgetStore.open(context, "widgetPrayer", 7400));
        WidgetStore.direct(views, android.R.id.background, all);
        views.setImageViewResource(R.id.widget_sky, sky);
        if (n == null) {
            WidgetText.put(context, views, R.id.widget_head, tall ? context.getString(R.string.appName) : "", WidgetText.SKY_HEAD, all, 0);
            WidgetText.put(context, views, R.id.widget_name, WidgetStore.word(all, "open", context.getString(R.string.widgetOpen)),
                tall ? WidgetText.SKY_OPEN : WidgetText.SKY_OPEN_ROW, all, wrap);
            views.setViewVisibility(R.id.widget_left, View.GONE);
            views.setViewVisibility(R.id.widget_time, View.GONE);
            views.setViewVisibility(R.id.widget_sub, View.GONE);
            views.setViewVisibility(R.id.widget_bar, View.GONE);
            views.setViewVisibility(R.id.widget_place, View.GONE);
            return views;
        }
        WidgetText.put(context, views, R.id.widget_head, tall ? n.head : "", WidgetText.SKY_HEAD, all, 0);
        WidgetText.put(context, views, R.id.widget_name, n.name, tall ? WidgetText.SKY_NAME : WidgetText.SKY_NAME_ROW, all, 0);
        WidgetText.put(context, views, R.id.widget_sub, tall ? n.sub : "", WidgetText.SKY_SUB, all, 0);
        WidgetText.put(context, views, R.id.widget_time, n.clock, tall ? WidgetText.SKY_TIME : WidgetText.SKY_TIME_ROW, all, 0);
        views.setViewVisibility(R.id.widget_left, View.VISIBLE);
        views.setChronometer(R.id.widget_left, SystemClock.elapsedRealtime() + (n.to - now), null, true);
        views.setChronometerCountDown(R.id.widget_left, true);
        long span = Math.max(1, n.to - n.from);
        int gone = (int) Math.max(0, Math.min(1000, (now - n.from) * 1000 / span));
        views.setViewVisibility(R.id.widget_bar, tall ? View.VISIBLE : View.GONE);
        views.setProgressBar(R.id.widget_bar, 1000, gone, false);
        /* the place has room under the bar only in a card taller than two cells */
        WidgetText.put(context, views, R.id.widget_place, tall && size.getHeight() >= 180 ? place : "", WidgetText.SKY_PLACE, all, 0);
        return views;
    }
}
