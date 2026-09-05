package io.github.siteq8.sunnati;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * The trusted web activity, with the adhan alarms armed each time the app is
 * opened and the notification permission asked for once on newer androids.
 */
public class MainActivity extends LauncherActivity {

    private static final int ASK_NOTIFICATIONS = 7;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AdhanReceiver.ensureChannel(this);
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
        }
        AdhanScheduler.scheduleNext(this);
    }
}
