/**
 * WEB BLUETOOTH DRIVER
 *
 * Implements BluetoothPrinterDriver using the browser-native Web Bluetooth
 * API (navigator.bluetooth). Works on:
 *   - Chrome / Edge / Opera on Windows, macOS, Linux, ChromeOS, Android
 *   - Samsung Internet on Android
 *
 * Does NOT work on:
 *   - iOS Safari (Apple disallows Web Bluetooth in every iOS browser)
 *   - Firefox (any platform)
 *
 * For iOS or classic-Bluetooth (SPP) printers, the consumer will be wrapped
 * in Capacitor and this driver is swapped for the Capacitor community
 * bluetooth-le plugin driver by driver-registry.ts.
 *
 * All Web Bluetooth types are accessed via structural typing (`any`) so
 * this file compiles in Node / SSR without a `@types/web-bluetooth`
 * dependency. The driver throws `BluetoothNotSupportedError` early if we're
 * not in a browser that supports the API.
 */

import { getTransportCapability } from '@/lib/printer/capabilities';
import type { PrinterCapability } from '@/lib/printer/capabilities';
import type {
  BluetoothPrinterDriver,
  PairResult,
  PrintJob,
  SavedBluetoothPrinter,
  PrinterProfileId,
} from '../types';
import {
  PRINTER_PROFILES,
  getProfile,
  guessProfileFromName,
} from '../printer-profiles';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BluetoothNotSupportedError extends Error {
  constructor(msg = 'Web Bluetooth is not available in this browser') {
    super(msg);
    this.name = 'BluetoothNotSupportedError';
  }
}

