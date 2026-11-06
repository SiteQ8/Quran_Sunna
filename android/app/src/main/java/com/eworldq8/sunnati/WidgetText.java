package com.eworldq8.sunnati;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextDirectionHeuristics;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Locale;

/** The app's words in the app's own faces on the home screen.
 *
 *  A launcher draws a widget with fonts of its own and never loads one from
 *  another app, so a widget left to its text views reads in the phone's face,
 *  not in IBM Plex Sans Arabic that every screen of the app is written in.
 *  Every word a widget shows is drawn here instead, into a picture the size
 *  it needs: in IBM Plex Sans Arabic for Arabic, Persian and Urdu, in IBM
 *  Plex Sans for the languages written in Latin or Cyrillic letters, and the
 *  ayah in the mushaf's own Amiri Quran. The picture carries its words for a
 *  screen reader, and one wider than its place is scaled down whole by the
 *  image view that holds it, so a long name still fits on its line.
 *
 *  Words on paper are drawn as a mask the layout tints with the theme's own
 *  colour, so they turn with the phone between day and night; words on a
 *  painted sky are white with their shadow, the same in both. */
final class WidgetText {
    static final int REGULAR = 0;
    static final int SEMIBOLD = 1;
    static final int BOLD = 2;
    static final int QURAN = 3;

    static final int START = 0;
    static final int CENTER = 1;

    /** How one kind of words is drawn: the weight, the size in sp, the colour
     *  (0 for a mask the layout tints), the shadow, how many lines it may take
     *  and where they stand. */
    static final class Style {
        final int weight;
        final float sp;
        final int color;
        final float shadowDp;
        final int shadowColor;
        final int lines;
        final int align;
        final boolean figures;

        Style(int weight, float sp, int color, float shadowDp, int shadowColor, int lines, int align, boolean figures) {
            this.weight = weight;
            this.sp = sp;
            this.color = color;
            this.shadowDp = shadowDp;
            this.shadowColor = shadowColor;
            this.lines = lines;
            this.align = align;
            this.figures = figures;
        }

        /** the same words in another colour: a prayer gone is drawn fainter */
        Style colored(int c) { return new Style(weight, sp, c, shadowDp, shadowColor, lines, align, figures); }
    }

    /* over the painted skies */
    static final Style SKY_HEAD = new Style(REGULAR, 12, 0xD9FFFFFF, 3, 0x66000000, 1, START, false);
    static final Style SKY_NAME = new Style(BOLD, 23, 0xFFFFFFFF, 4, 0x80000000, 1, START, false);
    static final Style SKY_NAME_ROW = new Style(BOLD, 16, 0xFFFFFFFF, 4, 0x80000000, 1, START, false);
    static final Style SKY_SUB = new Style(SEMIBOLD, 12, 0xFFFFE2B8, 3, 0x66000000, 1, START, false);
    static final Style SKY_TIME = new Style(REGULAR, 13, 0xF2FFFFFF, 3, 0x66000000, 1, START, true);
    static final Style SKY_TIME_ROW = new Style(REGULAR, 12, 0xF2FFFFFF, 3, 0x80000000, 1, START, true);
    static final Style SKY_PLACE = new Style(REGULAR, 11, 0xCCFFFFFF, 3, 0x66000000, 1, START, false);
    static final Style SKY_OPEN = new Style(SEMIBOLD, 15, 0xFFFFFFFF, 4, 0x80000000, 3, START, false);
    static final Style SKY_OPEN_ROW = new Style(SEMIBOLD, 12, 0xFFFFFFFF, 3, 0x80000000, 2, START, false);
    static final Style SKY_TITLE = new Style(BOLD, 14, 0xFFFFFFFF, 4, 0x80000000, 1, START, false);
    static final Style SKY_COLUMN = new Style(REGULAR, 12, 0xFFFFFFFF, 4, 0x99000000, 1, CENTER, false);
    static final Style SKY_COLUMN_TIME = new Style(BOLD, 13, 0xFFFFFFFF, 4, 0x99000000, 1, CENTER, true);

    /* on the paper, tinted by the layout */
    static final Style PAPER_SMALL = new Style(REGULAR, 12, 0, 0, 0, 1, START, false);
    static final Style PAPER_SMALL_BOLD = new Style(BOLD, 12, 0, 0, 0, 1, START, false);
    static final Style PAPER_NOTE = new Style(REGULAR, 11, 0, 0, 0, 1, START, true);
    static final Style PAPER_NOTE_SEMI = new Style(SEMIBOLD, 11, 0, 0, 0, 1, START, false);
    static final Style PAPER_COUNT = new Style(REGULAR, 12, 0, 0, 0, 1, START, true);
    static final Style HIJRI_DATE = new Style(BOLD, 22, 0, 0, 0, 2, CENTER, true);
    static final Style HIJRI_DATE_ROW = new Style(BOLD, 17, 0, 0, 0, 1, START, true);
    static final Style HIJRI_OCCASION = new Style(SEMIBOLD, 11, 0, 0, 0, 2, CENTER, true);
    static final Style KHATMA_SHARE = new Style(BOLD, 18, 0, 0, 0, 1, CENTER, true);
    static final Style ADHKAR_TITLE = new Style(BOLD, 20, 0, 0, 0, 2, START, false);
    static final Style AYAH = new Style(QURAN, 21, 0, 0, 0, 7, CENTER, false);

