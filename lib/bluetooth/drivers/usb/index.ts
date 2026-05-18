/**
 * USB thermal printers — placeholder.
 */

import { getTransportCapability } from '@/lib/printer/capabilities';
import { UnsupportedPrinterDriver } from '../unsupported-driver';

export class UsbPrinterDriver extends UnsupportedPrinterDriver {
  readonly kind = 'usb' as const;

  constructor() {
    super(getTransportCapability('usb'));
  }
}

export function createUsbPrinterDriver(): UsbPrinterDriver {
  return new UsbPrinterDriver();
}
