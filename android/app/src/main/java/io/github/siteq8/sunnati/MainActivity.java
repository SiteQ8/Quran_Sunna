package io.github.siteq8.sunnati;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * The trusted web activity, with the adhan alarms armed each time the app is
 * opened. On androids that ask before notifying, the browser is held back
 * until the question has been answered, or it would cover the question.
 */
public class MainActivity extends LauncherActivity {

    private static final int ASK_NOTIFICATIONS = 7;
    private boolean asking;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        /* nothing the alarm does may stop the app from opening */
        try {
            AdhanReceiver.ensureChannel(this);
            AdhanScheduler.scheduleNext(this);
        } catch (Exception e) {
            Log.w("sunnati", "adhan setup skipped", e);
        }
        if (asking && !isFinishing()) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
        }
    }

    private boolean mustAsk() {
        return Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
    }

    /** The library calls this inside its onCreate; false holds the browser back. */
    @Override
    protected boolean shouldLaunchImmediately() {
        asking = mustAsk();
        return !asking;
    }

    /** Granted or refused, the browser opens once the question is off the screen. */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == ASK_NOTIFICATIONS) {
            asking = false;
            try { launchTwa(); } catch (Exception e) { Log.w("sunnati", "launch after the question failed", e); finish(); }
        }
    }
}
