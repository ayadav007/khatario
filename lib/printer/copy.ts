/**
 * User-facing printer / Bluetooth copy (keep consistent across screens).
 */

export const PRINTER_BLE_SUPPORT_SUMMARY =
  'Bluetooth printing supports Classic Bluetooth (SPP) thermal printers in the Android app. BLE-only printers can use advanced pairing below.';

export const PRINTER_THERMAL_CLASSIC_NOTE =
  'Turn the printer on, pair it in phone Settings → Bluetooth, then tap Connect device and Test print.';

export const PRINTER_ANDROID_APP_NOTE =
  'For reliable Bluetooth printing on Android, use the Khatario Android app. Browser/PWA support depends on Chrome and BLE-capable printers.';

export const PRINTER_SETUP_STEPS =
  '1. Turn the printer on. 2. Pair it once in phone Settings → Bluetooth. 3. Tap Connect device here and choose it.';

export const PRINTER_BLE_VS_CLASSIC_HELP = `Most 58mm and 80mm shop printers in India use Classic Bluetooth (SPP). In the Khatario Android app, pair them in phone Bluetooth settings, then tap Connect device.

BLE (Bluetooth Low Energy) printers are less common. Use “Pair via BLE scan” only if your printer box says BLE / Bluetooth 4.0+ and it does not appear in the Classic device list.

Headphones, watches, and phones also show in the Android paired list — pick the device whose name looks like a printer (RPP, XP, TVS, POS, Thermal).`;

export const PRINTER_NOT_SUPPORTED_BROWSER =
  'Bluetooth printing is not available in this browser. Use Chrome on Android or desktop, or install the Khatario Android app.';

export const PRINTER_NOT_SUPPORTED_SHORT =
  'Bluetooth not available in this browser';
