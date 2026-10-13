package com.eworldq8.sunnati;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.os.Build;
import android.provider.CalendarContract;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
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

    /** Where the reader is, kept so the opening screen can greet by name.
     *  The picture is made at build time and knows nobody, and the wrapper
     *  cannot read the page's own store, so the page says it and this holds
     *  it until the next launch. */
    @JavascriptInterface
    public void setPlace(String name) {
        if (name == null) return;
        String clean = name.trim();
        if (clean.length() > 40) return;
        host.getSharedPreferences(SplashView.PREFS, android.content.Context.MODE_PRIVATE)
            .edit().putString(SplashView.KEY_PLACE, clean).apply();
    }

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

    /** Whether the call to prayer should arrive with no sound at all: neither
     *  a recorded adhan nor the phone's own notification tone. */
    @JavascriptInterface
    public void setAdhanSilent(boolean silent) {
        host.getSharedPreferences("sunnati_adhan", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("silent", silent).apply();
    }

    /** Whether the phone lets the app notify at all. */
    /** How often to remind the reader to send prayers upon the Prophet ﷺ,
     *  in minutes, or zero for never. The app holds its own alarm for this,
     *  since a web page is never woken to do it. */
    @JavascriptInterface
    public void setSalawatEvery(int minutes) { SalawatScheduler.setEvery(host, minutes); }

    /** Whether the reminder to send prayers upon the Prophet should arrive
     *  with no sound at all. */
    @JavascriptInterface
    public void setQiyamSound(String sound) {
        host.getSharedPreferences("sunnati_qiyam", android.content.Context.MODE_PRIVATE)
            .edit().putString("sound", sound == null ? "device" : sound).apply();
    }

    @JavascriptInterface
    public void setSalawatSilent(boolean silent) {
        host.getSharedPreferences("sunnati_salawat", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("silent", silent).apply();
    }

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

    /** The page telling the app it has painted, so the splash may go. */
    @JavascriptInterface
    public void pageReady() {
        host.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (host instanceof MainActivity) ((MainActivity) host).dismissSplash();
            }
        });
    }

    /** Whether something is sounding, so the app knows not to pause the page
     *  when the reader leaves it. */
    @JavascriptInterface
    public void setSounding(boolean on) {
        if (host instanceof MainActivity) ((MainActivity) host).sounding = on;
        if (!on) {
            /* Stopping is a stop, not a start. startForegroundService here
               promised the system a startForeground within seconds, and the
               moment audio stops is exactly the moment the app is usually in
               the background, where that promise cannot be kept: the service
               went down without ever reaching the foreground and the system
               killed the app for it. stopService asks for no promise. */
            try {
                host.stopService(new Intent(host, AudioService.class));
            } catch (Exception ignored) { /* nothing was holding it */ }
        }
    }

    /** What is sounding, so the shade can show it and be pressed. */
    @JavascriptInterface
    public void showSounding(String title, String sub, boolean playing) {
        /* A service already in the foreground owes the system nothing more, so
           its notice is simply reworded where it stands: this is how the shade
           follows one surah to the next with the app away. */
        if (AudioService.running) {
            try {
                android.app.NotificationManager shade =
                    host.getSystemService(android.app.NotificationManager.class);
                if (shade != null) {
                    shade.notify(AudioService.ID, AudioService.shade(host, title, sub, playing));
                    return;
                }
            } catch (Exception ignored) { /* fall through and try to raise it */ }
        }
        /* Raising it afresh is a promise of a foreground within seconds, and a
           promise made from the background is one the system refuses: it kills
           the app rather than let it pass. The recitation still sounds either
           way; only the shade waits until the reader comes back. */
        if (host instanceof MainActivity && !((MainActivity) host).inFront) return;
        try {
            Intent hold = new Intent(host, AudioService.class)
                .setAction(AudioService.ACTION_START)
                .putExtra(AudioService.EXTRA_TITLE, title)
                .putExtra(AudioService.EXTRA_SUB, sub)
                .putExtra(AudioService.EXTRA_PLAYING, playing);
            host.startForegroundService(hold);
        } catch (Exception ignored) {
            /* the recitation still sounds while the app is open */
        }
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

    /* A verse the page recorded as a video. One bridge call carries one
       string, and a whole video as one string is tens of megabytes held three
       times over on its way here, so it comes in pieces: a file is opened in
       the cache, base64 pieces are appended to it, and once it is whole it is
       made a plain mp4 and offered to share. One at a time; the bridge thread
       is a single thread, and these hold the file between its calls. */
    private File videoPart;
    private OutputStream videoOut;
    private String videoName;

    /** Opens the file a recorded video is written into. The name is what the
     *  receiving app shows, kept to plain letters, digits, dots and dashes. */
    @JavascriptInterface
    public synchronized boolean videoBegin(String name) {
        dropVideo();
        try {
            File dir = SharedFiles.folder(host);
            SharedFiles.sweep(dir);
            videoName = SharedFiles.cleanName(name, ".mp4");
            videoPart = new File(dir, SharedFiles.PART + videoName);
            videoOut = new BufferedOutputStream(new FileOutputStream(videoPart), 1 << 16);
            return true;
        } catch (Exception e) {
            dropVideo();
            return false;
        }
    }

    /** One piece of the video, as base64 of a whole number of bytes. */
    @JavascriptInterface
    public synchronized boolean videoChunk(String base64) {
        if (videoOut == null || base64 == null) return false;
        try {
            videoOut.write(Base64.decode(base64, Base64.DEFAULT));
            return true;
        } catch (Exception e) {
            dropVideo();
            return false;
        }
    }

    /** The video is whole. It is rewritten as a plain mp4, which is what
     *  WhatsApp and the gallery read, or kept as recorded if that fails, and
     *  handed to the share sheet with the words that go with it. */
    @JavascriptInterface
    public synchronized boolean videoShare(String text) {
        if (videoOut == null || videoPart == null) return false;
        try {
            videoOut.close();
            videoOut = null;
            File done = new File(videoPart.getParentFile(), videoName);
            if (done.exists() && !done.delete()) return false;
            if (Mp4Remux.plain(videoPart, done)) {
                if (!videoPart.delete()) videoPart.deleteOnExit();
            } else if (!videoPart.renameTo(done)) {
                dropVideo();
                return false;
            }
            videoPart = null;
            Uri uri = SharedFiles.uriOf(host, done);
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("video/mp4");
            share.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && !text.isEmpty()) share.putExtra(Intent.EXTRA_TEXT, text);
            /* the grant travels with the clip, and the sheet shows the video */
            share.setClipData(ClipData.newRawUri("", uri));
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            host.startActivity(Intent.createChooser(share, null));
            return true;
        } catch (Exception e) {
            dropVideo();
            return false;
        }
    }

    /** The page gave up part way: the half-written file goes. */
    @JavascriptInterface
    public synchronized void videoAbort() {
        dropVideo();
    }

    private void dropVideo() {
        if (videoOut != null) {
            try { videoOut.close(); } catch (Exception ignored) { /* already closed */ }
        }
        videoOut = null;
        if (videoPart != null && videoPart.exists() && !videoPart.delete()) videoPart.deleteOnExit();
        videoPart = null;
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
