package com.eworldq8.sunnati;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/** What the page handed for the widgets, in one piece and in the reader's
 *  language (handWidgetData in docs/js/app.js): seven days, each with its
 *  five prayers, its hijri date, the occasion coming, the turns of its sky,
 *  its ayah and its adhkar; then the khatma. The widgets read it and compute
 *  nothing of their own beyond which part of it is now. */
final class WidgetStore {
    static final String PREFS = "widgets";
    static final String KEY = "data";

    private WidgetStore() {}

    static void save(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
    }

    static JSONObject all(Context context) {
        try {
            String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
            return raw == null ? null : new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static String key(long at) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** The day of the handed week that a moment falls on, or null. */
    static JSONObject day(JSONObject all, long at) {
        if (all == null) return null;
        JSONArray days = all.optJSONArray("days");
        if (days == null) return null;
        String k = key(at);
        for (int i = 0; i < days.length(); i++) {
            JSONObject d = days.optJSONObject(i);
            if (d != null && k.equals(d.optString("date"))) return d;
        }
        return null;
    }

    static String word(JSONObject all, String k, String fallback) {
        JSONObject w = all == null ? null : all.optJSONObject("words");
        String v = w == null ? null : w.optString(k, null);
        return v == null || v.length() == 0 ? fallback : v;
    }

    /** A widget reads the way the app's language reads, not the phone's:
     *  someone who keeps the app in Arabic on a phone set to English still
     *  reads it from the right. Before the app has handed anything, the
     *  layout's own direction, the phone's, stands. */
    static void direct(RemoteViews views, int root, JSONObject all) {
        if (all == null) return;
        String dir = all.optString("dir", "");
        if (dir.length() == 0) {
            String lang = all.optString("lang", "");
            if (lang.length() == 0) return;
            dir = lang.equals("ar") || lang.equals("ur") || lang.equals("fa") ? "rtl" : "ltr";
        }
        views.setInt(root, "setLayoutDirection", "rtl".equals(dir) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR);
    }

    /** The sizes, in dp, a widget is shown at: on Android 12 each one the
     *  launcher says it uses; before, upright and on its side from the
     *  narrowest and widest it may be; nothing said yet, the size it was made
     *  for. The words are drawn as pictures, so each size has its own. */
    static java.util.List<android.util.SizeF> sizes(AppWidgetManager manager, int id, float w, float h) {
        java.util.List<android.util.SizeF> out = new java.util.ArrayList<>();
        android.os.Bundle o = manager.getAppWidgetOptions(id);
        if (o != null && android.os.Build.VERSION.SDK_INT >= 33) {
            java.util.ArrayList<android.util.SizeF> said = o.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES, android.util.SizeF.class);
            if (said != null) for (android.util.SizeF s : said) if (s != null && s.getWidth() > 0 && s.getHeight() > 0) out.add(s);
        } else if (o != null && android.os.Build.VERSION.SDK_INT >= 31) {
            @SuppressWarnings("deprecation")
            java.util.ArrayList<android.util.SizeF> said = o.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
            if (said != null) for (android.util.SizeF s : said) if (s != null && s.getWidth() > 0 && s.getHeight() > 0) out.add(s);
        }
        if (out.isEmpty() && o != null) {
            int minW = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH), maxW = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH);
            int minH = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT), maxH = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);
            if (minW > 0 && maxH > 0) out.add(new android.util.SizeF(minW, maxH));
            if (maxW > 0 && minH > 0) out.add(new android.util.SizeF(maxW, minH));
        }
        if (out.isEmpty()) out.add(new android.util.SizeF(w, h));
        return out;
    }

    interface Drawer { RemoteViews draw(android.util.SizeF size); }

    /** A drawing for every size the widget is shown at, and the launcher
     *  takes the one that fits; before Android 12 the upright one and the one
     *  on its side. */
    static RemoteViews sized(AppWidgetManager manager, int id, float w, float h, Drawer drawer) {
        java.util.List<android.util.SizeF> sizes = sizes(manager, id, w, h);
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            java.util.Map<android.util.SizeF, RemoteViews> map = new java.util.HashMap<>();
            for (android.util.SizeF s : sizes) if (map.size() < 16 && !map.containsKey(s)) map.put(s, drawer.draw(s));
            return new RemoteViews(map);
        }
        RemoteViews upright = drawer.draw(sizes.get(0));
        return sizes.size() < 2 ? upright : new RemoteViews(drawer.draw(sizes.get(1)), upright);
    }

    /** Too low for the card, which needs the given height: a row instead.
     *  A launcher's one row is about a hundred dp high and two rows of a
     *  phone on its side about a hundred and twenty, and the card of the
     *  next prayer needs some hundred and fifty for its name, time,
     *  countdown and bar at the largest text the widgets allow. */
    static boolean oneRow(android.util.SizeF size, float card) {
        return size.getHeight() < card;
    }

    /** A count the widget makes itself, in the figures of the reader's
     *  language: Bengali and Persian have their own, and the page hands them. */
    static String figures(JSONObject all, String text) {
        String digits = all == null ? null : all.optString("digits", null);
        if (digits == null || digits.length() != 10 || digits.equals("0123456789")) return text;
        StringBuilder out = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            out.append(c >= '0' && c <= '9' ? digits.charAt(c - '0') : c);
        }
        return out.toString();
    }

    /** Every prayer of the week in order, the ones gone included. */
    static JSONObject[] prayers(JSONObject all) {
        java.util.List<JSONObject> out = new java.util.ArrayList<>();
        JSONArray days = all == null ? null : all.optJSONArray("days");
        if (days != null) {
            for (int i = 0; i < days.length(); i++) {
                JSONArray five = days.optJSONObject(i) == null ? null : days.optJSONObject(i).optJSONArray("five");
                if (five == null) continue;
                for (int j = 0; j < five.length(); j++) if (five.optJSONObject(j) != null) out.add(five.optJSONObject(j));
            }
        }
        return out.toArray(new JSONObject[0]);
    }

    /** The prayer gone and the prayer coming, around a moment. */
    static JSONObject[] around(JSONObject all, long now) {
        JSONObject[] list = prayers(all);
        for (int i = 0; i < list.length; i++) {
            if (list[i].optLong("at") > now) return new JSONObject[] { i > 0 ? list[i - 1] : null, list[i] };
        }
        return new JSONObject[] { list.length > 0 ? list[list.length - 1] : null, null };
    }

    /* The painting the sky is nearest at a moment: each turn of the day is
       the painting of its stop, and it changes halfway between two stops,
       as the app's own sky does. */
    static String skyName(JSONObject day, long now) {
        JSONArray s = day == null ? null : day.optJSONArray("sky");
        if (s == null || s.length() == 0) return skyByHour(now);
        String name = s.optJSONArray(0).optString(1, "night");
        for (int i = 1; i < s.length(); i++) {
            long mid = (s.optJSONArray(i - 1).optLong(0) + s.optJSONArray(i).optLong(0)) / 2;
            if (now >= mid) name = s.optJSONArray(i).optString(1, name);
        }
        return name;
    }

    /** When the painting next changes, or 0. */
    static long nextSkyTurn(JSONObject day, long now) {
        JSONArray s = day == null ? null : day.optJSONArray("sky");
        if (s == null) return 0;
        for (int i = 1; i < s.length(); i++) {
            long mid = (s.optJSONArray(i - 1).optLong(0) + s.optJSONArray(i).optLong(0)) / 2;
            if (mid > now) return mid;
        }
        return 0;
    }

    private static String skyByHour(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        int h = c.get(Calendar.HOUR_OF_DAY);
        if (h < 4 || h >= 20) return "night";
        if (h < 6) return "fajr";
        if (h < 7) return "sunrise";
        if (h < 11) return "morning";
        if (h < 14) return "noon";
        if (h < 17) return "afternoon";
        if (h < 18) return "sunset";
        return "dusk";
    }

    static int skyDrawable(String name) {
        switch (name) {
            case "fajr": return R.drawable.widget_sky_fajr;
            case "sunrise": return R.drawable.widget_sky_sunrise;
            case "morning": return R.drawable.widget_sky_morning;
            case "noon": return R.drawable.widget_sky_noon;
            case "afternoon": return R.drawable.widget_sky_afternoon;
            case "sunset": return R.drawable.widget_sky_sunset;
            case "dusk": return R.drawable.widget_sky_dusk;
            default: return R.drawable.widget_sky_night;
        }
    }

    /** The adhkar of the part of the day a moment falls in; the night's run
     *  past midnight, so yesterday's are asked too. */
    static JSONObject adhkarAt(JSONObject all, long now) {
        for (long back : new long[] { 0, 86400000L }) {
            JSONObject d = day(all, now - back);
            JSONArray a = d == null ? null : d.optJSONArray("adhkar");
            if (a == null) continue;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && o.optLong("from") <= now && now < o.optLong("to")) return o;
            }
        }
        return null;
    }

    /** A tap that opens the app on the widget's own subject; the page reads
     *  the kind as it reads a tapped reminder's. */
    static PendingIntent open(Context context, String kind, int request) {
        Intent open = new Intent(context, MainActivity.class);
        open.putExtra("kind", kind);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, request, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static String clock(Context context, long at) {
        return android.text.format.DateFormat.getTimeFormat(context).format(new java.util.Date(at));
    }
}
