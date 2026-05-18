/**
 * Driver registry descriptors — lazy loaders per transport.
 */

import type { PrinterTransport } from '@/lib/printer/capabilities';
import type { BluetoothPrinterDriver } from '../types';

export type DriverDescriptor = {
  transport: PrinterTransport;
  /** Lower = tried first when multiple match (not used for mutually exclusive runtimes). */
  priority: number;
  /** True when this driver can run in the current environment. */
  matchesRuntime: () => boolean;
  /** Lazy factory — keeps unimplemented / native chunks out of the web bundle. */
  load: () => Promise<BluetoothPrinterDriver>;
};
