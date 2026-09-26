'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bluetooth, CheckCircle2, Loader2, Printer, Radio } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import type { UseBluetoothPrinterResult } from '@/hooks/useBluetoothPrinter';
import {
  getPrintPreferences,
  setPrintPreferences,
  type PrintOutputMode,
} from '@/lib/printer/print-preferences';
import { BluetoothDevicePickerSheet } from '@/components/printer/BluetoothDevicePickerSheet';
import { BleVsClassicHelp } from '@/components/printer/BleVsClassicHelp';
import { PRINTER_PROFILES } from '@/lib/bluetooth/printer-profiles';
import type { PrinterProfileId } from '@/lib/bluetooth/types';
import { PRINTER_SETUP_STEPS } from '@/lib/printer/copy';
import clsx from 'clsx';

type Props = {
  onTestPrint?: () => void;
  testing?: boolean;
  bluetooth: UseBluetoothPrinterResult;
};

export function PrintSettingsPanel({ onTestPrint, testing, bluetooth: bt }: Props) {
  const { business } = useAuth();
  const businessId = business?.id || '';
  const [outputMode, setOutputMode] = useState<PrintOutputMode>('thermal');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<PrinterProfileId | ''>('');

  useEffect(() => {
    if (!businessId) return;
    const prefs = getPrintPreferences(businessId);
    setOutputMode(prefs.outputMode);
  }, [businessId]);

  const persistMode = (mode: PrintOutputMode) => {
    setOutputMode(mode);
    if (businessId) setPrintPreferences(businessId, { outputMode: mode });
  };

  const saved =
    bt.activePrinter ||
    bt.savedPrinters.find((p) => p.preferForReceipts) ||
    bt.savedPrinters[0] ||
    null;
  const isLive = bt.status === 'connected' && !!bt.activePrinter;

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Invoice layout and paper size (A4, A5, 58mm, 80mm) are set under{' '}
        <Link href="/settings/templates" className="text-primary-600 hover:text-primary-700 font-medium">
          Templates &amp; printing
        </Link>
        .
      </p>
      <Card padding="none" className="overflow-hidden divide-y divide-border">
        <label className="flex items-start gap-3 p-4 cursor-pointer">
          <input
            type="radio"
            name="print-mode"
            className="mt-1"
            checked={outputMode === 'regular'}
            onChange={() => persistMode('regular')}
          />
          <Printer className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
          <span className="flex-1">
            <span className="font-medium text-text-primary block">Regular printer (PDF)</span>
            <span className="text-xs text-text-secondary">
              Use Print / PDF in the browser. Paper size follows your active invoice template.
            </span>
          </span>
          <Radio className={clsx('w-5 h-5 shrink-0', outputMode === 'regular' ? 'text-primary-600' : 'text-border')} />
        </label>

        <label className="flex items-start gap-3 p-4 cursor-pointer">
          <input
            type="radio"
            name="print-mode"
            className="mt-1"
            checked={outputMode === 'thermal'}
            onChange={() => persistMode('thermal')}
          />
          <Bluetooth className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
          <span className="flex-1">
            <span className="font-medium text-text-primary block">Bluetooth thermal printer</span>
            <span className="text-xs text-text-secondary">58mm / 80mm receipt printers</span>
          </span>
          <Radio className={clsx('w-5 h-5 shrink-0', outputMode === 'thermal' ? 'text-primary-600' : 'text-border')} />
        </label>

        {outputMode === 'thermal' && (
          <div className="px-4 pb-4 bg-gray-50 dark:bg-slate-900/30">
            <p className="text-xs text-text-secondary pt-3 mb-3">{PRINTER_SETUP_STEPS}</p>
            <p className="text-xs font-semibold text-text-secondary uppercase mb-2">This phone</p>
            {saved ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 mb-3">
                <CheckCircle2
                  className={`w-4 h-4 shrink-0 ${isLive ? 'text-green-600' : 'text-text-muted'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">{saved.name}</p>
                  <p className="text-xs text-text-muted">
                    {isLive
                      ? 'Connected — ready to print'
                      : bt.status === 'connecting' || bt.status === 'printing'
                        ? 'Connecting…'
                        : 'Saved. Test print will connect automatically if the printer is on.'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary mb-3">No printer selected on this phone yet.</p>
            )}
            {bt.error ? <p className="text-sm text-red-600 mb-3">{bt.error}</p> : null}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={!bt.supportsClassicBluetooth && !bt.supported}
              className="text-sm font-semibold text-primary-600 hover:text-primary-700"
            >
              {saved ? 'Change device' : 'Connect device'}
            </button>

            {bt.supportsClassicBluetooth && (
              <div className="mt-4 space-y-2">
                <label className="text-xs font-medium text-text-secondary block">Paper / brand (optional)</label>
                <select
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile((e.target.value as PrinterProfileId) || '')}
                  className="w-full border border-border rounded-lg bg-surface text-text-primary px-3 py-2 text-sm"
                >
                  <option value="">Auto-detect (58/80mm thermal)</option>
                  {PRINTER_PROFILES.filter((p) => p.language === 'ESCPOS').map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!bt.supportsClassicBluetooth && bt.isNative && (
              <p className="text-xs text-amber-700 mt-3">
                Rebuild and reinstall the Android app to enable Classic Bluetooth (this build may be outdated).
              </p>
            )}

            {saved && onTestPrint && (
              <Button
                type="button"
                variant="secondary"
                className="w-full mt-4"
                onClick={onTestPrint}
                disabled={testing}
              >
                {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Test print
              </Button>
            )}

            {bt.supportsClassicBluetooth && (
              <details className="mt-4">
                <summary className="text-xs text-primary-600 cursor-pointer">BLE printer (advanced)</summary>
                <p className="text-xs text-text-secondary mt-2 mb-2">
                  Only if your printer supports Bluetooth Low Energy (not typical for budget thermals).
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={bt.status === 'scanning'}
                  onClick={async () => {
                    await bt.pair(selectedProfile || undefined);
                  }}
                >
                  Pair via BLE scan
                </Button>
              </details>
            )}
            <div className="mt-4">
              <BleVsClassicHelp />
            </div>
          </div>
        )}
      </Card>

      <BluetoothDevicePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        loadDevices={bt.listBondedDevices}
        onOpenBluetoothSettings={bt.openBluetoothSettings}
        onConnect={async (device) => {
          await bt.connectBondedDevice(device, selectedProfile || undefined);
        }}
      />
    </div>
  );
}
