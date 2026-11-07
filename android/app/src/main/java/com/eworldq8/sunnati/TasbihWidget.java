package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** The tasbih as the reader last left the app: the count inside a ring that
 *  fills to its phrase's target, the phrase, and today's whole count; a tap
 *  opens the counter. */
public final class TasbihWidget extends AppWidgetProvider {
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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TasbihWidget.class));
        if (ids == null || ids.length == 0) return;
        JSONObject all = WidgetStore.all(context);
        JSONObject t = all == null ? null : all.optJSONObject("tasbih");
        /* a count kept on another day is not today's */
        boolean today = WidgetStore.day(all, System.currentTimeMillis()) == WidgetStore.firstDay(all);
        for (int id : ids) {
            manager.updateAppWidget(id, WidgetStore.sized(manager, id, 170f, 170f, size -> fill(context, t, today, all)));
        }
    }

    private static RemoteViews fill(Context context, JSONObject t, boolean today, JSONObject all) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasbih);
        views.setOnClickPendingIntent(R.id.tasbih_root, WidgetStore.open(context, "widgetTasbih", 7407));
        WidgetStore.direct(views, R.id.tasbih_root, all);
        WidgetText.put(context, views, R.id.tasbih_head, WidgetStore.word(all, "tasbih", context.getString(R.string.widgetTasbihName)),
            WidgetText.PAPER_SMALL_BOLD, all, 0);
        int target = t == null ? 33 : Math.max(1, t.optInt("target", 33));
        int count = t == null || !today ? 0 : Math.max(0, t.optInt("count"));
        int total = t == null || !today ? 0 : Math.max(0, t.optInt("total"));
        views.setProgressBar(R.id.tasbih_ring, target, Math.min(target, count), false);
        WidgetText.put(context, views, R.id.tasbih_count, WidgetStore.figures(all, String.valueOf(count)), WidgetText.TASBIH_COUNT, all, 0);
        String phrase = t == null ? context.getString(R.string.widgetSample34) : t.optString("t");
        WidgetText.put(context, views, R.id.tasbih_phrase, phrase, WidgetText.TASBIH_PHRASE, all, 0);
        String under = count >= target
            ? WidgetStore.word(all, "reached", context.getString(R.string.widgetTarget))
            : WidgetStore.word(all, "target", context.getString(R.string.widgetTarget)) + " " + WidgetStore.figures(all, String.valueOf(target));
        if (total > count) under = WidgetStore.word(all, "today", context.getString(R.string.widgetToday)) + " " + WidgetStore.figures(all, String.valueOf(total));
        WidgetText.put(context, views, R.id.tasbih_total, under, WidgetText.PAPER_NOTE, all, 0);
        return views;
    }
}
