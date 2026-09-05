package io.github.siteq8.sunnati;

import android.app.Application;
import android.content.Intent;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Catches whatever would have killed the app and shows it on a plain screen,
 * so a crash on a phone can be read from a photograph of the phone.
 */
public final class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter out = new StringWriter();
                error.printStackTrace(new PrintWriter(out));
                Intent show = new Intent(this, CrashActivity.class);
                show.putExtra(CrashActivity.EXTRA_TRACE, out.toString());
                show.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(show);
            } catch (Throwable ignored) {
                /* nothing more can be done */
            }
            if (before != null) before.uncaughtException(thread, error);
            else { android.os.Process.killProcess(android.os.Process.myPid()); System.exit(10); }
        });
    }
}
