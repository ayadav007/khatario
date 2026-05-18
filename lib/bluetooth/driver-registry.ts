/**
 * DRIVER REGISTRY
 *
 * Selects an implemented Bluetooth printer driver for the current runtime.
 * Placeholder transports (SPP, TCP, USB) are registered for diagnostics only.
 */

import type { PrinterTransport } from '@/lib/printer/capabilities';
import { getTransportCapability } from '@/lib/printer/capabilities';
import type { BluetoothPrinterDriver, BluetoothDriverKind } from './types';
import type { DriverDescriptor } from './drivers/registry-types';
import { driverKindToTransport } from '@/lib/printer/capabilities';

let cached: BluetoothPrinterDriver | null = null;
let cachedKind: BluetoothDriverKind | null = null;

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    return !!cap.isNativePlatform();
  }
  if (typeof cap.getPlatform === 'function') {
    const p = cap.getPlatform();
    return p === 'android' || p === 'ios';
  }
  return false;
}

function hasWebBluetoothApi(): boolean {
  if (typeof window === 'undefined') return false;
  const n = navigator as Navigator & { bluetooth?: { requestDevice?: unknown } };
  return !!(n.bluetooth && typeof n.bluetooth.requestDevice === 'function');
}

const DRIVER_DESCRIPTORS: DriverDescriptor[] = [
  {
    transport: 'android-ble',
    priority: 10,
    matchesRuntime: () => isCapacitorNative(),
    load: async () => {
      const mod = await import(
        /* webpackChunkName: "capacitor-ble-driver" */
        './drivers/capacitor-ble'
      );
      return new mod.CapacitorBleDriver();
    },
  },
  {
    transport: 'web-ble',
    priority: 20,
    matchesRuntime: () => !isCapacitorNative() && hasWebBluetoothApi(),
    load: async () => {
      const mod = await import(
        /* webpackChunkName: "web-ble-driver" */
        './drivers/web-ble'
      );
      return new mod.WebBleDriver();
    },
  },
];

/** Placeholders — not selected by getDriver(); exposed for diagnostics / future wiring. */
const PLACEHOLDER_DESCRIPTORS: DriverDescriptor[] = [
  {
    transport: 'android-spp',
    priority: 100,
    matchesRuntime: () => isCapacitorNative(),
    load: async () => {
      const mod = await import('./drivers/capacitor-spp');
      return mod.createCapacitorSppDriver();
    },
  },
  {
    transport: 'tcp',
    priority: 101,
    matchesRuntime: () => true,
    load: async () => {
      const mod = await import('./drivers/tcp');
      return mod.createTcpPrinterDriver();
    },
  },
  {
    transport: 'usb',
    priority: 102,
    matchesRuntime: () => isCapacitorNative(),
    load: async () => {
      const mod = await import('./drivers/usb');
      return mod.createUsbPrinterDriver();
    },
  },
];

function getImplementedDescriptors(): DriverDescriptor[] {
  return [...DRIVER_DESCRIPTORS].sort((a, b) => a.priority - b.priority);
}

/** Synchronous check: any implemented transport can run here. */
export function isBluetoothSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return getImplementedDescriptors().some((d) => d.matchesRuntime());
}

export function getActiveDriverKind(): BluetoothDriverKind | null {
  if (cachedKind) return cachedKind;
  if (isCapacitorNative()) return 'capacitor-ble';
  if (hasWebBluetoothApi()) return 'web-ble';
  return null;
}

export function getActiveTransport(): PrinterTransport | null {
  const kind = getActiveDriverKind();
  return kind ? driverKindToTransport(kind) : null;
}

export function listDriverDescriptors(includePlaceholders = false): DriverDescriptor[] {
  const all = includePlaceholders
    ? [...DRIVER_DESCRIPTORS, ...PLACEHOLDER_DESCRIPTORS]
    : DRIVER_DESCRIPTORS;
  return [...all].sort((a, b) => a.priority - b.priority);
}

/**
 * Load a driver for a specific transport (including placeholders).
 */
export async function loadDriverForTransport(
  transport: PrinterTransport
): Promise<BluetoothPrinterDriver | null> {
  const desc = listDriverDescriptors(true).find((d) => d.transport === transport);
  if (!desc) return null;
  return desc.load();
}

/**
 * Return the active implemented driver for this runtime (cached).
 */
export async function getDriver(): Promise<BluetoothPrinterDriver> {
  if (cached) return cached;

  for (const desc of getImplementedDescriptors()) {
    if (!desc.matchesRuntime()) continue;
    try {
      const driver = await desc.load();
      if (!driver.isSupported()) continue;
      cached = driver;
      cachedKind = driver.kind;
      return driver;
    } catch (err) {
      console.warn(`[bluetooth] Failed to load ${desc.transport} driver`, err);
    }
  }

  const fallback = await import('./drivers/web-ble').then((m) => new m.WebBleDriver());
  cached = fallback;
  cachedKind = fallback.kind;
  return fallback;
}

export function resetDriver(): void {
  if (cached) {
    cached.disconnect().catch(() => {});
  }
  cached = null;
  cachedKind = null;
}

/** Summary for diagnostics UI. */
export function getRegistryDiagnostics(): Array<{
  transport: PrinterTransport;
  implemented: boolean;
  matchesRuntime: boolean;
  label: string;
}> {
  return listDriverDescriptors(true).map((d) => ({
    transport: d.transport,
    implemented: getTransportCapability(d.transport).implemented,
    matchesRuntime: d.matchesRuntime(),
    label: getTransportCapability(d.transport).label,
  }));
}
