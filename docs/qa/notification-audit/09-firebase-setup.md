# Firebase setup for Khatario push (manual, Firebase Console)

Date: 2026-10-29. Nothing in this file has been done yet: the repository contains no Firebase project, no `google-services.json` and no service account. Everything below is what the owner (or an operator with Firebase Console access) must do before a single push can be delivered. The code degrades to "no push, in-app list only" until then, in both apps and on the server.

## 1. One Firebase project, two Android apps (plus one optional)

| Audience | App | Android application id | Where the config file goes |
| --- | --- | --- | --- |
| Tenants and their staff | Flutter phone app | `com.khatario.phone` | `phone/android/app/google-services.json` |
| Tenants' customers (and anyone signing in through the shell) | Capacitor shell | `com.khatario.app` | `android/app/google-services.json` |
| Staff attendance app (not wired for push in this pass) | Flutter staff flavour | `com.khatario.staff` | same file as the phone app (one `google-services.json` can hold several `client` entries) |

Steps in the Firebase Console:

1. Create project `khatario` (or reuse one). Google Analytics is not needed.
2. Project settings → Your apps → Add app → Android, package name `com.khatario.phone`, nickname "Khatario phone". Download `google-services.json`.
3. Add a second Android app `com.khatario.app`, nickname "Khatario shell". Download its `google-services.json`.
4. Optional now, required before the staff app gets push: add `com.khatario.staff` to the same project and re-download the phone app's file so it contains both clients.
5. Cloud Messaging → make sure the **Firebase Cloud Messaging API (V1)** is enabled (it is by default on new projects). The legacy HTTP API is not used.
6. Project settings → Service accounts → Generate new private key. This JSON is the server credential. Keep it out of the repository and out of chat.

SHA-1 / SHA-256 fingerprints are **not** required for FCM. They are only needed if Google Sign-In or App Check is added later.

## 2. Files in the repository (safe to commit)

`google-services.json` contains the project number, the app ids and an API key restricted to Firebase client use; Google documents it as safe to commit. Place the two files as in the table above. Both Gradle builds already apply the google-services plugin **only when the file exists**:

- `android/app/build.gradle.gradle` (Capacitor): the existing `try { file('google-services.json').text ... }` block.
- `phone/android/app/build.gradle.kts` (Flutter): `if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")`, with the plugin version declared in `phone/android/settings.gradle.kts` (`com.google.gms.google-services` 4.4.2).

After adding a file, rebuild: `npm run cap:android:staging:apk` and `cd phone && flutter build apk --flavor owner`. The build output should no longer print `google-services.json not found`.

## 3. Server credential (never committed)

The dispatcher (`lib/push/fcm.ts`) starts Firebase Admin from one of:

| Variable | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | the service-account JSON, either raw or base64 (`base64 -w0 key.json`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | absolute path to the JSON file on the VPS (Google's default lookup) |

Put one of them in `/var/www/khatario/.env.production` (staging) and `/var/www/khatario-prod/.env.production` (production), then `pm2 restart khatario-staging --update-env` **and** `pm2 restart todo-reminder-worker --update-env` (the worker is the process that sends). Use a different service account per environment if the environments use different Firebase projects; if they share one project, the same key works for both and the device row's `environment` column tells them apart.

Check without sending anything: `curl -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/dispatch-push` returns `"fcm": "ok"` when the credential loads, or `"fcm": "fcm_not_configured"` / `"fcm_init_failed"` otherwise.

## 4. Environment separation

Staging and production share the Android application ids, so a phone with the staging APK and a phone with the production APK present the same package to Firebase. Two workable setups:

- **Two Firebase projects** (recommended): `khatario-staging` and `khatario`. Each environment's APK is built with its own `google-services.json` (keep them outside the repo and copy the right one in before `cap:android:staging:apk` / `cap:android:production`), and each server uses its own service account. A staging token can never be addressed by production.
- **One project**: both servers use the same credential; a token minted by a staging build receives whatever server holds its row. Since devices register with the server they signed in to, this still routes correctly, but a mistake in `.env` would let staging reach production phones. Only acceptable while staging has no real users.

`push_devices.environment` is recorded at registration (default `production`; the apps can pass `environment` when a staging build is identified) so the two can be told apart in the table either way.

## 5. What the apps need from the OS (no console action)

- Android 13+: `POST_NOTIFICATIONS` is declared in both manifests and requested after sign-in. A user who denies it sees no push; the in-app list still works and the notifications page explains how to re-enable it.
- Channel `khatario_alerts` (importance high, default sound, vibration) is created at app start by `KhatarioApplication.java` (shell) and `push_service.dart` (phone app). Android keeps the user's later changes; the apps never delete or recreate it.
- The notification small icon `ic_stat_khatario` and tint `khatario_notification_accent` exist in both `res/` trees and are named in both manifests (`com.google.firebase.messaging.default_notification_*`).

## 6. Verification once the console work is done

1. Install the rebuilt APK on a test phone, sign in with a staging account, allow notifications.
2. On the staging database: `SELECT audience, app_id, left(token_hash, 8), revoked_at FROM push_devices ORDER BY created_at DESC LIMIT 5;` shows the new row (hash only).
3. Insert one row into `notifications` for that business, or trigger a real event (mark a todo reminder due).
4. `SELECT status, attempts, last_error, sent_count FROM push_jobs ORDER BY created_at DESC LIMIT 5;` goes `pending` → `sent` within a few seconds while `todo-reminder-worker` runs (or on the next `dispatch-push` cron tick).
5. The phone shows the card on `khatario_alerts`; `push_deliveries` has `accepted` with the provider message id.
6. Run the device matrix in `10-android-verification.md` and fill in the rows that were BLOCKED here.

## 7. Do not

- Do not paste the service-account JSON, a device token or the Firebase API key into chat, tickets or the project log.
- Do not change the production Firebase project or production `.env.production` without the owner's approval.
- Do not send a test push to a real customer's device; use a staging persona's phone.
