package com.eworldq8.sunnati;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.drawable.Drawable;
import android.view.View;

/**
 * What the reader sees while the mushaf loads: the app's own paper with its
 * mark and its name, drawn in the app's own face. The picture is rendered at
 * build time by tools/store/splash.mjs, where the site's fonts can be read,
 * since android cannot open a woff2 face itself.
 *
 * Two things are drawn here instead of in the picture, because a picture made
 * at build time cannot know them: the greeting, which names the city the
 * reader was last in, and the سدو selvedge along the bottom edge, which wants
 * the width of the actual screen rather than the width of a square.
 */
final class SplashView extends View {

    static final String PREFS = "sunnati_splash";
    static final String KEY_PLACE = "place";

    private final Drawable art;
    private final boolean night;
    private final String greeting;
    private final Paint words = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint weave = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path selvedge = new Path();

    SplashView(Context context) {
        super(context);
        night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
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
        words.setTextAlign(Paint.Align.CENTER);
        weave.setColor(night ? 0x22EDE9E1 : 0x1F8F2323);

        setAlpha(0f);
        animate().alpha(1f).setDuration(260).start();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int w = getWidth();
        int h = getHeight();

        if (art != null) {
            /* the picture is square and sits a little above the middle, so the
               greeting below it has room without either looking crowded */
            int side = (int) (Math.min(w, h) * 0.74f);
            int left = (w - side) / 2;
            int top = (int) (h * 0.44f) - side / 2;
            art.setBounds(left, top, left + side, top + side);
            art.draw(canvas);

            /* The picture is a square with the drawing centred in it, so the
               name ends well above the square's foot. The greeting is placed
               against where the name actually ends, not against the edge of
               the file, or it drifts far down the screen on its own. */
            words.setTextSize(Math.max(30f, Math.min(w, h) * 0.042f));
            float nameEnds = top + side * 0.84f;
            canvas.drawText(greeting, w / 2f, nameEnds + words.getTextSize() * 1.6f, words);
        }

        drawSelvedge(canvas, w, h);
    }

    /** The edge of a سدو rug, a row of the same tooth the mark is made of,
     *  laid along the foot of the screen. */
    private void drawSelvedge(Canvas canvas, int w, int h) {
        float tooth = Math.max(22f, w / 18f);
        float height = tooth * 0.75f;
        float base = h - tooth * 0.5f;
        selvedge.reset();
        selvedge.moveTo(0, base);
        for (float x = 0; x < w + tooth; x += tooth) {
            selvedge.lineTo(x + tooth / 2f, base - height);
            selvedge.lineTo(x + tooth, base);
        }
        selvedge.lineTo(w, h);
        selvedge.lineTo(0, h);
        selvedge.close();
        canvas.drawPath(selvedge, weave);
    }
}