    /* no word is drawn larger than this share of its size, however large the
       phone's text is set: a widget's cells do not grow with the words */
    private static final float MOST_SCALE = 1.15f;

    private static final int[] ARABIC = { R.font.plex_arabic_regular, R.font.plex_arabic_semibold, R.font.plex_arabic_bold };
    private static final int[] LATIN = { R.font.plex_sans_regular, R.font.plex_sans_semibold, R.font.plex_sans_bold };
    private static final Typeface[] arabic = new Typeface[3];
    private static final Typeface[] latin = new Typeface[3];
    private static Typeface quran;

    private WidgetText() {}

    /** Draws the words into the image view of that id, or hides it when there are none. */
    static void put(Context c, RemoteViews views, int id, CharSequence text, Style s, JSONObject all, int wrapPx) {
        if (text == null || text.length() == 0) {
            views.setViewVisibility(id, View.GONE);
            return;
        }
        views.setViewVisibility(id, View.VISIBLE);
        views.setImageViewBitmap(id, draw(c, text, s, all, wrapPx));
        views.setContentDescription(id, text);
    }

    /** Whether the words read from the right: the app's language when the page
     *  has said it, and the words' own letters before it has. */
    static boolean rtl(JSONObject all, CharSequence text) {
        String dir = all == null ? "" : all.optString("dir", "");
        if (dir.length() > 0) return "rtl".equals(dir);
        String lang = all == null ? "" : all.optString("lang", "");
        if (lang.length() > 0) return lang.equals("ar") || lang.equals("ur") || lang.equals("fa");
        return arabicLetters(text) || isRtlLanguage(Locale.getDefault().getLanguage());
    }

    private static boolean isRtlLanguage(String lang) {
        return "ar".equals(lang) || "ur".equals(lang) || "fa".equals(lang);
    }

