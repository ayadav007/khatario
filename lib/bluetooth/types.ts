/**
 * BLUETOOTH PRINTING — PUBLIC TYPES
 *
 * This module defines the neutral driver contract used by both the Web
 * Bluetooth (browser) driver and the Capacitor (native Android) driver.
 *
 * Transport-level capabilities live in `@/lib/printer/capabilities`.
 *
 * Design goals:
 *   - One consumer API regardless of runtime. The same hook + settings page
 *     works in Chrome Android today, and in a Capacitor wrapper tomorrow.
 *   - Drivers expose chunked byte streaming; caller gives a single Uint8Array,
 *     driver decides MTU + pacing.
 *   - No UI-framework coupling here. Safe to import from server code for
 *     type checking (the implementations themselves are browser-only).
 */

/** A "paired" printer record stored client-side (localStorage). */
export interface SavedBluetoothPrinter {
  /** Stable id minted by the driver. For Web Bluetooth this is device.id. */
  id: string;
  /** Friendly name shown to the user. */
  name: string;
  /** Which runtime produced this record. Helps migrate between drivers. */
  driver: BluetoothDriverKind;
  /** Selected printer profile (symbology + paper width). */
  profileId: PrinterProfileId;
  /** Paper width in millimeters. 58 or 80 for receipt, 50 for label rolls. */
  paperWidthMm: 58 | 80 | 50;
  /** When true, this printer is preferred for labels. */
  preferForLabels?: boolean;
  /** When true, this printer is preferred for receipts (POS / invoices). */
  preferForReceipts?: boolean;
  /** Epoch ms of when the printer was last used successfully. */
  lastUsedAt?: number;
}

/** Which driver services a saved pairing or active session. */
export type BluetoothDriverKind =
  | 'web-ble'
  | 'capacitor-ble'
  | 'capacitor-spp'
  | 'tcp'
  | 'usb';

/** Known printer command languages. */
export type PrinterLanguage = 'ESCPOS' | 'ZPL' | 'RAW';

/**
 * Identifier for a known printer profile. Profiles carry the GATT
 * service/characteristic UUIDs, DPI, and print-width defaults for a family
 * of printers. See lib/bluetooth/printer-profiles.ts for the registry.
 */
export type PrinterProfileId =
  | 'generic-escpos-58'
  | 'generic-escpos-80'
  | 'rongta-rpp-series'
  | 'xprinter-xp-series'
  | 'tvs-rp-series'
  | 'goojprt-pt-series'
  | 'generic-zpl-label';

/**
 * A printer profile describes the transport (GATT service + write
 * characteristic) and the paper size/command language defaults so the
 * driver can talk to the printer without the user configuring UUIDs.
 */
export interface PrinterProfile {
  id: PrinterProfileId;
  /** Display name shown in the pairing UI. */
  label: string;
  /** Short one-line description (e.g. "58mm Bluetooth receipt printer"). */
  description: string;
  language: PrinterLanguage;
  /** Paper width in mm. Drives character-per-line and dot-per-line math. */
  paperWidthMm: 58 | 80 | 50;
  /** Print head DPI. Almost all 58/80mm BT printers are 203dpi. */
  dpi: 203 | 300;
  /**
   * One or more GATT service UUIDs to advertise as optional when scanning.
   * The driver will pick the first one the device actually exposes.
   */
  gattServiceUUIDs: string[];
  /**
   * Characteristics under the service where we can write data. The driver
   * tries them in order and uses the first that supports write.
   */
  writeCharacteristicUUIDs: string[];
  /**
   * Optional name prefixes used to auto-match a scanned device to this
   * profile. e.g. ["RPP02", "RPP200"] for Rongta.
   */
  deviceNamePrefixes?: string[];
  /**
   * Max bytes to write per GATT packet. Most BLE printers accept 20 bytes
   * safely; some newer chips accept up to 182 bytes. Conservative default
   * is 20.
   */
  chunkSize?: number;
  /**
   * Delay (ms) between chunks. Cheap printers need ~5-20ms breathing room
   * or they drop data.
   */
  chunkDelayMs?: number;
}

/** Status of a Bluetooth printer connection at a point in time. */
export type BluetoothPrinterStatus =
  | 'not-supported'
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'printing'
  | 'disconnected'
  | 'error';

/** Payload submitted to driver.print(). */
export interface PrintJob {
  /** Raw bytes to stream to the printer. */
  bytes: Uint8Array;
  /** Command language (informational; drivers treat bytes opaquely). */
  language: PrinterLanguage;
  /** Optional human label for debug / error messages. */
  label?: string;
}

/** Result of a pairing action. */
export interface PairResult {
  printer: SavedBluetoothPrinter;
}

/** The contract both drivers implement. */
export interface BluetoothPrinterDriver {
  kind: BluetoothDriverKind;

  /** Capability metadata for this driver (transport, native requirement, etc.). */
  getCapability(): import('@/lib/printer/capabilities').PrinterCapability;

  /** True when this driver can be used in the current runtime. */
  isSupported(): boolean;

  /**
   * Ask the OS to present a picker and return a freshly paired printer.
   * `preferredProfile` narrows the advertised service UUIDs so more devices
   * match, but the user can still override.
   */
  pair(preferredProfile?: PrinterProfileId): Promise<PairResult>;

  /**
   * Ensure the given saved printer is connected. Must be idempotent.
   * Drivers should handle auto-reconnect internally.
   */
  connect(printer: SavedBluetoothPrinter): Promise<void>;

  /** Close the current connection. Safe to call when disconnected. */
  disconnect(): Promise<void>;

  /**
   * Stream a print job to the currently-connected printer.
   * Caller should await this; the promise resolves when the last chunk is
   * acknowledged by the GATT stack (not by the printer firmware).
   */
  print(job: PrintJob): Promise<void>;
}
