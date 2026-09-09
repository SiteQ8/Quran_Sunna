package com.eworldq8.sunnati;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.OutputStream;

/**
 * What the page may ask the app for. Every method runs on a background
 * thread the web view provides, so anything touching the screen is posted.
 */
public final class Bridge {
    private final Activity host;

    Bridge(Activity host) { this.host = host; }

    /** The page's own version and the app's, so the two can be seen side by side. */
    @JavascriptInterface
    public String version() { return BuildConfig.VERSION_NAME; }

    /** The prayer times of the days ahead, as the page computed them for the reader's own place. */
    @JavascriptInterface
    public void setPrayerTimes(String json) {
        AdhanScheduler.setTimes(host, json);
    }

    @JavascriptInterface
    public boolean isAdhanEnabled() { return AdhanScheduler.enabled(host); }

    /** The chosen adhan, fetched once and kept beside the app so it sounds with
     *  the app closed. An empty pair goes back to the phone's own tone. */
    @JavascriptInterface
    public void setAdhanSound(final String url, final String fajrUrl) {
        new Thread(new Runnable() {
            @Override public void run() { AdhanSound.choose(host, url, fajrUrl); }
        }).start();
    }

    @JavascriptInterface
    public void setAdhanEnabled(boolean on) { AdhanScheduler.setEnabled(host, on); }

    /** Whether the phone lets the app notify at all. */
    /** How often to remind the reader to send prayers upon the Prophet ﷺ,
     *  in minutes, or zero for never. The app holds its own alarm for this,
     *  since a web page is never woken to do it. */
    @JavascriptInterface
    public void setSalawatEvery(int minutes) { SalawatScheduler.setEvery(host, minutes); }

    @JavascriptInterface
    public int salawatEvery() { return SalawatScheduler.every(host); }

    /** When the last third of the night falls, for the days ahead, or an
     *  empty list to stop calling. */
    @JavascriptInterface
    public void setQiyamTimes(String json) {
        if (json == null || json.isEmpty() || "[]".equals(json)) QiyamScheduler.clear(host);
        else QiyamScheduler.setTimes(host, json);
    }

    @JavascriptInterface
    public boolean canNotify() {
        return androidx_areNotificationsEnabled();
    }

    private boolean androidx_areNotificationsEnabled() {
        android.app.NotificationManager m = (android.app.NotificationManager) host.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        return m != null && m.areNotificationsEnabled();
    }

    /** A notification from the app itself, under its own name. */
    @JavascriptInterface
    public void notify(String title, String body, String tag) {
        AdhanReceiver.post(host, title, body, tag == null ? "page" : tag, AdhanReceiver.CHANNEL_REMINDERS);
    }

    /** A picture the page drew, saved to the gallery and offered to share. */
    @JavascriptInterface
    public boolean shareImage(String dataUrl, String name) {
        return shareImageWithText(dataUrl, name, "");
    }

    /** The same, with the words that go with the picture. */
    @JavascriptInterface
    public boolean shareImageWithText(String dataUrl, String name, String text) {
        try {
            int comma = dataUrl.indexOf(',');
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Sunnati");
            Uri uri = host.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return false;
            try (OutputStream out = host.getContentResolver().openOutputStream(uri)) {
                if (out == null) return false;
                out.write(bytes);
            }
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("image/png");
            share.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && !text.isEmpty()) share.putExtra(Intent.EXTRA_TEXT, text);
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            host.startActivity(Intent.createChooser(share, null));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Text handed to the phone's share sheet. */
    @JavascriptInterface
    public void shareText(String text) {
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_TEXT, text);
        host.startActivity(Intent.createChooser(share, null));
    }
}
