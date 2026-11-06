package com.eworldq8.sunnati;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import java.text.DateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;

/** Today's hijri date, by the reader's own nudge for the moon of his town,
 *  over the civil date: the small widget, two cells by one or by two. */
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
        /* the page's words for today are on the first prayer still ahead today */
        String day = "", hijri = "";
        Calendar today = Calendar.getInstance();
        for (WidgetData.Row r : WidgetData.ahead(context, now)) {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(r.at);
            if (c.get(Calendar.YEAR) == today.get(Calendar.YEAR) && c.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR)) {
                day = r.day;
                hijri = r.hijri;
            }
            break;
        }
        if (hijri.length() == 0) hijri = platformHijri();
        String civil = DateFormat.getDateInstance(DateFormat.LONG).format(new Date(now));
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_hijri);
            Intent open = new Intent(context, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            views.setOnClickPendingIntent(R.id.hijri_root,
                PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            views.setTextViewText(R.id.hijri_day, day);
            views.setTextViewText(R.id.hijri_date, hijri);
            views.setTextViewText(R.id.hijri_civil, civil);
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
