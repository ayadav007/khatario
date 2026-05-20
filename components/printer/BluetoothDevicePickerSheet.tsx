'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Bluetooth, Loader2, Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BondedBluetoothDevice } from '@/lib/bluetooth/native/khatario-bluetooth-spp';

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
    } catch (e: any) {
      setError(e?.message || 'Could not load devices');
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
      <div className="fixed inset-x-0 bottom-0 z-[10071] flex max-h-[70vh] flex-col rounded-t-2xl border border-border bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.15)] animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Select printing device</h2>
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
          <p className="text-xs font-semibold uppercase text-text-secondary mb-2">Available device</p>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 py-4">{error}</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-text-secondary py-4">
              No paired devices found. Pair your printer in phone Bluetooth settings, then tap Refresh.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {devices.map((d) => (
                <li key={d.address} className="flex items-center gap-3 px-3 py-3 bg-surface">
                  <Bluetooth className="h-5 w-5 shrink-0 text-text-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-text-primary truncate">{d.name}</p>
                    <p className="text-xs text-text-muted font-mono">{d.address}</p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    disabled={connectingAddress !== null}
                    onClick={async () => {
                      setConnectingAddress(d.address);
                      try {
                        await onConnect(d);
                        onClose();
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
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border px-4 py-4 space-y-3">
          <p className="text-center text-sm text-text-secondary">Didn&apos;t see your device here?</p>
          <Button type="button" variant="secondary" className="w-full" onClick={() => onOpenBluetoothSettings()}>
            <Settings className="h-4 w-4 mr-2" />
            Open Bluetooth settings
          </Button>
          <Button type="button" variant="ghost" className="w-full text-sm" onClick={refresh}>
            Refresh device list
          </Button>
        </div>
      </div>
    </>
  );
}
