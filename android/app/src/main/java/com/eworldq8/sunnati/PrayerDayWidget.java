package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** The day's five prayers in a row over the sky of the hour: the one coming
 *  lifted, the ones gone faded, and a mark on each the reader marked as
 *  prayed. After the isha it shows the day ahead. Four cells by two. */
public final class PrayerDayWidget extends AppWidgetProvider {
    private static final int[] COLS = { R.id.day_col_0, R.id.day_col_1, R.id.day_col_2, R.id.day_col_3, R.id.day_col_4 };
    private static final int[] NAMES = { R.id.day_name_0, R.id.day_name_1, R.id.day_name_2, R.id.day_name_3, R.id.day_name_4 };
    private static final int[] TIMES = { R.id.day_time_0, R.id.day_time_1, R.id.day_time_2, R.id.day_time_3, R.id.day_time_4 };
    private static final int[] MARKS = { R.id.day_mark_0, R.id.day_mark_1, R.id.day_mark_2, R.id.day_mark_3, R.id.day_mark_4 };

    /* drawn with the others, so the one alarm that moves them all is kept */
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        PrayerWidget.refresh(context);
    }

    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PrayerDayWidget.class));
        if (ids != null && ids.length > 0) draw(context, manager, ids);
    }

    private static void draw(Context context, AppWidgetManager manager, int[] ids) {
        long now = System.currentTimeMillis();
        JSONObject all = WidgetStore.all(context);
        JSONObject day = WidgetStore.day(all, now);
        JSONArray five = day == null ? null : day.optJSONArray("five");
        /* once the isha is gone the day that matters is the next one */
        if (five != null && five.length() > 0 && five.optJSONObject(five.length() - 1).optLong("at") < now) {
            JSONObject next = WidgetStore.day(all, now + 86400000L);
            if (next != null) { day = next; five = next.optJSONArray("five"); }
        }
        String place = all == null ? WidgetData.place(context) : all.optString("place", WidgetData.place(context));
        int sky = WidgetStore.skyDrawable(WidgetStore.skyName(WidgetStore.day(all, now), now));
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_day);
            views.setOnClickPendingIntent(R.id.day_root, WidgetStore.open(context, "widgetDay", 7401));
            views.setImageViewResource(R.id.day_sky, sky);
            if (day == null || five == null || five.length() == 0) {
                views.setTextViewText(R.id.day_title, WidgetStore.word(all, "open", "افتح التطبيق لحساب الأوقات"));
                views.setTextViewText(R.id.day_place, "");
                for (int c : COLS) views.setViewVisibility(c, View.INVISIBLE);
                manager.updateAppWidget(id, views);
                continue;
            }
            String title = (day.optString("day") + "  " + day.optString("hijri")).trim();
            views.setTextViewText(R.id.day_title, title);
            views.setTextViewText(R.id.day_place, place);
            boolean lifted = false;
            for (int i = 0; i < COLS.length; i++) {
                JSONObject p = five.optJSONObject(i);
                if (p == null) { views.setViewVisibility(COLS[i], View.INVISIBLE); continue; }
                views.setViewVisibility(COLS[i], View.VISIBLE);
                boolean gone = p.optLong("at") <= now;
                boolean next = !gone && !lifted;
                if (next) lifted = true;
                views.setTextViewText(NAMES[i], p.optString("label"));
                /* five narrow columns: the time without its ص or م */
                views.setTextViewText(TIMES[i], p.optString("short", p.optString("clock")));
                int colour = gone ? 0x99FFFFFF : 0xFFFFFFFF;
                views.setTextColor(NAMES[i], colour);
                views.setTextColor(TIMES[i], colour);
                views.setInt(COLS[i], "setBackgroundResource", next ? R.drawable.widget_pill : 0);
                views.setViewVisibility(MARKS[i], p.optBoolean("prayed") ? View.VISIBLE : View.INVISIBLE);
            }
            manager.updateAppWidget(id, views);
        }
    }
}
