package com.khatario.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.util.Log;
import android.webkit.WebView;

/**
 * Enables WebView remote debugging as early as possible (before any WebView is created).
 * Required for chrome://inspect to list the Capacitor WebView on Samsung and other OEM devices.
 *
 * Also creates the notification channel before any FCM message can arrive: Firebase's
 * MessagingService runs in this Application, and a message naming a channel that does not
 * exist yet would fall back to the silent "Miscellaneous" channel.
 */
public class KhatarioApplication extends Application {
    private static final String TAG = "KhatarioWebView";

    /** Must match PUSH_CHANNEL_ALERTS on the server and the manifest default channel id. */
    public static final String CHANNEL_ALERTS = "khatario_alerts";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
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

    /**
     * One channel, high importance (heads-up where the device allows it), default sound and
     * vibration. createNotificationChannel is a no-op for an existing id, so the user's own
     * changes to sound or importance in Android settings are never overwritten.
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel alerts = new NotificationChannel(
            CHANNEL_ALERTS,
            "Khatario alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        alerts.setDescription("Payment reminders, orders, Supplier Hub updates and other business alerts");
        alerts.enableVibration(true);
        alerts.setVibrationPattern(new long[] {0, 250, 150, 250});
        alerts.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        alerts.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        manager.createNotificationChannel(alerts);
        Log.i(TAG, "Application: notification channel ready id=" + CHANNEL_ALERTS);
    }
}
