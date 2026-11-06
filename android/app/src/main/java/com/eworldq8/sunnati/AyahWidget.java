package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** The ayah of the day, the one the home screen of the app shows, with its
 *  surah and number; a tap opens the mushaf on its page. */
public final class AyahWidget extends AppWidgetProvider {
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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AyahWidget.class));
        if (ids == null || ids.length == 0) return;
        JSONObject all = WidgetStore.all(context);
        JSONObject day = WidgetStore.day(all, System.currentTimeMillis());
        JSONObject ayah = day == null ? null : day.optJSONObject("ayah");
        for (int id : ids) {
            manager.updateAppWidget(id, WidgetStore.sized(manager, id, 340f, 170f, size -> fill(context, size, ayah, all)));
        }
    }

    private static RemoteViews fill(Context context, android.util.SizeF size, JSONObject ayah, JSONObject all) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_ayah);
        views.setOnClickPendingIntent(R.id.ayah_root, WidgetStore.open(context, "widgetAyah", 7403));
        WidgetStore.direct(views, R.id.ayah_root, all);
        WidgetText.put(context, views, R.id.ayah_head, WidgetStore.word(all, "ayah", context.getString(R.string.widgetAyahName)),
            WidgetText.PAPER_SMALL_BOLD, all, 0);
        int wrap = WidgetText.px(context, size.getWidth() - 28);
        if (ayah == null) {
            WidgetText.put(context, views, R.id.ayah_text, "\uFD3F \uFD3E", WidgetText.AYAH, all, wrap);
            WidgetText.put(context, views, R.id.ayah_ref, WidgetStore.word(all, "openApp", context.getString(R.string.widgetOpenApp)),
                WidgetText.PAPER_NOTE, all, 0);
        } else {
            WidgetText.put(context, views, R.id.ayah_text, ayah.optString("t"), WidgetText.AYAH, all, wrap);
            WidgetText.put(context, views, R.id.ayah_ref, ayah.optString("ref"), WidgetText.PAPER_NOTE, all, 0);
        }
        return views;
    }
}
