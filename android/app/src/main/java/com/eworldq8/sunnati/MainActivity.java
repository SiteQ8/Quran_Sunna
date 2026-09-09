package com.eworldq8.sunnati;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.graphics.Insets;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
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
        /* From android 15 the window is drawn edge to edge and cannot opt out,
           so the page is inset by the bars itself; without this the top of the
           app would sit under the status bar. */
        setContentView(web);
        web.setFitsSystemWindows(false);
        ViewCompat_setOnApplyWindowInsetsListener(web);

        try {
            AdhanReceiver.ensureChannels(this);
            AdhanScheduler.scheduleNext(this);
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
        if (data != null && "sunnati.3li.info".equals(data.getHost())) return data.toString();
        return SITE;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && "sunnati.3li.info".equals(data.getHost()) && web != null) web.loadUrl(data.toString());
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

    /* the bars of the system are given their room, and the page keeps the rest */
    private void ViewCompat_setOnApplyWindowInsetsListener(final View view) {
        view.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && back != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(back);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
