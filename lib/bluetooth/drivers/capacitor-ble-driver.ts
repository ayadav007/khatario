/**
 * CAPACITOR BLE DRIVER
 *
 * BluetoothPrinterDriver implementation that uses the
 * @capacitor-community/bluetooth-le plugin inside the Capacitor Android /
 * iOS shell.
 *
 * This driver is only loaded when `driver-registry.ts` detects that we're
 * running inside Capacitor (via `window.Capacitor.isNativePlatform()`).
 * In a plain-browser build the plugin module is never imported, so the
 * web bundle stays slim.
 *
 * Behaviour parity with WebBleDriver
 * ----------------------------------
 *  - pair()      : opens the Capacitor BLE device picker, returns a
 *                  SavedBluetoothPrinter and eagerly connects.
 *  - connect()   : idempotent, reconnects if the native stack dropped the
 *                  GATT link.
 *  - disconnect(): best-effort.
 *  - print()     : chunked writeWithoutResponse (falls back to write) with
 *                  the chunk size / pacing declared by the printer profile.
 *
 * Caveats
 * -------
 *  - On Android 12+ the host Activity must hold BLUETOOTH_SCAN and
 *    BLUETOOTH_CONNECT runtime permissions. `initialize()` triggers the
 *    prompt; consumers should invoke it eagerly (the hook does).
 *  - iOS additionally requires NSBluetoothAlwaysUsageDescription in
 *    Info.plist. iOS build is Phase B+ and not yet wired.
 */

import { getTransportCapability } from '@/lib/printer/capabilities';
import type {
  BluetoothPrinterDriver,
  PairResult,
  PrintJob,
  PrinterProfileId,
  SavedBluetoothPrinter,
} from '../types';
import type { PrinterCapability } from '@/lib/printer/capabilities';
import {
  PRINTER_PROFILES,
  getProfile,
  guessProfileFromName,
} from '../printer-profiles';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CapacitorBluetoothNotAvailableError extends Error {
  constructor(msg = 'Capacitor Bluetooth plugin is not available') {
    super(msg);
    this.name = 'CapacitorBluetoothNotAvailableError';
  }
}

