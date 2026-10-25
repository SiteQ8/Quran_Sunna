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
 * and is right before the page has said anything. The six Gulf states,
 * Egypt, India, Iraq, Jordan, Morocco, Algeria, Syria, Yemen, Libya,
 * Indonesia, Malaysia, Turkey, Pakistan, Bangladesh and Nigeria each have a
 * landmark of their own, by every zone the country keeps, and every other
 * zone gets the open shore. Day runs from 05:00
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
       that fills the top of every painting, with the landmark low down. It is
       the lowest the icon stands, and it goes higher whenever the landmark
       rises near the words, as the Kuwait Towers do. */
    private static final float ICON_AT = 0.42f;
    /* and the highest it goes, so it is never pressed against the top */
    private static final float ICON_HIGHEST = 0.2f;
    /* the open sky kept between the foot of the words and the top of the
       landmark, so no spire or dome ever runs into a word */
    private static final float CLEAR_DP = 40f;

    private final Drawable painting;
    private final float[] landmark;  // its middle across and its top, from landmarkFor
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
        String zone = TimeZone.getDefault().getID();
        painting = context.getDrawable(paintingFor(zone, day));
        landmark = landmarkFor(zone, day);
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
            case "Africa/Cairo":
                return day ? R.drawable.splash_bg_eg_day : R.drawable.splash_bg_eg_night;
            case "Asia/Kolkata":
                return day ? R.drawable.splash_bg_in_day : R.drawable.splash_bg_in_night;
            case "Asia/Calcutta":
                return day ? R.drawable.splash_bg_in_day : R.drawable.splash_bg_in_night;
            case "Asia/Baghdad":
                return day ? R.drawable.splash_bg_iq_day : R.drawable.splash_bg_iq_night;
            case "Asia/Amman":
                return day ? R.drawable.splash_bg_jo_day : R.drawable.splash_bg_jo_night;
            case "Africa/Casablanca":
                return day ? R.drawable.splash_bg_ma_day : R.drawable.splash_bg_ma_night;
            case "Africa/Algiers":
                return day ? R.drawable.splash_bg_dz_day : R.drawable.splash_bg_dz_night;
            case "Asia/Damascus":
                return day ? R.drawable.splash_bg_sy_day : R.drawable.splash_bg_sy_night;
            case "Asia/Aden":
                return day ? R.drawable.splash_bg_ye_day : R.drawable.splash_bg_ye_night;
            case "Africa/Tripoli":
                return day ? R.drawable.splash_bg_ly_day : R.drawable.splash_bg_ly_night;
            case "Asia/Jakarta":
                return day ? R.drawable.splash_bg_id_day : R.drawable.splash_bg_id_night;
            case "Asia/Pontianak":
                return day ? R.drawable.splash_bg_id_day : R.drawable.splash_bg_id_night;
            case "Asia/Makassar":
                return day ? R.drawable.splash_bg_id_day : R.drawable.splash_bg_id_night;
            case "Asia/Jayapura":
                return day ? R.drawable.splash_bg_id_day : R.drawable.splash_bg_id_night;
            case "Asia/Kuala_Lumpur":
                return day ? R.drawable.splash_bg_my_day : R.drawable.splash_bg_my_night;
            case "Asia/Kuching":
                return day ? R.drawable.splash_bg_my_day : R.drawable.splash_bg_my_night;
            case "Europe/Istanbul":
                return day ? R.drawable.splash_bg_tr_day : R.drawable.splash_bg_tr_night;
            case "Asia/Istanbul":
                return day ? R.drawable.splash_bg_tr_day : R.drawable.splash_bg_tr_night;
            case "Asia/Karachi":
                return day ? R.drawable.splash_bg_pk_day : R.drawable.splash_bg_pk_night;
            case "Asia/Dhaka":
                return day ? R.drawable.splash_bg_bd_day : R.drawable.splash_bg_bd_night;
            case "Asia/Dacca":
                return day ? R.drawable.splash_bg_bd_day : R.drawable.splash_bg_bd_night;
            case "Africa/Lagos":
                return day ? R.drawable.splash_bg_ng_day : R.drawable.splash_bg_ng_night;
            default:
                return day ? R.drawable.splash_bg_default_day : R.drawable.splash_bg_default_night;
        }
    }

    /** Where the landmark of each painting stands, read off the paintings in
     *  drawable-nodpi: the middle of it across, as a share of the painting's
     *  width, and its top, as a share of the painting's height. The middle is
     *  where the landmark's own weight centres, the three towers of Kuwait
     *  taken together and not the tallest alone, and the top is the highest
     *  point of it that can come under the words: the spire of the tallest
     *  tower, the dome between the minarets, the crown of the fort or the
     *  mountains behind it. */
    static float[] landmarkFor(String zone, boolean day) {
        switch (zone == null ? "" : zone) {
            case "Asia/Kuwait":
                return day ? new float[] { 0.512f, 0.512f } : new float[] { 0.53f, 0.546f };
            case "Asia/Riyadh":
                return day ? new float[] { 0.53f, 0.665f } : new float[] { 0.56f, 0.655f };
            case "Asia/Dubai":
                return day ? new float[] { 0.5f, 0.65f } : new float[] { 0.5f, 0.65f };
            case "Asia/Qatar":
                return day ? new float[] { 0.49f, 0.633f } : new float[] { 0.53f, 0.64f };
            case "Asia/Bahrain":
                return day ? new float[] { 0.53f, 0.675f } : new float[] { 0.52f, 0.702f };
            case "Asia/Muscat":
                return day ? new float[] { 0.49f, 0.643f } : new float[] { 0.5f, 0.651f };
            case "Africa/Cairo":
                return day ? new float[] { 0.495f, 0.556f } : new float[] { 0.509f, 0.571f };
            case "Asia/Kolkata":
                return day ? new float[] { 0.511f, 0.546f } : new float[] { 0.509f, 0.579f };
            case "Asia/Calcutta":
                return day ? new float[] { 0.511f, 0.546f } : new float[] { 0.509f, 0.579f };
            case "Asia/Baghdad":
                return day ? new float[] { 0.579f, 0.555f } : new float[] { 0.556f, 0.564f };
            case "Asia/Amman":
                return day ? new float[] { 0.498f, 0.569f } : new float[] { 0.496f, 0.588f };
            case "Africa/Casablanca":
                return day ? new float[] { 0.51f, 0.496f } : new float[] { 0.539f, 0.54f };
            case "Africa/Algiers":
                return day ? new float[] { 0.493f, 0.519f } : new float[] { 0.556f, 0.499f };
            case "Asia/Damascus":
                return day ? new float[] { 0.476f, 0.556f } : new float[] { 0.448f, 0.583f };
            case "Asia/Aden":
                return day ? new float[] { 0.473f, 0.541f } : new float[] { 0.514f, 0.586f };
            case "Africa/Tripoli":
                return day ? new float[] { 0.533f, 0.57f } : new float[] { 0.531f, 0.571f };
            case "Asia/Jakarta":
                return day ? new float[] { 0.653f, 0.536f } : new float[] { 0.629f, 0.584f };
            case "Asia/Pontianak":
                return day ? new float[] { 0.653f, 0.536f } : new float[] { 0.629f, 0.584f };
            case "Asia/Makassar":
                return day ? new float[] { 0.653f, 0.536f } : new float[] { 0.629f, 0.584f };
            case "Asia/Jayapura":
                return day ? new float[] { 0.653f, 0.536f } : new float[] { 0.629f, 0.584f };
            case "Asia/Kuala_Lumpur":
                return day ? new float[] { 0.59f, 0.53f } : new float[] { 0.594f, 0.559f };
            case "Asia/Kuching":
                return day ? new float[] { 0.59f, 0.53f } : new float[] { 0.594f, 0.559f };
            case "Europe/Istanbul":
                return day ? new float[] { 0.512f, 0.541f } : new float[] { 0.498f, 0.611f };
            case "Asia/Istanbul":
                return day ? new float[] { 0.512f, 0.541f } : new float[] { 0.498f, 0.611f };
            case "Asia/Karachi":
                return day ? new float[] { 0.508f, 0.588f } : new float[] { 0.491f, 0.645f };
            case "Asia/Dhaka":
                return day ? new float[] { 0.471f, 0.688f } : new float[] { 0.493f, 0.745f };
            case "Asia/Dacca":
                return day ? new float[] { 0.471f, 0.688f } : new float[] { 0.493f, 0.745f };
            case "Africa/Lagos":
                return day ? new float[] { 0.527f, 0.557f } : new float[] { 0.501f, 0.613f };
            default:
                return day ? new float[] { 0.51f, 0.72f } : new float[] { 0.515f, 0.712f };
        }
    }

    /** Where everything stands in a view w by h, for words that reach `reach`
     *  below the middle of the icon: that middle, down from the top, then the
     *  painting's left, top, width and height. Plain arithmetic, so a test can
     *  run it without android.
     *
     *  The painting fills the view and keeps its proportions, standing on its
     *  foot so the landmark low down is always whole. It is moved across until
     *  the landmark stands under the icon, and made a little wider when that
     *  would bare an edge. The icon and the words then rise into the sky as far
     *  as they must for the landmark to stand below them with open sky between.
     *  Only on a phone too short for that does the painting come down instead,
     *  over the water or the ground at its foot. */
    static float[] place(float w, float h, float dp, float reach, float[] landmark, float pw, float ph) {
        float across = landmark[0];
        float rises = landmark[1];
        float clear = CLEAR_DP * dp;
        float scale = Math.max(Math.max(w / pw, h / ph), w / (2f * Math.min(across, 1f - across) * pw));
        float sw = pw * scale;
        float sh = ph * scale;
        float y = h - sh;
        float landTop = y + rises * sh;
        float iconY = Math.max(h * ICON_HIGHEST, Math.min(h * ICON_AT, landTop - clear - reach));
        float lacking = iconY + reach + clear - landTop;
        if (lacking > 0) {
            float down = Math.min(lacking, -y);
            y += down;
            if (lacking > down) {
                sh = (iconY + reach + clear) / rises;
                sw = sh * pw / ph;
                y = 0;
            }
        }
        float x = Math.min(0f, Math.max(w - sw, w / 2f - across * sw));
        return new float[] { iconY, x, y, sw, sh };
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        midX = w / 2f;

        /* The words are sized first, since how far they reach below the icon
           decides how high the icon must stand. A long city name is made
           smaller rather than cut at the edges. */
        float icon = ICON_DP * dp;
        if (city.isEmpty()) {
            hailPaint.setTextSize(23 * dp);
        } else {
            hailPaint.setTextSize(18 * dp);
            cityPaint.setTextSize(31 * dp);
            float room = w * 0.86f;
            float wide = cityPaint.measureText(city);
            if (wide > room) cityPaint.setTextSize(cityPaint.getTextSize() * room / wide);
        }
        /* from the middle of the icon to the foot of the last word: half the
           icon, the rule with the space around it, the hail, and the city */
        float toHail = icon / 2f + 32 * dp + hailPaint.getTextSize() * 0.85f;
        float reach = city.isEmpty() ? toHail + hailPaint.descent()
            : toHail + cityPaint.getTextSize() * 1.2f + cityPaint.descent();

        float iconY = h * ICON_AT;
        if (painting != null) {
            int pw = painting.getIntrinsicWidth();
            int ph = painting.getIntrinsicHeight();
            if (pw > 0 && ph > 0) {
                float[] at = place(w, h, dp, reach, landmark, pw, ph);
                iconY = at[0];
                painting.setBounds(Math.round(at[1]), Math.round(at[2]),
                    Math.round(at[1] + at[3]), Math.round(at[2] + at[4]));
            }
        }

        /* the icon centred across, its middle where the landmark left it */
        int side = Math.round(icon * ART_PER_ICON);
        int left = Math.round(midX - side / 2f);
        int top = Math.round(iconY - side / 2f);
        if (art != null) art.setBounds(left, top, left + side, top + side);

        /* Under the icon itself, not under its shadow: the rule, then the
           greeting, the hail first and the city larger under it. */
        float foot = iconY + icon / 2f;
        ruleTop = foot + 18 * dp;
        ruleBottom = ruleTop + 2 * dp;
        ruleLeft = midX - 14 * dp;
        ruleRight = midX + 14 * dp;
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
