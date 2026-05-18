/**
 * User-facing printer / Bluetooth copy (keep consistent across screens).
 */

export const PRINTER_BLE_SUPPORT_SUMMARY =
  'Bluetooth printing currently supports BLE-compatible printers. Classic Bluetooth (SPP-only) printers are not yet supported.';

export const PRINTER_ANDROID_APP_NOTE =
  'For reliable Bluetooth printing on Android, use the Khatario Android app. Browser/PWA support depends on Chrome and BLE-capable printers.';

export const PRINTER_BLE_VS_CLASSIC_HELP = `BLE (Bluetooth Low Energy) printers appear in the system picker and work with Khatario today.

Classic Bluetooth (SPP / serial) printers are common on low-cost 58mm and 80mm models in India. They use ESC/POS over RFCOMM and do not expose a BLE service — Khatario cannot pair with them yet.

Check your printer manual or box for "BLE", "Bluetooth 4.0+", or "Low Energy". If it only says "Bluetooth" without BLE, it may be SPP-only.`;

export const PRINTER_NOT_SUPPORTED_BROWSER =
  'Bluetooth printing is not available in this browser. Use Chrome on Android or desktop, or install the Khatario Android app.';

export const PRINTER_NOT_SUPPORTED_SHORT =
  'Bluetooth not available in this browser';
