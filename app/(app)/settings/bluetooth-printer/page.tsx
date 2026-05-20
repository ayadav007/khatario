'use client';

/**
 * SETTINGS > BLUETOOTH PRINTER
 *
 * Pair, manage, and test Bluetooth thermal printers for the current
 * business. Pairings are stored client-side (localStorage) since a
 * Bluetooth pairing is inherently device-scoped.
 *
 * Feature gate
 * ------------
 * Gated behind `barcode_thermal_printer` — the same flag that governs ZPL
 * output, since both are "native printer" outputs that go beyond generic
 * PDF/HTML printing.
 */

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bluetooth,
  Printer,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Star,
  TestTube2,
  Activity,
} from 'lucide-react';
import { PrintSettingsPanel } from '@/components/printer/PrintSettingsPanel';
import {
  PRINTER_ANDROID_APP_NOTE,
  PRINTER_NOT_SUPPORTED_BROWSER,
  PRINTER_THERMAL_CLASSIC_NOTE,
} from '@/lib/printer/copy';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';
import { PRINTER_PROFILES } from '@/lib/bluetooth/printer-profiles';
import type { SavedBluetoothPrinter } from '@/lib/bluetooth/types';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';
import { FeatureKeys } from '@/lib/featureKeys';

export default function BluetoothPrinterSettingsPage() {
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const bt = useBluetoothPrinter();

  const [testingId, setTestingId] = useState<string | null>(null);

  const hasAccess = hasFeature('barcode_thermal_printer');

  // --------------------------------------------------------------------
  // Guards
  // --------------------------------------------------------------------

  if (featuresLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!hasAccess) {
    return <FeatureLockedMessage />;
  }

  // --------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------

  function handleForget(printer: SavedBluetoothPrinter) {
    if (
      !confirm(
        `Remove ${printer.name} from this device? You'll need to pair again to print.`
      )
    )
      return;
    bt.forget(printer.id);
    toast.success(`Removed ${printer.name}`);
  }

  async function handleTest(printer: SavedBluetoothPrinter) {
    try {
      setTestingId(printer.id);
      await bt.printTest(printer);
      toast.success(`Test page sent to ${printer.name}`);
    } catch (err: any) {
      toast.error(err?.message || 'Test print failed');
    } finally {
      setTestingId(null);
    }
  }

  function handleSetPreferred(
    printer: SavedBluetoothPrinter,
    usage: 'labels' | 'receipts'
  ) {
    bt.setPreferred(printer.id, usage);
    toast.success(
      `${printer.name} is now the default for ${
        usage === 'labels' ? 'labels' : 'receipts'
      }`
    );
  }

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------

  return (
    <div className={SETTINGS_CONTENT_WIDTH}>
      <SupportBanner supported={bt.supported} isNative={bt.isNative} />
      <PrintSettingsPanel
        testing={testingId !== null}
        onTestPrint={async () => {
          const p = bt.activePrinter || bt.savedPrinters[0];
          if (p) await handleTest(p);
        }}
      />
      <Link
        href="/settings/bluetooth-printer/diagnostics"
        className="text-sm text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 mt-4 block"
      >
        <Activity className="w-4 h-4" />
        Printer diagnostics
      </Link>
      {bt.savedPrinters.length > 0 && (
        <Card padding="md" className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Saved printers</h2>
          <ul className="divide-y divide-border">
            {bt.savedPrinters.map((printer) => (
              <PrinterRow
                key={printer.id}
                printer={printer}
                busy={testingId === printer.id}
                isActive={bt.activePrinter?.id === printer.id}
                onTest={() => handleTest(printer)}
                onRemove={() => handleForget(printer)}
                onSetPreferred={(usage) => handleSetPreferred(printer, usage)}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// Sub-components
// ---------------------------------------------------------------------------

function SupportBanner({
  supported,
  isNative,
}: {
  supported: boolean;
  isNative: boolean;
}) {
  if (supported) {
    return (
      <Card padding="sm">
        <div className="flex items-start gap-3 text-sm">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-green-800">
              {isNative
                ? 'Android app — Classic Bluetooth (SPP) thermal printing'
                : 'Browser — BLE printing available'}
            </p>
            <p className="text-text-secondary mt-0.5">{PRINTER_THERMAL_CLASSIC_NOTE}</p>
            {!isNative && (
              <p className="text-text-secondary mt-1 text-xs">{PRINTER_ANDROID_APP_NOTE}</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="sm">
      <div className="flex items-start gap-3 text-sm">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-amber-800">
            Bluetooth printing is not available here
          </p>
          <p className="text-text-secondary mt-0.5">{PRINTER_NOT_SUPPORTED_BROWSER}</p>
          <p className="text-text-secondary mt-1 text-xs">{PRINTER_ANDROID_APP_NOTE}</p>
        </div>
      </div>
    </Card>
  );
}

function PrinterRow({
  printer,
  busy,
  isActive,
  onTest,
  onRemove,
  onSetPreferred,
}: {
  printer: SavedBluetoothPrinter;
  busy: boolean;
  isActive: boolean;
  onTest: () => void;
  onRemove: () => void;
  onSetPreferred: (usage: 'labels' | 'receipts') => void;
}) {
  const profile = useMemo(
    () => PRINTER_PROFILES.find((p) => p.id === printer.profileId),
    [printer.profileId]
  );

  return (
    <li className="py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-text-muted'
          }`}
        >
          <Bluetooth className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-text-primary truncate flex items-center gap-2">
            {printer.name}
            {isActive && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                connected
              </span>
            )}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            {profile?.label || printer.profileId} · {printer.paperWidthMm}mm ·{' '}
            {profile?.language || 'ESCPOS'}
          </div>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {printer.preferForLabels && (
              <span className="text-[10px] uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded inline-flex items-center gap-1">
                <Star className="w-3 h-3" /> default labels
              </span>
            )}
            {printer.preferForReceipts && (
              <span className="text-[10px] uppercase px-1.5 py-0.5 bg-slate-100 text-primary-700 rounded inline-flex items-center gap-1">
                <Star className="w-3 h-3" /> default receipts
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onTest}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <TestTube2 className="w-4 h-4 mr-1.5" />
          )}
          Test print
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetPreferred('labels')}
          title="Use as default for label printing"
          disabled={!!printer.preferForLabels}
        >
          Set default (labels)
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetPreferred('receipts')}
          title="Use as default for receipts / invoices"
          disabled={!!printer.preferForReceipts}
        >
          Set default (receipts)
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} className="text-red-600 hover:bg-red-50">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </li>
  );
}

function FeatureLockedMessage() {
  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} py-10`}>
      <Card padding="lg" className="space-y-4">
        <PlanFeatureDeniedCallout
          featureKey={FeatureKeys.BARCODE_THERMAL_PRINTER}
          title="Bluetooth printing isn’t included in your current plan"
          description="Direct thermal (ZPL) output is part of the Barcode & Label suite. Upgrade to pair and print from this device, or ask your administrator to enable Thermal Printer (ZPL) on your subscription."
          autoOpenUpgradeModal
        />
        <Link href="/settings" className="text-sm text-primary-600 hover:underline">
          Back to settings
        </Link>
      </Card>
    </div>
  );
}

function HelpCard() {
  return (
    <Card padding="md">
      <h3 className="font-semibold mb-2">Troubleshooting</h3>
      <p className="text-sm text-text-secondary mb-3">{PRINTER_ANDROID_APP_NOTE}</p>
      <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
        <li>
          Turn on your printer and make sure its Bluetooth light is blinking
          before pairing.
        </li>
        <li>
          Hold the printer within 2–3 metres of this device during pairing.
        </li>
        <li>
          If the picker shows no devices, try an alternate profile (Xprinter
          / Rongta / Goojprt) or choose "Auto-detect".
        </li>
        <li>
          After pairing, the printer auto-connects before each print. If the
          connection is lost mid-day, the next print will re-open it; no
          action is needed.
        </li>
        <li>
          Paired printers are remembered on this device only. If you clear
          the browser data or switch devices, pair again.
        </li>
        <li>
          iPhones/iPads cannot use Web Bluetooth. Use the Khatario Android app
          or a laptop with Chrome/Edge instead.
        </li>
        <li>
          Many budget thermal printers are Classic Bluetooth (SPP) only — they
          will not appear in the BLE picker. See &quot;BLE vs Classic
          Bluetooth&quot; above.
        </li>
      </ul>
    </Card>
  );
}
