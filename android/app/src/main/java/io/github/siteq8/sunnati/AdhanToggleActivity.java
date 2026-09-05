package io.github.siteq8.sunnati;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Toast;

/** Reached from the long press shortcut: switches the adhan alarms off or on. */
public final class AdhanToggleActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean on = !AdhanScheduler.enabled(this);
        AdhanScheduler.setEnabled(this, on);
        Toast.makeText(this, on ? "تنبيهات الأذان تعمل" : "أوقفت تنبيهات الأذان", Toast.LENGTH_LONG).show();
        finish();
    }
}
