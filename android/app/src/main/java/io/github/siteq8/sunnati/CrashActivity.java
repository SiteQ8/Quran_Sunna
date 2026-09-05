package io.github.siteq8.sunnati;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** The stack trace of a crash, readable and copyable. */
public final class CrashActivity extends Activity {
    public static final String EXTRA_TRACE = "trace";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final String trace = getIntent().getStringExtra(EXTRA_TRACE);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.WHITE);
        int pad = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 16, getResources().getDisplayMetrics());
        column.setPadding(pad, pad * 2, pad, pad);

        TextView title = new TextView(this);
        title.setText("توقف سُنّتي، وهذا سبب التوقف");
        title.setTextSize(20);
        title.setTextColor(Color.BLACK);
        column.addView(title);

        Button copy = new Button(this);
        copy.setText("انسخ");
        copy.setOnClickListener((v) -> {
            ClipboardManager clip = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (clip != null) clip.setPrimaryClip(ClipData.newPlainText("sunnati crash", trace));
            Toast.makeText(this, "نُسخ", Toast.LENGTH_SHORT).show();
        });
        column.addView(copy);

        TextView body = new TextView(this);
        body.setText(trace);
        body.setTextSize(11);
        body.setTextColor(Color.DKGRAY);
        body.setTypeface(android.graphics.Typeface.MONOSPACE);
        body.setTextIsSelectable(true);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(body);
        column.addView(scroll);
        setContentView(column);
    }
}
