package com.eworldq8.sunnati;

import android.content.Context;

/** The place the app greets with, for the widgets when the page has handed
 *  no name of its own yet. */
final class WidgetData {
    private WidgetData() {}

    static String place(Context context) {
        return context.getSharedPreferences(SplashView.PREFS, Context.MODE_PRIVATE)
            .getString(SplashView.KEY_PLACE, "");
    }
}
