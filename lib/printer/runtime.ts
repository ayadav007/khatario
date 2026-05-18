/**
 * Client runtime detection for printer diagnostics (no server imports).
 */

import {
  driverKindToTransport,
  getTransportCapability,
  listAllTransportCapabilities,
  type PrinterCapability,
  type PrinterTransport,
} from '@/lib/printer/capabilities';
import {
  getActiveDriverKind,
  getRegistryDiagnostics,
  isBluetoothSupported,
  isCapacitorNative,
} from '@/lib/bluetooth/driver-registry';
import { WEB_APP_VERSION } from '@/lib/printer/app-version';
import {
  getEmbeddedNativeShellVersion,
  APP_SHELL_VERSION_CODE,
  APP_SHELL_VERSION_NAME,
} from '@/lib/printer/shell-version';

export type PrinterRuntimeDiagnostics = {
  collectedAt: string;
  platform: string;
  userAgent: string;
  webAppVersion: string;
  isCapacitorNative: boolean;
  isPwaStandalone: boolean;
  navigatorBluetoothAvailable: boolean;
  nativeBridgeAvailable: boolean;
  activeTransport: PrinterTransport | null;
  activeCapability: PrinterCapability | null;
  bluetoothPrintingAvailable: boolean;
  embeddedShellVersion: ReturnType<typeof getEmbeddedNativeShellVersion>;
  repoShellVersion: { versionCode: number; versionName: string };
  allTransports: PrinterCapability[];
  transportRegistry: ReturnType<typeof getRegistryDiagnostics>;
};

function detectPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function collectPrinterRuntimeDiagnostics(): PrinterRuntimeDiagnostics {
  const navigatorBluetoothAvailable =
    typeof navigator !== 'undefined' &&
    !!(navigator as Navigator & { bluetooth?: { requestDevice?: unknown } }).bluetooth &&
    typeof (navigator as Navigator & { bluetooth?: { requestDevice?: unknown } }).bluetooth
      ?.requestDevice === 'function';

  const native = isCapacitorNative();
  const activeKind = getActiveDriverKind();
  const activeTransport = activeKind ? driverKindToTransport(activeKind) : null;
  const activeCapability = activeTransport
    ? getTransportCapability(activeTransport)
    : null;

  const cap =
    typeof window !== 'undefined' ? ((window as Window & { Capacitor?: unknown }).Capacitor as
        | { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Record<string, unknown> }
        | undefined) : undefined;

  return {
    collectedAt: new Date().toISOString(),
    platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    webAppVersion: WEB_APP_VERSION,
    isCapacitorNative: native,
    isPwaStandalone: detectPwaStandalone(),
    navigatorBluetoothAvailable,
    nativeBridgeAvailable: !!cap,
    activeTransport,
    activeCapability,
    bluetoothPrintingAvailable: isBluetoothSupported(),
    embeddedShellVersion: getEmbeddedNativeShellVersion(),
    repoShellVersion: {
      versionCode: APP_SHELL_VERSION_CODE,
      versionName: APP_SHELL_VERSION_NAME,
    },
    allTransports: listAllTransportCapabilities(),
    transportRegistry: getRegistryDiagnostics(),
  };
}
