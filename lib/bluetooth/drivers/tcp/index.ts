/**
 * Network TCP thermal printers — placeholder.
 */

import { getTransportCapability } from '@/lib/printer/capabilities';
import { UnsupportedPrinterDriver } from '../unsupported-driver';

export class TcpPrinterDriver extends UnsupportedPrinterDriver {
  readonly kind = 'tcp' as const;

  constructor() {
    super(getTransportCapability('tcp'));
  }
}

export function createTcpPrinterDriver(): TcpPrinterDriver {
  return new TcpPrinterDriver();
}
