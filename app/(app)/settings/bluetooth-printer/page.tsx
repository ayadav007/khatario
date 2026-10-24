'use client';

/**
 * SETTINGS > PRINTERS
 *
 * The printers this device prints to: Bluetooth (Android app / Chrome), and in Khatario for Windows
 * also USB, network and COM port printers. Each printer has a type (which sets its command language:
 * ESC/POS bills, TSPL / ZPL labels), paper, bill options (copies, cutter, cash drawer) and label
 * options (darkness, speed, gap), and can be the default for bills and/or labels.
 *
 * Printers are saved on this device (localStorage), because a printer connection belongs to the
 * device, not the business.
 *
 * Feature gate: `barcode_thermal_printer`.
 */

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Banknote,
  Bluetooth,
  Cable,
  CheckCircle2,
  Loader2,
  Monitor,
  Network,
  Plus,
  Printer,
  Settings2,
  Star,
  TestTube2,
  Trash2,
  Usb,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { useBluetoothPrinter, type UseBluetoothPrinterResult } from '@/hooks/useBluetoothPrinter';
import { getProfile } from '@/lib/bluetooth/printer-profiles';
import type { SavedBluetoothPrinter } from '@/lib/bluetooth/types';
import { parseDesktopPrinterId } from '@/lib/desktop/printing';
import { PRINTER_ANDROID_APP_NOTE, PRINTER_NOT_SUPPORTED_BROWSER } from '@/lib/printer/copy';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';
import { PrinterConnectWizard } from '@/components/printer/PrinterConnectWizard';
import { PrinterSettingsDialog } from '@/components/printer/PrinterSettingsDialog';
import { A4PrinterCard } from '@/components/printer/A4PrinterCard';
import { useAuth } from '@/contexts/AuthContext';
import { BleVsClassicHelp } from '@/components/printer/BleVsClassicHelp';
import { FeatureKeys } from '@/lib/featureKeys';

