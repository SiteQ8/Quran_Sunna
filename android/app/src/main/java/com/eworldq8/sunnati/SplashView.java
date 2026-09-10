package com.eworldq8.sunnati;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.view.View;
import android.view.animation.DecelerateInterpolator;

/**
 * What the reader sees while the mushaf loads. Not a logo blinking on and off:
 * the app's own paper with its sadu band, the mihrab mark drawing itself, and
 * the name settling beneath it. It holds until the page says it is ready, so
 * the reader never sees a half-drawn screen.
 */
final class SplashView extends View {

    private final Paint band = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint gold = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint word = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path mark = new Path();
    private float grown;
    private final boolean night;

    SplashView(Context context) {
        super(context);
        night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        setBackgroundColor(night ? 0xFF10161A : 0xFFF6F4EE);

        int ink = night ? 0xFFFF6969 : 0xFF9C2B2B;
        band.setColor(ink);
        band.setAlpha(28);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(dp(2.4f));
        line.setStrokeCap(Paint.Cap.ROUND);
        line.setStrokeJoin(Paint.Join.ROUND);
        line.setColor(ink);
        gold.setStyle(Paint.Style.STROKE);
        gold.setStrokeWidth(dp(1.6f));
        gold.setColor(night ? 0xFFBB9036 : 0xFFB08833);
        word.setColor(night ? 0xFFEDE9E1 : 0xFF16241C);
        word.setTextAlign(Paint.Align.CENTER);
        word.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));

        ValueAnimator draw = ValueAnimator.ofFloat(0f, 1f);
        draw.setDuration(760);
        draw.setInterpolator(new DecelerateInterpolator());
        draw.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                grown = (float) a.getAnimatedValue();
                invalidate();
            }
        });
        draw.start();
    }

    private float dp(float v) { return v * getResources().getDisplayMetrics().density; }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth(), h = getHeight();
        float cx = w / 2f, cy = h / 2f - dp(24);

        /* the sadu band across the paper, above and below */
        float unit = dp(16);
        for (float y : new float[] { cy - dp(150), cy + dp(150) }) {
            for (float x = -unit; x < w + unit; x += unit) {
                Path d = new Path();
                d.moveTo(x, y);
                d.lineTo(x + unit / 2f, y - unit / 2f);
                d.lineTo(x + unit, y);
                d.lineTo(x + unit / 2f, y + unit / 2f);
                d.close();
                canvas.drawPath(d, band);
            }
        }

        /* the mihrab arch, drawn as it grows */
        float r = dp(52) * (0.6f + 0.4f * grown);
        mark.reset();
        mark.moveTo(cx - r, cy + r * 0.8f);
        mark.lineTo(cx - r, cy);
        mark.arcTo(cx - r, cy - r, cx + r, cy + r, 180, 180, false);
        mark.lineTo(cx + r, cy + r * 0.8f);
        line.setAlpha((int) (255 * Math.min(1f, grown * 1.4f)));
        canvas.drawPath(mark, line);

        /* the crescent inside it, and a gold hair beneath */
        float m = r * 0.42f;
        gold.setAlpha((int) (255 * grown));
        canvas.drawCircle(cx, cy + r * 0.05f, m * grown, gold);
        canvas.drawLine(cx - r * 1.3f, cy + r * 1.05f, cx + r * 1.3f, cy + r * 1.05f, gold);

        /* and the name, settling */
        word.setTextSize(dp(30));
        word.setAlpha((int) (255 * Math.max(0f, (grown - 0.35f) / 0.65f)));
        canvas.drawText("سُنّتي", cx, cy + r + dp(58) - dp(6) * (1f - grown), word);
    }
}
