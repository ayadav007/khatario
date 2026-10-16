'use client';

import { clsx } from 'clsx';
import { Printer } from 'lucide-react';
import type { PrinterReady } from '@/hooks/usePrinterReady';

/**
 * Shows before printing whether a Bluetooth printer is ready ("Printer: TVS RP3160")
 * or not ("Printer not connected · Connect", which opens the connection wizard).
 */
export function PrinterStatusChip({ printer, reason, className }: { printer: PrinterReady; reason: string; className?: string }) {
  if (printer.ready && printer.printer) {
    return (
      <button
        type="button"
        onClick={() => printer.openWizard(reason)}
        title="Change printer"
        className={clsx(
          'inline-flex max-w-full items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300',
          className,
        )}
      >
        <span className={clsx('h-2 w-2 shrink-0 rounded-full', printer.connected ? 'bg-green-600' : 'bg-green-400')} aria-hidden />
        <span className="truncate">Printer: {printer.printer.name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => printer.openWizard(reason)}
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
        className,
      )}
    >
      <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {printer.available ? 'Printer not connected · Connect' : 'Bluetooth printing not available here'}
    </button>
  );
}
