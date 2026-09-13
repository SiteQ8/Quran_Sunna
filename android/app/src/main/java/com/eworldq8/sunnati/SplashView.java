package com.eworldq8.sunnati;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.view.View;

/**
 * What the reader sees while the mushaf loads: the app's own paper, its mark,
 * and a greeting by name. The mark and the word سُنّتي are baked into the
 * picture at build time by tools/store/splash.mjs; the greeting is drawn here,
 * because it names a city the picture could not know.
 *
 * The greeting is drawn in the app's own face, IBM Plex Sans Arabic, bundled
 * as a subset in assets/fonts. Before this it was left to the system face,
 * which on many phones rendered the arabic in something that did not belong
 * with the rest of the screen.
 */
final class SplashView extends View {

    static final String PREFS = "sunnati_splash";
    static final String KEY_PLACE = "place";

    private final Drawable art;
    private final String hail;       // «حيّ الله أهل» or «حيّاكم الله»
    private final String city;       // the place, on its own line, or empty
    private final Paint hailPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint cityPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final boolean night;

    SplashView(Context context) {
        super(context);
        night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        setBackgroundColor(night ? 0xFF10161A : 0xFFF6F4EE);
        art = context.getDrawable(night ? R.drawable.splash_art_night : R.drawable.splash_art);

        String place = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_PLACE, null);
        boolean has = place != null && !place.isEmpty();
        /* «حيّ الله أهل الكويت» over two lines when a city is known, and a
           single «حيّاكم الله» to nobody in particular when it is not */
        hail = has ? "حيّ الله أهل" : "حيّاكم الله";
        city = has ? place : "";

        Typeface plex = Typeface.DEFAULT_BOLD;
        try {
            plex = Typeface.createFromAsset(context.getAssets(), "fonts/plex-arabic-semibold.ttf");
        } catch (Exception e) { /* the system face, rather than nothing */ }

        /* the hail in the muted gold of the rule under the name; the city in
           the ink of the words, larger, so the eye lands on where it is */
        hailPaint.setTypeface(plex);
        hailPaint.setColor(night ? 0xCCBB9036 : 0xCCB08833);
        hailPaint.setTextAlign(Paint.Align.CENTER);
        cityPaint.setTypeface(plex);
        cityPaint.setColor(night ? 0xFFEDE9E1 : 0xFF16241C);
        cityPaint.setTextAlign(Paint.Align.CENTER);

        setAlpha(0f);
        animate().alpha(1f).setDuration(300).start();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int w = getWidth();
        int h = getHeight();
        float unit = Math.min(w, h);
        if (art == null) return;

        /* The picture holds the mark and the name سُنّتي. It sits a little above
           the middle so the greeting below has room and the whole reads as one
           centred column. */
        int side = (int) (unit * 0.72f);
        int left = (w - side) / 2;
        int top = (int) (h * 0.40f) - side / 2;
        art.setBounds(left, top, left + side, top + side);
        art.draw(canvas);

        /* The name ends around fifth-sixths down the square. The greeting hangs
           beneath that, the hail first and the city larger under it. */
        float y = top + side * 0.86f;
        if (city.isEmpty()) {
            hailPaint.setTextSize(unit * 0.058f);
            canvas.drawText(hail, w / 2f, y + hailPaint.getTextSize() * 1.4f, hailPaint);
            return;
        }
        hailPaint.setTextSize(unit * 0.046f);
        cityPaint.setTextSize(unit * 0.080f);
        canvas.drawText(hail, w / 2f, y + hailPaint.getTextSize() * 1.4f, hailPaint);
        canvas.drawText(city, w / 2f,
            y + hailPaint.getTextSize() * 1.4f + cityPaint.getTextSize() * 1.25f, cityPaint);
    }
}
