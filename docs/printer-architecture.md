# Printer architecture

Khatario separates **what to print** (ESC/POS encoders) from **how to reach the printer** (transport drivers).

## Layers

| Layer | Location | Role |
| --- | --- | --- |
| Encoders | `lib/bluetooth/invoice-to-escpos.ts`, `label-to-escpos.ts`, `escpos.ts` | Build byte payloads (receipts, labels) |
| Driver contract | `lib/bluetooth/types.ts` | `pair`, `connect`, `print`, `getCapability()` |
| Capability catalog | `lib/printer/capabilities.ts` | Transport metadata (BLE, SPP, TCP, USB) |
| Driver registry | `lib/bluetooth/driver-registry.ts` | Runtime selection + lazy load |
| UI hook | `hooks/useBluetoothPrinter.ts` | Pairing, storage, print helpers |

## Transports

| Transport | Driver folder | Status |
| --- | --- | --- |
| `web-ble` | `lib/bluetooth/drivers/web-ble/` | Implemented |
| `android-ble` | `lib/bluetooth/drivers/capacitor-ble/` | Implemented (Capacitor APK) |
| `android-spp` | `lib/bluetooth/drivers/capacitor-spp/` | Implemented (Capacitor APK, preferred) |
| `tcp` | `lib/bluetooth/drivers/tcp/` | Placeholder only |
| `usb` | `lib/bluetooth/drivers/usb/` | Placeholder only |

`getDriver()` only loads **implemented** transports for the current runtime. Placeholders are listed via `getRegistryDiagnostics()` and `loadDriverForTransport()` for future wiring.

## Adding Classic Bluetooth (SPP) on Android

Most low-cost Indian 58/80 mm printers use **Bluetooth Classic RFCOMM**, not BLE GATT. Web Bluetooth cannot see them.

### Recommended implementation path

1. **Native plugin** — Add or fork a Capacitor plugin that:
   - Requests `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` (Android 12+)
   - Lists paired RFCOMM devices (or scans SPP UUID `00001101-0000-1000-8000-00805F9B34FB`)
   - Opens a socket, writes raw bytes, handles disconnect/reconnect

2. **Driver** — Implement `CapacitorSppDriver` in `lib/bluetooth/drivers/capacitor-spp/index.ts`:
   - Extend the real driver base (not `UnsupportedPrinterDriver`)
   - `getCapability()` → `getTransportCapability('android-spp')`
   - Reuse chunking/pacing from `CapacitorBleDriver.print()` (same ESC/POS stream)

3. **Registry** — Move `android-spp` from `PLACEHOLDER_DESCRIPTORS` to `DRIVER_DESCRIPTORS` with `matchesRuntime: () => isCapacitorNative()` and priority between BLE and fallbacks.

4. **Storage** — Persist `driver: 'capacitor-spp'` on `SavedBluetoothPrinter`; keep address/MAC instead of BLE device id.

5. **UX** — Do not claim SPP works until `implemented: true` in `PRINTER_TRANSPORT_CATALOG`. Settings copy lives in `lib/printer/copy.ts`.

6. **Shell version** — Bump `APP_SHELL_VERSION_CODE` in `lib/printer/shell-version.ts`, `capacitor.config.ts` → `plugins.KhatarioShell`, and `android/app/build.gradle` when the native plugin ships.

### ESC/POS reuse

No encoder changes are required. SPP is a byte pipe; encoders already output `Uint8Array` jobs consumed by `BluetoothPrinterDriver.print()`.

## Diagnostics

- Settings → Bluetooth Printer → **Printer diagnostics**
- API: `GET /api/app/shell-compatibility` (minimum APK version; warning only today)

## Version sync checklist

When changing the Android shell:

1. `lib/printer/shell-version.ts` — `APP_SHELL_VERSION_CODE` / `NAME`
2. `capacitor.config.ts` — `plugins.KhatarioShell`
3. `android/app/build.gradle` — `versionCode` / `versionName`
4. Run `npm run cap:sync` so `android/app/src/main/assets/capacitor.config.json` updates
