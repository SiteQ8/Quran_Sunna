package com.eworldq8.sunnati;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.view.View;

/**
 * What the reader sees while the mushaf loads: the app's own paper with its
 * mark and its name, drawn in the app's own face. The picture is rendered at
 * build time by tools/store/splash.mjs, where the site's fonts can be read,
 * since android cannot open a woff2 face itself.
 */
final class SplashView extends View {

    private final Drawable art;

    SplashView(Context context) {
        super(context);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        setBackgroundColor(night ? 0xFF10161A : 0xFFF6F4EE);
        int id = getResources().getIdentifier(night ? "splash_art_night" : "splash_art",
            "drawable", context.getPackageName());
        art = id == 0 ? null : context.getDrawable(id);
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
        art.setBounds(new Rect(left, top, left + side, top + side));
        art.draw(canvas);
    }
}
