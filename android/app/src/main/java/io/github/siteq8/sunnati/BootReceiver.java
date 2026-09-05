package io.github.siteq8.sunnati;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A reboot or a change of the clock throws pending alarms away, so they are armed again. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try { AdhanScheduler.scheduleNext(context); } catch (Exception e) { /* the next open arms it */ }
    }
}
