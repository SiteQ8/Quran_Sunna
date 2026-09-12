package com.eworldq8.sunnati;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The adhan the reader chose, kept beside the app so it sounds at the prayer
 * whether the app is open or closed. Two are kept: the fajr's own, which
 * carries الصلاة خير من النوم, and the one for the rest.
 */
public final class AdhanSound {

    private static final String KEY_HAVE = "adhan_sound";
    private static MediaPlayer playing;

    private AdhanSound() { }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE);
    }

    static File file(Context c, boolean fajr) {
        return new File(c.getFilesDir(), fajr ? "adhan-fajr.mp3" : "adhan.mp3");
    }

    /** Fetches the pair, or forgets them when the reader goes back to the tone. */
    /** The page only ever hands over the site's own audio, so nothing else is
     *  fetched: a bridge method that would download any address it was given
     *  is the kind of thing a decompiled app is searched for. */
    private static boolean ours(String url) {
        return url != null && url.startsWith("https://sunnati.3li.info/");
    }

    static void choose(Context c, String url, String fajrUrl) {
        if (url != null && !url.isEmpty() && !(ours(url) && ours(fajrUrl))) return;
        if (url == null || url.isEmpty()) {
            file(c, false).delete();
            file(c, true).delete();
            prefs(c).edit().putString(KEY_HAVE, "").apply();
            return;
        }
        if (url.equals(prefs(c).getString(KEY_HAVE, null)) && file(c, false).exists()) return;
        boolean ok = fetch(url, file(c, false)) && fetch(fajrUrl, file(c, true));
        prefs(c).edit().putString(KEY_HAVE, ok ? url : "").apply();
    }

    private static boolean fetch(String url, File into) {
        HttpURLConnection cx = null;
        try {
            cx = (HttpURLConnection) new URL(url).openConnection();
            cx.setConnectTimeout(20000);
            cx.setReadTimeout(60000);
            if (cx.getResponseCode() != 200) return false;
            try (InputStream in = cx.getInputStream(); OutputStream out = new FileOutputStream(into)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return into.length() > 10000;
        } catch (Exception e) {
            Log.w("sunnati", "adhan not fetched", e);
            into.delete();
            return false;
        } finally {
            if (cx != null) cx.disconnect();
        }
    }

    static boolean have(Context c, boolean fajr) {
        return file(c, fajr).exists() && file(c, fajr).length() > 10000;
    }

    /** Sounds the adhan through the alarm stream, so it is heard while the phone rests. */
    static void play(Context c, boolean fajr) {
        if (!have(c, fajr)) return;
        stop();
        try {
            MediaPlayer p = new MediaPlayer();
            p.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            p.setDataSource(file(c, fajr).getAbsolutePath());
            p.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override public void onCompletion(MediaPlayer mp) { stop(); }
            });
            p.prepare();
            p.start();
            playing = p;
        } catch (Exception e) {
            Log.w("sunnati", "adhan not sounded", e);
        }
    }

    static void stop() {
        if (playing == null) return;
        try { playing.stop(); } catch (Exception ignored) { /* already done */ }
        try { playing.release(); } catch (Exception ignored) { /* already done */ }
        playing = null;
    }
}
