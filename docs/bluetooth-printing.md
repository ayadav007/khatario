# Bluetooth Thermal Printing

Khatario supports printing invoices, receipts, and item labels directly to
a Bluetooth thermal printer — no cables, no computer, no app-switching.

There are two ways to use it:

- **Web (Chrome on Android / desktop Chrome / Edge)** — works today, no
  install needed.
- **Native Android APK (Capacitor shell)** — required for reliable Bluetooth
  on many Android phones. Uses **BLE only** (same limitation as Web
  Bluetooth). Classic SPP printers are not supported yet — see
  `docs/printer-architecture.md`.

> iOS is **not supported**. Apple does not allow Web Bluetooth on iOS
> and there is no Capacitor iOS target in this repo.

---

## 1. What you can print

| Flow | Button / Trigger | Output |
| --- | --- | --- |
| Bulk item labels | `/items/barcodes` → Output: *Bluetooth printer* | ESC/POS label (58 / 80 mm) |
| Purchase → Labels | `Print Labels` modal → Output: *Bluetooth printer* | ESC/POS label |
| Invoice detail | `Print to Bluetooth` button (drafts and finalized) | ESC/POS receipt |
| POS (`/invoices/new`) | **Auto-print to Bluetooth** toggle + explicit `Print to Bluetooth` button in the right panel | ESC/POS receipt |

All of this is gated by the `barcode_thermal_printer` feature flag. Make
sure the business's subscription plan enables it (see
`database/migrations/161_barcode_label_features.sql`).

---

## 2. Supported printers

Any **BLE (Bluetooth Low Energy)** thermal printer with a standard GATT
profile. We ship tested profiles for:

- **Generic ESC/POS 58 mm** (`generic-escpos-58`)
- **Generic ESC/POS 80 mm** (`generic-escpos-80`)
- **Rongta RPP-series** (`rongta-rpp-series`)
- **Xprinter XP-series** (`xprinter-xp-series`)
- **TVS RP-series** (`tvs-rp-series`)
- **Goojprt PT-series** (`goojprt-pt-series`)
- **Generic ZPL label printer** (`generic-zpl-label`) — experimental; uses
  ESC/POS-style raster output because most 58 mm "ZPL" labellers also accept
  ESC/POS commands.

Not (currently) supported:

- Classic Bluetooth SPP (Serial Port Profile) printers — Web Bluetooth
  cannot see them. On native Android they would need a separate driver.
- Network / Wi-Fi thermal printers — use the standard PDF / HTML flow.

If your printer isn't in the list, try **Generic ESC/POS 58 mm** first — it
works with most cheap BLE thermal printers. If that fails, open an issue
with the GATT service and characteristic UUIDs (the pairing dialog shows
them).

---

## 3. Pairing a printer

1. Enable the `barcode_thermal_printer` feature on the business plan.
2. Go to **Settings → Bluetooth Printer**.
3. Tap **Pair a printer**.
4. (Optional) Pick a profile to narrow the device list.
5. Select your printer from the OS picker.
6. Tap **Test print** to confirm. You should see "PRINTER OK" with a QR
   code.
7. Optionally mark the printer as default for **labels** or **receipts**.

The pairing is stored in `localStorage`, scoped per business. This means:

