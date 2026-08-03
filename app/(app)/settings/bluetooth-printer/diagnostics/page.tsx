'use client';

export const dynamic = 'force-dynamic';

import React, { useMemo, useState } from 'react';
import { Activity, Copy, Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { collectPrinterRuntimeDiagnostics } from '@/lib/printer/runtime';
import { BleVsClassicHelp } from '@/components/printer/BleVsClassicHelp';

function DiagnosticRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 py-2 border-b border-border last:border-0">
      <dt className="text-sm text-text-secondary shrink-0">{label}</dt>
      <dd
        className={`text-sm text-text-primary sm:text-right break-all ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

export default function BluetoothPrinterDiagnosticsPage() {
  const diagnostics = useMemo(() => collectPrinterRuntimeDiagnostics(), []);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const shellEmbedded = diagnostics.embeddedShellVersion;
  const runtimeLabel = diagnostics.isCapacitorNative
    ? 'Capacitor native app'
    : diagnostics.isPwaStandalone
      ? 'PWA (installed)'
      : 'Browser / PWA';

  return (
    <SettingsPageShell
      title="Printer diagnostics"
      description="Runtime details for support. Share this screen when Bluetooth printing fails on a device."
      icon={Activity}
    >
      <Card padding="md">
        <div className="flex justify-end mb-3">
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-1.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1.5" /> Copy JSON
              </>
            )}
          </Button>
        </div>

        <dl>
          <DiagnosticRow label="Collected at" value={diagnostics.collectedAt} mono />
          <DiagnosticRow label="Web app version" value={diagnostics.webAppVersion} />
          <DiagnosticRow label="Runtime" value={runtimeLabel} />
          <DiagnosticRow label="Platform" value={diagnostics.platform} />
          <DiagnosticRow
            label="Active transport"
            value={
              diagnostics.activeCapability?.label ??
              (diagnostics.activeTransport ?? 'none')
            }
          />
          <DiagnosticRow
            label="Bluetooth printing available"
            value={diagnostics.bluetoothPrintingAvailable ? 'yes' : 'no'}
          />
          <DiagnosticRow
            label="navigator.bluetooth"
            value={diagnostics.navigatorBluetoothAvailable ? 'available' : 'not available'}
          />
          <DiagnosticRow
            label="Capacitor native bridge"
            value={diagnostics.nativeBridgeAvailable ? 'present' : 'not present'}
          />
          <DiagnosticRow
            label="Embedded shell version"
            value={
              shellEmbedded
                ? `${shellEmbedded.versionName} (${shellEmbedded.versionCode})`
                : 'n/a (not native or not configured)'
            }
          />
          <DiagnosticRow
            label="Repo shell version (expected in APK)"
            value={`${diagnostics.repoShellVersion.versionName} (${diagnostics.repoShellVersion.versionCode})`}
          />
          <DiagnosticRow label="User agent" value={diagnostics.userAgent} mono />
        </dl>
      </Card>

      <Card padding="md">
        <h2 className="text-lg font-semibold mb-3">Transport registry</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border">
                <th className="py-2 pr-4 font-medium">Transport</th>
                <th className="py-2 pr-4 font-medium">Implemented</th>
                <th className="py-2 pr-4 font-medium">Matches runtime</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.transportRegistry.map((row) => (
                <tr key={row.transport} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 text-text-primary">{row.label}</td>
                  <td className="py-2 pr-4">{row.implemented ? 'yes' : 'no'}</td>
                  <td className="py-2 pr-4">{row.matchesRuntime ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padding="md">
        <BleVsClassicHelp />
      </Card>
    </SettingsPageShell>
  );
}
