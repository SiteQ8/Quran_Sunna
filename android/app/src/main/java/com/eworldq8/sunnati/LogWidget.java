package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Today's five prayers as the reader marked them in the app: a disc with
 *  a tick for each prayed, a red ring round the next one, and how many of
 *  the five are prayed; a tap opens the log. */
public final class LogWidget extends AppWidgetProvider {
    private static final int[] DOTS = { R.id.log_dot1, R.id.log_dot2, R.id.log_dot3, R.id.log_dot4, R.id.log_dot5 };
    private static final int[] NAMES = { R.id.log_name1, R.id.log_name2, R.id.log_name3, R.id.log_name4, R.id.log_name5 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        PrayerWidget.refresh(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
        PrayerWidget.refresh(context);
    }

    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, LogWidget.class));
        if (ids == null || ids.length == 0) return;
        JSONObject all = WidgetStore.all(context);
        long now = System.currentTimeMillis();
        JSONObject day = WidgetStore.day(all, now);
        /* only the first day handed carries the marks; a later one has none yet */
        boolean marked = day != null && day == WidgetStore.firstDay(all);
        for (int id : ids) {
            manager.updateAppWidget(id, WidgetStore.sized(manager, id, 340f, 110f, size -> fill(context, day, marked, now, all)));
        }
    }

    private static RemoteViews fill(Context context, JSONObject day, boolean marked, long now, JSONObject all) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_log);
        views.setOnClickPendingIntent(R.id.log_root, WidgetStore.open(context, "widgetLog", 7408));
        WidgetStore.direct(views, R.id.log_root, all);
        WidgetText.put(context, views, R.id.log_head, WidgetStore.word(all, "log", context.getString(R.string.widgetLogName)),
            WidgetText.PAPER_SMALL_BOLD, all, 0);
        JSONArray five = day == null ? null : day.optJSONArray("five");
        int prayed = 0;
        boolean nextShown = false;
        for (int i = 0; i < 5; i++) {
            JSONObject p = five == null ? null : five.optJSONObject(i);
            boolean done = marked && p != null && p.optBoolean("prayed");
            boolean next = !done && !nextShown && p != null && p.optLong("at") > now;
            if (next) nextShown = true;
            if (done) prayed++;
            views.setImageViewResource(DOTS[i], done ? R.drawable.widget_dot_done : next ? R.drawable.widget_dot_next : R.drawable.widget_dot_open);
            String name = p == null ? "" : p.optString("label");
            WidgetText.put(context, views, NAMES[i], name, WidgetText.LOG_NAME, all, 0);
            if (p != null) views.setContentDescription(NAMES[i], done ? name + "، " + WidgetStore.word(all, "prayed", context.getString(R.string.widgetPrayed)) : name);
        }
        String count = five == null ? WidgetStore.word(all, "openApp", context.getString(R.string.widgetOpenApp))
            : prayed >= 5 ? WidgetStore.word(all, "allPrayed", context.getString(R.string.widgetAllPrayed))
            : WidgetStore.figures(all, String.valueOf(prayed)) + " " + WidgetStore.word(all, "of", context.getString(R.string.widgetOf)) + " "
                + WidgetStore.figures(all, "5");
        WidgetText.put(context, views, R.id.log_count, count, WidgetText.PAPER_NOTE_SEMI, all, 0);
        return views;
    }
}