export class BluetoothNotConnectedError extends Error {
  constructor(msg = 'Bluetooth printer is not connected') {
    super(msg);
    this.name = 'BluetoothNotConnectedError';
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface ConnectedState {
  printerId: string;
  profileId: PrinterProfileId;
  device: any; // BluetoothDevice
  server: any; // BluetoothRemoteGATTServer
  characteristic: any; // BluetoothRemoteGATTCharacteristic
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNavigatorBluetooth(): any | null {
  if (typeof navigator === 'undefined') return null;
  const n: any = navigator;
  return n.bluetooth || null;
}

function isWriteable(char: any): boolean {
  if (!char || !char.properties) return false;
  return !!(char.properties.write || char.properties.writeWithoutResponse);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeName(name: string | undefined | null): string {
  return (name && name.trim()) || 'Bluetooth printer';
}

/**
 * Discover the first service/characteristic pair that matches the given
 * profile and is writeable. Returns both so the caller can store a handle.
 */
async function findWriteable(
  server: any,
  profileId: PrinterProfileId
): Promise<{ service: any; characteristic: any }> {
  const profile = getProfile(profileId);
  const tried: string[] = [];

  for (const serviceUuid of profile.gattServiceUUIDs) {
    tried.push(serviceUuid);
    let service: any;
    try {
      service = await server.getPrimaryService(serviceUuid);
    } catch {
      continue;
    }
    const chars: any[] = await service.getCharacteristics();

    // 1) Explicitly match any of the profile's characteristic UUIDs first.
    for (const wantUuid of profile.writeCharacteristicUUIDs) {
      const wantLower = wantUuid.toLowerCase();
      const match = chars.find(
        (c: any) => c.uuid.toLowerCase() === wantLower && isWriteable(c)
      );
      if (match) return { service, characteristic: match };
    }

    // 2) Fall back to the first writeable characteristic on the service.
    const anyWriteable = chars.find((c: any) => isWriteable(c));
    if (anyWriteable) return { service, characteristic: anyWriteable };
  }

  throw new Error(
    `No writeable characteristic found on ${sanitizeName(
      server?.device?.name
    )} — tried services: ${tried.join(', ')}`
  );
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export class WebBleDriver implements BluetoothPrinterDriver {
  readonly kind = 'web-ble' as const;

  getCapability(): PrinterCapability {
    return getTransportCapability('web-ble');
  }

  private connected: ConnectedState | null = null;
  /**
   * Keep the last-seen BluetoothDevice objects in memory keyed by their id
   * so we can reconnect without re-prompting the user. Browsers bind
   * pairings to the BluetoothDevice instance, so losing the reference means
   * losing the pairing.
   */
  private knownDevices = new Map<string, any>();

  isSupported(): boolean {
    const bt = getNavigatorBluetooth();
    return !!bt && typeof bt.requestDevice === 'function';
  }

  async pair(preferredProfile?: PrinterProfileId): Promise<PairResult> {
    const bt = getNavigatorBluetooth();
    if (!bt) throw new BluetoothNotSupportedError();

    const profile = preferredProfile ? getProfile(preferredProfile) : null;

    // Advertise all service UUIDs we might care about so the user sees every
    // printer-shaped device in the picker. `optionalServices` is required so
    // Chrome lets us call getPrimaryService() later.
    const allServices = new Set<string>();
    for (const p of PRINTER_PROFILES) {
      for (const u of p.gattServiceUUIDs) allServices.add(u.toLowerCase());
    }

    const requestOptions: any = profile
      ? {
          filters: [
            { services: profile.gattServiceUUIDs },
            // Some printers advertise no service UUIDs but do expose a name
            // prefix we know; include those as a fallback filter so they
            // still appear in the picker.
            ...(profile.deviceNamePrefixes || []).map((prefix) => ({
              namePrefix: prefix,
            })),
          ],
          optionalServices: Array.from(allServices),
        }
      : {
          acceptAllDevices: true,
          optionalServices: Array.from(allServices),
        };

    let device: any;
    try {
      device = await bt.requestDevice(requestOptions);
    } catch (err: any) {
      // The API throws NotFoundError when the user cancels the picker. Map
      // that to a cleaner error so UI can distinguish "user cancelled" from
      // "genuine failure".
      if (err?.name === 'NotFoundError') {
        throw new Error('No printer selected');
      }
      throw err;
    }

    this.knownDevices.set(device.id, device);

    const resolvedProfileId =
      preferredProfile || guessProfileFromName(device.name);

    const printer: SavedBluetoothPrinter = {
      id: device.id,
      name: sanitizeName(device.name),
      driver: this.kind,
      profileId: resolvedProfileId,
      paperWidthMm: getProfile(resolvedProfileId).paperWidthMm,
      lastUsedAt: Date.now(),
    };

    // Eagerly connect so we can surface failures during the pairing flow
    // rather than at the first print attempt.
    await this.connect(printer);

    return { printer };
  }

  async connect(printer: SavedBluetoothPrinter): Promise<void> {
    const bt = getNavigatorBluetooth();
    if (!bt) throw new BluetoothNotSupportedError();

    if (
      this.connected &&
      this.connected.printerId === printer.id &&
      this.connected.server?.connected
    ) {
      return;
    }

    // Chrome 85+ can recover previously-authorized devices without a picker.
    let device: any = this.knownDevices.get(printer.id);
    if (!device && typeof bt.getDevices === 'function') {
      try {
        const devices: any[] = await bt.getDevices();
        device = devices.find((d) => d.id === printer.id) || null;
        if (device) this.knownDevices.set(device.id, device);
      } catch {
        device = null;
      }
    }

    if (!device) {
      throw new Error(
        'Printer is not authorized in this browser session. Open Settings → Print & devices and pair it again.'
      );
    }

    const server = await device.gatt.connect();
    const { characteristic } = await findWriteable(server, printer.profileId);

    // Re-bind on disconnect so we can auto-reconnect on the next print.
    const onDisconnect = () => {
      if (this.connected && this.connected.printerId === printer.id) {
        this.connected = null;
      }
      device.removeEventListener('gattserverdisconnected', onDisconnect);
    };
    device.addEventListener('gattserverdisconnected', onDisconnect);

    this.connected = {
      printerId: printer.id,
      profileId: printer.profileId,
      device,
      server,
      characteristic,
    };
  }

  async disconnect(): Promise<void> {
    const c = this.connected;
    this.connected = null;
    try {
      if (c?.server?.connected) c.server.disconnect();
    } catch {
      // best-effort
    }
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.connected) throw new BluetoothNotConnectedError();
    const { characteristic, profileId } = this.connected;
    const profile = getProfile(profileId);

    const chunkSize = Math.max(20, Math.min(512, profile.chunkSize ?? 100));
    const chunkDelay = Math.max(0, profile.chunkDelayMs ?? 20);
    const useWriteWithoutResponse =
      !!characteristic?.properties?.writeWithoutResponse;

    const bytes = job.bytes;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.subarray(offset, offset + chunkSize);
      // Some older Chrome versions require a plain ArrayBuffer.
      const buf = slice.buffer.slice(
        slice.byteOffset,
        slice.byteOffset + slice.byteLength
      );

      // Prefer writeValueWithoutResponse when available — it's dramatically
      // faster on slow BLE links because we don't round-trip for each ACK.
      if (
        useWriteWithoutResponse &&
        typeof characteristic.writeValueWithoutResponse === 'function'
      ) {
        await characteristic.writeValueWithoutResponse(buf);
      } else {
        await characteristic.writeValue(buf);
      }

      if (chunkDelay) await sleep(chunkDelay);
    }
  }
}
