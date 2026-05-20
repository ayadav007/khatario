/**
 * Android Classic Bluetooth (SPP) driver — ESC/POS over RFCOMM.
 */

import { getTransportCapability } from '@/lib/printer/capabilities';
import type {
  BluetoothPrinterDriver,
  PairResult,
  PrintJob,
  PrinterProfileId,
  SavedBluetoothPrinter,
} from '../../types';
import type { PrinterCapability } from '@/lib/printer/capabilities';
import {
  ensureSppPermissions,
  isSppPluginAvailable,
  listBondedBluetoothDevices,
  openAndroidBluetoothSettings,
  sppConnect,
  sppDisconnect,
  sppWrite,
} from '../../native/khatario-bluetooth-spp';
import { guessProfileFromName, getProfile } from '../../printer-profiles';

export class CapacitorBluetoothNotAvailableError extends Error {
  constructor(msg = 'Classic Bluetooth (SPP) is not available') {
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

function sanitizeName(name: string | undefined | null): string {
  return (name && name.trim()) || 'Bluetooth printer';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CapacitorSppDriver implements BluetoothPrinterDriver {
  readonly kind = 'capacitor-spp' as const;

  private connectedAddress: string | null = null;
  private connectedProfileId: PrinterProfileId = 'generic-escpos-58';

  getCapability(): PrinterCapability {
    return getTransportCapability('android-spp');
  }

  isSupported(): boolean {
    return isSppPluginAvailable();
  }

  /** Opens system Bluetooth settings — use UI device picker for pairing. */
  async openBluetoothSettings(): Promise<void> {
    await openAndroidBluetoothSettings();
  }

  async listBondedDevices() {
    return listBondedBluetoothDevices();
  }

  /**
   * pair() connects to the first bonded device when only one exists;
   * otherwise throws so the BillBook-style picker can run.
   */
  async pair(preferredProfile?: PrinterProfileId): Promise<PairResult> {
    if (!this.isSupported()) {
      throw new CapacitorBluetoothNotAvailableError();
    }
    const ok = await ensureSppPermissions();
    if (!ok) throw new Error('Bluetooth permissions not granted');

    const devices = await listBondedBluetoothDevices();
    if (devices.length === 0) {
      throw new Error(
        'No paired Bluetooth devices found. Pair your printer in phone Settings → Bluetooth first.'
      );
    }
    if (devices.length > 1) {
      throw new Error('MULTIPLE_DEVICES');
    }

    const d = devices[0];
    const profileId = preferredProfile || guessProfileFromName(d.name);
    const printer: SavedBluetoothPrinter = {
      id: d.address,
      name: sanitizeName(d.name),
      driver: this.kind,
      profileId,
      paperWidthMm: getProfile(profileId).paperWidthMm,
      lastUsedAt: Date.now(),
    };
    await this.connect(printer);
    return { printer };
  }

  async connect(printer: SavedBluetoothPrinter): Promise<void> {
    if (!this.isSupported()) {
      throw new CapacitorBluetoothNotAvailableError();
    }
    const ok = await ensureSppPermissions();
    if (!ok) throw new Error('Bluetooth permissions not granted');

    if (this.connectedAddress === printer.id) {
      return;
    }

    await sppDisconnect();
    await sppConnect(printer.id);
    this.connectedAddress = printer.id;
    this.connectedProfileId = printer.profileId;
  }

  async disconnect(): Promise<void> {
    this.connectedAddress = null;
    await sppDisconnect();
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.connectedAddress) {
      throw new CapacitorBluetoothNotConnectedError();
    }

    const profile = getProfile(this.connectedProfileId);
    const chunkSize = Math.max(20, Math.min(1024, profile.chunkSize ?? 512));
    const chunkDelay = Math.max(0, profile.chunkDelayMs ?? 15);
    const bytes = job.bytes;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.subarray(offset, offset + chunkSize);
      await sppWrite(slice);
      if (chunkDelay) await sleep(chunkDelay);
    }
  }
}
