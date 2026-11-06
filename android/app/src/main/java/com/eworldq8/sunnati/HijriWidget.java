package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
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
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_hijri);
            views.setOnClickPendingIntent(R.id.hijri_root, WidgetStore.open(context, "widgetHijri", 7402));
            views.setTextViewText(R.id.hijri_day, day);
            views.setViewVisibility(R.id.hijri_day, day.length() > 0 ? View.VISIBLE : View.GONE);
            views.setTextViewText(R.id.hijri_date, hijri);
            views.setTextViewText(R.id.hijri_civil, civil);
            views.setTextViewText(R.id.hijri_occasion, occasion);
            views.setViewVisibility(R.id.hijri_occasion, occasion.length() > 0 ? View.VISIBLE : View.GONE);
            manager.updateAppWidget(id, views);
        }
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
