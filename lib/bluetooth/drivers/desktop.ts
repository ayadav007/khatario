/**
 * Khatario for Windows printers: Windows-installed (USB / shared), network (TCP 9100) and COM port
 * printers, reached through the desktop app (lib/desktop/printing.ts). Printers are added from the
 * lists in the connect wizard, not through an OS picker, so pair() is not used.
 */

import { getTransportCapability } from '@/lib/printer/capabilities';
import {
  DesktopPrintError,
  checkDesktopPrinter,
  getNetworkPrinterStatus,
  statusProblem,
  isDesktopPrintingAvailable,
  parseDesktopPrinterId,
  sendToDesktopPrinter,
  type DesktopPrinterTarget,
} from '@/lib/desktop/printing';
import { getProfile } from '../printer-profiles';
import type { BluetoothPrinterDriver, PairResult, PrintJob, SavedBluetoothPrinter } from '../types';

export class DesktopPrinterDriver implements BluetoothPrinterDriver {
  readonly kind = 'desktop' as const;
  private current: { printer: SavedBluetoothPrinter; target: DesktopPrinterTarget } | null = null;

  getCapability() {
    return getTransportCapability('desktop');
  }

  isSupported(): boolean {
    return isDesktopPrintingAvailable();
  }

  async pair(): Promise<PairResult> {
    throw new DesktopPrintError('Choose the printer from the list of this computer’s printers.');
  }

  async connect(printer: SavedBluetoothPrinter): Promise<void> {
    const target = parseDesktopPrinterId(printer.id);
    if (!target) throw new DesktopPrintError(`"${printer.name}" is not a printer on this computer.`);
    // A held "connection" is only a check: every job opens its own spooler job / socket / port.
    if (this.current?.printer.id === printer.id) return;
    await checkDesktopPrinter(target);
    this.current = { printer, target };
  }

  async disconnect(): Promise<void> {
    this.current = null;
  }

  async print(job: PrintJob): Promise<void> {
    if (!this.current) throw new DesktopPrintError('Printer not connected.');
    const { target, printer } = this.current;
    // Network bill printers say when they are out of paper or open; ask first instead of losing the bill.
    if (target.kind === 'network' && getProfile(printer.profileId).language === 'ESCPOS') {
      const status = await getNetworkPrinterStatus(target.host, target.port).catch(() => null);
      const problem = status ? statusProblem(status) : null;
      if (problem) throw new DesktopPrintError(problem);
    }
    try {
      await sendToDesktopPrinter(this.current.target, job.bytes, job.label);
    } catch (err) {
      // Re-check on the next print (the printer may have been unplugged or renamed).
      this.current = null;
      throw err;
    }
  }
}

export function createDesktopPrinterDriver(): DesktopPrinterDriver {
  return new DesktopPrinterDriver();
}