- Pairings are remembered per device + per business, not per user.
- Clearing browser data will forget all pairings (you'll need to re-pair).
- On the Android APK, clearing app data has the same effect.

---

## 4. Web (browser) mode

### Requirements

- Chrome / Edge / Opera / Samsung Internet (desktop or Android).
- Served over **HTTPS** (localhost is fine for dev).
- User-initiated action (the pairing dialog can only open from a click /
  tap).

### Known limitations

- Firefox (any platform) → Web Bluetooth is not implemented.
- iOS Safari → blocked by Apple.
- Incognito / private mode → may block `navigator.bluetooth` entirely.

---

## 5. Android APK (Capacitor)

The Android app is a thin Capacitor shell around the production web app.
It loads `https://<your-host>` in a WebView and exposes the
`@capacitor-community/bluetooth-le` plugin so the app can talk to BLE
printers even on phones whose browsers don't support Web Bluetooth.

### 5.1 Prerequisites

- Node.js ≥ 18
- Android Studio (for the Android SDK). Tested with
  Android Studio Hedgehog and API level 35.
- A signing keystore for Play Store release builds.

Environment variables (all optional; have sensible defaults):

| Var | Default | Description |
| --- | --- | --- |
| `CAP_SERVER_URL` | `https://app.khatario.com` | HTTPS URL the WebView loads on launch |

**Staging vs production:** Production is not live yet. Use `npm run cap:android:staging:install` or see **`docs/SERVER_INFRASTRUCTURE.md`** — do not rely on the default URL while on staging.
| `CAP_ALLOW_CLEARTEXT` | `false` | Allow plain `http://` (dev only) |
| `CAP_ANDROID_SCHEME` | `https` | Internal Capacitor scheme; leave default |

### 5.2 Build scripts

Defined in `package.json`:

```bash
npm run cap:sync        # copy latest config + plugins into android/
npm run cap:add:android # one-off: scaffold android/ (already run; commit the folder)
npm run cap:open:android # open the Android Studio project
npm run cap:run:android  # build + install on a connected device / emulator
```

Typical dev loop:

```bash
# 1. Develop against the web app as usual
npm run dev

# 2. When you want to rebuild the APK
npm run cap:sync
npm run cap:open:android
# Then hit "Run" in Android Studio on a connected phone.
```

### 5.3 Permissions

`android/app/src/main/AndroidManifest.xml` declares:

- `INTERNET` — required for `server.url`.
- `BLUETOOTH_SCAN` (Android 12+) with `neverForLocation` flag so Play
  Store users are not prompted for location access.
- `BLUETOOTH_CONNECT` (Android 12+).
- `BLUETOOTH` + `BLUETOOTH_ADMIN` + `ACCESS_FINE_LOCATION` /
  `ACCESS_COARSE_LOCATION` scoped to `maxSdkVersion=30` for older phones.
- `<uses-feature android:name="android.hardware.bluetooth_le"
  android:required="false" />` so Play Store does not hide the app from
  tablets that lack BLE.

The `@capacitor-community/bluetooth-le` plugin requests these at runtime
the first time you hit **Pair a printer**.

### 5.4 Play Store distribution

1. Bump `versionCode` + `versionName` in `android/app/build.gradle`.
2. In Android Studio, **Build → Generate Signed Bundle / APK → Android App
   Bundle (.aab)**, sign with your release keystore.
3. Upload to the Play Console.

Because the app is `server.url`-based, every web deploy is instantly live
on user phones. You only need to re-upload to the Play Store when:

- You change `capacitor.config.ts` (new plugins, different server URL).
- You bump a plugin or Capacitor native version.
- You update native permissions.

---

## 6. How it works (architecture)

```
┌──────────────────────────────────────────────────────────────┐
│  UI (Next.js pages / components)                             │
│   • /settings/bluetooth-printer                              │
│   • /items/barcodes                                          │
│   • Invoice detail                                           │
│   • POS (/invoices/new)                                      │
└─────────────────────────┬────────────────────────────────────┘
                          │  hooks/useBluetoothPrinter.ts
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/bluetooth/*                                             │
│   ├─ types.ts             Public contract                    │
│   ├─ printer-profiles.ts  GATT UUIDs, paper widths, DPI      │
│   ├─ escpos.ts            ESC/POS builder                    │
│   ├─ label-to-escpos.ts   Label template → bytes             │
│   ├─ invoice-to-escpos.ts Receipt → bytes                    │
│   ├─ invoice-payload-to-receipt.ts                           │
│   ├─ storage.ts           localStorage persistence           │
│   ├─ driver-registry.ts   Runtime driver selector            │
│   └─ drivers/                                                │
│       ├─ web-ble-driver.ts        (browser)                  │
│       └─ capacitor-ble-driver.ts  (Android APK)              │
└──────────────────────────────────────────────────────────────┘
```

- UI never talks to a driver directly. It goes through the
  `useBluetoothPrinter` hook, which reads printer preferences from
  `localStorage` and dispatches to the active driver.
- `driver-registry.ts` picks **`CapacitorBleDriver`** when
  `window.Capacitor.isNativePlatform()` is true, else **`WebBleDriver`**.
- Both drivers implement the same
  [`BluetoothPrinterDriver`](../lib/bluetooth/types.ts) interface.

The server reuses the existing `/api/labels/print` endpoint and adds a
`format: 'json'` output so the client can render labels via Bluetooth
without duplicating the data-hydration logic.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Your browser does not support Web Bluetooth" | Firefox / Safari / non-HTTPS site | Use Chrome / Edge / Opera over HTTPS, or install the Android APK |
| OS picker shows no devices | Printer is in sleep mode, or already connected to another phone | Power-cycle the printer, forget it from other phones, keep it within 1–2 m during pairing |
| "No writeable characteristic found" | Profile mismatch | Re-pair and pick a different profile (start with *Generic ESC/POS 58 mm*) |
| Print starts but cuts off | Chunk size too large for cheap printer | Lower `chunkSize` on the profile (see `lib/bluetooth/printer-profiles.ts`) |
| Gibberish / wrong characters | Non-ASCII text (e.g. Hindi) | Set the printer's code page; for labels prefer raster mode (future enhancement) |
| POS auto-print doesn't trigger | Toggle off, or preferred printer not set | Check right panel toggle; visit Settings → Bluetooth Printer and mark a printer as default for *receipts* |
| Android APK can't see any devices | Runtime permissions not granted | Settings → Apps → Khatario → Permissions, enable Bluetooth + Nearby devices |

For deeper debugging on the APK, connect a USB cable and run:

```bash
adb logcat -s Capacitor:* BluetoothLe:* chromium:*
```

---

## 8. Roadmap

- Raster mode for non-English labels (Unicode via bitmap).
- Native ZPL driver for true ZPL label printers.
- iOS Capacitor target (`npx cap add ios`) once a Mac is available.
- Sharing paired printers across users of the same business (server-side
  storage instead of `localStorage`).
