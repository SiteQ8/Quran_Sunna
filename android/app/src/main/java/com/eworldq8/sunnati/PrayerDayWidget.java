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

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
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
        JSONObject found = WidgetStore.day(all, now);
        JSONArray five0 = found == null ? null : found.optJSONArray("five");
        /* once the isha is gone the day that matters is the next one */
        boolean ahead0 = false;
        if (five0 != null && five0.length() > 0 && five0.optJSONObject(five0.length() - 1).optLong("at") < now) {
            JSONObject next = WidgetStore.day(all, now + 86400000L);
            if (next != null) { found = next; five0 = next.optJSONArray("five"); ahead0 = true; }
        }
        final JSONObject day = found;
        final JSONArray five = five0;
        final boolean ahead = ahead0;
        final String place = all == null ? WidgetData.place(context) : all.optString("place", WidgetData.place(context));
        final int sky = WidgetStore.skyDrawable(WidgetStore.skyName(WidgetStore.day(all, now), now));
        for (int id : ids) {
            manager.updateAppWidget(id, WidgetStore.sized(manager, id, 340f, 170f,
                size -> fill(context, size, day, five, place, sky, now, all, ahead)));
        }
    }

    private static RemoteViews fill(Context context, android.util.SizeF size, JSONObject day, JSONArray five, String place,
                                    int sky, long now, JSONObject all, boolean ahead) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_day);
        views.setOnClickPendingIntent(R.id.day_root, WidgetStore.open(context, "widgetDay", 7401));
        WidgetStore.direct(views, android.R.id.background, all);
        views.setImageViewResource(R.id.day_sky, sky);
        if (day == null || five == null || five.length() == 0) {
            WidgetText.put(context, views, R.id.day_title, WidgetStore.word(all, "open", context.getString(R.string.widgetOpen)),
                WidgetText.SKY_OPEN, all, WidgetText.px(context, size.getWidth() - 24));
            views.setViewVisibility(R.id.day_place, View.GONE);
            for (int c : COLS) views.setViewVisibility(c, View.INVISIBLE);
            return views;
        }
        String title = (day.optString("day") + "  " + day.optString("hijri")).trim();
        /* the day ahead says it is tomorrow: «السبت» on a friday evening, with
           nothing before it, reads as a wrong date */
        String soon = ahead ? WidgetStore.word(all, "tomorrow", "") : "";
        if (soon.length() > 0) title = soon + " " + title;
        /* the civil date under the hijri one, and the place beside it */
        String civil = day.optString("civil");
        String under = civil.length() == 0 ? place : place == null || place.length() == 0 ? civil : civil + "  ·  " + place;
        /* two rows of a phone on its side are too low for the heading over
           the five columns: the second line goes first, then the day itself */
        float high = size.getHeight();
        WidgetText.put(context, views, R.id.day_title, high < 140 ? "" : title, WidgetText.SKY_TITLE, all, 0);
        WidgetText.put(context, views, R.id.day_place, high < 160 ? "" : under, WidgetText.SKY_PLACE, all, 0);
        boolean lifted = false;
        for (int i = 0; i < COLS.length; i++) {
            JSONObject p = five.optJSONObject(i);
            if (p == null) { views.setViewVisibility(COLS[i], View.INVISIBLE); continue; }
            views.setViewVisibility(COLS[i], View.VISIBLE);
            boolean gone = p.optLong("at") <= now;
            boolean next = !gone && !lifted;
            if (next) lifted = true;
            /* the ones gone fainter; five narrow columns, so the time without its ص or م */
            int colour = gone ? 0x99FFFFFF : 0xFFFFFFFF;
            WidgetText.put(context, views, NAMES[i], p.optString("label"), WidgetText.SKY_COLUMN.colored(colour), all, 0);
            WidgetText.put(context, views, TIMES[i], p.optString("short", p.optString("clock")), WidgetText.SKY_COLUMN_TIME.colored(colour), all, 0);
            views.setInt(COLS[i], "setBackgroundResource", next ? R.drawable.widget_pill : 0);
            views.setViewVisibility(MARKS[i], p.optBoolean("prayed") ? View.VISIBLE : View.INVISIBLE);
        }
        return views;
    }
}
