'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bluetooth, CheckCircle2, Loader2, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BluetoothDevicePickerSheet } from '@/components/printer/BluetoothDevicePickerSheet';
import { DesktopPrinterPicker } from '@/components/printer/DesktopPrinterPicker';
import { desktopPrinterId } from '@/lib/desktop/printing';
import type { UseBluetoothPrinterResult } from '@/hooks/useBluetoothPrinter';
import type { SavedBluetoothPrinter } from '@/lib/bluetooth/types';
import { mapBluetoothUserMessage } from '@/lib/bluetooth/user-errors';

type Props = {
  bt: UseBluetoothPrinterResult;
  /** What the user was trying to print, e.g. "Connect a printer to print these labels." */
  reason: string;
  /** Heading; defaults to "Printer not connected". */
  title?: string;
  /** Why the last print failed, when the wizard opened after a failure. */
  error?: string | null;
  onConnected: (printer: SavedBluetoothPrinter) => void;
  onCancel: () => void;
};

/**
 * Shown when a print needs a Bluetooth printer and none is ready: explains what to do and
 * connects one (saved printer, paired phone printer, a Bluetooth search in Chrome/Edge, or in
 * Khatario for Windows a Windows / network / COM port printer).
 */
export function PrinterConnectWizard({ bt, reason, title = 'Printer not connected', error, onConnected, onCancel }: Props) {
  const titleId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const canUseBluetooth = bt.supported || bt.supportsClassicBluetooth;
  const device = bt.isNative ? 'phone' : 'computer';

  const run = async (key: string, action: () => Promise<SavedBluetoothPrinter | null>) => {
    setBusy(key);
    setStepError(null);
    try {
      const printer = await action();
      if (printer) onConnected(printer);
    } catch (e) {
      setStepError(mapBluetoothUserMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const connectSaved = (printer: SavedBluetoothPrinter) =>
    run(printer.id, async () => {
      await bt.connect(printer);
      return printer;
    });

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <Printer className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-text-primary">
                {title}
              </h2>
              <p className="text-sm text-text-secondary">{reason}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {(error || stepError) && (
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {stepError || error}
          </p>
        )}

        {bt.isDesktop ? (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">Turn the printer on, check it has paper, then choose it below.</p>
            {bt.savedPrinters.some((p) => p.driver === 'desktop') && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Your printers</p>
                <div className="space-y-2">
                  {bt.savedPrinters
                    .filter((p) => p.driver === 'desktop')
                    .map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-primary">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                          <span className="truncate">{p.name}</span>
                        </span>
                        <Button type="button" size="sm" variant="secondary" disabled={!!busy} onClick={() => connectSaved(p)}>
                          {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            )}
            <DesktopPrinterPicker
              busy={busy}
              onChoose={(target, name) => run(desktopPrinterId(target), () => bt.addDesktopPrinter(target, name))}
            />
            <Link
              href="/settings/bluetooth-printer"
              className="block text-center text-sm font-medium text-primary-600 hover:text-primary-700"
              onClick={onCancel}
            >
              Printer settings
            </Link>
          </div>
        ) : !canUseBluetooth ? (
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              This browser cannot reach Bluetooth printers. Open Khatario in Chrome or Edge, use the Khatario Android
              app, or install Khatario for Windows for USB and network printers. You can also choose a regular printer
              (PDF) instead.
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={onCancel}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="space-y-1.5 text-sm text-text-secondary">
              <li>1. Turn the printer on and check it has paper.</li>
              <li>2. Turn on Bluetooth on this {device}.</li>
              {bt.supportsClassicBluetooth && <li>3. Pair the printer once in phone Settings → Bluetooth.</li>}
            </ol>

            {bt.savedPrinters.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Your printers</p>
                <div className="space-y-2">
                  {bt.savedPrinters.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-primary">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <Button type="button" size="sm" variant="secondary" disabled={!!busy} onClick={() => connectSaved(p)}>
                        {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {bt.supportsClassicBluetooth ? (
                <Button type="button" disabled={!!busy} onClick={() => setPickerOpen(true)}>
                  <Bluetooth className="mr-2 h-4 w-4" />
                  Choose a paired printer
                </Button>
              ) : (
                <Button type="button" disabled={!!busy} onClick={() => run('pair', () => bt.pair())}>
                  {busy === 'pair' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bluetooth className="mr-2 h-4 w-4" />}
                  Find printer
                </Button>
              )}
              <Link
                href="/settings/bluetooth-printer"
                className="text-center text-sm font-medium text-primary-600 hover:text-primary-700"
                onClick={onCancel}
              >
                Printer settings
              </Link>
            </div>
          </div>
        )}
      </div>

      <BluetoothDevicePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        loadDevices={bt.listBondedDevices}
        onOpenBluetoothSettings={bt.openBluetoothSettings}
        onConnect={async (device) => {
          const printer = await bt.connectBondedDevice(device);
          setPickerOpen(false);
          if (printer) onConnected(printer);
        }}
      />
    </div>
  );
}
