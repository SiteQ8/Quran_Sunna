package com.eworldq8.sunnati;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A reboot or a change of the clock throws pending alarms away, so they are armed again. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        /* exported because the system's broadcasts need it to be, which also
           means any app can send it one; only the four it exists for are heard */
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_TIME_CHANGED.equals(action)
                && !Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        try { AdhanScheduler.scheduleNext(context);
            SalawatScheduler.scheduleNext(context);
            QiyamScheduler.scheduleNext(context);
            NoteScheduler.scheduleNext(context); } catch (Exception e) { /* the next open arms it */ }
    }
}
