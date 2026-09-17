package com.eworldq8.sunnati;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Environment;
import android.widget.FrameLayout;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.graphics.Insets;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The app owns the page: it is shown in a web view inside this process, with
 * a bridge the page calls for what only the app can do, notifying, ringing at
 * prayer times and sharing pictures. No other browser is involved, so nothing
 * is delegated, no other app announces itself, and one permission covers all.
 */
public class MainActivity extends Activity {

    static final String SITE = "https://sunnati.3li.info/";
    private static final int ASK_NOTIFICATIONS = 7;
    private static final int ASK_LOCATION = 8;

    private WebView web;
    private FrameLayout root;
    private SplashView splash;
    private boolean splashGone;
    volatile boolean sounding;
    private OnBackInvokedCallback back;
    private GeolocationPermissions.Callback pendingLocation;
    private String pendingLocationOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " SunnatiApp/" + BuildConfig.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(this), "SunnatiApp");
        /* A web view swallows a download unless the app takes it, so a file the
           page hands over is passed to the phone's own downloader rather than
           vanishing without a word. */
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String agent, String disposition, String mime, long size) {
                try {
                    DownloadManager.Request ask = new DownloadManager.Request(Uri.parse(url));
                    ask.setMimeType(mime);
                    ask.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    ask.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                        URLUtil.guessFileName(url, disposition, mime));
                    DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (manager != null) manager.enqueue(ask);
                } catch (Exception e) {
                    Log.w("sunnati", "download not taken", e);
                }
            }
        });
        web.setWebViewClient(new WebViewClient() {
            /* the app's own pages stay in; any other site opens in the phone's browser */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("sunnati.3li.info".equals(url.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception e) { Log.w("sunnati", "no browser for " + url); }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingLocation = callback;
                pendingLocationOrigin = origin;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION }, ASK_LOCATION);
            }
        });
        /* The clock, the battery and the signal stay where the reader expects
           them, and the app sits beneath that bar rather than under it, so no
           word and no camera cutout ever falls on the page. The page is put
           inside a frame that the framework itself insets: asking the web view
           to do it by hand did not hold on every version of android. */
        root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        root.setBackgroundColor(dark ? 0xFF10161A : 0xFFF6F4EE);
        root.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        splash = new SplashView(this);
        splashShownAt = android.os.SystemClock.uptimeMillis();
        root.addView(splash, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.setFitsSystemWindows(false);
        drawEdgeToEdge();
        dressSystemBars();
        keepKeyboardClear(root);
        /* the splash never outstays its welcome, however slow the page is */
        root.postDelayed(new Runnable() {
            @Override public void run() { dismissSplash(); }
        }, 4000);

        try {
            AdhanReceiver.ensureChannels(this);
            AdhanScheduler.scheduleNext(this);
            SalawatScheduler.scheduleNext(this);
            QiyamScheduler.scheduleNext(this);
            NoteScheduler.scheduleNext(this);
        } catch (Exception e) {
            Log.w("sunnati", "adhan setup skipped", e);
        }
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
        }
        listenForBack();
        if (savedInstanceState == null) web.loadUrl(target(getIntent()));
        else web.restoreState(savedInstanceState);
    }

    /** A shortcut or a link into the app carries its own address; anything else opens the front. */
    private String target(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        /* the host and the scheme both: a link is the site's over https, or
           it is not followed at all */
        if (data != null && "https".equals(data.getScheme()) && "sunnati.3li.info".equals(data.getHost())) {
            return data.toString();
        }
        /* A tapped notification says which reminder it was, and the site is
           opened on that subject: a friday night reminder that opens the app
           and then says nothing more about friday night has wasted the tap. */
        String kind = intent == null ? null : intent.getStringExtra("kind");
        if (kind != null && kind.length() > 0) return SITE + "?from=" + Uri.encode(kind);
        return SITE;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && "https".equals(data.getScheme()) && "sunnati.3li.info".equals(data.getHost())
                && web != null) web.loadUrl(data.toString());
        /* the app was already running when the notification was tapped, so the
           page is told rather than reloaded */
        else if (web != null) {
            String kind = intent.getStringExtra("kind");
            if (kind != null && kind.length() > 0) {
                web.evaluateJavascript(
                    "window.App && App.helpers && App.helpers.cameFrom && App.helpers.cameFrom('"
                    + kind.replaceAll("[^a-zA-Z]", "") + "')", null);
            }
        }
        /* the buttons in the shade come back here, and are passed to the page,
           which is what actually holds the recitation */
        String action = intent == null ? null : intent.getAction();
        if (AudioService.ACTION_TOGGLE.equals(action)) tellPage("App.helpers.togglePlay()");
        else if (AudioService.ACTION_CLOSE.equals(action)) tellPage("App.helpers.stopAudio()");
        else tellPage("App.helpers.showDueSheets()");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == ASK_LOCATION && pendingLocation != null) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            pendingLocation.invoke(pendingLocationOrigin, ok, false);
            pendingLocation = null;
        }
        if (requestCode == ASK_NOTIFICATIONS && web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('sunnati:permission'))", null);
        }
    }

    /* The back gesture walks the page's own history before it leaves the app.
       From android 13 the system asks through this callback, and from android
       16 it no longer arrives as a key press at all, so both are handled. */
    private void listenForBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            back = new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    if (web != null && web.canGoBack()) web.goBack();
                    else finish();
                }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, back);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (Build.VERSION.SDK_INT < 33 && keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /* The bars take the app's own paper, and their marks are drawn dark on it,
       so the top of the screen belongs to the app rather than standing apart. */
    /* Drawing under the bars is of android 11 and after, and from android 15
       an app that targets 35 or more is drawn so of itself. Below android 11
       the frame is inset by the framework, as it was before, which is the whole
       reason the root asks to fit the system windows. */
    @SuppressWarnings("deprecation")
    private void drawEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= 35) return;
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
    }

    @SuppressWarnings("deprecation")
    private void dressSystemBars() {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController bars = getWindow().getInsetsController();
            if (bars != null) {
                bars.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                int marks = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                bars.setSystemBarsAppearance(night ? 0 : marks, marks);
            }
            return;
        }
        /* android 8 to 10 say the same thing with the flags that preceded it:
           dark marks on light paper, and the reverse at night */
        View decor = getWindow().getDecorView();
        int flags = decor.getSystemUiVisibility();
        int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(night ? (flags & ~light) : (flags | light));
    }

    /* The frame is inset by the framework, so only the keyboard is left to
       handle: it must lift the page rather than cover what is being typed. */
    private void keepKeyboardClear(final View view) {
        /* Below android 11 the frame is inset by the framework and the window
           resizes for the keyboard, so there is nothing to take in hand and the
           inset types below do not exist yet. */
        if (Build.VERSION.SDK_INT < 30) return;
        view.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                /* said again inside the callback: the listener is only put on
                   from android 11, but nothing reading this file, lint included,
                   can see that from in here */
                if (Build.VERSION.SDK_INT < 30) return insets;
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            }
        });
    }

    /** Fades the splash away once the page says it is ready, or when the wait
     *  has gone on long enough. Called from either, so it guards itself. */
    /** How long the opening screen stays before it is allowed to go.
     *  The page tells us it has painted, and with the worker holding the shell
     *  that is a few hundred milliseconds, so the screen used to fade in over
     *  260ms and start fading out again at once: a flicker, and nobody could
     *  read the greeting on it. This is the floor, not the length: the screen
     *  still goes as soon as the page is ready once the floor has passed. */
    /* raised from 1100 after it was tried on a phone: the greeting went before
       it could be read */
    /* raised to 3200 after 2000 still felt quick on a phone: long enough to
       read «حيّ الله أهل» and the city under it */
    private static final long SPLASH_HOLD_MS = 3200;
    private long splashShownAt;

    void dismissSplash() {
        if (splash == null || splashGone) return;
        long shown = android.os.SystemClock.uptimeMillis() - splashShownAt;
        if (shown < SPLASH_HOLD_MS && root != null) {
            /* asked to go too early: wait out the remainder and ask again, at
               which point the branch above is false and it goes */
            root.postDelayed(new Runnable() {
                @Override public void run() { dismissSplash(); }
            }, SPLASH_HOLD_MS - shown);
            return;
        }
        splashGone = true;
        splash.animate().alpha(0f).setDuration(420).withEndAction(new Runnable() {
            @Override
            public void run() {
                if (root != null && splash != null) root.removeView(splash);
                splash = null;
            }
        }).start();
    }

    @Override
    protected void onResume() {
        super.onResume();
        /* brought forward, perhaps from a notice: whatever sheet is due now
           is looked for again, since the page only looked at its first boot */
        if (started) tellPage("App.helpers.showDueSheets()");
        dressSystemBars();
        if (web != null) web.onResume();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) dressSystemBars();
    }

    private boolean started = false;

    private void tellPage(String script) {
        if (web == null) return;
        try { web.evaluateJavascript("try{" + script + "}catch(e){}", null); } catch (Exception ignored) { }
    }

    @Override
    protected void onPause() {
        started = true;
        /* A recitation carries on when the reader leaves the app: pausing the
           page here would cut it off mid ayah, and it is stopped only when
           they stop it themselves. */
        if (web != null && !sounding) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && back != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(back);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