export class CapacitorBluetoothNotConnectedError extends Error {
  constructor(msg = 'Bluetooth printer is not connected') {
    super(msg);
    this.name = 'CapacitorBluetoothNotConnectedError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConnectedState {
  printerId: string;
  profileId: PrinterProfileId;
  serviceUuid: string;
  characteristicUuid: string;
}

function sanitizeName(name: string | undefined | null): string {
  return (name && name.trim()) || 'Bluetooth printer';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDataView(bytes: Uint8Array): DataView {
  // Capacitor's BleClient.write* expects a DataView so the underlying
  // native bridge can pass it through untouched.
  return new DataView(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  );
}

/**
 * Dynamically import the plugin. We use a variable path so bundlers building
 * for the web won't try to resolve it statically.
 */
async function loadBleClient(): Promise<any> {
  try {
    const pkg = '@capacitor-community/bluetooth-le';
    const mod: any = await import(/* webpackIgnore: true */ pkg);
    if (!mod?.BleClient) {
      throw new CapacitorBluetoothNotAvailableError(
        'BleClient export not found on @capacitor-community/bluetooth-le'
      );
    }
    return mod.BleClient;
  } catch (err: any) {
    throw new CapacitorBluetoothNotAvailableError(
      `Failed to load @capacitor-community/bluetooth-le: ${
        err?.message || err
      }`
    );
  }
}

/**
 * Given the services exposed by a freshly-connected device, pick the first
 * service/characteristic pair that matches the printer profile AND supports
 * writeWithoutResponse (preferred) or write.
 */
function pickWriteable(
  services: any[],
  profileId: PrinterProfileId
): { serviceUuid: string; characteristicUuid: string } | null {
  const profile = getProfile(profileId);
  const wanted = new Set(profile.gattServiceUUIDs.map((u) => u.toLowerCase()));
  const wantedChars = new Set(
    profile.writeCharacteristicUUIDs.map((u) => u.toLowerCase())
  );

  for (const svc of services) {
    const sUuid = String(svc.uuid || '').toLowerCase();
    if (!wanted.has(sUuid) && wanted.size > 0) continue;

    // 1) Prefer explicit profile characteristic matches.
    for (const ch of svc.characteristics || []) {
      const cUuid = String(ch.uuid || '').toLowerCase();
      const props = ch.properties || {};
      if (
        wantedChars.has(cUuid) &&
        (props.write || props.writeWithoutResponse)
      ) {
        return { serviceUuid: sUuid, characteristicUuid: cUuid };
      }
    }
    // 2) Fall back to any writeable characteristic on this service.
    for (const ch of svc.characteristics || []) {
      const cUuid = String(ch.uuid || '').toLowerCase();
      const props = ch.properties || {};
      if (props.write || props.writeWithoutResponse) {
        return { serviceUuid: sUuid, characteristicUuid: cUuid };
      }
    }
  }

  // Absolute last resort: first characteristic across any service that
  // supports write. Only relevant when `wanted` was empty or unmatched.
  for (const svc of services) {
    for (const ch of svc.characteristics || []) {
      const props = ch.properties || {};
      if (props.write || props.writeWithoutResponse) {
        return {
          serviceUuid: String(svc.uuid || '').toLowerCase(),
          characteristicUuid: String(ch.uuid || '').toLowerCase(),
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export class CapacitorBleDriver implements BluetoothPrinterDriver {
  readonly kind = 'capacitor-ble' as const;

  getCapability(): PrinterCapability {
    return getTransportCapability('android-ble');
  }

  private initialized = false;
  private connected: ConnectedState | null = null;

  isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const cap = (window as any).Capacitor;
    if (!cap) return false;
    return typeof cap.isNativePlatform === 'function'
      ? !!cap.isNativePlatform()
      : false;
  }

  /**
   * Initialize the native side once per page-load. Calling this repeatedly
   * is safe — the plugin tolerates that.
   */
  private async ensureInitialized(Ble: any): Promise<void> {
    if (this.initialized) return;
    try {
      await Ble.initialize({ androidNeverForLocation: true });
      this.initialized = true;
    } catch (err: any) {
      throw new CapacitorBluetoothNotAvailableError(
        `BleClient.initialize failed: ${err?.message || err}`
      );
    }
  }

  async pair(preferredProfile?: PrinterProfileId): Promise<PairResult> {
    const Ble = await loadBleClient();
    await this.ensureInitialized(Ble);

    const profile = preferredProfile ? getProfile(preferredProfile) : null;

    // Aggregate every service UUID we could care about so the OS picker
    // can show matching devices.
    const allServices = new Set<string>();
    for (const p of PRINTER_PROFILES) {
      for (const u of p.gattServiceUUIDs) allServices.add(u.toLowerCase());
    }
    const optionalServices = Array.from(allServices);
    const filters = profile
      ? [
          { services: profile.gattServiceUUIDs },
          ...(profile.deviceNamePrefixes || []).map((prefix) => ({
            namePrefix: prefix,
          })),
        ]
      : undefined;

    let device: any;
    try {
      device = await Ble.requestDevice({
        services: profile ? profile.gattServiceUUIDs : [],
        optionalServices,
        // Android-only flag on newer plugin versions; silently ignored otherwise.
        allowDuplicates: false,
        // name prefix filters only honoured by some plugin versions; harmless.
        namePrefix: filters
          ? (filters
              .map((f: any) => f.namePrefix)
              .filter(Boolean)[0] as string | undefined)
          : undefined,
      });
    } catch (err: any) {
      if (
        err?.message?.match(/user cancel/i) ||
        err?.message?.match(/no device selected/i)
      ) {
        throw new Error('No printer selected');
      }
      throw err;
    }

    const resolvedProfileId: PrinterProfileId =
      preferredProfile || guessProfileFromName(device?.name);

    const printer: SavedBluetoothPrinter = {
      id: device.deviceId,
      name: sanitizeName(device.name),
      driver: this.kind,
      profileId: resolvedProfileId,
      paperWidthMm: getProfile(resolvedProfileId).paperWidthMm,
      lastUsedAt: Date.now(),
    };

    // Eagerly connect so we catch GATT issues during pairing rather than
    // at the first print.
    await this.connect(printer);

    return { printer };
  }

  async connect(printer: SavedBluetoothPrinter): Promise<void> {
    const Ble = await loadBleClient();
    await this.ensureInitialized(Ble);

    if (
      this.connected &&
      this.connected.printerId === printer.id &&
      this.connected.profileId === printer.profileId
    ) {
      // Already connected; a no-op is fine since print() will lazily
      // reconnect if the native stack dropped the GATT link.
      return;
    }

    try {
      await Ble.connect(
        printer.id,
        /* onDisconnect */ () => {
          if (
            this.connected &&
            this.connected.printerId === printer.id
          ) {
            this.connected = null;
          }
        }
      );
    } catch (err: any) {
      if (err?.message?.match(/already connected/i)) {
        // Fine – the native side considers us connected from a prior
        // session. Continue to service discovery.
      } else {
        throw err;
      }
    }

    const services: any[] = await Ble.getServices(printer.id);
    const picked = pickWriteable(services, printer.profileId);
    if (!picked) {
      throw new Error(
        `No writeable characteristic found on ${sanitizeName(
          printer.name
        )}`
      );
    }

    this.connected = {
      printerId: printer.id,
      profileId: printer.profileId,
      serviceUuid: picked.serviceUuid,
      characteristicUuid: picked.characteristicUuid,
    };
  }

  async disconnect(): Promise<void> {
    const c = this.connected;
    this.connected = null;
    if (!c) return;
    try {
      const Ble = await loadBleClient();
      await Ble.disconnect(c.printerId);
    } catch {
      // best-effort
    }
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.connected) {
      throw new CapacitorBluetoothNotConnectedError();
    }
    const Ble = await loadBleClient();
    const { printerId, profileId, serviceUuid, characteristicUuid } =
      this.connected;
    const profile = getProfile(profileId);

    // `writeWithoutResponse` on the native plugin caps payloads to ~MTU-3,
    // typically 20 bytes on old stacks, up to 512 on modern Android. We
    // default to the profile's chunkSize (20 is safe everywhere).
    const chunkSize = Math.max(20, Math.min(512, profile.chunkSize ?? 100));
    const chunkDelay = Math.max(0, profile.chunkDelayMs ?? 20);

    const bytes = job.bytes;

    // Try writeWithoutResponse first. If the char doesn't support it
    // we'll get a "property not supported" error and fall back to write().
    let preferNoResponse = true;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.subarray(offset, offset + chunkSize);
      const dv = toDataView(slice);

      try {
        if (preferNoResponse) {
          await Ble.writeWithoutResponse(
            printerId,
            serviceUuid,
            characteristicUuid,
            dv
          );
        } else {
          await Ble.write(
            printerId,
            serviceUuid,
            characteristicUuid,
            dv
          );
        }
      } catch (err: any) {
        if (
          preferNoResponse &&
          err?.message?.match(/not support|unsupported/i)
        ) {
          // Retry the same chunk with plain write().
          preferNoResponse = false;
          offset -= chunkSize;
          continue;
        }
        throw err;
      }

      if (chunkDelay) await sleep(chunkDelay);
    }
  }
}
