package com.khatario.app;

import android.app.Application;
import android.os.Build;
import android.util.Log;
import android.webkit.WebView;

/**
 * Enables WebView remote debugging as early as possible (before any WebView is created).
 * Required for chrome://inspect to list the Capacitor WebView on Samsung and other OEM devices.
 */
public class KhatarioApplication extends Application {
    private static final String TAG = "KhatarioWebView";

    @Override
    public void onCreate() {
        super.onCreate();
        if (BuildConfig.ENABLE_WEBVIEW_DEBUG) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                WebView.setWebContentsDebuggingEnabled(true);
                Log.i(TAG, "Application: WebView.setWebContentsDebuggingEnabled(true)");
            } else {
                Log.w(TAG, "Application: WebView debugging requires API 19+");
            }
        } else {
            Log.i(TAG, "Application: WebView remote debugging disabled (ENABLE_WEBVIEW_DEBUG=false)");
        }
    }
}
