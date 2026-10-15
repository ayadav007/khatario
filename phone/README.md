# Khatario phone

Flutter screens for the shop counter. Colours match the website: cream `#F8F3E9`, green `#063F35`, orange `#F58220`.

Sign-in uses the real Khatario password and session cookies. The default server is `https://staging.khatario.com`. Rebuild with `--dart-define=API_BASE_URL=https://khatario.com` for production. The install id is `com.khatario.phone`, separate from the existing Capacitor app `com.khatario.app`.

```powershell
$env:Path = "$env:USERPROFILE\flutter\bin;" + $env:Path
cd phone
flutter test
flutter run
```

## Khatario Staff (employee check-in app)

The same codebase also builds **Khatario Staff** (`com.khatario.staff`), a small app that only does employee check-in. Plain `flutter run` / `flutter build apk` still builds the shop app (`default-flavor: owner`); its APK is now `app-owner-*.apk`.

```powershell
flutter run --flavor staff -t lib/main_staff.dart
flutter build apk --flavor staff -t lib/main_staff.dart
```

How it works (server side in `lib/hr/staff-app/`):
- The owner opens an employee on the website and taps **Link staff phone**. The staff app scans the QR code (or the code is typed). The phone makes a signing key in the Android keystore; every later request is signed with it, so the login cannot be copied to another phone or a script.
- Check-in: the server issues a one-time code, the app takes 5 GPS readings, scans nearby Wi-Fi and checks for root / emulator / developer mode, and sends it all signed. The server scores it: accepted, review (shown to the manager on the Attendance page), or rejected.
- Office sites, radius and trusted Wi-Fi are set in Settings › Attendance policy. Wi-Fi routers seen at accepted check-ins are offered there to trust.
- No outside services: location uses the phone's own GPS, everything else is on the phone or our server.