    private static boolean arabicLetters(CharSequence text) {
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if ((ch >= 0x0600 && ch <= 0x06FF) || (ch >= 0x0750 && ch <= 0x077F) || (ch >= 0xFB50 && ch <= 0xFEFF)) return true;
        }
        return false;
    }

    /** IBM Plex Sans Arabic where the app's language is written in Arabic
     *  letters, IBM Plex Sans where it is not, and the mushaf's face for the
     *  Quran; a letter either lacks comes from the phone's own faces. */
    static Typeface face(Context c, int weight, boolean arabicScript) {
        if (weight == QURAN) {
            if (quran == null) quran = load(c, R.font.amiri_quran, Typeface.SERIF);
            return quran;
        }
        Typeface[] cache = arabicScript ? arabic : latin;
        if (cache[weight] == null) {
            cache[weight] = load(c, (arabicScript ? ARABIC : LATIN)[weight], weight == REGULAR ? Typeface.DEFAULT : Typeface.DEFAULT_BOLD);
        }
        return cache[weight];
    }

    private static Typeface load(Context c, int font, Typeface fallback) {
        try {
            Typeface t = c.getResources().getFont(font);
            return t == null ? fallback : t;
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    /** The words as a picture: one line at its own width, or as many lines as
     *  the style allows inside a width when one is given. */
    static Bitmap draw(Context c, CharSequence text, Style s, JSONObject all, int wrapPx) {
        DisplayMetrics dm = c.getResources().getDisplayMetrics();
        float scale = Math.min(c.getResources().getConfiguration().fontScale, MOST_SCALE);
        /* the Quran reads from the right whatever the language around it */
        boolean rtl = s.weight == QURAN || rtl(all, text);
        boolean arabicScript = s.weight == QURAN || rtl || arabicLetters(text);
        boolean mask = s.color == 0;

        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        paint.setTypeface(face(c, s.weight, arabicScript));
        paint.setTextSize(s.sp * dm.density * scale);
        paint.setColor(mask ? 0xFF000000 : s.color);
        if (s.figures) paint.setFontFeatureSettings("'tnum'");
        float shadow = mask ? 0 : s.shadowDp * dm.density;
        if (shadow > 0) paint.setShadowLayer(shadow, 0, dm.density, s.shadowColor);
        /* room for the shadow */
        int pad = (int) Math.ceil(shadow * 0.75f + dm.density);
        int maxLines = wrapPx > 0 ? s.lines : 1;

        /* words that would be cut short in their lines, or a word broken
           across two, are drawn smaller first, down to three fifths of their
           size, before any is dropped */
        StaticLayout layout = layout(text, paint, s, rtl, wrapPx, pad, maxLines);
        float least = paint.getTextSize() * 0.6f;
        while (wrapPx > 0 && (cut(layout) || brokeWord(layout, text)) && paint.getTextSize() * 0.92f >= least) {
            paint.setTextSize(paint.getTextSize() * 0.92f);
            layout = layout(text, paint, s, rtl, wrapPx, pad, maxLines);
        }

        /* the box of the words: as high as the letters need and no higher.
           A face's own line keeps room for the tallest mark of any language
           it serves, which left a widget of three lines of Arabic no room
           for a fourth; the box here holds the usual height of the letters,
           grown to the ink of the first and last lines wherever a mark rises
           above it or a letter falls below. The mushaf keeps its own line,
           for the marks stacked over its letters. */
        int lines = layout.getLineCount();
        float top = layout.getLineTop(0);
        float bottom = layout.getLineBottom(lines - 1);
        if (s.weight != QURAN) {
            float em = paint.getTextSize();
            float first = layout.getLineBaseline(0);
            float last = layout.getLineBaseline(lines - 1);
            String t = text.toString();
            android.graphics.Rect ink = new android.graphics.Rect();
            float inkTop = first, inkBottom = last;
            /* a last line that is empty, after a closing line break, has no
               ink, and reading one letter past the end would throw */
            int s0 = Math.min(layout.getLineStart(0), t.length());
            int e0 = Math.min(Math.max(s0 + 1, layout.getLineEnd(0)), t.length());
            if (e0 > s0) { paint.getTextBounds(t, s0, e0, ink); inkTop = first + ink.top; }
            int s1 = Math.min(layout.getLineStart(lines - 1), t.length());
            int e1 = Math.min(Math.max(s1 + 1, layout.getLineEnd(lines - 1)), t.length());
            if (e1 > s1) { paint.getTextBounds(t, s1, e1, ink); inkBottom = last + ink.bottom; }
            float boxTop = first - (arabicScript ? 0.95f : 0.86f) * em;
            float boxBottom = last + (arabicScript ? 0.40f : 0.25f) * em;
            top = Math.max(top, Math.min(boxTop, inkTop));
            bottom = Math.min(bottom, Math.max(boxBottom, inkBottom));
        }

        int w = layout.getWidth() + 2 * pad;
        int h = (int) Math.ceil(bottom - top) + 2 * pad;
        Bitmap bmp = Bitmap.createBitmap(Math.max(1, w), Math.max(1, h), mask ? Bitmap.Config.ALPHA_8 : Bitmap.Config.ARGB_8888);
        bmp.setDensity(dm.densityDpi);
        Canvas canvas = new Canvas(bmp);
        canvas.translate(pad, pad - top);
        layout.draw(canvas);
        return bmp;
    }

    private static StaticLayout layout(CharSequence text, TextPaint paint, Style s, boolean rtl, int wrapPx, int pad, int maxLines) {
        int natural = (int) Math.ceil(Layout.getDesiredWidth(text, paint)) + 1;
        int width = wrapPx > 0 ? Math.max(1, Math.min(natural, wrapPx - 2 * pad)) : natural;
        Layout.Alignment align = s.align == CENTER ? Layout.Alignment.ALIGN_CENTER : Layout.Alignment.ALIGN_NORMAL;
        return StaticLayout.Builder.obtain(text, 0, text.length(), paint, width)
            .setAlignment(align)
            .setTextDirection(rtl ? TextDirectionHeuristics.RTL : TextDirectionHeuristics.LTR)
            .setIncludePad(s.weight == QURAN)
            .setLineSpacing(0, s.weight == QURAN ? 1.25f : 1f)
            .setMaxLines(maxLines)
            .setEllipsize(TextUtils.TruncateAt.END)
            .build();
    }

    /* whether a line ends inside a word, which happens only when one word is
       wider than the whole line */
    private static boolean brokeWord(StaticLayout layout, CharSequence text) {
        for (int i = 0; i < layout.getLineCount() - 1; i++) {
            int end = layout.getLineEnd(i);
            if (end > 0 && end < text.length() && !Character.isWhitespace(text.charAt(end - 1)) && !Character.isWhitespace(text.charAt(end))) return true;
        }
        return false;
    }

    /* whether the last line had to be cut short */
    private static boolean cut(StaticLayout layout) {
        int n = layout.getLineCount();
        return n > 0 && layout.getEllipsisCount(n - 1) > 0;
    }

    /** A width in dp less the sides a layout keeps, in pixels. */
    static int px(Context c, float dp) {
        return Math.round(dp * c.getResources().getDisplayMetrics().density);
    }
}
