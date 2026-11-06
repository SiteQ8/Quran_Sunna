package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Locale;

/** The khatma as a ring: how much of the mushaf is read, the page the
 *  reader reached and the portion of today; a tap opens that page. */
public final class KhatmaWidget extends AppWidgetProvider {
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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, KhatmaWidget.class));
        if (ids == null || ids.length == 0) return;
        JSONObject all = WidgetStore.all(context);
        JSONObject k = all == null ? null : all.optJSONObject("khatma");
        int total = k == null ? 604 : Math.max(1, k.optInt("total", 604));
        int read = k == null ? 0 : Math.max(0, Math.min(total, k.optInt("read", 0)));
        int page = k == null ? 1 : Math.max(1, k.optInt("page", 1));
        String wird = k == null ? "" : k.optString("wird", "");
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_khatma);
            views.setOnClickPendingIntent(R.id.khatma_root, WidgetStore.open(context, "widgetKhatma", 7404));
            WidgetStore.direct(views, R.id.khatma_root, all);
            WidgetText.put(context, views, R.id.khatma_head, WidgetStore.word(all, "khatma", context.getString(R.string.widgetKhatmaName)),
                WidgetText.PAPER_SMALL_BOLD, all, 0);
            views.setProgressBar(R.id.khatma_ring, total, read, false);
            WidgetText.put(context, views, R.id.khatma_share,
                WidgetStore.figures(all, String.format(Locale.US, "%d%%", Math.round(read * 100f / total))), WidgetText.KHATMA_SHARE, all, 0);
            String pageLine = WidgetStore.word(all, "page", context.getString(R.string.widgetPage)) + " " + WidgetStore.figures(all, String.valueOf(page))
                + " " + WidgetStore.word(all, "of", context.getString(R.string.widgetOf)) + " " + WidgetStore.figures(all, String.valueOf(total));
            WidgetText.put(context, views, R.id.khatma_page, pageLine, WidgetText.PAPER_COUNT, all, 0);
            String line = wird.length() > 0 ? WidgetStore.word(all, "wird", context.getString(R.string.widgetWird)) + " " + wird : "";
            WidgetText.put(context, views, R.id.khatma_wird, line, WidgetText.PAPER_NOTE, all, 0);
            manager.updateAppWidget(id, views);
        }
    }
}
