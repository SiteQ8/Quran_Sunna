package com.eworldq8.sunnati;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.view.View;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * What the reader sees while the mushaf loads: a painting of their own
 * country at their own hour, the app's icon over its sky, and a greeting by
 * name under the icon.
 *
 * The country is read from the phone's time zone, which needs no permission
 * and is right before the page has said anything. Asia/Kuwait, Asia/Riyadh,
 * Asia/Dubai, Asia/Qatar, Asia/Bahrain and Asia/Muscat each have a landmark
 * of their own, and every other zone gets the open shore. Day runs from 05:00
 * to 17:59 by the phone's clock and every other hour is night. The hour, not
 * the dark theme, chooses the painting, the icon picture and the colours of
 * the greeting, since a painting of the night sky at noon reads as wrong
 * whatever the theme says.
 *
 * The paintings are 1080x1920 webps in drawable-nodpi, made from the masters
 * by tools/android/splash-bg.py. Each is named below through R.drawable and
 * never looked up by a string, so lint and the shrinker both see every one of
 * them used. The icon is splash_art by day, with a soft shadow, and
 * splash_art_night by night, with a faint warm glow: the rounded icon on
 * transparency, 886 of its 1080 pixels and centred, and it carries the name
 * سُنّتي itself. The greeting is drawn here, because it names a city that no
 * picture could know.
 *
 * The greeting is drawn in the app's own face, IBM Plex Sans Arabic, bundled
 * as a subset in assets/fonts. Before this it was left to the system face,
 * which on many phones rendered the arabic in something that did not belong
 * with the rest of the screen.
 */
final class SplashView extends View {

    static final String PREFS = "sunnati_splash";
    static final String KEY_PLACE = "place";

    /* the icon itself is 132dp across, and its picture is wider by the room
       it keeps around the icon for the shadow or the glow */
    private static final float ICON_DP = 132f;
    private static final float ART_PER_ICON = 1080f / 886f;
    /* the centre of the icon, as a share of the height: up in the calm sky
       that fills the top of every painting, with the landmark low down. Only
       the spire of the Kuwait Towers reaches as high as the greeting, and the
       soft shadow behind the words keeps them clear of it. */
    private static final float ICON_AT = 0.42f;

    private final Drawable painting;
    private final Drawable art;
    private final String hail;       // «حيّ الله أهل» or «حيّاكم الله»
    private final String city;       // the place, on its own line, or empty
    private final Paint hailPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint cityPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint rulePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float dp;

    /* worked out for the size of the view in onSizeChanged, so that onDraw
       only draws and allocates nothing */
    private float midX;
    private float ruleLeft, ruleTop, ruleRight, ruleBottom;
    private float hailY, cityY;

    SplashView(Context context) {
        super(context);
        dp = getResources().getDisplayMetrics().density;
        boolean day = isDay(Calendar.getInstance().get(Calendar.HOUR_OF_DAY));
        /* the sky of the hour in one flat colour, which is what shows under
           the painting until the painting draws */
        setBackgroundColor(day ? 0xFFCFE2F1 : 0xFF0D1B3D);
        painting = context.getDrawable(paintingFor(TimeZone.getDefault().getID(), day));
        art = context.getDrawable(day ? R.drawable.splash_art : R.drawable.splash_art_night);
        /* the icon is drawn at well under half of its picture's size, and
           plain filtering would leave its name and its frame shimmering at
           the edges; a mipmap keeps them smooth */
        if (art instanceof BitmapDrawable) ((BitmapDrawable) art).setMipMap(true);

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

        /* the hail in gold and the city in the ink of the hour, larger, so the
           eye lands on where it is. By day the words sit on a pale sky with a
           soft light halo behind them, and by night on a dark one with a soft
           shadow, so they hold wherever the painting is busier. */
        int gold = day ? 0xFFA87B25 : 0xFFE2C06A;
        int shade = day ? 0x8CFFFFFF : 0x99000000;
        hailPaint.setTypeface(plex);
        hailPaint.setColor(gold);
        hailPaint.setTextAlign(Paint.Align.CENTER);
        hailPaint.setShadowLayer(6 * dp, 0, day ? 0 : dp, shade);
        cityPaint.setTypeface(plex);
        cityPaint.setColor(day ? 0xFF16241C : 0xFFF3EFE6);
        cityPaint.setTextAlign(Paint.Align.CENTER);
        cityPaint.setShadowLayer(6 * dp, 0, day ? 0 : dp, shade);
        /* a short rule in the same gold between the icon and the words */
        rulePaint.setColor(gold);

        setAlpha(0f);
        animate().alpha(1f).setDuration(300).start();
    }

