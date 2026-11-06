package com.eworldq8.sunnati;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** The prayers still ahead, as the page last handed them to the adhan, with
 *  the words the widgets show in the reader's own language. Every widget
 *  reads them from here, so none of them computes a time of its own. */
final class WidgetData {
    static final class Row {
        long at;
        String key, label, clock, head, day, hijri;
        boolean ramadan;
    }

    private WidgetData() {}

    static List<Row> ahead(Context context, long now) {
        List<Row> out = new ArrayList<>();
        try {
            String stored = context.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE)
                .getString(AdhanScheduler.KEY_TIMES, null);
            if (stored == null) return out;
            JSONArray list = new JSONArray(stored);
            for (int i = 0; i < list.length(); i++) {
                JSONObject o = list.getJSONObject(i);
                long at = o.getLong("at");
                if (at <= now) continue;
                Row r = new Row();
                r.at = at;
                r.key = o.optString("key", "");
                r.label = o.optString("label", o.optString("name", ""));
                r.clock = o.optString("clock", "");
                if (r.clock.length() == 0) {
                    r.clock = android.text.format.DateFormat.getTimeFormat(context).format(new java.util.Date(at));
                }
                r.head = o.optString("head", "الصلاة القادمة");
                r.day = o.optString("day", "");
                r.hijri = o.optString("hijri", "");
                r.ramadan = o.optBoolean("ramadan", false);
                out.add(r);
            }
        } catch (Exception ignored) { /* nothing to show until the app opens again */ }
        return out;
    }

    static String place(Context context) {
        return context.getSharedPreferences(SplashView.PREFS, Context.MODE_PRIVATE)
            .getString(SplashView.KEY_PLACE, "");
    }
}
