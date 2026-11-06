package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.DateFormat;
import java.util.Date;

/** Today's hijri date by the reader's own nudge for the moon of his town,
 *  over the civil date, with the occasion coming and how far off it is. */
public final class HijriWidget extends AppWidgetProvider {
    /* drawn with the others, so the one alarm that moves them all is kept */
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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, HijriWidget.class));
        if (ids != null && ids.length > 0) draw(context, manager, ids);
    }

    private static void draw(Context context, AppWidgetManager manager, int[] ids) {
        long now = System.currentTimeMillis();
        JSONObject all = WidgetStore.all(context);
        JSONObject today = WidgetStore.day(all, now);
        String day = today == null ? "" : today.optString("day");
        String hijri = today == null ? "" : today.optString("hijri");
        String occasion = "";
        JSONObject o = today == null ? null : today.optJSONObject("occasion");
        if (o != null) occasion = (o.optString("name") + "  " + o.optString("when")).trim();
        if (hijri.length() == 0) hijri = platformHijri();
        /* the civil date in the reader's language too, beside the hijri one */
        String civil = today == null ? "" : today.optString("civil");
        if (civil.length() == 0) civil = DateFormat.getDateInstance(DateFormat.LONG).format(new Date(now));
        for (int id : ids) {
            RemoteViews views;
            if (Build.VERSION.SDK_INT >= 31) {
                /* one cell high draws one row; anything taller, the whole card */
                java.util.Map<android.util.SizeF, RemoteViews> sizes = new java.util.HashMap<>();
                sizes.put(new android.util.SizeF(110f, 40f), fill(context, R.layout.widget_hijri_row, day, hijri, civil, occasion, all));
                sizes.put(new android.util.SizeF(110f, 100f), fill(context, R.layout.widget_hijri, day, hijri, civil, occasion, all));
                views = new RemoteViews(sizes);
            } else {
                views = fill(context, WidgetStore.oneRow(manager, id) ? R.layout.widget_hijri_row : R.layout.widget_hijri,
                    day, hijri, civil, occasion, all);
            }
            manager.updateAppWidget(id, views);
        }
    }

    private static RemoteViews fill(Context context, int layout, String day, String hijri, String civil, String occasion, JSONObject all) {
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        views.setOnClickPendingIntent(R.id.hijri_root, WidgetStore.open(context, "widgetHijri", 7402));
        WidgetStore.direct(views, R.id.hijri_root, all);
        views.setTextViewText(R.id.hijri_day, day);
        views.setViewVisibility(R.id.hijri_day, day.length() > 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.hijri_date, hijri);
        views.setTextViewText(R.id.hijri_civil, civil);
        views.setTextViewText(R.id.hijri_occasion, occasion);
        views.setViewVisibility(R.id.hijri_occasion, occasion.length() > 0 && layout == R.layout.widget_hijri ? View.VISIBLE : View.GONE);
        return views;
    }

    /* Before the app has handed anything, the phone's own Umm al Qura calendar. */
    private static String platformHijri() {
        try {
            android.icu.util.IslamicCalendar cal = new android.icu.util.IslamicCalendar();
            cal.setCalculationType(android.icu.util.IslamicCalendar.CalculationType.ISLAMIC_UMALQURA);
            android.icu.text.DateFormat f = android.icu.text.DateFormat.getDateInstance(cal, android.icu.text.DateFormat.LONG,
                new android.icu.util.ULocale("ar"));
            return f.format(new Date());
        } catch (Throwable t) {
            return "";
        }
    }
}