    /** Day is 05:00 to 17:59 on the phone's own clock, and the rest is night. */
    static boolean isDay(int hour) {
        return hour >= 5 && hour < 18;
    }

    /** The painting for the phone's time zone at the hour: a landmark for each
     *  of the six countries, and the open shore for every other zone. */
    static int paintingFor(String zone, boolean day) {
        switch (zone == null ? "" : zone) {
            case "Asia/Kuwait":
                return day ? R.drawable.splash_bg_kw_day : R.drawable.splash_bg_kw_night;
            case "Asia/Riyadh":
                return day ? R.drawable.splash_bg_sa_day : R.drawable.splash_bg_sa_night;
            case "Asia/Dubai":
                return day ? R.drawable.splash_bg_ae_day : R.drawable.splash_bg_ae_night;
            case "Asia/Qatar":
                return day ? R.drawable.splash_bg_qa_day : R.drawable.splash_bg_qa_night;
            case "Asia/Bahrain":
                return day ? R.drawable.splash_bg_bh_day : R.drawable.splash_bg_bh_night;
            case "Asia/Muscat":
                return day ? R.drawable.splash_bg_om_day : R.drawable.splash_bg_om_night;
            default:
                return day ? R.drawable.splash_bg_default_day : R.drawable.splash_bg_default_night;
        }
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        midX = w / 2f;

        /* The painting fills the view and keeps its proportions. It is centred
           across and anchored at its foot, so a tall phone loses a little of
           each side and a wide one loses the top of the sky, and the landmark
           low down is always whole. */
        if (painting != null) {
            int pw = painting.getIntrinsicWidth();
            int ph = painting.getIntrinsicHeight();
            if (pw > 0 && ph > 0) {
                float scale = Math.max((float) w / pw, (float) h / ph);
                int sw = Math.round(pw * scale);
                int sh = Math.round(ph * scale);
                int across = Math.round((w - sw) / 2f);
                painting.setBounds(across, h - sh, across + sw, h);
            }
        }

        /* The icon is centred across with its own centre at 42% of the height,
           in the calm sky above the landmark. */
        float icon = ICON_DP * dp;
        float iconY = h * ICON_AT;
        int side = Math.round(icon * ART_PER_ICON);
        int left = Math.round(midX - side / 2f);
        int top = Math.round(iconY - side / 2f);
        if (art != null) art.setBounds(left, top, left + side, top + side);

        /* Under the icon itself, not under its shadow: the rule, then the
           greeting, the hail first and the city larger under it. A long city
           name is made smaller rather than cut at the edges. */
        float foot = iconY + icon / 2f;
        ruleTop = foot + 18 * dp;
        ruleBottom = ruleTop + 2 * dp;
        ruleLeft = midX - 14 * dp;
        ruleRight = midX + 14 * dp;
        if (city.isEmpty()) {
            hailPaint.setTextSize(23 * dp);
            hailY = ruleBottom + 12 * dp + hailPaint.getTextSize() * 0.85f;
            return;
        }
        hailPaint.setTextSize(18 * dp);
        cityPaint.setTextSize(31 * dp);
        float room = w * 0.86f;
        float wide = cityPaint.measureText(city);
        if (wide > room) cityPaint.setTextSize(cityPaint.getTextSize() * room / wide);
        hailY = ruleBottom + 12 * dp + hailPaint.getTextSize() * 0.85f;
        cityY = hailY + cityPaint.getTextSize() * 1.2f;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (painting != null) painting.draw(canvas);
        if (art != null) art.draw(canvas);
        canvas.drawRoundRect(ruleLeft, ruleTop, ruleRight, ruleBottom, dp, dp, rulePaint);
        canvas.drawText(hail, midX, hailY, hailPaint);
        if (!city.isEmpty()) canvas.drawText(city, midX, cityY, cityPaint);
    }
}
