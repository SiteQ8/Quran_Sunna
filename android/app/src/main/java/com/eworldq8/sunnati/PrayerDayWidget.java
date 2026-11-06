package com.eworldq8.sunnati;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.text.SpannableString;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import java.util.List;

/** The five prayers ahead, each with its time, the next one marked, under
 *  the day and its hijri date: the wide widget, four cells by two. */
public final class PrayerDayWidget extends AppWidgetProvider {
    private static final int[] NAMES = { R.id.day_name_0, R.id.day_name_1, R.id.day_name_2, R.id.day_name_3, R.id.day_name_4 };
    private static final int[] TIMES = { R.id.day_time_0, R.id.day_time_1, R.id.day_time_2, R.id.day_time_3, R.id.day_time_4 };
    private static final int[] ROWS = { R.id.day_row_0, R.id.day_row_1, R.id.day_row_2, R.id.day_row_3, R.id.day_row_4 };

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

    private static CharSequence bold(String text, boolean on) {
        if (!on) return text;
        SpannableString s = new SpannableString(text);
        s.setSpan(new StyleSpan(Typeface.BOLD), 0, s.length(), 0);
        return s;
    }

    private static void draw(Context context, AppWidgetManager manager, int[] ids) {
        List<WidgetData.Row> rows = WidgetData.ahead(context, System.currentTimeMillis());
        String place = WidgetData.place(context);
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_day);
            Intent open = new Intent(context, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            views.setOnClickPendingIntent(R.id.day_root,
                PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            if (rows.isEmpty()) {
                views.setTextViewText(R.id.day_title, "افتح التطبيق لحساب الأوقات");
                views.setTextViewText(R.id.day_place, "");
                for (int r : ROWS) views.setViewVisibility(r, View.GONE);
            } else {
                WidgetData.Row first = rows.get(0);
                String title = (first.day.length() > 0 ? first.day + "  " : "") + first.hijri;
                views.setTextViewText(R.id.day_title, title.trim().length() > 0 ? title.trim() : first.head);
                views.setTextViewText(R.id.day_place, place);
                for (int i = 0; i < ROWS.length; i++) {
                    if (i >= rows.size()) { views.setViewVisibility(ROWS[i], View.GONE); continue; }
                    WidgetData.Row r = rows.get(i);
                    views.setViewVisibility(ROWS[i], View.VISIBLE);
                    views.setTextViewText(NAMES[i], bold(r.label, i == 0));
                    views.setTextViewText(TIMES[i], bold(r.clock, i == 0));
                    int color = context.getColor(i == 0 ? R.color.widgetAccent : R.color.widgetInk);
                    views.setTextColor(NAMES[i], color);
                    views.setTextColor(TIMES[i], color);
                }
            }
            manager.updateAppWidget(id, views);
        }
    }
}
