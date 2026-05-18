'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { isCapacitorNative } from '@/lib/bluetooth/driver-registry';
import { evaluateShellCompatibility } from '@/lib/printer/shell-version';

type ShellCompatibilityApi = {
  minimumShellVersionCode: number;
  minimumShellVersionName: string;
  blockOnIncompatible: boolean;
};

/**
 * Warns when the installed Android shell is older than the server minimum.
 * Does not block app usage (blockOnIncompatible is reserved for a future gate).
 */
export function ShellVersionBanner() {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!isCapacitorNative()) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/app/shell-compatibility', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as ShellCompatibilityApi;
        const result = evaluateShellCompatibility(
          data.minimumShellVersionCode,
          data.minimumShellVersionName
        );
        if (cancelled || !result.shouldWarn || !result.embedded) return;

        setWarning(
          `Please update the Khatario app. This device is on shell ${result.embedded.versionName} (build ${result.embedded.versionCode}); ${result.minimumRequired.versionName} (build ${result.minimumRequired.versionCode}) or newer is required for Bluetooth and native features.`
        );
      } catch {
        /* non-fatal */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!warning) return null;

  return (
    <div
      role="status"
      className="mx-4 mt-2 mb-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2 lg:mx-6"
    >
      <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" aria-hidden />
      <p>{warning}</p>
    </div>
  );
}
