package com.eworldq8.sunnati;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.os.Build;
import android.provider.CalendarContract;
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

    /** Reminders the page works out: the daily portion, the friday call, and
     *  whatever comes after. A list of when, title and words. */
    @JavascriptInterface
    public void setReminders(String json) { NoteScheduler.setAll(host, json); }

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

    /** Hands an occasion to whatever calendar the phone keeps, as a day-long
     *  entry the reader confirms. Nothing is written without them seeing it. */
    @JavascriptInterface
    public boolean addToCalendar(String title, String note, long startMillis, long endMillis) {
        try {
            Intent add = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.Events.DESCRIPTION, note)
                .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMillis)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMillis)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            host.startActivity(add);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** A file the reader keeps. It is written into the phone's own Downloads,
     *  where they can find it, copy it to a drive, or send it on. Nothing
     *  leaves the phone by itself. */
    @JavascriptInterface
    public boolean saveFile(String name, String content) {
        return save(name, "application/json", content, false);
    }

    /** The same, then handed to whatever app opens that kind of file: a
     *  calendar entry goes straight to the calendar this way. */
    @JavascriptInterface
    public boolean saveAndOpen(String name, String mime, String content) {
        return save(name, mime, content, true);
    }

    private boolean save(String name, String mime, String content, boolean open) {
        if (Build.VERSION.SDK_INT < 29) return false;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = host.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return false;
            try (OutputStream out = host.getContentResolver().openOutputStream(uri)) {
                if (out == null) return false;
                out.write(content.getBytes("UTF-8"));
            }
            if (open) {
                Intent view = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try { host.startActivity(view); } catch (Exception ignored) { /* the file is still saved */ }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Opens whatever map the phone keeps, at the reader's own place, looking
     *  for mosques. The app carries no map and asks for no key. */
    @JavascriptInterface
    public boolean openMap(String url, String here) {
        try {
            Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            host.startActivity(open);
            return true;
        } catch (Exception first) {
            try {
                String web = here == null || here.isEmpty()
                    ? "https://www.google.com/maps/search/mosque"
                    : "https://www.google.com/maps/search/mosque/@" + here + ",15z";
                host.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            } catch (Exception second) {
                return false;
            }
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
