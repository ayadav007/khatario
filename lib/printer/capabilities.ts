/**
 * Printer transport capability model — runtime-agnostic.
 * BLE drivers, future SPP/TCP/USB drivers register here.
 */

import type { BluetoothDriverKind } from '@/lib/bluetooth/types';

export type PrinterTransport =
  | 'web-ble'
  | 'android-ble'
  | 'android-spp'
  | 'tcp'
  | 'usb';

export type PrinterCapability = {
  transport: PrinterTransport;
  /** Human-readable label for diagnostics and settings. */
  label: string;
  description: string;
  /** True when this transport is wired in code (false = placeholder only). */
  implemented: boolean;
  requiresNativeApp: boolean;
  supportsAutoReconnect: boolean;
  supportsBackgroundPrinting: boolean;
};

/** Static catalog — single source of truth for all transports. */
export const PRINTER_TRANSPORT_CATALOG: Record<PrinterTransport, PrinterCapability> = {
  'web-ble': {
    transport: 'web-ble',
    label: 'Web Bluetooth (BLE)',
    description:
      'Browser Web Bluetooth API. BLE-compatible printers only. Chrome/Edge on Android or desktop.',
    implemented: true,
    requiresNativeApp: false,
    supportsAutoReconnect: false,
    supportsBackgroundPrinting: false,
  },
  'android-ble': {
    transport: 'android-ble',
    label: 'Android app (BLE)',
    description:
      'Khatario Android app with Bluetooth Low Energy. BLE-compatible printers only.',
    implemented: true,
    requiresNativeApp: true,
    supportsAutoReconnect: true,
    supportsBackgroundPrinting: false,
  },
  'android-spp': {
    transport: 'android-spp',
    label: 'Android app (Classic Bluetooth / SPP)',
    description:
      'ESC/POS over Bluetooth Classic serial (RFCOMM). Common on budget Indian thermal printers.',
    implemented: true,
    requiresNativeApp: true,
    supportsAutoReconnect: true,
    supportsBackgroundPrinting: false,
  },
  tcp: {
    transport: 'tcp',
    label: 'Network (TCP)',
    description: 'Wi‑Fi or Ethernet thermal printers on LAN.',
    implemented: false,
    requiresNativeApp: false,
    supportsAutoReconnect: true,
    supportsBackgroundPrinting: false,
  },
  usb: {
    transport: 'usb',
    label: 'USB',
    description: 'USB-connected thermal printers.',
    implemented: false,
    requiresNativeApp: true,
    supportsAutoReconnect: false,
    supportsBackgroundPrinting: false,
  },
};

export function getTransportCapability(
  transport: PrinterTransport
): PrinterCapability {
  return PRINTER_TRANSPORT_CATALOG[transport];
}

export function listAllTransportCapabilities(): PrinterCapability[] {
  return Object.values(PRINTER_TRANSPORT_CATALOG);
}

export function listImplementedTransportCapabilities(): PrinterCapability[] {
  return listAllTransportCapabilities().filter((c) => c.implemented);
}

/** Maps persisted driver kind to canonical transport id. */
export function driverKindToTransport(
  kind: BluetoothDriverKind
): PrinterTransport {
  switch (kind) {
    case 'web-ble':
      return 'web-ble';
    case 'capacitor-ble':
      return 'android-ble';
    case 'capacitor-spp':
      return 'android-spp';
    case 'tcp':
      return 'tcp';
    case 'usb':
      return 'usb';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function transportToDriverKind(
  transport: PrinterTransport
): BluetoothDriverKind | null {
  switch (transport) {
    case 'web-ble':
      return 'web-ble';
    case 'android-ble':
      return 'capacitor-ble';
    default:
      return null;
  }
}
