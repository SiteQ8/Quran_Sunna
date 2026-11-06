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

    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AdhkarWidget.class));
        if (ids == null || ids.length == 0) return;
        JSONObject all = WidgetStore.all(context);
        JSONObject now = WidgetStore.adhkarAt(all, System.currentTimeMillis());
        int total = now == null ? 0 : Math.max(0, now.optInt("total"));
        int done = now == null ? 0 : Math.max(0, Math.min(total, now.optInt("done")));
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_adhkar);
            views.setOnClickPendingIntent(R.id.adhkar_root, WidgetStore.open(context, "widgetAdhkar", 7405));
            WidgetStore.direct(views, R.id.adhkar_root, all);
            views.setTextViewText(R.id.adhkar_head, WidgetStore.word(all, "adhkar", context.getString(R.string.widgetAdhkarName)));
            views.setTextViewText(R.id.adhkar_title, now == null ? context.getString(R.string.appName) : now.optString("title"));
            views.setProgressBar(R.id.adhkar_bar, Math.max(1, total), done, false);
            String count = total > 0 && done >= total ? WidgetStore.word(all, "done", context.getString(R.string.widgetDone))
                : WidgetStore.figures(all, String.valueOf(done)) + " " + WidgetStore.word(all, "of", context.getString(R.string.widgetOf)) + " "
                    + WidgetStore.figures(all, String.valueOf(total));
            views.setTextViewText(R.id.adhkar_count, now == null ? WidgetStore.word(all, "open", context.getString(R.string.widgetOpenApp)) : count);
            manager.updateAppWidget(id, views);
        }
    }
}
