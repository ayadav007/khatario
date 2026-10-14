# Khatario phone

Flutter screens for the shop counter. Colours match the website: cream `#F8F3E9`, green `#063F35`, orange `#F58220`.

Sign-in uses the real Khatario password and session cookies. The default server is `https://staging.khatario.com`. Rebuild with `--dart-define=API_BASE_URL=https://khatario.com` for production. The install id is `com.khatario.phone`, separate from the existing Capacitor app `com.khatario.app`.

```powershell
$env:Path = "$env:USERPROFILE\flutter\bin;" + $env:Path
cd phone
flutter test
flutter run
```
