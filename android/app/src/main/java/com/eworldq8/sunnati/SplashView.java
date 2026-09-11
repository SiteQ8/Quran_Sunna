package com.eworldq8.sunnati;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.view.View;

/**
 * What the reader sees while the mushaf loads: the app's own paper with its
 * mark and its name, drawn in the app's own face. The picture is rendered at
 * build time by tools/store/splash.mjs, where the site's fonts can be read,
 * since android cannot open a woff2 face itself.
 */
final class SplashView extends View {

    static final String PREFS = "sunnati_splash";
    static final String KEY_PLACE = "place";

    private final Drawable art;
    private final String greeting;
    private final android.graphics.Paint words = new android.graphics.Paint(
        android.graphics.Paint.ANTI_ALIAS_FLAG);

    SplashView(Context context) {
        super(context);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        setBackgroundColor(night ? 0xFF10161A : 0xFFF6F4EE);
        /* Named, not looked up by string. The lookup hid the artwork from
           every tool that reads this source: lint reported both pictures as
           unused resources and would have shrunk them out of a release. */
        art = context.getDrawable(night ? R.drawable.splash_art_night : R.drawable.splash_art);

        String place = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_PLACE, null);
        /* On the very first launch nobody has told us a city, and a greeting
           with a blank in it is worse than one without the name. */
        greeting = (place == null || place.isEmpty()) ? "حيّاك الله" : "حيّاك الله في " + place;
        words.setColor(night ? 0xBBBB9036 : 0xBBB08833);
        words.setTextAlign(android.graphics.Paint.Align.CENTER);

        setAlpha(0f);
        animate().alpha(1f).setDuration(260).start();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (art == null) return;
        /* the picture is square and sits in the middle, as wide as the screen
           allows without crowding its edges */
        int side = (int) (Math.min(getWidth(), getHeight()) * 0.86f);
        int left = (getWidth() - side) / 2;
        int top = (getHeight() - side) / 2;
        art.setBounds(left, top, left + side, top + side);
        art.draw(canvas);

        /* The picture is a square with its drawing centred in it, so the name
           ends above the square's foot. The greeting is placed against where
           the name ends rather than against the edge of the file. */
        words.setTextSize(Math.max(30f, Math.min(getWidth(), getHeight()) * 0.040f));
        canvas.drawText(greeting, getWidth() / 2f,
            top + side * 0.88f + words.getTextSize() * 1.5f, words);
    }
}
