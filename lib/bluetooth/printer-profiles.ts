/**
 * BLUETOOTH PRINTER PROFILES
 *
 * Registry of GATT service/characteristic UUIDs for common BLE thermal
 * printers sold in India (and elsewhere). A profile lets the driver talk to
 * a printer without the user entering UUIDs manually.
 *
 * How these UUIDs were chosen
 * ---------------------------
 * The large majority of cheap 58mm/80mm BLE receipt printers use one of
 * three SoC modules: Telink, BK3432, or CC2540. These modules ship from the
 * factory with a small set of well-known service UUIDs that the printer's
 * firmware exposes as a transparent serial pipe:
 *
 *   * FFE0 / FFE1       — Telink (the most common)
 *   * FF00 / FF02       — BK3432 (Rongta RPP series, many OEM variants)
 *   * 18F0 / 2AF1       — some Xprinter models
 *   * 49535343-...      — Microchip BM70/BM71 transparent UART service
 *   * E7810A71-...      — ISSC transparent UART
 *
 * If a device advertises any of these service UUIDs, we can almost always
 * write ESC/POS bytes to the first writable characteristic in that service.
 *
 * Consequences for auto-detection
 * -------------------------------
 * `generic-escpos-58` is intentionally broad — it scans for all of the above.
 * It will match ~80% of the printers customers bring in. The vendor-specific
 * profiles exist so that we can show a nicer label in the UI and pick the
 * right paper width automatically.
 */

import type { PrinterProfile, PrinterProfileId } from './types';

// ---------------------------------------------------------------------------
// Common BLE "serial pipe" service UUIDs used by thermal printer modules.
// Keep the short 16-bit form lowercase; the driver will normalize before
// comparing.
// ---------------------------------------------------------------------------

const TELINK_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
const TELINK_WRITE = '0000ffe1-0000-1000-8000-00805f9b34fb';

const BK3432_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const BK3432_WRITE = '0000ff02-0000-1000-8000-00805f9b34fb';

const XPRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';
const XPRINTER_WRITE = '00002af1-0000-1000-8000-00805f9b34fb';

const MICROCHIP_UART_SERVICE = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
const MICROCHIP_UART_WRITE = '49535343-8841-43f4-a8d4-ecbe34729bb3';

const ISSC_UART_SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2';
const ISSC_UART_WRITE = 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f';

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * Order matters: vendor-specific profiles come first so the driver's
 * auto-match pass prefers them before falling through to the generic bucket.
 */
