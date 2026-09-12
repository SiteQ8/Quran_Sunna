package com.eworldq8.sunnati;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Toast;

/** Reached from the long press shortcut: switches the adhan alarms off or on. */
public final class AdhanToggleActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean on = !AdhanScheduler.enabled(this);
        if (on) {
            /* turning the adhan on harms nobody, so the shortcut stays one tap */
            AdhanScheduler.setEnabled(this, true);
            Toast.makeText(this, "تنبيهات الأذان تعمل", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        /* Turning it off is asked about. This activity is exported for the
           home-screen shortcut, which means any app on the phone can start it
           too, and before this it silenced the adhan the instant it was
           started, with no word to the person. Now nothing is silenced but by
           a finger on «نعم». */
        new android.app.AlertDialog.Builder(this)
            .setTitle("إيقاف تنبيهات الأذان؟")
            .setMessage("لن يرنّ الأذان حتى تعيد تشغيله من هنا أو من الإعدادات.")
            .setPositiveButton("نعم، أوقفه", new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int which) {
                    AdhanScheduler.setEnabled(AdhanToggleActivity.this, false);
                    Toast.makeText(AdhanToggleActivity.this, "أوقفت تنبيهات الأذان", Toast.LENGTH_LONG).show();
                    finish();
                }
            })
            .setNegativeButton("لا", new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int which) { finish(); }
            })
            .setOnCancelListener(new android.content.DialogInterface.OnCancelListener() {
                @Override public void onCancel(android.content.DialogInterface d) { finish(); }
            })
            .show();
    }
}
