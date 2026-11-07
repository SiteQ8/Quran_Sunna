package com.eworldq8.sunnati;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** The du'a of the day from the app's book of du'as, with its topic; the
 *  refresh turns to a du'a of another topic, round to the day's own, and a
 *  tap opens the topic of the one shown. */
public final class DuaWidget extends AppWidgetProvider {
    static final String ACTION_NEXT = "com.eworldq8.sunnati.DUA_NEXT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && ACTION_NEXT.equals(intent.getAction())) {
            WidgetStore.turn(context, "dua");
            refresh(context);
            return;
        }
        super.onReceive(context, intent);
    }

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
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, DuaWidget.class));
        if (ids == null || ids.length == 0) return;
        JSONObject all = WidgetStore.all(context);
        JSONArray duas = all == null ? null : all.optJSONArray("duas");
        int span = duas == null ? 0 : duas.length();
        JSONObject dua = span == 0 ? null : duas.optJSONObject(WidgetStore.turned(context, "dua") % span);
        for (int id : ids) {
            manager.updateAppWidget(id, WidgetStore.sized(manager, id, 340f, 170f, size -> fill(context, size, dua, all)));
        }
    }

    private static RemoteViews fill(Context context, android.util.SizeF size, JSONObject dua, JSONObject all) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_dua);
        String open = dua == null ? "widgetDua" : "widgetDua" + dua.optInt("i");
        views.setOnClickPendingIntent(R.id.dua_root, WidgetStore.open(context, open, 7406));
        views.setOnClickPendingIntent(R.id.dua_next, WidgetStore.turnIntent(context, DuaWidget.class, ACTION_NEXT, 7416));
        views.setContentDescription(R.id.dua_next, WidgetStore.word(all, "anotherDua", context.getString(R.string.widgetAnotherDua)));
        views.setViewVisibility(R.id.dua_next, dua == null ? View.GONE : View.VISIBLE);
        WidgetStore.direct(views, R.id.dua_root, all);
        WidgetText.put(context, views, R.id.dua_head, WidgetStore.word(all, "dua", context.getString(R.string.widgetDuaName)),
            WidgetText.PAPER_SMALL_BOLD, all, 0);
        int wrap = WidgetText.px(context, size.getWidth() - 32);
        WidgetText.put(context, views, R.id.dua_topic, dua == null ? "" : dua.optString("n"), WidgetText.PAPER_NOTE_SEMI, all, 0);
        if (dua == null) {
            WidgetText.put(context, views, R.id.dua_text, WidgetStore.word(all, "openApp", context.getString(R.string.widgetOpenApp)),
                WidgetText.PAPER_NOTE_CENTER, all, wrap);
        } else {
            /* the room between the heading and the rule */
            int room = WidgetText.px(context, Math.max(40f, size.getHeight() - 26 - 20 - 10 - 30));
            float most = size.getHeight() >= 260 ? 24f : size.getHeight() >= 180 ? 20f : 17f;
            WidgetText.putFit(context, views, R.id.dua_text, dua.optString("t"), WidgetText.DUA, all, wrap, room, most);
        }
        return views;
    }
}