export const PRINTER_PROFILES: PrinterProfile[] = [
  {
    id: 'rongta-rpp-series',
    label: 'Rongta RPP (58mm BLE)',
    description:
      'Rongta RPP02N / RPP200 / RPP300 and common OEM rebrands (58mm)',
    language: 'ESCPOS',
    paperWidthMm: 58,
    dpi: 203,
    gattServiceUUIDs: [BK3432_SERVICE, TELINK_SERVICE],
    writeCharacteristicUUIDs: [BK3432_WRITE, TELINK_WRITE],
    deviceNamePrefixes: ['RPP', 'Rongta', 'BTPrinter'],
    chunkSize: 150,
    chunkDelayMs: 20,
  },
  {
    id: 'xprinter-xp-series',
    label: 'Xprinter XP (58mm BLE)',
    description:
      'Xprinter XP-P323B / XP-P502A and similar 58mm BLE receipt printers',
    language: 'ESCPOS',
    paperWidthMm: 58,
    dpi: 203,
    gattServiceUUIDs: [XPRINTER_SERVICE, TELINK_SERVICE],
    writeCharacteristicUUIDs: [XPRINTER_WRITE, TELINK_WRITE],
    deviceNamePrefixes: ['XP-', 'Xprinter', 'XPP'],
    chunkSize: 180,
    chunkDelayMs: 10,
  },
  {
    id: 'tvs-rp-series',
    label: 'TVS RP / BP (58/80mm)',
    description:
      'TVS RP3200, BP3000H and similar Indian-market mobile thermal printers',
    language: 'ESCPOS',
    paperWidthMm: 58,
    dpi: 203,
    gattServiceUUIDs: [TELINK_SERVICE, BK3432_SERVICE],
    writeCharacteristicUUIDs: [TELINK_WRITE, BK3432_WRITE],
    deviceNamePrefixes: ['TVS', 'BP', 'RP32'],
    chunkSize: 150,
    chunkDelayMs: 20,
  },
  {
    id: 'goojprt-pt-series',
    label: 'Goojprt PT (58mm portable)',
    description: 'Goojprt PT-210 / PT-280 / MTP-II portable 58mm printers',
    language: 'ESCPOS',
    paperWidthMm: 58,
    dpi: 203,
    gattServiceUUIDs: [TELINK_SERVICE],
    writeCharacteristicUUIDs: [TELINK_WRITE],
    deviceNamePrefixes: ['PT-', 'Goojprt', 'MTP'],
    chunkSize: 100,
    chunkDelayMs: 20,
  },
  {
    id: 'generic-escpos-58',
    label: 'Generic 58mm ESC/POS BLE',
    description:
      'Any 58mm BLE receipt printer speaking ESC/POS — broad auto-detect',
    language: 'ESCPOS',
    paperWidthMm: 58,
    dpi: 203,
    gattServiceUUIDs: [
      TELINK_SERVICE,
      BK3432_SERVICE,
      XPRINTER_SERVICE,
      MICROCHIP_UART_SERVICE,
      ISSC_UART_SERVICE,
    ],
    writeCharacteristicUUIDs: [
      TELINK_WRITE,
      BK3432_WRITE,
      XPRINTER_WRITE,
      MICROCHIP_UART_WRITE,
      ISSC_UART_WRITE,
    ],
    chunkSize: 100,
    chunkDelayMs: 20,
  },
  {
    id: 'generic-escpos-80',
    label: 'Generic 80mm ESC/POS BLE',
    description:
      'Desktop-style 80mm BLE receipt printer (e.g. TVS RP3200, EPSON TM-P80)',
    language: 'ESCPOS',
    paperWidthMm: 80,
    dpi: 203,
    gattServiceUUIDs: [
      TELINK_SERVICE,
      BK3432_SERVICE,
      XPRINTER_SERVICE,
      MICROCHIP_UART_SERVICE,
    ],
    writeCharacteristicUUIDs: [
      TELINK_WRITE,
      BK3432_WRITE,
      XPRINTER_WRITE,
      MICROCHIP_UART_WRITE,
    ],
    chunkSize: 150,
    chunkDelayMs: 15,
  },
  {
    id: 'generic-zpl-label',
    label: 'Generic ZPL label printer (BLE)',
    description:
      'Zebra-compatible BLE label printer (50x25mm rolls) accepting raw ZPL',
    language: 'ZPL',
    paperWidthMm: 50,
    dpi: 203,
    gattServiceUUIDs: [
      TELINK_SERVICE,
      BK3432_SERVICE,
      MICROCHIP_UART_SERVICE,
      ISSC_UART_SERVICE,
    ],
    writeCharacteristicUUIDs: [
      TELINK_WRITE,
      BK3432_WRITE,
      MICROCHIP_UART_WRITE,
      ISSC_UART_WRITE,
    ],
    chunkSize: 100,
    chunkDelayMs: 20,
  },
];

export function getProfile(id: PrinterProfileId): PrinterProfile {
  const p = PRINTER_PROFILES.find((x) => x.id === id);
  if (!p) {
    throw new Error(`Unknown printer profile: ${id}`);
  }
  return p;
}

/** Flatten all service UUIDs across all profiles (deduped). Used during scan. */
export function getAllServiceUUIDs(): string[] {
  const set = new Set<string>();
  for (const p of PRINTER_PROFILES) {
    for (const u of p.gattServiceUUIDs) set.add(u.toLowerCase());
  }
  return Array.from(set);
}

/**
 * Best-effort match of a device to a known profile using its advertised name.
 * Falls back to `generic-escpos-58` when no vendor prefix matches.
 */
export function guessProfileFromName(name: string | undefined | null): PrinterProfileId {
  const n = (name || '').trim().toUpperCase();
  if (!n) return 'generic-escpos-58';
  for (const p of PRINTER_PROFILES) {
    if (!p.deviceNamePrefixes) continue;
    for (const prefix of p.deviceNamePrefixes) {
      if (n.startsWith(prefix.toUpperCase())) return p.id;
    }
  }
  return 'generic-escpos-58';
}
