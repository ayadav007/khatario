/**
 * Android Classic Bluetooth (SPP / RFCOMM) — placeholder.
 * @see docs/printer-architecture.md
 */

import { getTransportCapability } from '@/lib/printer/capabilities';
import {
  UnsupportedPrinterDriver,
  TransportNotImplementedError,
} from '../unsupported-driver';

export { TransportNotImplementedError };

export class CapacitorSppDriver extends UnsupportedPrinterDriver {
  readonly kind = 'capacitor-spp' as const;

  constructor() {
    super(getTransportCapability('android-spp'));
  }
}

export function createCapacitorSppDriver(): CapacitorSppDriver {
  return new CapacitorSppDriver();
}
