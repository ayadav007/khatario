'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Bluetooth, Loader2, Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BondedBluetoothDevice } from '@/lib/bluetooth/native/khatario-bluetooth-spp';
import { bondedDevicePrinterScore } from '@/lib/bluetooth/bonded-device-rank';
import { mapBluetoothUserMessage } from '@/lib/bluetooth/user-errors';

type Props = {
  open: boolean;
  onClose: () => void;
  onConnect: (device: BondedBluetoothDevice) => Promise<void>;
  onOpenBluetoothSettings: () => Promise<void>;
  loadDevices: () => Promise<BondedBluetoothDevice[]>;
};

export function BluetoothDevicePickerSheet({
  open,
  onClose,
  onConnect,
  onOpenBluetoothSettings,
  loadDevices,
}: Props) {
  const [devices, setDevices] = useState<BondedBluetoothDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await loadDevices();
      setDevices(list);
    } catch (e: unknown) {
      setError(mapBluetoothUserMessage(e));
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [loadDevices]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10070] bg-black/40 animate-in fade-in duration-200"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-[10071] flex max-h-[80vh] flex-col rounded-t-2xl border border-border bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.15)] animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Connect printer</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-text-secondary hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <ol className="text-xs text-text-secondary space-y-1 mb-3 list-decimal list-inside">
            <li>Turn the printer on (Bluetooth light blinking or solid).</li>
            <li>Pair it once in phone Bluetooth settings if it is not in the list.</li>
            <li>Tap Connect on the printer name (not headphones or a watch).</li>
          </ol>
          <p className="text-xs font-semibold uppercase text-text-secondary mb-2">Paired on this phone</p>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : (
            <>
              {error ? <p className="text-sm text-red-600 py-2">{error}</p> : null}
              {devices.length === 0 && !error ? (
                <p className="text-sm text-text-secondary py-4">
                  No paired devices yet. Open Bluetooth settings, pair the printer, then tap Refresh.
                </p>
              ) : null}
              {devices.length > 0 ? (
                <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                  {devices.map((d) => {
                    const likely = bondedDevicePrinterScore(d) >= 2;
                    return (
                      <li key={d.address} className="flex items-center gap-3 px-3 py-3 bg-surface">
                        <Bluetooth className="h-5 w-5 shrink-0 text-text-secondary" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-text-primary truncate">{d.name}</p>
                          <p className="text-xs text-text-muted">
                            {likely ? 'Looks like a printer · ' : 'Other Bluetooth device · '}
                            <span className="font-mono">{d.address}</span>
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant={likely ? 'primary' : 'secondary'}
                          size="sm"
                          className="shrink-0"
                          disabled={connectingAddress !== null}
                          onClick={async () => {
                            setConnectingAddress(d.address);
                            setError(null);
                            try {
                              await onConnect(d);
                              onClose();
                            } catch (e: unknown) {
                              setError(mapBluetoothUserMessage(e));
                            } finally {
                              setConnectingAddress(null);
                            }
                          }}
                        >
                          {connectingAddress === d.address ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Connect'
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          )}
        </div>
        <div className="border-t border-border px-4 py-4 space-y-3">
          <p className="text-center text-sm text-text-secondary">Printer not in the list?</p>
          <Button type="button" variant="secondary" className="w-full" onClick={() => onOpenBluetoothSettings()}>
            <Settings className="h-4 w-4 mr-2" />
            Open phone Bluetooth settings
          </Button>
          <Button type="button" variant="ghost" className="w-full text-sm" onClick={refresh}>
            Refresh list
          </Button>
        </div>
      </div>
    </>
  );
}