export default function PrinterSettingsPage() {
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const bt = useBluetoothPrinter();
  const { business } = useAuth();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SavedBluetoothPrinter | null>(null);

  if (featuresLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!hasFeature('barcode_thermal_printer')) {
    return <FeatureLockedMessage />;
  }

  const canAdd = bt.isDesktop || bt.supported || bt.supportsClassicBluetooth;

  async function run(printer: SavedBluetoothPrinter, key: string, action: () => Promise<void>, done: string) {
    setBusyId(`${key}:${printer.id}`);
    try {
      await action();
      toast.success(done);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not reach the printer');
    } finally {
      setBusyId(null);
    }
  }

  function remove(printer: SavedBluetoothPrinter) {
    if (!confirm(`Remove ${printer.name} from this device?`)) return;
    bt.forget(printer.id);
    toast.success(`Removed ${printer.name}`);
  }

  return (
    <SettingsPageShell title="Print & devices" description="Bill and barcode label printers on this device." icon={Printer}>
      <DeviceBanner bt={bt} />

      <Card padding="md" className="mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Printers on this device</h2>
          {canAdd && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add printer
            </Button>
          )}
        </div>
        {bt.savedPrinters.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary">
            No printers yet.{' '}
            {canAdd ? 'Turn the printer on and tap Add printer.' : 'This device cannot reach printers directly — see above.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {bt.savedPrinters.map((printer) => (
              <PrinterRow
                key={printer.id}
                printer={printer}
                isActive={bt.activePrinter?.id === printer.id}
                busyId={busyId}
                onTest={() => run(printer, 'test', () => bt.printTest(printer), `Test page sent to ${printer.name}`)}
                onDrawer={() => run(printer, 'drawer', () => bt.openCashDrawer(printer), 'Cash drawer opened')}
                onEdit={() => setEditing(printer)}
                onRemove={() => remove(printer)}
                onDefault={(usage) => {
                  bt.setPreferred(printer.id, usage);
                  toast.success(`${printer.name} now prints ${usage === 'labels' ? 'labels' : 'bills'}`);
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      {bt.isDesktop && business?.id && <A4PrinterCard businessId={business.id} onSaved={(m) => toast.success(m)} />}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/settings/templates" className="font-medium text-primary-600 hover:text-primary-700">
          Bill layout &amp; A4/A5 printing
        </Link>
        <Link href="/settings/label-templates" className="font-medium text-primary-600 hover:text-primary-700">
          Label sizes &amp; layout
        </Link>
        <Link
          href="/settings/bluetooth-printer/diagnostics"
          className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700"
        >
          <Activity className="h-4 w-4" />
          Printer diagnostics
        </Link>
      </div>

      <div className="mt-6">
        <HelpCard bt={bt} />
      </div>

      {adding && (
        <PrinterConnectWizard
          bt={bt}
          title="Add a printer"
          reason="Bill printers (58/80 mm) and barcode label printers."
          onConnected={(printer) => {
            setAdding(false);
            toast.success(`${printer.name} added`);
            setEditing(printer);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {editing && (
        <PrinterSettingsDialog
          printer={editing}
          onCancel={() => setEditing(null)}
          onSave={(printer) => {
            bt.updatePrinter(printer);
            setEditing(null);
            toast.success('Printer settings saved');
          }}
        />
      )}
    </SettingsPageShell>
  );
}

function DeviceBanner({ bt }: { bt: UseBluetoothPrinterResult }) {
  const [icon, title, note]: [React.ReactNode, string, string] = bt.isDesktop
    ? [
        <Monitor key="i" className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />,
        'Khatario for Windows',
        'USB printers installed in Windows, network printers (Wi‑Fi/LAN) and Bluetooth printers paired in Windows (COM port).',
      ]
    : bt.isNative
      ? [
          <Bluetooth key="i" className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />,
          'Khatario Android app',
          'Classic Bluetooth printers paired in phone Settings, and BLE printers.',
        ]
      : bt.supported
        ? [
            <Bluetooth key="i" className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />,
            'This browser — Bluetooth (BLE) printers',
            `${PRINTER_ANDROID_APP_NOTE} For USB and network printers on a PC, install Khatario for Windows.`,
          ]
        : [
            <AlertTriangle key="i" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />,
            'This browser cannot reach printers directly',
            `${PRINTER_NOT_SUPPORTED_BROWSER} On a Windows PC, install Khatario for Windows for USB and network printers. Bills and labels can still be printed as PDF.`,
          ];
  return (
    <Card padding="sm">
      <div className="flex items-start gap-3 text-sm">
        {icon}
        <div>
          <p className="font-medium text-text-primary">{title}</p>
          <p className="mt-0.5 text-text-secondary">{note}</p>
        </div>
      </div>
    </Card>
  );
}

function connectionIcon(printer: SavedBluetoothPrinter) {
  if (printer.driver !== 'desktop') return Bluetooth;
  const target = parseDesktopPrinterId(printer.id);
  if (target?.kind === 'network') return Network;
  if (target?.kind === 'serial') return Cable;
  return Usb;
}

function connectionLabel(printer: SavedBluetoothPrinter): string {
  if (printer.driver !== 'desktop') return printer.driver === 'web-ble' ? 'Bluetooth (browser)' : 'Bluetooth';
  const target = parseDesktopPrinterId(printer.id);
  if (target?.kind === 'network') return `Network ${target.host}`;
  if (target?.kind === 'serial') return target.port;
  return 'Windows printer';
}

function PrinterRow({
  printer,
  isActive,
  busyId,
  onTest,
  onDrawer,
  onEdit,
  onRemove,
  onDefault,
}: {
  printer: SavedBluetoothPrinter;
  isActive: boolean;
  busyId: string | null;
  onTest: () => void;
  onDrawer: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDefault: (usage: 'labels' | 'receipts') => void;
}) {
  const profile = getProfile(printer.profileId);
  const isLabel = profile.language === 'TSPL' || profile.language === 'ZPL';
  const Icon = connectionIcon(printer);
  const details = isLabel
    ? `${profile.label} · ${profile.language}`
    : `${printer.paperWidthMm === 80 ? 80 : 58} mm bills · ${printer.copies && printer.copies > 1 ? `${printer.copies} copies` : '1 copy'}${
        printer.cashDrawer && printer.cashDrawer !== 'never' ? ' · cash drawer' : ''
      }`;

  return (
    <li className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-text-muted dark:bg-slate-800'
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate font-medium text-text-primary">
            {printer.name}
            {isActive && <CheckCircle2 className="h-4 w-4 text-green-600" aria-label="Connected" />}
          </div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {connectionLabel(printer)} · {details}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <DefaultChip on={!!printer.preferForReceipts} label="Bills" onClick={() => onDefault('receipts')} />
            <DefaultChip on={!!printer.preferForLabels} label="Labels" onClick={() => onDefault('labels')} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onTest} disabled={!!busyId}>
          {busyId === `test:${printer.id}` ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <TestTube2 className="mr-1.5 h-4 w-4" />
          )}
          Test print
        </Button>
        {!isLabel && printer.cashDrawer && printer.cashDrawer !== 'never' && (
          <Button variant="secondary" size="sm" onClick={onDrawer} disabled={!!busyId} title="Open cash drawer">
            {busyId === `drawer:${printer.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onEdit} title="Printer settings">
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} className="text-red-600 hover:bg-red-50" title="Remove">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function DefaultChip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={on}
      title={on ? `Default printer for ${label.toLowerCase()}` : `Use for ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs uppercase tracking-wide ${
        on
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
          : 'border border-dashed border-border text-text-muted hover:text-text-primary'
      }`}
    >
      <Star className="h-3 w-3" />
      {on ? `Prints ${label}` : `Use for ${label}`}
    </button>
  );
}

function FeatureLockedMessage() {
  return (
    <SettingsPageShell title="Print & devices" description="Bill and barcode label printers on this device." icon={Printer} className="py-10">
      <Card padding="lg" className="space-y-4">
        <PlanFeatureDeniedCallout
          featureKey={FeatureKeys.BARCODE_THERMAL_PRINTER}
          title="Direct printing isn’t included in your current plan"
          description="Printing straight to thermal bill and label printers is part of the Barcode & Label suite. Upgrade to set up printers on this device, or ask your administrator to enable Thermal Printer on your subscription."
          autoOpenUpgradeModal
        />
        <Link href="/settings" className="text-sm text-primary-600 hover:underline">
          Back to settings
        </Link>
      </Card>
    </SettingsPageShell>
  );
}

function HelpCard({ bt }: { bt: UseBluetoothPrinterResult }) {
  const tips = bt.isDesktop
    ? [
        'USB printer: install the driver from the box or the maker’s website first, then it appears under Printers on this computer.',
        'Network printer: hold FEED while turning it on to print its IP address, then type the IP or use Search the network.',
        'Bluetooth printer on a PC: pair it in Windows Settings › Bluetooth; it then appears as a COM port.',
        'Label printers (TSC, Xprinter, TVS LP, Zebra): pick the matching printer type in the printer’s settings so labels print in the right language.',
        'Cash drawer: plug it into the bill printer’s RJ11 port and choose when it opens in the printer’s settings.',
      ]
    : [
        'Turn the printer on so its Bluetooth light is on before you connect.',
        'Stay within 2–3 metres of the printer.',
        'Android app: pair the printer once in phone Settings › Bluetooth, then Add printer › Choose a paired printer.',
        'Printers are remembered on this device only. On a new phone or after clearing app data, add them again.',
        'iPhones cannot use Web Bluetooth. Use the Khatario Android app or a Windows PC.',
      ];
  return (
    <Card padding="md">
      <h3 className="mb-2 font-semibold">Troubleshooting</h3>
      <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {!bt.isDesktop && bt.supportsClassicBluetooth && (
        <div className="mt-4">
          <BleVsClassicHelp />
        </div>
      )}
    </Card>
  );
}
