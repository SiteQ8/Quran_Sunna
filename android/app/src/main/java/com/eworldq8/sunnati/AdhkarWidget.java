package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** The adhkar of the part of the day it is, the morning's after the fajr,
 *  those after prayer at the dhuhr, the evening's after the asr and the
 *  night's after the isha, with how many of today's are done; a tap opens
 *  them. Done is counted when the reader last left the app. */
public final class AdhkarWidget extends AppWidgetProvider {
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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AdhkarWidget.class));
        if (ids == null || ids.length == 0) return;
        JSONObject all = WidgetStore.all(context);
        JSONObject now = WidgetStore.adhkarAt(all, System.currentTimeMillis());
        int total = now == null ? 0 : Math.max(0, now.optInt("total"));
        int done = now == null ? 0 : Math.max(0, Math.min(total, now.optInt("done")));
        for (int id : ids) {
            manager.updateAppWidget(id, WidgetStore.sized(manager, id, 170f, 170f, size -> fill(context, size, now, total, done, all)));
        }
    }

    private static RemoteViews fill(Context context, android.util.SizeF size, JSONObject now, int total, int done, JSONObject all) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_adhkar);
        views.setOnClickPendingIntent(R.id.adhkar_root, WidgetStore.open(context, "widgetAdhkar", 7405));
        WidgetStore.direct(views, R.id.adhkar_root, all);
        WidgetText.put(context, views, R.id.adhkar_head, WidgetStore.word(all, "adhkar", context.getString(R.string.widgetAdhkarName)),
            WidgetText.PAPER_SMALL, all, 0);
        WidgetText.put(context, views, R.id.adhkar_title, now == null ? context.getString(R.string.appName) : now.optString("title"),
            WidgetText.ADHKAR_TITLE, all, WidgetText.px(context, size.getWidth() - 28));
        views.setProgressBar(R.id.adhkar_bar, Math.max(1, total), done, false);
        String count = total > 0 && done >= total ? WidgetStore.word(all, "done", context.getString(R.string.widgetDone))
            : WidgetStore.figures(all, String.valueOf(done)) + " " + WidgetStore.word(all, "of", context.getString(R.string.widgetOf)) + " "
                + WidgetStore.figures(all, String.valueOf(total));
        WidgetText.put(context, views, R.id.adhkar_count, now == null ? WidgetStore.word(all, "openApp", context.getString(R.string.widgetOpenApp)) : count,
            WidgetText.PAPER_COUNT, all, 0);
        return views;
    }
}
