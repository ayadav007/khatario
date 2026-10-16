'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cable, Loader2, Network, Printer, RefreshCw, Search, Usb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  listSerialPorts,
  listWindowsPrinters,
  scanNetworkPrinters,
  type DesktopPrinterAttachment,
  type DesktopPrinterTarget,
  type WindowsPrinterInfo,
} from '@/lib/desktop/printing';
import { mapBluetoothUserMessage } from '@/lib/bluetooth/user-errors';

type Props = {
  /** Saves and connects the chosen printer; rejects with a cashier-facing error. */
  onChoose: (target: DesktopPrinterTarget, name: string) => Promise<void>;
  busy: string | null;
};

const ATTACHMENT_LABEL: Record<DesktopPrinterAttachment, string> = {
  usb: 'USB',
  network: 'Network',
  serial: 'COM port',
  bluetooth: 'Bluetooth',
  virtual: 'Not a printer',
  other: 'Installed',
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Printers this Windows computer can reach, for Khatario for Windows. */
export function DesktopPrinterPicker({ onChoose, busy }: Props) {
  const [printers, setPrinters] = useState<WindowsPrinterInfo[] | null>(null);
  const [ports, setPorts] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ip, setIp] = useState('');
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, com] = await Promise.all([listWindowsPrinters(), listSerialPorts()]);
      // Real printers first, the Windows default on top; Print to PDF and the like at the end.
      setPrinters(
        [...list].sort(
          (a, b) =>
            Number(a.attachment === 'virtual') - Number(b.attachment === 'virtual') ||
            Number(b.isDefault) - Number(a.isDefault) ||
            a.name.localeCompare(b.name)
        )
      );
      setPorts(com);
    } catch (e) {
      setPrinters([]);
      setLoadError(mapBluetoothUserMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = async () => {
    setScanning(true);
    setLoadError(null);
    try {
      setFound(await scanNetworkPrinters());
    } catch (e) {
      setLoadError(mapBluetoothUserMessage(e));
    } finally {
      setScanning(false);
    }
  };

  const chooseButton = (key: string, target: DesktopPrinterTarget, name: string, disabled = false) => (
    <Button type="button" size="sm" variant="secondary" disabled={!!busy || disabled} onClick={() => onChoose(target, name)}>
      {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Use'}
    </Button>
  );

  const realPrinters = (printers ?? []).filter((p) => p.attachment !== 'virtual');

  return (
    <div className="space-y-4">
      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Printers on this computer</p>
          <button type="button" onClick={() => void load()} className="text-text-muted hover:text-text-primary" aria-label="Refresh printers">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        {printers === null ? (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Looking for printers…
          </p>
        ) : realPrinters.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No printers installed in Windows. Plug in the USB printer and install its driver from the box or the maker&apos;s
            website, or add a network printer below.
          </p>
        ) : (
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {realPrinters.map((p) => {
              const key = `win:${p.name}`;
              const problem = p.offline ? 'Offline' : p.paused ? 'Paused' : p.error ? 'Needs attention' : null;
              return (
                <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      {p.attachment === 'usb' ? <Usb className="h-4 w-4 shrink-0 text-text-muted" /> : p.attachment === 'network' ? <Network className="h-4 w-4 shrink-0 text-text-muted" /> : <Printer className="h-4 w-4 shrink-0 text-text-muted" />}
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="text-xs text-text-muted">
                      {ATTACHMENT_LABEL[p.attachment]}
                      {p.isDefault ? ' · Windows default' : ''}
                      {problem ? <span className="text-amber-600 dark:text-amber-400"> · {problem}</span> : null}
                    </span>
                  </span>
                  {chooseButton(key, { kind: 'windows', printer: p.name }, p.name)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {ports.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">COM ports</p>
          <p className="mb-2 text-xs text-text-secondary">
            Bluetooth printers paired in Windows settings and USB-serial printers appear here.
          </p>
          <div className="flex flex-wrap gap-2">
            {ports.map((port) => (
              <div key={port} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                <Cable className="h-4 w-4 text-text-muted" aria-hidden />
                <span className="text-sm font-medium text-text-primary">{port}</span>
                {chooseButton(`com:${port}`, { kind: 'serial', port }, `Printer on ${port}`)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Network printer (Wi‑Fi / LAN)</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (IPV4.test(ip.trim())) void onChoose({ kind: 'network', host: ip.trim(), port: 9100 }, `Network printer ${ip.trim()}`);
          }}
        >
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            inputMode="decimal"
            placeholder="Printer IP, e.g. 192.168.1.50"
            aria-label="Printer IP address"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          />
          <Button type="submit" size="sm" disabled={!!busy || !IPV4.test(ip.trim())}>
            {busy === `net:${ip.trim()}:9100` ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </Button>
        </form>
        <p className="mt-1 text-xs text-text-muted">The IP is printed on the printer&apos;s self-test page (hold FEED while turning it on).</p>
        <button
          type="button"
          onClick={() => void scan()}
          disabled={scanning}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 disabled:opacity-60"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {scanning ? 'Searching the network…' : 'Search the network'}
        </button>
        {found && (
          <div className="mt-2 space-y-2">
            {found.length === 0 ? (
              <p className="text-sm text-text-secondary">No network printers answered. Check the printer is on the same router.</p>
            ) : (
              found.map((host) => (
                <div key={host} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Network className="h-4 w-4 text-text-muted" aria-hidden />
                    {host}
                  </span>
                  {chooseButton(`net:${host}:9100`, { kind: 'network', host, port: 9100 }, `Network printer ${host}`)}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
