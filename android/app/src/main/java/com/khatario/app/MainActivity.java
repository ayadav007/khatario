package com.khatario.app;

import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor shell entry point. UI runs in the Capacitor-managed Android WebView
 * (Bridge), not in external Chrome tabs or a Trusted Web Activity.
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "KhatarioWebView";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        enableWebViewRemoteDebugging();
        registerPlugin(KhatarioBluetoothSppPlugin.class);
        super.onCreate(savedInstanceState);
        logBridgeDiagnostics("onCreate");
    }

    @Override
    public void onResume() {
        super.onResume();
        logBridgeDiagnostics("onResume");
    }

    private void enableWebViewRemoteDebugging() {
        if (!BuildConfig.ENABLE_WEBVIEW_DEBUG) {
            Log.i(TAG, "MainActivity: remote debugging off (release build or ENABLE_WEBVIEW_DEBUG=false)");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
            Log.i(
                TAG,
                "MainActivity: WebView.setWebContentsDebuggingEnabled(true) debug="
                    + BuildConfig.DEBUG
                    + " webviewDebug="
                    + BuildConfig.ENABLE_WEBVIEW_DEBUG
            );
        }
    }

    private void logBridgeDiagnostics(String phase) {
        Bridge bridge = getBridge();
        if (bridge == null) {
            Log.w(TAG, phase + ": Capacitor bridge not ready yet");
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null) {
            Log.w(TAG, phase + ": Capacitor WebView not created yet");
            return;
        }
        String url = webView.getUrl();
        String userAgent = webView.getSettings().getUserAgentString();
        Log.i(
            TAG,
            phase
                + ": Capacitor WebView active url="
                + (url != null ? url : "(null)")
                + " progress="
                + webView.getProgress()
                + " ua="
                + (userAgent != null ? userAgent.substring(0, Math.min(120, userAgent.length())) : "(null)")
        );
    }
}
