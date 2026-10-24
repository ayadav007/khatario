'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { UseBluetoothPrinterResult } from '@/hooks/useBluetoothPrinter';
import type { SavedBluetoothPrinter } from '@/lib/bluetooth/types';
import { mapBluetoothUserMessage } from '@/lib/bluetooth/user-errors';
import { PrinterConnectWizard } from '@/components/printer/PrinterConnectWizard';

type WizardState = { reason: string; error: string | null };

export type PrinterReady = {
  /** A printer is set up for this kind of printing (it connects when the print starts). */
  ready: boolean;
  /** Printer that will be used, if any. */
  printer: SavedBluetoothPrinter | null;
  /** True while the printer is actually connected right now. */
  connected: boolean;
  /** Bluetooth printing can work on this device at all. */
  available: boolean;
  /** Open the connection wizard; resolves with the printer, or null if the user closes it. */
  openWizard(reason?: string, error?: string | null): Promise<SavedBluetoothPrinter | null>;
  /**
   * Print with the ready printer. When none is ready, or the print fails because the printer
   * cannot be reached, the wizard opens; after the user connects, the print is tried again.
   * Resolves true when printed, false when the user closed the wizard. A second failure throws.
   */
  print(reason: string, send: (printer: SavedBluetoothPrinter) => Promise<void>): Promise<boolean>;
  /** Render this once on the page. */
  dialog: ReactNode;
};

const DEFAULT_REASON = 'Connect a printer to print.';

/**
 * One way for every print action to check the printer first: "Printer not connected"
 * plus the connection wizard instead of a silent failure or a toast.
 */
export function usePrinterReady(bt: UseBluetoothPrinterResult, usage: 'labels' | 'receipts'): PrinterReady {
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const resolver = useRef<((printer: SavedBluetoothPrinter | null) => void) | null>(null);

  const printer = bt.getPreferred(usage) ?? bt.activePrinter ?? bt.savedPrinters[0] ?? null;
  const available = bt.supported || bt.supportsClassicBluetooth;
  const ready = available && !!printer;

  const settle = useCallback((value: SavedBluetoothPrinter | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setWizard(null);
    resolve?.(value);
  }, []);

  // A page that unmounts with the wizard open resolves its pending print as cancelled.
  useEffect(() => () => resolver.current?.(null), []);

  const openWizard = useCallback(
    (reason: string = DEFAULT_REASON, error: string | null = null) =>
      new Promise<SavedBluetoothPrinter | null>((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setWizard({ reason, error });
      }),
    [],
  );

  const print = useCallback(
    async (reason: string, send: (printer: SavedBluetoothPrinter) => Promise<void>) => {
      const first = ready && printer ? printer : await openWizard(reason);
      if (!first) return false;
      try {
        await send(first);
        return true;
      } catch (err) {
        const retry = await openWizard(reason, mapBluetoothUserMessage(err));
        if (!retry) return false;
        await send(retry);
        return true;
      }
    },
    [openWizard, printer, ready],
  );

  const dialog = wizard ? (
    <PrinterConnectWizard
      bt={bt}
      reason={wizard.reason}
      error={wizard.error}
      onConnected={(p) => settle(p)}
      onCancel={() => settle(null)}
    />
  ) : null;

  return {
    ready,
    printer,
    connected: bt.status === 'connected' && !!bt.activePrinter,
    available,
    openWizard,
    print,
    dialog,
  };
}
