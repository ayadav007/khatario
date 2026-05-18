/**
 * Base class for transports that are registered but not yet implemented.
 */

import type { PrinterCapability } from '@/lib/printer/capabilities';
import type {
  BluetoothPrinterDriver,
  BluetoothDriverKind,
  PairResult,
  PrintJob,
  PrinterProfileId,
  SavedBluetoothPrinter,
} from '../types';

export class TransportNotImplementedError extends Error {
  constructor(transport: string) {
    super(
      `${transport} printing is not available in this app version. Use a BLE-compatible printer or PDF printing.`
    );
    this.name = 'TransportNotImplementedError';
  }
}

export abstract class UnsupportedPrinterDriver implements BluetoothPrinterDriver {
  abstract readonly kind: BluetoothDriverKind;

  constructor(private readonly capability: PrinterCapability) {}

  getCapability(): PrinterCapability {
    return this.capability;
  }

  isSupported(): boolean {
    return false;
  }

  async pair(_preferredProfile?: PrinterProfileId): Promise<PairResult> {
    throw new TransportNotImplementedError(this.capability.label);
  }

  async connect(_printer: SavedBluetoothPrinter): Promise<void> {
    throw new TransportNotImplementedError(this.capability.label);
  }

  async disconnect(): Promise<void> {}

  async print(_job: PrintJob): Promise<void> {
    throw new TransportNotImplementedError(this.capability.label);
  }
}
